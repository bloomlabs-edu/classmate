/**
 * functions/src/learnerVerification/activateLearnerConnection.js
 *
 * Single-code Join a Classroom (product decision): the second,
 * learner-facing verification-code step is removed from the join
 * experience. This module is the new way a PENDING relationship ever
 * reaches ACTIVE instead — a classroom's own teacher, reviewing the
 * pending-request queue in ui/views/ConnectLearningHubView.js, picks
 * the real roster student the request belongs to, and that action
 * itself activates the connection directly. No code is generated,
 * shown, or transmitted anywhere in this path.
 *
 * Deliberately NOT a weakening of
 * server/learnerVerification/verifyLearnerConnection.js's own
 * documented invariant ("no `create` or `update` branch in
 * firestore.rules can EVER produce a document whose `status` is
 * `'ACTIVE'` — that transition is exclusively an Admin-SDK operation").
 * This function is itself an Admin-SDK operation, exactly like
 * verifyStudentCode() — it does not touch firestore.rules at all, and
 * a learner can still never self-activate their own relationship
 * through any client write. What changes is WHO authorizes the
 * activation and HOW: previously, possession of a teacher-issued,
 * hashed, single-use code; now, a verified ClassMate teacher's own
 * authenticated action, scoped to a classroom they are genuinely a
 * member of, naming a real roster student. Both are real,
 * server-verified authorizations — neither is "no authorization."
 *
 * The old code-based path (createStudentVerificationCodeForStudent(),
 * verifyStudentCode(), the studentVerificationCodes collection) is
 * left fully intact and untouched, deliberately not deleted — this
 * keeps the change minimal and reversible. Nothing calls it anymore
 * once ConnectLearningHubView.js's own handler is updated, but it
 * remains available infrastructure, not a half-removed feature.
 */

import { buildRelationshipId, RELATIONSHIP_STATUS } from './learnerConnectionShared.js';

/** Every failure names a specific reason (not an anti-oracle shape) — the caller here is always an already-authenticated, already-verified ClassMate teacher, not an untrusted public caller the system must hide failure reasons from. See ../activateLearnerConnectionEndpoint.js's own REASON_TO_ERROR mapping for the exact strings a browser ever sees. */
const REASON = Object.freeze({
  CLASSROOM_NOT_FOUND: 'classroom_not_found',
  FORBIDDEN: 'forbidden',
  STUDENT_NOT_ON_ROSTER: 'student_not_on_roster',
  NOT_PENDING: 'not_pending',
});

/**
 * Activates a PENDING relationship directly, with no code involved.
 * Everything happens inside one Firestore transaction — reads first
 * (classroom, relationship), then one write — the same shape
 * verifyStudentCode() already uses, for the same reason: a concurrent
 * second attempt against the same relationship can never also
 * succeed.
 *
 * Checks performed, all re-read fresh inside the transaction (never
 * trusted from a caller-supplied shape):
 *   1. The classroom exists.
 *   2. `teacherUid` is genuinely a member of THIS classroom — the same
 *      membership check ConnectLearningHubView.js's own
 *      firestore.rules already require for every other teacher action
 *      on this collection (`isTeacherOfRelationshipClassroom()`),
 *      re-verified here independently since this path runs via the
 *      Admin SDK, which bypasses those rules entirely and must
 *      therefore enforce the equivalent check itself.
 *   3. `studentId` genuinely exists on the classroom's LIVE roster
 *      right now — mirrors verifyStudentCode()'s own
 *      `rosterStillHasStudent` check exactly, so a student removed
 *      from the roster between when the teacher opened the picker and
 *      when they confirmed can never be activated against.
 *   4. The relationship is genuinely PENDING for this exact
 *      (learnerProfileId, classroomId) pair — not missing, not already
 *      ACTIVE (for this or any other student), not REJECTED/REVOKED.
 *      This is the same "an already-ACTIVE relationship can never be
 *      silently overwritten" property verifyStudentCode() enforces,
 *      expressed as a precondition instead of a special case, since
 *      there is no second credential here that could otherwise be
 *      replayed against an already-resolved relationship.
 *
 * `verifiedVia: 'teacher-direct-match'` distinguishes this activation
 * path from `'student-verification-code'` in the relationship's own
 * audit trail — both are real, server-verified activations; this
 * field exists so a future reader of this data can always tell which
 * mechanism actually authorized any given ACTIVE relationship.
 */
export async function activateRelationshipForStudent(adminDb, { classroomId, studentId, teacherUid, learnerProfileId }) {
  if (!classroomId || !studentId || !teacherUid || !learnerProfileId) {
    return { ok: false, reason: REASON.FORBIDDEN };
  }

  const classroomRef = adminDb.collection('classrooms').doc(classroomId);
  const relationshipRef = adminDb.collection('learnerClassroomRelationships').doc(buildRelationshipId(learnerProfileId, classroomId));

  return adminDb.runTransaction(async (tx) => {
    const [classroomSnap, relationshipSnap] = await Promise.all([tx.get(classroomRef), tx.get(relationshipRef)]);

    if (!classroomSnap.exists) return { ok: false, reason: REASON.CLASSROOM_NOT_FOUND };
    const classroom = classroomSnap.data();

    if (!(classroom.memberUids || []).includes(teacherUid)) {
      return { ok: false, reason: REASON.FORBIDDEN };
    }

    const rosterStillHasStudent = (classroom.teams || []).some((team) =>
      (team.students || []).some((student) => student.id === studentId)
    );
    if (!rosterStillHasStudent) return { ok: false, reason: REASON.STUDENT_NOT_ON_ROSTER };

    if (!relationshipSnap.exists || relationshipSnap.data().status !== RELATIONSHIP_STATUS.PENDING) {
      return { ok: false, reason: REASON.NOT_PENDING };
    }

    const now = new Date().toISOString();
    tx.set(
      relationshipRef,
      {
        learnerProfileId,
        classroomId,
        studentId,
        status: RELATIONSHIP_STATUS.ACTIVE,
        verifiedAt: now,
        verifiedVia: 'teacher-direct-match',
        verifiedByUid: teacherUid,
        createdAt: relationshipSnap.data().createdAt,
        updatedAt: now,
      },
      { merge: true }
    );

    return { ok: true, classroomId, studentId };
  });
}
