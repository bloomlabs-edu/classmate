/**
 * repositories/firestoreEnrollmentRepository.js
 *
 * The only file that knows the Firestore path shapes for:
 *   enrollmentTokens/{token}                             — top-level, resolvable pre-auth,
 *                                                           mirroring joinCodes/studentJoinCodes
 *   classrooms/{classroomId}/studentAuthLinks/{studentId} — the trusted uid <-> studentId mapping
 *
 * Token creation is made from the TEACHER's own, default-app Firestore
 * instance (services/firebaseApp.js's own getFirebaseApp()) — teachers
 * are the only ones who can create a token at all (see
 * firestore.rules).
 *
 * Redemption is made from the STUDENT's own, per-slot Firestore
 * instance (services/studentAuthService.js's own getFirestoreForSlot())
 * — this write must carry that slot's own anonymous request.auth, not
 * the teacher's, since the whole point of redemption is proving THIS
 * anonymous identity is now bound to a specific student.
 *
 * Redemption is a single writeBatch(): the token flips to used:true
 * and the studentAuthLinks doc is created together, atomically — both
 * succeed or both fail. Firestore rules validate each half
 * independently (a token's own update rule checks it was unused; the
 * studentAuthLinks create rule cross-references that same token via
 * get()), so there is no client-side "check then write" race — the
 * server-side commit either satisfies both rules or the whole batch
 * is rejected.
 */

