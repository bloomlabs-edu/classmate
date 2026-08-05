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
 * Definitions (judgment calls, documented since "pending" is inherently
 * a bit subjective):
 *   - The three "work_request_*" checkers below deliberately query
 *     services/workRequestService.js's own workflow state directly —
 *     "awaiting submission," "submitted, awaiting review," and "needs
 *     correction" are each just getEntriesByStatus() on every currently
 *     open WorkRequest. This replaces the previous "Notebook not
 *     checked today" check, which fired on a fixed calendar cadence
 *     (zero register entries for today's date) that never matched how
 *     notebook cycles actually work in a real classroom — irregular,
 *     teacher-driven, averaging closer to two weeks than one day. There
 *     is no calendar date involved in any of these three checks at all,
 *     by design: a WorkRequest's own state already answers the
 *     question directly, with nothing to reconstruct from a date range.
 *   - "Activities awaiting completion": a Learning Activity with at
 *     least one student still at status 'Not Assigned' — the teacher
 *     hasn't finished marking the whole roster for it yet.
 */

import * as learningActivityService from './learningActivityService.js';
import * as workRequestService from './workRequestService.js';
import { PENDING_TASK_TYPES } from '../config/pendingTaskTypes.js';

function checkWorkRequestsByStatus(classroom, statuses) {
  const items = [];
  workRequestService
    .listWorkRequests(classroom)
    .filter((request) => workRequestService.isOpen(request))
    .forEach((request) => {
      const count = statuses.reduce((sum, status) => sum + workRequestService.getEntriesByStatus(request, status).length, 0);
      if (count > 0) {
        items.push({ requestId: request.id, description: request.title, count });
      }
    });
  return items;
}

function checkWorkRequestsAwaitingSubmission(classroom) {
  return checkWorkRequestsByStatus(classroom, ['assigned']);
}

function checkWorkRequestsSubmittedAwaitingReview(classroom) {
  return checkWorkRequestsByStatus(classroom, ['submitted', 'resubmitted']);
}

function checkWorkRequestsNeedingCorrection(classroom) {
  return checkWorkRequestsByStatus(classroom, ['needs_correction']);
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
