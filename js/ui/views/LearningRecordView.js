/**
 * ui/views/LearningRecordView.js
 *
 * The Learning Record screen — Subjects, each with Units, each with
 * Lessons (Concepts), each markable Taught / Not Taught. Add/Rename/
 * Delete at every level. Nothing else — no analytics, no percentages,
 * no student-facing content, no Learning Hub reference, by explicit
 * instruction (see this project's CHANGELOG for the full history of
 * this feature's UI integration).
 *
 * Deliberately self-contained: this file owns its own drill-down
 * state (which subject/unit is open) as plain local variables in a
 * closure, re-rendering itself into the same container on every
 * change. No router, no URL, no route dispatch, and no callback
 * threading beyond the one `onClose` this file is handed — by
 * explicit instruction, after this feature's entry point broke twice
 * in a row on router/dispatch wiring. There is nothing here that can
 * be "missing from an allow-list somewhere else"; every transition in
 * this screen is a direct function call within this one file.
 *
 * Reached by calling renderLearningRecordView(container, { classroom,
 * onClose }) directly — see ui/views/DashboardView.js's "Manage
 * Lessons" button, which is the only caller. `onClose` re-renders
 * whatever was on screen before (the Dashboard); this file has no
 * opinion about what that is.
 *
 * Every mutation goes through learningRecordTeacherService.js only —
 * never learningRecordStudentService.js — matching the structural
 * teacher/student split documented in docs/LEARNING_RECORD.md.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import { createIcon } from '../components/Icon.js';
import { createSubjectPickerElement } from '../components/SubjectPicker.js';
import { renderConceptWorkspaceView, createTaughtToggle } from './ConceptWorkspaceView.js';
import { renderAddConceptsView } from './AddConceptsView.js';

const DEFAULT_SUBJECT_NAMES = ['Science', 'Maths', 'English', 'Social Science'];

/**
 * A brand-new classroom's Learning Record starts completely empty.
 * Rather than showing a bare "no subjects yet" screen the very first
 * time a teacher opens this, seed the four subjects every Teach For
 * India classroom already has, so the initial screen matches exactly
 * what's expected — Science / Maths / English / Social Science, each
 * ready for its own Units. This only ever runs once: after the first
 * subject exists (whether one of these four or a teacher's own),
 * nothing here runs again.
 */
function ensureDefaultSubjects(classroom) {
  if (learningRecordService.getSubjects(classroom).length > 0) return false;
  DEFAULT_SUBJECT_NAMES.forEach((title) => learningRecordTeacherService.createSubject(classroom, { title }));
  return true;
}

export function renderLearningRecordView(container, { classroom, onClose }) {
  // Local, in-memory drill-down state — not the URL, not a route
  // param. See this file's header comment for why.
  let openSubjectId = null;
  let openUnitId = null;

  if (ensureDefaultSubjects(classroom)) {
    workspaceService.save(classroom);
  }

  function rerender() {
    renderScreen(container, classroom, openSubjectId, openUnitId, {
      onClose,
      onOpenSubject: (subjectId) => {
        openSubjectId = subjectId;
        openUnitId = null;
        rerender();
      },
      onOpenUnit: (unitId) => {
        openUnitId = unitId;
        rerender();
      },
      onBackToSubjects: () => {
        openSubjectId = null;
        openUnitId = null;
        rerender();
      },
      onBackToUnits: () => {
        openUnitId = null;
        rerender();
      },
      rerender,
    });
  }

  rerender();
}

