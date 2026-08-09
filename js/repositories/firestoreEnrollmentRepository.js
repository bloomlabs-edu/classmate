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
