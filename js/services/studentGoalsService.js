/**
 * services/studentGoalsService.js
 *
 * The single service both StudentGoalTrackerView.js (student) and
 * GoalManagementView.js/StudentProfileView.js (teacher) call for
 * everything related to actual goal SUBMISSIONS. Everything about a
 * Goal Cycle's own CATEGORIES (Listening/Speaking/Reading/Writing —
 * the L/S/R/W names and their ids) is unchanged and still read
 * through goalService.js/the classroom document directly — only the
 * submissions themselves moved to their own collection. This service
 * is deliberately the seam between the two: it reads categories from
 * the old, unmoved place, and goals from the new, moved one.
 *
 * models/Goal.js and services/goalService.js's own submitGoal()/
 * approveGoal() are untouched and unused by this file — new goal data
 * simply doesn't flow through them anymore for this feature.
 */

import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from './firebaseApp.js';
import * as goalService from './goalService.js';
import * as studentAuthService from './studentAuthService.js';
import * as studentDeviceService from './studentDeviceService.js';
import * as workspaceService from './workspaceService.js';
import * as goalsRepository from '../repositories/firestoreStudentGoalsRepository.js';

function teacherFirestore() {
  return getFirestore(getFirebaseApp());
}

/**
 * The current student's own full goal-tracker view: cycle title/dates
 * (from the classroom document, unchanged) plus each category's own
 * real goal (from the new collection, read via THIS student's own
 * per-slot Firestore instance).
 */
export async function getGoalCycleForCurrentStudent() {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return null;

  const classroom = await workspaceService.getClassroomOnce(activeProfile.classroomId);
  if (!classroom) return null;

  const cycle = goalService.getActiveCycle(classroom);
  if (!cycle) return null;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return null;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);

  let uid;
  try {
    uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);
    console.log('[LSRW-AUTH-TRACE] ensureAnonymousSignIn() SUCCEEDED', { studentId: activeProfile.studentId, slotIndex, uid });
  } catch (error) {
    console.error('[LSRW-AUTH-TRACE] ensureAnonymousSignIn() THREW \u2014 the real Firebase error:', error.code, error.message, error);
    throw error;
  }

  const authForSlot = studentAuthService.getAuthForSlot(slotIndex);
  console.log('[LSRW-AUTH-TRACE] Immediately before listGoalsForStudent()', {
    activeStudentId: activeProfile.studentId,
    slotIndex,
    firebaseAppName: authForSlot.app?.name,
    authCurrentUserUid: authForSlot.currentUser?.uid ?? null,
    firestoreAppName: db.app?.name,
    uidPassedToQuery: uid,
  });

  const goals = await goalsRepository.listGoalsForStudent(db, activeProfile.classroomId, {
    studentId: activeProfile.studentId,
    cycleId: cycle.id,
    uid,
  });

  const categories = goalService.listCategories(cycle).map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    goal: goals.find((g) => g.categoryId === category.id) ?? null,
  }));

  return { cycleId: cycle.id, cycleTitle: cycle.title, startDate: cycle.startDate, endDate: cycle.endDate, categories };
}

/**
 * Submits (or edits) the current student's own goal for one category
 * — writes through THIS student's own per-slot Firestore instance, so
 * request.auth.uid on the wire is genuinely their own linked identity.
 *
 * Returns true on success. On a genuine failure (including a real
 * permission-denied — e.g. this device's slot was never actually
 * enrolled), returns false and logs the real error; per explicit
 * product decision for this feature, the caller (the view) is
 * expected to treat a false return as "did not persist," never
 * assume success.
 */
export async function submitGoalForCurrentStudent(categoryId, text) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return false;

  const classroom = await workspaceService.getClassroomOnce(activeProfile.classroomId);
  const cycle = classroom && goalService.getActiveCycle(classroom);
  if (!cycle) return false;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return false;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  try {
    await goalsRepository.submitGoal(db, {
      classroomId: activeProfile.classroomId,
      studentId: activeProfile.studentId,
      cycleId: cycle.id,
      categoryId,
      text,
      uid,
    });
    return true;
  } catch (error) {
    console.error('[studentGoalsService] submitGoalForCurrentStudent() failed \u2014 the write was rejected:', error);
    return false;
  }
}

/** Teacher-side — every goal awaiting approval within one specific classroom's own cycle. Uses the teacher's own default-app Firestore instance. */
export async function getPendingApprovalGoalsForClassroom(classroomId, cycleId) {
  return goalsRepository.listPendingGoalsForCycle(classroomId, cycleId);
}

/** Teacher-side — every goal, any status, within one specific classroom's own cycle — used to compute "who hasn't submitted everything yet," where an already-approved goal still counts as submitted. */
export async function getAllGoalsForClassroom(classroomId, cycleId) {
  return goalsRepository.listAllGoalsForCycle(classroomId, cycleId);
}

/** Teacher-side — one specific student's own goal for one category, within one cycle. Used by StudentProfileView.js's own Goals section. */
export async function getGoalForStudent(classroomId, cycleId, categoryId, studentId) {
  const goals = await goalsRepository.listGoalsForStudent(teacherFirestore(), classroomId, { studentId, cycleId });
  return goals.find((g) => g.categoryId === categoryId) ?? null;
}

/** Teacher-side — approves one goal by id. */
export async function approveGoal(classroomId, goalId) {
  await goalsRepository.approveGoal(classroomId, goalId);
}
