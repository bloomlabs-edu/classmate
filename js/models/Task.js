/**
 * models/Task.js
 *
 * "My Work" — a single, role-agnostic personal task, owned by exactly
 * one authenticated user. Deliberately NOT modeled after
 * models/WorkRequest.js (a classroom-scoped, teacher-assigned piece of
 * STUDENT work with a per-student `entries[]` submission lifecycle) —
 * a Task has no roster, no submission/review lifecycle, and no
 * classroom scope of its own at all. It belongs to a person, not a
 * classroom, the same way a real Google-authenticated `users/{uid}`
 * document already does (see services/workspaceService.js's own
 * `classroomRefs` subcollection under that same path) — `tasks` is a
 * second subcollection under that identical, already-established
 * per-uid storage location, never a new kind of scoping.
 *
 * Storage: `users/{uid}/tasks/{taskId}` (see
 * repositories/taskRepository.js) — one Firestore document per Task,
 * matching every other "own subcollection, not embedded in a growing
 * parent document" convention already used throughout this app
 * (LessonPlans, ChapterPlans, Resources, ...).
 *
 * ---------------------------------------------------------------------
 * Status — deliberately a flat, 4-value enum, not a review lifecycle
 * ---------------------------------------------------------------------
 *
 * `TASK_STATUS` covers exactly the V1 transitions the product spec asks
 * for — create (defaults to TODO), mark in progress, mark complete,
 * delete/archive — and nothing else. There is no DRAFT/SUBMITTED/
 * APPROVED review lifecycle here (unlike models/ChapterPlan.js/
 * models/LessonPlan.js): a Task is never reviewed or approved by anyone
 * but its own owner, so that entire family of concepts (reviewHistory,
 * activeComments, reviewerUid) simply doesn't apply and is not
 * reproduced here.
 *
 * A "captured"/parking-lot item (see the product spec's own "Capture"
 * section) is NOT a fifth status — it is simply an ordinary TODO-status
 * Task with only a title set and everything else left at its default
 * (no priority commitment beyond the default WHENEVER, no due date). A
 * future "Later/Captured" view is a FILTER over existing fields, never
 * a new stored state.
 *
 * ---------------------------------------------------------------------
 * Priority / due date / estimated effort — deliberately simple
 * ---------------------------------------------------------------------
 *
 * `TASK_PRIORITY` is the exact 3-value scale the spec asks for
 * (🔥 Must Do / ⭐ Important / ○ Whenever) — no numeric scale, no
 * per-priority weighting table. Defaults to WHENEVER, the lowest-
 * commitment option, so a quick, low-friction capture never forces a
 * priority decision it didn't ask for.
 *
 * `dueType` is the user-facing choice (Today/Tomorrow/This
 * Week/Custom/No deadline); `dueDate` is the actual resolved
 * "YYYY-MM-DD" dateKey (or `null` for NONE) — stored as a REAL date,
 * not just the label, so a future Today/This Week view can sort and
 * filter across every Task the same way the rest of this app already
 * sorts/filters by dateKey (see utils/dateHelpers.js), regardless of
 * which label the user originally picked. Resolving a `dueType` into
 * its actual `dueDate` is services/taskService.js's own job (see that
 * file's own resolveDueDate()) — this model never computes "today"
 * itself, matching every other model in this app (models never call
 * `new Date()`/read the clock on their own).
 *
 * `estimatedMinutes` is a plain, nullable number — per explicit product
 * direction, "store the actual estimated minutes rather than only the
 * labels." `TASK_EFFORT_PRESETS` below is only a suggested vocabulary
 * (Quick/Medium/Deep Work) a future UI can offer as quick-pick buttons;
 * it is never enforced by this model — any positive number of minutes
 * is a valid `estimatedMinutes`.
 *
 * ---------------------------------------------------------------------
 * Subtasks — same "array position is order" convention as everywhere
 * else in this app (models/LessonPlan.js's own `activities[]`,
 * models/LearningUnit.js's own `concepts[]`) — no separate `order`
 * field to keep in sync. A Task is never required to have any.
 * ---------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------
 * `contextRef` — reference, never copy, following the EXACT convention
 * models/ChapterPlanResourceLink.js/models/ChapterPlanSparkRef.js
 * already establish
 * ---------------------------------------------------------------------
 *
 * `{ entityType, entityId, classroomId }` — `entityType` is a plain,
 * open-ended string (e.g. `'lesson'`, `'lessonPlan'`, `'chapterPlan'`,
 * `'assessment'`), deliberately NOT a closed enum here: per explicit
 * product direction, "the task system should remain loosely coupled,"
 * and new linkable ClassMate entity types will be added by future
 * phases without ever needing a schema change to this field. `entityId`
 * is that entity's own real id — never a copy of its title, status, or
 * any other content; resolving what the reference actually points to
 * always means a real fetch through that entity's own existing
 * repository, exactly like resolving a ChapterPlanSparkRef always means
 * fetching the real Spark. `classroomId` is included ONLY when the
 * referenced entity type is itself classroom-scoped and its id alone
 * would otherwise be ambiguous (the same reasoning
 * ChapterPlanResourceLink's own header comment gives for why IT carries
 * `classroomId` but ChapterPlanSparkRef does not) — `null` for a
 * top-level entity type. This model does not maintain a registry of
 * which entity types require `classroomId`; that decision belongs to
 * whichever future phase actually introduces entity-linking UI for a
 * specific type, the same way ChapterPlanResourceLink's own convention
 * was decided per-type, not from an abstract rule.
 *
 * A Task's own `contextRef` is entirely optional — a Task always stands
 * on its own without one.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export const TASK_STATUS = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  ARCHIVED: 'archived',
});

export const TASK_PRIORITY = Object.freeze({
  MUST_DO: 'must_do',
  IMPORTANT: 'important',
  WHENEVER: 'whenever',
});

export const TASK_DUE_TYPE = Object.freeze({
  TODAY: 'today',
  TOMORROW: 'tomorrow',
  THIS_WEEK: 'this_week',
  CUSTOM: 'custom',
  NONE: 'none',
});

/**
 * A suggested vocabulary only — see this file's own header comment.
 * Values are minutes, matching the spec's own "~15 min / ~30-60 min /
 * 1-2+ hours" examples with one representative number per band; a
 * future UI is free to offer these as quick-pick buttons, but
 * `estimatedMinutes` itself is never restricted to exactly these three
 * values.
 */
