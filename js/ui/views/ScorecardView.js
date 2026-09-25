/**
 * ui/views/ScorecardView.js
 *
 * The Scorecard — a read-only reporting layer over the same
 * Assessment records ui/views/AssessmentManagementView.js's own
 * Gradebook already owns (see services/scorecardService.js's own
 * header comment for the full architecture: cycles are grouped by
 * ScheduledEvent title, subjects are gated through Learning
 * Activities, nothing here stores a duplicate mark). Two steps:
 *
 *   - No cycleKey: the list of eligible exam cycles (a cycle only
 *     appears here once it has at least one Learning-Activities-
 *     eligible subject — see getEligibleExamCycles()).
 *   - A cycleKey given: that one cycle's own student-by-subject table.
 *
 * Never replaces the individual Assessment page — every subject
 * column header that already has a linked Assessment navigates
 * straight to that exact page's own Gradebook (the same route/URL
 * every other "open this Assessment" action in this app already
 * uses), and marks themselves are still only ever entered/edited
 * there, never here.
 */

import { createBackButton } from '../components/BackButton.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { createNavigationRow } from '../components/NavigationRow.js';
import * as scheduledEventRepository from '../../services/scheduledEventRepository.js';
import { getEventsByType, SCHEDULED_EVENT_TYPES } from '../../services/scheduledEventService.js';
import * as scorecardService from '../../services/scorecardService.js';
import * as assessmentService from '../../services/assessmentService.js';
import { getMarksColorClass, getPassMarkForSubject, GREEN_THRESHOLD_PERCENT } from '../../config/assessmentMarksColorConfig.js';
import { getTodayDateKey, shiftDateKey, formatDateKey } from '../../utils/dateHelpers.js';

