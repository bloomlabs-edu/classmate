/**
 * ui/components/CreateAssessmentModal.js
 *
 * "+ Create Assessment" — a single-step form: name, type, academic
 * year, date, and which Subjects are included. Manual creation must
 * remain possible even for a Subject not yet in this classroom's
 * Learning Record/Learning Activities (e.g. Physical Education, when
 * only Science/Social Science/Mathematics have been added there) —
 * see this feature's own "Learning Activities is a filter, not a hard
 * security lock" requirement. So two groups are offered:
 *
 * 1. Subjects that already exist in this classroom (reads
 *    services/learningRecordService.js's getSubjects() directly) —
 *    checkbox value is that Subject record's own `.id`, the original,
 *    still-primary meaning of AssessmentSubject.subjectId.
 * 2. Every other canonical Subject (config/canonicalSubjectsConfig.js)
 *    NOT yet in this classroom's Learning Record — checkbox value is
 *    the canonical id itself (e.g. "physical_education"). Picking one
 *    of these does NOT add it to Learning Record/Learning Activities;
 *    services/assessmentService.js's getSubjectTitle() resolves this
 *    case via its own canonical-registry fallback.
 *
 * Persists nothing until "Create Assessment" is explicitly clicked —
 * services/assessmentService.js's createNewAssessment() builds the
 * complete Assessment (every chosen Subject already attached as its
 * own AssessmentSubject) in one step.
 */

import { ASSESSMENT_TYPES } from '../../config/assessmentTypesConfig.js';
import { CANONICAL_SUBJECTS } from '../../config/canonicalSubjectsConfig.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as assessmentService from '../../services/assessmentService.js';
import * as workspaceService from '../../services/workspaceService.js';

export function openCreateAssessmentModal({ classroom, onAssessmentCreated }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Create Assessment');

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
  heading.textContent = 'Create Assessment';
  modal.appendChild(heading);

  const nameField = createLabeledInput('Assessment Name', 'e.g. Mid Term Examination');
  modal.appendChild(nameField.wrapper);

  const typeField = createLabeledSelect('Assessment Type', ASSESSMENT_TYPES);
  modal.appendChild(typeField.wrapper);

  const yearField = createLabeledInput('Academic Year', 'e.g. 2026-2027');
  yearField.input.value = classroom.academicYear || '';
  modal.appendChild(yearField.wrapper);

  const dateField = createLabeledInput('Date', '');
  dateField.input.type = 'date';
  modal.appendChild(dateField.wrapper);

  const subjectsLabel = document.createElement('p');
  subjectsLabel.className = 'modal__label';
  subjectsLabel.textContent = 'Subjects Included';
  modal.appendChild(subjectsLabel);

  const subjects = learningRecordService.getSubjects(classroom);
  const learningRecordCanonicalIds = new Set(subjects.map((subject) => subject.subjectId).filter(Boolean));
  const otherCanonicalSubjects = CANONICAL_SUBJECTS.filter((subject) => !learningRecordCanonicalIds.has(subject.id));
  const subjectCheckboxes = [];

  function appendSubjectRow(list, value, title) {
    const row = document.createElement('label');
    row.className = 'create-assessment-modal__subject-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = value;
    const labelText = document.createElement('span');
    labelText.textContent = title;
    row.append(checkbox, labelText);
    list.appendChild(row);
    subjectCheckboxes.push(checkbox);
  }

  if (subjects.length === 0 && otherCanonicalSubjects.length === 0) {
    const emptyNote = document.createElement('p');
    emptyNote.className = 'modal__description';
    emptyNote.textContent = 'This classroom has no Subjects yet \u2014 add one in Learning first.';
    modal.appendChild(emptyNote);
  } else {
    if (subjects.length > 0) {
      const subjectsList = document.createElement('div');
      subjectsList.className = 'create-assessment-modal__subjects-list';
      subjects.forEach((subject) => appendSubjectRow(subjectsList, subject.id, subject.title));
      modal.appendChild(subjectsList);
    }

    if (otherCanonicalSubjects.length > 0) {
      // Not yet in this classroom's Learning Activities \u2014 picking one
      // here creates an Assessment for it without adding it to
      // Learning Record; see this file's own header comment.
      const otherLabel = document.createElement('p');
      otherLabel.className = 'modal__description';
      otherLabel.textContent = 'Not yet in Learning Activities';
      modal.appendChild(otherLabel);

      const otherList = document.createElement('div');
      otherList.className = 'create-assessment-modal__subjects-list';
      otherCanonicalSubjects.forEach((subject) => appendSubjectRow(otherList, subject.id, subject.title));
      modal.appendChild(otherList);
    }
  }

  const errorText = document.createElement('p');
  errorText.className = 'modal__error';
  errorText.hidden = true;
  modal.appendChild(errorText);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  // Set once the Assessment has actually been created in memory (the
  // first successful click past validation) — kept outside the click
  // handler so a Retry click, after a failed save below, re-attempts
  // only the save, never calls createNewAssessment() a second time
  // and ends up with two Assessments for one click-plus-retry.
  let pendingAssessment = null;

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create Assessment';
  createButton.addEventListener('click', async () => {
    if (!pendingAssessment) {
      const title = nameField.input.value.trim();
      const type = typeField.select.value;
      const academicYear = yearField.input.value.trim();
      const date = dateField.input.value;
      const subjectIds = subjectCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);

      if (!title) {
        errorText.textContent = 'Please enter an assessment name.';
        errorText.hidden = false;
        return;
      }
      if (subjectIds.length === 0) {
        errorText.textContent = 'Please choose at least one subject.';
        errorText.hidden = false;
        return;
      }

      pendingAssessment = assessmentService.createNewAssessment(classroom, { title, type, academicYear, date, subjectIds });
      // Marks this classroom dirty the instant the Assessment (plus
      // its per-subject AssessmentSubject entries) exists in memory —
      // before the network write below even starts — so an incoming
      // Firestore snapshot from before it existed can't silently
      // revert it while the save is in flight (see
      // workspaceService.js's canApplyIncomingServerState()).
      workspaceService.markDirty(classroom.id);
    }

    errorText.hidden = true;
    createButton.disabled = true;
    cancelButton.disabled = true;
    createButton.textContent = 'Creating…';

    try {
      // saveExplicitly(), not save() — awaited, so this handler knows
      // exactly when the write has actually settled and the button
      // can only ever fire one persistence attempt at a time, rather
      // than firing-and-forgetting it and leaving the button clickable
      // (and the assessment's saved state ambiguous) the whole time.
      await workspaceService.saveExplicitly(classroom);
      close();
      onAssessmentCreated(pendingAssessment);
    } catch (error) {
      // Already logged by saveExplicitly() itself. The Assessment
      // stays created in memory and every field the teacher entered
      // stays exactly as typed — nothing here clears the form.
      errorText.textContent = 'Save failed. Check your connection and try again.';
      errorText.hidden = false;
      createButton.disabled = false;
      cancelButton.disabled = false;
      createButton.textContent = 'Retry';
    }
  });
  actions.appendChild(createButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);
  actions.appendChild(cancelButton);

  modal.appendChild(actions);
}

function createLabeledInput(labelText, placeholder) {
  const wrapper = document.createElement('label');
  wrapper.className = 'create-assessment-modal__labeled-input';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
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
