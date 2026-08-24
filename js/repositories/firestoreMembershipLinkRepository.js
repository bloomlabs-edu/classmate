/**
 * repositories/firestoreMembershipLinkRepository.js
 *
 * The only file that knows the path shape for
 * classrooms/{classroomId}/learningProgrammes/{programmeId}/membershipLinks/{uid}.
 *
 * Mirrors repositories/firestoreStudentGoalsRepository.js's own,
 * already-proven convention exactly: `db` is passed in as the first
 * parameter, resolved by the CALLER (the service layer), never by
 * this file itself — a student's own read/create must go through
 * their own per-slot Firestore instance
 * (services/studentAuthService.js's own getFirestoreForSlot()) for
 * request.auth.uid to genuinely be that device's own linked identity
 * on the wire, exactly as firestoreStudentGoalsRepository.js's own
 * header comment explains for the same reason.
 *
 * PHASE 1 ONLY — this file has exactly two functions: read one link,
 * create one link. No update (the document is immutable — see
 * models/MembershipLink.js's own header comment), no delete, no list
 * query of any kind. A student's own read/write here is always a
 * single, known-path operation.
 */

import { collection, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

function membershipLinksCollection(db, classroomId, programmeId) {
  return collection(db, 'classrooms', classroomId, 'learningProgrammes', programmeId, 'membershipLinks');
}

function membershipLinkDoc(db, classroomId, programmeId, uid) {
  return doc(membershipLinksCollection(db, classroomId, programmeId), uid);
}

/** Reads this uid's own membership link for this programme, or null if none exists yet. A single, known-path get() — never a query. */
export async function getMembershipLink(db, { classroomId, programmeId, uid }) {
  const snapshot = await getDoc(membershipLinkDoc(db, classroomId, programmeId, uid));
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Creates this uid's own membership link — a plain setDoc(), not
 * setDoc(..., { merge: true }): this document is immutable once
 * created (see firestore.rules' own `allow update: if false`), so a
 * caller is expected to check getMembershipLink() first and only
 * call this when none exists yet; calling it again for an
 * already-existing link would be rejected by that same rule, not
 * silently overwrite anything.
 */
export async function createMembershipLink(db, { classroomId, programmeId, uid, link }) {
  await setDoc(membershipLinkDoc(db, classroomId, programmeId, uid), link);
}
