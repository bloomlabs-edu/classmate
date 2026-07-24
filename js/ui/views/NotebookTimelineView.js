/**
 * ui/views/NotebookTimelineView.js
 *
 * Read-only historical view — deliberately separate from the Register
 * View (today's fast marking workflow). Student-first, matching how a
 * teacher actually asks the question ("How has Hari been doing?" rather
 * than "What happened on July 3?"): one row per student, each a
 * horizontal run of day-symbols for the currently-viewed period.
 *
 * Defaults to the current WEEK (Monday-start, via dateHelpers'
 * getWeekRange) rather than the current month — a full month of dots
 * is a lot to take in at once for a "how's this week going" glance,
 * which is the more common question. A Weekly/Monthly toggle switches
 * between the two.
 *
 * View mode and navigation position are tracked as local state via this
 * view's own rerender closure (the same pattern TrackerView.js already
 * uses for Class Mode), not the URL/router — unlike the Register View's
 * date, which stays meaningfully bookmarkable, exactly which week or
 * month of a read-only history view you're looking at doesn't carry
 * the same need to survive a page reload or be shareable as a link.
 */

import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as notebookService from '../../services/notebookService.js';
import { createNotebookTimelineElement } from '../components/NotebookTimeline.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { NOTEBOOK_TIMELINE_SYMBOLS, NOTEBOOK_TIMELINE_STATUS_LABELS, deriveDaySymbolKey } from '../../config/notebookStatuses.js';
import {
  getTodayDateKey,
  shiftDateKey,
  getWeekRange,
  getDaysInYearMonth,
  getCurrentYearMonth,
  shiftYearMonth,
  formatYearMonth,
  formatDateKey,
} from '../../utils/dateHelpers.js';

function formatWeekRangeLabel(start, end) {
  return `${formatDateKey(start)} \u2013 ${formatDateKey(end)}`;
}

export function renderNotebookTimelineView(container, props) {
  const { classroom, subjectId, notebookTypeId, onBack } = props;
  const viewMode = props.viewMode || 'week';
  const referenceDateKey = props.referenceDateKey || getTodayDateKey();

  container.innerHTML = '';

  const subject = notebookConfigService.getSubjectById(classroom, subjectId);
  const notebookType = notebookConfigService.getNotebookTypeById(classroom, notebookTypeId);

  if (!subject || !notebookType) {
    container.appendChild(createEmptyStateElement({ message: 'This notebook could not be found.' }));
    return;
  }

  const rerender = (next) =>
    renderNotebookTimelineView(container, { ...props, viewMode, referenceDateKey, ...next });

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.textContent = '\u2190 Back to Register';
  backButton.addEventListener('click', onBack);

  const titleEl = document.createElement('h1');
  titleEl.className = 'tracker-header__title';
  titleEl.textContent = `${subject.name} \u00b7 ${notebookType.name} \u00b7 Timeline`;

  const modeToggle = document.createElement('div');
  modeToggle.className = 'toggle-group tracker-header__actions';
  ['week', 'month'].forEach((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-group__button' + (viewMode === mode ? ' toggle-group__button--active' : '');
    button.textContent = mode === 'week' ? 'Weekly' : 'Monthly';
    button.addEventListener('click', () => rerender({ viewMode: mode }));
    modeToggle.appendChild(button);
  });

  header.append(backButton, titleEl, modeToggle);
  wrapper.appendChild(header);

  const dateBar = document.createElement('div');
  dateBar.className = 'notebook-date-bar';

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'btn btn--text';
  prevButton.textContent = '\u2190';

  // Same pattern as NotebookRegisterView.js's date, for consistency —
  // a native <input type="date"> overlaid invisibly on the formatted
  // label, so the visible text ("13 Jul \u2013 19 Jul 2026" / "July 2026")
  // stays exactly as it was, but clicking it opens the native picker.
  // Selecting any date jumps to the week/month that date falls in.
  const dateLabelWrapper = document.createElement('label');
  dateLabelWrapper.className = 'notebook-date-bar__label-wrapper';

  const dateLabel = document.createElement('span');
  dateLabel.className = 'notebook-date-bar__label';

  const datePickerInput = document.createElement('input');
  datePickerInput.type = 'date';
  datePickerInput.className = 'notebook-date-bar__picker-input';
  datePickerInput.setAttribute('aria-label', 'Jump to a date');
  datePickerInput.addEventListener('change', (event) => {
    if (event.target.value) rerender({ referenceDateKey: event.target.value });
  });

  dateLabelWrapper.append(dateLabel, datePickerInput);

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'btn btn--text';
  nextButton.textContent = '\u2192';

  let rangeStart;
  let rangeEnd;

  if (viewMode === 'week') {
    const { start, end } = getWeekRange(referenceDateKey);
    rangeStart = start;
    rangeEnd = end;
    dateLabel.textContent = formatWeekRangeLabel(start, end);
    datePickerInput.value = referenceDateKey;
    prevButton.setAttribute('aria-label', 'Previous week');
    prevButton.addEventListener('click', () => rerender({ referenceDateKey: shiftDateKey(referenceDateKey, -7) }));
    nextButton.setAttribute('aria-label', 'Next week');
    nextButton.addEventListener('click', () => rerender({ referenceDateKey: shiftDateKey(referenceDateKey, 7) }));
  } else {
    const yearMonth = referenceDateKey.slice(0, 7) || getCurrentYearMonth();
    rangeStart = `${yearMonth}-01`;
    rangeEnd = `${yearMonth}-${String(getDaysInYearMonth(yearMonth)).padStart(2, '0')}`;
    dateLabel.textContent = formatYearMonth(yearMonth);
    datePickerInput.value = rangeStart;
    prevButton.setAttribute('aria-label', 'Previous month');
    prevButton.addEventListener('click', () =>
      rerender({ referenceDateKey: `${shiftYearMonth(yearMonth, -1)}-01` })
    );
    nextButton.setAttribute('aria-label', 'Next month');
    nextButton.addEventListener('click', () =>
      rerender({ referenceDateKey: `${shiftYearMonth(yearMonth, 1)}-01` })
    );
  }

  dateBar.append(prevButton, dateLabelWrapper, nextButton);
  wrapper.appendChild(dateBar);

  const legend = document.createElement('p');
  legend.className = 'profile-section__meta notebook-timeline-legend';
  legend.style.padding = '0 1.5rem';
  legend.textContent = Object.entries(NOTEBOOK_TIMELINE_SYMBOLS)
    .map(([key, symbol]) => `${symbol} ${NOTEBOOK_TIMELINE_STATUS_LABELS[key]}`)
    .join('   ');
  wrapper.appendChild(legend);

  const allStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  if (allStudents.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'There are no students in this classroom yet.' }));
  } else {
    allStudents.forEach(({ student }) => {
      const days = [];
      let cursor = rangeStart;
      while (cursor <= rangeEnd) {
        const entry = notebookService.getEntry(classroom, subjectId, notebookTypeId, cursor, student.id);
        const symbolKey = deriveDaySymbolKey(entry);
        days.push({
          dateKey: cursor,
          symbol: NOTEBOOK_TIMELINE_SYMBOLS[symbolKey],
          statusLabel: NOTEBOOK_TIMELINE_STATUS_LABELS[symbolKey],
        });
        cursor = shiftDateKey(cursor, 1);
      }

      content.appendChild(
        createNotebookTimelineElement({
          label: student.name,
          days,
          onLabelClick: onSelectStudent ? () => onSelectStudent(student.id) : null,
        })
      );
    });
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}
