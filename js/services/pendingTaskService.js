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
 * The three "work_request_*" checkers are now an internal adapter over
 * services/workTypes/NotebookWorkType.js — see this file's own
 * getWorkRequestItemsBySubtitle() below for exactly how. This is a pure
 * internal implementation change: NotebookWorkType now owns the actual
 * notebook lifecycle logic (composing workRequestService.js directly,
 * per the frozen Work Type architecture), and this file's own public
 * output shape — { requestId, description, count } per item, three
 * separately-registered task-type ids — is completely unchanged, so
 * PendingTasksWidget.js and main.js's own dispatch function continue
 * working exactly as before, with zero changes to either. The
 * migration is invisible to both.
 *
 * Definitions (judgment calls, documented since "pending" is inherently
 * a bit subjective):
 *   - "Activities awaiting completion": a Learning Activity with at
 *     least one student still at status 'Not Assigned' — the teacher
 *     hasn't finished marking the whole roster for it yet.
 */

import * as learningActivityService from './learningActivityService.js';
import { NotebookWorkType } from './workTypes/NotebookWorkType.js';
import { PENDING_TASK_TYPES } from '../config/pendingTaskTypes.js';

/**
 * The adapter: calls NotebookWorkType.getActiveWork() exactly once,
 * then translates its frozen { title, subtitle, count, navigateTo }
 * shape back into this file's own, unchanged public shape
 * ({ requestId, description, count }), filtered to whichever subtitle
 * this specific, legacy task-type id corresponds to. `requestId` is
 * recovered from `navigateTo`'s own, well-defined path shape
 * (#/classroom/{id}/work-requests/{requestId}) — a deliberate,
 * temporary adapter step that exists only because this file's own
 * callers still expect `requestId` directly; Milestone 4's own Open
 * Work redesign will consume `navigateTo` itself, generically, and
 * this adapter (along with the rest of this file) is removed then.
 */
function getWorkRequestItemsBySubtitle(classroom, subtitle) {
  return NotebookWorkType.getActiveWork(classroom)
    .filter((item) => item.subtitle === subtitle)
    .map((item) => ({
      requestId: item.navigateTo.split('/').pop(),
      description: item.title,
      count: item.count,
    }));
}

function checkWorkRequestsAwaitingSubmission(classroom) {
  return getWorkRequestItemsBySubtitle(classroom, 'Awaiting Submission');
}

function checkWorkRequestsSubmittedAwaitingReview(classroom) {
  return getWorkRequestItemsBySubtitle(classroom, 'Awaiting Review');
}

function checkWorkRequestsNeedingCorrection(classroom) {
  return getWorkRequestItemsBySubtitle(classroom, 'Needs Correction');
}

function checkActivitiesAwaitingCompletion(classroom) {
  const items = [];

  learningActivityService.listActivities(classroom).forEach((activity) => {
    const summary = learningActivityService.getActivityRosterSummary(classroom, activity.id);
    const notAssignedCount = summary['Not Assigned'] || 0;
    if (notAssignedCount > 0) {
      items.push({
        activityId: activity.id,
        description: activity.title,
        count: notAssignedCount,
      });
    }
  });

  return items;
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
