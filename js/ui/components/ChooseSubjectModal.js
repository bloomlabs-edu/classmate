/**
 * ui/components/ChooseSubjectModal.js
 *
 * "Choose Subject" as a centered overlay, not a page navigation — a
 * teacher stays on Learning Management the whole time; this is
 * appended straight to `document.body`, the same way every other
 * modal in this app already works (see ui/components/NewClassroomModal.js),
 * which is what actually makes "the user remains on the page" true
 * rather than just visually implied.
 *
 * A short guided workflow within the one modal, not an immediate
 * pick-and-go: subjects render as a selectable list (radio-like — one
 * row highlighted at a time, not chips a click immediately acts on),
 * "Custom Subject" is the list's own final row (selecting it reveals
 * a text field in place, not a separate fallback button), and Next
 * only ever fires once something real is selected. Cancel and
 * backdrop-click both close without selecting anything.
 *
 * The search input is a deliberate, inert placeholder — present so
 * the layout doesn't have to change shape when search is added later,
 * doing nothing today. Typing in it filters nothing yet.
 *
 * Reuses config/commonSubjectsConfig.js's own COMMON_SUBJECTS list
 * directly — the *data* both this and ui/components/SubjectPicker.js
 * draw from is the same thing; only the interaction shape around it
 * differs here (a list to guide through, not chips to click through),
 * which is why this is a new component rather than a reskin of that
 * one. SubjectPicker.js itself is untouched and still used elsewhere.
 *
 * Selecting a subject, or confirming a custom one, does not create
 * anything — `onNext(subjectName)` is the only effect, and what it
 * does is entirely the caller's decision (see
 * ui/views/LearningManagementView.js, which currently only logs the
 * choice — Choose Curriculum is a later, separately-approved
 * milestone, not built here).
 */

import { COMMON_SUBJECTS } from '../../config/commonSubjectsConfig.js';

export function openChooseSubjectModal({ onNext, onCancel }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Choose Subject');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Choose Subject';

  // Inert for now — see this file's own header comment. Not wired to
  // filter the list below; present purely so search can be added
  // later without changing this modal's layout.
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'modal__input choose-subject-modal__search';
  searchInput.placeholder = 'Search subjects (coming soon)';
  searchInput.disabled = true;

  const list = document.createElement('div');
  list.className = 'choose-subject-modal__list';

  let selectedSubjectName = null;
  let customInputEl = null;
  const rowElements = [];

  function selectRow(rowEl, subjectName) {
    rowElements.forEach((el) => el.classList.remove('choose-subject-modal__row--selected'));
    rowEl.classList.add('choose-subject-modal__row--selected');
    selectedSubjectName = subjectName;
    updateNextButtonState();
  }

  COMMON_SUBJECTS.forEach((subjectName) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'choose-subject-modal__row';
    row.textContent = subjectName;
    row.addEventListener('click', () => selectRow(row, subjectName));
    rowElements.push(row);
    list.appendChild(row);
  });

  // "Custom Subject" — the list's own final row, not a separate
  // fallback button. Selecting it reveals a text field in place;
  // typing into that field is what actually sets the selection, not
  // the row click itself (the row alone has no subject name yet).
  const customRow = document.createElement('button');
  customRow.type = 'button';
  customRow.className = 'choose-subject-modal__row choose-subject-modal__row--custom';
  customRow.textContent = 'Custom Subject';
  rowElements.push(customRow);

  const customFieldWrapper = document.createElement('div');
  customFieldWrapper.className = 'choose-subject-modal__custom-field';
  customFieldWrapper.hidden = true;

  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'modal__input';
  customInput.placeholder = 'Type a subject name';
  customInputEl = customInput;
  customInput.addEventListener('input', () => {
    selectedSubjectName = customInput.value.trim() || null;
    updateNextButtonState();
  });
  customFieldWrapper.appendChild(customInput);

  customRow.addEventListener('click', () => {
    rowElements.forEach((el) => el.classList.remove('choose-subject-modal__row--selected'));
    customRow.classList.add('choose-subject-modal__row--selected');
    customFieldWrapper.hidden = false;
    customInput.focus();
    selectedSubjectName = customInput.value.trim() || null;
    updateNextButtonState();
  });

  list.appendChild(customRow);
  list.appendChild(customFieldWrapper);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'btn btn--primary';
  nextButton.textContent = 'Next';
  nextButton.disabled = true;

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';

  function updateNextButtonState() {
    nextButton.disabled = !selectedSubjectName;
  }

  function close() {
    overlay.remove();
  }

  nextButton.addEventListener('click', () => {
    if (!selectedSubjectName) return;
    const chosenName = selectedSubjectName;
    close();
    onNext(chosenName);
  });

  cancelButton.addEventListener('click', () => {
    close();
    if (onCancel) onCancel();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
      if (onCancel) onCancel();
    }
  });

  actions.append(nextButton, cancelButton);
  modal.append(heading, searchInput, list, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
