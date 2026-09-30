/**
 * services/taskService.js
 *
 * "My Work" Task creation + content mutation — the Task equivalent of
 * services/chapterPlanService.js, field-renamed onto models/Task.js's
 * own, much simpler shape (no review lifecycle at all — see that
 * model's own header comment for why). Every mutator here follows the
 * exact same "mutate-then-caller-saves" convention every other service
 * in this app already uses: nothing here calls
 * repositories/taskRepository.js itself; the caller (a future UI phase)
 * does that once, after whichever mutation just ran.
 *
 * Pure and Firestore-free, matching every other domain-logic service in
 * this app (e.g. services/weeklyPlanValidationService.js's own header
 * comment on why) — this file never imports repositories/taskRepository.js,
 * so it stays directly unit-testable under plain `node --test`.
 *
 * Deliberately does NOT check ownership/authorization here (is the
 * caller actually this Task's own `ownerUid`) — same precedent
 * services/chapterPlanService.js's own header comment already
 * establishes: that class of check stays exactly where this app's
 * Firestore rules already put it (see firestore.rules' own
 * `users/{uid}/tasks` block), never duplicated in a content mutator
 * that has no uid in hand to check it against without inventing a
 * second authorization path.
 *
 * Deliberately does NOT include any Today/This Week ranking, filtering,
 * or "what should I work on now" logic — that belongs to whichever
 * future phase actually builds those views, over concrete UI needs this
 * phase doesn't have yet. This file is the data layer only: creation,
 * field-level mutation, and the small set of pure derivations
 * (resolveDueDate, getEffortLabel) needed for those fields to mean
 * anything at all.
 */

import {
  createTask,
  createTaskSubtask,
  createTaskContextRef,
  getTaskSubtaskIndex,
  findTaskSubtask,
  TASK_STATUS,
  TASK_PRIORITY,
  TASK_DUE_TYPE,
  TASK_EFFORT_PRESETS,
} from '../models/Task.js';
import { getCurrentIsoDate, getTodayDateKey, getMondayStartOfWeek, shiftDateKey } from '../utils/dateHelpers.js';

function touch(task) {
  task.updatedAt = getCurrentIsoDate();
}

function isBlank(value) {
  return !value || !String(value).trim();
}

function assertValidPriority(priority) {
  if (!Object.values(TASK_PRIORITY).includes(priority)) {
    throw new Error(`"${priority}" is not a valid priority — must be one of: ${Object.values(TASK_PRIORITY).join(', ')}.`);
  }
}

function assertValidDueType(dueType) {
  if (!Object.values(TASK_DUE_TYPE).includes(dueType)) {
    throw new Error(`"${dueType}" is not a valid due-date type — must be one of: ${Object.values(TASK_DUE_TYPE).join(', ')}.`);
  }
}

function assertValidContextRef(contextRef) {
  if (isBlank(contextRef.entityType)) throw new Error('A context reference needs an entityType.');
  if (isBlank(contextRef.entityId)) throw new Error('A context reference needs an entityId.');
}

// ---------------------------------------------------------------------
// Due-date resolution — the ONE place a `dueType` becomes an actual
// "YYYY-MM-DD" dueDate. Never reads the clock itself (`todayDateKey` is
// always supplied by the caller, defaulting to utils/dateHelpers.js's
// own getTodayDateKey() — the exact real helper, never
// getCurrentIsoDate()'s full timestamp, matching the fix already made
// elsewhere in this app for this precise mismatch).
// ---------------------------------------------------------------------

/**
 * `{ dueType, dueDate }` for the four label-driven types; CUSTOM passes
 * `customDate` straight through (throws if missing — a CUSTOM due type
 * with no actual date is a genuine caller mistake, not a silently
 * accepted null); NONE always resolves to `dueDate: null`. THIS_WEEK
 * resolves to the Friday of the current school week (Monday start + 4
 * days), matching the "Mon-Fri" week convention already established by
 * services/weeklyPlanGridService.js/services/chapterPlanProgressService.js's
 * own getChapterPlanWeeks() — "due this week" means "by the end of this
 * week," not "sometime in a 7-day span starting today."
 */
export function resolveDueDate(dueType, { customDate = null, todayDateKey = getTodayDateKey() } = {}) {
  assertValidDueType(dueType);

  if (dueType === TASK_DUE_TYPE.TODAY) return { dueType, dueDate: todayDateKey };
  if (dueType === TASK_DUE_TYPE.TOMORROW) return { dueType, dueDate: shiftDateKey(todayDateKey, 1) };
  if (dueType === TASK_DUE_TYPE.THIS_WEEK) return { dueType, dueDate: shiftDateKey(getMondayStartOfWeek(todayDateKey), 4) };
  if (dueType === TASK_DUE_TYPE.CUSTOM) {
    if (isBlank(customDate)) throw new Error('A custom due date needs an actual date.');
    return { dueType, dueDate: customDate };
  }
  return { dueType, dueDate: null }; // NONE
}

/**
 * A suggested display label only — see models/Task.js's own
 * TASK_EFFORT_PRESETS header comment. `null` for a Task with no
 * estimate yet, never a fabricated default. Boundaries: up to 20
 * minutes reads as "Quick," up to 60 as "Medium," anything longer as
 * "Deep Work" — chosen to straddle the spec's own "~15 min / ~30-60 min
 * / 1-2+ hours" examples without hard-coding to exactly three values.
 */
