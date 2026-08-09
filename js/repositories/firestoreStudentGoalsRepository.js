/**
 * repositories/firestoreStudentGoalsRepository.js
 *
 * The only file that knows the path shape for
 * classrooms/{classroomId}/studentGoals/{goalId} — a dedicated
 * collection, not classroom.goalCycles[].goals[], per the accepted
 * architecture decision: student-owned writable data lives in its own
 * collection, never nested inside the teacher-owned classroom
 * document.
 *
 * Writes (create/update from a student) go through the STUDENT's own
 * per-slot Firestore instance (studentAuthService.js's own
 * getFirestoreForSlot()) — this is what makes request.auth.uid on the
 * wire genuinely that student's own linked identity, for
 * firestore.rules to check against studentAuthLinks.
 *
 * The teacher's own approve action, and the teacher's own read of
 * pending goals, go through the TEACHER's own default-app Firestore
 * instance — teachers are already trusted via memberUids, same as
 * every other classroom-scoped write they make.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';
import { generateId } from '../utils/idGenerator.js';

function teacherDb() {
  return getFirestore(getFirebaseApp());
}

function goalsCollection(db, classroomId) {
  return collection(db, 'classrooms', classroomId, 'studentGoals');
}

function goalDoc(db, classroomId, goalId) {
  return doc(db, 'classrooms', classroomId, 'studentGoals', goalId);
}

/**
 * Creates a new goal, or updates the existing one for this exact
 * (studentId, categoryId, cycleId) — called from the student's own
 * per-slot Firestore instance. `db` is passed in explicitly, never
 * resolved here, since which slot's instance to use is a caller
 * concern (see studentGoalsService.js).
 */
export async function submitGoal(db, { classroomId, studentId, cycleId, categoryId, text }) {
  const existing = await findGoal(db, classroomId, { studentId, cycleId, categoryId });
  const goalId = existing?.id ?? generateId();

  await setDoc(goalDoc(db, classroomId, goalId), {
    id: goalId,
    classroomId,
    studentId,
    cycleId,
    categoryId,
    text,
    status: 'pending_approval',
    submittedAt: new Date().toISOString(),
    // Defaults for the fields the UI's own approved-state rendering
    // reads (see StudentGoalTrackerView.js's own render()) — real
    // daily-completion tracking for the new collection is a known,
    // deliberately out-of-scope gap for this milestone (see this
    // service's own header comment); these defaults exist only so
    // that branch doesn't render literal "undefined" text once a
    // goal reaches 'approved', which the acceptance test's own step
    // 14 requires to work correctly.
    completedToday: false,
    currentStreak: 0,
    longestStreak: 0,
    overallCompletionPercent: 0,
  });

  return goalId;
}

/** The one existing goal for this exact (studentId, categoryId, cycleId), or null — mirrors goalService.js's own getGoalForStudent() semantics for the old shape. */
export async function findGoal(db, classroomId, { studentId, cycleId, categoryId }) {
  const snapshot = await getDocs(
    query(
      goalsCollection(db, classroomId),
      where('studentId', '==', studentId),
      where('cycleId', '==', cycleId),
      where('categoryId', '==', categoryId)
    )
  );
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
}

/** Every goal for one specific student within one cycle — called from either the student's own instance or the teacher's, depending on caller. */
export async function listGoalsForStudent(db, classroomId, { studentId, cycleId }) {
  const snapshot = await getDocs(
    query(goalsCollection(db, classroomId), where('studentId', '==', studentId), where('cycleId', '==', cycleId))
  );
  return snapshot.docs.map((d) => d.data());
}

/** Every goal, any status, across every student within one cycle. Used to compute "who hasn't submitted everything yet" — an already-approved goal still counts as submitted, unlike listPendingGoalsForCycle()'s own pending-only scope. */
export async function listAllGoalsForCycle(classroomId, cycleId) {
  const db = teacherDb();
  const snapshot = await getDocs(query(goalsCollection(db, classroomId), where('cycleId', '==', cycleId)));
  return snapshot.docs.map((d) => d.data());
}

/** Every goal across every student currently awaiting a teacher's review, within one cycle — the teacher-side equivalent of goalService.js's own getPendingApprovalGoals(). Uses the TEACHER's own Firestore instance. */
export async function listPendingGoalsForCycle(classroomId, cycleId) {
  const db = teacherDb();
  const snapshot = await getDocs(
    query(goalsCollection(db, classroomId), where('cycleId', '==', cycleId), where('status', '==', 'pending_approval'))
  );
  return snapshot.docs.map((d) => d.data());
}

/** Teacher-only — mirrors goalService.js's own approveGoal() mutation, against the new collection. Uses the TEACHER's own Firestore instance; firestore.rules restrict this update to a classroom member. */
export async function approveGoal(classroomId, goalId) {
  const db = teacherDb();
  await updateDoc(goalDoc(db, classroomId, goalId), { status: 'approved' });
}
