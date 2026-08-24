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
 * Two modes: 'home' (the active cycle's own summary and
 * "⚙ Manage Goals"/"Open Goal Dashboard" doorways) and 'manage'
 * (Pin/Unpin, Categories, Add Category). Reviewing/approving pending
 * goals and seeing who hasn't submitted both moved to
 * GoalDashboardView.js — that's where a teacher already looks at
 * per-student status, so review/approval belongs there too, not
 * split across two screens.
 */

import * as goalService from '../../services/goalService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { renderGoalDashboardView } from './GoalDashboardView.js';

export function renderGoalManagementView(container, { classroom, onBack, initialMode = 'home' }) {
  // initialMode lets a caller that already knows exactly which step
  // it wants (see ui/views/GoalDashboardView.js's own "Manage Goals"
  // button, which opens straight into 'manage') skip 'home' entirely
  // -- onCloseManageGoals below returns to onBack directly in that
  // case, rather than falling back to a 'home' screen the caller
  // never showed in the first place.
  let mode = initialMode;

  function rerender() {
    render(container, mode, { classroom }, handlers);
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
    onOpenManageGoals: () => {
      mode = 'manage';
      rerender();
    },
    onCloseManageGoals: () => {
      if (initialMode === 'manage') {
        onBack();
        return;
      }
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
  header.appendChild(createBackButton(mode === 'home' ? handlers.onBack : handlers.onCloseManageGoals));
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

  if (mode === 'manage') {
    content.appendChild(renderManageGoalsStep(state.classroom, handlers));
  } else {
    content.appendChild(renderHomeStep(state.classroom, handlers));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderHomeStep(classroom, handlers) {
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
