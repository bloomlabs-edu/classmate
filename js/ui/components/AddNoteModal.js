/**
 * ui/components/AddNoteModal.js
 *
 * Opened from the Student Profile's Notes tab. Collects the note's
 * content and the teacher's name (free text — there's no login, so the
 * app can't fill this in automatically). Rendering + wiring only.
 *
 * "This note is about something that happened earlier" — optional,
 * unchecked by default. Unchecked, `onSave` receives exactly the same
 * shape it always has (no `aboutDate` at all) — today's behavior is
 * completely unchanged for a teacher who never opens this. Checking
 * it reveals a plain date picker; the picked "YYYY-MM-DD" value is
 * converted to a full ISO timestamp before being passed through, so
 * `aboutDate` always has the same shape whether it came from here or
 * from models/Note.js's own default — never two different
 * representations of the same field depending on how a note was
 * created.
 */

export function openAddNoteModal({ onSave }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Add Note');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Add Note';

  const form = document.createElement('div');
  form.className = 'modal__form';

  const teacherLabel = document.createElement('label');
  teacherLabel.className = 'modal__label';
  teacherLabel.textContent = 'Your name';
  const teacherInput = document.createElement('input');
  teacherInput.type = 'text';
  teacherInput.className = 'modal__input';
  teacherInput.placeholder = 'e.g. Ms. Rao';
  teacherLabel.appendChild(teacherInput);
  form.appendChild(teacherLabel);

  const contentLabel = document.createElement('label');
  contentLabel.className = 'modal__label';
  contentLabel.textContent = 'Note';
  const contentInput = document.createElement('textarea');
  contentInput.className = 'modal__input';
  contentInput.rows = 4;
  contentInput.placeholder = 'What did you observe?';
  contentLabel.appendChild(contentInput);
  form.appendChild(contentLabel);

  const earlierRow = document.createElement('label');
  earlierRow.className = 'modal__checkbox-row';
  const earlierCheckbox = document.createElement('input');
  earlierCheckbox.type = 'checkbox';
  const earlierText = document.createElement('span');
  earlierText.textContent = 'This note is about something that happened earlier';
  earlierRow.append(earlierCheckbox, earlierText);
  form.appendChild(earlierRow);

  const aboutDateLabel = document.createElement('label');
  aboutDateLabel.className = 'modal__label';
  aboutDateLabel.hidden = true;
  aboutDateLabel.textContent = 'When did this happen?';
  const aboutDateInput = document.createElement('input');
  aboutDateInput.type = 'date';
  aboutDateInput.className = 'modal__input';
  aboutDateLabel.appendChild(aboutDateInput);
  form.appendChild(aboutDateLabel);

  earlierCheckbox.addEventListener('change', () => {
    aboutDateLabel.hidden = !earlierCheckbox.checked;
  });

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    const content = contentInput.value.trim();
    if (!content) {
      window.alert('Enter some note content first.');
      return;
    }

    const saveDetails = { teacherName: teacherInput.value.trim() || 'Teacher', content };

    if (earlierCheckbox.checked) {
      if (!aboutDateInput.value) {
        window.alert('Choose a date, or uncheck "This note is about something that happened earlier."');
        return;
      }
      // Converts the plain "YYYY-MM-DD" picker value to a full ISO
      // timestamp so aboutDate always has the same shape as
      // createdAt/models/Note.js's own default — never a second,
      // incompatible representation depending on how a note was made.
      saveDetails.aboutDate = new Date(aboutDateInput.value).toISOString();
    }

    close();
    onSave(saveDetails);
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
  teacherInput.focus();
}
