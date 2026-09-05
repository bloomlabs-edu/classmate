/**
 * ui/views/TimetableView.js
 *
 * The Timetable — the star working surface of the Teacher Classroom
 * workspace (see ui/components/TeacherPortalSidebar.js's own comment
 * on why Timetable is visually starred there). Reproduces the
 * approved reference composition: a Week grid of real TeachingSlots
 * (services/timetableService.js), each period pre-tagged with its
 * real subject before any lesson plan is attached, plus a Period
 * Detail panel for attaching a lesson plan, marking concepts executed,
 * carrying an unexecuted concept forward, and reviewing student
 * feedback.
 *
 * Firestore access goes through services/plannerRepository.js /
 * services/timetableLessonService.js / services/carryForwardService.js
 * only — this file never imports the Firestore SDK itself, matching
 * every other view in this app.
 *
 * Week / Day / Calendar are three genuinely different views over the
 * same underlying TeachingSlot/Lesson data, not three renderings of
 * the same 7-day grid: Week is the detailed weekly planning grid, Day
 * is one day's periods shown vertically, and Calendar is a true month
 * calendar (renderCalendarGrid() below) with real calendar dates as
 * its time axis and curriculum-progress Unit strips as its own
 * primary visual content (renderCalendarProgressionWeeks()) — never
 * the full period grid inside a cell. Calendar's own "click a date"
 * affordance switches straight to Day mode for that date, which is
 * where the real period detail lives; Calendar itself has no period-
 * level interaction of its own.
 *
 * SCOPE NOTE 2: "Attach lesson plan" here is a minimal, real (not
 * dummy) concept picker against the classroom's own syllabus tree —
 * not an integration with the separate, pre-existing Lesson Studio
 * view, which this phase did not have budget to research and wire in
 * safely. Flagged explicitly per the "ask before deviating" rule,
 * rather than silently deciding Lesson Studio integration was out of
 * scope.
 */

import * as timetableService from '../../services/timetableService.js';
import * as timetableLessonService from '../../services/timetableLessonService.js';
import * as timetableDisplayService from '../../services/timetableDisplayService.js';
import * as carryForwardService from '../../services/carryForwardService.js';
import * as conceptFeedbackService from '../../services/conceptFeedbackService.js';
import * as plannerRepository from '../../services/plannerRepository.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as resourceService from '../../services/resourceService.js';
import * as subjectIdentityService from '../../services/subjectIdentityService.js';
import * as memberService from '../../services/memberService.js';
import { MEMBER_ROLES } from '../../config/memberRoles.js';
import { createTimetablePeriod, createTimetableSlot } from '../../models/Timetable.js';
import { hydrateConceptRecordsForConcepts } from '../../services/conceptRecordHydrationService.js';
import { getFeedbackEligibleConceptIds, resetLessonForUnitChange } from '../../models/Lesson.js';
import { getTimetableSubjectColor, getTimetableSubjectWash } from '../../config/timetableSubjectColors.js';
import {
  getWeekRange,
  shiftDateKey,
  getTodayDateKey,
  formatDateKey,
  getMonthRange,
  getCurrentYearMonth,
  shiftYearMonth,
  formatYearMonth,
  getDaysInYearMonth,
} from '../../utils/dateHelpers.js';
import { createIcon } from '../components/Icon.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { renderSubjectBadge, renderLessonTopicLabel } from '../components/ScheduleItemLabels.js';
import { getResourceTypeIcon } from '../../config/resourceTypeConfig.js';
import * as learningIntegrationService from '../../services/learningIntegrationService.js';
import * as learningActivityService from '../../services/learningActivityService.js';
import { fetchLearningHubCatalogue, groupExperiencesByType } from '../../services/learningHubCatalogueService.js';
import { buildLearningHubLaunchUrl, LEARNING_HUB_TYPE_GROUP_LABELS } from './ConceptWorkspaceView.js';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Matches css/styles.css's own `@media (max-width: 640px) { .timetable-view__table { display: none; } }` — Day mode is the natural mobile operating view (per the approved reference), never the Week grid squeezed into a phone width. */
function isNarrowViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= 640;
}

/**
 * Phase W — survives across renderTimetableView() calls so a
 * classroom-save-triggered remount (see main.js's own
 * workspace-init-onchange, fired by workspaceService's live Firestore
 * listener any time this classroom document changes — including from
 * this view's own writes, e.g. creating a concept) doesn't blow away
 * whatever period-detail panel the teacher currently has open. Only
 * ever read/written by renderTimetableView() below via its
 * `preserveState` param — a fresh, genuine navigation to Timetable
 * (main.js's own 'url-route-changed') still gets the original clean-
 * slate defaults, matching this view's existing behavior.
 */
let preservedState = null; // { classroomId, state } | null

