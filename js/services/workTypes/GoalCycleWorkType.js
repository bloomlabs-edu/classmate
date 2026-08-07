/**
 * services/workTypes/GoalCycleWorkType.js
 *
 * See workTypeContract.js for the frozen interface. Composes
 * services/goalService.js directly — getPendingApprovalGoals()
 * already exists and is already correct; this file is pure wiring,
 * not new business logic.
 *
 * getActiveWork(): if the classroom has an active GoalCycle with any
 * goal awaiting approval, one item — count is the real number of
 * pending goals.
 *
 * getStartActions(): only offered when there is no active cycle —
 * goalService.js's own createNewGoalCycle() already enforces "only
 * one active cycle at a time" as an invariant; this WorkType respects
 * that same rule rather than re-deciding it.
 *
 * Same KNOWN GAP as AssessmentWorkType.js: `navigateTo` points at a
 * route ui/router.js does not yet have — Goal management today is
 * reached only via a direct DOM swap inside
 * ui/views/DashboardView.js's own openGoalManagement() closure.
 */

import * as goalService from '../goalService.js';

function getActiveWork(classroom) {
  const cycle = goalService.getActiveCycle(classroom);
  if (!cycle) return [];

  const pendingCount = goalService.getPendingApprovalGoals(cycle).length;
  if (pendingCount === 0) return [];

  return [
    {
      title: cycle.title,
      subtitle: 'Goal Approvals',
      count: pendingCount,
      navigateTo: `/classroom/${classroom.id}/goals/${cycle.id}`,
    },
  ];
}

function getStartActions(classroom) {
  const cycle = goalService.getActiveCycle(classroom);
  if (cycle) return [];

  return [
    {
      title: 'New Goal Cycle',
      subtitle: undefined,
      count: undefined,
      navigateTo: `/classroom/${classroom.id}/goals/new`,
    },
  ];
}

export const GoalCycleWorkType = { getActiveWork, getStartActions };
