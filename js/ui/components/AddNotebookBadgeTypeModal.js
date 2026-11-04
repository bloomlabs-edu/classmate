/**
 * ui/components/AddNotebookBadgeTypeModal.js
 *
 * "+ Add Badge Type" — opened from the Notebook Checkpoints grid's own
 * Student column header (see ui/views/NotebookCheckpointsView.js) to
 * let a teacher extend their classroom's own notebook-badge catalog
 * (services/notebookBadgeService.js). Deliberately collects only a
 * name — icon and colour are auto-assigned by that service (a cycling
 * theme, a generic icon), matching this modal's own single-field
 * simplicity; a full icon/colour picker is a possible future
 * enhancement, not built here. Shares the exact modal shell/field
 * styling (modal/modal__heading/modal__form/modal__label/modal__input,
 * btn--primary + btn--text) already established by
 * ui/components/NewClassroomModal.js rather than inventing a second
 * modal language.
 *
 * `onSave(name)` is the caller's own synchronous function, returning
 * `true` on success (closes the modal) or `false` (e.g. a duplicate
 * name — keeps the modal open so the teacher can pick a different
 * name, same "stay open on a real validation failure" shape this app's
 * other modals already use).
 */
export function openAddBadgeTypeModal({ onSave }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Add Badge Type');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Add Badge Type';

  const form = document.createElement('div');
  form.className = 'modal__form';

  const label = document.createElement('label');
  label.className = 'modal__label';
  label.textContent = 'Badge name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'modal__input';
  nameInput.placeholder = 'e.g. Neat Handwriting';
  label.appendChild(nameInput);
  form.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Add';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';

  function close() {
    overlay.remove();
  }

  saveButton.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      window.alert('Badge name is required.');
      nameInput.focus();
      return;
    }
    const succeeded = onSave(name);
    if (succeeded) close();
  });

  cancelButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  actions.append(saveButton, cancelButton);
  modal.append(heading, form, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  nameInput.focus();
}