export function getEffortLabel(estimatedMinutes) {
  if (estimatedMinutes === null || estimatedMinutes === undefined) return null;
  if (estimatedMinutes <= 20) return 'Quick';
  if (estimatedMinutes <= 60) return 'Medium';
  return 'Deep Work';
}

// ---------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------

/**
 * Validates and builds a brand-new, TODO-status Task — the one place
 * this app decides what's genuinely required to create one. Required:
 * `ownerUid` and `title` only — per explicit "low friction, don't make
 * users fill in many fields before capturing a thought" product
 * direction, everything else (description, workspace, priority, due
 * date, estimate, contextRef) is entirely optional and left at
 * models/Task.js's own defaults when omitted.
 */
export function createTaskDraft({
  ownerUid,
  title,
  description,
  workspace = null,
  priority,
  dueType,
  customDueDate,
  estimatedMinutes = null,
  contextRef = null,
  todayDateKey = getTodayDateKey(),
} = {}) {
  if (isBlank(ownerUid)) throw new Error('A Task needs an ownerUid.');
  if (isBlank(title)) throw new Error('A Task needs a title.');
  if (priority !== undefined) assertValidPriority(priority);
  if (contextRef) assertValidContextRef(contextRef);
  // Normalized through the model's own factory (never stored raw) so a
  // caller who omits classroomId still gets the model's own explicit
  // `null` default, not a missing key.
  const normalizedContextRef = contextRef ? createTaskContextRef(contextRef) : null;

  const due = dueType !== undefined ? resolveDueDate(dueType, { customDate: customDueDate, todayDateKey }) : {};

  return createTask({
    ownerUid,
    title,
    description,
    workspace,
    priority,
    estimatedMinutes,
    contextRef: normalizedContextRef,
    ...due,
  });
}

// ---------------------------------------------------------------------
// Field mutators
// ---------------------------------------------------------------------

export function updateTitle(task, title) {
  if (isBlank(title)) throw new Error('A Task needs a title.');
  task.title = title;
  touch(task);
}

export function updateDescription(task, description) {
  task.description = description;
  touch(task);
}

export function updateWorkspace(task, workspace) {
  task.workspace = workspace;
  touch(task);
}

export function updatePriority(task, priority) {
  assertValidPriority(priority);
  task.priority = priority;
  touch(task);
}

/** Reschedules a Task — the one place `dueType`/`dueDate` are ever changed together, via the same resolveDueDate() creation itself uses, so the two fields can never drift out of sync with each other. */
export function updateDueDate(task, { dueType, customDate, todayDateKey = getTodayDateKey() } = {}) {
  const { dueType: resolvedType, dueDate } = resolveDueDate(dueType, { customDate, todayDateKey });
  task.dueType = resolvedType;
  task.dueDate = dueDate;
  touch(task);
}

export function updateEstimatedMinutes(task, estimatedMinutes) {
  if (estimatedMinutes !== null && (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 0)) {
    throw new Error('estimatedMinutes must be null or a non-negative number.');
  }
  task.estimatedMinutes = estimatedMinutes;
  touch(task);
}

// ---------------------------------------------------------------------
// Status transitions — deliberately simple, direct setters (see
// models/Task.js's own header comment on why there is no review-style
// state machine here). `completedAt` is set/cleared exactly alongside
// DONE, never independently.
// ---------------------------------------------------------------------

export function markInProgress(task) {
  task.status = TASK_STATUS.IN_PROGRESS;
  touch(task);
}

export function markComplete(task) {
  task.status = TASK_STATUS.DONE;
  task.completedAt = getCurrentIsoDate();
  touch(task);
}

/** Un-completes or un-archives a Task back to the ordinary TODO state — the one way a user can recover from either "mark complete" or "archive" without deleting and recreating. */
export function reopenTask(task) {
  task.status = TASK_STATUS.TODO;
  task.completedAt = null;
  touch(task);
}

export function archiveTask(task) {
  task.status = TASK_STATUS.ARCHIVED;
  touch(task);
}

// ---------------------------------------------------------------------
// Subtasks — same add/update/remove shape services/timetableLessonService.js's
// own Lesson-objective mutators already establish for an identical
// {id, text}-shaped array.
// ---------------------------------------------------------------------

export function addSubtask(task, title = '') {
  const subtask = createTaskSubtask({ title });
  task.subtasks = [...(task.subtasks || []), subtask];
  touch(task);
  return subtask;
}

export function removeSubtask(task, subtaskId) {
  const before = (task.subtasks || []).length;
  task.subtasks = (task.subtasks || []).filter((subtask) => subtask.id !== subtaskId);
  if (task.subtasks.length < before) touch(task);
}

export function toggleSubtask(task, subtaskId) {
  const subtask = findTaskSubtask(task, subtaskId);
  if (!subtask) return;
  subtask.done = !subtask.done;
  touch(task);
}

export { getTaskSubtaskIndex, findTaskSubtask };

// ---------------------------------------------------------------------
// Context reference — see models/Task.js's own header comment. Never
// creates, fetches, or mutates the referenced entity itself; a purely
// lightweight association operation, same shape as
// services/chapterPlanService.js's own addResourceLink()/addSparkRef().
// ---------------------------------------------------------------------

export function setContextRef(task, { entityType, entityId, classroomId = null } = {}) {
  const contextRef = createTaskContextRef({ entityType, entityId, classroomId });
  assertValidContextRef(contextRef);
  task.contextRef = contextRef;
  touch(task);
}

export function clearContextRef(task) {
  task.contextRef = null;
  touch(task);
}

export { TASK_EFFORT_PRESETS };
