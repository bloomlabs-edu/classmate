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
 * SCOPE NOTE, disclosed rather than silently decided: "Calendar" mode
 * (per the approved reference's Week/Day/Calendar toggle) is not a
 * full month view in this pass — it currently aliases to Week. A full
 * month calendar is a genuinely separate, larger UI this phase's
 * budget didn't cover; flagged here for explicit follow-up rather than
 * built as a shallow stand-in. Week and Day are both fully real.
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
import * as workspaceService from '../../services/workspaceService.js';
import * as resourceService from '../../services/resourceService.js';
import * as subjectIdentityService from '../../services/subjectIdentityService.js';
import { createTimetablePeriod, createTimetableSlot } from '../../models/Timetable.js';
import { hydrateConceptRecordsForConcepts } from '../../services/conceptRecordHydrationService.js';
import { getFeedbackEligibleConceptIds } from '../../models/Lesson.js';
import { getTimetableSubjectColor } from '../../config/timetableSubjectColors.js';
import { getWeekRange, shiftDateKey, getTodayDateKey, formatDateKey } from '../../utils/dateHelpers.js';
import { createIcon } from '../components/Icon.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { renderSubjectBadge, renderLessonTopicLabel } from '../components/ScheduleItemLabels.js';
import { getResourceTypeIcon } from '../../config/resourceTypeConfig.js';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Matches css/styles.css's own `@media (max-width: 640px) { .timetable-view__table { display: none; } }` — Day mode is the natural mobile operating view (per the approved reference), never the Week grid squeezed into a phone width. */
function isNarrowViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= 640;
}

