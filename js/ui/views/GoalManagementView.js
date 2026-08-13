/**
 * ui/views/GoalManagementView.js
 *
 * Goals — Phase 1, built as a fully independent, working subsystem
 * (see services/goalService.js's own header comment for the full
 * architecture context). Teacher-facing: create the active Goal
 * Cycle, manage its categories, review and approve pending goals.
 * Reached as a 5th Dashboard module card (see
 * ui/views/DashboardView.js's DASHBOARD_MODULES), the same
 * container-swap pattern Assessments/Learning/Classroom Management
 * already use — never URL routing.
 *
 * Two modes: 'home' (the active cycle's own summary, category list,
 * and pending-approval queue — or a create-cycle form if none is
 * active yet) and 'reviewGoal' (approve one specific pending goal).
 * The Goal Dashboard (per-student today/streak/completion table) is
 * its own separate view (see GoalDashboardView.js), reached from here.
 */

import * as goalService from '../../services/goalService.js';
import * as studentGoalsService from '../../services/studentGoalsService.js';
import * as goalStatisticsService from '../../services/goalStatisticsService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { renderGoalDashboardView } from './GoalDashboardView.js';

export function renderGoalManagementView(container, { classroom, onBack }) {
  let mode = 'home';
  let reviewingGoalId = null;
  let pendingGoals = [];
  let allGoals = [];
  let reviewingGoal = null;

  async function rerender() {
    const cycle = goalService.getActiveCycle(classroom);
    if (cycle && mode === 'home') {
      pendingGoals = await studentGoalsService.getPendingApprovalGoalsForClassroom(classroom.id, cycle.id);
      allGoals = await studentGoalsService.getAllGoalsForClassroom(classroom.id, cycle.id);
    }
    if (cycle && mode === 'reviewGoal') {
      const cycleGoals = await studentGoalsService.getPendingApprovalGoalsForClassroom(classroom.id, cycle.id);
      reviewingGoal = cycleGoals.find((g) => g.id === reviewingGoalId) ?? null;
    }
    render(container, mode, { classroom, pendingGoals, allGoals, reviewingGoal }, handlers);
  }

  const handlers = {
    onBack,
    onCreateCycle: ({ title, startDate, endDate }) => {
      goalService.createNewGoalCycle(classroom, { title, startDate, endDate });
      workspaceService.save(classroom);
      rerender();
    },
    onAddCategory: (cycle, name) => {
      goalService.addCategory(cycle, name);
      workspaceService.save(classroom);
      rerender();
    },
    onTogglePinCycle: (cycle) => {
      // Pinning only changes visibility on the Dashboard's Open Work
      // section (see services/workTypes/GoalCycleWorkType.js) —
      // never cycle.status or anything else. Not assignment.
      cycle.pinnedToDashboard = !cycle.pinnedToDashboard;
      workspaceService.save(classroom);
      rerender();
    },
    onRemoveCategory: (cycle, categoryId) => {
      const confirmed = window.confirm('Remove this category? Any goals and completion history for it will be removed too. This cannot be undone.');
      if (!confirmed) return;
      goalService.removeCategory(cycle, categoryId);
      workspaceService.save(classroom);
      rerender();
    },
    onReviewGoal: (goalId) => {
      reviewingGoalId = goalId;
      mode = 'reviewGoal';
      rerender();
    },
    onApproveGoal: async (goalId) => {
      await studentGoalsService.approveGoal(classroom.id, goalId);
      mode = 'home';
      reviewingGoalId = null;
      rerender();
    },
    onCancelReview: () => {
      mode = 'home';
      reviewingGoalId = null;
      rerender();
    },
    onOpenManageGoals: () => {
      mode = 'manage';
      rerender();
    },
    onCloseManageGoals: () => {
      mode = 'home';
      rerender();
    },
    onOpenDashboard: () => {
      renderGoalDashboardView(container, { classroom, onBack: () => renderGoalManagementView(container, { classroom, onBack }) });
    },
  };

  rerender();
}

