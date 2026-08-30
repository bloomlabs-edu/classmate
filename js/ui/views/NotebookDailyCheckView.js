/**
 * ui/views/NotebookDailyCheckView.js
 *
 * The 'daily' trackingMode counterpart to
 * ui/views/NotebookCheckpointsView.js — reached instead of Checkpoints
 * for any notebook type configured as Daily Check (see
 * models/NotebookType.js, services/dailyCheckService.js). Never a
 * Handwriting-specific screen: any notebook type with trackingMode
 * 'daily' opens here, driven entirely by that notebook type's own
 * dailySettings (scoringEnabled/scoreMax/excludedDates).
 *
 * Deliberately NOT a sequence of named checkpoints — there is no
 * "+ Add Checkpoint" here at all. The teacher checks the roster
 * against one specific calendar date at a time (defaulting to today,
 * navigable to any other date), and the screen shows each student's
 * own current streak (services/dailyCheckService.js's own
 * getCurrentStreak()) — a derived value, never stored.
 *
 * Visually a specialized mode within Notebook Tracker, not a separate
 * application — reuses the exact same page-header treatment and
 * Plus Jakarta Sans scoping ui/views/NotebookTrackerView.js's own
 * redesign already established (.notebook-tracker-view/
 * .notebook-tracker__page-header), not a third header style.
 */

import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as dailyCheckService from '../../services/dailyCheckService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { getClassroomStudents } from '../../services/assessmentService.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { getTodayDateKey, shiftDateKey, formatDateKey } from '../../utils/dateHelpers.js';

export function renderNotebookDailyCheckView(container, { classroom, subjectId, notebookTypeId, onBack }) {
  let viewDate = getTodayDateKey();

  function rerender() {
    render(container, classroom, subjectId, notebookTypeId, viewDate, {
      onBack,
      onNavigateDate: (deltaDays) => {
        viewDate = shiftDateKey(viewDate, deltaDays);
        rerender();
      },
      onGoToToday: () => {
        viewDate = getTodayDateKey();
        rerender();
      },
      onToggleCheck: (studentId, notebookType) => {
        const existing = dailyCheckService.getRecordForStudentOnDate(classroom, subjectId, notebookTypeId, studentId, viewDate);
        const nextStatus = existing?.status === 'checked' ? 'not_checked' : 'checked';
        const scoreForNewCheck = notebookType.dailySettings?.scoringEnabled ? notebookType.dailySettings.scoreMax : undefined;
        dailyCheckService.setDailyCheck(classroom, {
          subjectId,
          notebookTypeId,
          studentId,
          date: viewDate,
          status: nextStatus,
          ...(nextStatus === 'checked' ? { score: scoreForNewCheck } : {}),
        });
        workspaceService.markDirty(classroom.id);
        workspaceService.saveExplicitly(classroom).catch(() => {});
        rerender();
      },
      onSetScore: (studentId, score) => {
        dailyCheckService.setDailyCheck(classroom, { subjectId, notebookTypeId, studentId, date: viewDate, status: 'checked', score });
        workspaceService.markDirty(classroom.id);
        workspaceService.saveExplicitly(classroom).catch(() => {});
        rerender();
      },
    });
  }

  rerender();
}