import { doc, setDoc, writeBatch, getDoc, getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

function teacherDb() {
  return getFirestore(getFirebaseApp());
}

function tokenDoc(db, token) {
  return doc(db, 'enrollmentTokens', token);
}

function studentAuthLinkDoc(db, classroomId, studentId) {
  return doc(db, 'classrooms', classroomId, 'studentAuthLinks', studentId);
}

function membershipLinkDoc(db, classroomId, programmeId, uid) {
  return doc(db, 'classrooms', classroomId, 'learningProgrammes', programmeId, 'membershipLinks', uid);
}

function membershipMirrorDoc(db, classroomId, programmeId, studentId) {
  return doc(db, 'classrooms', classroomId, 'learningProgrammes', programmeId, 'memberships', studentId);
}

/** Called from the Teacher Portal — creates a token for one specific student. */
export async function createEnrollmentToken(token, { classroomId, studentId, expiresAt }) {
  const db = teacherDb();
  await setDoc(tokenDoc(db, token), { classroomId, studentId, expiresAt, used: false, createdAt: new Date().toISOString() });
}

/**
 * Reads a token's own real, current state — used by the redemption UI
 * to show a real, specific error ("already used" vs "expired" vs
 * "not found") rather than a single generic failure message. Read
 * access to enrollmentTokens is open (see firestore.rules) — a token
 * must be resolvable by a device that isn't linked to anything yet.
 */
export async function getEnrollmentToken(db, token) {
  const snapshot = await getDoc(tokenDoc(db, token));
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Redeems a token for a specific, already-signed-in anonymous uid —
 * called from the STUDENT's own per-slot Firestore instance (see this
 * file's own header comment for why that specific instance matters).
 * The actual validity check (unused, unexpired, studentId matches)
 * happens server-side, in firestore.rules, at commit time — this
 * function only issues the batch; it does not decide whether the
 * token is valid.
 */
export async function redeemEnrollmentToken(db, token, { classroomId, studentId, uid }) {
  const batch = writeBatch(db);
  batch.update(tokenDoc(db, token), { used: true });
  // sourceToken is included so firestore.rules's own create rule can
  // cross-reference exactly which token document to validate against
  // via getAfter() — rules cannot search for a matching token, only
  // read a specific, already-known path.
  batch.set(studentAuthLinkDoc(db, classroomId, studentId), { uid, sourceToken: token, linkedAt: new Date().toISOString() });
  await batch.commit();
}

/**
 * Links a device's own FIRST student directly — no token, no batch.
 * Deliberately omits the sourceToken field entirely (not merely
 * setting it to null/empty) — firestore.rules's own create rule
 * checks !('sourceToken' in request.resource.data) specifically to
 * distinguish this path from the token-gated one above.
 *
 * Explicitly accepted product policy (see this file's own header
 * comment, and firestore.rules's own comment on this exact rule):
 * classroom code + picking a name is sufficient for a device's first
 * student, matching the same trust level already accepted for
 * approving that first profile locally with no PIN. Never used for a
 * second or later profile on an already-claimed device — that case
 * still requires a real, teacher-issued token (see
 * StudentManageProfilesView.js's own enrollment-code step).
 */
export async function createStudentAuthLinkDirect(db, classroomId, studentId, uid) {
  await setDoc(studentAuthLinkDoc(db, classroomId, studentId), { uid, linkedAt: new Date().toISOString() });
}

/**
 * PHASE 3.7 — creates this device's own membershipLinks/{uid} document
 * (see firestore.rules' own membershipLinks block for the full
 * create-time verification this performs server-side), called from
 * the STUDENT's own per-slot Firestore instance — `db` must be that
 * instance, exactly like redeemEnrollmentToken()/
 * createStudentAuthLinkDirect() above, never the teacher's.
 *
 * Idempotent by design: services/studentLearningCircleService.js's own
 * ensureProgrammeMembershipLink() calls this every time a student
 * opens the Learning Circle, not just once, so a second call for a
 * uid that already has a link must be a safe no-op rather than a
 * failed write — the rule's own `allow update: if false` would
 * otherwise reject a repeat setDoc() to an existing link outright.
 * The existence check itself is always allowed by the read rule's own
 * `uid == request.auth.uid` branch, regardless of whether the
 * document exists yet.
 */
export async function ensureLearningProgrammeMembershipLink(db, classroomId, programmeId, studentId, uid) {
  const ref = membershipLinkDoc(db, classroomId, programmeId, uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return;
  await setDoc(ref, { studentId, joinedAt: new Date().toISOString(), status: 'active' });
}

/**
 * PHASE 3.7 — writes the direct membership security document
 * (`learningProgrammes/{programmeId}/memberships/{studentId}`) that
 * lets membershipLinks' own create rule resolve active-membership
 * status via a single get() instead of the nested .exists() array
 * scan over classroom.learningProgrammes[] (kept as a permanent OR
 * fallback there — see firestore.rules' own comment). Always called
 * from the TEACHER's own default-app Firestore instance — this is
 * teacher-only data, written from the same UI actions
 * (services/learningProgrammeService.js's own addMembership()/
 * markMembershipLeft()) that already mutate the embedded array, never
 * from a student device. Deliberately NOT called retroactively for
 * memberships that already existed before this phase — see this
 * project's own Phase 3.7 authorization: no backfill this round.
 */
export async function setProgrammeMembershipMirror(classroomId, programmeId, studentId, { status, joinedAt }) {
  const db = teacherDb();
  await setDoc(membershipMirrorDoc(db, classroomId, programmeId, studentId), { status, joinedAt });
}

/** Called by firestoreStudentGoalsRepository.js's own rules-adjacent checks are server-side only — this is for the UI's own, client-side convenience read (e.g. confirming enrollment status), never for authorization. */
export async function getStudentAuthLink(db, classroomId, studentId) {
  try {
    const snapshot = await getDoc(studentAuthLinkDoc(db, classroomId, studentId));
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    // The read rule's own "student themselves" branch reads
    // resource.data.uid — which only evaluates if the document
    // already exists. For an un-enrolled student (exactly what this
    // function exists to check), it doesn't yet, so the rule fails to
    // evaluate rather than gracefully returning "not found" —
    // Firestore surfaces that as a permission-denied error,
    // indistinguishable on the client from a genuine rejection. Given
    // this call already has a real, valid auth context (confirmed
    // separately — see enrollmentService.js's own callers, which
    // always await ensureAnonymousSignIn() first), the only way this
    // specific read can fail is the document not existing yet, not an
    // actual security violation. Treated the same as the graceful
    // !snapshot.exists() case above.
    if (error.code?.includes('permission-denied')) return null;
    throw error;
  }
}
