/**
 * ui/student-portal/views/StudentGoalTrackerView.js
 *
 * Goals — Phase 1, student-facing. One screen, per category, showing
 * whichever state that category is actually in: no goal yet (a text
 * entry form), pending approval (the student's own text, still
 * editable), or approved (locked text, a one-tap daily "Completed
 * Today" toggle, and live streak/completion stats).
 *
 * All data — reads and writes — goes through
 * services/studentPortalDataService.js's new Goals functions, never
 * goalService.js/goalCompletionService.js directly, matching this
 * app's own established "views own their content, the data service
 * owns all data access" split for every other Student Portal screen.
 * Every number shown here is read fresh, every time this screen opens
 * — there is no cached streak or percentage anywhere in this file.
 */

import {
  getGoalCycleForCurrentStudent,
  submitGoalForCurrentStudent,
  setGoalCompletionForCurrentStudent,
} from '../../../services/studentPortalDataService.js';
import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { getTodayDateKey } from '../../../utils/dateHelpers.js';

export async function renderStudentGoalTrackerView(container, { onBack }) {
  async function rerender() {
    const cycle = await getGoalCycleForCurrentStudent();
    render(container, cycle, {
      onBack,
      onSubmitGoal: async (categoryId, text) => {
        await submitGoalForCurrentStudent(categoryId, text);
        await rerender();
      },
      onToggleCompletion: async (goalId, completed) => {
        await setGoalCompletionForCurrentStudent(goalId, getTodayDateKey(), completed);
        await rerender();
      },
    });
  }

  await rerender();
}

function render(container, cycle, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-goal-tracker';

  const header = document.createElement('div');
  header.className = 'student-goal-tracker__header';
  header.appendChild(createBackButton(handlers.onBack));
  wrapper.appendChild(header);

  if (!cycle) {
    wrapper.appendChild(createEmptyStateElement({ message: 'There\u2019s no active Goal Cycle right now. Check back once your teacher starts one.' }));
    container.appendChild(wrapper);
    return;
  }

  const title = document.createElement('h1');
  title.className = 'student-goal-tracker__title';
  title.textContent = cycle.cycleTitle;
  wrapper.appendChild(title);

  const dates = document.createElement('p');
  dates.className = 'student-goal-tracker__dates';
  dates.textContent = `${cycle.startDate} \u2192 ${cycle.endDate}`;
  wrapper.appendChild(dates);

  if (cycle.categories.length === 0) {
    // A cycle can genuinely exist with zero categories yet — the
    // teacher creates the cycle and adds categories as two separate
    // steps in ui/views/GoalManagementView.js. Without this, the
    // student sees nothing at all below the dates, with no way to
    // know anything is missing.
    wrapper.appendChild(
      createEmptyStateElement({ message: 'Your teacher hasn\u2019t added any categories to this cycle yet. Check back soon.' })
    );
    container.appendChild(wrapper);
    return;
  }

  cycle.categories.forEach((category) => {
    wrapper.appendChild(renderCategoryCard(category, handlers));
  });

  container.appendChild(wrapper);
}

function renderCategoryCard(category, handlers) {
  const card = document.createElement('div');
  card.className = 'student-goal-card';

  const heading = document.createElement('h2');
  heading.className = 'student-goal-card__category';
  heading.textContent = category.categoryName;
  card.appendChild(heading);

  if (!category.goal) {
    card.appendChild(renderGoalEntryForm(category, handlers, ''));
    return card;
  }

  if (category.goal.status === 'pending_approval') {
    const notice = document.createElement('p');
    notice.className = 'student-goal-card__notice';
    notice.textContent = 'Waiting for your teacher to approve this goal. You can still change it until then.';
    card.appendChild(notice);
    card.appendChild(renderGoalEntryForm(category, handlers, category.goal.text));
    return card;
  }

  // Approved — locked text, daily toggle, live stats.
  const goalText = document.createElement('p');
  goalText.className = 'student-goal-card__text';
  goalText.textContent = `\u201C${category.goal.text}\u201D`;
  card.appendChild(goalText);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'student-goal-card__toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = category.goal.completedToday;
  checkbox.addEventListener('change', () => handlers.onToggleCompletion(category.goal.id, checkbox.checked));
  toggleLabel.append(checkbox, ' Completed Today');
  card.appendChild(toggleLabel);

  const stats = document.createElement('div');
  stats.className = 'student-goal-card__stats';
  stats.append(
    createStatChip('Current streak', category.goal.currentStreak > 0 ? `\ud83d\udd25${category.goal.currentStreak}` : '0'),
    createStatChip('Longest streak', String(category.goal.longestStreak)),
    createStatChip('Completion', `${category.goal.overallCompletionPercent}%`)
  );
  card.appendChild(stats);

  return card;
}

function renderGoalEntryForm(category, handlers, currentText) {
  const form = document.createElement('div');
  form.className = 'student-goal-card__entry';

  const input = document.createElement('textarea');
  input.className = 'student-goal-card__input';
  input.placeholder = 'e.g. I will watch a 3-minute English video every day.';
  input.value = currentText;

  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary';
  submitButton.textContent = currentText ? 'Update Goal' : 'Submit Goal';
  submitButton.addEventListener('click', () => {
    if (!input.value.trim()) return;
    handlers.onSubmitGoal(category.categoryId, input.value.trim());
  });

  form.append(input, submitButton);
  return form;
}

function createStatChip(label, value) {
  const chip = document.createElement('div');
  chip.className = 'student-goal-card__stat-chip';
  const labelEl = document.createElement('span');
  labelEl.className = 'student-goal-card__stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'student-goal-card__stat-value';
  valueEl.textContent = value;
  chip.append(labelEl, valueEl);
  return chip;
}