function render(container, classroom, subjectId, notebookTypeId, viewDate, handlers) {
  container.innerHTML = '';

  const subject = notebookConfigService.getSubjectById(classroom, subjectId);
  const notebookType = notebookConfigService.getNotebookTypeById(classroom, notebookTypeId);

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view notebook-tracker-view';

  const header = document.createElement('header');
  header.className = 'notebook-tracker__page-header';
  const backButton = createBackButton(handlers.onBack);
  const title = document.createElement('h1');
  title.className = 'notebook-tracker__page-header-title';
  title.textContent = `${subject?.name || '(Subject removed)'} · ${notebookType?.name || '(Type removed)'}`;
  header.append(backButton, title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content notebook-tracker__content';

  if (!notebookType) {
    content.appendChild(document.createTextNode('This notebook type no longer exists.'));
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    return;
  }

  const dailySettings = notebookType.dailySettings || { scoringEnabled: false, scoreMax: 5, excludedDates: [] };

  const subtitle = document.createElement('p');
  subtitle.className = 'daily-check__subtitle';
  subtitle.textContent = dailySettings.scoringEnabled ? `Daily Check · ${dailySettings.scoreMax} points` : 'Daily Check';
  content.appendChild(subtitle);

  content.appendChild(renderDateNav(viewDate, handlers));

  const isExpected = dailyCheckService.isExpectedCheckingDay(notebookType, viewDate);
  if (!isExpected) {
    content.appendChild(renderNonCheckingDayBanner(viewDate, !dailyCheckService.isWorkingWeekday(viewDate)));
  } else {
    content.appendChild(renderDailyTable(classroom, subject, notebookType, subjectId, notebookTypeId, viewDate, dailySettings, handlers));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderDateNav(viewDate, handlers) {
  const nav = document.createElement('div');
  nav.className = 'daily-check__date-nav';

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'btn btn--icon-only';
  prevButton.setAttribute('aria-label', 'Previous day');
  prevButton.appendChild(createIcon('arrow-left', { size: 16 }));
  prevButton.addEventListener('click', () => handlers.onNavigateDate(-1));

  const dateLabel = document.createElement('button');
  dateLabel.type = 'button';
  dateLabel.className = 'daily-check__date-label';
  dateLabel.textContent = formatDateKey(viewDate);
  dateLabel.title = 'Jump to today';
  dateLabel.addEventListener('click', () => handlers.onGoToToday());

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'btn btn--icon-only';
  nextButton.setAttribute('aria-label', 'Next day');
  nextButton.appendChild(createIcon('arrow-right', { size: 16 }));
  nextButton.addEventListener('click', () => handlers.onNavigateDate(1));

  nav.append(prevButton, dateLabel, nextButton);
  return nav;
}

/**
 * Weekend vs an explicitly-configured excluded date both render the
 * same visually-distinct "nothing to check today" state — no student
 * rows, no checkboxes, per explicit product decision (see this
 * feature's own spec: "No student checkboxes should be presented for
 * that date"). Labelled differently so the reason is legible at a
 * glance rather than collapsing both into one ambiguous "Holiday" word.
 */
function renderNonCheckingDayBanner(viewDate, isWeekend) {
  const banner = document.createElement('div');
  banner.className = 'daily-check__holiday-banner';
  banner.appendChild(createIcon('calendar', { size: 22 }));
  const label = document.createElement('p');
  label.className = 'daily-check__holiday-label';
  label.textContent = isWeekend ? 'Weekend — no check expected' : 'Holiday — no check expected';
  banner.appendChild(label);
  return banner;
}

function renderDailyTable(classroom, subject, notebookType, subjectId, notebookTypeId, viewDate, dailySettings, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'daily-check__table-wrap';

  const table = document.createElement('table');
  table.className = 'daily-check__table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Student', 'Today', 'Streak', ...(dailySettings.scoringEnabled ? ['Score'] : [])].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const students = getClassroomStudents(classroom);

  students.forEach((student) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.className = 'daily-check__name-cell';
    nameCell.textContent = student.name;
    row.appendChild(nameCell);

    const record = dailyCheckService.getRecordForStudentOnDate(classroom, subjectId, notebookTypeId, student.id, viewDate);
    const isChecked = record?.status === 'checked';

    const todayCell = document.createElement('td');
    const checkButton = document.createElement('button');
    checkButton.type = 'button';
    checkButton.className = 'daily-check__toggle' + (isChecked ? ' daily-check__toggle--checked' : '');
    checkButton.setAttribute('aria-label', isChecked ? `Mark ${student.name} not checked today` : `Mark ${student.name} checked today`);
    checkButton.appendChild(createIcon(isChecked ? 'check' : 'circle-dot', { size: 16 }));
    checkButton.addEventListener('click', () => handlers.onToggleCheck(student.id, notebookType));
    todayCell.appendChild(checkButton);
    row.appendChild(todayCell);

    const streak = dailyCheckService.getCurrentStreak(classroom, subjectId, notebookTypeId, notebookType, student.id, { asOfDate: viewDate });
    const streakCell = document.createElement('td');
    streakCell.className = 'daily-check__streak-cell';
    if (streak > 0) {
      streakCell.textContent = `🔥 ${streak}`;
    } else {
      streakCell.textContent = String(streak);
    }
    row.appendChild(streakCell);

    if (dailySettings.scoringEnabled) {
      const scoreCell = document.createElement('td');
      if (isChecked) {
        const scoreInput = document.createElement('input');
        scoreInput.type = 'number';
        scoreInput.className = 'daily-check__score-input';
        scoreInput.min = '0';
        scoreInput.max = String(dailySettings.scoreMax);
        scoreInput.value = record.score ?? '';
        scoreInput.addEventListener('change', () => {
          const parsed = Number(scoreInput.value);
          const clamped = Math.max(0, Math.min(dailySettings.scoreMax, Number.isFinite(parsed) ? parsed : 0));
          handlers.onSetScore(student.id, clamped);
        });
        const scoreWrap = document.createElement('span');
        scoreWrap.className = 'daily-check__score-wrap';
        scoreWrap.appendChild(scoreInput);
        scoreWrap.append(`/${dailySettings.scoreMax}`);
        scoreCell.appendChild(scoreWrap);
      } else {
        scoreCell.textContent = '—';
      }
      row.appendChild(scoreCell);
    }

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}
