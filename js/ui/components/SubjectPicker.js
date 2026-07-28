/**
 * ui/components/SubjectPicker.js
 *
 * "At no point in the portal should anyone be prompted to type text.
 * The first experience should always be selector buttons to click on.
 * If the existing buttons don't suffice, an 'Other' button opens the
 * text box." This is the shared implementation of that principle for
 * adding a Subject — used by both ui/views/LearningManagementView.js's
 * Choose Subject step and ui/views/LearningRecordView.js's (Manage
 * Lessons) Subjects level, so there is exactly one "add a Subject"
 * experience in the app, not two independently-maintained ones.
 *
 * Subjects specifically get this treatment because they have a real,
 * generic common vocabulary that holds up across grades and curricula
 * (see config/commonSubjectsConfig.js) — clicking "Science" is
 * genuinely faster and more reliable than typing it. Units and
 * Concepts deliberately do *not* get this same treatment anywhere in
 * the app: a Unit's or Concept's name is curriculum- and
 * lesson-specific ("Force and Pressure," "Lateral Inversion") with no
 * sensible fixed list to click from — offering generic placeholder
 * buttons there wouldn't save a teacher any typing, it would just add
 * a click before the typing they still have to do. Free-text entry
 * for those stays exactly as it is.
 *
 * Already-added subjects (case-insensitive match) are left off the
 * button row — there's no reason to offer "Science" again once a
 * classroom already has it.
 */

import { COMMON_SUBJECTS } from '../../config/commonSubjectsConfig.js';

export function createSubjectPickerElement({ existingSubjectTitles = [], onAddSubject }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'subject-picker';

  const existingLower = existingSubjectTitles.map((title) => title.trim().toLowerCase());
  const availableSubjects = COMMON_SUBJECTS.filter((subject) => !existingLower.includes(subject.toLowerCase()));

  const grid = document.createElement('div');
  grid.className = 'subject-picker__grid';

  availableSubjects.forEach((subject) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'subject-picker__option';
    button.textContent = subject;
    button.addEventListener('click', () => onAddSubject(subject));
    grid.appendChild(button);
  });

  const otherButton = document.createElement('button');
  otherButton.type = 'button';
  otherButton.className = 'subject-picker__option subject-picker__option--other';
  otherButton.textContent = 'Other';
  grid.appendChild(otherButton);

  wrapper.appendChild(grid);

  // The free-text fallback — built once, shown only after "Other" is
  // clicked. Toggled with a class, not the `hidden` attribute plus an
  // unconditional `display` rule, which is exactly the combination
  // that silently broke a very similar picker in
  // ui/components/NewClassroomModal.js — see this project's own
  // CHANGELOG for that bug. `.subject-picker__custom-form` has no
  // `display` declaration of its own for this same reason; the
  // `--visible` class is the only thing that ever sets one.
  const customForm = document.createElement('div');
  customForm.className = 'subject-picker__custom-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Subject name';

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'btn btn--ghost';
  confirmButton.textContent = '+ Add Subject';
  confirmButton.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) return;
    onAddSubject(value);
  });

  customForm.append(input, confirmButton);
  wrapper.appendChild(customForm);

  otherButton.addEventListener('click', () => {
    customForm.classList.add('subject-picker__custom-form--visible');
    input.focus();
  });

  return wrapper;
}