export async function renderTimetableView(container, { classroom, preserveState = false }) {
  const state =
    preserveState && preservedState && preservedState.classroomId === classroom.id
      ? preservedState.state
      : {
          viewMode: isNarrowViewport() ? 'day' : 'week', // 'week' | 'day' | 'calendar'
          anchorDateKey: getTodayDateKey(),
          anchorYearMonth: getCurrentYearMonth(), // Calendar mode's own "which month" — independent of anchorDateKey so switching to/from Calendar never disturbs Week/Day's own last-viewed date
          calendarSubjectFilter: null, // null = "All Subjects" (the existing compact dot view); a canonical subjectId switches Calendar into the per-subject curriculum-progress view
          calendarProgress: null, // populated by loadCalendarUnitProgress() below, only when calendarSubjectFilter is set and viewMode === 'calendar'
          lessonsByTeachingSlotId: {},
          selectedTeachingSlotId: null,
          activeDetailTab: 'overview', // 'overview' | 'concepts' | 'studentResources' | 'lessonPlan' | 'reflection' — Phase P; studentResources/lessonPlan were one combined 'resources' tab until the explicit IA split below (student-facing vs teacher-facing are two different tabs, never one "Resources" tab containing both)
        };
  preservedState = { classroomId: classroom.id, state };

  /** Re-renders against the currently visible range's own real, already-loaded data — no new fetch. Shared by every interaction that only changes selection/tab state, never lesson data itself (period-card click, tab click). */
  function rerenderCurrentRange() {
    const range = getVisibleRange();
    render(timetableService.getConcreteSlotsForDateRange(classroom, range.start, range.end), range);
  }

  /** Wraps a write action (attach lesson, mark executed, carry forward) so a Firestore failure shows a real message instead of silently doing nothing — an unhandled rejection in a click handler fails invisibly otherwise. */
  async function runAction(action) {
    try {
      await action();
    } catch (error) {
      console.error('[TimetableView] Action failed:', error);
      window.alert('Something went wrong saving that change. Please try again.');
    }
  }

  async function loadAndRender() {
    const range = getVisibleRange();
    const slots = timetableService.getConcreteSlotsForDateRange(classroom, range.start, range.end);
    // The grid itself (periods + preloaded subjects) is real, local data
    // that must always render regardless of network state — a failed
    // Lessons fetch degrades to "no lesson plans visible yet," never a
    // blank screen.
    try {
      const lessons = await plannerRepository.getLessonsForDateRange(classroom.id, range.start, range.end);
      state.lessonsByTeachingSlotId = Object.fromEntries(lessons.map((lesson) => [lesson.teachingSlotId, lesson]));
    } catch (error) {
      console.error('[TimetableView] Failed to load lessons for the visible range:', error);
      state.lessonsByTeachingSlotId = {};
    }

    if (state.viewMode === 'calendar') {
      await loadCalendarUnitProgress(range);
    } else {
      state.calendarProgress = null;
    }

    await hydrateSelectedLessonFeedback();
    render(slots, range);
  }

  /**
   * The Calendar's curriculum-progress view — powers the Unit-strip
   * layer in BOTH Calendar scopes. "All Subjects" and a specific
   * subject are the SAME renderer at two different scopes, per
   * explicit product direction — never two different visualizations
   * — so this now always runs in Calendar mode, not only when a
   * subject is selected. Orchestrates three real, existing reads —
   * this month's Lessons, the previous month's Lessons (for the
   * summary card's month-over-month comparison, subject-specific
   * only), and each distinct Unit's own full Lesson history
   * (plannerRepository.getLessonsForUnit()) — then hands everything to
   * timetableDisplayService's pure deriveUnitProgress()/
   * summarizeUnitProgressForRange(). No new persistence, no new
   * analytics system.
   *
   * A Unit's full history is fetched at most once per render even
   * though it may be relevant to both this month and last month (the
   * common case for a Unit spanning the boundary) — `subjectIdByUnitId`
   * (built from both months' Lessons at once) is what dedupes that.
   * Each resulting progress record also carries its own `subjectId` —
   * needed so an "All Subjects" strip can identify which subject its
   * Unit belongs to, per explicit requirement.
   */
  async function loadCalendarUnitProgress(range) {
    const subjectId = state.calendarSubjectFilter; // null = All Subjects (a wider SCOPE, never a different renderer)
    const previousMonthKey = shiftYearMonth(state.anchorYearMonth, -1);
    const previousRange = getMonthRange(`${previousMonthKey}-01`);

    try {
      const [monthLessonsAll, previousMonthLessonsAll] = await Promise.all([
        plannerRepository.getLessonsForDateRange(classroom.id, range.start, range.end),
        plannerRepository.getLessonsForDateRange(classroom.id, previousRange.start, previousRange.end),
      ]);

      const subjectByTeachingSlotId = buildSubjectByTeachingSlotIdMap([...monthLessonsAll, ...previousMonthLessonsAll]);
      const resolveLessonSubjectId = (lesson) => subjectByTeachingSlotId.get(lesson.teachingSlotId) || null;

      const monthLessonsInScope = subjectId ? monthLessonsAll.filter((lesson) => resolveLessonSubjectId(lesson) === subjectId) : monthLessonsAll;
      const previousMonthLessonsInScope = subjectId
        ? previousMonthLessonsAll.filter((lesson) => resolveLessonSubjectId(lesson) === subjectId)
        : previousMonthLessonsAll;

      const subjectIdByUnitId = new Map();
      [...monthLessonsInScope, ...previousMonthLessonsInScope].forEach((lesson) => {
        if (lesson.curriculumUnitId) subjectIdByUnitId.set(lesson.curriculumUnitId, resolveLessonSubjectId(lesson));
      });

      const unitProgressList = (
        await Promise.all(
          [...subjectIdByUnitId.keys()].map(async (unitId) => {
            const unit = learningRecordService.getUnitById(classroom, unitId);
            if (!unit) return null; // the Unit itself was since deleted from the syllabus tree; its old Lessons are orphaned, not shown
            const lessonsForUnit = await plannerRepository.getLessonsForUnit(classroom.id, unitId);
            const progress = timetableDisplayService.deriveUnitProgress(unit, lessonsForUnit);
            return progress && { ...progress, subjectId: subjectIdByUnitId.get(unitId) };
          })
        )
      ).filter(Boolean);

      state.calendarProgress = {
        subjectId,
        // The stats card answers a subject-specific question ("how
        // many Science units did I complete this month?") — it stays
        // null for All Subjects rather than force-aggregating a
        // number across every subject that doesn't actually answer
        // anything a teacher asked (per "keep the existing Science-
        // specific summary," never redesigned into a holistic one).
        thisMonth: subjectId ? timetableDisplayService.summarizeUnitProgressForRange(unitProgressList, monthLessonsInScope, range) : null,
        previousMonth: subjectId
          ? timetableDisplayService.summarizeUnitProgressForRange(unitProgressList, previousMonthLessonsInScope, previousRange)
          : null,
        unitProgressList,
        range,
      };
    } catch (error) {
      console.error('[TimetableView] Failed to load curriculum progress for the Calendar:', error);
      state.calendarProgress = null;
    }
  }

  /** Every Lesson's own TeachingSlot subjectId, keyed by teachingSlotId — resolved via timetableService's own concrete-slot generator for exactly the dates these Lessons actually fall on, the same "subject lives on the slot, not the Lesson" rule the rest of this file already follows (see timetableDisplayService.js's own header comment). Shared by both subject-scoping (a specific subject filter) and per-Unit subject labeling (All Subjects, where each strip must identify its own subject). */
  function buildSubjectByTeachingSlotIdMap(lessons) {
    if (lessons.length === 0) return new Map();
    const dateKeys = [...new Set(lessons.map((lesson) => lesson.date))].sort();
    const slotsForDates = timetableService.getConcreteSlotsForDateRange(classroom, dateKeys[0], dateKeys[dateKeys.length - 1]);
    return new Map(slotsForDates.map((slot) => [slot.id, slot.subjectId]));
  }

  /**
   * Phase N — overlays every student's real studentConceptRecords
   * documents for the currently-selected Lesson's own eligible
   * concepts onto classroom.teams[].students[].learningRecord, so
   * renderPeriodDetailPanel()'s own (synchronous)
   * conceptFeedbackService.getLessonFeedbackSummary() call sees real
   * data. Bounded by roster size x this one Lesson's own (typically
   * few) executed concept ids — never the whole classroom's full
   * syllabus. A no-op when nothing is selected, or the selected Lesson
   * has no executed concepts.
   *
   * Phase O fix: originally only ever called from loadAndRender()
   * (initial mount, Today/prev/next navigation, Week/Day toggle) — but
   * selecting a period card itself never calls loadAndRender(), only
   * the synchronous render() (see renderPeriodCard()'s own click
   * handler below), so this never actually ran on the one interaction
   * that matters most: a teacher opening a period for the first time
   * in a session. Only discovered via Phase O's own real-browser,
   * real-emulator verification — no unit test exercises this click
   * path. Now called from both places.
   */
  async function hydrateSelectedLessonFeedback() {
    const selectedLessonForHydration = state.selectedTeachingSlotId
      ? state.lessonsByTeachingSlotId[state.selectedTeachingSlotId]
      : null;
    if (!selectedLessonForHydration) return;

    try {
      await hydrateConceptRecordsForConcepts(classroom, getFeedbackEligibleConceptIds(selectedLessonForHydration));
    } catch (error) {
      console.error('[TimetableView] Failed to hydrate concept feedback records:', error);
    }
  }

  function getVisibleRange() {
    if (state.viewMode === 'day') return { start: state.anchorDateKey, end: state.anchorDateKey };
    if (state.viewMode === 'calendar') return getMonthRange(`${state.anchorYearMonth}-01`);
    return getWeekRange(state.anchorDateKey);
  }

  function render(slots, range) {
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'timetable-view';

    root.appendChild(renderHeader());
    root.appendChild(renderToolbar(range));
    if (state.viewMode === 'day') {
      root.appendChild(renderDayGrid(slots, range));
    } else if (state.viewMode === 'calendar') {
      root.appendChild(renderCalendarGrid(range));
    } else {
      root.appendChild(renderWeekGrid(slots, range));
    }
    // Legend (per-period coverage-status colors) and the Weekly
    // Overview stat card both describe Week/Day's own period cards —
    // neither applies to Calendar's own Unit strips, which have their
    // own separate completed/in-progress treatment, so both are
    // skipped in Calendar mode rather than shown mislabeled/mismatched.
    if (state.viewMode !== 'calendar') {
      root.appendChild(renderLegend());
      root.appendChild(renderSummaryRow(slots));
    }

    const selectedLesson = state.selectedTeachingSlotId ? state.lessonsByTeachingSlotId[state.selectedTeachingSlotId] : null;
    const selectedSlot = state.selectedTeachingSlotId ? slots.find((s) => s.id === state.selectedTeachingSlotId) : null;
    if (selectedSlot) {
      root.appendChild(renderPeriodDetailPanel(selectedSlot, selectedLesson));
    }

    container.appendChild(root);
  }

  function renderHeader() {
    const header = document.createElement('div');
    header.className = 'timetable-view__header';

    const headerRow = document.createElement('div');
    headerRow.className = 'timetable-view__header-row';

    const titleBlock = document.createElement('div');
    const titleRow = document.createElement('div');
    titleRow.className = 'timetable-view__title-row';
    titleRow.appendChild(createIcon('calendar', { size: 24 }));
    const title = document.createElement('h1');
    title.textContent = 'Timetable';
    titleRow.appendChild(title);
    titleBlock.appendChild(titleRow);

    const subtitle = document.createElement('p');
    subtitle.className = 'timetable-view__subtitle';
    subtitle.textContent = 'Plan your teaching. Track what happens. Improve learning.';
    titleBlock.appendChild(subtitle);

    headerRow.appendChild(titleBlock);

    // Secondary, restrained action — the recurring SCHEDULE (which
    // subject is taught when) is a distinct concern from this page's
    // own teaching/monitoring workflow (see openManageTimetableFlow()'s
    // own header comment). Deliberately .btn--ghost, matching the same
    // non-dominant weight already used for Cancel/secondary actions
    // elsewhere in this file, per explicit product instruction that
    // this must never compete with the Timetable page's own primary content.
    const manageButton = document.createElement('button');
    manageButton.type = 'button';
    manageButton.className = 'btn btn--ghost timetable-view__manage-button';
    manageButton.textContent = 'Manage timetable';
    manageButton.addEventListener('click', () => openManageTimetableFlow());
    headerRow.appendChild(manageButton);

    header.appendChild(headerRow);
    return header;
  }

  function renderToolbar(range) {
    const toolbar = document.createElement('div');
    toolbar.className = 'timetable-view__toolbar';

    const nav = document.createElement('div');
    nav.className = 'timetable-view__date-nav';

    // Calendar steps by month (its own anchorYearMonth), Day by one
    // day, Week by seven — three different units of navigation behind
    // the same [ ← ] [ Today ] [ → ] controls.
    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.appendChild(createIcon('arrow-left', { size: 16 }));
    prevButton.addEventListener('click', () => {
      if (state.viewMode === 'calendar') {
        state.anchorYearMonth = shiftYearMonth(state.anchorYearMonth, -1);
      } else {
        state.anchorDateKey = shiftDateKey(state.anchorDateKey, state.viewMode === 'day' ? -1 : -7);
      }
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });
    nav.appendChild(prevButton);

    const todayButton = document.createElement('button');
    todayButton.type = 'button';
    todayButton.textContent = 'Today';
    todayButton.addEventListener('click', () => {
      state.anchorDateKey = getTodayDateKey();
      state.anchorYearMonth = getCurrentYearMonth();
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });
    nav.appendChild(todayButton);

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.appendChild(createIcon('arrow-right', { size: 16 }));
    nextButton.addEventListener('click', () => {
      if (state.viewMode === 'calendar') {
        state.anchorYearMonth = shiftYearMonth(state.anchorYearMonth, 1);
      } else {
        state.anchorDateKey = shiftDateKey(state.anchorDateKey, state.viewMode === 'day' ? 1 : 7);
      }
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });
    nav.appendChild(nextButton);

    const rangeLabel = document.createElement('span');
    rangeLabel.className = 'timetable-view__range-label';
    rangeLabel.textContent =
      state.viewMode === 'calendar'
        ? formatYearMonth(state.anchorYearMonth)
        : range.start === range.end
          ? formatDateKey(range.start)
          : `${formatDateKey(range.start)} – ${formatDateKey(range.end)}`;
    nav.appendChild(rangeLabel);

    toolbar.appendChild(nav);
    toolbar.appendChild(renderModeToggle());

    return toolbar;
  }

  function renderModeToggle() {
    const toggle = document.createElement('div');
    toggle.className = 'timetable-view__mode-toggle';

    [
      { id: 'week', label: 'Week' },
      { id: 'day', label: 'Day' },
      { id: 'calendar', label: 'Calendar' },
    ].forEach(({ id, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (state.viewMode === id) button.classList.add('timetable-view__mode-toggle-item--active');
      button.addEventListener('click', () => {
        state.viewMode = id;
        state.selectedTeachingSlotId = null;
        loadAndRender();
      });
      toggle.appendChild(button);
    });

    return toggle;
  }

  function renderWeekGrid(slots, range) {
    const grid = document.createElement('div');
    grid.className = 'timetable-view__grid';

    const periods = timetableService.getPeriods(classroom);
    const dateKeys = [];
    for (let d = range.start; d <= range.end; d = shiftDateKey(d, 1)) dateKeys.push(d);

    const table = document.createElement('table');
    table.className = 'timetable-view__table';

    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    dateKeys.forEach((dateKey) => {
      const th = document.createElement('th');
      th.className = 'timetable-view__day-header';
      if (dateKey === getTodayDateKey()) th.classList.add('timetable-view__day-header--today');
      const [, , day] = dateKey.split('-');
      th.innerHTML = `<span class="timetable-view__day-name">${WEEKDAY_LABELS[weekdayOf(dateKey)]}</span><span class="timetable-view__day-date">${day} ${monthAbbrev(dateKey)}</span>`;
      headRow.appendChild(th);
    });
    table.appendChild(headRow);

    periods.forEach((period) => {
      const row = document.createElement('tr');
      const periodCell = document.createElement('td');
      periodCell.className = 'timetable-view__period-label';
      periodCell.innerHTML = `<strong>${period.periodNumber}</strong><span>${period.startTime} - ${period.endTime}</span>`;
      row.appendChild(periodCell);

      dateKeys.forEach((dateKey) => {
        const slot = slots.find((s) => s.date === dateKey && s.periodNumber === period.periodNumber);
        const cell = document.createElement('td');
        cell.appendChild(slot ? renderPeriodCard(slot) : renderEmptyCell());
        row.appendChild(cell);
      });

      table.appendChild(row);
    });

    grid.appendChild(table);
    return grid;
  }

  function renderDayGrid(slots, range) {
    const wrapper = document.createElement('div');
    wrapper.className = 'timetable-view__day-list';
    const periods = timetableService.getPeriods(classroom);

    periods.forEach((period) => {
      const slot = slots.find((s) => s.periodNumber === period.periodNumber && s.date === range.start);
      const row = document.createElement('div');
      row.className = 'timetable-view__day-row';
      // A subtle subject-accent left border — the same color already
      // computed for the subject strip, just carried onto the row too,
      // per Phase P's "subtle subject accent" requirement for the
      // mobile Day view. No new data; an empty period stays neutral.
      if (slot) row.style.borderLeftColor = getTimetableSubjectColor(slot.subjectId).text;
      const label = document.createElement('div');
      label.className = 'timetable-view__period-label';
      label.innerHTML = `<strong>${period.periodNumber}</strong><span>${period.startTime} - ${period.endTime}</span>`;
      row.appendChild(label);
      row.appendChild(slot ? renderPeriodCard(slot) : renderEmptyCell());
      wrapper.appendChild(row);
    });

    return wrapper;
  }

  /**
   * Calendar mode — a true month calendar, not the Week/Day period
   * grid squeezed into a bigger range. `slots`/`range` are the exact
   * same TeachingSlot list and {start,end} shape Week/Day already
   * render from (getVisibleRange() is the only thing that changed to
   * make `range` span a whole month here) — no new data-fetching path,
   * no new service call. Leading/trailing blank cells pad the grid to
   * whole weeks, matching an ordinary month calendar; they're
   * deliberately inert (no date, no click) rather than showing/linking
   * adjacent-month dates.
   *
   * ONE canonical Calendar visualization regardless of subject filter,
   * per explicit product direction — the subject filter changes SCOPE
   * (which Units' Lessons feed the strips), never which renderer runs.
   * "All Subjects" and a specific subject both render through
   * renderCalendarProgressionWeeks() below; the old separate compact-
   * dot grid is gone entirely, not merely hidden.
   */
  function renderCalendarGrid(range) {
    const wrapper = document.createElement('div');
    wrapper.className = 'timetable-view__calendar';

    wrapper.appendChild(renderCalendarFilterRow());

    const subjectId = state.calendarSubjectFilter;
    if (subjectId) wrapper.appendChild(renderCalendarSubjectSummary());

    const weekdayHeader = document.createElement('div');
    weekdayHeader.className = 'timetable-view__calendar-weekdays';
    WEEKDAY_LABELS.forEach((label) => {
      const cell = document.createElement('div');
      cell.className = 'timetable-view__calendar-weekday';
      cell.textContent = label;
      weekdayHeader.appendChild(cell);
    });
    wrapper.appendChild(weekdayHeader);

    wrapper.appendChild(renderCalendarProgressionWeeks(range));

    return wrapper;
  }

  /**
   * The integrated curriculum-progression view — real calendar weeks
   * (buildCalendarWeeks()), each its own small CSS grid: row 1 is the
   * week's own 7 date cells (day number, today highlight, click ->
   * Day mode — the calendar's own TIME AXIS), and each additional row
   * is one Unit-strip "lane" for that week (see
   * renderCalendarUnitStrip()) — the CURRICULUM PROGRESSION LAYER,
   * laid out on top of the same real dates, never a separate Gantt
   * chart underneath. Runs identically for "All Subjects" (every
   * subject's Units at once, each strip labeled with its own subject —
   * see renderCalendarUnitStrip()'s own doc comment) and a specific
   * subject (scoped to just that subject's Units) — state.calendarProgress
   * itself already reflects whichever scope loadCalendarUnitProgress()
   * was given; this function has no subject-specific branch of its own.
   *
   * Lanes are assigned ONCE for the whole month
   * (timetableDisplayService.assignUnitLanes()) so the same Unit
   * lands in the same relative row in every week it spans — the
   * continuity cue a multi-week Unit needs to read as one continuing
   * strip, not an unrelated reshuffle each row. The SAME lane
   * assignment already handles multiple subjects' Units overlapping
   * in All Subjects mode too — it only ever reasons about date spans,
   * never about which subject a Unit belongs to. Each week then remaps
   * to a LOCALLY compact row index (only the lanes actually active
   * that week) purely so an unused lane never wastes an empty grid row.
   */
  function renderCalendarProgressionWeeks(range) {
    const wrapper = document.createElement('div');
    wrapper.className = 'timetable-view__calendar-progression-weeks';

    const progress = state.calendarProgress;
    const relevantUnits = progress
      ? progress.unitProgressList.filter(
          (unit) => unit.startDate <= range.end && (unit.completedDate || unit.lastTaughtLessonDate) >= range.start
        )
      : [];
    const laneByUnitId = timetableDisplayService.assignUnitLanes(relevantUnits, range);
    const today = getTodayDateKey();

    buildCalendarWeeks(range).forEach((week) => {
      wrapper.appendChild(renderCalendarProgressionWeekRow(week, today, relevantUnits, laneByUnitId, range));
    });

    if (progress && relevantUnits.length === 0) {
      const subjectLabel = progress.subjectId ? timetableDisplayService.resolveSubjectTitle(classroom, progress.subjectId) : 'any subject';
      wrapper.appendChild(
        createEmptyStateElement({ message: `No teaching recorded for ${subjectLabel} in ${formatYearMonth(state.anchorYearMonth)}.` })
      );
    }

    return wrapper;
  }

  function renderCalendarProgressionWeekRow(week, today, relevantUnits, laneByUnitId, range) {
    const weekEl = document.createElement('div');
    weekEl.className = 'timetable-view__calendar-week';

    week.forEach((dateKey, columnIndex) => {
      const cell = dateKey ? renderCalendarProgressionDateCell(dateKey, dateKey === today) : renderCalendarBlankCell();
      cell.style.gridColumn = String(columnIndex + 1);
      cell.style.gridRow = '1';
      weekEl.appendChild(cell);
    });

    const activeSegments = relevantUnits
      .map((unit) => ({ unit, segment: timetableDisplayService.computeUnitWeekSegment(unit, week) }))
      .filter(({ segment }) => segment !== null);

    // Locally compact row indices — see this function's own caller's
    // doc comment for why this remap exists.
    const usedLanes = [...new Set(activeSegments.map(({ unit }) => laneByUnitId.get(unit.unitId)))].sort((a, b) => a - b);

    activeSegments.forEach(({ unit, segment }) => {
      const strip = renderCalendarUnitStrip(unit, segment, range);
      strip.style.gridColumn = `${segment.startColumn + 1} / ${segment.endColumn + 2}`;
      strip.style.gridRow = String(usedLanes.indexOf(laneByUnitId.get(unit.unitId)) + 2);
      weekEl.appendChild(strip);
    });

    return weekEl;
  }

  /**
   * A calendar date cell — day number, today highlight, click -> Day
   * mode. Deliberately without any per-subject dot summary: the Unit
   * strips below already carry that information for every Calendar
   * scope now (All Subjects included), and repeating it on the cell
   * itself would be exactly the duplication this redesign avoids.
   * Also used, via renderCalendarBlankCell()'s own matching class, for
   * out-of-month padding cells — both must share the same sizing, or a
   * taller blank cell stretches its whole week row for nothing (the
   * exact bug this same fix corrects).
   */
  function renderCalendarProgressionDateCell(dateKey, isToday) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'timetable-view__calendar-cell timetable-view__calendar-cell--progression';
    if (isToday) cell.classList.add('timetable-view__calendar-cell--today');

    const dateLabel = document.createElement('span');
    dateLabel.className = 'timetable-view__calendar-date';
    dateLabel.textContent = String(Number(dateKey.split('-')[2]));
    cell.appendChild(dateLabel);

    cell.addEventListener('click', () => {
      state.viewMode = 'day';
      state.anchorDateKey = dateKey;
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });

    return cell;
  }

  /**
   * One Unit's strip segment within one calendar week — the primary
   * visual object this whole redesign is about. Deliberately static
   * (no click handler): per explicit product direction, a static
   * informative strip is preferable to introducing a new modal/
   * interaction model just to make it clickable. The full honest
   * detail (exact dates, "exact date unavailable" wording when
   * applicable, period count) lives in the native `title` tooltip —
   * a lightweight hover/focus detail, not a second place the same
   * numbers get duplicated in the DOM.
   *
   * Colored by `unit.subjectId` (set per-Unit by loadCalendarUnitProgress(),
   * not a single value shared by every strip) — required for "All
   * Subjects," where different strips genuinely belong to different
   * subjects; harmless in a specific-subject scope, where every Unit's
   * own subjectId is simply the one selected filter value anyway.
   * Soft subject-tinted fill (getTimetableSubjectWash(), the same
   * helper period cards already use) + a subject-colored border, never
   * a saturated solid block. Completion is communicated redundantly —
   * never color alone — via the ✓/→ mark, a solid vs dashed border,
   * AND the flush-vs-rounded continuation edges; a strip clipped by
   * ellipsis on a narrow (short-span) week still reads its status from
   * the border/edges alone.
   *
   * The subject name itself is only prefixed onto the strip's own
   * label in "All Subjects" scope (state.calendarSubjectFilter is
   * null) — in a specific-subject scope the filter/heading already
   * says which subject this whole Calendar is scoped to, so repeating
   * it on every single strip would be pure clutter, never new
   * information.
   */
  function renderCalendarUnitStrip(unit, segment, range) {
    const strip = document.createElement('div');
    strip.className = 'timetable-view__calendar-strip';
    if (unit.isCompleted) strip.classList.add('timetable-view__calendar-strip--completed');
    if (segment.continuesBefore) strip.classList.add('timetable-view__calendar-strip--continues-before');
    if (segment.continuesAfter) strip.classList.add('timetable-view__calendar-strip--continues-after');

    strip.style.backgroundColor = getTimetableSubjectWash(unit.subjectId);
    strip.style.borderColor = getTimetableSubjectColor(unit.subjectId).text;

    const isAllSubjects = !state.calendarSubjectFilter;
    const subjectPrefix = isAllSubjects ? `${timetableDisplayService.resolveSubjectTitle(classroom, unit.subjectId)} · ` : '';
    const statusMark = unit.isCompleted ? '✓' : '→';
    const periodsLabel = `${unit.periodsCount} period${unit.periodsCount === 1 ? '' : 's'}`;
    // Status mark placed right after the title (survives truncation on
    // most strips); period count placed last, per explicit direction
    // that it's the first thing allowed to disappear when a strip is
    // too narrow — plain CSS text-overflow handles that, no per-strip
    // width logic needed.
    strip.textContent = `${subjectPrefix}${unit.unitTitle} ${statusMark} · ${periodsLabel}`;
    strip.title = buildUnitStripTooltip(unit, range, isAllSubjects);

    return strip;
  }

  /** The strip's full, honest detail on hover/focus — exactly the same three-case wording (known completion date / completed but unavailable / still in progress) this redesign's own predecessor showed in a permanent list, now surfaced on demand instead of duplicated in the DOM. */
  function buildUnitStripTooltip(unit, range, includeSubject) {
    const startedBeforeRange = unit.startDate < range.start;
    const startLabel = startedBeforeRange ? `since ${formatDateKey(unit.startDate)}` : formatDateKey(unit.startDate);
    const periodsLabel = `${unit.periodsCount} period${unit.periodsCount === 1 ? '' : 's'}`;
    const titleLine = includeSubject ? `${timetableDisplayService.resolveSubjectTitle(classroom, unit.subjectId)} · ${unit.unitTitle}` : unit.unitTitle;

    if (unit.isCompleted && unit.completedDate) {
      return `${titleLine}\n${startLabel} → ${formatDateKey(unit.completedDate)} · Completed · ${periodsLabel}`;
    }
    if (unit.isCompleted) {
      return `${titleLine}\n${startLabel} → last taught ${formatDateKey(unit.lastTaughtLessonDate)} · Completed (exact date unavailable) · ${periodsLabel}`;
    }
    return `${titleLine}\n${startLabel} → in progress · last taught ${formatDateKey(unit.lastTaughtLessonDate)} · ${periodsLabel}`;
  }

  /**
   * "[ All Subjects ▾ ]" — the one control that changes Calendar's
   * SCOPE, never its visualization: "All Subjects" is the holistic
   * curriculum timeline (every subject's Units, each strip labeled
   * with its own subject — see renderCalendarUnitStrip()), a specific
   * subject is the same Unit-strip Calendar narrowed to just that
   * subject's own Units, plus its summary card
   * (renderCalendarSubjectSummary()). Both run through the exact same
   * renderCalendarProgressionWeeks() below. Options come from this
   * classroom's own recurring Timetable pattern (the same subjectIds
   * every period already uses) — not a second subject list, and not
   * Learning Management's own subject list, since a subject with a
   * Timetable slot is the only kind that can ever have anything to
   * show here.
   */
  function renderCalendarFilterRow() {
    const row = document.createElement('div');
    row.className = 'timetable-view__calendar-filter-row';

    const select = document.createElement('select');
    select.className = 'timetable-view__calendar-filter';

    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All Subjects';
    select.appendChild(allOption);

    const scheduledSubjectIds = [...new Set(timetableService.getTimetable(classroom).slots.map((slot) => slot.subjectId))];
    scheduledSubjectIds.forEach((subjectId) => {
      const option = document.createElement('option');
      option.value = subjectId;
      option.textContent = timetableDisplayService.resolveSubjectTitle(classroom, subjectId);
      select.appendChild(option);
    });

    select.value = state.calendarSubjectFilter || '';
    select.addEventListener('change', () => {
      state.calendarSubjectFilter = select.value || null;
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });
    row.appendChild(select);

    if (state.calendarSubjectFilter) {
      const heading = document.createElement('span');
      heading.className = 'timetable-view__calendar-filter-heading';
      heading.textContent = `${timetableDisplayService.resolveSubjectTitle(classroom, state.calendarSubjectFilter)} · ${formatYearMonth(state.anchorYearMonth)}`;
      row.appendChild(heading);
    }

    return row;
  }

  /**
   * The subject-specific summary card — units completed/in-progress
   * this month, teaching periods this month, and the average
   * periods-per-completed-unit, all read straight off
   * state.calendarProgress (populated by loadCalendarUnitProgress()).
   * Every number here is a direct field from that already-derived
   * data — nothing computed inline, so this function stays pure
   * presentation. A quiet month-over-month comparison line is added
   * only when there's something real to compare (never "0 vs 0").
   */
  function renderCalendarSubjectSummary() {
    // Reuses the existing .timetable-summary-card / __stats chrome
    // (the same "Weekly Overview" card Week/Day already show) rather
    // than a new card style — same surface, border, radius, and
    // big-number/small-label stat treatment, just a different set of
    // numbers.
    const card = document.createElement('div');
    card.className = 'timetable-summary-card timetable-view__calendar-summary';

    // render() only ever runs after loadCalendarUnitProgress() has
    // already resolved (loadAndRender() awaits it first) — so a null
    // state.calendarProgress here means the load genuinely failed
    // (see its own try/catch), not that it's still in flight.
    const progress = state.calendarProgress;
    if (!progress) {
      card.classList.add('timetable-view__calendar-summary--empty');
      card.textContent = "Couldn't load curriculum progress for this subject right now.";
      return card;
    }

    const { thisMonth, previousMonth } = progress;
    const stats = [
      { value: thisMonth.completedInRange.length, label: thisMonth.completedInRange.length === 1 ? 'unit completed' : 'units completed' },
      { value: thisMonth.inProgressInRange.length, label: thisMonth.inProgressInRange.length === 1 ? 'unit in progress' : 'units in progress' },
      { value: thisMonth.teachingPeriodsInRange, label: thisMonth.teachingPeriodsInRange === 1 ? 'teaching period' : 'teaching periods' },
    ];
    if (thisMonth.averagePeriodsPerCompletedUnit !== null) {
      stats.push({ value: thisMonth.averagePeriodsPerCompletedUnit.toFixed(1), label: 'avg. periods / unit' });
    }

    const statsRow = document.createElement('div');
    statsRow.className = 'timetable-summary-card__stats timetable-view__calendar-summary-stats';
    stats.forEach(({ value, label }) => {
      const stat = document.createElement('div');
      stat.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
      statsRow.appendChild(stat);
    });
    card.appendChild(statsRow);

    // Only shown when there's a real number on at least one side — a
    // "0 vs 0" comparison for a subject neither month touched is noise,
    // not information.
    if (thisMonth.completedInRange.length > 0 || previousMonth.completedInRange.length > 0) {
      const delta = thisMonth.completedInRange.length - previousMonth.completedInRange.length;
      const comparison = document.createElement('p');
      comparison.className = 'timetable-view__calendar-summary-comparison';
      const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '';
      const deltaText = delta === 0 ? 'Same as' : `${arrow} ${Math.abs(delta)} unit${Math.abs(delta) === 1 ? '' : 's'} vs`;
      comparison.textContent = `${deltaText} ${formatYearMonth(shiftYearMonth(state.anchorYearMonth, -1))} (${previousMonth.completedInRange.length} completed)`;
      card.appendChild(comparison);
    }

    return card;
  }

  /** An out-of-month padding cell — shares the exact same `--progression` sizing class as a real date cell (renderCalendarProgressionDateCell()) so it never stretches its week's own grid row taller than the real cells actually need. */
  function renderCalendarBlankCell() {
    const cell = document.createElement('div');
    cell.className = 'timetable-view__calendar-cell timetable-view__calendar-cell--blank timetable-view__calendar-cell--progression';
    return cell;
  }

  function renderEmptyCell() {
    const span = document.createElement('span');
    span.className = 'timetable-view__empty-cell';
    span.textContent = '—';
    return span;
  }

  /**
   * Phase P scope note: the reference's Day View shows a small
   * understanding-percentage ring on each taught period card. Not
   * added here — every visible card would need its own
   * hydrateConceptRecordsForConcepts() call (a real Firestore read per
   * card), not just the one currently-selected period's, which is a
   * real cost/architecture question ("hydrate every visible card's
   * feedback eagerly, on every render") beyond this phase's own
   * "primarily UI/CSS" scope and its explicit "do not overpopulate the
   * card" / "do not over-engineer" guidance. The existing taught-count
   * text (`3/4 taught`) is kept and restyled instead; flagged here for
   * a deliberate follow-up decision, not silently skipped.
   */
  function renderPeriodCard(slot) {
    const lesson = state.lessonsByTeachingSlotId[slot.id] || null;
    const color = getTimetableSubjectColor(slot.subjectId);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'timetable-period-card';
    card.style.background = getTimetableSubjectWash(slot.subjectId);
    if (slot.id === state.selectedTeachingSlotId) card.classList.add('timetable-period-card--selected');

    card.appendChild(renderSubjectBadge(timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId), color));

    const topic = timetableDisplayService.resolveLessonTopic(classroom, lesson);
    card.appendChild(renderLessonTopicLabel(topic));

    if (lesson) {
      const meta = document.createElement('span');
      meta.className = 'timetable-period-card__meta';
      meta.textContent = `${lesson.conceptIds.length} concept${lesson.conceptIds.length === 1 ? '' : 's'}`;
      card.appendChild(meta);

      const carriedIn = Object.keys(lesson.conceptProvenance || {}).length;
      const carriedOut = (lesson.carriedForwardConceptIds || []).length;
      if (lesson.executedConceptIds.length > 0) {
        const status = document.createElement('span');
        status.className = 'timetable-period-card__status';
        status.textContent = `${lesson.executedConceptIds.length}/${lesson.conceptIds.length} taught`;
        card.appendChild(status);
      } else if (carriedOut > 0) {
        const status = document.createElement('span');
        status.className = 'timetable-period-card__status timetable-period-card__status--carried';
        status.textContent = `→ carried forward`;
        card.appendChild(status);
      }
      if (carriedIn > 0) {
        const badge = document.createElement('span');
        badge.className = 'timetable-period-card__meta';
        badge.textContent = `${carriedIn} carried in`;
        card.appendChild(badge);
      }
    }

    card.addEventListener('click', async () => {
      const isNewSelection = state.selectedTeachingSlotId !== slot.id;
      state.selectedTeachingSlotId = isNewSelection ? slot.id : null;
      if (isNewSelection) state.activeDetailTab = 'overview'; // always land on Overview for a freshly-opened period
      await hydrateSelectedLessonFeedback();
      rerenderCurrentRange();
    });

    return card;
  }

  function renderLegend() {
    const legend = document.createElement('div');
    legend.className = 'timetable-view__legend';
    [
      { className: 'timetable-legend__dot--completed', label: 'Completed' },
      { className: 'timetable-legend__dot--partial', label: 'Partially covered / Needs attention' },
      { className: 'timetable-legend__dot--carried', label: 'Not covered / Carried forward' },
      { className: 'timetable-legend__dot--none', label: 'Not yet taught' },
    ].forEach(({ className, label }) => {
      const item = document.createElement('span');
      item.className = 'timetable-view__legend-item';
      const dot = document.createElement('span');
      dot.className = `timetable-legend__dot ${className}`;
      item.appendChild(dot);
      item.append(label);
      legend.appendChild(item);
    });
    return legend;
  }

  function renderSummaryRow(slots) {
    const row = document.createElement('div');
    row.className = 'timetable-view__summary-row';
    row.appendChild(renderWeeklyOverviewCard(slots));
    return row;
  }

  function renderWeeklyOverviewCard(slots) {
    const card = document.createElement('div');
    card.className = 'timetable-summary-card';
    const title = document.createElement('h3');
    title.textContent = 'Weekly Overview';
    card.appendChild(title);

    const lessons = slots.map((slot) => state.lessonsByTeachingSlotId[slot.id]).filter(Boolean);
    const planned = lessons.reduce((sum, lesson) => sum + lesson.conceptIds.length, 0);
    const executed = lessons.reduce((sum, lesson) => sum + lesson.executedConceptIds.length, 0);
    const carried = lessons.reduce((sum, lesson) => sum + (lesson.carriedForwardConceptIds || []).length, 0);

    const stats = document.createElement('div');
    stats.className = 'timetable-summary-card__stats';
    stats.innerHTML = `
      <div><strong>${planned}</strong><span>Concepts planned</span></div>
      <div><strong>${executed}</strong><span>Executed</span></div>
      <div><strong>${carried}</strong><span>Carried Forward</span></div>
    `;
    card.appendChild(stats);
    return card;
  }

  function renderPeriodDetailPanel(slot, lesson) {
    const panel = document.createElement('div');
    panel.className = 'period-detail-panel';

    const header = document.createElement('div');
    header.className = 'period-detail-panel__header';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.appendChild(createIcon('x', { size: 18 }));
    closeButton.addEventListener('click', () => {
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });
    header.appendChild(closeButton);
    const periodInfo = document.createElement('span');
    periodInfo.textContent = `Period ${slot.periodNumber} · ${formatDateKey(slot.date)} · ${timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId)}`;
    header.appendChild(periodInfo);
    panel.appendChild(header);

    // Phase V — a subtle subject-wash "lesson header card", the same
    // shared wash every other schedule surface now uses (grid cells,
    // Today's Schedule rows) — reusing renderSubjectBadge() too, so the
    // badge itself stays byte-identical everywhere as well.
    const lessonHeaderCard = document.createElement('div');
    lessonHeaderCard.className = 'period-detail-panel__lesson-header';
    lessonHeaderCard.style.background = getTimetableSubjectWash(slot.subjectId);
    lessonHeaderCard.appendChild(renderSubjectBadge(timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId), getTimetableSubjectColor(slot.subjectId)));
    panel.appendChild(lessonHeaderCard);

    if (!lesson) {
      panel.appendChild(renderAttachLessonForm(slot));
      return panel;
    }

    const topic = timetableDisplayService.resolveLessonTopic(classroom, lesson);
    const topicRow = document.createElement('div');
    topicRow.className = 'period-detail-panel__topic-row';
    const topicEl = document.createElement('h2');
    topicEl.textContent = topic || '(untitled lesson)';
    topicRow.appendChild(topicEl);

    // Unobtrusive — deliberately .btn--text (same subtle weight as
    // "+ Attach lesson"), never competing with the topic heading itself.
    const editLessonButton = document.createElement('button');
    editLessonButton.type = 'button';
    editLessonButton.className = 'btn btn--text period-detail-panel__edit-lesson';
    editLessonButton.textContent = 'Edit lesson';
    editLessonButton.addEventListener('click', () => openEditLessonUnitFlow(slot, lesson));
    topicRow.appendChild(editLessonButton);

    lessonHeaderCard.appendChild(topicRow);

    // Phase P — tab navigation (Overview / Concepts / Student Resources /
    // Lesson Plan / Reflection), per the approved reference. Reduces the
    // previous single continuous scroll's visual density; no data is
    // duplicated between tabs — each tab reads the same `lesson`/
    // `classroom` objects and the same already-computed feedback
    // summary, just scoped to what that tab actually needs.
    //
    // Student Resources and Lesson Plan are deliberately two separate
    // tabs, never one combined "Resources" tab — per explicit product
    // direction, a lesson plan is exclusively teacher-facing ("what do
    // I, the teacher, use to teach it?") while a resource here is
    // student-facing ("what can/should students use?"), and those two
    // questions must never share one nav destination even when visually
    // adjacent. See loadStudentResourcesTab()/loadLessonPlanTab() below.
    const concepts = timetableDisplayService.resolveLessonConcepts(classroom, lesson);
    const tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'concepts', label: `Concepts (${concepts.length})` },
      { id: 'studentResources', label: 'Student Resources' },
      { id: 'lessonPlan', label: 'Lesson Plan' },
      { id: 'reflection', label: 'Reflection' },
    ];
    const tabBar = document.createElement('div');
    tabBar.className = 'period-detail-panel__tabs';
    tabs.forEach(({ id, label }) => {
      const tabButton = document.createElement('button');
      tabButton.type = 'button';
      tabButton.className = 'period-detail-panel__tab';
      if (state.activeDetailTab === id) tabButton.classList.add('period-detail-panel__tab--active');
      tabButton.textContent = label;
      tabButton.addEventListener('click', () => {
        state.activeDetailTab = id;
        rerenderCurrentRange();
      });
      tabBar.appendChild(tabButton);
    });
    panel.appendChild(tabBar);

    const tabContent = document.createElement('div');
    tabContent.className = 'period-detail-panel__tab-content';
    if (state.activeDetailTab === 'concepts') {
      tabContent.appendChild(renderConceptsTab(slot, lesson));
    } else if (state.activeDetailTab === 'studentResources') {
      tabContent.appendChild(renderResourcesTabPlaceholder());
      loadStudentResourcesTab(tabContent, slot, lesson);
    } else if (state.activeDetailTab === 'lessonPlan') {
      tabContent.appendChild(renderResourcesTabPlaceholder());
      loadLessonPlanTab(tabContent, slot, lesson);
    } else if (state.activeDetailTab === 'reflection') {
      tabContent.appendChild(renderReflectionSection(lesson));
    } else {
      tabContent.appendChild(renderOverviewTab(slot, lesson, topic));
    }
    panel.appendChild(tabContent);

    return panel;
  }

  /**
   * Overview — the highest-level summary of this period, per Phase P's
   * own explicit content list: response rate, the Overall Understanding
   * ring, the 4-tier breakdown, the combined Got it + Can teach metric,
   * a concise concept summary, the carry-forward callout (if anything
   * needs it), and the share-feedback action. Nothing here is computed
   * separately from Concepts/Reflection's own data — same `lesson`,
   * same conceptFeedbackService summary object.
   */
  function renderOverviewTab(slot, lesson, topic) {
    const wrapper = document.createElement('div');
    wrapper.className = 'period-detail-panel__overview';

    if (lesson.executedConceptIds.length > 0) {
      const summary = conceptFeedbackService.getLessonFeedbackSummary(classroom, lesson);

      const responseRow = document.createElement('div');
      responseRow.className = 'period-detail-panel__overview-top';

      // RESPONSE RATE and UNDERSTANDING stay two visibly separate
      // metrics, never collapsed into one number — per explicit
      // product decision (see conceptFeedbackService.js's own header
      // comment). The ring is a SUMMARY VISUALIZATION of the existing
      // combinedPositivePercent metric — not a new calculation, and
      // not a replacement for the 4-tier breakdown rendered below it.
      const responseRate = document.createElement('p');
      responseRate.className = 'period-detail-panel__responded';
      responseRate.innerHTML = `<strong>Response Rate</strong> ${summary.respondedStudentCount}/${summary.totalStudents} responded`;
      responseRow.appendChild(responseRate);
      responseRow.appendChild(renderUnderstandingRing(summary.combinedPositivePercent));
      wrapper.appendChild(responseRow);

      wrapper.appendChild(renderFeedbackSummaryCards(summary));
      wrapper.appendChild(renderShareFeedbackSection(slot, lesson, topic));
    }

    wrapper.appendChild(renderConceptSummaryList(lesson));

    const carryCallout = renderCarryForwardCallout(slot, lesson);
    if (carryCallout) wrapper.appendChild(carryCallout);

    return wrapper;
  }

  /**
   * A conic-gradient ring (no SVG/canvas needed) showing one summary
   * percentage in the ring's own fill, with the number centered inside
   * — the exact visualization the reference's own "Overall
   * Understanding" circle shows. `percent` is always a value already
   * computed by conceptFeedbackService.js; this function only draws it.
   */
  function renderUnderstandingRing(percent) {
    const wrapper = document.createElement('div');
    wrapper.className = 'understanding-ring';
    wrapper.style.setProperty('--ring-percent', String(percent));
    const inner = document.createElement('div');
    inner.className = 'understanding-ring__inner';
    const value = document.createElement('strong');
    value.textContent = `${percent}%`;
    const label = document.createElement('span');
    label.textContent = 'Overall Understanding';
    inner.append(value, label);
    wrapper.appendChild(inner);
    return wrapper;
  }

  /** A compact, read-only list of this lesson's own planned concepts and their taught status — the "concise concept summary" Overview needs; the full interactive picker (checkboxes, Carry Forward buttons) lives only in the Concepts tab, not duplicated here. */
  function renderConceptSummaryList(lesson) {
    const section = document.createElement('div');
    section.className = 'period-detail-panel__concept-summary';
    const title = document.createElement('h3');
    title.textContent = `Planned Concepts (${lesson.conceptIds.length})`;
    section.appendChild(title);

    const concepts = timetableDisplayService.resolveLessonConcepts(classroom, lesson);
    const executedSet = new Set(lesson.executedConceptIds);
    const carriedSet = new Set(lesson.carriedForwardConceptIds || []);

    concepts.forEach(({ id, title: conceptTitle }) => {
      const row = document.createElement('div');
      row.className = 'period-detail-panel__concept-row';
      const label = document.createElement('span');
      label.textContent = conceptTitle;
      row.appendChild(label);

      const status = document.createElement('span');
      status.className = 'period-detail-panel__concept-status';
      if (carriedSet.has(id)) {
        status.classList.add('period-detail-panel__concept-status--carried');
        status.textContent = 'Carried Forward';
      } else if (executedSet.has(id)) {
        status.classList.add('period-detail-panel__concept-status--taught');
        status.textContent = 'Taught';
      } else {
        status.classList.add('period-detail-panel__concept-status--pending');
        status.textContent = 'Not taught';
      }
      row.appendChild(status);
      section.appendChild(row);
    });

    return section;
  }

  /** The Overview's own carry-forward callout — only rendered when at least one concept genuinely still needs a decision (unexecuted, not yet carried). Opens the same openCarryForwardFlow() the Concepts tab's own per-concept button does; never a second implementation. */
  function renderCarryForwardCallout(slot, lesson) {
    const executedSet = new Set(lesson.executedConceptIds);
    const carriedSet = new Set(lesson.carriedForwardConceptIds || []);
    const concepts = timetableDisplayService.resolveLessonConcepts(classroom, lesson);
    const pending = concepts.filter(({ id }) => !executedSet.has(id) && !carriedSet.has(id));
    if (pending.length === 0) return null;

    const callout = document.createElement('div');
    callout.className = 'period-detail-panel__carry-callout';

    const iconBadge = document.createElement('span');
    iconBadge.className = 'period-detail-panel__carry-callout-icon';
    iconBadge.appendChild(createIcon('undo-2', { size: 18 }));
    callout.appendChild(iconBadge);

    const textWrap = document.createElement('div');
    textWrap.className = 'period-detail-panel__carry-callout-text';
    const title = document.createElement('strong');
    title.textContent = 'Carry Forward';
    const desc = document.createElement('span');
    desc.textContent = `${pending.length} concept${pending.length === 1 ? '' : 's'} to carry forward`;
    textWrap.append(title, desc);
    callout.appendChild(textWrap);

    if (pending.length === 1) {
      const moveButton = document.createElement('button');
      moveButton.type = 'button';
      moveButton.className = 'btn btn--secondary period-detail-panel__carry-callout-action';
      moveButton.textContent = 'Move';
      moveButton.addEventListener('click', () => openCarryForwardFlow(slot, lesson, pending[0].id, pending[0].title));
      callout.appendChild(moveButton);
    }

    return callout;
  }

  /** "Share feedback with students" — becomes a confirmed, disabled state once lesson.feedbackSharedAt is set, per explicit instruction that the teacher must get clear confirmation and never re-trigger a duplicate share by accident. */
  function renderShareFeedbackSection(slot, lesson, topic) {
    const section = document.createElement('div');
    section.className = 'period-detail-panel__share';

    if (lesson.feedbackSharedAt) {
      const confirmed = document.createElement('p');
      confirmed.className = 'period-detail-panel__share-confirmed';
      confirmed.textContent = `✓ Feedback shared with students on ${new Date(lesson.feedbackSharedAt).toLocaleString()}`;
      section.appendChild(confirmed);
      return section;
    }

    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'btn btn--primary';
    shareButton.textContent = 'Share feedback with students';
    shareButton.addEventListener('click', () =>
      runAction(async () => {
        const subjectTitle = timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId);
        await timetableLessonService.shareFeedbackWithStudents(classroom, lesson, { subjectTitle, topic });
        workspaceService.save(classroom);
        window.alert('Feedback has been shared with your students.');
        await loadAndRender();
      })
    );
    section.appendChild(shareButton);

    return section;
  }

  /**
   * STEP 1 of the period workflow — Assign Unit. Deliberately just the
   * unit picker plus one primary action; Concepts, Student Resources,
   * and Lesson Plan are their own separate steps/tabs, reached only
   * once a Unit is assigned (see renderConceptsTab()'s own STATE A
   * empty state and renderResourcesTabPlaceholder()/
   * loadStudentResourcesTab()/loadLessonPlanTab() below) — never
   * bundled into this same form. Per explicit product direction: a
   * Learning Hub concept card is a STUDENT-facing resource, not a
   * teacher-facing "lesson plan," and belongs under Student Resources,
   * never here and never under Lesson Plan.
   *
   * Still creates the same models/Lesson.js record
   * (services/timetableLessonService.js's attachLessonPlan(), unchanged)
   * — just always with `conceptIds: []`, since concepts are no longer
   * collected in this same step. That function's name is a pre-existing
   * misnomer (confirmed directly: there is no separate "lesson plan"
   * content artifact anywhere in this codebase — a Lesson has only
   * `curriculumUnitId`/`conceptIds`); nothing about its own behavior or
   * the underlying Lesson document changes here.
   *
   * Phase T's own placeholder-option fix is preserved verbatim: the
   * unit `<select>` starts on a disabled placeholder, and "Assign Unit"
   * stays disabled until a teacher deliberately picks a real one —
   * never a silently-selected first unit.
   */
  function renderAttachLessonForm(slot) {
    const wrapper = document.createElement('div');
    wrapper.className = 'period-detail-panel__attach';

    const learningSubject = timetableDisplayService.findLearningSubjectByCanonicalId(classroom, slot.subjectId);
    if (!learningSubject || learningSubject.units.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No units set up yet for this subject in Learning Management.';
      wrapper.appendChild(empty);
      return wrapper;
    }

    const unitLabel = document.createElement('label');
    unitLabel.className = 'period-detail-panel__attach-label';
    unitLabel.textContent = 'Unit / Topic';
    wrapper.appendChild(unitLabel);

    const unitSelect = document.createElement('select');
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = '— Choose a unit —';
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    unitSelect.appendChild(placeholderOption);
    learningSubject.units.forEach((unit) => {
      const option = document.createElement('option');
      option.value = unit.id;
      option.textContent = unit.title;
      unitSelect.appendChild(option);
    });
    wrapper.appendChild(unitSelect);

    const attachButton = document.createElement('button');
    attachButton.type = 'button';
    attachButton.className = 'btn btn--primary';
    attachButton.textContent = 'Assign Unit';
    attachButton.disabled = true;

    unitSelect.addEventListener('change', () => {
      attachButton.disabled = !unitSelect.value;
    });

    attachButton.addEventListener('click', () =>
      runAction(async () => {
        await timetableLessonService.attachLessonPlan(classroom, {
          teachingSlotId: slot.id,
          date: slot.date,
          curriculumUnitId: unitSelect.value,
          conceptIds: [],
        });
        await loadAndRender();
      })
    );

    wrapper.appendChild(attachButton);

    return wrapper;
  }

  /**
   * Phase V — lets a teacher correct an already-attached lesson's own
   * unit/topic (e.g. the wrong unit was picked when attaching) without
   * touching the recurring timetable pattern at all. Mirrors
   * openCarryForwardFlow()'s / openManageTimetableFlow()'s own overlay
   * shell (document.body.appendChild(overlay), a re-render function, a
   * Cancel that just removes the overlay).
   *
   * Only ever mutates and saves THIS ONE Lesson document —
   * plannerRepository.saveLesson() writes a single Lesson by its own
   * id, completely separate from classroom.timetable (see
   * timetableService.js's own model doc comment) and from every other
   * dated occurrence's own Lesson (each has its own unique
   * teachingSlotId/id) — so this structurally cannot touch the
   * recurring pattern or any other date's Lesson, not just by
   * convention but because there is no code path here that ever
   * reaches either.
   *
   * The current unit is pre-selected (the opposite of Attach Lesson's
   * own forced-placeholder rule) — here the teacher is correcting an
   * EXISTING, already-deliberate choice, not making a fresh one, so
   * showing what's already saved is the honest default. Changing to a
   * DIFFERENT unit (including "None") clears this lesson's concept-
   * related fields (see resetLessonForUnitChange() below) rather than
   * silently carrying concepts that belong to the old unit's id-space
   * into the new one — a concept id from one unit is meaningless
   * against another, and equally meaningless against no unit at all.
   *
   * "None" (value `''`) is a normal first option, exactly like every
   * other choice here — selecting it and saving runs through the
   * exact same resetLessonForUnitChange()/saveLesson() path as picking
   * a different real unit, just with `newUnitId` normalized to `null`
   * (this model's own established "intentionally empty" convention —
   * see models/Lesson.js's own createLesson() doc comment on why
   * `null`, never `undefined`, for optional fields Firestore must
   * accept). Once saved, `curriculumUnitId: null` naturally drops this
   * Lesson out of the OLD unit's own plannerRepository.getLessonsForUnit()
   * query (a live equality filter on the current field value, not a
   * cached association) — so the Calendar's curriculum-progress view
   * (see timetableDisplayService.js's deriveUnitProgress()) already
   * stops counting it correctly, with no Calendar-side change needed.
   */
  function openEditLessonUnitFlow(slot, lesson) {
    const learningSubject = timetableDisplayService.findLearningSubjectByCanonicalId(classroom, slot.subjectId);

    const overlay = document.createElement('div');
    overlay.className = 'carry-forward-overlay';
    const box = document.createElement('div');
    box.className = 'carry-forward-overlay__box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const eyebrow = document.createElement('p');
    eyebrow.className = 'carry-forward-overlay__eyebrow';
    eyebrow.textContent = 'EDIT LESSON';
    box.appendChild(eyebrow);

    const heading = document.createElement('h3');
    heading.className = 'carry-forward-overlay__concept';
    heading.textContent = timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId);
    box.appendChild(heading);

    // Makes explicit which ONE dated occurrence this edits — without
    // this, "EDIT LESSON" + a bare subject name reads as if it might
    // touch the whole recurring Science slot, not just this Thursday's
    // lesson. Matches this overlay's own doc comment above: only ever
    // this one Lesson document, never classroom.timetable or any other
    // date's occurrence.
    const subheading = document.createElement('p');
    subheading.className = 'period-detail-panel__attach-hint';
    subheading.textContent = `Period ${slot.periodNumber} · ${formatDateKey(slot.date)} — this date only`;
    box.appendChild(subheading);

    const unitLabel = document.createElement('label');
    unitLabel.className = 'period-detail-panel__attach-label';
    unitLabel.textContent = 'Unit / Topic';
    box.appendChild(unitLabel);

    const unitSelect = document.createElement('select');
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    unitSelect.appendChild(noneOption);
    (learningSubject?.units || []).forEach((unit) => {
      const option = document.createElement('option');
      option.value = unit.id;
      option.textContent = unit.title;
      unitSelect.appendChild(option);
    });
    unitSelect.value = lesson.curriculumUnitId || '';
    box.appendChild(unitSelect);

    const actions = document.createElement('div');
    actions.className = 'carry-forward-overlay__actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--ghost';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => overlay.remove());
    actions.appendChild(cancelButton);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--primary';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () =>
      runAction(async () => {
        // '' (the "None" option) normalizes to null — this model's own
        // existing convention for "intentionally empty" (never
        // undefined, which Firestore's setDoc() rejects outright).
        const newUnitId = unitSelect.value || null;
        if (newUnitId === (lesson.curriculumUnitId || null)) {
          overlay.remove();
          return; // unchanged — nothing to save, per "changes only this lesson record" (never a no-op write)
        }

        if (lesson.conceptIds.length > 0) {
          const proceed = window.confirm(
            `Changing the unit will clear this lesson's ${lesson.conceptIds.length} assigned concept(s), since they belong to the old unit. Continue?`
          );
          if (!proceed) return;
        }

        resetLessonForUnitChange(lesson, newUnitId);

        await plannerRepository.saveLesson(classroom.id, lesson);
        overlay.remove();
        await loadAndRender();
      })
    );
    actions.appendChild(saveButton);

    box.appendChild(actions);
  }

  /**
   * The Concepts tab's "+ Add concept" action once at least one
   * concept is already attached (STATE C — see renderConceptsTab()
   * above). A modal, unlike the initial empty-state prompt (which can
   * safely replace itself in place, since there's nothing else on the
   * tab yet to preserve) — the already-attached concept rows need to
   * stay visible/in context behind this, not be replaced by the
   * picker. Wraps the exact same renderConceptPicker() the empty state
   * uses below: one shared picker, one shared "select existing vs.
   * create new" behavior, never a second implementation.
   *
   * Only ever mutates and saves THIS lesson's own conceptIds — the
   * same "one Lesson document, never classroom.timetable, never
   * another date's Lesson" guarantee as openEditLessonUnitFlow() above.
   */
  /**
   * "+ Add concept" from the normal (STATE B/C) Concepts list — a
   * temporary overlay, not a separate destination. Per explicit
   * product direction, picking or creating a concept inside
   * renderConceptPicker() below closes this overlay immediately
   * (`onAssigned: () => overlay.remove()`) — the teacher lands straight
   * back on the normal Concepts list with the new concept already
   * visible, never a separate "Done" step. The one remaining button
   * here (Cancel) is a pure bail-out for closing without picking
   * anything — not a required step, and not shown as "Done" so it's
   * never mistaken for one.
   */
  function openAddConceptFlow(slot, lesson) {
    const learningSubject = timetableDisplayService.findLearningSubjectByCanonicalId(classroom, slot.subjectId);
    const unit = learningSubject?.units.find((u) => u.id === lesson.curriculumUnitId);

    const overlay = document.createElement('div');
    overlay.className = 'carry-forward-overlay add-concept-overlay';
    const box = document.createElement('div');
    box.className = 'carry-forward-overlay__box add-concept-overlay__box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const eyebrow = document.createElement('p');
    eyebrow.className = 'carry-forward-overlay__eyebrow';
    eyebrow.textContent = 'ADD CONCEPTS';
    box.appendChild(eyebrow);

    const heading = document.createElement('h3');
    heading.className = 'carry-forward-overlay__concept';
    heading.textContent =
      timetableDisplayService.resolveLessonTopic(classroom, lesson) || timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId);
    box.appendChild(heading);

    const subheading = document.createElement('p');
    subheading.className = 'period-detail-panel__attach-hint';
    subheading.textContent = `Period ${slot.periodNumber} · ${formatDateKey(slot.date)}`;
    box.appendChild(subheading);

    if (unit) {
      box.appendChild(renderConceptPicker(unit, lesson, { onAssigned: () => overlay.remove() }));
    } else {
      const hint = document.createElement('p');
      hint.className = 'period-detail-panel__attach-hint';
      hint.textContent = 'This lesson’s unit could not be found.';
      box.appendChild(hint);
    }

    const actions = document.createElement('div');
    actions.className = 'carry-forward-overlay__actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--ghost';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => overlay.remove());
    actions.appendChild(cancelButton);
    box.appendChild(actions);
  }

  function renderFeedbackSummaryCards(summary) {
    const wrapper = document.createElement('div');
    wrapper.className = 'period-detail-panel__understanding';

    const heading = document.createElement('p');
    heading.className = 'period-detail-panel__understanding-heading';
    heading.textContent = 'Understanding';
    wrapper.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'period-detail-panel__feedback-summary';
    [
      { key: 'need_help', label: 'Not yet' },
      { key: 'understand', label: 'Partly' },
      { key: 'confident', label: 'Got it' },
      { key: 'can_teach', label: 'Can teach' },
    ].forEach(({ key, label }) => {
      const card = document.createElement('div');
      card.className = 'feedback-summary-card';
      card.innerHTML = `<strong>${summary.tierCounts[key] || 0}</strong><span>${label}</span><em>${summary.tierPercentages[key] || 0}%</em>`;
      row.appendChild(card);
    });
    wrapper.appendChild(row);

    // The reference's own "useful combined measure" — kept as an
    // ADDITIONAL line below the per-tier breakdown, never a
    // replacement for it, and never merged with Response Rate above.
    const combined = document.createElement('p');
    combined.className = 'period-detail-panel__combined-metric';
    combined.innerHTML = `<strong>Got it + Can teach</strong> ${summary.combinedPositiveCount}/${summary.totalResponses} · ${summary.combinedPositivePercent}%`;
    wrapper.appendChild(combined);

    return wrapper;
  }

  /**
   * The Concepts tab. There are only two teaching-status COLORS —
   * PENDING (yellow: assigned, not yet covered in this period) and
   * COVERED (green: taught) — read straight off the existing
   * lesson.executedConceptIds field (see models/Lesson.js); no new
   * concept-state model. "Assigned to this period" (lesson.conceptIds
   * membership, managed by renderConceptPicker()/openAddConceptFlow()
   * above) and "taught status" (executedConceptIds) stay the two
   * separate, independent things they already were — this tab just
   * never conflates them the way a single "selected" checkbox did.
   *
   * Carried-forward (lesson.carriedForwardConceptIds) is NOT a third
   * color — per explicit product direction, and confirmed against
   * models/Lesson.js's own carryForwardConcept(): that function throws
   * if the concept is already executed, so a carried concept is
   * guaranteed, by construction, to always still be un-executed here —
   * exactly the same "not covered in this period" condition PENDING
   * already means. A carried concept renders on the same yellow card,
   * just with a small muted "Carried forward" tag INSTEAD of the
   * Mark covered / Carry forward actions (see renderConceptCard()
   * below) — never its own background color, and never both actions
   * either: marking a carried concept covered here would contradict
   * it also being queued on a future lesson, and carrying it forward a
   * second time is something carryForwardConcept() itself refuses.
   *
   * This is the Concepts tab's own presentation choice only — the
   * Overview tab's separate renderConceptSummaryList() keeps its own,
   * unrelated "Taught / Carried Forward / Not taught" text-label
   * styling exactly as it was, untouched by this redesign.
   *
   * The per-concept positivePercent/respondedCount shown next to a
   * covered concept was already computed by
   * conceptFeedbackService.js's own getLessonFeedbackSummary() (its
   * `conceptStats` array) — unchanged, just re-homed into the new card
   * layout.
   */
  function renderConceptsTab(slot, lesson) {
    const section = document.createElement('div');
    section.className = 'period-detail-panel__concepts';

    const concepts = timetableDisplayService.resolveLessonConcepts(classroom, lesson);

    if (concepts.length === 0) {
      section.appendChild(renderNoConceptsEmptyState(slot, lesson));
      return section;
    }

    const conceptStatsById = new Map();
    if (lesson.executedConceptIds.length > 0) {
      conceptFeedbackService.getLessonFeedbackSummary(classroom, lesson).conceptStats.forEach((stat) => {
        conceptStatsById.set(stat.conceptId, stat);
      });
    }

    const executedSet = new Set(lesson.executedConceptIds);
    const carriedSet = new Set(lesson.carriedForwardConceptIds || []);
    const pendingCount = concepts.filter(({ id }) => !executedSet.has(id) && !carriedSet.has(id)).length;

    concepts.forEach(({ id, title: conceptTitle }) => {
      section.appendChild(
        renderConceptCard({
          slot,
          lesson,
          id,
          conceptTitle,
          executed: executedSet.has(id),
          carried: carriedSet.has(id),
          stat: conceptStatsById.get(id),
        })
      );
    });

    const footerActions = document.createElement('div');
    footerActions.className = 'period-detail-panel__concepts-footer-actions';

    // Adding more reuses the exact same shared renderConceptPicker()
    // the initial empty-state prompt uses, in a modal (see
    // openAddConceptFlow()'s own header comment) since the attached-
    // concepts list above needs to stay visible/in-context, not be
    // replaced by the picker the way the empty state can afford to.
    const addMoreButton = document.createElement('button');
    addMoreButton.type = 'button';
    addMoreButton.className = 'btn btn--text';
    addMoreButton.textContent = '+ Add concept';
    addMoreButton.addEventListener('click', () => openAddConceptFlow(slot, lesson));
    footerActions.appendChild(addMoreButton);

    // A secondary, low-emphasis bulk action — replaces the old
    // checkbox-selection + "Mark concepts as covered" button entirely
    // (per explicit product direction that a teacher should never have
    // to select concepts just to mark them covered). Only shown once
    // there's genuinely more than one pending concept to act on; never
    // touches an already-carried-forward concept (see below).
    if (pendingCount > 1) {
      const markAllButton = document.createElement('button');
      markAllButton.type = 'button';
      markAllButton.className = 'btn btn--text';
      markAllButton.textContent = 'Mark all covered';
      markAllButton.addEventListener('click', () =>
        runAction(async () => {
          // Every non-carried concept, not literally every concept —
          // a carried-forward concept was deferred to a later period,
          // never taught here, and must never be silently marked
          // covered by a bulk action (matches this same exclusion the
          // per-concept "Mark covered" button already applies one at a
          // time).
          const idsToMark = concepts.filter(({ id }) => !carriedSet.has(id)).map(({ id }) => id);
          await timetableLessonService.markConceptsExecuted(classroom, lesson, idsToMark);
          workspaceService.save(classroom);
          rerenderCurrentRange();
        })
      );
      footerActions.appendChild(markAllButton);
    }

    section.appendChild(footerActions);

    return section;
  }

  /**
   * One concept card — PENDING (yellow) or COVERED (green), read off
   * `executed` alone (see renderConceptsTab()'s own header comment for
   * why carried-forward is never its own color). The background-color
   * coding IS the status indicator, not a decorative accent — per
   * explicit product direction, a teacher should be able to tell a
   * period's teaching progress at a glance without reading every row.
   *
   * A carried concept (`carried` true) is always PENDING-colored (the
   * data model guarantees it's never `executed` — see
   * models/Lesson.js's own carryForwardConcept()) but gets a small
   * muted "Carried forward" tag INSTEAD of the Mark covered/Carry
   * forward actions, never both: a carried concept has already been
   * deferred to a future lesson, so there's nothing left to do with it
   * here. A plain COVERED card (not carried) gets neither the tag nor
   * any actions.
   */
  function renderConceptCard({ slot, lesson, id, conceptTitle, executed, carried, stat }) {
    const stateClass = executed ? 'period-detail-panel__concept-card--covered' : 'period-detail-panel__concept-card--pending';

    const card = document.createElement('div');
    card.className = `period-detail-panel__concept-card ${stateClass}`;

    const main = document.createElement('div');
    main.className = 'period-detail-panel__concept-card-main';

    const title = document.createElement('span');
    title.className = 'period-detail-panel__concept-card-title';
    title.textContent = conceptTitle;
    main.appendChild(title);

    if (stat) {
      const feedback = document.createElement('span');
      feedback.className = 'period-detail-panel__concept-feedback';
      feedback.textContent = `${stat.respondedCount}/${stat.totalStudents} · ${stat.positivePercent}%`;
      main.appendChild(feedback);
    }

    if (carried) {
      const tag = document.createElement('span');
      tag.className = 'period-detail-panel__concept-card-carried-tag';
      tag.textContent = 'Carried forward';
      main.appendChild(tag);
    }
    card.appendChild(main);

    if (!carried && !executed) {
      const actions = document.createElement('div');
      actions.className = 'period-detail-panel__concept-card-actions';

      const markCoveredButton = document.createElement('button');
      markCoveredButton.type = 'button';
      markCoveredButton.className = 'btn btn--text';
      markCoveredButton.textContent = 'Mark covered';
      markCoveredButton.addEventListener('click', () =>
        runAction(async () => {
          await timetableLessonService.markConceptsExecuted(classroom, lesson, [...lesson.executedConceptIds, id]);
          workspaceService.save(classroom);
          rerenderCurrentRange();
        })
      );
      actions.appendChild(markCoveredButton);

      const separator = document.createElement('span');
      separator.className = 'period-detail-panel__concept-card-actions-sep';
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '·';
      actions.appendChild(separator);

      // Carry Forward only ever appears here — a PENDING, not-yet-
      // carried concept — per explicit product direction: a COVERED
      // concept has already been taught, and an already-carried one is
      // something models/Lesson.js's own carryForwardConcept() itself
      // refuses to carry a second time.
      const carryButton = document.createElement('button');
      carryButton.type = 'button';
      carryButton.className = 'btn btn--text';
      carryButton.textContent = 'Carry forward';
      carryButton.addEventListener('click', () => openCarryForwardFlow(slot, lesson, id, conceptTitle));
      actions.appendChild(carryButton);

      card.appendChild(actions);
    }

    return card;
  }

  /**
   * STATE A's empty state — "No concepts added yet." + an explicit
   * "+ Add concept" action, reusing the exact same
   * `.period-detail-panel__attach-hint` / `.period-detail-panel__concept-picker`
   * classes Phase T's Attach Lesson form already established, so this
   * reads as the same mechanism rather than a second one. The lesson's
   * unit (curriculumUnitId) is already fixed at this point (a lesson
   * always has one — see models/Lesson.js) — no unit re-selection
   * needed here, only which of that unit's concepts to assign.
   *
   * Assigning the first concept flips this tab from STATE A to STATE
   * B/C on its own — renderConceptPicker()'s own toggle calls
   * rerenderCurrentRange(), which re-invokes renderConceptsTab() from
   * scratch, and that function's own concepts.length check then
   * naturally renders the normal attached-concepts list instead of
   * this empty state. No explicit transition needed here.
   */
  function renderNoConceptsEmptyState(slot, lesson) {
    const wrapper = document.createElement('div');

    function renderPrompt() {
      wrapper.innerHTML = '';

      const empty = document.createElement('p');
      empty.className = 'period-detail-panel__attach-hint';
      empty.textContent = 'No concepts added yet.';
      wrapper.appendChild(empty);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn btn--text';
      addButton.textContent = '+ Add concept';
      addButton.addEventListener('click', renderPicker);
      wrapper.appendChild(addButton);
    }

    function renderPicker() {
      wrapper.innerHTML = '';

      const learningSubject = timetableDisplayService.findLearningSubjectByCanonicalId(classroom, slot.subjectId);
      const unit = learningSubject?.units.find((u) => u.id === lesson.curriculumUnitId);

      if (!unit) {
        const hint = document.createElement('p');
        hint.className = 'period-detail-panel__attach-hint';
        hint.textContent = 'This lesson’s unit could not be found.';
        wrapper.appendChild(hint);
        return;
      }

      wrapper.appendChild(renderConceptPicker(unit, lesson));
    }

    renderPrompt();
    return wrapper;
  }

  /**
   * The one shared concept-picker UI — used by the Concepts tab's
   * initial "+ Add concept" prompt (this lesson has no concepts yet)
   * and openAddConceptFlow() above (adding more once at least one is
   * already attached). One unified search-or-create box, per explicit
   * product direction that a teacher should never have to think about
   * "search for an existing concept" and "create a new one" as
   * separate workflows.
   *
   * ADD-ONLY, not a toggle — this list only ever shows concepts NOT
   * yet on `lesson.conceptIds` (an already-assigned concept has
   * nothing left to do here; unassigning, if ever needed, is a
   * separate explicit action on the normal Concepts list, never a
   * side effect of clicking this list). Clicking a result assigns it
   * and persists immediately via plannerRepository.saveLesson() (the
   * same call every other lesson.conceptIds mutation in this file
   * already uses), then calls `onAssigned` — per explicit product
   * direction, picking (or creating) a concept is a complete, one-shot
   * action that returns the teacher straight to the normal Concepts
   * list, never a lingering "Done" step of its own.
   *
   * "Create" reuses learningRecordTeacherService.createConcept() — the
   * exact same mutation Learning Management's own syllabus editor
   * already uses to add a concept to a unit — never a second, parallel
   * concept system. The new concept is pushed straight into
   * `unit.concepts`, so it's real, permanent, and immediately shows up
   * as a suggestion for any other lesson using this same unit, then
   * assigned to *this* lesson in the same click. Only offered when the
   * current search text has zero matches at all — if anything matches,
   * the teacher picks from the list instead, so a same/similar-named
   * concept is never silently duplicated. As a second, defensive guard
   * against a genuinely concurrent create (a different tab/session
   * creating the same-titled concept between this render and this
   * click), createAndAssignConcept() below re-checks for an exact
   * (case-insensitive) title match immediately before creating, and
   * assigns the existing one instead of ever creating a duplicate.
   */
  function renderConceptPicker(unit, lesson, { onAssigned } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'period-detail-panel__concept-picker-wrapper';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search or create concept…';
    searchInput.className = 'period-detail-panel__concept-search';
    wrapper.appendChild(searchInput);

    const listEl = document.createElement('div');
    listEl.className = 'period-detail-panel__concept-picker';
    wrapper.appendChild(listEl);

    function assignConcept(conceptId) {
      runAction(async () => {
        if (!lesson.conceptIds.includes(conceptId)) {
          lesson.conceptIds = [...lesson.conceptIds, conceptId];
          await plannerRepository.saveLesson(classroom.id, lesson);
        }
        rerenderCurrentRange();
        onAssigned?.();
      });
    }

    function createAndAssignConcept(title) {
      runAction(async () => {
        // Defensive re-check, not the primary guard (the primary guard
        // is renderList() below only ever offering "+ Create" when
        // nothing already matches) — see this function's own header
        // comment.
        const existing = unit.concepts.find((concept) => concept.title.trim().toLowerCase() === title.trim().toLowerCase());
        const concept = existing || learningRecordTeacherService.createConcept(classroom, unit.id, { title });
        if (!existing) workspaceService.save(classroom);
        if (!lesson.conceptIds.includes(concept.id)) {
          lesson.conceptIds = [...lesson.conceptIds, concept.id];
          await plannerRepository.saveLesson(classroom.id, lesson);
        }
        rerenderCurrentRange();
        onAssigned?.();
      });
    }

    // Re-run on every keystroke. Always filters out whatever's already
    // on lesson.conceptIds — see this function's own header comment on
    // why this list is add-only, never a toggle.
    function renderList(filterText) {
      listEl.innerHTML = '';
      const addable = (unit?.concepts || []).filter((concept) => !lesson.conceptIds.includes(concept.id));
      const filtered = filterText ? addable.filter((concept) => concept.title.toLowerCase().includes(filterText.toLowerCase())) : addable;

      if (filtered.length === 0) {
        const none = document.createElement('p');
        none.className = 'period-detail-panel__attach-hint';
        none.textContent = filterText ? 'No matching concept.' : 'No concepts available to add — type a name above to create one.';
        listEl.appendChild(none);

        if (filterText) {
          const createRow = document.createElement('button');
          createRow.type = 'button';
          createRow.className = 'btn btn--text period-detail-panel__concept-create-row';
          createRow.textContent = `+ Create "${filterText}"`;
          createRow.addEventListener('click', () => createAndAssignConcept(filterText));
          listEl.appendChild(createRow);
        }
        return;
      }

      filtered.forEach((concept) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'period-detail-panel__concept-toggle-row';

        const label = document.createElement('span');
        label.textContent = concept.title;
        row.appendChild(label);

        row.addEventListener('click', () => assignConcept(concept.id));
        listEl.appendChild(row);
      });
    }
    searchInput.addEventListener('input', () => renderList(searchInput.value.trim()));
    renderList('');

    return wrapper;
  }

  /** Shared loading placeholder for both the Student Resources and Lesson Plan tabs, filled in by loadStudentResourcesTab()/loadLessonPlanTab() once the (async) resource fetch resolves. Matches this file's own "grid data renders instantly, network data fills in" convention already used for lessons. */
  function renderResourcesTabPlaceholder() {
    const section = document.createElement('div');
    section.className = 'period-detail-panel__resources';
    section.textContent = 'Loading resources…';
    return section;
  }

  /**
   * Fetches this lesson's own plain Resources (grouped {resource,
   * concept} pairs — resourceService.getResources() aggregated across
   * every one of the lesson's concepts) plus its Learning Hub concept
   * cards (Activities, a genuinely different reference model — see
   * this function's own former inline comment history in
   * loadStudentResourcesTab()/loadLessonPlanTab() below). Shared by
   * both tabs so there is exactly one fetch implementation; each tab
   * then filters/renders only the half it owns.
   */
  async function fetchLessonResourceEntries(lesson) {
    // The REAL LearningConcept objects (with their own resourceLinks
    // field), not timetableDisplayService's {id, title}-only display
    // shape — resourceService.getResources() reads resourceLinks
    // directly off whatever concept object it's given.
    const realConcepts = lesson.conceptIds.map((id) => learningRecordService.getConceptById(classroom, id)).filter(Boolean);
    let entries = [];
    try {
      const perConcept = await Promise.all(
        realConcepts.map(async (concept) => {
          const resources = await resourceService.getResources(classroom.id, concept);
          return resources.map((resource) => ({ resource, concept }));
        })
      );
      entries = perConcept.flat();
    } catch (error) {
      console.error('[TimetableView] Failed to load lesson resources:', error);
    }

    // Learning Hub concept cards — a genuinely different reference
    // model from the plain Resources above (see
    // services/learningIntegrationService.js's own header comment):
    // an Activity (models/Activity.js) linked to one of this lesson's
    // concepts, assigned to the classroom roster as its own Assignment
    // (models/LearningActivity.js), with results tracked per-student
    // via the already-extended Student.submissions. Fetched
    // classroom-wide once, then matched against this lesson's own
    // concepts — the same "fetch the whole list, filter locally" shape
    // resourceService.js's own getResources() already established, not
    // a per-concept query. Always student-facing (see
    // openAddResourceFlow()'s own header comment) — this function's
    // caller, loadLessonPlanTab(), never asks for these.
    let activityEntries = [];
    try {
      const allActivities = await learningIntegrationService.getActivitiesForClassroom(classroom.id);
      const conceptIdSet = new Set(realConcepts.map((concept) => concept.id));
      const assignments = learningActivityService.listActivities(classroom);
      activityEntries = allActivities
        .filter((activity) => conceptIdSet.has(activity.conceptId))
        .map((activity) => ({
          activity,
          concept: realConcepts.find((concept) => concept.id === activity.conceptId),
          assignment: assignments.find((candidate) => candidate.activityId === activity.id) || null,
        }));
    } catch (error) {
      console.error('[TimetableView] Failed to load this lesson’s Learning Hub resources:', error);
    }

    return { entries, activityEntries };
  }

  /**
   * STUDENT RESOURCES tab — "what can/should students use?" Shows every
   * Learning Hub concept card linked to this lesson (always
   * student-facing) plus every plain Resource whose audience
   * (models/Resource.js) is 'student' or 'both'. A teacher-only
   * resource (audience 'teacher', or no audience at all — the
   * pre-existing default) never appears here; it belongs on the
   * separate Lesson Plan tab instead (see loadLessonPlanTab()) — per
   * explicit product direction, these are two different tabs, never
   * one combined "Resources" tab containing both.
   */
  async function loadStudentResourcesTab(container, slot, lesson) {
    const { entries, activityEntries } = await fetchLessonResourceEntries(lesson);

    // Only replace the placeholder if this exact tab content node is
    // still the one on screen — a slow fetch resolving after the
    // teacher already switched tabs/periods must never clobber
    // whatever's now actually showing.
    if (!container.isConnected || state.activeDetailTab !== 'studentResources') return;

    container.innerHTML = '';
    const studentEntries = entries.filter(({ resource }) => resource.audience === 'student' || resource.audience === 'both');
    const reload = () => loadStudentResourcesTab(container, slot, lesson);

    container.appendChild(
      renderResourceTabBody({
        description: 'Resources students can access/use for this period.',
        emptyMessage: 'No student resources linked to this lesson’s concepts yet.',
        buttons: [{ label: '+ Add Resource', className: 'btn btn--text', onClick: () => openAddResourceFlow(slot, lesson, reload, { mode: 'student' }) }],
        activityEntries,
        entries: studentEntries,
        reload,
      })
    );
  }

  /**
   * LESSON PLAN tab — "what do I, the teacher, use to teach it?"
   * Exclusively teacher-facing planning material: every plain Resource
   * whose audience is 'teacher' (or unset). Never shows Learning Hub
   * concept cards (those are always student-facing — see
   * loadStudentResourcesTab() above) and is a fully separate tab from
   * Student Resources, not a subsection of it, per explicit product
   * direction that a lesson plan must never be presented as one more
   * resource alongside student-facing material.
   *
   * "Upload Lesson Plan" has no backing file-storage yet anywhere in
   * this codebase, so it's shown disabled rather than half-built —
   * "Share Lesson Plan" (a link, via the same openAddResourceFlow()
   * plain-link path, forced to audience 'teacher') is the one real
   * action for now.
   */
  async function loadLessonPlanTab(container, slot, lesson) {
    const { entries } = await fetchLessonResourceEntries(lesson);

    if (!container.isConnected || state.activeDetailTab !== 'lessonPlan') return;

    container.innerHTML = '';
    const lessonPlanEntries = entries.filter(({ resource }) => resource.audience !== 'student' && resource.audience !== 'both');
    const reload = () => loadLessonPlanTab(container, slot, lesson);

    container.appendChild(
      renderResourceTabBody({
        description: 'Teacher-facing planning material.',
        emptyMessage: 'No lesson plan material added for this lesson yet.',
        buttons: [
          { label: 'Share Lesson Plan', className: 'btn btn--text', onClick: () => openAddResourceFlow(slot, lesson, reload, { mode: 'lessonPlan' }) },
          { label: 'Upload Lesson Plan', className: 'btn btn--text', disabled: true, title: 'Coming soon' },
        ],
        activityEntries: [],
        entries: lessonPlanEntries,
        reload,
      })
    );
  }

  /**
   * Shared body shell for both the Student Resources and Lesson Plan
   * tabs — heading/actions/list/empty-state render identically; only
   * the content passed in differs. No title element here: the tab bar
   * itself already names which tab this is (see the Phase P tab list
   * above) — repeating it inside the content would just duplicate it.
   */
  function renderResourceTabBody({ description, emptyMessage, buttons, activityEntries, entries, reload }) {
    const section = document.createElement('div');
    section.className = 'period-detail-panel__resource-group';

    const desc = document.createElement('p');
    desc.className = 'period-detail-panel__resource-group-description';
    desc.textContent = description;
    section.appendChild(desc);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'period-detail-panel__resource-group-actions';
    buttons.forEach(({ label, className, onClick, disabled, title: buttonTitle }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      if (disabled) button.disabled = true;
      if (buttonTitle) button.title = buttonTitle;
      if (onClick) button.addEventListener('click', onClick);
      actionsRow.appendChild(button);
    });
    section.appendChild(actionsRow);

    if (entries.length === 0 && activityEntries.length === 0) {
      section.appendChild(createEmptyStateElement({ message: emptyMessage }));
      return section;
    }

    const list = document.createElement('div');
    list.className = 'period-detail-panel__resource-list';

    activityEntries.forEach(({ activity, assignment }) => {
      list.appendChild(renderLearningHubResourceItem(activity, assignment, reload));
    });

    entries.forEach(({ resource, concept }) => {
      list.appendChild(renderPlainResourceItem(resource, concept, reload));
    });

    section.appendChild(list);
    return section;
  }

  /** One plain-link resource row — extracted from this file's former single Resources-tab list so both the Student Resources and Lesson Plan groups render it identically. */
  function renderPlainResourceItem(resource, concept, reload) {
    const item = document.createElement('div');
    item.className = 'period-detail-panel__resource-item';
    item.appendChild(createIcon(getResourceTypeIcon(resource.type), { size: 16 }));

    const textWrap = document.createElement('span');
    textWrap.className = 'period-detail-panel__resource-item-text';
    if (resource.content?.url) {
      const link = document.createElement('a');
      link.href = resource.content.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = resource.title;
      textWrap.appendChild(link);
    } else {
      const label = document.createElement('span');
      label.textContent = resource.title;
      textWrap.appendChild(label);
    }
    if (resource.content?.description) {
      const description = document.createElement('span');
      description.className = 'period-detail-panel__resource-item-description';
      description.textContent = resource.content.description;
      textWrap.appendChild(description);
    }
    item.appendChild(textWrap);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--icon-only';
    removeButton.setAttribute('aria-label', `Remove ${resource.title}`);
    removeButton.appendChild(createIcon('trash-2', { size: 14 }));
    removeButton.addEventListener('click', () =>
      runAction(async () => {
        const confirmed = window.confirm(`Remove "${resource.title}"? This cannot be undone.`);
        if (!confirmed) return;
        await resourceService.deleteResource(classroom.id, concept, resource.id);
        workspaceService.save(classroom);
        await reload();
      })
    );
    item.appendChild(removeButton);

    return item;
  }

  /**
   * One Learning Hub concept-card resource item — visually distinct
   * from a plain link (🧠 badge, "Concept Card · Learning Hub"
   * subtitle, matching the approved reference), but living in the same
   * Resources list, per explicit product direction: "What resources do
   * I want students to use?" is one question a teacher asks, and a
   * Learning Hub reference is one answer to it, not a separate section.
   *
   * "Open" is a teacher-facing PREVIEW only (mirrors
   * ui/views/ConceptWorkspaceView.js's own "Open Learning Experience"
   * button exactly — same buildLearningHubLaunchUrl(), same
   * window.open('_blank')) — the student-facing launch/result surface
   * is explicitly out of scope for this pass (Student Portal has no
   * Activities surface yet at all).
   *
   * The roster completion tally reuses
   * services/learningActivityService.js's own getActivityRosterSummary()
   * — the exact same aggregate ui/views/ConceptWorkspaceView.js's own
   * Activities tab already shows, not a second computation — so "the
   * resulting completion/result state" is visible here already, to the
   * extent the current integration supports it (per-student score/
   * completedAt requires a real result to have been recorded via
   * services/learningIntegrationService.js's recordResult(), which
   * nothing yet calls automatically — there is no live Learning Hub
   * connection in this phase).
   */
  function renderLearningHubResourceItem(activity, assignment, onRemoved) {
    const item = document.createElement('div');
    item.className = 'period-detail-panel__resource-item period-detail-panel__resource-item--learning-hub';

    const badge = document.createElement('span');
    badge.className = 'period-detail-panel__resource-item-icon-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = '🧠';
    item.appendChild(badge);

    const textWrap = document.createElement('span');
    textWrap.className = 'period-detail-panel__resource-item-text';
    const label = document.createElement('span');
    label.textContent = activity.title;
    textWrap.appendChild(label);
    const subtitle = document.createElement('span');
    subtitle.className = 'period-detail-panel__resource-item-description';
    subtitle.textContent = 'Concept Card · Learning Hub';
    textWrap.appendChild(subtitle);

    if (assignment) {
      const summary = learningActivityService.getActivityRosterSummary(classroom, assignment.id);
      const tallyParts = Object.entries(summary).filter(([, count]) => count > 0);
      if (tallyParts.length > 0) {
        const tally = document.createElement('span');
        tally.className = 'period-detail-panel__resource-item-description';
        tally.textContent = tallyParts.map(([status, count]) => `${count} ${status}`).join(' · ');
        textWrap.appendChild(tally);
      }
    }
    item.appendChild(textWrap);

    const actions = document.createElement('div');
    actions.className = 'period-detail-panel__resource-item-actions';

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'btn btn--text';
    openButton.textContent = 'Open';
    openButton.addEventListener('click', () => {
      const [experienceType, ...rest] = (activity.destination || '').split(':');
      const experienceId = rest.join(':');
      if (!experienceType || !experienceId) return;
      window.open(buildLearningHubLaunchUrl(experienceType, experienceId), '_blank');
    });
    actions.appendChild(openButton);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--icon-only';
    removeButton.setAttribute('aria-label', `Remove ${activity.title}`);
    removeButton.appendChild(createIcon('trash-2', { size: 14 }));
    removeButton.addEventListener('click', () =>
      runAction(async () => {
        const confirmed = window.confirm(`Remove "${activity.title}"? This cannot be undone.`);
        if (!confirmed) return;
        if (assignment) learningIntegrationService.unassignActivity(classroom, assignment.id);
        workspaceService.save(classroom);
        onRemoved?.();
      })
    );
    actions.appendChild(removeButton);

    item.appendChild(actions);

    return item;
  }

  /**
   * The "+ Add Resource" (Student Resources) / "Share Lesson Plan"
   * (Lesson Plan) action — a simple manual entry form (title / URL /
   * optional description), not ConceptWorkspaceView.js's own full
   * resource editor (a separate, heavier multi-type workflow
   * deliberately not pulled in here — see this file's own header
   * comment on staying a minimal, real form rather than a second
   * Resource system).
   *
   * Resources are a Concept-level system, not a Lesson-level one (see
   * fetchLessonResourceEntries()'s own doc comment) — models/Lesson.js
   * has no resource field at all, by design, so a resource added here
   * still genuinely attaches to one of THIS lesson's own concepts, the
   * same way every resource these tabs already display does. Exactly
   * one concept is the only real choice there is to make when the
   * lesson has just one, and is used without asking — with more than
   * one, the teacher must explicitly pick which, via a forced, disabled
   * placeholder option (mirroring renderAttachLessonForm()'s own Phase
   * T fix: never a silently-selected first concept).
   *
   * `type` is fixed to 'external_link' — the one existing
   * config/resourceTypeConfig.js type this title/url/description shape
   * actually matches — stored as `{ url, description }` on the
   * existing, deliberately type-specific Resource.content field (see
   * services/resourceService.js's own updated header comment); not a
   * new Resource architecture, no new Firestore collection.
   *
   * `mode` ('student' | 'lessonPlan') is which of the two separate
   * tabs (loadStudentResourcesTab()/loadLessonPlanTab()) this flow was
   * opened from — it decides the resource's `audience`
   * (models/Resource.js) and whether the Learning Hub option is
   * offered at all, since a Learning Hub concept card is always
   * student-facing and never belongs in Lesson Plan.
   */
  function openAddResourceFlow(slot, lesson, onSaved, { mode = 'student' } = {}) {
    const concepts = timetableDisplayService.resolveLessonConcepts(classroom, lesson);
    const eyebrowText = mode === 'lessonPlan' ? 'ADD TO LESSON PLAN' : 'ADD RESOURCE';
    const audience = mode === 'lessonPlan' ? 'teacher' : 'student';

    const overlay = document.createElement('div');
    overlay.className = 'carry-forward-overlay';
    const box = document.createElement('div');
    box.className = 'carry-forward-overlay__box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // A lesson with zero concepts has nowhere for a resource to
    // structurally attach (see this function's own header comment) —
    // rather than force a lesson-level architecture change to route
    // around that, this is surfaced honestly, with a direct pointer to
    // where a concept actually gets added.
    if (concepts.length === 0) {
      const eyebrow = document.createElement('p');
      eyebrow.className = 'carry-forward-overlay__eyebrow';
      eyebrow.textContent = eyebrowText;
      box.appendChild(eyebrow);

      const heading = document.createElement('h3');
      heading.className = 'carry-forward-overlay__concept';
      heading.textContent =
        timetableDisplayService.resolveLessonTopic(classroom, lesson) || timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId);
      box.appendChild(heading);

      const hint = document.createElement('p');
      hint.className = 'period-detail-panel__attach-hint';
      hint.textContent = 'Resources attach to a concept. Add a concept to this lesson first, from the Concepts tab.';
      box.appendChild(hint);

      const closeActions = document.createElement('div');
      closeActions.className = 'carry-forward-overlay__actions';
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'btn btn--ghost';
      closeButton.textContent = 'Close';
      closeButton.addEventListener('click', () => overlay.remove());
      closeActions.appendChild(closeButton);
      box.appendChild(closeActions);
      return;
    }

    // Shared across both the Learning Hub path and the plain-link path
    // below — exactly one concept is the only real choice when the
    // lesson has just one, used without asking; with more than one,
    // the teacher must explicitly pick which, via a forced, disabled
    // placeholder option (same Phase T convention as
    // renderAttachLessonForm()'s own unit picker: never a
    // silently-selected first concept). Rebuilt fresh each time
    // renderConceptSelect() runs (once per screen), so its own
    // `change` listeners always target whichever screen is current.
    let conceptSelect = null;
    function renderConceptSelect(container) {
      conceptSelect = null;
      if (concepts.length <= 1) return;
      const conceptLabel = document.createElement('label');
      conceptLabel.className = 'period-detail-panel__attach-label';
      conceptLabel.textContent = 'Concept';
      container.appendChild(conceptLabel);

      conceptSelect = document.createElement('select');
      const placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = '— Choose a concept —';
      placeholderOption.disabled = true;
      placeholderOption.selected = true;
      conceptSelect.appendChild(placeholderOption);
      concepts.forEach(({ id, title }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = title;
        conceptSelect.appendChild(option);
      });
      container.appendChild(conceptSelect);
    }
    function getSelectedConceptId() {
      return concepts.length === 1 ? concepts[0].id : conceptSelect?.value || '';
    }

    renderChooser();

    /**
     * The default screen — concept select, Learning Hub as a
     * first-class option, and the existing plain-link form below it
     * (per explicit product direction: both are "Resources," not two
     * separate features). Everything about the plain-link path is
     * completely unchanged from before this redesign; only its
     * container (this function) also now offers Learning Hub.
     */
    function renderChooser() {
      box.innerHTML = '';

      const eyebrow = document.createElement('p');
      eyebrow.className = 'carry-forward-overlay__eyebrow';
      eyebrow.textContent = eyebrowText;
      box.appendChild(eyebrow);

      const heading = document.createElement('h3');
      heading.className = 'carry-forward-overlay__concept';
      heading.textContent =
        timetableDisplayService.resolveLessonTopic(classroom, lesson) || timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId);
      box.appendChild(heading);

      renderConceptSelect(box);

      // A Learning Hub concept card is always student-facing (per this
      // function's own header comment) — offered only from the
      // Student Resources entry point, never from Lesson Plan.
      if (mode === 'student') {
        const learningHubLabel = document.createElement('p');
        learningHubLabel.className = 'period-detail-panel__attach-label';
        learningHubLabel.textContent = 'Learning Hub';
        box.appendChild(learningHubLabel);

        const linkLearningHubButton = document.createElement('button');
        linkLearningHubButton.type = 'button';
        linkLearningHubButton.className = 'btn btn--secondary';
        linkLearningHubButton.textContent = 'Link Learning Hub concept card';
        linkLearningHubButton.addEventListener('click', () => {
          if (!getSelectedConceptId()) {
            conceptSelect?.reportValidity?.();
            return;
          }
          renderLearningHubPicker();
        });
        box.appendChild(linkLearningHubButton);

        const divider = document.createElement('hr');
        divider.className = 'period-detail-panel__resource-divider';
        box.appendChild(divider);
      }

      const titleLabel = document.createElement('label');
      titleLabel.className = 'period-detail-panel__attach-label';
      titleLabel.textContent = 'Resource title';
      box.appendChild(titleLabel);
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      box.appendChild(titleInput);

      const urlLabel = document.createElement('label');
      urlLabel.className = 'period-detail-panel__attach-label';
      urlLabel.textContent = 'URL';
      box.appendChild(urlLabel);
      const urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.placeholder = 'https://…';
      box.appendChild(urlInput);

      const descriptionLabel = document.createElement('label');
      descriptionLabel.className = 'period-detail-panel__attach-label';
      descriptionLabel.textContent = 'Optional description';
      box.appendChild(descriptionLabel);
      const descriptionInput = document.createElement('textarea');
      box.appendChild(descriptionInput);

      const actions = document.createElement('div');
      actions.className = 'carry-forward-overlay__actions';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn btn--ghost';
      cancelButton.textContent = 'Cancel';
      cancelButton.addEventListener('click', () => overlay.remove());
      actions.appendChild(cancelButton);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn btn--primary';
      addButton.textContent = mode === 'lessonPlan' ? 'Add to Lesson Plan' : 'Add resource';

      function updateAddButtonState() {
        addButton.disabled = !getSelectedConceptId() || !titleInput.value.trim() || !urlInput.value.trim();
      }
      titleInput.addEventListener('input', updateAddButtonState);
      urlInput.addEventListener('input', updateAddButtonState);
      if (conceptSelect) conceptSelect.addEventListener('change', updateAddButtonState);
      updateAddButtonState();

      addButton.addEventListener('click', () =>
        runAction(async () => {
          const concept = learningRecordService.getConceptById(classroom, getSelectedConceptId());
          if (!concept) return;

          await resourceService.createResourceOnConcept(classroom.id, concept, {
            title: titleInput.value.trim(),
            type: 'external_link',
            content: { url: urlInput.value.trim(), description: descriptionInput.value.trim() || null },
            audience,
          });
          workspaceService.save(classroom);
          overlay.remove();
          onSaved?.();
        })
      );
      actions.appendChild(addButton);
      box.appendChild(actions);
    }

    /**
     * Step 2 of the Learning Hub path — the catalogue picker.
     * services/learningHubCatalogueService.js's own fetch (never
     * throws, empty array on failure — see that file's own header
     * comment), grouped by type via groupExperiencesByType() the same
     * way ui/components/LearningHubPanel.js's own catalogue view
     * already groups it — not a second grouping implementation.
     *
     * Picking an experience creates a real models/Activity.js
     * definition (activityType: 'learning_hub', destination the
     * catalogue's own `type:id`, opaque to ClassMate) and assigns it to
     * this classroom's roster against the selected concept — see
     * services/learningIntegrationService.js's own createActivity()/
     * assignActivityToClassroom(), the exact existing integration
     * boundary this redesign reuses rather than a second one.
     */
    function renderLearningHubPicker() {
      const conceptId = getSelectedConceptId();

      box.innerHTML = '';

      const eyebrow = document.createElement('p');
      eyebrow.className = 'carry-forward-overlay__eyebrow';
      eyebrow.textContent = 'LEARNING HUB CONCEPT CARD';
      box.appendChild(eyebrow);

      const heading = document.createElement('h3');
      heading.className = 'carry-forward-overlay__concept';
      heading.textContent = concepts.find((concept) => concept.id === conceptId)?.title || '';
      box.appendChild(heading);

      const loadingNote = document.createElement('p');
      loadingNote.className = 'period-detail-panel__attach-hint';
      loadingNote.textContent = 'Loading Learning Hub catalogue…';
      box.appendChild(loadingNote);

      const backActions = document.createElement('div');
      backActions.className = 'carry-forward-overlay__actions';
      const backButton = document.createElement('button');
      backButton.type = 'button';
      backButton.className = 'btn btn--ghost';
      backButton.textContent = 'Back';
      backButton.addEventListener('click', renderChooser);
      backActions.appendChild(backButton);
      box.appendChild(backActions);

      fetchLearningHubCatalogue().then((experiences) => {
        // The teacher may have already clicked Back/Cancel while this
        // was in flight — never repopulate a box that's moved on.
        if (!loadingNote.isConnected) return;
        loadingNote.remove();

        if (experiences.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'period-detail-panel__attach-hint';
          empty.textContent = 'Couldn’t load the Learning Hub catalogue right now.';
          box.insertBefore(empty, backActions);
          return;
        }

        const grouped = groupExperiencesByType(experiences);
        const list = document.createElement('div');
        list.className = 'period-detail-panel__concept-picker';
        grouped.forEach((groupExperiences, type) => {
          const groupLabel = document.createElement('p');
          groupLabel.className = 'period-detail-panel__attach-label';
          groupLabel.textContent = LEARNING_HUB_TYPE_GROUP_LABELS[type] || type;
          list.appendChild(groupLabel);

          groupExperiences.forEach((experience) => {
            const row = document.createElement('div');
            row.className = 'period-detail-panel__concept-row';
            const label = document.createElement('span');
            label.textContent = experience.title;
            row.appendChild(label);

            const linkButton = document.createElement('button');
            linkButton.type = 'button';
            linkButton.className = 'btn btn--text';
            linkButton.textContent = 'Link';
            linkButton.addEventListener('click', () =>
              runAction(async () => {
                const activity = await learningIntegrationService.createActivity(classroom.id, {
                  conceptId,
                  title: experience.title,
                  description: experience.description || '',
                  activityType: 'learning_hub',
                  destination: `${experience.type}:${experience.id}`,
                });
                learningIntegrationService.assignActivityToClassroom(classroom, activity, { title: experience.title });
                workspaceService.save(classroom);
                overlay.remove();
                onSaved?.();
              })
            );
            row.appendChild(linkButton);

            list.appendChild(row);
          });
        });
        box.insertBefore(list, backActions);
      });
    }
  }

  /** "Thu 28 Aug" — weekday + day + month, no year; reuses this file's own existing weekdayOf()/monthAbbrev()/WEEKDAY_LABELS, never a second date-formatting implementation. */
  function formatCarryForwardOptionDate(dateKey) {
    const [, , day] = dateKey.split('-');
    return `${WEEKDAY_LABELS[weekdayOf(dateKey)]} ${Number(day)} ${monthAbbrev(dateKey)}`;
  }

  /**
   * Phase P redesign — the underlying carry-forward logic
   * (timetableService.suggestCarryForwardTargets(),
   * carryForwardService.carryForwardToTeachingSlot()) is completely
   * unchanged; only the interaction is new. Matches the reference's
   * own "focused decision" shape: the suggested next same-subject
   * period is selected by default, other real periods are offered as
   * plain alternatives, and the one primary CTA's own label always
   * reflects whichever option is currently selected — never a
   * separate button per option (the previous design), so choosing a
   * different period is a single extra click (select, then the one
   * real Move action) rather than one irreversible click per option.
   */
  function openCarryForwardFlow(slot, lesson, conceptId, conceptTitle) {
    const { primary, others } = timetableService.suggestCarryForwardTargets(classroom, {
      subjectId: slot.subjectId,
      afterDateKey: slot.date,
      afterPeriodNumber: slot.periodNumber,
    });
    const periods = timetableService.getPeriods(classroom);
    const subjectTitle = timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId);

    const overlay = document.createElement('div');
    overlay.className = 'carry-forward-overlay';
    const box = document.createElement('div');
    box.className = 'carry-forward-overlay__box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let selected = primary || null;

    function timeLabel(option) {
      const period = periods.find((p) => p.periodNumber === option.periodNumber);
      return period ? `${formatCarryForwardOptionDate(option.date)} · ${period.startTime}` : formatCarryForwardOptionDate(option.date);
    }

    function renderBox() {
      box.innerHTML = '';

      const eyebrow = document.createElement('p');
      eyebrow.className = 'carry-forward-overlay__eyebrow';
      eyebrow.textContent = 'CARRY FORWARD';
      box.appendChild(eyebrow);

      const conceptLabel = document.createElement('h3');
      conceptLabel.className = 'carry-forward-overlay__concept';
      conceptLabel.textContent = conceptTitle;
      box.appendChild(conceptLabel);

      if (!primary) {
        const none = document.createElement('p');
        none.textContent = 'No future period for this subject is scheduled yet.';
        box.appendChild(none);
      } else {
        const suggestedLabel = document.createElement('p');
        suggestedLabel.className = 'carry-forward-overlay__section-label';
        suggestedLabel.textContent = 'Suggested';
        box.appendChild(suggestedLabel);
        box.appendChild(renderOptionRow(primary, `Next ${subjectTitle} period`));

        if (others.length > 0) {
          const otherLabel = document.createElement('p');
          otherLabel.className = 'carry-forward-overlay__section-label';
          otherLabel.textContent = `Other ${subjectTitle} periods`;
          box.appendChild(otherLabel);
          others.forEach((option) => box.appendChild(renderOptionRow(option)));
        }
      }

      const actions = document.createElement('div');
      actions.className = 'carry-forward-overlay__actions';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn btn--ghost';
      cancelButton.textContent = 'Cancel';
      cancelButton.addEventListener('click', () => overlay.remove());
      actions.appendChild(cancelButton);

      if (selected) {
        const moveButton = document.createElement('button');
        moveButton.type = 'button';
        moveButton.className = 'btn btn--primary carry-forward-overlay__move';
        moveButton.textContent = `Move to ${formatCarryForwardOptionDate(selected.date)}`;
        moveButton.addEventListener('click', () => doCarryForward(selected));
        actions.appendChild(moveButton);
      }

      box.appendChild(actions);
    }

    function renderOptionRow(option, overrideLabel) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'carry-forward-overlay__option';
      const isSelected = selected && selected.id === option.id;
      row.classList.toggle('carry-forward-overlay__option--selected', isSelected);

      const radio = document.createElement('span');
      radio.className = 'carry-forward-overlay__option-radio';
      row.appendChild(radio);

      const textWrap = document.createElement('span');
      textWrap.className = 'carry-forward-overlay__option-text';
      if (overrideLabel) {
        const strong = document.createElement('strong');
        strong.textContent = overrideLabel;
        textWrap.appendChild(strong);
      }
      const timeEl = document.createElement('span');
      timeEl.textContent = timeLabel(option);
      textWrap.appendChild(timeEl);
      row.appendChild(textWrap);

      row.addEventListener('click', () => {
        selected = option;
        renderBox();
      });
      return row;
    }

    async function doCarryForward(targetSlot) {
      await runAction(async () => {
        const existingTargetLesson = await plannerRepository.getLessonByTeachingSlotId(classroom.id, targetSlot.id);
        await carryForwardService.carryForwardToTeachingSlot(classroom, {
          sourceLesson: lesson,
          conceptId,
          targetTeachingSlotId: targetSlot.id,
          targetDate: targetSlot.date,
          existingTargetLesson,
        });
        overlay.remove();
        await loadAndRender();
      });
    }

    renderBox();
  }

  /**
   * Phase S — Manage Timetable: editing the RECURRING weekly pattern
   * (which subject each weekday/period is, and what time each period
   * runs) — a distinct concern from this page's own teaching/
   * monitoring workflow (see this file's own header comment on the
   * WEEKLY PERIOD -> SUBJECT -> LESSON PLAN chain, which this flow
   * only ever edits at the SUBJECT layer, never below it).
   *
   * Reuses the existing architecture exactly: classroom.timetable
   * (models/Timetable.js) already lives directly on the classroom
   * object, mutated via timetableService's own setPeriods()/
   * getSlotsForWeekday() and persisted via workspaceService's own
   * explicit-save path (saveExplicitly()) — no new collection, no new
   * repository method. Nothing here writes to the real classroom
   * object until Save succeeds; Cancel discards the whole draft.
   *
   * Historical Lessons are structurally protected without any extra
   * code: a Lesson is keyed by buildTeachingSlotId(classroomId,
   * dateKey, periodNumber) — a real date, never the recurring
   * pattern's current subject for that weekday — so editing the
   * pattern here can never retarget or rewrite an already-attached
   * Lesson (see tests/services/timetableService.test.js's own Phase S
   * tests for this exact invariant).
   *
   * Subjects are chosen only from subjectIdentityService's canonical
   * registry — the same shared list Curriculum Management / Learning
   * Management already offer — never free text, so a period's
   * subjectId always lines up with the rest of the app's own subject
   * identity system.
   *
   * SCOPE NOTE, disclosed rather than silently decided: a period with
   * no subject assigned on any day is a legitimate, pre-existing state
   * ("no class that period" — see timetableService.getSlot()'s own doc
   * comment) — this flow does not force every cell to be filled before
   * saving. "Add period" immediately exposes a subject selector for the
   * currently-viewed day right on the new row, satisfying the product
   * requirement that adding a period lets the teacher specify a subject
   * at that moment, without a separate blocking "confirm" step for a
   * scenario (a still-being-planned empty period) this app already
   * treats as valid everywhere else.
   *
   * SCOPE NOTE 2: the model has no separate "break period" flag — a
   * non-teaching period is simply a period row with no subject on any
   * day, which is already exactly how "no class" is represented today.
   * Adding a dedicated isBreak flag would be the "unnecessary
   * architectural expansion" Phase S's own spec explicitly says to
   * avoid, since the existing shape already covers this case.
   */
  function openManageTimetableFlow() {
    const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-start, matching renderWeekGrid()'s own week range

    // Deep-copied working draft — the real classroom.timetable is
    // never touched until Save succeeds.
    let draftPeriods = timetableService.getPeriods(classroom).map((period) => ({ ...period }));
    // `${weekday}_${periodNumber}` -> { subjectId, teacherUid }. teacherUid
    // (see models/Timetable.js's own doc comment) is who actually teaches
    // this period — carried alongside subjectId here so Save can persist
    // both together, the same "one draft entry per cell" shape as before.
    const draftSlots = new Map();
    WEEKDAY_ORDER.forEach((weekday) => {
      timetableService.getSlotsForWeekday(classroom, weekday).forEach((slot) => {
        draftSlots.set(`${weekday}_${slot.periodNumber}`, { subjectId: slot.subjectId, teacherUid: slot.teacherUid ?? null });
      });
    });

    // Owners/teachers only — a Viewer has no teaching permissions (see
    // config/memberRoles.js), so offering them in "who teaches this
    // period" would let a slot claim a member who structurally can't be
    // teaching it.
    const assignableMembers = memberService
      .listMembers(classroom)
      .filter((member) => member.role === MEMBER_ROLES.OWNER || member.role === MEMBER_ROLES.TEACHER);

    let mobileActiveWeekday = WEEKDAY_ORDER[0];
    let validationErrors = [];

    const overlay = document.createElement('div');
    overlay.className = 'carry-forward-overlay manage-timetable-overlay';
    const box = document.createElement('div');
    box.className = 'carry-forward-overlay__box manage-timetable-overlay__box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function revalidate() {
      validationErrors = timetableService.validateTimetableDraft(draftPeriods).errors;
    }

    function nextPeriodDefaults() {
      if (draftPeriods.length === 0) return { periodNumber: 1, startTime: '09:00', endTime: '09:40' };
      const sorted = [...draftPeriods].sort((a, b) => a.periodNumber - b.periodNumber);
      const last = sorted[sorted.length - 1];
      return {
        periodNumber: last.periodNumber + 1,
        startTime: last.endTime,
        endTime: addMinutesToTime(last.endTime, 40),
      };
    }

    function renderBox() {
      box.innerHTML = '';

      const eyebrow = document.createElement('p');
      eyebrow.className = 'carry-forward-overlay__eyebrow';
      eyebrow.textContent = 'MANAGE TIMETABLE';
      box.appendChild(eyebrow);

      const heading = document.createElement('h3');
      heading.className = 'manage-timetable-overlay__heading';
      heading.textContent = 'Weekly schedule';
      box.appendChild(heading);

      const hint = document.createElement('p');
      hint.className = 'manage-timetable-overlay__hint';
      hint.textContent = 'This is the recurring pattern every week follows. Existing lesson plans and past teaching records are never changed by editing it.';
      box.appendChild(hint);

      if (validationErrors.length > 0) {
        const errorBox = document.createElement('div');
        errorBox.className = 'manage-timetable-overlay__errors';
        validationErrors.forEach((error) => {
          const line = document.createElement('p');
          line.textContent = error.message;
          errorBox.appendChild(line);
        });
        box.appendChild(errorBox);
      }

      box.appendChild(isNarrowViewport() ? renderMobileEditor() : renderDesktopEditor());

      const actions = document.createElement('div');
      actions.className = 'carry-forward-overlay__actions';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn btn--ghost';
      cancelButton.textContent = 'Cancel';
      cancelButton.addEventListener('click', () => overlay.remove());
      actions.appendChild(cancelButton);

      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'btn btn--primary';
      saveButton.textContent = 'Save timetable';
      saveButton.addEventListener('click', () => saveDraft());
      actions.appendChild(saveButton);

      box.appendChild(actions);
    }

    function renderTimeInputs(period) {
      const wrap = document.createElement('div');
      wrap.className = 'manage-timetable__time-inputs';

      const startInput = document.createElement('input');
      startInput.type = 'time';
      startInput.value = period.startTime;
      startInput.setAttribute('aria-label', `Period ${period.periodNumber} start time`);
      startInput.addEventListener('change', () => {
        period.startTime = startInput.value;
        revalidate();
        renderBox();
      });

      const dash = document.createElement('span');
      dash.textContent = '–';

      const endInput = document.createElement('input');
      endInput.type = 'time';
      endInput.value = period.endTime;
      endInput.setAttribute('aria-label', `Period ${period.periodNumber} end time`);
      endInput.addEventListener('change', () => {
        period.endTime = endInput.value;
        revalidate();
        renderBox();
      });

      wrap.append(startInput, dash, endInput);
      return wrap;
    }

    function renderSubjectSelect(weekday, periodNumber, onSubjectChange) {
      const select = document.createElement('select');
      select.className = 'manage-timetable__subject-select';
      select.setAttribute('aria-label', `${WEEKDAY_LABELS[weekday]} period ${periodNumber} subject`);

      const noneOption = document.createElement('option');
      noneOption.value = '';
      noneOption.textContent = '— No class —';
      select.appendChild(noneOption);

      subjectIdentityService.getCanonicalSubjects().forEach((subject) => {
        const option = document.createElement('option');
        option.value = subject.id;
        option.textContent = subject.title;
        select.appendChild(option);
      });

      const key = `${weekday}_${periodNumber}`;
      select.value = draftSlots.get(key)?.subjectId || '';
      select.addEventListener('change', () => {
        if (select.value) {
          const existing = draftSlots.get(key);
          draftSlots.set(key, { subjectId: select.value, teacherUid: existing?.teacherUid ?? null });
        } else {
          // "No class" — nobody teaches a period that doesn't exist,
          // so the teacher assignment goes with it.
          draftSlots.delete(key);
        }
        onSubjectChange?.();
      });

      return select;
    }

    /**
     * "Taught by" — who actually teaches this specific period (see
     * models/Timetable.js's own doc comment on `teacherUid`). Only
     * rendered/enabled once a subject is chosen for this cell — a
     * period with "no class" has no one to assign. Options are this
     * classroom's own real owner/teacher members (assignableMembers,
     * built above from memberService.listMembers()), never free text,
     * so a slot's teacherUid always resolves to a real member.
     */
    function renderTeacherSelect(weekday, periodNumber) {
      const select = document.createElement('select');
      select.className = 'manage-timetable__teacher-select';
      select.setAttribute('aria-label', `${WEEKDAY_LABELS[weekday]} period ${periodNumber} taught by`);

      const key = `${weekday}_${periodNumber}`;
      const entry = draftSlots.get(key);
      select.disabled = !entry;

      const unassignedOption = document.createElement('option');
      unassignedOption.value = '';
      unassignedOption.textContent = entry ? 'Taught by…' : '—';
      select.appendChild(unassignedOption);

      assignableMembers.forEach((member) => {
        const option = document.createElement('option');
        option.value = member.uid;
        option.textContent = member.displayName;
        select.appendChild(option);
      });

      select.value = entry?.teacherUid || '';
      select.addEventListener('change', () => {
        const current = draftSlots.get(key);
        if (current) draftSlots.set(key, { ...current, teacherUid: select.value || null });
      });

      return select;
    }

    /** The subject picker plus its own "Taught by" picker for one (weekday, periodNumber) cell — kept together so every call site gets both controls, not just the subject one. */
    function renderPeriodCellControls(weekday, periodNumber) {
      const wrap = document.createElement('div');
      wrap.className = 'manage-timetable__cell-controls';
      const subjectSelect = renderSubjectSelect(weekday, periodNumber, () => {
        // Re-render so the "Taught by" select's own enabled/disabled
        // state and options immediately reflect the subject that was
        // just picked (or cleared) — same as every other draft edit
        // here (see renderTimeInputs()'s own change handlers above).
        revalidate();
        renderBox();
      });
      wrap.append(subjectSelect, renderTeacherSelect(weekday, periodNumber));
      return wrap;
    }

    function renderRemovePeriodButton(periodNumber) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--icon-only manage-timetable__remove-period';
      button.setAttribute('aria-label', `Remove period ${periodNumber}`);
      button.appendChild(createIcon('trash-2', { size: 16 }));
      button.addEventListener('click', () => {
        draftPeriods = draftPeriods.filter((period) => period.periodNumber !== periodNumber);
        WEEKDAY_ORDER.forEach((weekday) => draftSlots.delete(`${weekday}_${periodNumber}`));
        revalidate();
        renderBox();
      });
      return button;
    }

    function renderAddPeriodControl() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--text manage-timetable__add-period';
      button.textContent = '+ Add period';
      button.addEventListener('click', () => {
        draftPeriods.push(nextPeriodDefaults());
        revalidate();
        renderBox();
      });
      return button;
    }

    function renderDesktopEditor() {
      const wrapper = document.createElement('div');
      wrapper.className = 'manage-timetable-grid-wrapper';

      const table = document.createElement('table');
      table.className = 'manage-timetable-grid';

      const headRow = document.createElement('tr');
      const cornerCell = document.createElement('th');
      cornerCell.className = 'manage-timetable-grid__corner-cell';
      headRow.appendChild(cornerCell);
      WEEKDAY_ORDER.forEach((weekday) => {
        const th = document.createElement('th');
        th.textContent = WEEKDAY_LABELS[weekday];
        headRow.appendChild(th);
      });
      headRow.appendChild(document.createElement('th'));
      table.appendChild(headRow);

      [...draftPeriods]
        .sort((a, b) => a.periodNumber - b.periodNumber)
        .forEach((period) => {
          const row = document.createElement('tr');

          const timeCell = document.createElement('td');
          timeCell.className = 'manage-timetable-grid__time-cell';
          timeCell.appendChild(renderTimeInputs(period));
          row.appendChild(timeCell);

          WEEKDAY_ORDER.forEach((weekday) => {
            const cell = document.createElement('td');
            cell.appendChild(renderPeriodCellControls(weekday, period.periodNumber));
            row.appendChild(cell);
          });

          const removeCell = document.createElement('td');
          removeCell.appendChild(renderRemovePeriodButton(period.periodNumber));
          row.appendChild(removeCell);

          table.appendChild(row);
        });

      wrapper.appendChild(table);
      wrapper.appendChild(renderAddPeriodControl());
      return wrapper;
    }

    function renderMobileEditor() {
      const wrapper = document.createElement('div');
      wrapper.className = 'manage-timetable-mobile';

      const daySelector = document.createElement('div');
      daySelector.className = 'manage-timetable-mobile__day-selector';
      WEEKDAY_ORDER.forEach((weekday) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = WEEKDAY_LABELS[weekday];
        if (weekday === mobileActiveWeekday) button.classList.add('manage-timetable-mobile__day-button--active');
        button.addEventListener('click', () => {
          mobileActiveWeekday = weekday;
          renderBox();
        });
        daySelector.appendChild(button);
      });
      wrapper.appendChild(daySelector);

      const list = document.createElement('div');
      list.className = 'manage-timetable-mobile__list';

      [...draftPeriods]
        .sort((a, b) => a.periodNumber - b.periodNumber)
        .forEach((period) => {
          const card = document.createElement('div');
          card.className = 'manage-timetable-mobile__card';

          card.appendChild(renderTimeInputs(period));
          card.appendChild(renderPeriodCellControls(mobileActiveWeekday, period.periodNumber));

          const footer = document.createElement('div');
          footer.className = 'manage-timetable-mobile__card-footer';
          footer.appendChild(renderRemovePeriodButton(period.periodNumber));
          card.appendChild(footer);

          list.appendChild(card);
        });

      wrapper.appendChild(list);
      wrapper.appendChild(renderAddPeriodControl());
      return wrapper;
    }

    async function saveDraft() {
      const result = timetableService.validateTimetableDraft(draftPeriods);
      validationErrors = result.errors;
      if (!result.valid) {
        renderBox();
        return;
      }

      await runAction(async () => {
        timetableService.setPeriods(classroom, draftPeriods.map((period) => createTimetablePeriod(period)));

        // Reconcile slots to exactly what the draft says — every
        // (weekday, periodNumber) still in the draft either gets the
        // subject the teacher chose, or is cleared back to "no class"
        // (see getSlot()'s own doc comment) if they left it blank or
        // removed that period entirely.
        const nextSlots = [];
        draftPeriods.forEach((period) => {
          WEEKDAY_ORDER.forEach((weekday) => {
            const entry = draftSlots.get(`${weekday}_${period.periodNumber}`);
            if (entry) nextSlots.push(createTimetableSlot({ weekday, periodNumber: period.periodNumber, subjectId: entry.subjectId, teacherUid: entry.teacherUid }));
          });
        });
        classroom.timetable.slots = nextSlots;

        await workspaceService.saveExplicitly(classroom);
        overlay.remove();
        await loadAndRender();
      });
    }

    renderBox();
  }

  function renderReflectionSection(lesson) {
    const section = document.createElement('div');
    section.className = 'period-detail-panel__reflection';
    const title = document.createElement('h3');
    title.textContent = 'Teacher Reflection';
    section.appendChild(title);

    const textarea = document.createElement('textarea');
    textarea.value = lesson.teacherReflection || '';
    textarea.placeholder = 'What went well? What needs more practice next time?';
    section.appendChild(textarea);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--ghost';
    saveButton.textContent = 'Save reflection';
    saveButton.addEventListener('click', () =>
      runAction(async () => {
        lesson.teacherReflection = textarea.value;
        await plannerRepository.saveLesson(classroom.id, lesson);
      })
    );
    section.appendChild(saveButton);

    return section;
  }

  await loadAndRender();
}

/** "HH:mm" + a duration -> "HH:mm", used only to default a newly-added period's time range to right after the previous one — never validated input, since validateTimetableDraft() re-checks the result anyway. */
function addMinutesToTime(time, minutesToAdd) {
  const [hour, minute] = time.split(':').map(Number);
  const total = (hour * 60 + minute + minutesToAdd + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function weekdayOf(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * Splits a month `range` into calendar weeks — an array of 7-entry
 * arrays (a real "YYYY-MM-DD" dateKey, or `null` for a leading/
 * trailing slot outside the month), Sunday-first (matching this
 * file's own WEEKDAY_LABELS/weekdayOf() convention everywhere else —
 * deliberately not Monday-first, even though this feature's own
 * reference mockup used Monday-first weeks). Pure date arithmetic; the
 * one thing both renderCalendarProgressionWeeks() and
 * timetableDisplayService.js's computeUnitWeekSegment() build on.
 */
function buildCalendarWeeks(range) {
  const cells = [];
  const leadingBlanks = weekdayOf(range.start);
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let dateKey = range.start; dateKey <= range.end; dateKey = shiftDateKey(dateKey, 1)) cells.push(dateKey);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function monthAbbrev(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short' });
}
