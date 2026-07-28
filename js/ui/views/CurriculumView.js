/**
 * ui/views/CurriculumView.js
 *
 * Dashboard Navigation Simplification: the single entry point for all
 * curriculum work, replacing three previously-separate things —
 * "📚 Manage Lessons," "✏️ Create Lesson," and the Dashboard's
 * "Continue Working" section — with one "📚 Curriculum" button (see
 * ui/views/DashboardView.js). This is a UX consolidation, not new
 * functionality: every capability here already existed somewhere;
 * this file is where they now share one door.
 *
 * Journey: Curriculum -> Choose Subject -> Choose Curriculum (Library
 * or Custom) -> directly into the Curriculum Explorer — one screen,
 * an accordion of Units each expandable to its Concepts, not a
 * separate full-screen step per Unit. Clicking a Concept opens the
 * Concept Workspace directly (ui/views/ConceptWorkspaceView.js,
 * completely unchanged) — there is no "name your lesson" step
 * anymore. Writing a lesson still happens exactly where it always
 * has: the Workspace's own Resources tab. This file's only job is
 * getting a teacher to a Concept with the fewest possible clicks, not
 * authoring content.
 *
 * "Continue Working" (the classroom's single most recently edited
 * resource, regardless of subject — see
 * services/resourceService.js's getMostRecentlyEditedResource())
 * shows above the Explorer once a Subject is chosen, if one exists.
 * Clicking it opens that resource's editor directly (Reading, today)
 * or the Concept Workspace as a fallback for a type with no editor
 * yet — the exact same behavior this had on the Dashboard before,
 * just relocated, not changed.
 *
 * Custom Curriculum keeps its manual "+ Add Unit"/"+ Add Concept"
 * forms, now inline in the Explorer's accordion rather than as
 * separate steps. Curriculum Library stays pure browsing — no
 * add-forms anywhere in that branch — with the same
 * materializeUnitAndConcept() find-or-create-by-title behavior as
 * before, so browsing the same concept twice never creates a
 * duplicate.
 *
 * Manage Lessons (full syllabus rename/delete/reorder) is still
 * reachable — see the Explorer's "Manage full syllabus" link — just
 * no longer its own Dashboard button.
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
import { createIcon } from '../components/Icon.js';
import { renderReadingEditorView } from './ReadingEditorView.js';
import { renderConceptWorkspaceView } from './ConceptWorkspaceView.js';

export function renderCurriculumView(container, { classroom, onBack, onOpenManageLessons }) {
  // 'choose-subject' (always the entry point), 'choose-curriculum-mode',
  // 'choose-cl-curriculum', 'choose-cl-grade', 'choose-cl-subject', or
  // 'explorer' (the combined accordion, reached for either source).
  let mode = 'choose-subject';
  let selectedSubject = null;
  let source = null; // 'custom' | 'library'
  let selectedCurriculum = null;
  let selectedGrade = null;
  let selectedPack = null;
  let loadError = null;
  let expandedUnitId = null; // accordion state — one open at a time

  function rerender() {
    renderView(
      container,
      mode,
      { classroom, selectedSubject, source, selectedCurriculum, selectedGrade, selectedPack, loadError, expandedUnitId },
      {
        onBack,
        onOpenManageLessons,
        onChooseSubject: (subject) => {
          selectedSubject = subject;
          mode = 'choose-curriculum-mode';
          rerender();
        },
        onPickCustomCurriculum: () => {
          source = 'custom';
          expandedUnitId = null;
          mode = 'explorer';
          rerender();
        },
        onPickCurriculumLibrary: () => {
          loadError = null;
          mode = 'choose-cl-curriculum';
          rerender();
        },
        onChooseCurriculum: (curriculum) => {
          selectedCurriculum = curriculum;
          mode = 'choose-cl-grade';
          rerender();
        },
        onChooseGrade: (grade) => {
          selectedGrade = grade;
          mode = 'choose-cl-subject';
          rerender();
        },
        onChooseSubjectEntry: async (subjectEntry) => {
          loadError = null;
          try {
            selectedPack = await curriculumLibraryService.getPack(subjectEntry.packFile);
          } catch (error) {
            console.error('[CurriculumView] Failed to load curriculum pack:', error);
            loadError = "Couldn't load this subject's units. Check your connection and try again.";
          }
          source = 'library';
          expandedUnitId = null;
          mode = 'explorer';
          rerender();
        },
        onToggleUnit: (unitId) => {
          expandedUnitId = expandedUnitId === unitId ? null : unitId;
          rerender();
        },
        onAddCustomUnit: (title) => {
          const unit = learningRecordTeacherService.createUnit(classroom, selectedSubject.id, { title });
          workspaceService.save(classroom);
          expandedUnitId = unit.id;
          rerender();
        },
        onAddCustomConcept: (unitId, title) => {
          learningRecordTeacherService.createConcept(classroom, unitId, { title });
          workspaceService.save(classroom);
          rerender();
        },
        onOpenCustomConcept: (unit, concept) => {
          openConceptWorkspace(selectedSubject, unit, concept);
        },
        onOpenLibraryConcept: (sourceUnit, conceptTitle) => {
          const { unit, concept } = curriculumLibraryService.materializeUnitAndConcept(
            classroom,
            selectedSubject,
            sourceUnit.title,
            conceptTitle
          );
          workspaceService.save(classroom);
          openConceptWorkspace(selectedSubject, unit, concept);
        },
        onOpenRecentResource: (entry) => openRecentResource(entry),
        onBackTo: (targetMode) => {
          mode = targetMode;
          rerender();
        },
      }
    );
  }

  function openConceptWorkspace(subject, unit, concept, initialResourceId = null) {
    renderConceptWorkspaceView(container, {
      classroom,
      subject,
      unit,
      concept,
      initialResourceId,
      onBack: rerender, // back to wherever the Explorer was, not the Dashboard
    });
  }

  // Same behavior the Dashboard's own "Continue Working" shortcut had
  // before this milestone relocated it here — see this file's header
  // comment.
  function openRecentResource({ resource, subject, unit, concept }) {
    if (resource.type === 'reading') {
      renderReadingEditorView(container, {
        classroom,
        resource,
        onBack: () => openConceptWorkspace(subject, unit, concept, resource.id),
      });
    } else {
      openConceptWorkspace(subject, unit, concept, resource.id);
    }
  }

  rerender();
}

function renderView(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'curriculum-view';

  const header = document.createElement('header');
  header.className = 'curriculum-view__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append(mode === 'choose-subject' ? 'Back to Dashboard' : 'Back');
  backButton.addEventListener('click', () => {
    if (mode === 'choose-subject') return handlers.onBack();
    const previous = {
      'choose-curriculum-mode': 'choose-subject',
      'choose-cl-curriculum': 'choose-curriculum-mode',
      'choose-cl-grade': 'choose-cl-curriculum',
      'choose-cl-subject': 'choose-cl-grade',
      explorer: state.source === 'library' ? 'choose-cl-subject' : 'choose-curriculum-mode',
    }[mode];
    handlers.onBackTo(previous);
  });
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'curriculum-view__title';
  title.textContent = '\ud83d\udcda Curriculum';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'choose-curriculum-mode') {
    wrapper.appendChild(renderChooseCurriculumModeStep(state.selectedSubject, handlers));
  } else if (mode === 'choose-cl-curriculum') {
    wrapper.appendChild(renderCLCurriculumStep(handlers));
  } else if (mode === 'choose-cl-grade') {
    wrapper.appendChild(renderCLGradeStep(state.selectedCurriculum, handlers));
  } else if (mode === 'choose-cl-subject') {
    wrapper.appendChild(renderCLSubjectStep(state.selectedGrade, handlers));
  } else if (mode === 'explorer') {
    wrapper.appendChild(renderExplorerStep(state, handlers));
  } else {
    wrapper.appendChild(renderChooseSubjectStep(state.classroom, handlers));
  }

  container.appendChild(wrapper);
}

// ---- Choose Subject (entry point, always) --------------------------

function renderChooseSubjectStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-view__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-view__step-heading';
  heading.textContent = 'Choose Subject';
  section.appendChild(heading);

  const subjects = learningRecordService.getSubjects(classroom);
  if (subjects.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'curriculum-view__choice-grid';
    subjects.forEach((subject) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'curriculum-view__choice-option';
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

// ---- Choose Curriculum (Library vs Custom) --------------------------

function renderChooseCurriculumModeStep(subject, handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-view__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-view__step-heading';
  heading.textContent = `Choose Curriculum \u2014 ${subject.title}`;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'curriculum-view__mode-grid';

  const libraryOption = document.createElement('button');
  libraryOption.type = 'button';
  libraryOption.className = 'curriculum-view__mode-option';
  libraryOption.appendChild(createIcon('graduation-cap', { size: 24 }));
  const libraryText = document.createElement('span');
  libraryText.className = 'curriculum-view__mode-text';
  const libraryTitle = document.createElement('span');
  libraryTitle.className = 'curriculum-view__mode-title';
  libraryTitle.textContent = 'Curriculum Library';
  const librarySubtitle = document.createElement('span');
  librarySubtitle.className = 'curriculum-view__mode-subtitle';
  librarySubtitle.textContent = 'Samacheer Kalvi';
  libraryText.append(libraryTitle, librarySubtitle);
  libraryOption.appendChild(libraryText);
  libraryOption.addEventListener('click', handlers.onPickCurriculumLibrary);
  grid.appendChild(libraryOption);

  const customOption = document.createElement('button');
  customOption.type = 'button';
  customOption.className = 'curriculum-view__mode-option';
  customOption.appendChild(createIcon('palette', { size: 24 }));
  const customText = document.createElement('span');
  customText.className = 'curriculum-view__mode-text';
  const customTitle = document.createElement('span');
  customTitle.className = 'curriculum-view__mode-title';
  customTitle.textContent = '\u2728 Custom Curriculum';
  const customSubtitle = document.createElement('span');
  customSubtitle.className = 'curriculum-view__mode-subtitle';
  customSubtitle.textContent = 'Create your own Units and Concepts';
  customText.append(customTitle, customSubtitle);
  customOption.appendChild(customText);
  customOption.addEventListener('click', handlers.onPickCustomCurriculum);
  grid.appendChild(customOption);

  section.appendChild(grid);
  return section;
}

// ---- Curriculum Library's own Curriculum/Grade/Subject picks --------

function renderCLCurriculumStep(handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-view__section';
  const heading = document.createElement('p');
  heading.className = 'curriculum-view__step-heading';
  heading.textContent = 'Choose a Curriculum';
  section.appendChild(heading);

  const listEl = document.createElement('div');
  listEl.className = 'curriculum-view__choice-grid';
  listEl.textContent = 'Loading\u2026';
  section.appendChild(listEl);

  curriculumLibraryService
    .getCurricula()
    .then((curricula) => {
      listEl.innerHTML = '';
      curricula.forEach((curriculum) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'curriculum-view__choice-option';
        button.textContent = curriculum.name;
        button.addEventListener('click', () => handlers.onChooseCurriculum(curriculum));
        listEl.appendChild(button);
      });
    })
    .catch((error) => {
      console.error('[CurriculumView] Failed to load curricula:', error);
      listEl.textContent = "Couldn't load the Curriculum Library. Check your connection and try again.";
    });

  return section;
}

function renderCLGradeStep(curriculum, handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-view__section';
  const heading = document.createElement('p');
  heading.className = 'curriculum-view__step-heading';
  heading.textContent = `Choose Grade \u2014 ${curriculum.name}`;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'curriculum-view__choice-grid';
  curriculum.grades.forEach((grade) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'curriculum-view__choice-option';
    button.textContent = grade.name;
    button.addEventListener('click', () => handlers.onChooseGrade(grade));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

function renderCLSubjectStep(grade, handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-view__section';
  const heading = document.createElement('p');
  heading.className = 'curriculum-view__step-heading';
  heading.textContent = `Choose Subject \u2014 ${grade.name}`;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'curriculum-view__choice-grid';
  grade.subjects.forEach((subjectEntry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'curriculum-view__choice-option';
    button.textContent = subjectEntry.name;
    button.addEventListener('click', () => handlers.onChooseSubjectEntry(subjectEntry));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

// ---- The Curriculum Explorer: one screen, an accordion of Units ------

function renderExplorerStep(state, handlers) {
  const { classroom, selectedSubject, source, selectedPack, loadError, expandedUnitId } = state;
  const section = document.createElement('div');
  section.className = 'curriculum-view__section';

  const recentResource = resourceService.getMostRecentlyEditedResource(classroom);
  if (recentResource) {
    section.appendChild(renderContinueWorkingCard(recentResource, handlers));
  }

  const heading = document.createElement('p');
  heading.className = 'curriculum-view__step-heading';
  heading.textContent = `Curriculum Explorer \u2014 ${selectedSubject.title}`;
  section.appendChild(heading);

  if (loadError) {
    const error = document.createElement('p');
    error.className = 'curriculum-view__error';
    error.textContent = loadError;
    section.appendChild(error);
    return section;
  }

  const accordion = document.createElement('div');
  accordion.className = 'curriculum-view__accordion';

  if (source === 'library') {
    selectedPack.units.forEach((sourceUnit) => {
      accordion.appendChild(renderLibraryUnitRow(sourceUnit, expandedUnitId, handlers));
    });
  } else {
    selectedSubject.units.forEach((unit) => {
      accordion.appendChild(renderCustomUnitRow(classroom, unit, expandedUnitId, handlers));
    });
  }
  section.appendChild(accordion);

  if (source === 'custom') {
    section.appendChild(
      createInlineAddForm('New unit name (e.g. Force and Pressure)', '+ Add Unit', (title) => handlers.onAddCustomUnit(title))
    );
  }

  if (handlers.onOpenManageLessons) {
    const manageLessonsLink = document.createElement('button');
    manageLessonsLink.type = 'button';
    manageLessonsLink.className = 'btn btn--text curriculum-view__manage-lessons-link';
    manageLessonsLink.textContent = 'Need to rename, delete, or reorganize? Manage full syllabus \u2192';
    manageLessonsLink.addEventListener('click', handlers.onOpenManageLessons);
    section.appendChild(manageLessonsLink);
  }

  return section;
}

function renderContinueWorkingCard(recentResource, handlers) {
  const { resource, concept, subject } = recentResource;
  const wrap = document.createElement('div');
  wrap.className = 'curriculum-view__continue-working';

  const label = document.createElement('p');
  label.className = 'curriculum-view__continue-working-label';
  label.textContent = 'Continue Working';
  wrap.appendChild(label);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'curriculum-view__continue-card';
  card.appendChild(createIcon(getResourceTypeIcon(resource.type), { size: 22 }));
  const text = document.createElement('span');
  text.className = 'curriculum-view__continue-text';
  const titleEl = document.createElement('span');
  titleEl.className = 'curriculum-view__continue-title';
  titleEl.textContent = resource.title;
  const metaEl = document.createElement('span');
  metaEl.className = 'curriculum-view__continue-meta';
  metaEl.textContent = `${concept.title} \u00b7 ${subject.title}`;
  text.append(titleEl, metaEl);
  card.appendChild(text);
  card.addEventListener('click', () => handlers.onOpenRecentResource(recentResource));
  wrap.appendChild(card);

  return wrap;
}

function renderLibraryUnitRow(sourceUnit, expandedUnitId, handlers) {
  const row = document.createElement('div');
  row.className = 'curriculum-view__unit-row';

  const unitButton = document.createElement('button');
  unitButton.type = 'button';
  unitButton.className = 'curriculum-view__unit-toggle';
  const isExpanded = expandedUnitId === sourceUnit.id;
  unitButton.appendChild(createIcon('arrow-right', { size: 14 }));
  const unitLabel = document.createElement('span');
  unitLabel.textContent = sourceUnit.title;
  unitButton.appendChild(unitLabel);
  const count = document.createElement('span');
  count.className = 'curriculum-view__unit-count';
  count.textContent = `${sourceUnit.concepts.length} concept${sourceUnit.concepts.length === 1 ? '' : 's'}`;
  unitButton.appendChild(count);
  unitButton.classList.toggle('curriculum-view__unit-toggle--expanded', isExpanded);
  unitButton.addEventListener('click', () => handlers.onToggleUnit(sourceUnit.id));
  row.appendChild(unitButton);

  if (isExpanded) {
    const conceptList = document.createElement('div');
    conceptList.className = 'curriculum-view__concept-list';
    sourceUnit.concepts.forEach((conceptTitle) => {
      const conceptButton = document.createElement('button');
      conceptButton.type = 'button';
      conceptButton.className = 'curriculum-view__concept-option';
      conceptButton.textContent = conceptTitle;
      conceptButton.addEventListener('click', () => handlers.onOpenLibraryConcept(sourceUnit, conceptTitle));
      conceptList.appendChild(conceptButton);
    });
    row.appendChild(conceptList);
  }

  return row;
}

function renderCustomUnitRow(classroom, unit, expandedUnitId, handlers) {
  const row = document.createElement('div');
  row.className = 'curriculum-view__unit-row';

  const unitButton = document.createElement('button');
  unitButton.type = 'button';
  unitButton.className = 'curriculum-view__unit-toggle';
  const isExpanded = expandedUnitId === unit.id;
  unitButton.appendChild(createIcon('arrow-right', { size: 14 }));
  const unitLabel = document.createElement('span');
  unitLabel.textContent = unit.title;
  unitButton.appendChild(unitLabel);
  const count = document.createElement('span');
  count.className = 'curriculum-view__unit-count';
  count.textContent = `${unit.concepts.length} concept${unit.concepts.length === 1 ? '' : 's'}`;
  unitButton.appendChild(count);
  unitButton.classList.toggle('curriculum-view__unit-toggle--expanded', isExpanded);
  unitButton.addEventListener('click', () => handlers.onToggleUnit(unit.id));
  row.appendChild(unitButton);

  if (isExpanded) {
    const conceptList = document.createElement('div');
    conceptList.className = 'curriculum-view__concept-list';
    unit.concepts.forEach((concept) => {
      const conceptButton = document.createElement('button');
      conceptButton.type = 'button';
      conceptButton.className = 'curriculum-view__concept-option';
      conceptButton.textContent = concept.title;
      conceptButton.addEventListener('click', () => handlers.onOpenCustomConcept(unit, concept));
      conceptList.appendChild(conceptButton);
    });
    row.appendChild(conceptList);

    row.appendChild(
      createInlineAddForm('New concept name', '+ Add Concept', (title) => handlers.onAddCustomConcept(unit.id, title))
    );
  }

  return row;
}

// ---- Shared small helper ----------------------------------------------

function createInlineAddForm(placeholder, buttonLabel, onAdd) {
  const form = document.createElement('div');
  form.className = 'curriculum-view__inline-add-form';

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
