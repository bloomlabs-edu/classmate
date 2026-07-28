/**
 * ui/components/NewClassroomModal.js
 *
 * The "+ New Classroom" modal: collects the essential classroom
 * details — School Name, Grade / Section, and (as of the Curriculum
 * Assignment at Creation milestone) Curriculum are all required;
 * Classroom Name, Academic Year, and Description stay optional.
 * Importing students, assigning buckets, customizing groups, and
 * configuring scoring all happen afterwards in the Setup Wizard (see
 * ui/views/SetupWizardView.js) — creation itself stays a single small
 * step, per the "ask only for the essential information" brief.
 *
 * Curriculum is required now because a classroom is meant to arrive
 * already knowing what it's teaching from — Learning Management
 * should never have to ask a teacher to choose a curriculum, and the
 * only way to guarantee that is to ask once, here, before the
 * classroom exists at all. `curriculumOptions` (see
 * services/curriculumLibraryService.js's getAssignableCurriculumOptions())
 * is a flat, pick-one list — every curriculum in the Library with at
 * least one published version — fetched by the caller (see
 * js/main.js's handleNewClassroom()) *before* this modal opens, since
 * this file stays deliberately synchronous otherwise. Only the
 * `curriculumId`/`versionId` pair is ever passed along to
 * `onCreate()` — never a copy of the curriculum's own data (see
 * models/Classroom.js's `curriculumAssignment` field).
 */

export function openNewClassroomModal({ onCreate, curriculumOptions }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'New Classroom');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'New Classroom';

  const form = document.createElement('div');
  form.className = 'modal__form';

  const schoolNameInput = createField(form, {
    label: 'School Name',
    required: true,
    placeholder: 'e.g. CHS Kannamapet',
  });
  const gradeSectionInput = createField(form, {
    label: 'Grade / Section',
    required: true,
    placeholder: 'e.g. Grade 8A',
  });
  const classroomNameInput = createField(form, {
    label: 'Classroom Name (optional)',
    placeholder: 'e.g. Bloom Force 19',
  });
  const academicYearInput = createField(form, {
    label: 'Academic Year (optional)',
    placeholder: 'e.g. 2026\u201327',
  });

  // Curriculum — required, and a picker rather than a text field,
  // since a classroom references a specific curriculum *version* by
  // ID (see models/Classroom.js), not a name a teacher types in.
  let selectedOption = null;
  const curriculumField = createCurriculumField(form, curriculumOptions, (option) => {
    selectedOption = option;
  });

  const descriptionInput = createField(form, {
    label: 'Description (optional)',
    placeholder: 'Optional notes about the classroom',
    multiline: true,
  });

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create Classroom';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';

  function close() {
    overlay.remove();
  }

  createButton.addEventListener('click', () => {
    const schoolName = schoolNameInput.value.trim();
    const gradeSection = gradeSectionInput.value.trim();

    if (!schoolName) {
      window.alert('School Name is required.');
      schoolNameInput.focus();
      return;
    }
    if (!gradeSection) {
      window.alert('Grade / Section is required.');
      gradeSectionInput.focus();
      return;
    }
    if (!selectedOption) {
      window.alert('Choose a Curriculum first.');
      curriculumField.focus();
      return;
    }

    onCreate(
      {
        schoolName,
        gradeSection,
        classroomName: classroomNameInput.value.trim(),
        academicYear: academicYearInput.value.trim(),
        description: descriptionInput.value.trim(),
        curriculumAssignment: {
          curriculumId: selectedOption.curriculumId,
          versionId: selectedOption.versionId,
        },
      },
      close
    );
  });

  cancelButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  actions.append(createButton, cancelButton);
  modal.append(heading, form, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  schoolNameInput.focus();
}

function createField(form, { label, placeholder, required = false, multiline = false }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'modal__label';
  wrapper.textContent = label;

  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = 'text';
  input.className = 'modal__input';
  input.placeholder = placeholder;
  if (required) input.required = true;
  if (multiline) input.rows = 3;

  wrapper.appendChild(input);
  form.appendChild(wrapper);
  return input;
}

/**
 * A required, flat pick-one field — expands into a short list of
 * available curriculum versions on click, collapsing back into a
 * "selected" display once one is chosen. Deliberately not a native
 * <select>: each option needs two lines (curriculum name, version),
 * which a plain dropdown option can't show cleanly.
 */
function createCurriculumField(form, options, onSelect) {
  const wrapper = document.createElement('div');
  wrapper.className = 'modal__label';
  const labelText = document.createElement('span');
  labelText.textContent = 'Curriculum';
  wrapper.appendChild(labelText);

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'modal__curriculum-toggle';
  toggleButton.textContent = options.length > 0 ? 'Choose Curriculum' : 'No curricula available yet';
  toggleButton.disabled = options.length === 0;
  wrapper.appendChild(toggleButton);

  const optionList = document.createElement('div');
  optionList.className = 'modal__curriculum-options';
  optionList.hidden = true;

  options.forEach((option) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'modal__curriculum-option';
    const nameEl = document.createElement('span');
    nameEl.className = 'modal__curriculum-option-name';
    nameEl.textContent = option.curriculumName;
    const versionEl = document.createElement('span');
    versionEl.className = 'modal__curriculum-option-version';
    versionEl.textContent = `Version ${option.versionLabel}`;
    optionButton.append(nameEl, versionEl);
    optionButton.addEventListener('click', () => {
      onSelect(option);
      toggleButton.textContent = `${option.curriculumName} \u00b7 Version ${option.versionLabel}`;
      toggleButton.classList.add('modal__curriculum-toggle--selected');
      optionList.hidden = true;
    });
    optionList.appendChild(optionButton);
  });

  toggleButton.addEventListener('click', () => {
    optionList.hidden = !optionList.hidden;
  });

  wrapper.appendChild(optionList);
  form.appendChild(wrapper);
  return toggleButton;
}