function renderScreen(container, classroom, openSubjectId, openUnitId, handlers) {
  container.innerHTML = '';

  const subject = openSubjectId ? learningRecordService.getSubjectById(classroom, openSubjectId) : null;
  const unit = openUnitId ? learningRecordService.getUnitById(classroom, openUnitId) : null;

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-record-view';

  const header = document.createElement('header');
  header.className = 'learning-record-view__header';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--text';
  closeButton.appendChild(createIcon('arrow-left'));
  closeButton.append('Back to Dashboard');
  closeButton.addEventListener('click', handlers.onClose);
  header.appendChild(closeButton);

  const title = document.createElement('h1');
  title.className = 'learning-record-view__title';
  title.textContent = 'Learning Record';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (unit && subject) {
    const breadcrumb = document.createElement('p');
    breadcrumb.className = 'learning-record-view__breadcrumb';
    const backToSubjects = document.createElement('button');
    backToSubjects.type = 'button';
    backToSubjects.className = 'btn btn--text';
    backToSubjects.textContent = 'Subjects';
    backToSubjects.addEventListener('click', handlers.onBackToSubjects);
    breadcrumb.appendChild(backToSubjects);
    breadcrumb.append(' \u203a ' + subject.title + ' \u203a ' + unit.title);
    wrapper.appendChild(breadcrumb);

    wrapper.appendChild(renderLessonsLevel(container, classroom, subject, unit, handlers));
  } else if (subject) {
    const breadcrumb = document.createElement('p');
    breadcrumb.className = 'learning-record-view__breadcrumb';
    const backToSubjects = document.createElement('button');
    backToSubjects.type = 'button';
    backToSubjects.className = 'btn btn--text';
    backToSubjects.textContent = 'Subjects';
    backToSubjects.addEventListener('click', handlers.onBackToSubjects);
    breadcrumb.appendChild(backToSubjects);
    breadcrumb.append(' \u203a ' + subject.title);
    wrapper.appendChild(breadcrumb);

    wrapper.appendChild(renderUnitsLevel(classroom, subject, handlers));
  } else {
    wrapper.appendChild(renderSubjectsLevel(classroom, handlers));
  }

  container.appendChild(wrapper);
}

// ---- Subjects -------------------------------------------------------

function renderSubjectsLevel(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-record-view__section';

  const subjects = learningRecordService.getSubjects(classroom);

  subjects.forEach((subj) => {
    section.appendChild(renderSubjectBlock(classroom, subj, handlers));
  });

  section.appendChild(
    createSubjectPickerElement({
      existingSubjectTitles: subjects.map((subj) => subj.title),
      onAddSubject: (title) => {
        learningRecordTeacherService.createSubject(classroom, { title });
        workspaceService.save(classroom);
        handlers.rerender();
      },
    })
  );

  return section;
}

function renderSubjectBlock(classroom, subj, handlers) {
  const block = document.createElement('div');
  block.className = 'learning-record-view__subject-block';

  const row = document.createElement('div');
  row.className = 'learning-record-view__row';

  const input = createRenameInput(subj.title, (newTitle) => {
    learningRecordTeacherService.renameSubject(classroom, subj.id, newTitle);
    workspaceService.save(classroom);
  });
  input.classList.add('learning-record-view__subject-name');

  const openUnitsButton = document.createElement('button');
  openUnitsButton.type = 'button';
  openUnitsButton.className = 'btn btn--primary';
  openUnitsButton.textContent = '+ Add Unit';
  openUnitsButton.addEventListener('click', () => handlers.onOpenSubject(subj.id));

  const removeButton = createRemoveButton(`Delete "${subj.title}"? Its units and lessons will be deleted too.`, () => {
    learningRecordTeacherService.deleteSubject(classroom, subj.id);
    workspaceService.save(classroom);
    handlers.rerender();
  });

  row.append(input, openUnitsButton, removeButton);
  block.appendChild(row);

  if (subj.units.length > 0) {
    const unitList = document.createElement('ul');
    unitList.className = 'learning-record-view__unit-preview-list';
    subj.units.forEach((u) => {
      const item = document.createElement('li');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'learning-record-view__unit-preview-link';
      link.textContent = u.title;
      link.addEventListener('click', () => handlers.onOpenSubject(subj.id));
      item.appendChild(link);
      unitList.appendChild(item);
    });
    block.appendChild(unitList);
  }

  return block;
}

// ---- Units -----------------------------------------------------------

