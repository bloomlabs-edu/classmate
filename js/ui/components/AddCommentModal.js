/**
 * ui/components/AddCommentModal.js
 *
 * Opened from the Student Profile's Notes & Comments tab for a
 * STANDALONE private comment — one not tied to any specific notebook/
 * assignment row (see ui/components/QuickRecognitionModal.js for the
 * work-item-scoped equivalent, opened from a notebook register row
 * instead). Mirrors ui/components/AddNoteModal.js's own structure, but
 * deliberately a separate component: a Teacher Note
 * (services/noteService.js, models/Note.js) and a private Comment
 * (services/commentService.js, models/StudentComment.js) are two
 * different systems with two different audiences going forward — a
 * Comment can be explicitly published as a Testimonial; a Note never
 * can be. Rendering + wiring only.
 */

export function openAddCommentModal({ onSave }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Add Comment');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Add Private Comment';

  const form = document.createElement('div');
  form.className = 'modal__form';

  const contentLabel = document.createElement('label');
  contentLabel.className = 'modal__label';
  contentLabel.textContent = 'Comment (private — only authorized teachers can see this)';
  const contentInput = document.createElement('textarea');
  contentInput.className = 'modal__input';
  contentInput.rows = 4;
  contentInput.placeholder = 'What would you like to record about this student?';
  contentLabel.appendChild(contentInput);
  form.appendChild(contentLabel);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    const text = contentInput.value.trim();
    if (!text) {
      window.alert('Enter a comment first.');
      return;
    }
    close();
    onSave({ text });
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
  modal.append(heading, form, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  contentInput.focus();
}
