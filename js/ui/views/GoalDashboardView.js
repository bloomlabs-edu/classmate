/**
 * ui/views/GoalDashboardView.js
 *
 * "Who needs my attention today" — a Student/Today/Streak/Completion
 * table across every student, sorted so the students most needing
 * attention surface first, plus a per-student detail drill-down
 * showing exactly which categories are ticked and which aren't.
 *
 * Every number rendered here comes from
 * services/goalStatisticsService.js's own getStudentSummary() — this
 * view never computes a streak or percentage itself, matching how
 * every other statistics-driven view in this app (Recognition Wall,
 * Weekly Snapshot) only ever renders what its own service computed.
 */

import * as goalService from '../../services/goalService.js';
import * as goalStatisticsService from '../../services/goalStatisticsService.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

export function renderGoalDashboardView(container, { classroom, onBack }) {
  let selectedStudentId = null;

  function rerender() {
    render(container, classroom, selectedStudentId, {
      onBack,
      onSelectStudent: (studentId) => {
        selectedStudentId = studentId;
        rerender();
      },
      onBackToTable: () => {
        selectedStudentId = null;
        rerender();
      },
    });
  }

  rerender();
}

function render(container, classroom, selectedStudentId, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(selectedStudentId ? handlers.onBackToTable : handlers.onBack));
  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Goal Dashboard';
  titleBlock.appendChild(title);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const cycle = goalService.getActiveCycle(classroom);
  if (!cycle) {
    content.appendChild(createEmptyStateElement({ message: 'No active Goal Cycle yet.' }));
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    return;
  }

  if (selectedStudentId) {
    content.appendChild(renderStudentDetail(classroom, cycle, selectedStudentId));
  } else {
    content.appendChild(renderStudentTable(classroom, cycle, handlers));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderStudentTable(classroom, cycle, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const students = goalService.getClassroomStudents(classroom);
  const categoryCount = cycle.categories.length;

  if (students.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No students in this classroom yet.' }));
    return section;
  }

  const summaries = students
    .map((student) => goalStatisticsService.getStudentSummary(cycle, student, categoryCount))
    // Students most needing attention float to the top: lowest today-completion first, then lowest streak.
    .sort((a, b) => a.todayCompletedCount - b.todayCompletedCount || a.bestCurrentStreak - b.bestCurrentStreak);

  const table = document.createElement('div');
  table.className = 'goal-dashboard-table';

  const headerRow = document.createElement('div');
  headerRow.className = 'goal-dashboard-table__row goal-dashboard-table__row--header';
  ['Student', 'Today', 'Streak', 'Completion'].forEach((label) => {
    const cell = document.createElement('span');
    cell.textContent = label;
    headerRow.appendChild(cell);
  });
  table.appendChild(headerRow);

  summaries.forEach((summary) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'goal-dashboard-table__row goal-dashboard-table__row--clickable';
    row.addEventListener('click', () => handlers.onSelectStudent(summary.studentId));

    const nameCell = document.createElement('span');
    nameCell.textContent = summary.studentName;
    row.appendChild(nameCell);

    const todayCell = document.createElement('span');
    todayCell.textContent = `${summary.todayCompletedCount}/${summary.totalCategories}`;
    row.appendChild(todayCell);

    const streakCell = document.createElement('span');
    streakCell.textContent = summary.bestCurrentStreak > 0 ? `\ud83d\udd25${summary.bestCurrentStreak}` : '\u2014';
    row.appendChild(streakCell);

    const completionCell = document.createElement('span');
    completionCell.textContent = `${summary.overallCompletionPercent}%`;
    row.appendChild(completionCell);

    table.appendChild(row);
  });

  section.appendChild(table);
  return section;
}

function renderStudentDetail(classroom, cycle, studentId) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const student = goalService.getClassroomStudents(classroom).find((s) => s.id === studentId);

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = student ? student.name : 'Unknown student';
  section.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'settings-editable-list';

  goalService.listCategories(cycle).forEach((category) => {
    const goal = goalService.getGoalForStudent(cycle, category.id, studentId);
    const item = document.createElement('li');
    item.className = 'settings-editable-list__item';

    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = category.name;
    item.appendChild(label);

    const status = document.createElement('span');
    if (!goal) {
      status.textContent = 'No goal set';
      status.style.color = 'var(--color-muted)';
    } else if (goal.status === 'pending_approval') {
      status.textContent = 'Awaiting approval';
      status.style.color = 'var(--color-warning)';
    } else {
      const completedToday = goalStatisticsService.isCompletedToday(cycle, goal.id);
      status.textContent = completedToday ? '\u2713' : '\u2716';
      status.style.color = completedToday ? 'var(--color-success)' : 'var(--color-danger)';
      status.style.fontWeight = 'var(--font-weight-black)';
    }
    item.appendChild(status);

    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}
