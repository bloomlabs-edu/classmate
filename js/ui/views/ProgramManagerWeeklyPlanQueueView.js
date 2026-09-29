/**
 * ui/views/ProgramManagerWeeklyPlanQueueView.js
 *
 * The Program Manager's weekend review queue for NEXT week's Weekly
 * Plans — genuinely distinct from ui/views/ProgramManagerObservationsView.js
 * (which reviews individually-submitted, date/period-scoped detailed
 * LessonPlans; see that file's own header comment on the rename). This
 * view lists every Fellow across every classroom the PM belongs to,
 * with that Fellow's own derived Weekly Plan status for the target
 * week (see services/weeklyPlanSubmissionService.js's own
 * getWeekPlanDisplayStatus()) — Not started/Draft/Submitted/
 * Resubmitted/Changes requested/Approved, never a second status model.
 * Deliberately shows every status, not just SUBMITTED — a PM's weekend
 * review needs to see who hasn't submitted at all, not only who has.
 *
 * Opening any row (Review or View) always goes to the SAME
 * ui/views/WeeklyPlanReviewView.js — that view's own capability checks
 * (canReviewWeeklyPlanSubmission/canApproveWeeklyPlanSubmission) decide
 * what actions actually show, never this queue.
 *
 * `classrooms` is the exact same already-in-hand
 * `workspaceService.getState().classrooms` every other classroom-
 * agnostic PM route already reads (see
 * ui/views/ProgramManagerObservationsView.js's own header comment for
 * why that reuse is deliberate, not a shortcut).
 */

import { MEMBER_ROLES } from '../../config/memberRoles.js';
import * as weeklyPlanSubmissionRepository from '../../repositories/weeklyPlanSubmissionRepository.js';
import * as scheduledEventRepository from '../../services/scheduledEventRepository.js';
import * as plannerRepository from '../../services/plannerRepository.js';
import { buildWeeklyPlanGrid, getLessonsFromWeeklyPlanGrid } from '../../services/weeklyPlanGridService.js';
import {
  getWeekPlanDisplayStatus,
  getWeeklyPlanSubmissionLabel,
  WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED,
} from '../../services/weeklyPlanSubmissionService.js';
import { WEEKLY_PLAN_SUBMISSION_STATUS } from '../../models/WeeklyPlanSubmission.js';
import { getMondayStartOfWeek, shiftDateKey, formatWeekDateRange, getTodayDateKey } from '../../utils/dateHelpers.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

