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
 * ui/views/CurriculumView.js from the Dashboard Navigation Simplification milestone, which this milestone retires. A
 * classroom's assigned Library pack (see models/Classroom.js's
 * `curriculumAssignment` field, set once in Curriculum Management),
 * when one exists for a given Subject's title, is still read
 * automatically via services/curriculumLibraryService.js's
 * getAssignedPackForSubject() — that lookup is unchanged. What did
 * change (the "Replace the hardcoded Subject buttons" milestone): a
 * *new* Subject no longer comes from a fixed, hardcoded name list
 * (config/commonSubjectsConfig.js's old picker) — a teacher clicks
 * "+ Add Subject" and picks a subject name from what's actually
 * available, exactly the same shape of interaction the old picker
 * offered. Under the hood, this is really services/curriculumLinkingService.js
 * linking one of the teacher's own Curriculum Indexes
 * (services/curriculumIndexRepository.js) — deliberately never named
 * as such anywhere in this file's own UI text: "teachers think in
 * terms of subjects, not curricula," so nothing here ever says
 * "Curriculum Index" or "link." See that service's own header
 * comment for exactly how this coexists with the older Library
 * assignment mechanism rather than replacing it.
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
import * as curriculumIndexRepository from '../../services/curriculumIndexRepository.js';
import * as curriculumLinkingService from '../../services/curriculumLinkingService.js';
import { getResourceTypeIcon } from '../../config/resourceTypeConfig.js';
import { getDisplayName } from '../../services/classroomService.js';
import { createIcon } from '../components/Icon.js';
import { createCurriculumExplorerPanel } from '../components/CurriculumExplorerPanel.js';
import { createSubjectPickerElement } from '../components/SubjectPicker.js';
import { renderReadingEditorView } from './ReadingEditorView.js';
import { renderConceptWorkspaceView } from './ConceptWorkspaceView.js';
import { renderLearningRecordView } from './LearningRecordView.js';

export function renderLearningManagementView(container, { classrooms, onBack }) {
  // Choose Class only earns its place when there's an actual choice to
  // make — a teacher running one classroom should never be asked to
  // pick it. See the entry-point logic just below.
  const singleClassroomMode = classrooms.length === 1;

  // 'choose-class' (skipped entirely in singleClassroomMode — see
  // above), 'choose-subject', or 'explorer' (the combined accordion).
  // Nothing here ever asks which curriculum to use — see this file's
  // header comment.
  let mode = singleClassroomMode ? 'choose-subject' : 'choose-class';
  let selectedClassroom = singleClassroomMode ? classrooms[0] : null;
  let selectedSubject = null;
  let source = null; // 'custom' | 'library' — decided automatically, never picked
  let selectedPack = null;
  let chosenSubjectName = null; // set in "Choose Subject" (step 1), read by "Choose Curriculum" (step 2)
  let loadError = null;
  let expandedUnitId = null;

  /**
   * Shared by onChooseSubject and onChooseCurriculumForSubject — a
   * freshly-linked Subject is selected the exact same way an existing
   * one is, including this same Library-pack lookup by title. Worth
   * naming plainly: if a classroom separately has a Library pack
   * assigned for this same subject title (services/curriculumLibraryService.js's
   * older, still-active `curriculumAssignment` mechanism — a
   * different thing from Curriculum Index linking, see
   * services/curriculumLinkingService.js's own header comment), that
   * assigned pack's content is what actually gets shown here, not the
   * just-linked Curriculum Index's Units — the same behavior that
   * already applied to any manually-chosen Subject before this
   * milestone.
   */
  async function selectSubject(subject) {
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
  }

  function rerender() {
    renderView(
      container,
      mode,
      { classrooms, selectedClassroom, selectedSubject, source, selectedPack, chosenSubjectName, loadError, expandedUnitId, singleClassroomMode },
      {
        onBack,
        onChooseClass: (classroom) => {
          selectedClassroom = classroom;
          mode = 'choose-subject';
          rerender();
        },
        onChooseSubject: async (subject) => {
          await selectSubject(subject);
          rerender();
        },
        onGoToChooseSubjectName: () => {
          mode = 'choose-subject-name';
          rerender();
        },
        onChooseSubjectName: async (subjectName) => {
          chosenSubjectName = subjectName;
          // A teacher is never asked to confirm a choice that isn't
          // actually a choice — if exactly one Curriculum Index
          // matches, link it immediately and skip "Choose Curriculum"
          // entirely, the same principle "Choose Class" already
          // applies for a single classroom.
          try {
            const allIndexes = await curriculumIndexRepository.listIndexes();
            const matches = curriculumLinkingService.findAvailableCurriculumIndexesForSubject(selectedClassroom, allIndexes, subjectName);
            if (matches.length === 1) {
              const subject = curriculumLinkingService.linkCurriculumIndex(selectedClassroom, matches[0], subjectName);
              workspaceService.save(selectedClassroom);
              await selectSubject(subject);
            } else {
              mode = 'choose-curriculum';
            }
          } catch (error) {
            console.error('[LearningManagementView] Failed to load Curriculum Indexes:', error);
            mode = 'choose-curriculum';
          }
          rerender();
        },
        onChooseCurriculumForSubject: async (curriculumIndex, subjectName) => {
          const subject = curriculumLinkingService.linkCurriculumIndex(selectedClassroom, curriculumIndex, subjectName);
          workspaceService.save(selectedClassroom);
          await selectSubject(subject);
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

  const isEntryStep = mode === 'choose-class' || (mode === 'choose-subject' && state.singleClassroomMode);

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append(isEntryStep ? 'Back to Dashboard' : 'Back');
  backButton.addEventListener('click', () => {
    if (isEntryStep) return handlers.onBack();
    const previous = {
      'choose-subject': 'choose-class',
      'choose-subject-name': 'choose-subject',
      'choose-curriculum': 'choose-subject-name',
      explorer: 'choose-subject',
    }[mode];
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
  } else if (mode === 'choose-subject-name') {
    wrapper.appendChild(renderChooseSubjectNameStep(state.selectedClassroom, handlers));
  } else if (mode === 'choose-curriculum') {
    wrapper.appendChild(renderChooseCurriculumStep(state.selectedClassroom, state.chosenSubjectName, handlers));
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

/**
 * The Learning Management home screen for a chosen classroom.
 * Deliberately bare when empty — no heading, no explanatory copy,
 * just whatever Subjects already exist (if any) and "+ Add Subject."
 * "Learning Management" itself is already the page's own title (see
 * the header rendered in renderView() above); this step adds nothing
 * on top of it by design.
 */
function renderChooseSubjectStep(classroom, handlers) {
  // TEMPORARY DIAGNOSTIC LOGGING — added to directly observe runtime
  // state rather than continue reasoning about it. Remove once the
  // root cause is confirmed.
  const subjectsForLogging = learningRecordService.getSubjects(classroom);
  console.log('[DIAGNOSTIC] renderChooseSubjectStep is the function rendering the subject buttons.');
  console.log('[DIAGNOSTIC] classroom.id:', classroom.id);
  console.log('[DIAGNOSTIC] classroom.createdAt:', classroom.createdAt, '| classroom.updatedAt:', classroom.updatedAt);
  console.log('[DIAGNOSTIC] classroom.learningRecord.subjects.length:', subjectsForLogging.length);
  console.log('[DIAGNOSTIC] classroom.learningRecord.subjects (full contents):', JSON.stringify(subjectsForLogging, null, 2));
  console.log('[DIAGNOSTIC] Raw classroom.learningRecord object:', JSON.stringify(classroom.learningRecord, null, 2));

  const section = document.createElement('div');
  section.className = 'learning-management__section';

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

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--primary';
  addSubjectButton.textContent = '+ Add Subject';
  addSubjectButton.addEventListener('click', handlers.onGoToChooseSubjectName);
  section.appendChild(addSubjectButton);

  return section;
}

/**
 * Step 1 of "+ Add Subject": a plain subject name, nothing about
 * curricula yet. Reuses ui/components/SubjectPicker.js completely
 * unchanged in behavior (the same common-name buttons plus a
 * free-text fallback Manage Lessons already uses) — the only
 * difference here is what picking a name *does*: instead of creating
 * a Subject immediately, it advances to "Choose Curriculum" (step 2),
 * where the actual content gets attached.
 */
function renderChooseSubjectNameStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = 'Choose Subject';
  section.appendChild(heading);

  const existingSubjectTitles = learningRecordService.getSubjects(classroom).map((subject) => subject.title);
  section.appendChild(
    createSubjectPickerElement({
      existingSubjectTitles,
      otherButtonLabel: 'Custom Subject',
      onAddSubject: (subjectName) => handlers.onChooseSubjectName(subjectName),
    })
  );

  return section;
}

/**
 * Step 2 of "+ Add Subject": which of the teacher's own Curriculum
 * Indexes actually backs the subject name just chosen — the one
 * moment "Curriculum Index"/"linking" would ever need to be named,
 * and it still isn't: options show only each curriculum's own name
 * ("Samacheer Kalvi," "NCERT"), never the word "curriculum" itself.
 * Repeating the subject name here would be redundant (it was just
 * chosen in step 1), so it's never shown again on this screen either
 * — the same "don't repeat what's already established" rule already
 * applied to grade.
 *
 * Skipped entirely when exactly one Curriculum Index matches — a
 * teacher is never asked to confirm a choice that isn't actually a
 * choice, the same principle "Choose Class" already applies when a
 * teacher runs only one classroom.
 */
function renderChooseCurriculumStep(classroom, subjectName, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = 'Choose Curriculum';
  section.appendChild(heading);

  const loadingNote = document.createElement('p');
  loadingNote.className = 'learning-management__intro';
  loadingNote.textContent = 'Loading\u2026';
  section.appendChild(loadingNote);

  curriculumIndexRepository
    .listIndexes()
    .then((allIndexes) => {
      loadingNote.remove();
      const matches = curriculumLinkingService.findAvailableCurriculumIndexesForSubject(classroom, allIndexes, subjectName);

      if (matches.length === 0) {
        const emptyNote = document.createElement('p');
        emptyNote.className = 'learning-management__intro';
        emptyNote.textContent = `No curricula available for ${subjectName} yet \u2014 build one in Curriculum Management first.`;
        section.appendChild(emptyNote);
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'learning-management__choice-grid';
      matches.forEach((index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'learning-management__choice-option';
        button.textContent = index.curriculum.name;
        button.addEventListener('click', () => handlers.onChooseCurriculumForSubject(index, subjectName));
        grid.appendChild(button);
      });
      section.appendChild(grid);
    })
    .catch((error) => {
      console.error('[LearningManagementView] Failed to load Curriculum Indexes:', error);
      loadingNote.textContent = "Couldn't load available curricula. Check your connection and try again.";
    });

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
  if (source === 'library') {
    const normalizedUnits = selectedPack.units.map((sourceUnit) => ({
      id: sourceUnit.id,
      title: sourceUnit.title,
      concepts: sourceUnit.concepts.map((conceptTitle) => ({
        id: conceptTitle,
        title: conceptTitle,
        onClick: () => handlers.onOpenLibraryConcept(sourceUnit, conceptTitle),
      })),
    }));
    section.appendChild(createCurriculumExplorerPanel({ units: normalizedUnits, expandedUnitId, onToggleUnit: handlers.onToggleUnit }));
  } else {
    const normalizeUnit = (unit) => ({
      id: unit.id,
      title: unit.title,
      concepts: unit.concepts.map((concept) => ({
        id: concept.id,
        title: concept.title,
        onClick: () => handlers.onOpenCustomConcept(unit, concept),
      })),
    });

    // A Subject linked from a single-Part Curriculum Index (or one a
    // teacher built by hand, which never sets partName at all) has no
    // real grouping to show — one Explorer panel, exactly as before
    // this milestone. Only a linked multi-Part curriculum (Social
    // Science's History/Geography/...) produces more than one
    // distinct partName, and only then does Part-grouping appear.
    const distinctPartNames = [...new Set(selectedSubject.units.map((unit) => unit.partName).filter(Boolean))];

    if (distinctPartNames.length > 1) {
      distinctPartNames.forEach((partName) => {
        const partHeading = document.createElement('p');
        partHeading.className = 'learning-management__part-heading';
        partHeading.textContent = partName;
        section.appendChild(partHeading);

        const unitsInPart = selectedSubject.units.filter((unit) => unit.partName === partName).map(normalizeUnit);
        section.appendChild(createCurriculumExplorerPanel({ units: unitsInPart, expandedUnitId, onToggleUnit: handlers.onToggleUnit }));
      });
    } else {
      const normalizedUnits = selectedSubject.units.map(normalizeUnit);
      section.appendChild(createCurriculumExplorerPanel({ units: normalizedUnits, expandedUnitId, onToggleUnit: handlers.onToggleUnit }));
    }
  }

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