export function renderScorecardView(container, { classroom, cycleKey, onBack, onNavigate, onSelectStudent }) {
  // `null` = still loading (see loadCycles() below) — same "omit the
  // section until it resolves, never a placeholder" convention
  // AssessmentManagementView.js's own loadScheduledExamItems() already
  // established for the identical Firestore read.
  let cycles = null;

  async function loadCycles() {
    const todayKey = getTodayDateKey();
    const start = shiftDateKey(todayKey, -60);
    const end = shiftDateKey(todayKey, 365);
    const events = await scheduledEventRepository.getScheduledEventsForDateRange(classroom.id, start, end);
    const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);
    cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, assessmentService.getAssessments(classroom));
    render();
  }

  function onSelectStudentAndNavigate(student) {
    onSelectStudent(student.id);
  }

  function render() {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'learning-management learning-management-view';

    const header = document.createElement('header');
    header.className = 'learning-management__header';
    header.appendChild(
      createBackButton(() => {
        if (cycleKey) onNavigate(`/classroom/${classroom.id}/assessments/scorecard`);
        else onBack();
      })
    );
    const title = document.createElement('h1');
    title.className = 'learning-management__title';
    title.textContent = 'Scorecard';
    header.appendChild(title);
    wrapper.appendChild(header);

    if (cycles === null) {
      container.appendChild(wrapper);
      return;
    }

    const section = document.createElement('div');
    section.className = 'learning-management__section';

    if (!cycleKey) {
      section.appendChild(renderCycleList());
    } else {
      const cycle = cycles.find((c) => c.cycleKey === cycleKey);
      if (!cycle) {
        const notFound = document.createElement('p');
        notFound.className = 'learning-management__intro';
        notFound.textContent = 'This exam cycle is no longer available.';
        section.appendChild(notFound);
      } else {
        section.appendChild(renderCycleTable(cycle));
      }
    }

    wrapper.appendChild(section);
    container.appendChild(wrapper);
  }

  function renderCycleList() {
    const listWrapper = document.createDocumentFragment();

    if (cycles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'learning-management__intro';
      empty.textContent =
        'No exam cycles yet — a cycle appears here once a Timetable exam exists for a subject already in your Learning Activities.';
      listWrapper.appendChild(empty);
      return listWrapper;
    }

    const list = document.createElement('div');
    list.className = 'learning-management__subject-card-list';
    cycles.forEach((cycle) => {
      const subjectNames = cycle.items.map((item) => item.subjectTitle).join(', ');
      list.appendChild(
        createNavigationRow({
          label: `${cycle.title} — ${subjectNames}`,
          onClick: () => onNavigate(`/classroom/${classroom.id}/assessments/scorecard/${encodeURIComponent(cycle.cycleKey)}`),
        })
      );
    });
    listWrapper.appendChild(list);
    return listWrapper;
  }

  function renderCycleTable(cycle) {
    const sectionFragment = document.createDocumentFragment();
    const scorecard = scorecardService.buildScorecardForCycle(classroom, cycle.items);
    const subjectCounts = scorecardService.getSubjectAssessedCounts(classroom, scorecard.subjects);

    sectionFragment.appendChild(renderHeaderCard(cycle, scorecard, subjectCounts));
    sectionFragment.appendChild(renderSubjectChips(subjectCounts));
    sectionFragment.appendChild(renderLegend());

    const tableContainer = document.createElement('div');
    tableContainer.className = 'scorecard__table-container';
    tableContainer.appendChild(renderTable(scorecard));
    sectionFragment.appendChild(tableContainer);

    return sectionFragment;
  }

  /**
   * The Scorecard's own visual identity — eyebrow + prominent title +
   * metadata, with the header's own key numbers presented as compact
   * stat tiles rather than folded into a plain sentence. Every number
   * here is read directly from scorecard/subjectCounts, already
   * computed by services/scorecardService.js — nothing invented.
   */
  function renderHeaderCard(cycle, scorecard, subjectCounts) {
    const card = document.createElement('div');
    card.className = 'scorecard__header-card';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'scorecard__eyebrow';
    eyebrow.textContent = 'Scorecard';
    card.appendChild(eyebrow);

    const title = document.createElement('h2');
    title.className = 'scorecard__title';
    title.textContent = cycle.title;
    card.appendChild(title);

    const earliestDate = [...cycle.items.map((item) => item.event.date)].sort()[0];
    const meta = document.createElement('p');
    meta.className = 'scorecard__meta';
    meta.textContent = [classroom.academicYear, `${scorecard.subjects.length} Subject${scorecard.subjects.length === 1 ? '' : 's'}`, `${scorecard.rows.length} Student${scorecard.rows.length === 1 ? '' : 's'}`, formatDateKey(earliestDate)]
      .filter(Boolean)
      .join(' · ');
    card.appendChild(meta);

    const stats = document.createElement('div');
    stats.className = 'stat-tile-grid';
    const assessedPercent = scorecardService.getOverallAssessedPercent(subjectCounts);
    [
      [scorecard.rows.length, 'Students', 'neutral'],
      [scorecard.subjects.length, scorecard.subjects.length === 1 ? 'Subject' : 'Subjects', 'neutral'],
      [assessedPercent === null ? '—' : `${assessedPercent}%`, 'Assessed', 'success'],
    ].forEach(([value, label, variant]) => {
      const stat = document.createElement('div');
      stat.className = `stat-tile stat-tile--${variant}`;
      const valueEl = document.createElement('span');
      valueEl.className = 'stat-tile__value';
      valueEl.textContent = String(value);
      const labelEl = document.createElement('span');
      labelEl.className = 'stat-tile__label';
      labelEl.textContent = label;
      stat.append(valueEl, labelEl);
      stats.appendChild(stat);
    });
    card.appendChild(stats);

    return card;
  }

  /** Compact "Science — 13/21 assessed" chips — one consistent, restrained tint for every subject (never a different colour per subject; see this feature's own "do not make every subject a different colour" requirement). */
  function renderSubjectChips(subjectCounts) {
    const wrapper = document.createElement('div');

    const label = document.createElement('p');
    label.className = 'scorecard__section-label';
    label.textContent = 'Subject Overview';
    wrapper.appendChild(label);

    const chips = document.createElement('div');
    chips.className = 'scorecard__subject-chips';
    subjectCounts.forEach((count) => {
      const chip = document.createElement('div');
      chip.className = 'scorecard__subject-chip';
      const titleEl = document.createElement('span');
      titleEl.className = 'scorecard__subject-chip-title';
      titleEl.textContent = count.subjectTitle;
      const countEl = document.createElement('span');
      countEl.className = 'scorecard__subject-chip-count';
      countEl.textContent = `${count.assessedCount}/${count.totalCount} assessed`;
      chip.append(titleEl, countEl);
      chips.appendChild(chip);
    });
    wrapper.appendChild(chips);
    return wrapper;
  }

  /**
   * The Red/Yellow/Green rule, described without a single specific
   * Pass Mark number — a Scorecard cycle can span more than one
   * Assessment, each with its OWN independently edited Pass Mark (see
   * services/assessmentService.js's own getPassMarkPercent()), so
   * showing one numeric threshold here could misrepresent a subject
   * whose own Assessment set a different one. The literal word "Pass
   * Mark" is accurate for every subject at once; a specific number
   * would not be. GREEN_THRESHOLD_PERCENT is the one value that's
   * genuinely fixed and safe to interpolate here.
   */
  function renderLegend() {
    const card = document.createElement('div');
    card.className = 'performance-legend-card';

    const label = document.createElement('p');
    label.className = 'performance-legend-card__label';
    label.textContent = 'Performance';
    card.appendChild(label);

    const chips = document.createElement('div');
    chips.className = 'performance-legend-card__chips';
    [
      { modifier: 'red', label: 'Red', desc: 'Below Pass Mark' },
      { modifier: 'yellow', label: 'Yellow', desc: `Pass Mark–${GREEN_THRESHOLD_PERCENT - 0.01}%` },
      { modifier: 'green', label: 'Green', desc: `${GREEN_THRESHOLD_PERCENT}%+` },
    ].forEach(({ modifier, label: chipLabel, desc }) => {
      const chip = document.createElement('div');
      chip.className = `performance-legend-chip performance-legend-chip--${modifier}`;
      const swatch = document.createElement('span');
      swatch.className = 'performance-legend-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      const labelEl = document.createElement('span');
      labelEl.className = 'performance-legend-chip-label';
      labelEl.textContent = chipLabel;
      const descEl = document.createElement('span');
      descEl.className = 'performance-legend-chip-desc';
      descEl.textContent = ` · ${desc}`;
      chip.append(swatch, labelEl, descEl);
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    return card;
  }

  function renderTable(scorecard) {
    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'assessment-gradebook__scroll scorecard__scroll';
    const table = document.createElement('table');
    table.className = 'assessment-gradebook scorecard__table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const studentTh = document.createElement('th');
    studentTh.className = 'assessment-gradebook__name-header';
    studentTh.textContent = 'Student';
    headerRow.appendChild(studentTh);

    scorecard.subjects.forEach((subject) => {
      const th = document.createElement('th');
      th.className = 'assessment-gradebook__subject-header scorecard__subject-header';
      const titleEl = document.createElement('span');
      titleEl.className = 'scorecard__subject-header-title';

      if (subject.linkedAssessment) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'scorecard__subject-header-link';
        link.textContent = subject.subjectTitle;
        link.addEventListener('click', () => onNavigate(`/classroom/${classroom.id}/assessments/${subject.linkedAssessment.id}/gradebook`));
        titleEl.appendChild(link);
        th.appendChild(titleEl);

        if (subject.assessmentSubject) {
          const passMarkPercent = assessmentService.getPassMarkPercent(subject.linkedAssessment);
          const passMark = getPassMarkForSubject(subject.assessmentSubject.maximumMarks, passMarkPercent);
          const meta = document.createElement('span');
          meta.className = 'scorecard__subject-header-meta';
          meta.textContent = `/${subject.assessmentSubject.maximumMarks} · Pass ${passMark}`;
          th.appendChild(meta);
        }
      } else {
        titleEl.textContent = subject.subjectTitle;
        th.appendChild(titleEl);
        const note = document.createElement('span');
        note.className = 'scorecard__subject-header-note';
        note.textContent = 'Not set up';
        th.appendChild(note);
      }
      headerRow.appendChild(th);
    });

    const overallTh = document.createElement('th');
    overallTh.textContent = 'Overall';
    headerRow.appendChild(overallTh);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    scorecard.rows.forEach((row) => {
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'assessment-gradebook__name-cell';
      nameCell.appendChild(createStudentNameElement({ student: row.student, onSelect: onSelectStudentAndNavigate, leadingMarker: 'none' }));
      tr.appendChild(nameCell);

      row.cells.forEach((cell, index) => {
        const subject = scorecard.subjects[index];
        const td = document.createElement('td');
        td.className = 'scorecard__cell';
        if (!cell.hasResult) {
          // Missing — intentionally empty, never coloured/treated as a
          // failing score (see this feature's own "Missing ≠ Zero,
          // Missing ≠ Failed" requirement).
          td.classList.add('scorecard__cell--empty');
          td.textContent = '—';
        } else {
          const passMarkPercent = assessmentService.getPassMarkPercent(subject.linkedAssessment);
          const colorClass = getMarksColorClass(cell.marks, cell.maximumMarks, passMarkPercent);
          if (colorClass) td.classList.add(colorClass);

          const scoreEl = document.createElement('span');
          scoreEl.className = 'scorecard__cell-score';
          scoreEl.textContent = String(cell.marks);
          const maxEl = document.createElement('span');
          maxEl.className = 'scorecard__cell-max';
          maxEl.textContent = `/${cell.maximumMarks}`;
          td.append(scoreEl, maxEl);
        }
        tr.appendChild(td);
      });

      const overallTd = document.createElement('td');
      overallTd.className = 'scorecard__cell scorecard__overall-cell';
      if (row.overallPercent === null) {
        overallTd.classList.add('scorecard__cell--empty');
        overallTd.textContent = '—';
      } else {
        const percentEl = document.createElement('span');
        percentEl.className = 'scorecard__overall-percent';
        percentEl.textContent = `${row.overallPercent}%`;
        const countEl = document.createElement('span');
        countEl.className = 'scorecard__overall-count';
        countEl.textContent = `${row.subjectsAssessedCount}/${row.subjectsTotalCount} Subjects Assessed`;
        overallTd.append(percentEl, countEl);
      }
      tr.appendChild(overallTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    scrollWrapper.appendChild(table);
    return scrollWrapper;
  }

  render();
  loadCycles();
}
