/**
 * ui/components/StudentMultiSelect.js
 *
 * A checkbox list for selecting more than one student from the
 * classroom's own real roster — individually, all at once, or
 * deselecting. Introduced for Learning Programmes' own "which
 * students belong to this programme" flows (create + manage
 * members), which is the first place in this app that needs a
 * genuine multi-select over students; no existing component covers
 * this (confirmed by inspection — every other student picker in this
 * app, e.g. ui/components/StudentNameElement.js's own onSelect, picks
 * exactly one student for navigation, never a set).
 *
 * Deliberately narrow: this component has no idea what the selection
 * is FOR. It takes the full list of `{ student, team }` pairs to show
 * and an initial set of already-selected student ids, and reports the
 * current full selection back through `onChange` every time it
 * changes — the caller (e.g.
 * ui/components/CreateLearningProgrammeModal.js) decides what to do
 * with that set. No Firestore access, no service import, no
 * assumption about a "programme" existing at all.
 *
 * Reuses ui/components/StudentNameElement.js for the identity portion
 * of each row (avatar + name + team) — never a second, competing way
 * to render a student's own identity.
 */

import { createStudentNameElement } from './StudentNameElement.js';

/**
 * `students` — an array of `{ student, team }` pairs, matching the
 * shape every other roster-wide view in this app already builds via
 * `classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })))`
 * (see e.g. ui/views/ActivitiesView.js's own renderActivityRosterView()).
 * `initialSelectedIds` — a Set or array of studentIds to start
 * checked; never mutated by this component, only read once at
 * construction. `onChange(selectedIds: Set<string>)` fires on every
 * checkbox change, individual or via Select All/Deselect All.
 */
export function createStudentMultiSelectElement({ students, initialSelectedIds = [], onChange } = {}) {
  const selectedIds = new Set(initialSelectedIds);

  const wrapper = document.createElement('div');
  wrapper.className = 'student-multi-select';

  const toolbar = document.createElement('div');
  toolbar.className = 'student-multi-select__toolbar';

  const countLabel = document.createElement('span');
  countLabel.className = 'student-multi-select__count';

  const selectAllButton = document.createElement('button');
  selectAllButton.type = 'button';
  selectAllButton.className = 'btn btn--text student-multi-select__select-all';

  toolbar.append(countLabel, selectAllButton);
  wrapper.appendChild(toolbar);

  const list = document.createElement('div');
  list.className = 'student-multi-select__list';
  wrapper.appendChild(list);

  if (students.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'student-multi-select__empty';
    empty.textContent = 'There are no students in this classroom yet.';
    wrapper.appendChild(empty);
  }

  function updateToolbar() {
    countLabel.textContent = `${selectedIds.size} of ${students.length} selected`;
    const allSelected = students.length > 0 && selectedIds.size === students.length;
    selectAllButton.textContent = allSelected ? 'Deselect All' : 'Select All';
  }

  function setChecked(studentId, checked, checkboxEl) {
    if (checked) {
      selectedIds.add(studentId);
    } else {
      selectedIds.delete(studentId);
    }
    checkboxEl.checked = checked;
    updateToolbar();
    onChange?.(new Set(selectedIds));
  }

  const checkboxesById = new Map();

  students.forEach(({ student, team }) => {
    const row = document.createElement('label');
    row.className = 'student-multi-select__row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'student-multi-select__checkbox';
    checkbox.checked = selectedIds.has(student.id);
    checkbox.addEventListener('change', () => setChecked(student.id, checkbox.checked, checkbox));
    checkboxesById.set(student.id, checkbox);

    row.appendChild(checkbox);
    row.appendChild(createStudentNameElement({ student, team, leadingMarker: 'avatar', size: 32 }));

    list.appendChild(row);
  });

  selectAllButton.addEventListener('click', () => {
    const shouldSelectAll = selectedIds.size !== students.length;
    students.forEach(({ student }) => {
      const checkbox = checkboxesById.get(student.id);
      if (shouldSelectAll) {
        selectedIds.add(student.id);
      } else {
        selectedIds.delete(student.id);
      }
      if (checkbox) checkbox.checked = shouldSelectAll;
    });
    updateToolbar();
    onChange?.(new Set(selectedIds));
  });

  updateToolbar();

  return wrapper;
}
