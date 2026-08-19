/**
 * ui/components/ProgrammeGoalsControls.js
 *
 * The interactive Daily Goals section — extracted this round from
 * ui/views/ProgrammeSessionView.js because a second screen
 * (ui/views/ProgrammeGoalsReviewView.js, the new "View / Review
 * Goals" drill-in destination) now needs it. `buildGoalPicker()` is
 * additionally reused directly by the Student Portal's own
 * ui/student-portal/views/StudentLearningCircleView.js — it was
 * already generic (suggested-goal buttons + a "write my own" field,
 * no teacher-specific wording anywhere in it), so a student setting
 * their own goal calls the exact same function a teacher's "Edit
 * Goal" action does, not a second, parallel implementation.
 *
 * Nothing about any interaction changed in this extraction — this is
 * the same collapsed-by-default "💡 Suggestions" disclosure and
 * "Edit Goal" toggle established in the prior UX-correction round.
 */

import * as programmeSessionService from '../../services/programmeSessionService.js';
import { createStudentNameElement } from './StudentNameElement.js';

const OUTCOME_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'partially_completed', label: 'Partially completed' },
  { value: 'try_again', label: 'Try again' },
];

export function buildGoalsSection(programme, session, roster, editable, persistPatch, redraw) {
  const section = document.createElement('section');
  section.className = 'profile-section programme-session-view__section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Daily Goals';
  section.appendChild(heading);

  const categories = programme.configuration.goalFramework.categories;

  roster.forEach(({ student, team }) => {
    const studentBlock = document.createElement('div');
    studentBlock.className = 'programme-session-view__goal-student-block';

    studentBlock.appendChild(createStudentNameElement({ student, team, leadingMarker: 'avatar', size: 32 }));

    const categoryList = document.createElement('div');
    categoryList.className = 'programme-session-view__goal-category-list';

    // Only categories with an existing goal are shown for a
    // read-only (past) session, matching "historical session data
    // preserves the actual goal text" — no empty category prompts
    // are ever shown for history that never recorded one.
    const relevantCategories = editable ? categories : categories.filter((c) => session.goals[student.id]?.[c.id]);

    relevantCategories.forEach((category) => {
      categoryList.appendChild(buildGoalCategoryRow(programme, session, student, category, editable, persistPatch, redraw));
    });

    if (relevantCategories.length === 0) {
      const noneNote = document.createElement('p');
      noneNote.className = 'profile-section__meta';
      noneNote.textContent = 'No goal recorded.';
      categoryList.appendChild(noneNote);
    }

    studentBlock.appendChild(categoryList);
    section.appendChild(studentBlock);
  });

  return section;
}

function buildGoalCategoryRow(programme, session, student, category, editable, persistPatch, redraw) {
  const row = document.createElement('div');
  row.className = 'programme-session-view__goal-category-row';

  const categoryLabel = document.createElement('span');
  categoryLabel.className = 'programme-session-view__goal-category-label';
  categoryLabel.textContent = category.name;
  row.appendChild(categoryLabel);

  const existingGoal = session.goals[student.id]?.[category.id] || null;

  if (existingGoal) {
    row.appendChild(buildExistingGoalDisplay(programme, session, student, category, existingGoal, editable, persistPatch, redraw));
  } else if (editable) {
    row.appendChild(buildGoalDisclosure(programme, session, student, category, persistPatch, redraw));
  } else {
    const noneText = document.createElement('span');
    noneText.className = 'profile-section__meta';
    noneText.textContent = 'Not set';
    row.appendChild(noneText);
  }

  return row;
}

/**
 * Collapsed by default — the daily goal is the STUDENT's own choice,
 * not a teacher assignment, so the goal library must never be the
 * first thing shown for a category with no goal yet. Shows only a
 * small "💡 Suggestions" toggle; tapping it reveals the existing
 * picker (buildGoalPicker() below) inline, in place.
 */
export function buildGoalDisclosure(programme, session, student, category, persistPatch, redraw) {
  const wrapper = document.createElement('div');
  wrapper.className = 'programme-session-view__goal-disclosure';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'btn btn--text programme-session-view__goal-suggestions-toggle';
  toggleButton.textContent = '\ud83d\udca1 Suggestions';

  const pickerContainer = document.createElement('div');
  pickerContainer.hidden = true;
  pickerContainer.appendChild(buildGoalPicker(programme, session, student, category, persistPatch, redraw));

  toggleButton.addEventListener('click', () => {
    pickerContainer.hidden = !pickerContainer.hidden;
    toggleButton.textContent = pickerContainer.hidden ? '\ud83d\udca1 Suggestions' : 'Hide Suggestions';
  });

  wrapper.append(toggleButton, pickerContainer);
  return wrapper;
}

/**
 * The suggested-goal / write-my-own picker itself — deliberately
 * generic (no teacher-specific wording), which is exactly why the
 * Student Portal's own goal-setting UI can call this directly rather
 * than needing a second, parallel implementation. Never shown
 * directly; always reached through an explicit disclosure
 * (buildGoalDisclosure() for a brand-new goal, "Edit Goal" inside
 * buildExistingGoalDisplay() for replacing one that already exists,
 * or the Student Portal's own equivalent "💡 Get Suggestions" toggle).
 */