export const TASK_EFFORT_PRESETS = Object.freeze({
  QUICK: 15,
  MEDIUM: 45,
  DEEP_WORK: 90,
});

/** One subtask — `{id, title, done}`, same minimal shape as every other checklist-style item in this app. Order is array position, never a separate field. */
export function createTaskSubtask({ id, title = '', done = false } = {}) {
  return {
    id: id || generateId(),
    title,
    done,
  };
}

/** A lightweight, reference-only pointer to an existing ClassMate entity — see this file's own header comment for why this never copies the referenced entity's own content. */
export function createTaskContextRef({ entityType, entityId, classroomId = null } = {}) {
  return { entityType, entityId, classroomId };
}

export function createTask({
  id,
  ownerUid,
  title = '',
  description = '',
  workspace = null,
  priority = TASK_PRIORITY.WHENEVER,
  status = TASK_STATUS.TODO,
  dueType = TASK_DUE_TYPE.NONE,
  dueDate = null,
  estimatedMinutes = null,
  completedAt = null,
  subtasks = [],
  contextRef = null,
  createdAt,
  updatedAt,
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    ownerUid,
    title,
    description,
    workspace,
    priority,
    status,
    dueType,
    dueDate,
    estimatedMinutes,
    completedAt,
    subtasks,
    contextRef,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}

/** The index of one subtask by its own id, or -1 — the one place every subtasks-array mutation in taskService.js should look this up, mirroring models/LessonPlan.js's own getLessonPlanActivityIndex(). */
export function getTaskSubtaskIndex(task, subtaskId) {
  return (task.subtasks || []).findIndex((subtask) => subtask.id === subtaskId);
}

/** One subtask by its own id, or null. */
export function findTaskSubtask(task, subtaskId) {
  return (task.subtasks || []).find((subtask) => subtask.id === subtaskId) || null;
}

/** `{ completed, total }` — the minimum needed to "show progress without requiring every task to have subtasks" per explicit product direction; `total === 0` for a Task with no subtasks, never an error. */
export function getSubtaskProgress(task) {
  const subtasks = task.subtasks || [];
  return {
    completed: subtasks.filter((subtask) => subtask.done).length,
    total: subtasks.length,
  };
}
