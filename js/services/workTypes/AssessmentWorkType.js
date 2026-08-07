/**
 * services/workTypes/AssessmentWorkType.js
 *
 * See workTypeContract.js for the frozen interface. Composes
 * services/assessmentService.js directly.
 *
 * getActiveWork(): a 'Draft' assessment (status !== 'Published') is
 * genuine, real, ongoing work — marks are being entered, nothing has
 * been finalized yet. This reuses Assessment's own existing `status`
 * field; no new logic, no new field.
 *
 * getStartActions(): always offers "New Assessment" — unlike Notebook
 * (scoped to a specific Subject x Type combination that either has or
 * doesn't have an open request), an Assessment has no such natural
 * key to check "is one already open for this" against; a teacher can
 * legitimately always start a new one alongside any existing Drafts.
 *
 * KNOWN GAP, flagged rather than papered over: `navigateTo` below
 * points at a route that does not exist yet in ui/router.js —
 * Assessment management today is reached only via a direct DOM swap
 * inside ui/views/DashboardView.js's own openAssessmentManagement()
 * closure, never through router.navigate(). This WorkType declares
 * the intended destination; wiring the actual route is real,
 * necessary work for whichever milestone actually replaces Pending
 * Tasks with Open Work (the Dashboard needs a working
 * router.navigate(item.navigateTo) target before this is usable end
 * to end).
 */

import * as assessmentService from '../assessmentService.js';

function getActiveWork(classroom) {
  return assessmentService
    .getAssessments(classroom)
    .filter((assessment) => assessment.status !== 'Published')
    .map((assessment) => ({
      title: assessment.title,
      subtitle: assessment.status,
      count: undefined,
      navigateTo: `/classroom/${classroom.id}/assessments/${assessment.id}`,
    }));
}

function getStartActions(classroom) {
  return [
    {
      title: 'New Assessment',
      subtitle: undefined,
      count: undefined,
      navigateTo: `/classroom/${classroom.id}/assessments/new`,
    },
  ];
}

export const AssessmentWorkType = { getActiveWork, getStartActions };
