/**
 * ui/components/UnsavedChangesModal.js
 *
 * "You have unsaved changes" — shown when a teacher tries to leave a
 * document-editor-style screen (see
 * ui/views/AssessmentManagementView.js's marks entry) mid-edit. Three
 * real options, not two: Save (commit and then leave), Discard (throw
 * away the draft and leave), Cancel (stay put, change nothing). A
 * plain confirm/cancel dialog can't express this — leaving unsaved
 * marks entry needs a real choice between saving and discarding, not
 * just "leave or don't."
 *
 * Built as its own reusable component, not inlined into Assessment
 * Management, since any future document-editor-style screen on the
 * platform needs the exact same three-way choice.
 */

export function openUnsavedChangesModal({ onSave, onDiscard, onCancel }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Unsaved changes');

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
      onCancel();
    }
  });

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'You have unsaved changes.';
  modal.appendChild(heading);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    close();
    onSave();
  });
  actions.appendChild(saveButton);

  const discardButton = document.createElement('button');
  discardButton.type = 'button';
  discardButton.className = 'btn btn--danger-text';
  discardButton.textContent = 'Discard';
  discardButton.addEventListener('click', () => {
    close();
    onDiscard();
  });
  actions.appendChild(discardButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', () => {
    close();
    onCancel();
  });
  actions.appendChild(cancelButton);

  modal.appendChild(actions);
}