export function buildGoalPicker(programme, session, student, category, persistPatch, redraw) {
  const picker = document.createElement('div');
  picker.className = 'programme-session-view__goal-picker';

  (category.suggestedGoals || []).forEach((suggestedText) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'btn btn--ghost programme-session-view__goal-option';
    optionButton.textContent = suggestedText;
    optionButton.addEventListener('click', async () => {
      programmeSessionService.recordGoal(programme, session, {
        studentId: student.id,
        categoryId: category.id,
        text: suggestedText,
        source: 'suggested',
      });
      await persistPatch(() => programmeSessionService.buildGoalPatch(session, student.id, category.id));
      redraw();
    });
    picker.appendChild(optionButton);
  });

  const customRow = document.createElement('div');
  customRow.className = 'programme-session-view__goal-custom-row';
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'modal__input programme-session-view__goal-custom-input';
  customInput.placeholder = 'Write my own goal\u2026';
  const customButton = document.createElement('button');
  customButton.type = 'button';
  customButton.className = 'btn btn--secondary';
  customButton.textContent = 'Set Goal';
  customButton.addEventListener('click', async () => {
    const text = customInput.value.trim();
    if (!text) return;
    programmeSessionService.recordGoal(programme, session, {
      studentId: student.id,
      categoryId: category.id,
      text,
      source: 'custom',
    });
    await persistPatch(() => programmeSessionService.buildGoalPatch(session, student.id, category.id));
    redraw();
  });
  customRow.append(customInput, customButton);
  picker.appendChild(customRow);

  return picker;
}

/**
 * An already-recorded goal — its own permanent text/source, plus
 * outcome + reflection, which remain editable even in an otherwise-
 * editable session's own goal (outcome is recorded after the fact).
 * Also carries the "Edit Goal" action (editable sessions only),
 * revealing the same picker used for a brand-new goal so a teacher
 * can pick a different suggestion or write a new custom goal;
 * recordGoal() already replaces rather than duplicates a goal for the
 * same student/category (an existing, passing unit test covers this).
 */
export function buildExistingGoalDisplay(programme, session, student, category, goal, editable, persistPatch, redraw) {
  const container = document.createElement('div');

  const display = document.createElement('div');
  display.className = 'programme-session-view__goal-display';

  const textEl = document.createElement('p');
  textEl.className = 'programme-session-view__goal-text';
  textEl.textContent = goal.text;
  const sourceTag = document.createElement('span');
  sourceTag.className = 'programme-session-view__goal-source';
  sourceTag.textContent = goal.source === 'suggested' ? '(suggested)' : '(own goal)';
  textEl.appendChild(sourceTag);
  display.appendChild(textEl);

  const outcomeGroup = document.createElement('div');
  outcomeGroup.className = 'programme-session-view__goal-outcome-group';
  OUTCOME_OPTIONS.forEach(({ value, label }) => {
    const outcomeButton = document.createElement('button');
    outcomeButton.type = 'button';
    outcomeButton.className = `btn btn--secondary programme-session-view__goal-outcome-button${
      goal.outcome === value ? ' programme-session-view__goal-outcome-button--active' : ''
    }`;
    outcomeButton.textContent = label;
    outcomeButton.disabled = !editable;
    outcomeButton.addEventListener('click', async () => {
      programmeSessionService.recordGoalOutcome(session, { studentId: student.id, categoryId: category.id, outcome: value });
      await persistPatch(() => programmeSessionService.buildGoalPatch(session, student.id, category.id));
      redraw();
    });
    outcomeGroup.appendChild(outcomeButton);
  });
  display.appendChild(outcomeGroup);

  const reflectionLabel = document.createElement('label');
  reflectionLabel.className = 'programme-session-view__goal-reflection-label';
  reflectionLabel.textContent = 'Reflection';
  const reflectionInput = document.createElement('textarea');
  reflectionInput.className = 'modal__input';
  reflectionInput.rows = 1;
  reflectionInput.value = goal.reflection || '';
  reflectionInput.disabled = !editable;
  reflectionLabel.appendChild(reflectionInput);
  display.appendChild(reflectionLabel);

  if (editable) {
    const saveReflectionButton = document.createElement('button');
    saveReflectionButton.type = 'button';
    saveReflectionButton.className = 'btn btn--text';
    saveReflectionButton.textContent = 'Save Reflection';
    saveReflectionButton.addEventListener('click', async () => {
      programmeSessionService.recordGoalOutcome(session, { studentId: student.id, categoryId: category.id, reflection: reflectionInput.value.trim() });
      await persistPatch(() => programmeSessionService.buildGoalPatch(session, student.id, category.id));
    });
    display.appendChild(saveReflectionButton);
  }

  container.appendChild(display);

  if (editable) {
    const editRow = document.createElement('div');
    editRow.className = 'programme-session-view__goal-edit-row';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn--text';
    editButton.textContent = 'Edit Goal';

    const editPickerContainer = document.createElement('div');
    editPickerContainer.hidden = true;
    editPickerContainer.appendChild(buildGoalPicker(programme, session, student, category, persistPatch, redraw));

    editButton.addEventListener('click', () => {
      editPickerContainer.hidden = !editPickerContainer.hidden;
      editButton.textContent = editPickerContainer.hidden ? 'Edit Goal' : 'Cancel';
    });

    editRow.append(editButton, editPickerContainer);
    container.appendChild(editRow);
  }

  return container;
}
