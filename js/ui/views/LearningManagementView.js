/**
 * ui/views/LearningManagementView.js
 *
 * Information Architecture milestone: one of ClassMate's three
 * top-level responsibilities — "preparing learning materials and
 * supporting students" — reached via the Dashboard's
 * "📚 Learning Management" card (see ui/views/DashboardView.js),
 * alongside "▶ Classroom Management" (today's class) and
 * "⚙️ Curriculum Management" (occasional admin setup, a separate
 * workspace — see ui/views/CurriculumManagementView.js).
 *
 * This is the renamed, restructured successor to
 * ui/views/CurriculumView.js from the Dashboard Navigation Simplification milestone, which this milestone retires. The
 * biggest change: Learning Management never asks a teacher which
 * curriculum to browse. A classroom already owns one (see
 * models/Classroom.js's `curriculumAssignment` field, set once in
 * Curriculum Management) — this view reads that assignment
 * automatically via
 * services/curriculumLibraryService.js's getAssignedPackForSubject()
 * and loads the matching pack with zero extra clicks. If a classroom
 * has no assignment yet, this falls back to manual Unit/Concept
 * creation automatically — no picker is ever shown for that fallback
 * either; "Curriculum Library vs. Custom Curriculum" is no longer a
 * question a teacher answers, it's a fact about the classroom this
 * view reads.
 *
 * Journey: Learning Management -> Choose Class -> Choose Subject ->
 * directly into the Curriculum Explorer (an accordion of Units, each
 * expandable to its Concepts). Choose Class exists because a teacher
 * may run more than one classroom and this is meant to be their one
 * daily workspace for lesson prep across all of them, not scoped to
 * whichever classroom's Dashboard happened to open it.
 *
 * Clicking a Concept opens the Concept Workspace directly
 * (ui/views/ConceptWorkspaceView.js, completely unchanged) — writing a
 * lesson still happens exactly where it always has: the Workspace's
 * own Resources tab.
 *
 * "Continue Working" (the most recently edited resource, scoped to
 * whichever classroom is currently selected here — see
 * services/resourceService.js's getMostRecentlyEditedResource()) shows
 * above the Explorer once a Subject is chosen, if one exists.
 *
 * Manage Lessons (full syllabus rename/delete/reorder) is still
 * reachable — see the Explorer's "Manage full syllabus" link — for
 * whichever classroom is currently selected here.
 *
 * Self-contained, same pattern as every other view in this feature:
 * no router, no URL, local state only for which step is active.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as resourceService from '../../services/resourceService.js';
import * as curriculumLibraryService from '../../services/curriculumLibraryService.js';
import { getResourceTypeIcon } from '../../config/resourceTypeConfig.js';
import { getDisplayName } from '../../services/classroomService.js';
import { createIcon } from '../components/Icon.js';
import { createCurriculumExplorerPanel } from '../components/CurriculumExplorerPanel.js';
import { renderReadingEditorView } from './ReadingEditorView.js';
import { renderConceptWorkspaceView } from './ConceptWorkspaceView.js';
import { renderLearningRecordView } from './LearningRecordView.js';

export function renderLearningManagementView(container, { classrooms, onBack }) {
  // 'choose-class' (always the entry point), 'choose-subject', or
  // 'explorer' (the combined accordion). Nothing here ever asks which
  // curriculum to use — see this file's header comment.
  let mode = 'choose-class';
  let selectedClassroom = null;
  let selectedSubject = null;
  let source = null; // 'custom' | 'library' — decided automatically, never picked
  let selectedPack = null;
  let loadError = null;
  let expandedUnitId = null;

  function rerender() {
    renderView(
      container,
      mode,
      { classrooms, selectedClassroom, selectedSubject, source, selectedPack, loadError, expandedUnitId },
      {
        onBack,
        onChooseClass: (classroom) => {
          selectedClassroom = classroom;
          mode = 'choose-subject';
          rerender();
        },
        onChooseSubject: async (subject) => {
          selectedSubject = subject;
          loadError = null;
          try {
            selectedPack = await curriculumLibraryService.getAssignedPackForSubject(selectedClassroom, subject.title);
            source = selectedPack ? 'library' : 'custom';
          } catch (error) {
            console.error('[LearningManagementView] Failed to load the assigned curriculum pack:', error);
            source = 'custom';
            loadError = "Couldn't load this class's assigned curriculum, so you're seeing manual Unit/Concept tools instead. Check your connection and try again.";
          }
          expandedUnitId = null;
          mode = 'explorer';
          rerender();
        },
        onToggleUnit: (unitId) => {
          expandedUnitId = expandedUnitId === unitId ? null : unitId;
          rerender();
        },
        onAddCustomUnit: (title) => {
          const unit = learningRecordTeacherService.createUnit(selectedClassroom, selectedSubject.id, { title });
          workspaceService.save(selectedClassroom);
          expandedUnitId = unit.id;
          rerender();
        },
        onAddCustomConcept: (unitId, title) => {
          learningRecordTeacherService.createConcept(selectedClassroom, unitId, { title });
          workspaceService.save(selectedClassroom);
          rerender();
        },
        onOpenCustomConcept: (unit, concept) => {
          openConceptWorkspace(unit, concept);
        },
        onOpenLibraryConcept: (sourceUnit, conceptTitle) => {
          const { unit, concept } = curriculumLibraryService.materializeUnitAndConcept(
            selectedClassroom,
            selectedSubject,
            sourceUnit.title,
            conceptTitle
          );
          workspaceService.save(selectedClassroom);
          openConceptWorkspace(unit, concept);
        },
        onOpenRecentResource: (entry) => openRecentResource(entry),
        onOpenManageLessons: () => {
          renderLearningRecordView(container, {
            classroom: selectedClassroom,
            onClose: rerender,
          });
        },
        onBackTo: (targetMode) => {
          mode = targetMode;
          rerender();
        },
      }
    );
  }

  function openConceptWorkspace(unit, concept, initialResourceId = null) {
    renderConceptWorkspaceView(container, {
      classroom: selectedClassroom,
      subject: selectedSubject,
      unit,
      concept,
      initialResourceId,
      onBack: rerender,
    });
  }

  function openRecentResource({ resource, unit, concept }) {
    if (resource.type === 'reading') {
      renderReadingEditorView(container, {
        classroom: selectedClassroom,
        resource,
        onBack: () => openConceptWorkspace(unit, concept, resource.id),
      });
    } else {
      openConceptWorkspace(unit, concept, resource.id);
    }
  }

  rerender();
}

function renderView(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'learning-management__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append(mode === 'choose-class' ? 'Back to Dashboard' : 'Back');
  backButton.addEventListener('click', () => {
    if (mode === 'choose-class') return handlers.onBack();
    const previous = { 'choose-subject': 'choose-class', explorer: 'choose-subject' }[mode];
    handlers.onBackTo(previous);
  });
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = '\ud83d\udcda Learning Management';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'choose-subject') {
    wrapper.appendChild(renderChooseSubjectStep(state.selectedClassroom, handlers));
  } else if (mode === 'explorer') {
    wrapper.appendChild(renderExplorerStep(state, handlers));
  } else {
    wrapper.appendChild(renderChooseClassStep(state.classrooms, handlers));
  }

  container.appendChild(wrapper);
}

// ---- Choose Class (new entry point) -----------------------------------

function renderChooseClassStep(classrooms, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = 'Choose Class';
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'learning-management__choice-grid';
  classrooms.forEach((classroom) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'learning-management__choice-option';
    button.textContent = getDisplayName(classroom);
    button.addEventListener('click', () => handlers.onChooseClass(classroom));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

// ---- Choose Subject (within the chosen class) --------------------------

function renderChooseSubjectStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = `Choose Subject \u2014 ${getDisplayName(classroom)}`;
  section.appendChild(heading);

  const subjects = learningRecordService.getSubjects(classroom);
  if (subjects.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'learning-management__choice-grid';
    subjects.forEach((subject) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'learning-management__choice-option';
      button.textContent = subject.title;
      button.addEventListener('click', () => handlers.onChooseSubject(subject));
      grid.appendChild(button);
    });
    section.appendChild(grid);
  }

  section.appendChild(
    createInlineAddForm('New subject name (e.g. Science)', '+ Add Subject', (title) => {
      const subject = learningRecordTeacherService.createSubject(classroom, { title });
      workspaceService.save(classroom);
      handlers.onChooseSubject(subject);
    })
  );

  return section;
}

// ---- The Curriculum Explorer: one screen, an accordion of Units ------

function renderExplorerStep(state, handlers) {
  const { selectedClassroom, selectedSubject, source, selectedPack, loadError, expandedUnitId } = state;
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  if (loadError) {
    const error = document.createElement('p');
    error.className = 'learning-management__error';
    error.textContent = loadError;
    section.appendChild(error);
  }

  const recentResource = resourceService.getMostRecentlyEditedResource(selectedClassroom);
  if (recentResource) {
    section.appendChild(renderContinueWorkingCard(recentResource, handlers));
  }

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = `Curriculum Explorer \u2014 ${selectedSubject.title}`;
  section.appendChild(heading);

  // Normalize into the one shape ui/components/CurriculumExplorerPanel.js
  // expects, regardless of whether this data came from a library pack
  // (plain concept-title strings) or the classroom's own real
  // LearningConcept objects — "reuse the existing Curriculum Explorer,
  // do not create another viewer."
  const normalizedUnits =
    source === 'library'
      ? selectedPack.units.map((sourceUnit) => ({
          id: sourceUnit.id,
          title: sourceUnit.title,
          concepts: sourceUnit.concepts.map((conceptTitle) => ({
            id: conceptTitle,
            title: conceptTitle,
            onClick: () => handlers.onOpenLibraryConcept(sourceUnit, conceptTitle),
          })),
        }))
      : selectedSubject.units.map((unit) => ({
          id: unit.id,
          title: unit.title,
          concepts: unit.concepts.map((concept) => ({
            id: concept.id,
            title: concept.title,
            onClick: () => handlers.onOpenCustomConcept(unit, concept),
          })),
        }));

  section.appendChild(
    createCurriculumExplorerPanel({
      units: normalizedUnits,
      expandedUnitId,
      onToggleUnit: handlers.onToggleUnit,
    })
  );

  if (source === 'custom') {
    const expandedUnit = selectedSubject.units.find((u) => u.id === expandedUnitId);
    if (expandedUnit) {
      section.appendChild(
        createInlineAddForm(`New concept in ${expandedUnit.title}`, '+ Add Concept', (title) =>
          handlers.onAddCustomConcept(expandedUnit.id, title)
        )
      );
    }
    section.appendChild(
      createInlineAddForm('New unit name (e.g. Force and Pressure)', '+ Add Unit', (title) => handlers.onAddCustomUnit(title))
    );
  }

  const manageLessonsLink = document.createElement('button');
  manageLessonsLink.type = 'button';
  manageLessonsLink.className = 'btn btn--text learning-management__manage-lessons-link';
  manageLessonsLink.textContent = 'Need to rename, delete, or reorganize? Manage full syllabus \u2192';
  manageLessonsLink.addEventListener('click', handlers.onOpenManageLessons);
  section.appendChild(manageLessonsLink);

  return section;
}

function renderContinueWorkingCard(recentResource, handlers) {
  const { resource, concept, subject } = recentResource;
  const wrap = document.createElement('div');
  wrap.className = 'learning-management__continue-working';

  const label = document.createElement('p');
  label.className = 'learning-management__continue-working-label';
  label.textContent = 'Continue Working';
  wrap.appendChild(label);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'learning-management__continue-card';
  card.appendChild(createIcon(getResourceTypeIcon(resource.type), { size: 22 }));
  const text = document.createElement('span');
  text.className = 'learning-management__continue-text';
  const titleEl = document.createElement('span');
  titleEl.className = 'learning-management__continue-title';
  titleEl.textContent = resource.title;
  const metaEl = document.createElement('span');
  metaEl.className = 'learning-management__continue-meta';
  metaEl.textContent = `${concept.title} \u00b7 ${subject.title}`;
  text.append(titleEl, metaEl);
  card.appendChild(text);
  card.addEventListener('click', () => handlers.onOpenRecentResource(recentResource));
  wrap.appendChild(card);

  return wrap;
}

// ---- Shared small helper ----------------------------------------------

function createInlineAddForm(placeholder, buttonLabel, onAdd) {
  const form = document.createElement('div');
  form.className = 'learning-management__inline-add-form';

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
