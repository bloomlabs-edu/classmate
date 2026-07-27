/**
 * ui/views/LearningRecordView.js
 *
 * The teacher-facing Learning Record screen — Phase 2 of Milestone 3
 * (see docs/LEARNING_RECORD.md for the full architecture this sits on
 * top of). Three drill-down levels sharing one route
 * (#/classroom/{id}/learning-record/{subjectId?}/{unitId?} — see
 * ui/router.js):
 *
 *   subjectId absent            -> Subject list
 *   subjectId present, no unit  -> that Subject's Unit list
 *   subjectId + unitId present  -> that Unit's Concept list, with
 *                                  each concept's taught/not-taught
 *                                  toggle
 *
 * Add/Edit/Delete at every level. No taught/not-taught control exists
 * above the Concept level — a Subject or Unit has no status of its
 * own, only its concepts do (see models/LearningConcept.js).
 *
 * Everything here goes through learningRecordTeacherService.js only —
 * never learningRecordStudentService.js — matching the structural
 * teacher/student split documented in docs/LEARNING_RECORD.md. No
 * student-facing UI, no Learning Hub reference, and no analytics
 * beyond the plain "X of Y taught" count already exposed by
 * learningRecordService.js — all deliberately out of scope for this
 * phase.
 *
 * Same mutate-then-save-then-rerender convention as
 * ui/views/SettingsView.js: every action calls a
 * learningRecordTeacherService.js function, then
 * workspaceService.save(classroom), then rerender().
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import { CONCEPT_STATUS_LABELS } from '../../config/learningRecordConfig.js';
import { createIcon } from '../components/Icon.js';

export function renderLearningRecordView(container, { classroom, subjectId, unitId, onNavigate, onBack }) {
  container.innerHTML = '';

  const rerender = () => renderLearningRecordView(container, { classroom, subjectId, unitId, onNavigate, onBack });

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-record-view';

  const header = document.createElement('header');
  header.className = 'wizard-step-header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));

  let title = 'Learning Record';
  const subject = subjectId ? learningRecordService.getSubjectById(classroom, subjectId) : null;
  const unit = unitId ? learningRecordService.getUnitById(classroom, unitId) : null;

  if (unit && subject) {
    backButton.append('Back to ' + subject.title);
    backButton.addEventListener('click', () => onNavigate(subjectId, null));
    title = `${subject.title} \u203a ${unit.title}`;
  } else if (subject) {
    backButton.append('Back to Learning Record');
    backButton.addEventListener('click', () => onNavigate(null, null));
    title = subject.title;
  } else {
    backButton.append('Back to Dashboard');
    backButton.addEventListener('click', onBack);
  }

  const titleEl = document.createElement('h1');
  titleEl.className = 'wizard-step-header__title';
  titleEl.textContent = title;

  header.append(backButton, titleEl);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'settings-content';

  if (unit && subject) {
    renderConceptsLevel(content, classroom, subject, unit, rerender);
  } else if (subject) {
    renderUnitsLevel(content, classroom, subject, rerender, onNavigate);
  } else {
    renderSubjectsLevel(content, classroom, rerender, onNavigate);
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

// ---- Level 1: Subjects --------------------------------------------

function renderSubjectsLevel(content, classroom, rerender, onNavigate) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const intro = document.createElement('p');
  intro.className = 'wizard-step__intro';
  intro.textContent = 'Build your syllabus: Subjects, then Units within each subject, then Concepts within each unit.';
  section.appendChild(intro);

  const subjects = learningRecordService.getSubjects(classroom);

  if (subjects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'No subjects yet \u2014 add your first one below (e.g. Science, Maths, English, Social Science).';
    section.appendChild(empty);
  }

  const list = document.createElement('ul');
  list.className = 'settings-editable-list';

  subjects.forEach((subject) => {
    const item = document.createElement('li');
    item.className = 'settings-editable-list__item';

    const input = createRenameInput(subject.title, (newTitle) => {
      learningRecordTeacherService.renameSubject(classroom, subject.id, newTitle);
      workspaceService.save(classroom);
    });

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'btn btn--ghost';
    openButton.textContent = 'Open Units';
    openButton.addEventListener('click', () => onNavigate(subject.id, null));

    const removeButton = createRemoveButton(`Delete "${subject.title}"? Its units and concepts will be deleted too.`, () => {
      learningRecordTeacherService.deleteSubject(classroom, subject.id);
      workspaceService.save(classroom);
      rerender();
    });

    item.append(input, openButton, removeButton);
    list.appendChild(item);
  });

  section.appendChild(list);
  section.appendChild(
    createAddForm('New subject name', 'Add Subject', (title) => {
      learningRecordTeacherService.createSubject(classroom, { title });
      workspaceService.save(classroom);
      rerender();
    })
  );

  content.appendChild(section);
}

// ---- Level 2: Units within a Subject -------------------------------

function renderUnitsLevel(content, classroom, subject, rerender, onNavigate) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const intro = document.createElement('p');
  intro.className = 'wizard-step__intro';
  intro.textContent = `Units within ${subject.title}.`;
  section.appendChild(intro);

  if (subject.units.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'No units yet \u2014 add one below (e.g. Force and Pressure).';
    section.appendChild(empty);
  }

  const list = document.createElement('ul');
  list.className = 'settings-editable-list';

  subject.units.forEach((unit) => {
    const item = document.createElement('li');
    item.className = 'settings-editable-list__item';

    const input = createRenameInput(unit.title, (newTitle) => {
      learningRecordTeacherService.renameUnit(classroom, unit.id, newTitle);
      workspaceService.save(classroom);
    });

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'btn btn--ghost';
    openButton.textContent = 'Open Concepts';
    openButton.addEventListener('click', () => onNavigate(subject.id, unit.id));

    const removeButton = createRemoveButton(`Delete "${unit.title}"? Its concepts will be deleted too.`, () => {
      learningRecordTeacherService.deleteUnit(classroom, subject.id, unit.id);
      workspaceService.save(classroom);
      rerender();
    });

    item.append(input, openButton, removeButton);
    list.appendChild(item);
  });

  section.appendChild(list);
  section.appendChild(
    createAddForm('New unit name', 'Add Unit', (title) => {
      learningRecordTeacherService.createUnit(classroom, subject.id, { title });
      workspaceService.save(classroom);
      rerender();
    })
  );

  content.appendChild(section);
}

// ---- Level 3: Concepts within a Unit --------------------------------

function renderConceptsLevel(content, classroom, subject, unit, rerender) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const taughtCount = unit.concepts.filter((concept) => concept.status === 'taught').length;
  const intro = document.createElement('p');
  intro.className = 'wizard-step__intro';
  intro.textContent =
    unit.concepts.length > 0
      ? `Concepts within ${unit.title} \u2014 ${taughtCount} of ${unit.concepts.length} taught.`
      : `Concepts within ${unit.title}.`;
  section.appendChild(intro);

  if (unit.concepts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'No concepts yet \u2014 add one below (e.g. Force, Pressure, Friction, Viscosity).';
    section.appendChild(empty);
  }

  const list = document.createElement('ul');
  list.className = 'settings-editable-list';

  unit.concepts.forEach((concept) => {
    const item = document.createElement('li');
    item.className = 'settings-editable-list__item learning-record-concept-row';

    const input = createRenameInput(concept.title, (newTitle) => {
      learningRecordTeacherService.renameConcept(classroom, concept.id, newTitle);
      workspaceService.save(classroom);
    });

    const taughtToggle = document.createElement('button');
    taughtToggle.type = 'button';
    const isTaught = concept.status === 'taught';
    taughtToggle.className = 'learning-record-taught-toggle' + (isTaught ? ' learning-record-taught-toggle--taught' : '');
    taughtToggle.textContent = CONCEPT_STATUS_LABELS[concept.status] || CONCEPT_STATUS_LABELS.not_taught;
    taughtToggle.addEventListener('click', () => {
      const newStatus = isTaught ? 'not_taught' : 'taught';
      learningRecordTeacherService.setConceptTaughtStatus(classroom, concept.id, newStatus);
      workspaceService.save(classroom);
      rerender();
    });

    const removeButton = createRemoveButton(`Delete "${concept.title}"?`, () => {
      learningRecordTeacherService.deleteConcept(classroom, unit.id, concept.id);
      workspaceService.save(classroom);
      rerender();
    });

    item.append(input, taughtToggle, removeButton);
    list.appendChild(item);
  });

  section.appendChild(list);
  section.appendChild(
    createAddForm('New concept name', 'Add Concept', (title) => {
      learningRecordTeacherService.createConcept(classroom, unit.id, { title });
      workspaceService.save(classroom);
      rerender();
    })
  );

  content.appendChild(section);
}

// ---- Shared small helpers -------------------------------------------

function createRenameInput(value, onRename) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => {
    const newValue = input.value.trim();
    if (!newValue) {
      input.value = value;
      return;
    }
    onRename(newValue);
  });
  return input;
}

function createRemoveButton(confirmMessage, onConfirmed) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--text btn--danger-text';
  button.textContent = 'Delete';
  button.addEventListener('click', () => {
    if (!window.confirm(confirmMessage)) return;
    onConfirmed();
  });
  return button;
}

function createAddForm(placeholder, buttonLabel, onAdd) {
  const form = document.createElement('div');
  form.className = 'settings-add-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--ghost';
  button.textContent = buttonLabel;
  button.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) return;
    onAdd(value);
    input.value = '';
  });

  form.append(input, button);
  return form;
}
