/**
 * services/goalService.js
 *
 * Goal Cycle, Category, and Goal management — mirrors
 * assessmentService.js's own shape and conventions directly: plain
 * functions taking a classroom/cycle and mutating in place, no class,
 * no hidden state.
 *
 * `classroom.goalCycles` is never assumed present — defaulted at the
 * read/write boundary here, the same way studentEventService.js
 * treats `classroom.studentEvents`, since this is a brand-new field
 * on an app with many already-deployed classrooms. No migration
 * script needed; every existing classroom simply has no goal cycles
 * yet, the same way it once had no student events yet.
 *
 * Only one GoalCycle may be 'active' per classroom at a time — an
 * invariant this service enforces (createGoalCycle() automatically
 * closes any existing active cycle), not something the caller must
 * check first, the same "enforced by the service, not left to the
 * UI" split assessmentService.js's own publishAssessment() uses for
 * Assessment.status.
 *
 * Editing an already-approved Goal is an explicit future feature —
 * "the student cannot edit it" once approved, per explicit product
 * decision, and this file has no function that would let one through
 * submitGoal() once status is 'approved'.
 */

import { createGoalCycle, createGoalCategory } from '../models/GoalCycle.js';
import { createGoal } from '../models/Goal.js';

export function listGoalCycles(classroom) {
  return classroom.goalCycles || [];
}

export function getActiveCycle(classroom) {
  return listGoalCycles(classroom).find((cycle) => cycle.status === 'active') || null;
}

export function getCycleById(classroom, cycleId) {
  return listGoalCycles(classroom).find((cycle) => cycle.id === cycleId) || null;
}

/** Creates a new active cycle, automatically closing any existing active one first — enforces the "only one active cycle" invariant here, not left to the caller. */
export function createNewGoalCycle(classroom, { title, startDate, endDate, cycleType = 'custom' }) {
  if (!classroom.goalCycles) classroom.goalCycles = [];

  const currentActive = getActiveCycle(classroom);
  if (currentActive) currentActive.status = 'closed';

  const cycle = createGoalCycle({ title, startDate, endDate, cycleType });
  classroom.goalCycles.push(cycle);
  return cycle;
}

export function getClassroomStudents(classroom) {
  return classroom.teams.flatMap((team) => team.students);
}

export function listCategories(cycle) {
  return cycle.categories;
}

export function addCategory(cycle, name) {
  const category = createGoalCategory({ name });
  cycle.categories.push(category);
  return category;
}

export function renameCategory(cycle, categoryId, newName) {
  const category = cycle.categories.find((c) => c.id === categoryId);
  if (category) category.name = newName;
  return category;
}

/** Also removes every Goal (and its completions) that belonged to this category — the same cascade-delete convention notebookConfigService.js's own removeSubject() already establishes. */
export function removeCategory(cycle, categoryId) {
  const goalIdsToRemove = cycle.goals.filter((goal) => goal.categoryId === categoryId).map((goal) => goal.id);
  cycle.categories = cycle.categories.filter((c) => c.id !== categoryId);
  cycle.goals = cycle.goals.filter((goal) => goal.categoryId !== categoryId);
  goalIdsToRemove.forEach((goalId) => {
    delete cycle.completions[goalId];
  });
}

export function getGoalForStudent(cycle, categoryId, studentId) {
  return cycle.goals.find((goal) => goal.categoryId === categoryId && goal.studentId === studentId) || null;
}

export function getGoalById(cycle, goalId) {
  return cycle.goals.find((goal) => goal.id === goalId) || null;
}

/** Every goal this student has (across every category) in this cycle — used by both the student's own goal setup screen and the teacher dashboard's per-student detail. */
export function getGoalsForStudent(cycle, studentId) {
  return cycle.goals.filter((goal) => goal.studentId === studentId);
}

/**
 * Creates a new goal, or updates an existing pending one — refuses to
 * touch an already-approved goal at all ("the student cannot edit it"
 * once approved). Returns the goal on success, or null if refused.
 */
export function submitGoal(cycle, categoryId, studentId, text) {
  const existing = getGoalForStudent(cycle, categoryId, studentId);
  if (existing) {
    if (existing.status === 'approved') return null;
    existing.text = text;
    return existing;
  }
  const goal = createGoal({ categoryId, studentId, text });
  cycle.goals.push(goal);
  return goal;
}

export function approveGoal(cycle, goalId) {
  const goal = getGoalById(cycle, goalId);
  if (goal) goal.status = 'approved';
  return goal;
}

/** Every goal across every student currently awaiting a teacher's review. */
export function getPendingApprovalGoals(cycle) {
  return cycle.goals.filter((goal) => goal.status === 'pending_approval');
}

/** Every student on the real roster who hasn't submitted a goal for every category yet — for the teacher dashboard's "who hasn't submitted" flag. */
export function getStudentsWithoutAllGoals(classroom, cycle) {
  const categoryCount = cycle.categories.length;
  return getClassroomStudents(classroom).filter((student) => getGoalsForStudent(cycle, student.id).length < categoryCount);
}
