/**
 * ui/components/NotebookRoster.js
 *
 * The fast-entry roster used by the Register View: every student, each
 * with two independent status dropdowns (Submission, Completion).
 * Previously a row of toggle buttons (one per possible value) — that
 * grows wider and more overwhelming every time a new status option is
 * added; a dropdown's width doesn't change no matter how many options
 * it holds, so this scales cleanly as the vocabulary grows. Extracted
 * from the original Notebook Checking screen so the same rendering can
 * be reused anywhere a roster of inline status controls is needed.
 * Rendering only — the caller supplies onSetSubmission/onSetCompletion
 * and re-renders itself afterwards.
 */

import { SUBMISSION_STATUSES, SUBMISSION_LABELS, COMPLETION_STATUSES, COMPLETION_LABELS } from '../../config/notebookStatuses.js';

export function createNotebookRosterElement({ students, getEntryForStudent, onSetSubmission, onSetCompletion, onSelectStudent }) {
  const list = document.createElement('div');
  list.className = 'notebook-checking-list';

  students.forEach(({ student, team }) => {
    list.appendChild(
      createRosterRow({
        student,
        team,
        entry: getEntryForStudent(student.id),
        onSetSubmission: (value) => onSetSubmission(student.id, value),
        onSetCompletion: (value) => onSetCompletion(student.id, value),
        onSelectStudent: onSelectStudent ? () => onSelectStudent(student.id) : null,
      })
    );
  });

  return list;
}

function createRosterRow({ student, team, entry, onSetSubmission, onSetCompletion, onSelectStudent }) {
  const row = document.createElement('div');
  row.className = 'notebook-checking-row';

  const nameLabel = team ? `${student.name} \u00b7 ${team.name}` : student.name;
  let nameEl;
  if (onSelectStudent) {
    nameEl = document.createElement('button');
    nameEl.type = 'button';
    nameEl.className = 'notebook-checking-row__name student-name-link';
    nameEl.addEventListener('click', onSelectStudent);
  } else {
    nameEl = document.createElement('span');
    nameEl.className = 'notebook-checking-row__name';
  }
  nameEl.textContent = nameLabel;
  row.appendChild(nameEl);

  row.appendChild(
    createStatusSelect({
      label: 'Submission',
      options: SUBMISSION_STATUSES,
      labels: SUBMISSION_LABELS,
      placeholder: 'Not marked',
      currentValue: entry?.submission || null,
      onSelect: onSetSubmission,
    })
  );

  row.appendChild(
    createStatusSelect({
      label: 'Completion',
      options: COMPLETION_STATUSES,
      labels: COMPLETION_LABELS,
      placeholder: 'Not assessed',
      currentValue: entry?.completion || null,
      onSelect: onSetCompletion,
    })
  );

  return row;
}

function createStatusSelect({ label, options, labels, placeholder, currentValue, onSelect }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'notebook-status-select';

  const labelEl = document.createElement('span');
  labelEl.className = 'notebook-status-select__label';
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);

  const select = document.createElement('select');
  select.className = 'notebook-status-select__input';
  select.setAttribute('aria-label', `${label} status`);

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  options.forEach((option) => {
    const optionEl = document.createElement('option');
    optionEl.value = option;
    optionEl.textContent = labels[option];
    if (currentValue === option) optionEl.selected = true;
    select.appendChild(optionEl);
  });

  select.addEventListener('change', (event) => {
    if (event.target.value) onSelect(event.target.value);
  });

  wrapper.appendChild(select);
  return wrapper;
}
