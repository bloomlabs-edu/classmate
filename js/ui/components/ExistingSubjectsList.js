/**
 * ui/components/ExistingSubjectsList.js
 *
 * Renders exactly the classroom's own persisted Subjects — nothing
 * else, ever. This component's entire contract is "here is a list of
 * Subjects, render them"; it has no concept of a "suggested subject,"
 * no default list, no empty-state fallback that shows anything but
 * what's actually passed in. An empty `subjects` array renders
 * nothing at all, by design — the caller (see
 * ui/views/LearningManagementView.js) is responsible for the "+ Add
 * Subject" button that sits beside this, not this component.
 *
 * This is the deliberate other half of the safeguard described in
 * ui/components/AddSubjectModal.js's own header comment: that file is
 * the only place config/commonSubjectsConfig.js is ever imported;
 * this file is the only thing ui/views/LearningManagementView.js's
 * home screen renders subjects through, and it has no import that
 * could reach suggestion data even if someone tried.
 */

export function renderExistingSubjectsList(subjects, onChooseSubject) {
  const grid = document.createElement('div');
  grid.className = 'learning-management__choice-grid';

  subjects.forEach((subject) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'learning-management__choice-option';
    button.textContent = subject.title;
    button.addEventListener('click', () => onChooseSubject(subject));
    grid.appendChild(button);
  });

  return grid;
}
