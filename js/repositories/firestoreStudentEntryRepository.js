/**
 * repositories/firestoreStudentEntryRepository.js
 *
 * PHASE 3 — Student Identity & Learning Circle Data Boundary.
 *
 * Mirrors repositories/firestoreMembershipLinkRepository.js's own,
 * already-proven convention exactly: `db` is the first parameter,
 * resolved by the CALLER, never by this file. This is what lets the
 * SAME repository serve both contexts this phase's own §4 requires
 * be kept clearly separate — a teacher's own call passes the default
 * app instance (via services/programmeSessionRepository.js's own
 * getDb()); a student's own call passes their per-slot instance (via
 * services/studentAuthService.js's getFirestoreForSlot()). Neither
 * context is hardcoded here.
 *
 * Four operations only, deliberately:
 *   - a single-document get() (used by both teacher and student)
 *   - a plain, unfiltered collection read of every studentEntries
 *     document under one session (teacher's own Goals Review need —
 *     safe as a list read specifically because the teacher's own
 *     rule condition is classroomId-keyed, the same structurally-safe
 *     pattern already established for programmeSessions/studentGoals'
 *     own teacher-check branches; NEVER used by the student's own
 *     code, which only ever performs single, known-path getDoc()s —
 *     see this phase's own explicit "do not introduce list queries
 *     for studentEntries" instruction, which is about the STUDENT's
 *     own reads specifically, not the teacher's already-broader
 *     access)
 *   - a batched write pairing a ProgrammeSession update with a
 *     StudentEntry mirror-or-merge (teacher's own attendance path)
 *   - a merge-write to one student's own goals (student's own path,
 *     and also the teacher's own goal-review/edit path for a
 *     `usesStudentEntries` session)
 */

import { collection, doc, setDoc, getDoc, getDocs, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

function studentEntriesCollectionRef(db, classroomId, sessionId) {
  return collection(db, 'classrooms', classroomId, 'programmeSessions', sessionId, 'studentEntries');
}

function studentEntryDocRef(db, classroomId, sessionId, studentId) {
  return doc(studentEntriesCollectionRef(db, classroomId, sessionId), studentId);
}

/** One student's own entry for one session, or `null` if it doesn't exist yet (nothing has ever been written for them). */
export async function getStudentEntry(db, { classroomId, sessionId, studentId }) {
  const snapshot = await getDoc(studentEntryDocRef(db, classroomId, sessionId, studentId));
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Every studentEntries document under one session, as a plain
 * `{ [studentId]: entry }` map — the teacher's own Goals Review need
 * for a `usesStudentEntries` session. A flat, unfiltered read of the
 * whole (small — one document per roster student, never more)
 * subcollection; no `where()`/`orderBy()` needed, since the
 * subcollection's own path already scopes it to exactly one session.
 */
export async function listStudentEntriesForSession(db, { classroomId, sessionId }) {
  const snapshot = await getDocs(studentEntriesCollectionRef(db, classroomId, sessionId));
  const entriesByStudentId = {};
  snapshot.docs.forEach((docSnapshot) => {
    entriesByStudentId[docSnapshot.id] = docSnapshot.data();
  });
  return entriesByStudentId;
}

/**
 * The teacher's own attendance write, atomic across both documents —
 * the canonical ProgrammeSession update AND the StudentEntry mirror,
 * in one batch, so there is never a moment where one exists without
 * the other having been attempted too. Uses `set(..., {merge: true})`
 * for the StudentEntry side specifically because that document may
 * not exist yet (a session with no goals set for this student at
 * all) — merge-set is Firestore's own create-or-update primitive,
 * and merges recursively, so an existing `goals` field is never
 * clobbered by an attendance-only write.
 */
export async function saveAttendanceWithStudentEntryMirror(db, { classroomId, sessionId, studentId, sessionPatch, studentEntryAttendance }) {
  const batch = writeBatch(db);
  batch.update(doc(collection(db, 'classrooms', classroomId, 'programmeSessions'), sessionId), sessionPatch);
  batch.set(studentEntryDocRef(db, classroomId, sessionId, studentId), { attendance: studentEntryAttendance }, { merge: true });
  await batch.commit();
}

/**
 * Writes one student's own goal for one category into their own
 * StudentEntry — a merge-set for exactly the same create-or-update
 * reason as above. Used by both the student's own goal-setting call
 * AND the teacher's own goal-review/edit call for a
 * `usesStudentEntries` session — the rule (not this function)
 * distinguishes who's allowed to do this and for which studentId.
 */
export async function mergeStudentEntryGoal(db, { classroomId, sessionId, studentId, categoryId, goal }) {
  await setDoc(studentEntryDocRef(db, classroomId, sessionId, studentId), { goals: { [categoryId]: goal } }, { merge: true });
}
