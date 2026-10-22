/**
 * ui/components/AddExistingStudentsModal.js
 *
 * "Add an EXISTING student to this group" — deliberately separate from
 * "+ Add Student" (ui/views/ClassroomManagementView.js's own
 * openNameEntryModal flow, which always creates a brand-new student).
 * An existing student should never be re-typed by name: every student
 * in this app already lives inside exactly one team's `students` array
 * (see models/Team.js, services/studentService.js's own header
 * comment), so "add an existing student to Group B" is really "move
 * them here from wherever they currently are" — this modal's only job
 * is picking WHICH students, via search-as-you-type over a real
 * multi-select, never typing a name that might collide with (or
 * duplicate) someone who already exists.
 *
 * Reuses ui/components/StudentMultiSelect.js exactly as
 * ui/components/ManageLearningProgrammeMembersModal.js already does —
 * the one multi-select component this app has, rather than inventing
 * a second one. StudentMultiSelect itself has no search box, so this
 * modal layers a plain search input on top and rebuilds the
 * multi-select with the filtered subset on every keystroke, preserving
 * the running selection across filters itself (selections made while
 * a filter was active must survive clearing or changing that filter).
 *
 * Students already in the target team are excluded from the list
 * entirely (never shown as a toggle-off checkbox) — they're already
 * members, there's nothing to "add." This mirrors how
 * ui/views/ClassroomManagementView.js's own openChooseGroupModal
 * already excludes a team from being its own destination.
 *
 * This modal never touches the classroom itself — no studentService
 * or workspaceService import, no Firestore access, same contract as
 * ManageLearningProgrammeMembersModal.js's own header comment ("this
 * modal has no Firestore access and no classroom mutation of its
 * own"). It only ever reports the final chosen set of studentIds back
 * through `onConfirm`, once; the caller decides how to apply it (here,
 * a loop of studentService.moveStudentToTeam() calls — see
 * ClassroomManagementView.js).
 */

import { createStudentMultiSelectElement } from './StudentMultiSelect.js';

/**
 * `classroom` — used only to build the pickable roster.
 * `targetTeam` — the group students are being added TO; its own
 * current members are excluded from the picker.
 * `onConfirm(selectedStudentIds: string[])` — called once, only when
 * at least one student is selected and the teacher confirms.
 */
export function openAddExistingStudentsModal({ classroom, targetTeam, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide add-existing-students-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `Add Existing Student to ${targetTeam.name}`);

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = `Add Existing Student — ${targetTeam.name}`;
  modal.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'modal__description';
  description.textContent = 'Pick one or more students already in this classroom. They’ll be moved here — their score, badges and history come with them.';
  modal.appendChild(description);

  // Full roster minus whoever is already in the target team — an
  // already-a-member student is excluded outright (see this file's own
  // header comment), not shown as an already-checked row.
  const availableStudents = classroom.teams
    .filter((team) => team.id !== targetTeam.id)
    .flatMap((team) => team.students.map((student) => ({ student, team })));

  const totalStudentsInClassroom = classroom.teams.reduce((sum, team) => sum + team.students.length, 0);

  // The running selection, kept OUTSIDE any single StudentMultiSelect
  // instance so it survives being rebuilt on every search keystroke.
  let selectedIds = new Set();

  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'btn btn--primary';

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  cancelButton.addEventListener('click', close);

  function updateConfirmButton() {
    const count = selectedIds.size;
    confirmButton.textContent = count > 0 ? `Add ${count} Student${count === 1 ? '' : 's'}` : 'Add Students';
    confirmButton.disabled = count === 0;
  }

  confirmButton.addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    const chosen = Array.from(selectedIds);
    close();
    onConfirm(chosen);
  });

  if (availableStudents.length === 0) {
    const note = document.createElement('p');
    note.className = 'add-existing-students-modal__note';
    note.textContent =
      totalStudentsInClassroom === 0
        ? 'There are no students in this classroom yet.'
        : `Every student in this classroom is already in ${targetTeam.name}.`;
    modal.appendChild(note);
  } else {
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'modal__input add-existing-students-modal__search';
    searchInput.placeholder = 'Search students by name…';
    modal.appendChild(searchInput);

    const listContainer = document.createElement('div');
    listContainer.className = 'add-existing-students-modal__list';
    modal.appendChild(listContainer);

    let currentListEl = null;

    function renderList() {
      const query = searchInput.value.trim().toLowerCase();
      const filtered = query
        ? availableStudents.filter(({ student }) => student.name.toLowerCase().includes(query))
        : availableStudents;

      // Only the ids actually visible in THIS filtered render are ever
      // handed to StudentMultiSelect as its own initial selection —
      // passing the full cross-filter `selectedIds` here would let its
      // own "N of M selected" toolbar count ids it has no row for.
      const initialForFiltered = filtered.map(({ student }) => student.id).filter((id) => selectedIds.has(id));

      if (currentListEl) currentListEl.remove();
      currentListEl = createStudentMultiSelectElement({
        students: filtered,
        initialSelectedIds: initialForFiltered,
        onChange: (newSelectionForFiltered) => {
          // Merge back into the cross-filter set: drop every id that
          // WAS visible in this filtered view, then re-add exactly the
          // ones still checked — ids hidden by the current filter are
          // never touched, so they keep whatever selection they had.
          filtered.forEach(({ student }) => selectedIds.delete(student.id));
          newSelectionForFiltered.forEach((id) => selectedIds.add(id));
          updateConfirmButton();
        },
      });
      listContainer.appendChild(currentListEl);
    }

    searchInput.addEventListener('input', renderList);
    renderList();
  }

  actions.append(cancelButton, confirmButton);
  modal.appendChild(actions);
  updateConfirmButton();

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