export async function renderTimetableView(container, { classroom }) {
  const state = {
    viewMode: isNarrowViewport() ? 'day' : 'week', // 'week' | 'day' | 'calendar' (calendar aliases to week — see header comment)
    anchorDateKey: getTodayDateKey(),
    lessonsByTeachingSlotId: {},
    selectedTeachingSlotId: null,
    activeDetailTab: 'overview', // 'overview' | 'concepts' | 'resources' | 'reflection' — Phase P
  };

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

    await hydrateSelectedLessonFeedback();
    render(slots, range);
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
    return getWeekRange(state.anchorDateKey);
  }

  function render(slots, range) {
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'timetable-view';

    root.appendChild(renderHeader());
    root.appendChild(renderToolbar(range));
    root.appendChild(state.viewMode === 'day' ? renderDayGrid(slots, range) : renderWeekGrid(slots, range));
    root.appendChild(renderLegend());
    root.appendChild(renderSummaryRow(slots));

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

    const step = state.viewMode === 'day' ? 1 : 7;
    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.appendChild(createIcon('arrow-left', { size: 16 }));
    prevButton.addEventListener('click', () => {
      state.anchorDateKey = shiftDateKey(state.anchorDateKey, -step);
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });
    nav.appendChild(prevButton);

    const todayButton = document.createElement('button');
    todayButton.type = 'button';
    todayButton.textContent = 'Today';
    todayButton.addEventListener('click', () => {
      state.anchorDateKey = getTodayDateKey();
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });
    nav.appendChild(todayButton);

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.appendChild(createIcon('arrow-right', { size: 16 }));
    nextButton.addEventListener('click', () => {
      state.anchorDateKey = shiftDateKey(state.anchorDateKey, step);
      state.selectedTeachingSlotId = null;
      loadAndRender();
    });
    nav.appendChild(nextButton);

    const rangeLabel = document.createElement('span');
    rangeLabel.className = 'timetable-view__range-label';
    rangeLabel.textContent = range.start === range.end ? formatDateKey(range.start) : `${formatDateKey(range.start)} – ${formatDateKey(range.end)}`;
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
        // 'calendar' deliberately aliases to 'week' — see this file's
        // own header comment SCOPE NOTE.
        state.viewMode = id === 'calendar' ? 'week' : id;
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

    const color = getTimetableSubjectColor(slot.subjectId);
    const strip = document.createElement('span');
    strip.className = 'timetable-period-card__subject';
    strip.style.background = color.tint;
    strip.style.color = color.text;
    strip.textContent = timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId).toUpperCase();
    panel.appendChild(strip);

    if (!lesson) {
      panel.appendChild(renderAttachLessonForm(slot));
      return panel;
    }

    const topic = timetableDisplayService.resolveLessonTopic(classroom, lesson);
    const topicEl = document.createElement('h2');
    topicEl.textContent = topic || '(untitled lesson)';
    panel.appendChild(topicEl);

    // Phase P — tab navigation (Overview / Concepts / Resources /
    // Reflection), per the approved reference. Reduces the previous
    // single continuous scroll's visual density; no data is
    // duplicated between tabs — each tab reads the same `lesson`/
    // `classroom` objects and the same already-computed feedback
    // summary, just scoped to what that tab actually needs.
    const concepts = timetableDisplayService.resolveLessonConcepts(classroom, lesson);
    const tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'concepts', label: `Concepts (${concepts.length})` },
      { id: 'resources', label: 'Resources' },
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
    } else if (state.activeDetailTab === 'resources') {
      tabContent.appendChild(renderResourcesTabPlaceholder());
      loadResourcesTab(tabContent, lesson);
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
   * Phase T fix — the root cause of the reported "Measurement gets
   * attached automatically" bug: a native <select> ALWAYS has some
   * option selected (there is no such thing as an empty selection),
   * so the previous version of this form — which populated unitSelect
   * with the subject's real units and never added a placeholder —
   * silently had its FIRST real unit selected the instant this form
   * rendered, before the teacher touched anything. A teacher who
   * clicked "Attach lesson plan" without deliberately re-choosing a
   * unit (a very easy thing to not realize you need to do) ended up
   * attaching whichever unit happened to sort first — "Measurement" in
   * the reported case — as this Lesson's real, saved curriculumUnitId.
   * Concepts themselves were never auto-checked (checkboxes always
   * started unchecked), but the picker rendering fully populated,
   * already-scoped-to-a-silently-chosen-unit concept list read, from
   * the teacher's side, as "the app already decided the topic for me."
   *
   * Fixed with an explicit, disabled placeholder option that stays
   * selected until the teacher deliberately picks a real unit (see
   * placeholderOption below) — "Attach lesson plan" stays disabled
   * until they do. Concepts now start in an explicit empty state ("No
   * concepts added yet." + "+ Add concept") rather than eagerly
   * rendering every checkbox for whatever unit happens to be selected
   * — nothing about a Lesson's content is ever pre-filled; every field
   * requires a deliberate action.
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

    const conceptsLabel = document.createElement('p');
    conceptsLabel.className = 'period-detail-panel__attach-label';
    conceptsLabel.textContent = 'Concepts';
    wrapper.appendChild(conceptsLabel);

    const conceptSection = document.createElement('div');
    wrapper.appendChild(conceptSection);

    const attachButton = document.createElement('button');
    attachButton.type = 'button';
    attachButton.className = 'btn btn--primary';
    attachButton.textContent = 'Attach lesson plan';
    attachButton.disabled = true;

    const checkboxes = new Map();
    let conceptPickerOpen = false;

    function updateAttachButtonState() {
      attachButton.disabled = !unitSelect.value;
    }

    function renderConceptSection() {
      conceptSection.innerHTML = '';
      checkboxes.clear();

      const unit = learningSubject.units.find((u) => u.id === unitSelect.value);
      if (!unit) {
        const hint = document.createElement('p');
        hint.className = 'period-detail-panel__attach-hint';
        hint.textContent = 'Choose a unit above to add concepts.';
        conceptSection.appendChild(hint);
        return;
      }

      if (!conceptPickerOpen) {
        const empty = document.createElement('p');
        empty.className = 'period-detail-panel__attach-hint';
        empty.textContent = 'No concepts added yet.';
        conceptSection.appendChild(empty);

        // Reuses the same checkbox picker this form already had —
        // just revealed on an explicit action instead of eagerly, per
        // "no automatic concept insertion."
        const addConceptButton = document.createElement('button');
        addConceptButton.type = 'button';
        addConceptButton.className = 'btn btn--text';
        addConceptButton.textContent = '+ Add concept';
        addConceptButton.addEventListener('click', () => {
          conceptPickerOpen = true;
          renderConceptSection();
        });
        conceptSection.appendChild(addConceptButton);
        return;
      }

      const conceptListEl = document.createElement('div');
      conceptListEl.className = 'period-detail-panel__concept-picker';
      (unit.concepts || []).forEach((concept) => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = concept.id;
        checkboxes.set(concept.id, checkbox);
        label.appendChild(checkbox);
        label.append(concept.title);
        conceptListEl.appendChild(label);
      });
      conceptSection.appendChild(conceptListEl);
    }

    unitSelect.addEventListener('change', () => {
      conceptPickerOpen = false; // a different unit invalidates whatever concepts were being picked for the old one
      renderConceptSection();
      updateAttachButtonState();
    });

    attachButton.addEventListener('click', () =>
      runAction(async () => {
        const conceptIds = [...checkboxes.entries()].filter(([, cb]) => cb.checked).map(([id]) => id);
        await timetableLessonService.attachLessonPlan(classroom, {
          teachingSlotId: slot.id,
          date: slot.date,
          curriculumUnitId: unitSelect.value,
          conceptIds,
        });
        await loadAndRender();
      })
    );

    renderConceptSection();
    wrapper.appendChild(attachButton);

    return wrapper;
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
   * The Concepts tab — the full interactive picker (taught/not-taught
   * checkboxes, per-concept Carry Forward actions), plus concept-level
   * feedback where available. The per-concept positivePercent/
   * respondedCount shown next to an executed concept was already
   * computed by conceptFeedbackService.js's own getLessonFeedbackSummary()
   * (its `conceptStats` array) — surfaced here for the first time, not
   * a new calculation.
   */
  /**
   * Phase U — STATE A (zero concepts): previously this tab always
   * rendered "Mark concepts as covered" regardless of concept count —
   * a real UX dead end (nothing to mark, and no way to add anything).
   * Now shows an explicit empty state + "+ Add concept" instead, and
   * the Mark-covered button simply does not exist in this state
   * (never a disabled button left visible). STATE B/C (concepts.length
   * > 0) is completely unchanged — same rows, same checkboxes, same
   * Mark-covered button, same underlying markConceptsExecuted() call.
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

    let pendingExecuted = [...lesson.executedConceptIds];

    concepts.forEach(({ id, title: conceptTitle }) => {
      const row = document.createElement('div');
      row.className = 'period-detail-panel__concept-row';

      const label = document.createElement('span');
      label.textContent = conceptTitle;
      row.appendChild(label);

      const stat = conceptStatsById.get(id);
      if (stat) {
        const feedback = document.createElement('span');
        feedback.className = 'period-detail-panel__concept-feedback';
        feedback.textContent = `${stat.respondedCount}/${stat.totalStudents} · ${stat.positivePercent}%`;
        row.appendChild(feedback);
      }

      if (carriedSet.has(id)) {
        const badge = document.createElement('span');
        badge.className = 'period-detail-panel__concept-status period-detail-panel__concept-status--carried';
        badge.textContent = 'Carried Forward';
        row.appendChild(badge);
      } else {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = executedSet.has(id);
        checkbox.title = 'Mark as taught';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) pendingExecuted.push(id);
          else pendingExecuted = pendingExecuted.filter((c) => c !== id);
        });
        row.appendChild(checkbox);

        if (!executedSet.has(id)) {
          const carryButton = document.createElement('button');
          carryButton.type = 'button';
          carryButton.className = 'btn btn--ghost';
          carryButton.textContent = 'Carry Forward';
          carryButton.addEventListener('click', () => openCarryForwardFlow(slot, lesson, id, conceptTitle));
          row.appendChild(carryButton);
        }
      }

      section.appendChild(row);
    });

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--primary';
    saveButton.textContent = 'Mark concepts as covered';
    saveButton.addEventListener('click', () =>
      runAction(async () => {
        await timetableLessonService.markConceptsExecuted(classroom, lesson, pendingExecuted);
        workspaceService.save(classroom);
        await loadAndRender();
      })
    );
    section.appendChild(saveButton);

    return section;
  }

  /**
   * STATE A's empty state — "No concepts added yet." + an explicit
   * "+ Add concept" action, reusing the exact same
   * `.period-detail-panel__attach-hint` / `.period-detail-panel__concept-picker`
   * classes (and the same unchecked-checkbox-list pattern) Phase T's
   * Attach Lesson form already established, so this reads as the same
   * mechanism rather than a second one. The lesson's unit
   * (curriculumUnitId) is already fixed at this point (a lesson always
   * has one — see models/Lesson.js) — no unit re-selection needed
   * here, only which of that unit's remaining concepts to add.
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
      const availableConcepts = unit?.concepts || [];

      if (!unit || availableConcepts.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'period-detail-panel__attach-hint';
        hint.textContent = unit
          ? 'This unit has no concepts set up yet in Learning Management.'
          : 'This lesson’s unit could not be found.';
        wrapper.appendChild(hint);
        return;
      }

      const checkboxes = new Map();
      const listEl = document.createElement('div');
      listEl.className = 'period-detail-panel__concept-picker';
      availableConcepts.forEach((concept) => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = concept.id;
        checkboxes.set(concept.id, checkbox);
        label.appendChild(checkbox);
        label.append(concept.title);
        listEl.appendChild(label);
      });
      wrapper.appendChild(listEl);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn btn--primary';
      addButton.textContent = 'Add concept';
      addButton.addEventListener('click', () =>
        runAction(async () => {
          const newIds = [...checkboxes.entries()].filter(([, cb]) => cb.checked).map(([id]) => id);
          if (newIds.length === 0) return;
          lesson.conceptIds = [...lesson.conceptIds, ...newIds];
          await plannerRepository.saveLesson(classroom.id, lesson);
          await loadAndRender();
        })
      );
      wrapper.appendChild(addButton);
    }

    renderPrompt();
    return wrapper;
  }

  /** Resources tab — a lightweight loading placeholder, filled in by loadResourcesTab() once the (async) resource fetch resolves. Matches this file's own "grid data renders instantly, network data fills in" convention already used for lessons. */
  function renderResourcesTabPlaceholder() {
    const section = document.createElement('div');
    section.className = 'period-detail-panel__resources';
    section.textContent = 'Loading resources…';
    return section;
  }

  /**
   * Aggregates services/resourceService.js's own getResources() across
   * every concept in this lesson — reuses the exact same resource
   * system ConceptWorkspaceView.js already uses per-concept; no new
   * resource system, no lesson-level resource field. Falls back to
   * this app's own existing empty state when a lesson genuinely has no
   * linked resources yet.
   */
  async function loadResourcesTab(container, lesson) {
    // The REAL LearningConcept objects (with their own resourceLinks
    // field), not timetableDisplayService's {id, title}-only display
    // shape — resourceService.getResources() reads resourceLinks
    // directly off whatever concept object it's given.
    const realConcepts = lesson.conceptIds.map((id) => learningRecordService.getConceptById(classroom, id)).filter(Boolean);
    let resources = [];
    try {
      const perConcept = await Promise.all(realConcepts.map((concept) => resourceService.getResources(classroom.id, concept)));
      resources = perConcept.flat();
    } catch (error) {
      console.error('[TimetableView] Failed to load lesson resources:', error);
    }

    // Only replace the placeholder if this exact tab content node is
    // still the one on screen — a slow fetch resolving after the
    // teacher already switched tabs/periods must never clobber
    // whatever's now actually showing.
    if (!container.isConnected || state.activeDetailTab !== 'resources') return;

    container.innerHTML = '';
    if (resources.length === 0) {
      container.appendChild(createEmptyStateElement({ message: 'No resources linked to this lesson’s concepts yet.' }));
      return;
    }

    const list = document.createElement('div');
    list.className = 'period-detail-panel__resource-list';
    resources.forEach((resource) => {
      const item = document.createElement('div');
      item.className = 'period-detail-panel__resource-item';
      item.appendChild(createIcon(getResourceTypeIcon(resource.type), { size: 16 }));
      const label = document.createElement('span');
      label.textContent = resource.title;
      item.appendChild(label);
      list.appendChild(item);
    });
    container.appendChild(list);
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
    const draftSlots = new Map(); // `${weekday}_${periodNumber}` -> subjectId
    WEEKDAY_ORDER.forEach((weekday) => {
      timetableService.getSlotsForWeekday(classroom, weekday).forEach((slot) => {
        draftSlots.set(`${weekday}_${slot.periodNumber}`, slot.subjectId);
      });
    });

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

    function renderSubjectSelect(weekday, periodNumber) {
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
      select.value = draftSlots.get(key) || '';
      select.addEventListener('change', () => {
        if (select.value) draftSlots.set(key, select.value);
        else draftSlots.delete(key);
      });

      return select;
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
            cell.appendChild(renderSubjectSelect(weekday, period.periodNumber));
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
          card.appendChild(renderSubjectSelect(mobileActiveWeekday, period.periodNumber));

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
            const subjectId = draftSlots.get(`${weekday}_${period.periodNumber}`);
            if (subjectId) nextSlots.push(createTimetableSlot({ weekday, periodNumber: period.periodNumber, subjectId }));
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

function monthAbbrev(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short' });
}
