/**
 * ui/views/GoalDashboardView.js
 *
 * "Who needs my attention today" — per-category, per-student status
 * in a real matrix (columns = Categories, rows = Students), matching
 * the same visual model as ui/views/NotebookCheckpointsView.js's own
 * Checkpoint grid, per explicit product decision. Reuses that
 * screen's own presentational CSS classes directly
 * (.assessment-gradebook, .notebook-checkpoints__column-header/--cell)
 * — never its column-reorder/delete machinery, since Categories are
 * already managed elsewhere (GoalManagementView.js's own "Manage
 * Goals" screen).
 *
 * "Goals Awaiting Approval" and "Haven't Submitted All Goals Yet"
 * (plus the review/approve flow that goes with the former) moved here
 * from GoalManagementView.js, per explicit product decision — this is
 * where a teacher already looks at per-student status, so reviewing
 * and approving belongs here too, not split across two screens.
 *
 * Every number rendered here comes from
 * services/goalStatisticsService.js's own isCompletedToday() — this
 * view never computes completion itself, matching how every other
 * statistics-driven view in this app (Recognition Wall, Weekly
 * Snapshot) only ever renders what its own service computed.
 */

import * as goalService from '../../services/goalService.js';
import * as studentGoalsService from '../../services/studentGoalsService.js';
import * as goalStatisticsService from '../../services/goalStatisticsService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

export function renderGoalDashboardView(container, { classroom, onBack }) {
  // mode: 'table' | 'studentDetail' | 'reviewGoal'
  let mode = 'table';
  let selectedStudentId = null;
  let reviewingGoalId = null;
  let pendingGoals = [];
  let allGoals = [];
  let reviewingGoal = null;

  async function rerender() {
    const cycle = goalService.getActiveCycle(classroom);
    if (cycle && mode === 'table') {
      pendingGoals = await studentGoalsService.getPendingApprovalGoalsForClassroom(classroom.id, cycle.id);
      allGoals = await studentGoalsService.getAllGoalsForClassroom(classroom.id, cycle.id);
    }
    if (cycle && mode === 'reviewGoal') {
      const cycleGoals = await studentGoalsService.getPendingApprovalGoalsForClassroom(classroom.id, cycle.id);
      reviewingGoal = cycleGoals.find((g) => g.id === reviewingGoalId) ?? null;
    }
    render(container, mode, { classroom, selectedStudentId, pendingGoals, allGoals, reviewingGoal }, handlers);
  }

  const handlers = {
    onBack,
    onSelectStudent: (studentId) => {
      selectedStudentId = studentId;
      mode = 'studentDetail';
      rerender();
    },
    onBackToTable: () => {
      selectedStudentId = null;
      mode = 'table';
      rerender();
    },
    onReviewGoal: (goalId) => {
      reviewingGoalId = goalId;
      mode = 'reviewGoal';
      rerender();
    },
    onApproveGoal: async (goalId) => {
      await studentGoalsService.approveGoal(classroom.id, goalId);
      mode = 'table';
      reviewingGoalId = null;
      rerender();
    },
    onCancelReview: () => {
      mode = 'table';
      reviewingGoalId = null;
      rerender();
    },
  };

  rerender();
}

