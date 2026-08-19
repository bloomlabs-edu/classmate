/**
 * ui/components/ManageLearningProgrammeMembersModal.js
 *
 * Add/remove students from an already-created Learning Programme.
 * Reuses ui/components/StudentMultiSelect.js exactly as
 * ui/components/CreateLearningProgrammeModal.js does, pre-checked
 * with the programme's own CURRENT active members
 * (learningProgrammeService.getActiveMembers()) — never its full
 * historical membership list, since a previously-departed student
 * should not appear pre-selected here.
 *
 * CRITICAL: this modal itself never deletes anything. It only ever
 * reports the final desired set of active studentIds back through
 * `onSave()`; the caller (ui/views/LearningProgrammeSettingsView.js)
 * is the one that calls learningProgrammeService.addMembership()/
 * markMembershipLeft() to reconcile the difference — each of which
 * (see services/learningProgrammeService.js's own header comments)
 * preserves every historical membership record, only ever adding a
 * new one or marking an existing one `left`, never deleting a row.
 * This modal has no Firestore access and no classroom mutation of
 * its own at all.
 */

import { createStudentMultiSelectElement } from './StudentMultiSelect.js';

/**
 * `classroom` — used only to build the full roster to select from.
 * `currentActiveStudentIds` — the programme's own current active
 * members' studentIds, used only to pre-check their rows.
 * `onSave(selectedStudentIds: string[])` — called once, with the
 * final desired set of active student ids; never called with a
 * partial diff, so the caller can compute additions/removals itself
 * by comparing against `currentActiveStudentIds`.
 */
export function openManageLearningProgrammeMembersModal({ classroom, currentActiveStudentIds, onSave }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Manage Members');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Manage Members';

  const description = document.createElement('p');
  description.className = 'modal__description';
  description.textContent = "Removing a student here doesn't erase their past sessions, goals, attendance, or observations — those remain exactly as they were.";

  const allStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));
  let selectedIds = new Set(currentActiveStudentIds);
  const studentSelect = createStudentMultiSelectElement({
    students: allStudents,
    initialSelectedIds: currentActiveStudentIds,
    onChange: (newSelection) => {
      selectedIds = newSelection;
    },
  });

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save Members';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';

  function close() {
    overlay.remove();
  }

  saveButton.addEventListener('click', () => {
    onSave(Array.from(selectedIds));
    close();
  });

  cancelButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  actions.append(saveButton, cancelButton);
  modal.append(heading, description, studentSelect, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
