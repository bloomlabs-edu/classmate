/**
 * ui/components/AddSubjectToAssessmentModal.js
 *
 * "+ Add Subject" on an already-existing Assessment — lets a teacher
 * include more of the classroom's real Subjects later, without
 * recreating the Assessment. Only ever offers Subjects that already
 * exist in Learning Management and aren't yet part of this Assessment
 * (services/assessmentService.js's getAvailableSubjectsToAdd()) — this
 * never creates a new classroom Subject, only attaches an existing one.
 */

import * as assessmentService from '../../services/assessmentService.js';
import * as workspaceService from '../../services/workspaceService.js';

export function openAddSubjectToAssessmentModal({ classroom, assessment, onSubjectsAdded }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Add Subject');

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Add Subject';
  modal.appendChild(heading);

  const available = assessmentService.getAvailableSubjectsToAdd(classroom, assessment);
  const checkboxes = [];

  if (available.length === 0) {
    const emptyNote = document.createElement('p');
    emptyNote.className = 'modal__description';
    emptyNote.textContent = 'Every Subject in this classroom is already part of this assessment.';
    modal.appendChild(emptyNote);
  } else {
    const list = document.createElement('div');
    list.className = 'create-assessment-modal__subjects-list';
    available.forEach((subject) => {
      const row = document.createElement('label');
      row.className = 'create-assessment-modal__subject-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = subject.id;
      const labelText = document.createElement('span');
      labelText.textContent = subject.title;
      row.append(checkbox, labelText);
      list.appendChild(row);
      checkboxes.push(checkbox);
    });
    modal.appendChild(list);
  }

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  if (available.length > 0) {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--primary';
    addButton.textContent = 'Add Subject';
    addButton.addEventListener('click', () => {
      const chosenIds = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
      chosenIds.forEach((subjectId) => assessmentService.addSubjectToAssessment(assessment, subjectId));
      if (chosenIds.length > 0) workspaceService.save(classroom);
      close();
      onSubjectsAdded();
    });
    actions.appendChild(addButton);
  }

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);
  actions.appendChild(cancelButton);

  modal.appendChild(actions);
}
