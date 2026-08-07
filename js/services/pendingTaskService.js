/**
 * services/pendingTaskService.js
 *
 * Runs every checker registered below against a classroom and returns
 * what's outstanding — the data the Classroom Dashboard's Pending Tasks
 * widget renders. Read-only, same as
 * services/studentProgressService.js: nothing here writes to Firestore.
 *
 * Each checker is keyed by a config/pendingTaskTypes.js id. Adding a new
 * task type later means adding one entry to that config file and one
 * new checker function here — getPendingTasks() picks it up
 * automatically, no widget changes needed.
 *
 * Every checker below is now a thin adapter over the frozen WorkType
 * architecture (see services/workTypes/index.js) — this file contains
 * zero duplicated notebook or activity logic of its own. Both
 * NotebookWorkType and LearningActivityWorkType now own their actual
 * business logic, composing workRequestService.js/
 * learningActivityService.js directly; this file's own job is purely
 * translating their frozen { title, subtitle, count, navigateTo }
 * shape back into this file's own, unchanged public shape (per
 * task-type id) — the exact shape PendingTasksWidget.js and main.js's
 * own dispatch function already expect, with zero changes to either.
 * `requestId`/`activityId` are recovered from `navigateTo`'s own,
 * well-defined path shape. This adapter (and the rest of this file)
 * is removed once Open Work replaces Pending Tasks entirely and
 * consumes `navigateTo` itself, generically.
 */

import { NotebookWorkType } from './workTypes/NotebookWorkType.js';
import { LearningActivityWorkType } from './workTypes/LearningActivityWorkType.js';
import { PENDING_TASK_TYPES } from '../config/pendingTaskTypes.js';

/**
 * The one, shared adapter every checker below uses — calls a given
 * WorkType's own getActiveWork() exactly once, optionally filters to
 * one specific subtitle (Notebook's three separate task-type ids each
 * correspond to one subtitle; Activities has only one, so `subtitle`
 * is omitted there), and maps the result back into this file's own
 * legacy shape under whichever id key the caller (main.js's own route
 * dispatch) still expects.
 */
function getWorkTypeItemsAsPendingTasks(workType, classroom, idKey, subtitle) {
  return workType
    .getActiveWork(classroom)
    .filter((item) => !subtitle || item.subtitle === subtitle)
    .map((item) => ({
      [idKey]: item.navigateTo.split('/').pop(),
      description: item.title,
      count: item.count,
    }));
}

function checkWorkRequestsAwaitingSubmission(classroom) {
  return getWorkTypeItemsAsPendingTasks(NotebookWorkType, classroom, 'requestId', 'Awaiting Submission');
}

function checkWorkRequestsSubmittedAwaitingReview(classroom) {
  return getWorkTypeItemsAsPendingTasks(NotebookWorkType, classroom, 'requestId', 'Awaiting Review');
}

function checkWorkRequestsNeedingCorrection(classroom) {
  return getWorkTypeItemsAsPendingTasks(NotebookWorkType, classroom, 'requestId', 'Needs Correction');
}

function checkActivitiesAwaitingCompletion(classroom) {
  return getWorkTypeItemsAsPendingTasks(LearningActivityWorkType, classroom, 'activityId', null);
}

const CHECKERS = {
  work_request_awaiting_submission: checkWorkRequestsAwaitingSubmission,
  work_request_submitted_awaiting_review: checkWorkRequestsSubmittedAwaitingReview,
  work_request_needs_correction: checkWorkRequestsNeedingCorrection,
  activity_awaiting_completion: checkActivitiesAwaitingCompletion,
};

/**
 * Runs every registered checker and returns one entry per task type that
 * found anything outstanding — task types with nothing pending are
 * omitted entirely, so the (future) widget only ever has to render "here's
 * what's outstanding," never an empty/zero-count group.
 */
export function getPendingTasks(classroom) {
  return PENDING_TASK_TYPES.map((taskType) => {
    const checker = CHECKERS[taskType.id];
    const items = checker ? checker(classroom) : [];
    return { ...taskType, items };
  }).filter((group) => group.items.length > 0);
}
