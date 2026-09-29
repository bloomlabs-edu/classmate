/**
 * ui/views/WeeklyPlanReviewView.js
 *
 * The Monday-Friday Weekly Plan grid — for one Fellow, one classroom,
 * one week. Reused for TWO different viewers, branching only on
 * capability, never a second implementation:
 *   - the Fellow themselves, reviewing their own week before/after
 *     submitting (sees [ Submit Weekly Plan ], no reviewer actions);
 *   - a Program Manager reviewing a SUBMITTED week (sees
 *     [ Request Changes ]/[ Approve ], never Submit).
 *
 * Content is ALWAYS read live from that week's real
 * models/Lesson.js documents (services/weeklyPlanGridService.js's own
 * buildWeeklyPlanGrid(), which itself only ever composes
 * services/schoolCalendarService.js's effective-schedule resolution —
 * never a second timetable reconstruction, never a snapshot). The
 * status badge/actions are the ONE thing this view reads from
 * models/WeeklyPlanSubmission.js — never a copy of grid content.
 *
 * Optional Chapter lens — `chapterCurriculumUnitId`/`chapterName`
 * (both default `null`) — this view IS the "existing Weekly Plan grid"
 * the approved connected-planning architecture's Weeks perspective
 * reuses, per explicit product direction: a Chapter's Weeks view is
 * never a second grid/timetable implementation, only this same one
 * with periods belonging to the current Chapter visually flagged. When
 * `chapterCurriculumUnitId` is set, a period whose own Lesson has a
 * matching `curriculumUnitId` (see
 * services/chapterPlanProgressService.js's own identical
 * classroomId+curriculumUnitId join — NEVER linkedCurriculumUnitId)
 * gets a small chip; every other period renders exactly as before,
 * never hidden — a week can, and often does, contain periods from
 * OTHER chapters, and this view must keep showing the Fellow's real
 * whole week regardless of which Chapter Plan opened it. When these two
 * params are omitted entirely (every existing caller — the Program
 * Manager queue), this view's output is byte-for-byte unchanged.
 */

import * as weeklyPlanSubmissionRepository from '../../repositories/weeklyPlanSubmissionRepository.js';
import * as scheduledEventRepository from '../../services/scheduledEventRepository.js';
import * as plannerRepository from '../../services/plannerRepository.js';
import {
  submitWeeklyPlan,
  requestWeeklyPlanChanges,
  approveWeeklyPlan,
  canReviewWeeklyPlanSubmission,
  canApproveWeeklyPlanSubmission,
  getWeeklyPlanSubmissionLabel,
  getWeekPlanDisplayStatus,
  WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED,
} from '../../services/weeklyPlanSubmissionService.js';
import { WEEKLY_PLAN_SUBMISSION_STATUS } from '../../models/WeeklyPlanSubmission.js';
import { buildWeeklyPlanGrid, getLessonsFromWeeklyPlanGrid } from '../../services/weeklyPlanGridService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import { shiftDateKey, formatWeekDateRange } from '../../utils/dateHelpers.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

const WEEKDAY_LABELS = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };

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

export function renderWeeklyPlanReviewView(
  container,
  {
    classroom,
    teacherUid,
    teacherDisplayName,
    weekStartDate,
    currentUser,
    onBack,
    onOpenTimetable,
    onOpenFullLessonPlan,
    chapterCurriculumUnitId = null,
    chapterName = null,
  }
) {
  let state = null; // null = loading
  let loadError = null;
  const expandedTeachingSlotIds = new Set();

  function rerender() {
    renderContent(container, {
      classroom,
      teacherUid,
      teacherDisplayName,
      weekStartDate,
      currentUser,
      state,
      loadError,
      expandedTeachingSlotIds,
      chapterCurriculumUnitId,
      chapterName,
    }, { onBack, onOpenTimetable, onOpenFullLessonPlan, onToggleExpand, onSubmit, onRequestChanges, onApprove });
  }

  function onToggleExpand(teachingSlotId) {
    if (expandedTeachingSlotIds.has(teachingSlotId)) expandedTeachingSlotIds.delete(teachingSlotId);
    else expandedTeachingSlotIds.add(teachingSlotId);
    rerender();
  }

  async function reload() {
    try {
      const weekEndDate = shiftDateKey(weekStartDate, 4);
      const [events, lessons, submission] = await Promise.all([
        scheduledEventRepository.getScheduledEventsForDateRange(classroom.id, weekStartDate, weekEndDate),
        plannerRepository.getLessonsForDateRange(classroom.id, weekStartDate, weekEndDate),
        weeklyPlanSubmissionRepository.getSubmission(classroom.id, teacherUid, weekStartDate),
      ]);
      const grid = buildWeeklyPlanGrid(classroom, { events, lessons, teacherUid, weekStartDate });
      const displayStatus = getWeekPlanDisplayStatus(submission, getLessonsFromWeeklyPlanGrid(grid));
      state = { grid, submission, displayStatus };
      loadError = null;
    } catch (error) {
      console.error('[WeeklyPlanReviewView] Failed to load the Weekly Plan:', error);
      loadError = "Couldn't load this Weekly Plan. Check your connection and try again.";
    }
    rerender();
  }

  async function onSubmit() {
    const next = submitWeeklyPlan(state.submission, { classroomId: classroom.id, teacherUid, weekStartDate, byUid: currentUser.uid });
    await weeklyPlanSubmissionRepository.upsertSubmission(next);
    await reload();
  }

  async function onRequestChanges() {
    const next = requestWeeklyPlanChanges(classroom, state.submission, { byUid: currentUser.uid });
    await weeklyPlanSubmissionRepository.upsertSubmission(next);
    await reload();
  }

  async function onApprove() {
    const next = approveWeeklyPlan(classroom, state.submission, { byUid: currentUser.uid });
    await weeklyPlanSubmissionRepository.upsertSubmission(next);
    await reload();
  }

  rerender();
  reload();
}

