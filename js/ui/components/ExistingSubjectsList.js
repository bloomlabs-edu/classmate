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
 *
 * Each Subject renders with two actions: opening it (the whole row)
 * and removing it (a small, separate control) — a teacher can clean
 * up an accidental addition without having to open it first. Change
 * Curriculum is a named future action, not built here yet.
 */

export function renderExistingSubjectsList(subjects, onChooseSubject, onRemoveSubject) {
  const list = document.createElement('div');
  list.className = 'learning-management__subject-card-list';

  subjects.forEach((subject) => {
    const card = document.createElement('div');
    card.className = 'learning-management__subject-card';

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'learning-management__choice-option';
    openButton.textContent = subject.title;
    openButton.addEventListener('click', () => onChooseSubject(subject));
    card.appendChild(openButton);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--danger-text learning-management__subject-remove';
    removeButton.textContent = 'Remove';
    removeButton.setAttribute('aria-label', `Remove ${subject.title}`);
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onRemoveSubject(subject);
    });
    card.appendChild(removeButton);

    list.appendChild(card);
  });

  return list;
}