const STATUS_LABELS = {
  [WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED]: 'Not started',
  [WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT]: 'Draft',
  [WEEKLY_PLAN_SUBMISSION_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [WEEKLY_PLAN_SUBMISSION_STATUS.APPROVED]: 'Approved',
};

function getStatusLabel(displayStatus, submission) {
  if (displayStatus === WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED) return getWeeklyPlanSubmissionLabel(submission);
  return STATUS_LABELS[displayStatus] || displayStatus;
}

/** Next Monday relative to today — the target week a weekend PM review is for. If today already IS a Monday-through-Friday of the "current" week, this still means NEXT week, matching "reviewed every weekend, for the week ahead." */
function getNextWeekStartDate() {
  // getMondayStartOfWeek() expects a plain "YYYY-MM-DD" dateKey, never
  // getCurrentIsoDate()'s full ISO timestamp (that mismatch produced a
  // deployed "Invalid Date NaN-NaN" defect — see getTodayDateKey()'s
  // own doc comment for why it's the correct helper here).
  const thisWeekStart = getMondayStartOfWeek(getTodayDateKey());
  return shiftDateKey(thisWeekStart, 7);
}

/** Every real Fellow (TEACHER or OWNER — both actually teach, per config/memberRoles.js) in `classroom`, excluding the PM themselves. */
function getFellowsForClassroom(classroom) {
  return Object.entries(classroom.members || {})
    .filter(([, member]) => member.role === MEMBER_ROLES.TEACHER || member.role === MEMBER_ROLES.OWNER)
    .map(([uid, member]) => ({ uid, displayName: member.displayName }));
}

export function renderProgramManagerWeeklyPlanQueueView(container, { classrooms, currentUser, onBack, onOpenWeeklyPlanReview }) {
  let rows = null; // null = loading
  let loadError = null;
  const weekStartDate = getNextWeekStartDate();

  const pmClassrooms = classrooms.filter((classroom) => classroom.members?.[currentUser?.uid]?.role === MEMBER_ROLES.PROGRAM_MANAGER);

  function rerender() {
    renderQueue(container, { weekStartDate, rows, loadError }, { onBack, onOpenWeeklyPlanReview });
  }

  rerender();

  (async () => {
    try {
      const classroomIds = pmClassrooms.map((classroom) => classroom.id);
      const submissions = await weeklyPlanSubmissionRepository.getSubmissionsForClassroomIdsAndWeek(classroomIds, weekStartDate);
      const submissionByKey = new Map(submissions.map((submission) => [`${submission.classroomId}_${submission.teacherUid}`, submission]));

      const fellowEntries = pmClassrooms.flatMap((classroom) =>
        getFellowsForClassroom(classroom).map((fellow) => ({ classroom, fellow }))
      );

      const weekEndDate = shiftDateKey(weekStartDate, 4);
      rows = await Promise.all(
        fellowEntries.map(async ({ classroom, fellow }) => {
          const submission = submissionByKey.get(`${classroom.id}_${fellow.uid}`) || null;
          let displayStatus = submission ? submission.status : WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED;
          if (!submission) {
            const [events, lessons] = await Promise.all([
              scheduledEventRepository.getScheduledEventsForDateRange(classroom.id, weekStartDate, weekEndDate),
              plannerRepository.getLessonsForDateRange(classroom.id, weekStartDate, weekEndDate),
            ]);
            const grid = buildWeeklyPlanGrid(classroom, { events, lessons, teacherUid: fellow.uid, weekStartDate });
            displayStatus = getWeekPlanDisplayStatus(null, getLessonsFromWeeklyPlanGrid(grid));
          }
          return { classroom, fellow, submission, displayStatus };
        })
      );
      loadError = null;
    } catch (error) {
      console.error('[ProgramManagerWeeklyPlanQueueView] Failed to load Weekly Plans:', error);
      loadError = "Couldn't load Weekly Plans. Check your connection and try again.";
    }
    rerender();
  })();
}

function renderQueue(container, { weekStartDate, rows, loadError }, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'lesson-plan-review-queue';

  const header = document.createElement('header');
  header.className = 'lesson-plan-review-queue__header';
  header.appendChild(createBackButton(handlers.onBack));

  const title = document.createElement('h1');
  title.className = 'lesson-plan-review-queue__title';
  title.textContent = 'Weekly Plans';
  header.appendChild(title);
  wrapper.appendChild(header);

  const subtitle = document.createElement('p');
  subtitle.className = 'lesson-plan-review-queue__subtitle';
  subtitle.textContent = `Review your Fellows' plans for the week of ${formatWeekDateRange(weekStartDate)}.`;
  wrapper.appendChild(subtitle);

  if (loadError) {
    const error = document.createElement('p');
    error.className = 'lesson-plan-review-queue__error';
    error.textContent = loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (rows === null) {
    const loading = document.createElement('p');
    loading.className = 'lesson-plan-review-queue__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lesson-plan-review-queue__empty';
    empty.appendChild(createIcon('check-circle-2', { size: 20 }));
    const text = document.createElement('span');
    text.textContent = "No Fellows found across the classrooms you review.";
    empty.appendChild(text);
    wrapper.appendChild(empty);
    container.appendChild(wrapper);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lesson-plan-review-queue__rows';
  rows.forEach(({ classroom, fellow, submission, displayStatus }) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lesson-plan-review-queue__row';
    row.addEventListener('click', () => handlers.onOpenWeeklyPlanReview(classroom.id, fellow.uid, weekStartDate));

    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-plan-review-queue__row-text';

    const rowTitle = document.createElement('span');
    rowTitle.className = 'lesson-plan-review-queue__row-title';
    rowTitle.textContent = fellow.displayName || 'A Fellow';
    textWrap.appendChild(rowTitle);

    const classroomMeta = document.createElement('span');
    classroomMeta.className = 'lesson-plan-review-queue__row-meta';
    classroomMeta.textContent = classroom.name || 'A classroom';
    textWrap.appendChild(classroomMeta);

    row.appendChild(textWrap);

    const badge = document.createElement('span');
    badge.className = 'lesson-plan-review-queue__status-badge';
    badge.textContent = getStatusLabel(displayStatus, submission);
    row.appendChild(badge);

    const actionLabel = document.createElement('span');
    actionLabel.className = 'lesson-plan-review-queue__row-action';
    actionLabel.textContent =
      displayStatus === WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED || displayStatus === WEEKLY_PLAN_SUBMISSION_STATUS.CHANGES_REQUESTED
        ? 'Review'
        : 'View';
    row.appendChild(actionLabel);

    list.appendChild(row);
  });
  wrapper.appendChild(list);

  container.appendChild(wrapper);
}