function renderUnitsLevel(classroom, subject, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-record-view__section';

  subject.units.forEach((unit) => {
    const row = document.createElement('div');
    row.className = 'learning-record-view__row';

    const input = createRenameInput(unit.title, (newTitle) => {
      learningRecordTeacherService.renameUnit(classroom, unit.id, newTitle);
      workspaceService.save(classroom);
    });

    const openLessonsButton = document.createElement('button');
    openLessonsButton.type = 'button';
    openLessonsButton.className = 'btn btn--primary';
    openLessonsButton.textContent = '+ Add Lesson';
    openLessonsButton.addEventListener('click', () => handlers.onOpenUnit(unit.id));

    const removeButton = createRemoveButton(`Delete "${unit.title}"? Its lessons will be deleted too.`, () => {
      learningRecordTeacherService.deleteUnit(classroom, subject.id, unit.id);
      workspaceService.save(classroom);
      handlers.rerender();
    });

    row.append(input, openLessonsButton, removeButton);
    section.appendChild(row);
  });

  section.appendChild(
    createAddForm('New unit name', '+ Add Unit', (title) => {
      learningRecordTeacherService.createUnit(classroom, subject.id, { title });
      workspaceService.save(classroom);
      handlers.rerender();
    })
  );

  return section;
}

// ---- Lessons (Concepts) ------------------------------------------------

function renderLessonsLevel(container, classroom, subject, unit, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-record-view__section';

  unit.concepts.forEach((concept) => {
    const row = document.createElement('div');
    row.className = 'learning-record-view__row';

    // Milestone 1: the Concept Workspace — see ConceptWorkspaceView.js,
    // now the permanent home for every concept-related feature.
    // Deliberately a separate button from the rename input rather than
    // making the title itself clickable, for the same reason
    // AvatarDisplay/name-links elsewhere in this app avoid overloading
    // a click target that's already used for something else (here,
    // editing).
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'learning-record-view__open-workspace-button';
    openButton.appendChild(createIcon('arrow-right', { size: 16 }));
    openButton.setAttribute('aria-label', `Open ${concept.title} workspace`);
    openButton.addEventListener('click', () => {
      renderConceptWorkspaceView(container, {
        classroom,
        subject,
        unit,
        concept,
        onBack: handlers.rerender,
      });
    });

    const input = createRenameInput(concept.title, (newTitle) => {
      learningRecordTeacherService.renameConcept(classroom, concept.id, newTitle);
      workspaceService.save(classroom);
    });

    const taughtToggle = createTaughtToggle(classroom, concept, () => {
      workspaceService.save(classroom);
      handlers.rerender();
    });

    const removeButton = createRemoveButton(`Delete "${concept.title}"?`, () => {
      learningRecordTeacherService.deleteConcept(classroom, unit.id, concept.id);
      workspaceService.save(classroom);
      handlers.rerender();
    });

    row.append(openButton, input, taughtToggle, removeButton);
    section.appendChild(row);
  });

  section.appendChild(
    createAddForm('New lesson name (e.g. Friction)', '+ Add Lesson', (title) => {
      learningRecordTeacherService.createConcept(classroom, unit.id, { title });
      workspaceService.save(classroom);
      handlers.rerender();
    })
  );

  // Bulk import — Curriculum Library v1 (see ui/views/AddConceptsView.js).
  // A separate, distinct action from the single "+ Add Lesson" form
  // above: that one is for typing a single concept by hand; this one
  // is for importing a whole chapter's worth at once.
  const addConceptsButton = document.createElement('button');
  addConceptsButton.type = 'button';
  addConceptsButton.className = 'btn btn--primary learning-record-view__add-concepts-button';
  addConceptsButton.appendChild(createIcon('graduation-cap', { size: 16 }));
  addConceptsButton.append(' Add Concepts');
  addConceptsButton.addEventListener('click', () => {
    renderAddConceptsView(container, {
      classroom,
      unit,
      onBack: handlers.rerender,
    });
  });
  section.appendChild(addConceptsButton);

  return section;
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
  form.className = 'learning-record-view__add-form';

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
  });

  form.append(input, button);
  return form;
}