function truncate(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

function renderPeriodField(container, label, value, { expanded }) {
  const field = document.createElement('div');
  field.className = 'weekly-plan-grid__field';
  const fieldLabel = document.createElement('span');
  fieldLabel.className = 'weekly-plan-grid__field-label';
  fieldLabel.textContent = label;
  field.appendChild(fieldLabel);
  const fieldValue = document.createElement('span');
  fieldValue.className = 'weekly-plan-grid__field-value';
  fieldValue.textContent = value ? (expanded ? value : truncate(value, 60)) : '—';
  field.appendChild(fieldValue);
  container.appendChild(field);
}

function renderPeriodCard(classroom, period, { expanded, onToggleExpand, onOpenFullLessonPlan, chapterCurriculumUnitId }) {
  const card = document.createElement('div');
  card.className = 'weekly-plan-grid__period-card';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'weekly-plan-grid__period-header';
  const subjectTitle = learningRecordService.getSubjectById(classroom, period.subjectId)?.title || 'Period';
  header.textContent = `P${period.periodNumber} · ${period.startTime}–${period.endTime} · ${subjectTitle}`;
  header.addEventListener('click', () => onToggleExpand(period.teachingSlotId));
  card.appendChild(header);

  // Additive Chapter-lens highlight only — see this file's own header
  // comment. Same classroomId+curriculumUnitId join
  // services/chapterPlanProgressService.js uses, never
  // linkedCurriculumUnitId; every other period keeps rendering exactly
  // as before, whether or not this chip is ever shown.
  if (chapterCurriculumUnitId && period.lesson?.curriculumUnitId === chapterCurriculumUnitId) {
    const chip = document.createElement('span');
    chip.className = 'weekly-plan-grid__chapter-chip';
    chip.textContent = 'This Chapter';
    card.appendChild(chip);
  }

  const lesson = period.lesson;
  const unitTitle = period.unit?.title || null;
  const topicTitle = period.concepts.length > 0 ? period.concepts.map((concept) => concept.title).join(', ') : null;

  renderPeriodField(card, 'Unit', unitTitle, { expanded });
  renderPeriodField(card, 'Topic', topicTitle, { expanded });
  renderPeriodField(card, 'Big Question', lesson?.bigQuestion, { expanded });
  renderPeriodField(
    card,
    'Objective',
    (lesson?.objectives || []).map((objective) => objective.text).filter(Boolean).join('; '),
    { expanded }
  );
  renderPeriodField(card, 'Plan', lesson?.planSummary, { expanded });
  renderPeriodField(card, 'Assessment', lesson?.assessmentNote, { expanded });

  if (lesson?.lessonPlanId) {
    const openFullPlan = document.createElement('button');
    openFullPlan.type = 'button';
    openFullPlan.className = 'btn btn--text weekly-plan-grid__open-full-plan';
    openFullPlan.textContent = 'Open Full Lesson Plan →';
    openFullPlan.addEventListener('click', () => onOpenFullLessonPlan(classroom.id, lesson.lessonPlanId));
    card.appendChild(openFullPlan);
  }

  return card;
}

function renderDayColumn(classroom, day, { expandedTeachingSlotIds, onToggleExpand, onOpenFullLessonPlan, chapterCurriculumUnitId }) {
  const column = document.createElement('div');
  column.className = 'weekly-plan-grid__day';

  const dayHeader = document.createElement('h3');
  dayHeader.className = 'weekly-plan-grid__day-header';
  dayHeader.textContent = WEEKDAY_LABELS[day.weekday] || day.dateKey;
  column.appendChild(dayHeader);

  if (!day.isWorkingDay) {
    const note = document.createElement('p');
    note.className = 'weekly-plan-grid__day-note';
    note.textContent = day.exceptionReason || 'Not a working day';
    column.appendChild(note);
    return column;
  }

  if (day.periods.length === 0) {
    const note = document.createElement('p');
    note.className = 'weekly-plan-grid__day-note';
    note.textContent = 'No periods scheduled';
    column.appendChild(note);
    return column;
  }

  day.periods.forEach((period) => {
    column.appendChild(
      renderPeriodCard(classroom, period, {
        expanded: expandedTeachingSlotIds.has(period.teachingSlotId),
        onToggleExpand,
        onOpenFullLessonPlan,
        chapterCurriculumUnitId,
      })
    );
  });

  return column;
}

function renderContent(container, data, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'weekly-plan-review';

  const header = document.createElement('header');
  header.className = 'weekly-plan-review__header';
  header.appendChild(createBackButton(handlers.onBack));

  const title = document.createElement('h1');
  title.className = 'weekly-plan-review__title';
  title.textContent = `${data.teacherDisplayName || 'A Fellow'}'s Weekly Plan`;
  header.appendChild(title);
  wrapper.appendChild(header);

  const subtitle = document.createElement('p');
  subtitle.className = 'weekly-plan-review__subtitle';
  subtitle.textContent = `${data.classroom.name || 'Classroom'} · ${formatWeekDateRange(data.weekStartDate)}`;
  wrapper.appendChild(subtitle);

  if (data.chapterCurriculumUnitId && data.chapterName) {
    const chapterNote = document.createElement('p');
    chapterNote.className = 'weekly-plan-review__chapter-note';
    chapterNote.textContent = `Highlighting periods for: ${data.chapterName}`;
    wrapper.appendChild(chapterNote);
  }

  const viewTimetable = document.createElement('button');
  viewTimetable.type = 'button';
  viewTimetable.className = 'btn btn--text weekly-plan-review__view-timetable';
  viewTimetable.textContent = '[ View Timetable ]';
  viewTimetable.addEventListener('click', () => handlers.onOpenTimetable(data.classroom.id));
  wrapper.appendChild(viewTimetable);

  if (data.loadError) {
    const error = document.createElement('p');
    error.className = 'weekly-plan-review__error';
    error.textContent = data.loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (!data.state) {
    const loading = document.createElement('p');
    loading.className = 'weekly-plan-review__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  const { grid, submission, displayStatus } = data.state;

  const statusBadge = document.createElement('span');
  statusBadge.className = `weekly-plan-review__status-badge weekly-plan-review__status-badge--${displayStatus}`;
  statusBadge.textContent = getStatusLabel(displayStatus, submission);
  wrapper.appendChild(statusBadge);

  const isAuthor = data.currentUser?.uid === data.teacherUid;
  const canSubmit = isAuthor && displayStatus !== WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED && displayStatus !== WEEKLY_PLAN_SUBMISSION_STATUS.APPROVED;
  const canReview =
    displayStatus === WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED &&
    submission &&
    canReviewWeeklyPlanSubmission(data.classroom, submission, data.currentUser?.uid);
  const canApprove =
    displayStatus === WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED &&
    submission &&
    canApproveWeeklyPlanSubmission(data.classroom, submission, data.currentUser?.uid);

  const actions = document.createElement('div');
  actions.className = 'weekly-plan-review__actions';

  if (canSubmit) {
    const submitButton = document.createElement('button');
    submitButton.type = 'button';
    submitButton.className = 'btn btn--primary';
    submitButton.textContent = 'Submit Weekly Plan';
    submitButton.addEventListener('click', handlers.onSubmit);
    actions.appendChild(submitButton);
  }
  if (canReview) {
    const requestChangesButton = document.createElement('button');
    requestChangesButton.type = 'button';
    requestChangesButton.className = 'btn btn--secondary';
    requestChangesButton.textContent = 'Request Changes';
    requestChangesButton.addEventListener('click', handlers.onRequestChanges);
    actions.appendChild(requestChangesButton);
  }
  if (canApprove) {
    const approveButton = document.createElement('button');
    approveButton.type = 'button';
    approveButton.className = 'btn btn--primary';
    approveButton.textContent = 'Approve';
    approveButton.addEventListener('click', handlers.onApprove);
    actions.appendChild(approveButton);
  }
  if (actions.children.length > 0) wrapper.appendChild(actions);

  const gridEl = document.createElement('div');
  gridEl.className = 'weekly-plan-grid';
  grid.forEach((day) => {
    gridEl.appendChild(
      renderDayColumn(data.classroom, day, {
        expandedTeachingSlotIds: data.expandedTeachingSlotIds,
        onToggleExpand: handlers.onToggleExpand,
        onOpenFullLessonPlan: handlers.onOpenFullLessonPlan,
        chapterCurriculumUnitId: data.chapterCurriculumUnitId,
      })
    );
  });
  wrapper.appendChild(gridEl);

  container.appendChild(wrapper);
}
