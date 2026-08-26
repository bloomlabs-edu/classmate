/**
 * ui/components/CreateLearningProgrammeModal.js
 *
 * The teacher-facing "Create Learning Programme" flow — deliberately
 * asks for only three things (Name, Description, Students), matching
 * this project's own Phase 2A authorization ("Do NOT expose the
 * entire internal configuration model"). A teacher never sees or
 * chooses Listening/Speaking/Reading/Writing here: the default
 * English Literacy Circle configuration (see
 * config/englishLiteracyCircleDefaults.js) is applied automatically,
 * exactly as the product brief requires. Nothing here assumes every
 * programme is an English Literacy Circle — this modal only ever
 * builds ONE programme type today because that is the only default
 * configuration this app currently has (see this file's own
 * DEFAULT_CONFIGURATION_BUILDERS below); a future second programme
 * type would add a second entry there, not change this modal's own
 * shape.
 *
 * Follows ui/components/NewClassroomModal.js's own established modal
 * structure and CSS classes (`.modal-overlay`, `.modal`,
 * `.modal__heading`, `.modal__label`, `.modal__input`,
 * `.modal__actions`) exactly, rather than inventing a new modal shape.
 *
 * Students come from the classroom's own real roster — this modal
 * never creates a Student record and never copies student profile
 * data; only `studentId`s are ever passed to `onCreate()`, consistent
 * with the domain layer's own reference-not-copy convention (see
 * models/ProgrammeMembership.js).
 */

import { createStudentMultiSelectElement } from './StudentMultiSelect.js';
import { buildEnglishLiteracyCircleConfiguration } from '../../config/englishLiteracyCircleDefaults.js';

/**
 * The only default configuration this app has today. Keyed by a
 * `programmeType` id so a future second type (a Reading Club, a
 * Bridge Programme) is a second entry here, not a rewrite of this
 * modal — see this file's own header comment. Phase 2A ships exactly
 * one entry, matching the current real use case.
 */
const DEFAULT_CONFIGURATION_BUILDERS = {
  english_literacy_circle: buildEnglishLiteracyCircleConfiguration,
};

/**
 * `classroom` — used only to build the student list to select from
 * (`classroom.teams`) and is never mutated here; the caller
 * (ui/views/LearningProgrammesListView.js) is responsible for
 * actually creating the programme via
 * services/learningProgrammeService.js and persisting it, matching
 * this project's own "views own presentation, services own mutation"
 * data-flow rule. `onCreate({ name, description, studentIds })` is
 * called once, with plain data only — never a Firestore call, never
 * a classroom mutation, from this file.
 */
export function openCreateLearningProgrammeModal({ classroom, onCreate }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Create Teaching Programme');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Create Teaching Programme';

  const description = document.createElement('p');
  description.className = 'modal__description';
  description.textContent = 'An additional learning context for selected students — separate from your normal classroom and Class Mode.';

  const form = document.createElement('div');
  form.className = 'modal__form';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'modal__label';
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'modal__input';
  nameInput.placeholder = 'e.g. English Literacy Circle';
  nameInput.value = 'English Literacy Circle';
  nameLabel.appendChild(nameInput);
  form.appendChild(nameLabel);

  const descriptionLabel = document.createElement('label');
  descriptionLabel.className = 'modal__label';
  descriptionLabel.textContent = 'Description (optional)';
  const descriptionInput = document.createElement('textarea');
  descriptionInput.className = 'modal__input';
  descriptionInput.rows = 2;
  descriptionInput.placeholder = 'e.g. After-school English literacy circle';
  descriptionLabel.appendChild(descriptionInput);
  form.appendChild(descriptionLabel);

  const studentsLabel = document.createElement('div');
  studentsLabel.className = 'modal__label';
  studentsLabel.textContent = 'Students';

  const allStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));
  let selectedIds = new Set();
  const studentSelect = createStudentMultiSelectElement({
    students: allStudents,
    onChange: (newSelection) => {
      selectedIds = newSelection;
    },
  });
  studentsLabel.appendChild(studentSelect);
  form.appendChild(studentsLabel);

  const errorMessage = document.createElement('p');
  errorMessage.className = 'modal__error';
  errorMessage.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create Programme';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';

  function close() {
    overlay.remove();
  }

  createButton.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorMessage.textContent = 'Enter a name for this programme.';
      errorMessage.hidden = false;
      nameInput.focus();
      return;
    }

    onCreate(
      {
        name,
        description: descriptionInput.value.trim(),
        studentIds: Array.from(selectedIds),
        // Phase 2A ships exactly one programme type — see this file's
        // own header comment. A future type-selection UI would set
        // this from a real choice instead of a hardcoded default.
        configuration: DEFAULT_CONFIGURATION_BUILDERS.english_literacy_circle(),
      },
      close
    );
  });

  cancelButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  actions.append(createButton, cancelButton);
  modal.append(heading, description, form, errorMessage, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  nameInput.focus();
}
