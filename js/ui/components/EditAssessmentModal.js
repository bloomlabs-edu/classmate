/**
 * ui/components/EditAssessmentModal.js
 *
 * "Edit Assessment" from an Assessment's overflow menu — only the
 * Assessment's own top-level fields (name, type, academic year,
 * date). Deliberately does not touch Subjects here at all: adding or
 * removing them is "+ Add Subject" / "Remove from Assessment" (see
 * ui/views/AssessmentManagementView.js), a separate, already-built
 * concern with its own confirmation semantics.
 */

import { ASSESSMENT_TYPES } from '../../config/assessmentTypesConfig.js';
import * as assessmentService from '../../services/assessmentService.js';
import * as workspaceService from '../../services/workspaceService.js';

export function openEditAssessmentModal({ classroom, assessment, onAssessmentUpdated }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Edit Assessment');

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
  heading.textContent = 'Edit Assessment';
  modal.appendChild(heading);

  const nameField = createLabeledInput('Assessment Name');
  nameField.input.value = assessment.title;
  modal.appendChild(nameField.wrapper);

  const typeField = createLabeledSelect('Assessment Type', ASSESSMENT_TYPES);
  typeField.select.value = assessment.type;
  modal.appendChild(typeField.wrapper);

  const yearField = createLabeledInput('Academic Year');
  yearField.input.value = assessment.academicYear;
  modal.appendChild(yearField.wrapper);

  const dateField = createLabeledInput('Date');
  dateField.input.type = 'date';
  dateField.input.value = assessment.date;
  modal.appendChild(dateField.wrapper);

  const errorText = document.createElement('p');
  errorText.className = 'modal__error';
  errorText.hidden = true;
  modal.appendChild(errorText);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    const title = nameField.input.value.trim();
    if (!title) {
      errorText.textContent = 'Please enter an assessment name.';
      errorText.hidden = false;
      return;
    }
    assessmentService.updateAssessmentDetails(assessment, {
      title,
      type: typeField.select.value,
      academicYear: yearField.input.value.trim(),
      date: dateField.input.value,
    });
    workspaceService.save(classroom);
    close();
    onAssessmentUpdated();
  });
  actions.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);
  actions.appendChild(cancelButton);

  modal.appendChild(actions);
}

function createLabeledInput(labelText) {
  const wrapper = document.createElement('label');
  wrapper.className = 'create-assessment-modal__labeled-input';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  wrapper.append(label, input);
  return { wrapper, input };
}

function createLabeledSelect(labelText, options) {
  const wrapper = document.createElement('label');
  wrapper.className = 'create-assessment-modal__labeled-input';
  const label = document.createElement('span');
  label.textContent = labelText;
  const select = document.createElement('select');
  options.forEach((optionText) => {
    const option = document.createElement('option');
    option.value = optionText;
    option.textContent = optionText;
    select.appendChild(option);
  });
  wrapper.append(label, select);
  return { wrapper, select };
}
