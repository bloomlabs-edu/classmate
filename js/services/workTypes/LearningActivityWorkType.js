/**
 * services/workTypes/LearningActivityWorkType.js
 *
 * See workTypeContract.js for the frozen interface. Composes
 * services/learningActivityService.js directly.
 *
 * getActiveWork(): an activity with any student still at 'Not
 * Assigned' — the teacher hasn't finished marking the whole roster
 * yet. This is the exact same condition
 * services/pendingTaskService.js's own (now-legacy, soon to be
 * migrated the same way NotebookWorkType.js already was)
 * checkActivitiesAwaitingCompletion() already checked — moved here
 * verbatim, not reinvented.
 *
 * getStartActions(): always offers "New Learning Activity" — like
 * Assessment, there's no natural "already open for this" key to
 * check against.
 *
 * Unlike AssessmentWorkType.js/GoalCycleWorkType.js, `navigateTo`
 * below points at a route that genuinely exists today
 * (#/classroom/{id}/activities/{activityId}, confirmed directly in
 * main.js's own route dispatch) — this one is fully wired, end to
 * end, right now.
 */

import * as learningActivityService from '../learningActivityService.js';

function getActiveWork(classroom) {
  return learningActivityService
    .listActivities(classroom)
    .filter((activity) => activity.pinnedToDashboard)
    .map((activity) => ({
      activity,
      notAssignedCount: learningActivityService.getActivityRosterSummary(classroom, activity.id)['Not Assigned'] || 0,
    }))
    .filter(({ notAssignedCount }) => notAssignedCount > 0)
    .map(({ activity, notAssignedCount }) => ({
      title: activity.title,
      subtitle: 'Awaiting Completion',
      count: notAssignedCount,
      navigateTo: `/classroom/${classroom.id}/activities/${activity.id}`,
    }));
}

function getStartActions(classroom) {
  return [
    {
      title: 'New Learning Activity',
      subtitle: undefined,
      count: undefined,
      navigateTo: `/classroom/${classroom.id}/activities`,
    },
  ];
}

export const LearningActivityWorkType = { getActiveWork, getStartActions };
