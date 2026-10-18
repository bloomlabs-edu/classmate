/**
 * functions/src/learnerVerification/verifyLearnerConnection.js
 *
 * The trusted-server half of the Learner Identity Bridge — the actual
 * logic that runs inside the authenticated, IAM-gated Cloud Function
 * (see ../verifyLearnerConnectionEndpoint.js and ../../index.js) and is
 * wrapped and tested here independently, against the Firestore
 * emulator via firebase-admin, so it is real, executable, and
 * verifiable without deploying anything.
 *
 * Lives inside functions/ (not a sibling server/ directory, where it
 * originally lived) because Cloud Functions only packages the
 * functions/ directory at deploy time — see ../../index.js's own
 * header comment for the packaging failure this move fixes. Its
 * LearnerConnection shape dependencies come from ./learnerConnectionShared.js
 * for the same reason — see that file's own header comment.
 *
 * Uses firebase-admin deliberately, not the client SDK
 * (repositories/firestoreLearnerConnectionRepository.js's own file):
 * the Admin SDK bypasses Firestore security rules by design, which is
 * exactly what a trusted server context needs — and it's the only way
 * to perform the SHA-256 hash comparison this whole verification step
 * depends on, since the Firestore rules language has no hashing
 * function at all (see firestore.rules' own comment on this block for
 * why that single fact is what makes a server module unavoidable here,
 * not merely a design preference).
 */

import { sha256Hex } from './hashUtils.js';
import { buildRelationshipId, RELATIONSHIP_STATUS, CODE_STATUS, findTrustedAutomaticMatch } from './learnerConnectionShared.js';

/** Every failure returns this exact, generic shape — never a specific reason — matching the security review's own anti-oracle requirement (never let a caller distinguish "not found" from "expired" from "already used" from "wrong classroom"). */
const GENERIC_FAILURE = Object.freeze({ ok: false, error: 'verification_failed' });

/**
 * Step one of the bridge: Learning Hub tells ClassMate "a learner wants
 * to connect to this classroom," naming the classroom only — no student
 * yet, matching the architecture brief's own "classroom invitation does
 * not identify one particular student" requirement.
 *
 * Also where the (today, always-null) automatic-match check runs — see
 * models/LearnerConnection.js's own findTrustedAutomaticMatch() header
 * comment for why this always falls through to requiring the
 * verification-code fallback under the current architecture. This
 * function does not special-case that null result in any way that
 * differs from what happens without it — it exists so the check is
 * genuinely performed and asserted (see the test suite), not silently
 * skipped.
 *
 * Idempotent: calling this again for an already-ACTIVE relationship
 * does not disturb it — it is returned as-is, never reset to PENDING.
 * Calling it again for an existing PENDING or REVOKED relationship
 * creates (or overwrites) a fresh PENDING record — a new attempt to
 * connect, which still requires the full verification-code step below
 * to ever reach ACTIVE. This is the concrete meaning of "if
 * re-verification is required, it should go through the appropriate
 * verification process again" for the REVOKED case.
 */
/**
 * `classroomId` is OPTIONAL here, deliberately — this was a required
 * caller-supplied input originally, but ClassMate's own invitation-
 * sharing UI (ConnectLearningHubView.js's renderInvitationSection(),
 * "On its own, this code identifies your classroom only") never hands
 * the classroom id out alongside the code, only the bare 6-character
 * code itself. Requiring a value the caller structurally cannot have
 * made this function uncallable from the one real, live UI that
 * redeems invitations (Learning Hub's redeemInvitation(), wired to
 * onboarding-ui.js). The invitation code is already the sole, globally
 * unique key into `classroomInvitationCodes` (a top-level collection,
 * keyed by the code itself) — the classroom it belongs to is always
 * resolved FROM the code, never from a client claim. If a caller does
 * independently supply classroomId anyway, it's still checked against
 * the invitation's own real value as defense in depth; it is never
 * treated as the source of truth.
 */
export async function createConnectionRequest(adminDb, { learnerProfileId, classroomId, invitationCode }) {
  if (!learnerProfileId || !invitationCode) return GENERIC_FAILURE;

  const invitationCodeRef = adminDb.collection('classroomInvitationCodes').doc(invitationCode);
  const invitationCodeSnap = await invitationCodeRef.get();
  if (!invitationCodeSnap.exists) return GENERIC_FAILURE;
  const invitationCodeData = invitationCodeSnap.data();
  const resolvedClassroomId = invitationCodeData.classroomId;
  if (invitationCodeData.status !== 'active' || !resolvedClassroomId) return GENERIC_FAILURE;
  if (classroomId && classroomId !== resolvedClassroomId) return GENERIC_FAILURE;

  const relationshipRef = adminDb.collection('learnerClassroomRelationships').doc(buildRelationshipId(learnerProfileId, resolvedClassroomId));

  const existing = await relationshipRef.get();
  if (existing.exists && existing.data().status === RELATIONSHIP_STATUS.ACTIVE) {
    return { ok: true, status: RELATIONSHIP_STATUS.ACTIVE, classroomId: resolvedClassroomId };
  }

  // Documented no-op today (see findTrustedAutomaticMatch's own header
  // comment) — performed for real, never skipped, so this bridge never
  // silently assumes a signal that doesn't exist.
  const automaticMatch = findTrustedAutomaticMatch({ learnerProfileId, classroomId: resolvedClassroomId });

  const now = new Date().toISOString();
  await relationshipRef.set(
    {
      learnerProfileId,
      classroomId: resolvedClassroomId,
      studentId: automaticMatch?.studentId ?? null,
      status: RELATIONSHIP_STATUS.PENDING,
      invitationCode,
      createdAt: existing.exists ? existing.data().createdAt : now,
      updatedAt: now,
    },
    { merge: false }
  );

  return { ok: true, status: RELATIONSHIP_STATUS.PENDING, classroomId: resolvedClassroomId };
}

