/**
 * ui/components/AddObservationModal.js
 *
 * Opened from the Learning Circle dashboard's own Observations block
 * and from ui/views/ProgrammeObservationsView.js — the "+ Add
 * Observation" action, per this project's own explicit redesign
 * instruction that no input box may sit permanently visible on
 * screen. Modeled directly on ui/components/AddNoteModal.js, which
 * already solves a near-identical problem (a dated, freeform,
 * teacher-authored entry about a student) for the existing Teacher
 * Notes feature — this is not a new interaction pattern, it's the
 * same one applied to a second, conceptually similar feature.
 *
 * The one genuine difference from AddNoteModal.js: an observation is
 * always about one specific roster student, so this modal includes a
 * student picker AddNoteModal.js never needed (a Note is already
 * scoped to a specific student before its own modal ever opens).
 * Deliberately a plain `<select>` — the roster for one Learning
 * Circle session is small, and this app already uses plain selects
 * for comparable pick-one lists (see e.g.
 * ui/views/WorkRequestRosterView.js's own status `<select>`), so a
 * heavier picker component isn't warranted here.
 */

export function openAddObservationModal({ roster, onSave }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Add Observation');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Add Observation';

  const form = document.createElement('div');
  form.className = 'modal__form';

  const studentLabel = document.createElement('label');
  studentLabel.className = 'modal__label';
  studentLabel.textContent = 'Student';
  const studentSelect = document.createElement('select');
  studentSelect.className = 'modal__input';
  roster.forEach(({ student }) => {
    const option = document.createElement('option');
    option.value = student.id;
    option.textContent = student.name;
    studentSelect.appendChild(option);
  });
  studentLabel.appendChild(studentSelect);
  form.appendChild(studentLabel);

  const noteLabel = document.createElement('label');
  noteLabel.className = 'modal__label';
  noteLabel.textContent = 'Observation';
  const noteInput = document.createElement('textarea');
  noteInput.className = 'modal__input';
  noteInput.rows = 4;
  noteInput.placeholder = 'What did you observe?';
  noteLabel.appendChild(noteInput);
  form.appendChild(noteLabel);

  const errorMessage = document.createElement('p');
  errorMessage.className = 'modal__error';
  errorMessage.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    const note = noteInput.value.trim();
    if (!note) {
      errorMessage.textContent = 'Enter what you observed first.';
      errorMessage.hidden = false;
      noteInput.focus();
      return;
    }
    close();
    onSave({ studentId: studentSelect.value, note });
  });

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  actions.append(saveButton, cancelButton);
  modal.append(heading, form, errorMessage, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  noteInput.focus();
}
