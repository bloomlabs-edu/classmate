/**
 * Firestore access for the Learning Circle per-student security boundary.
 *
 * Paths:
 * classrooms/{classroomId}/programmeSessions/{sessionId}/studentEntries/{studentId}
 * classrooms/{classroomId}/programmeSessions/{sessionId}/studentEntries/{studentId}/goals/{categoryId}
 *
 * The parent entry owns attendance. Each goal category is its own document so
 * Firestore Rules can authorize one category without iterating an arbitrary map.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

function teacherDb() {
  return getFirestore(getFirebaseApp());
}

function entryDoc(db, classroomId, sessionId, studentId) {
  return doc(db, 'classrooms', classroomId, 'programmeSessions', sessionId, 'studentEntries', studentId);
}

function goalsCollection(db, classroomId, sessionId, studentId) {
  return collection(entryDoc(db, classroomId, sessionId, studentId), 'goals');
}

function goalDoc(db, classroomId, sessionId, studentId, categoryId) {
  return doc(goalsCollection(db, classroomId, sessionId, studentId), categoryId);
}

/** `db` defaults to the teacher's own default-app Firestore instance (matching listAllStudentEntries()/listAllStudentGoals() below) — every current caller of this function is teacher-side (services/programmeSessionService.js's own createAndSaveSession()/saveAttendancePatchWithMirror()), so it is never called with a student's own per-slot instance. */
export function createTeacherStudentEntry(db = teacherDb(), classroomId, sessionId, studentId) {
  return setDoc(entryDoc(db, classroomId, sessionId, studentId), { attendance: null });
}

/** This is the one function in this file called from BOTH sides: the student's own per-slot instance (services/studentLearningCircleService.js's own setOwnGoal(), passing its real `db` explicitly) for a brand-new goal, and the teacher's own default-app instance (ui/components/ProgrammeGoalsControls.js's own goalWriter, passing `undefined` on purpose) when a teacher picks a suggested goal on a student's behalf. `db || teacherDb()` (not a default parameter) so an explicit falsy student `db` is never silently swapped for the teacher's. */
export function createStudentEntryGoal(db, classroomId, sessionId, studentId, categoryId, goal) {
  return setDoc(goalDoc(db || teacherDb(), classroomId, sessionId, studentId, categoryId), goal);
}

/** Teacher-only partial edit of an already-recorded goal's own `outcome`/`reflection` (see firestore.rules' own studentEntries/{studentId}/goals/{categoryId} update rule) — distinct from createStudentEntryGoal()'s full setDoc(), which is the student's own create-a-new-goal path. */
export function updateStudentEntryGoal(db = teacherDb(), classroomId, sessionId, studentId, categoryId, patch) {
  return updateDoc(goalDoc(db, classroomId, sessionId, studentId, categoryId), patch);
}

/** `db` defaults the same way createTeacherStudentEntry() above does — see that function's own comment. */
export function updateTeacherStudentEntry(db = teacherDb(), classroomId, sessionId, studentId, patch) {
  return updateDoc(entryDoc(db, classroomId, sessionId, studentId), patch);
}

export async function getStudentEntry(db, classroomId, sessionId, studentId) {
  const snapshot = await getDoc(entryDoc(db, classroomId, sessionId, studentId));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function getStudentGoal(db, classroomId, sessionId, studentId, categoryId) {
  const snapshot = await getDoc(goalDoc(db, classroomId, sessionId, studentId, categoryId));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function listStudentGoals(db, classroomId, sessionId, studentId) {
  const snapshot = await getDocs(goalsCollection(db, classroomId, sessionId, studentId));
  return snapshot.docs.map((item) => ({ categoryId: item.id, ...item.data() }));
}

/** Teacher-side hydration for new sessions: reconstruct the session's legacy in-memory goals map from the secure per-category documents. */
export async function listAllStudentEntries(db = teacherDb(), classroomId, sessionId) {
  const entriesRef = collection(db, 'classrooms', classroomId, 'programmeSessions', sessionId, 'studentEntries');
  const snapshot = await getDocs(entriesRef);
  return snapshot.docs.map((item) => ({ studentId: item.id, ...item.data() }));
}

export async function listAllStudentGoals(db = teacherDb(), classroomId, sessionId) {
  const entries = await listAllStudentEntries(db, classroomId, sessionId);
  const result = {};
  await Promise.all(entries.map(async ({ studentId }) => {
    const goals = await listStudentGoals(db, classroomId, sessionId, studentId);
    if (goals.length > 0) {
      result[studentId] = Object.fromEntries(goals.map(({ categoryId, ...goal }) => [categoryId, goal]));
    }
  }));
  return result;
}