/**
 * Step two — the actual security-critical operation this entire bridge
 * exists for. Redeems a student-specific verification code and, only on
 * success, activates the relationship. Everything happens inside one
 * Firestore transaction: reads first (code, relationship, live
 * classroom roster), then writes (code -> redeemed, relationship ->
 * ACTIVE) — so a concurrent second attempt with the same code can never
 * also succeed (Firestore serializes conflicting transactions against
 * the same documents).
 *
 * Returns the exact same GENERIC_FAILURE shape for every failure
 * category — code doesn't exist, wrong classroom, expired, already
 * redeemed, roster no longer has this student, or (the one case unique
 * to this function) the relationship is already ACTIVE for a
 * DIFFERENT student. That last check is what makes "a learner cannot
 * claim another student's roster ID" true even against a caller who
 * legitimately possesses a real, valid, unexpired code for some OTHER
 * student in the same classroom — a valid code alone is not enough to
 * overwrite an already-established relationship; only an explicit
 * revocation (see repositories/firestoreLearnerConnectionRepository.js's
 * own revokeRelationship()) followed by a brand new connection request
 * can ever change who an already-linked learnerProfileId maps to.
 */
export async function verifyStudentCode(adminDb, { learnerProfileId, classroomId, rawCode }) {
  if (!learnerProfileId || !classroomId || !rawCode) return GENERIC_FAILURE;

  const codeHash = sha256Hex(rawCode);
  const codeRef = adminDb.collection('classrooms').doc(classroomId).collection('studentVerificationCodes').doc(codeHash);
  const relationshipRef = adminDb.collection('learnerClassroomRelationships').doc(buildRelationshipId(learnerProfileId, classroomId));
  const classroomRef = adminDb.collection('classrooms').doc(classroomId);

  return adminDb.runTransaction(async (tx) => {
    const [codeSnap, relationshipSnap, classroomSnap] = await Promise.all([
      tx.get(codeRef),
      tx.get(relationshipRef),
      tx.get(classroomRef),
    ]);

    if (!codeSnap.exists) return GENERIC_FAILURE;
    const code = codeSnap.data();

    if (code.status !== CODE_STATUS.ACTIVE) return GENERIC_FAILURE;
    if (code.classroomId !== classroomId) return GENERIC_FAILURE; // defense in depth — path already scopes this
    if (new Date(code.expiresAt).getTime() <= Date.now()) return GENERIC_FAILURE;

    // Binding check added per the CRITICAL FIRST STEP security review
    // for the teacher-facing pending-request review workflow (see
    // models/LearnerConnection.js's own createStudentVerificationCode()
    // header comment for the full reasoning): a verification code is
    // generated while a teacher reviews one specific PENDING
    // relationship, and must only ever be redeemable by THAT
    // learnerProfileId — never by some other learnerProfileId that
    // merely also has a non-ACTIVE relationship in the same classroom
    // (trivially obtainable via the classroom's own shareable
    // invitation code). Without this check, a genuinely valid code for
    // a real roster student could be mis-bound to the wrong Learning
    // Hub learner whenever more than one request is pending at once.
    if (!code.learnerProfileId || code.learnerProfileId !== learnerProfileId) return GENERIC_FAILURE;

    if (!classroomSnap.exists) return GENERIC_FAILURE;
    const classroom = classroomSnap.data();
    const rosterStillHasStudent = (classroom.teams || []).some((team) =>
      (team.students || []).some((student) => student.id === code.studentId)
    );
    if (!rosterStillHasStudent) return GENERIC_FAILURE;

    // The one check unique to this function, not present in
    // createConnectionRequest() above: an already-ACTIVE relationship
    // can never be silently overwritten by a fresh (even genuinely
    // valid) code — closing the "claim arbitrary roster student"
    // attack even when the presented code is real.
    if (relationshipSnap.exists && relationshipSnap.data().status === RELATIONSHIP_STATUS.ACTIVE) {
      return GENERIC_FAILURE;
    }

    const now = new Date().toISOString();

    tx.update(codeRef, {
      status: CODE_STATUS.REDEEMED,
      redeemedAt: now,
      redeemedByLearnerProfileId: learnerProfileId,
    });

    tx.set(
      relationshipRef,
      {
        learnerProfileId,
        classroomId,
        studentId: code.studentId,
        status: RELATIONSHIP_STATUS.ACTIVE,
        verifiedAt: now,
        verifiedVia: 'student-verification-code',
        createdAt: relationshipSnap.exists ? relationshipSnap.data().createdAt : now,
        updatedAt: now,
      },
      { merge: true }
    );

    return { ok: true, classroomId, studentId: code.studentId };
  });
}
