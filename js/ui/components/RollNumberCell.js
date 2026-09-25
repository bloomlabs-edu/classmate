/**
 * ui/components/RollNumberCell.js
 *
 * A single, reusable inline-editable Roll Number cell — shared by
 * ui/views/AssessmentManagementView.js's own Gradebook table and
 * ui/views/ScorecardView.js's own Scorecard table, the two surfaces
 * that display a student roster alongside marks. Deliberately its own
 * small component rather than duplicated inline markup in each view:
 * both tables edit the exact same models/Student.js's own
 * `rollNumber` field via the exact same
 * services/studentService.js's own validateRollNumberInput()/
 * setStudentRollNumber(), so the interaction (click to edit, Enter
 * saves, Escape cancels, blur saves) and validation behavior can never
 * drift apart between the two screens.
 *
 * Click-to-edit, not an always-visible input — the default state is
 * plain text (or "—" when unset) with a quiet pencil affordance that
 * only appears on hover, matching this feature's own explicit "the
 * table should remain clean" / "do not introduce a visually heavy
 * input by default" requirement. Only THIS cell is ever editable;
 * nothing here touches the rest of the row (marks, the student-name
 * link, etc.).
 */

import { createIcon } from './Icon.js';

/**
 * `student` — the Student record this cell displays/edits.
 * `onSave(rawValue)` — called with the raw typed string; must return
 *   `{ valid, value, error }` (the exact shape
 *   studentService.validateRollNumberInput() already returns) and, if
 *   valid, must have already applied+persisted the change itself
 *   (setStudentRollNumber() + workspaceService.save()) before
 *   returning — this component only renders the result, it never
 *   talks to the classroom/workspace directly.
 */
export function createRollNumberCell({ student, onSave }) {
  const cell = document.createElement('td');
  cell.className = 'roll-number-cell';

  function renderDisplay() {
    cell.innerHTML = '';
    const displayButton = document.createElement('button');
    displayButton.type = 'button';
    displayButton.className = 'roll-number-cell__display';
    displayButton.setAttribute('aria-label', `Edit ${student.name}'s roll number`);

    const value = document.createElement('span');
    value.className = 'roll-number-cell__value';
    value.textContent = student.rollNumber || '—';
    displayButton.appendChild(value);

    const editIcon = createIcon('pencil', { size: 12, className: 'roll-number-cell__edit-icon' });
    displayButton.appendChild(editIcon);

    displayButton.addEventListener('click', (event) => {
      event.stopPropagation();
      renderInput();
    });
    cell.appendChild(displayButton);
  }

  function renderInput() {
    cell.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.className = 'roll-number-cell__input';
    input.value = student.rollNumber || '';
    input.setAttribute('aria-label', `${student.name}'s roll number`);
    cell.appendChild(input);

    let settled = false; // guards against both keydown-Enter and the blur it triggers both firing a save

    function commit() {
      if (settled) return;
      settled = true;
      const result = onSave(input.value);
      if (!result.valid) {
        settled = false;
        showError(result.error);
        return;
      }
      renderDisplay();
    }

    function cancel() {
      if (settled) return;
      settled = true;
      renderDisplay();
    }

    function showError(message) {
      const existing = cell.querySelector('.roll-number-cell__error');
      if (existing) existing.remove();
      const error = document.createElement('p');
      error.className = 'roll-number-cell__error';
      error.textContent = message;
      cell.appendChild(error);
      input.focus();
    }

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', () => commit());
    input.addEventListener('click', (event) => event.stopPropagation());

    input.focus();
    input.select();
  }

  renderDisplay();
  return cell;
}