function render(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management'; // reuses the same page-level layout every other management view already uses

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(mode === 'home' ? handlers.onBack : mode === 'manage' ? handlers.onCloseManageGoals : handlers.onCancelReview));
  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Goals';
  titleBlock.appendChild(title);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  if (mode === 'reviewGoal') {
    content.appendChild(renderReviewGoalStep(state.classroom, state.reviewingGoal, handlers));
  } else if (mode === 'manage') {
    content.appendChild(renderManageGoalsStep(state.classroom, handlers));
  } else {
    content.appendChild(renderHomeStep(state.classroom, state.pendingGoals, state.allGoals, handlers));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderHomeStep(classroom, pendingGoals, allGoals, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const cycle = goalService.getActiveCycle(classroom);

  if (!cycle) {
    section.appendChild(createEmptyStateElement({ message: 'No active Goal Cycle yet — create one to get started.' }));
    section.appendChild(createCycleForm(handlers));
    return section;
  }

  const cycleHeading = document.createElement('p');
  cycleHeading.className = 'learning-management__step-heading';
  cycleHeading.textContent = cycle.title;
  section.appendChild(cycleHeading);

  const cycleMeta = document.createElement('p');
  cycleMeta.className = 'settings-section__meta';
  cycleMeta.textContent = `${cycle.startDate} \u2192 ${cycle.endDate}`;
  section.appendChild(cycleMeta);

  const dashboardButton = document.createElement('button');
  dashboardButton.type = 'button';
  dashboardButton.className = 'btn btn--primary';
  dashboardButton.textContent = 'Open Goal Dashboard';
  dashboardButton.addEventListener('click', handlers.onOpenDashboard);
  section.appendChild(dashboardButton);

  // Deliberately styled and worded as a doorway to a separate screen,
  // not an action this screen performs directly — same convention
  // ui/views/NotebookTrackerView.js's own "⚙ Configure Notebook
  // Types" link already established. Pin/Unpin, Categories, and Add
  // Category all moved to renderManageGoalsStep() below — this
  // primary screen now leads with the teacher's actual daily task
  // (reviewing pending goals), not configuration.
  const manageLink = document.createElement('button');
  manageLink.type = 'button';
  manageLink.className = 'notebook-tracker__configure-link';
  manageLink.textContent = '\u2699 Manage Goals';
  manageLink.addEventListener('click', handlers.onOpenManageGoals);
  section.appendChild(manageLink);

  // Pending approvals
  const pendingHeading = document.createElement('h3');
  pendingHeading.className = 'settings-team-block__heading';
  pendingHeading.textContent = 'Goals Awaiting Approval';
  section.appendChild(pendingHeading);

  const pending = pendingGoals;
  if (pending.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'Nothing waiting for review right now.';
    section.appendChild(empty);
  } else {
    const pendingList = document.createElement('ul');
    pendingList.className = 'settings-editable-list';
    pending.forEach((goal) => {
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
  }

  // Students who haven't submitted at all — computed against the new
  // studentGoals collection's own data (allGoals, any status), not
  // goalService.js's own getStudentsWithoutAllGoals(), which still
  // reads the old cycle.goals[] shape that nothing writes to anymore.
  const categoryCount = goalService.listCategories(cycle).length;
  const missing = goalService.getClassroomStudents(classroom).filter(
    (student) => allGoals.filter((g) => g.studentId === student.id).length < categoryCount
  );
  if (missing.length > 0) {
    const missingHeading = document.createElement('h3');
    missingHeading.className = 'settings-team-block__heading';
    missingHeading.textContent = 'Haven\u2019t Submitted All Goals Yet';
    section.appendChild(missingHeading);
    const missingNote = document.createElement('p');
    missingNote.className = 'settings-section__meta';
    missingNote.textContent = missing.map((s) => s.name).join(', ');
    section.appendChild(missingNote);
  }

  return section;
}

/**
 * Configuration/management actions — Pin/Unpin, Categories, Add
 * Category — moved here from renderHomeStep() per explicit product
 * decision: the primary Goals screen should lead with the teacher's
 * actual daily task (reviewing pending goals), not setup/config
 * actions a teacher touches rarely. Same handlers, same behavior as
 * before; only the screen they live on changed.
 */
function renderManageGoalsStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const cycle = goalService.getActiveCycle(classroom);
  if (!cycle) {
    section.appendChild(createEmptyStateElement({ message: 'No active Goal Cycle to manage.' }));
    return section;
  }

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = `Manage \u201c${cycle.title}\u201d`;
  section.appendChild(heading);

  const pinButton = document.createElement('button');
  pinButton.type = 'button';
  pinButton.className = 'btn btn--text';
  pinButton.textContent = cycle.pinnedToDashboard ? 'Unpin from Dashboard' : '\ud83d\udccc Pin to Dashboard';
  pinButton.addEventListener('click', () => handlers.onTogglePinCycle(cycle));
  section.appendChild(pinButton);

  const categoriesHeading = document.createElement('h3');
  categoriesHeading.className = 'settings-team-block__heading';
  categoriesHeading.textContent = 'Categories';
  section.appendChild(categoriesHeading);

  const categoriesList = document.createElement('ul');
  categoriesList.className = 'settings-editable-list';
  goalService.listCategories(cycle).forEach((category) => {
    const item = document.createElement('li');
    item.className = 'settings-editable-list__item';
    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = category.name;
    item.appendChild(label);
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text';
    removeButton.style.color = 'var(--color-danger)';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => handlers.onRemoveCategory(cycle, category.id));
    item.appendChild(removeButton);
    categoriesList.appendChild(item);
  });
  section.appendChild(categoriesList);

  section.appendChild(
    createAddCategoryRow((name) => handlers.onAddCategory(cycle, name))
  );

  return section;
}

function renderReviewGoalStep(classroom, goal, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';
  const cycle = goalService.getActiveCycle(classroom);

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

function createCycleForm(handlers) {
  const form = document.createElement('div');
  form.className = 'settings-section';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'e.g. August English Goals';
  titleInput.className = 'settings-add-row__input';

  const startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.className = 'settings-add-row__input';

  const endInput = document.createElement('input');
  endInput.type = 'date';
  endInput.className = 'settings-add-row__input';

  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary';
  submitButton.textContent = 'Create Goal Cycle';
  submitButton.addEventListener('click', () => {
    if (!titleInput.value.trim() || !startInput.value || !endInput.value) return;
    handlers.onCreateCycle({ title: titleInput.value.trim(), startDate: startInput.value, endDate: endInput.value });
  });

  form.append(titleInput, startInput, endInput, submitButton);
  return form;
}

function createAddCategoryRow(onAdd) {
  const row = document.createElement('div');
  row.className = 'settings-add-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'settings-add-row__input';
  input.placeholder = 'New category name';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--secondary';
  button.textContent = '+ Add Category';

  function submit() {
    const name = input.value.trim();
    if (!name) return;
    onAdd(name);
    input.value = '';
    input.focus();
  }

  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  row.append(input, button);
  return row;
}
