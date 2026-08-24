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
export async function submitGoal(db, { classroomId, studentId, cycleId, categoryId, text, uid }) {
  const existing = await findGoal(db, classroomId, { studentId, cycleId, categoryId, uid });
  const goalId = existing?.id ?? generateId();

  await setDoc(goalDoc(db, classroomId, goalId), {
    id: goalId,
    classroomId,
    studentId,
    // Denormalized from studentAuthLinks at write time (where a
    // single-document get() against it is always safe) so the READ
    // rule never needs a cross-document get() keyed by resource.data
    // — Firestore cannot prove a list query satisfies a rule that
    // depends on another document's own fields resolved per-result,
    // and denies the whole query rather than risk it. Storing the
    // already-verified uid directly here removes that dependency
    // entirely for reads; the create/update rule still verifies this
    // uid against studentAuthLinks at write time.
    uid,
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

/** A single goal by its own document ID, from the student's own per-slot instance — mirrors findGoal()'s own read shape, keyed directly by ID rather than query filters. */
export async function getGoalById(db, classroomId, goalId) {
  const snapshot = await getDoc(goalDoc(db, classroomId, goalId));
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Persists a completion toggle for one specific goal — a scoped
 * update to this one studentGoals document only, via the student's
 * own per-slot Firestore instance, never a write to the whole
 * classroom document. The caller (studentGoalsService.js) computes
 * the real completions/completedToday/streak/percent values first —
 * this function is deliberately "dumb," matching the same
 * repository/service split every other write in this file follows.
 */
export async function updateCompletion(db, classroomId, goalId, { completions, completedToday, currentStreak, longestStreak, overallCompletionPercent }) {
  await updateDoc(goalDoc(db, classroomId, goalId), {
    completions,
    completedToday,
    currentStreak,
    longestStreak,
    overallCompletionPercent,
  });
}

/** The one existing goal for this exact (studentId, categoryId, cycleId), or null — mirrors goalService.js's own getGoalForStudent() semantics for the old shape. */
/**
 * `uid` is required here for the same reason
 * listGoalsForStudent() below needs it: this is a list query, and
 * Firestore needs the query's own structural filters to guarantee
 * every possible result satisfies firestore.rules's own studentGoals
 * allow read (resource.data.uid == request.auth.uid) — without a
 * uid clause here, Firestore cannot prove that and denies the whole
 * query, which is exactly what was happening: this read runs first,
 * inside submitGoal(), before setDoc() is ever reached.
 */
export async function findGoal(db, classroomId, { studentId, cycleId, categoryId, uid }) {
  const snapshot = await getDocs(
    query(
      goalsCollection(db, classroomId),
      where('studentId', '==', studentId),
      where('cycleId', '==', cycleId),
      where('categoryId', '==', categoryId),
      where('uid', '==', uid)
    )
  );
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
}

/** Every goal for one specific student within one cycle — called from either the student's own instance or the teacher's, depending on caller. */
/**
 * `uid` is optional — required only for a student's own read (see
 * firestore.rules's own studentGoals allow read: for a list query,
 * Firestore needs the query's own structural filters to guarantee
 * every possible result satisfies resource.data.uid ==
 * request.auth.uid; the rule alone can't prove that without it, and
 * denies the whole list. The teacher-side caller (see
 * studentGoalsService.js's own getGoalForStudent()) authorizes via
 * memberUids instead, which doesn't depend on any per-document field
 * at all — passing uid there would be meaningless, so it's omitted
 * from that call site rather than passed as some other student's own
 * uid.
 */
export async function listGoalsForStudent(db, classroomId, { studentId, cycleId, uid }) {
  const clauses = [where('studentId', '==', studentId), where('cycleId', '==', cycleId)];
  if (uid) clauses.push(where('uid', '==', uid));

  const snapshot = await getDocs(query(goalsCollection(db, classroomId), ...clauses));
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

/**
 * Teacher-only -- the alternative outcome to approveGoal() above: asks
 * the student to revise their goal instead of approving it as-is.
 * Sets status to 'changes_requested' (a new, third status alongside
 * 'pending_approval'/'approved' -- see models/Goal.js's own header
 * comment, though this collection's real documents no longer flow
 * through that model) and attaches teacherFeedback -- the smallest
 * extension to the existing document shape that carries what the
 * student needs to see (see firestore.rules's own studentGoals allow
 * update, branch 3, which is scoped to touch exactly these two
 * fields). The student's own resubmission (submitGoal() above) is
 * completely unaffected: it already writes status back to
 * 'pending_approval' unconditionally on every submit, regardless of
 * the goal's prior status, and setDoc()'s own full-document
 * replacement semantics already clear this feedback naturally once
 * the student has acted on it and a fresh review cycle begins.
 */
export async function requestChanges(classroomId, goalId, feedbackText) {
  const db = teacherDb();
  await updateDoc(goalDoc(db, classroomId, goalId), {
    status: 'changes_requested',
    teacherFeedback: { text: feedbackText, createdAt: new Date().toISOString() },
  });
}
