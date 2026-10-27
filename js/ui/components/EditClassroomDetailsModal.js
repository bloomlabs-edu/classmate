/**
 * ui/components/EditClassroomDetailsModal.js
 *
 * "Edit Classroom Details" — opened from the classroom header's
 * overflow menu (see ui/views/DashboardView.js) to rename a classroom
 * or change its description after creation. Deliberately NOT a second
 * creation form: School Name, Grade/Section, and Curriculum are fixed
 * here and never shown — this action only ever touches
 * models/Classroom.js's `classroomName`/`description` fields, the same
 * two optional fields ui/components/NewClassroomModal.js's own last two
 * fields already collect at creation time. Shares that file's exact
 * modal shell/field styling (modal/modal__heading/modal__form/
 * modal__label/modal__input, btn--primary + btn--text, window.alert()
 * for a missing required field) rather than inventing a second modal
 * language.
 *
 * `onSave(updates)` is the caller's own async function — this file only
 * owns the form and its saving/success/error UI, never
 * classroomService/workspaceService calls directly, so there is exactly
 * one place (ui/views/DashboardView.js) that actually writes a
 * Classroom document, matching this app's "no parallel update
 * mechanism" rule. `onSave` rejecting (the same "rethrows on failure"
 * contract services/workspaceService.js's saveExplicitly() already
 * documents) is what puts this modal into its Retry state — the exact
 * saving/failed/retry shape ui/views/ConceptWorkspaceView.js's own
 * "What did we learn?" description editor already established for an
 * in-place classroom-document edit.
 */

export function openEditClassroomDetailsModal({ classroom, onSave }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Edit Classroom Details');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Edit Classroom Details';

  const form = document.createElement('div');
  form.className = 'modal__form';

  const nameInput = createField(form, {
    label: 'Classroom Name',
    placeholder: 'e.g. Bloom Force 19',
    value: classroom.classroomName || '',
  });

  const descriptionInput = createField(form, {
    label: 'Description (optional)',
    placeholder: 'Optional notes about the classroom',
    multiline: true,
    value: classroom.description || '',
  });

  const errorText = document.createElement('p');
  errorText.className = 'modal__error';
  errorText.hidden = true;
  form.appendChild(errorText);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';

  function close() {
    overlay.remove();
  }

  // Mirrors ConceptWorkspaceView.js's description editor: disabled
  // inputs + "Saving…" while in flight, never silently dropped on
  // failure — the inline error + "Retry" button below stay until the
  // teacher either succeeds or cancels out.
  function setSaving(isSaving) {
    saveButton.disabled = isSaving;
    cancelButton.disabled = isSaving;
    nameInput.disabled = isSaving;
    descriptionInput.disabled = isSaving;
    if (isSaving) {
      saveButton.textContent = 'Saving…';
      errorText.hidden = true;
    }
  }

  saveButton.addEventListener('click', async () => {
    // Synchronous re-entrancy guard, same idiom this app's other Save
    // actions use (e.g. ui/views/ConceptWorkspaceView.js's resource
    // Create buttons) — checked before any await so a rapid second
    // click mid-save is a no-op.
    if (saveButton.disabled) return;

    const classroomName = nameInput.value.trim();
    if (!classroomName) {
      window.alert('Classroom Name is required.');
      nameInput.focus();
      return;
    }

    setSaving(true);
    try {
      await onSave({ classroomName, description: descriptionInput.value.trim() });
      saveButton.textContent = '✓ Saved';
      setTimeout(close, 500);
    } catch (error) {
      setSaving(false);
      saveButton.textContent = 'Retry';
      errorText.textContent = 'Save failed. Check your connection and try again.';
      errorText.hidden = false;
    }
  });

  cancelButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && !saveButton.disabled) close();
  });

  actions.append(saveButton, cancelButton);
  modal.append(heading, form, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  nameInput.focus();
}

function createField(form, { label, placeholder, multiline = false, value = '' }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'modal__label';
  wrapper.textContent = label;

  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = 'text';
  input.className = 'modal__input';
  input.placeholder = placeholder;
  input.value = value;
  if (multiline) input.rows = 3;

  wrapper.appendChild(input);
  form.appendChild(wrapper);
  return input;
}