function render(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  const backTarget = mode === 'studentDetail' ? handlers.onBackToTable : mode === 'reviewGoal' ? handlers.onCancelReview : handlers.onBack;
  header.appendChild(createBackButton(backTarget));
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

  const cycle = goalService.getActiveCycle(state.classroom);
  if (!cycle) {
    content.appendChild(createEmptyStateElement({ message: 'No active Goal Cycle yet.' }));
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    return;
  }

  if (mode === 'studentDetail') {
    content.appendChild(renderStudentDetail(state.classroom, cycle, state.selectedStudentId, state.allGoals));
  } else if (mode === 'reviewGoal') {
    content.appendChild(renderReviewGoalStep(state.classroom, cycle, state.reviewingGoal, handlers));
  } else {
    content.appendChild(renderPendingApprovalSection(state.classroom, state.pendingGoals, handlers));
    content.appendChild(renderMissingSubmissionsSection(state.classroom, cycle, state.allGoals));
    content.appendChild(renderCategoryMatrix(state.classroom, cycle, state.allGoals, handlers));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

/** Moved verbatim from GoalManagementView.js's own former renderHomeStep() — same data, same "Review" action, only the screen it lives on changed. */
function renderPendingApprovalSection(classroom, pendingGoals, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const pendingHeading = document.createElement('h3');
  pendingHeading.className = 'settings-team-block__heading';
  pendingHeading.textContent = 'Goals Awaiting Approval';
  section.appendChild(pendingHeading);

  if (pendingGoals.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'Nothing waiting for review right now.';
    section.appendChild(empty);
    return section;
  }

  const cycle = goalService.getActiveCycle(classroom);
  const pendingList = document.createElement('ul');
  pendingList.className = 'settings-editable-list';
  pendingGoals.forEach((goal) => {
    const student = goalService.getClassroomStudents(classroom).find((s) => s.id === goal.studentId);
    const category = cycle.categories.find((c) => c.id === goal.categoryId);
    const item = document.createElement('li');
    item.className = 'settings-editable-list__item';
    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = `${student ? student.name : 'Unknown student'} \u2014 ${category ? category.name : 'Unknown category'}`;
    item.appendChild(label);
    const reviewButton = document.createElement('button');
    reviewButton.type = 'button';
    reviewButton.className = 'btn btn--secondary';
    reviewButton.textContent = 'Review';
    reviewButton.addEventListener('click', () => handlers.onReviewGoal(goal.id));
    item.appendChild(reviewButton);
    pendingList.appendChild(item);
  });
  section.appendChild(pendingList);
  return section;
}

/** Moved verbatim from GoalManagementView.js's own former renderHomeStep() — same computation, only the screen it lives on changed. */
function renderMissingSubmissionsSection(classroom, cycle, allGoals) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const categoryCount = goalService.listCategories(cycle).length;
  const missing = goalService.getClassroomStudents(classroom).filter(
    (student) => allGoals.filter((g) => g.studentId === student.id).length < categoryCount
  );
  if (missing.length === 0) return section;

  const missingHeading = document.createElement('h3');
  missingHeading.className = 'settings-team-block__heading';
  missingHeading.textContent = 'Haven\u2019t Submitted All Goals Yet';
  section.appendChild(missingHeading);
  const missingNote = document.createElement('p');
  missingNote.className = 'settings-section__meta';
  missingNote.textContent = missing.map((s) => s.name).join(', ');
  section.appendChild(missingNote);
  return section;
}

/**
 * The real per-Category matrix — columns = Categories (each with its
 * own header showing how many students completed their goal today),
 * rows = Students, cells = this exact Student/Category's own real
 * status. Reuses ui/views/NotebookCheckpointsView.js's own
 * presentational classes directly (.assessment-gradebook,
 * .notebook-checkpoints__column-header/--cell) for the same visual
 * model, without any of that screen's own column-editing machinery —
 * Categories are managed on GoalManagementView.js's own "Manage
 * Goals" screen instead.
 */
function renderCategoryMatrix(classroom, cycle, allGoals, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = cycle.title;
  section.appendChild(heading);

  const students = goalService.getClassroomStudents(classroom);
  const categories = goalService.listCategories(cycle);

  if (students.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No students in this classroom yet.' }));
    return section;
  }
  if (categories.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No Categories yet \u2014 add one from \u201cManage Goals.\u201d' }));
    return section;
  }

  const scroll = document.createElement('div');
  scroll.className = 'assessment-gradebook__scroll';

  const table = document.createElement('table');
  table.className = 'assessment-gradebook notebook-checkpoints__table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const nameTh = document.createElement('th');
  nameTh.className = 'assessment-gradebook__name-header';
  nameTh.textContent = 'Student';
  headerRow.appendChild(nameTh);

  categories.forEach((category) => {
    const th = document.createElement('th');
    th.className = 'notebook-checkpoints__column-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'notebook-checkpoints__column-title-row';
    const titleEl = document.createElement('span');
    titleEl.className = 'notebook-checkpoints__column-title';
    titleEl.textContent = category.name;
    titleRow.appendChild(titleEl);
    th.appendChild(titleRow);

    const completedTodayCount = students.filter((student) => {
      const goal = allGoals.find((g) => g.studentId === student.id && g.categoryId === category.id);
      return goal && goal.status !== 'pending_approval' && goalStatisticsService.isCompletedToday(cycle, goal.id);
    }).length;

    const statBox = document.createElement('div');
    statBox.className = 'notebook-checkpoints__column-stat-box';
    const statNumber = document.createElement('span');
    statNumber.className = 'notebook-checkpoints__column-stat-number';
    statNumber.textContent = `${completedTodayCount}/${students.length}`;
    const statLabel = document.createElement('span');
    statLabel.className = 'notebook-checkpoints__column-stat-label';
    statLabel.textContent = 'Today';
    statBox.append(statNumber, statLabel);
    th.appendChild(statBox);

    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'btn btn--text';
    nameButton.textContent = student.name;
    nameButton.addEventListener('click', () => handlers.onSelectStudent(student.id));
    nameCell.appendChild(nameButton);
    row.appendChild(nameCell);

    categories.forEach((category) => {
      const cell = document.createElement('td');
      const goal = allGoals.find((g) => g.studentId === student.id && g.categoryId === category.id);

      if (!goal) {
        cell.className = 'notebook-checkpoints__cell notebook-checkpoints__cell--gray';
        cell.textContent = 'No goal set';
      } else if (goal.status === 'pending_approval') {
        cell.className = 'notebook-checkpoints__cell notebook-checkpoints__cell--amber';
        const reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'notebook-checkpoints__cell-button';
        reviewButton.textContent = 'Awaiting approval';
        reviewButton.addEventListener('click', () => handlers.onReviewGoal(goal.id));
        cell.appendChild(reviewButton);
      } else {
        const completedToday = goalStatisticsService.isCompletedToday(cycle, goal.id);
        cell.className = `notebook-checkpoints__cell notebook-checkpoints__cell--${completedToday ? 'green' : 'red'}`;
        cell.textContent = completedToday ? '\u2713' : '\u2716';
      }

      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  scroll.appendChild(table);
  section.appendChild(scroll);
  return section;
}

function renderStudentDetail(classroom, cycle, studentId, allGoals) {
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
    const goal = allGoals.find((g) => g.studentId === studentId && g.categoryId === category.id);
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

/** Moved verbatim from GoalManagementView.js's own former renderReviewGoalStep() — unchanged internally. */
function renderReviewGoalStep(classroom, cycle, goal, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  if (!goal) {
    section.appendChild(createEmptyStateElement({ message: 'This goal is no longer available.' }));
    return section;
  }

  const student = goalService.getClassroomStudents(classroom).find((s) => s.id === goal.studentId);
  const category = cycle?.categories.find((c) => c.id === goal.categoryId);

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = `${student ? student.name : 'Unknown student'} \u2014 ${category ? category.name : ''}`;
  section.appendChild(heading);

  const goalText = document.createElement('p');
  goalText.className = 'settings-section__meta';
  goalText.style.fontSize = '1.1rem';
  goalText.style.color = 'var(--color-ink)';
  goalText.textContent = `\u201C${goal.text}\u201D`;
  section.appendChild(goalText);

  const approveButton = document.createElement('button');
  approveButton.type = 'button';
  approveButton.className = 'btn btn--primary';
  approveButton.textContent = 'Approve';
  approveButton.addEventListener('click', () => handlers.onApproveGoal(goal.id));
  section.appendChild(approveButton);

  return section;
}

