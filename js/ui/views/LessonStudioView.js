/**
 * ui/views/LessonStudioView.js
 *
 * The dedicated front door to lesson authoring — reached via the
 * Dashboard's "✏️ Create Lesson" button (see ContinueWorkingWidget.js),
 * a separate, equally prominent button from "📚 Manage Lessons"
 * because they do different things: Manage Lessons is the full
 * syllabus-management tool (rename, delete, reorder); this is
 * specifically about *writing* — creating and resuming Reading
 * lessons, as few clicks away from "I have an idea for a lesson" as
 * possible.
 *
 * Curriculum-First Navigation (this milestone): after choosing a
 * Subject, a teacher chooses *how* to get to a Unit and Concept —
 * Curriculum Library (browse a real syllabus tree — Curriculum ->
 * Grade -> Subject -> Unit -> Concept — with nothing to create by
 * hand) or Custom Curriculum (the original manual funnel: type a Unit
 * name, type a Concept name). Only Custom Curriculum ever shows an
 * "+ Add" form; Curriculum Library is pure browsing, all the way down
 * to a single concept, which is then materialized into the classroom
 * automatically (see services/curriculumLibraryService.js's
 * materializeUnitAndConcept() — find-or-create by title, so browsing
 * the same curriculum concept twice never creates a duplicate) before
 * landing on the exact same "Start Writing" step either path ends at.
 * The destination (Lesson Workspace) never changes; only how a
 * teacher arrives at a Concept does.
 *
 * Reuses learningRecordTeacherService.createSubject()/createUnit()/
 * createConcept() — the exact same functions Manage Lessons itself
 * calls — so this is a second, faster place to reach existing
 * functionality, not a second implementation of it. Renaming,
 * deleting, and reordering the syllabus still only happens in Manage
 * Lessons (see the hub's "Manage full syllabus" link below).
 *
 * Two top-level states, decided purely by what already exists in the
 * classroom — never a mode a teacher has to choose manually:
 *   - No Reading lesson has ever been written yet -> the onboarding
 *     funnel, starting the same Choose Subject -> Choose Curriculum
 *     path described above.
 *   - At least one Reading lesson exists -> the hub: Recent Lessons,
 *     Continue Writing, Create New Lesson (the same funnel, reused).
 *
 * Self-contained, same pattern as every other view in this feature:
 * no router, no URL, local state only for which funnel step is
 * active. Takes the classroom directly and two callbacks: `onBack`
 * (return to the Dashboard) and `onOpenManageLessons` (the hub's
 * secondary link to the full syllabus tool).
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as resourceService from '../../services/resourceService.js';
import * as curriculumLibraryService from '../../services/curriculumLibraryService.js';
import { getResourceTypeIcon } from '../../config/resourceTypeConfig.js';
import { logEvent } from '../../services/analyticsEventService.js';
import { createIcon } from '../components/Icon.js';
import { renderReadingEditorView } from './ReadingEditorView.js';

export function renderLessonStudioView(container, { classroom, onBack, onOpenManageLessons }) {
  // See this file's header comment for the full state list. Only the
  // fields relevant to the *current* mode are ever read; the rest sit
  // unused between funnel runs rather than being reset defensively
  // everywhere, matching the pattern already established for the
  // Custom Curriculum funnel.
  let mode = 'hub';
  let selectedSubject = null;
  let selectedUnit = null; // Custom Curriculum's chosen Unit
  let selectedConcept = null; // the Concept about to be named/written, either source
  let selectedCurriculum = null;
  let selectedGrade = null;
  let selectedSubjectEntry = null; // { id, name, packFile }
  let selectedPack = null;
  let selectedSourceUnit = null; // the curriculum pack's own unit entry
  let loadError = null;

  function rerender() {
    renderStudio(
      container,
      classroom,
      mode,
      { selectedSubject, selectedUnit, selectedCurriculum, selectedGrade, selectedSubjectEntry, selectedPack, selectedSourceUnit, loadError },
      {
        onBack,
        onOpenManageLessons,
        onStartFunnel: () => {
          mode = 'choose-subject';
          selectedSubject = null;
          selectedUnit = null;
          selectedConcept = null;
          rerender();
        },
        onChooseSubject: (subject) => {
          selectedSubject = subject;
          mode = 'choose-curriculum';
          rerender();
        },
        onPickCustomCurriculum: () => {
          mode = 'choose-unit';
          rerender();
        },
        onPickCurriculumLibrary: () => {
          loadError = null;
          mode = 'cl-choose-curriculum';
          rerender();
        },

        // ---- Custom Curriculum (manual, unchanged) ----
        onChooseUnit: (unit) => {
          selectedUnit = unit;
          mode = 'choose-concept';
          rerender();
        },
        onChooseConcept: (concept) => {
          selectedConcept = concept;
          mode = 'name-lesson';
          rerender();
        },
        onBackToUnitChoice: () => {
          mode = 'choose-unit';
          rerender();
        },

        // ---- Curriculum Library (browse-only) ----
        onChooseCurriculum: (curriculum) => {
          selectedCurriculum = curriculum;
          mode = 'cl-choose-grade';
          rerender();
        },
        onChooseGrade: (grade) => {
          selectedGrade = grade;
          mode = 'cl-choose-subject';
          rerender();
        },
        onChooseSubjectEntry: async (subjectEntry) => {
          selectedSubjectEntry = subjectEntry;
          loadError = null;
          try {
            selectedPack = await curriculumLibraryService.getPack(subjectEntry.packFile);
          } catch (error) {
            console.error('[LessonStudioView] Failed to load curriculum pack:', error);
            loadError = "Couldn't load this subject's units. Check your connection and try again.";
          }
          mode = 'cl-choose-unit';
          rerender();
        },
        onChooseSourceUnit: (sourceUnit) => {
          selectedSourceUnit = sourceUnit;
          mode = 'cl-choose-concept';
          rerender();
        },
        onChooseSourceConcept: (conceptTitle) => {
          // The one place browsing turns into real data — see
          // materializeUnitAndConcept()'s own doc comment.
          const { unit, concept } = curriculumLibraryService.materializeUnitAndConcept(
            classroom,
            selectedSubject,
            selectedSourceUnit.title,
            conceptTitle
          );
          workspaceService.save(classroom);
          selectedUnit = unit;
          selectedConcept = concept;
          mode = 'name-lesson';
          rerender();
        },
        onBackTo: (targetMode) => {
          mode = targetMode;
          rerender();
        },

        // ---- Shared final step ----
        onCreateLesson: (title) => {
          const resource = resourceService.createResourceOnConcept(selectedConcept, { title, type: 'reading' });
          workspaceService.save(classroom);
          renderReadingEditorView(container, {
            classroom,
            resource,
            onBack: () => {
              mode = 'hub';
              rerender();
            },
          });
        },
        onOpenLesson: (resource) => {
          logEvent('lesson_opened', { classroomId: classroom.id });
          renderReadingEditorView(container, {
            classroom,
            resource,
            onBack: () => {
              mode = 'hub';
              rerender();
            },
          });
        },
        onBackToHub: () => {
          mode = 'hub';
          rerender();
        },
      }
    );
  }

  rerender();
}

function renderStudio(container, classroom, mode, selection, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'lesson-studio';

  const header = document.createElement('header');
  header.className = 'lesson-studio__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append(mode === 'hub' ? 'Back to Dashboard' : 'Cancel');
  backButton.addEventListener('click', mode === 'hub' ? handlers.onBack : handlers.onBackToHub);
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'lesson-studio__title';
  title.textContent = '\u270f\ufe0f Lesson Studio';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'choose-subject') {
    wrapper.appendChild(renderChooseSubjectStep(classroom, handlers));
  } else if (mode === 'choose-curriculum') {
    wrapper.appendChild(renderChooseCurriculumModeStep(selection.selectedSubject, handlers));
  } else if (mode === 'choose-unit') {
    wrapper.appendChild(renderChooseUnitStep(classroom, selection.selectedSubject, handlers));
  } else if (mode === 'choose-concept') {
    wrapper.appendChild(renderChooseConceptStep(classroom, selection.selectedUnit, handlers));
  } else if (mode === 'cl-choose-curriculum') {
    wrapper.appendChild(renderCLCurriculumStep(handlers));
  } else if (mode === 'cl-choose-grade') {
    wrapper.appendChild(renderCLGradeStep(selection.selectedCurriculum, handlers));
  } else if (mode === 'cl-choose-subject') {
    wrapper.appendChild(renderCLSubjectStep(selection.selectedGrade, handlers));
  } else if (mode === 'cl-choose-unit') {
    wrapper.appendChild(renderCLUnitStep(selection, handlers));
  } else if (mode === 'cl-choose-concept') {
    wrapper.appendChild(renderCLConceptStep(selection.selectedSourceUnit, handlers));
  } else if (mode === 'name-lesson') {
    wrapper.appendChild(renderNameLessonStep(handlers));
  } else {
    wrapper.appendChild(renderHub(classroom, handlers));
  }

  container.appendChild(wrapper);
}

// ---- Hub ---------------------------------------------------------------

function renderHub(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const recentLessons = resourceService.getRecentResourcesByType(classroom, 'reading', 5);

  if (recentLessons.length === 0) {
    return renderOnboardingIntro(handlers);
  }

  const mostRecent = recentLessons[0];

  const continueHeading = document.createElement('h2');
  continueHeading.className = 'lesson-studio__section-heading';
  continueHeading.textContent = 'Continue Writing';
  section.appendChild(continueHeading);

  const continueCard = document.createElement('button');
  continueCard.type = 'button';
  continueCard.className = 'lesson-studio__continue-card';
  continueCard.appendChild(createIcon(getResourceTypeIcon('reading'), { size: 22 }));
  const continueText = document.createElement('span');
  continueText.className = 'lesson-studio__continue-text';
  const continueTitle = document.createElement('span');
  continueTitle.className = 'lesson-studio__continue-title';
  continueTitle.textContent = mostRecent.resource.title;
  const continueMeta = document.createElement('span');
  continueMeta.className = 'lesson-studio__continue-meta';
  continueMeta.textContent = `${mostRecent.concept.title} \u00b7 ${mostRecent.subject.title}`;
  continueText.append(continueTitle, continueMeta);
  continueCard.appendChild(continueText);
  continueCard.addEventListener('click', () => handlers.onOpenLesson(mostRecent.resource));
  section.appendChild(continueCard);

  const recentHeading = document.createElement('h2');
  recentHeading.className = 'lesson-studio__section-heading';
  recentHeading.textContent = 'Recent Lessons';
  section.appendChild(recentHeading);

  const list = document.createElement('div');
  list.className = 'lesson-studio__recent-list';
  recentLessons.forEach(({ resource, concept, subject }) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lesson-studio__recent-row';
    row.appendChild(createIcon(getResourceTypeIcon('reading'), { size: 18 }));
    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-studio__recent-text';
    const rowTitle = document.createElement('span');
    rowTitle.className = 'lesson-studio__recent-title';
    rowTitle.textContent = resource.title;
    const rowMeta = document.createElement('span');
    rowMeta.className = 'lesson-studio__recent-meta';
    rowMeta.textContent = `${concept.title} \u00b7 ${subject.title}`;
    textWrap.append(rowTitle, rowMeta);
    row.appendChild(textWrap);
    row.addEventListener('click', () => handlers.onOpenLesson(resource));
    list.appendChild(row);
  });
  section.appendChild(list);

  const createNewButton = document.createElement('button');
  createNewButton.type = 'button';
  createNewButton.className = 'btn btn--primary';
  createNewButton.textContent = '+ Create New Lesson';
  createNewButton.addEventListener('click', handlers.onStartFunnel);
  section.appendChild(createNewButton);

  if (handlers.onOpenManageLessons) {
    const manageLessonsLink = document.createElement('button');
    manageLessonsLink.type = 'button';
    manageLessonsLink.className = 'btn btn--text lesson-studio__manage-lessons-link';
    manageLessonsLink.textContent = 'Need to rename, delete, or reorganize? Manage full syllabus \u2192';
    manageLessonsLink.addEventListener('click', handlers.onOpenManageLessons);
    section.appendChild(manageLessonsLink);
  }

  return section;
}

// ---- Onboarding (first lesson) -------------------------------------------

function renderOnboardingIntro(handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const heading = document.createElement('h2');
  heading.className = 'lesson-studio__onboarding-heading';
  heading.textContent = 'Create your first lesson';

  const steps = document.createElement('ol');
  steps.className = 'lesson-studio__onboarding-steps';
  ['Choose Subject', 'Choose Curriculum', 'Choose Unit & Concept', 'Start Writing'].forEach((step) => {
    const item = document.createElement('li');
    item.textContent = step;
    steps.appendChild(item);
  });

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'btn btn--primary';
  startButton.textContent = 'Get Started';
  startButton.addEventListener('click', handlers.onStartFunnel);

  section.append(heading, steps, startButton);
  return section;
}

// ---- Choose Subject (unchanged) --------------------------------------

function renderChooseSubjectStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = 'Choose Subject';
  section.appendChild(heading);

  const subjects = learningRecordService.getSubjects(classroom);
  if (subjects.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'lesson-studio__choice-grid';
    subjects.forEach((subject) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lesson-studio__choice-option';
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

// ---- Choose Curriculum (NEW) ------------------------------------------

/**
 * The one new decision this milestone adds to the funnel: how does a
 * teacher want to reach a Unit and Concept for this Subject? Neither
 * option is a dead end or a placeholder — Curriculum Library really
 * browses real data (see the cl-* steps below); Custom Curriculum
 * really is the exact same manual funnel this app already had.
 */
function renderChooseCurriculumModeStep(subject, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = `Choose Curriculum \u2014 ${subject.title}`;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'lesson-studio__curriculum-mode-grid';

  const libraryOption = document.createElement('button');
  libraryOption.type = 'button';
  libraryOption.className = 'lesson-studio__curriculum-mode-option';
  libraryOption.appendChild(createIcon('graduation-cap', { size: 24 }));
  const libraryText = document.createElement('span');
  libraryText.className = 'lesson-studio__curriculum-mode-text';
  const libraryTitle = document.createElement('span');
  libraryTitle.className = 'lesson-studio__curriculum-mode-title';
  libraryTitle.textContent = 'Curriculum Library';
  const librarySubtitle = document.createElement('span');
  librarySubtitle.className = 'lesson-studio__curriculum-mode-subtitle';
  librarySubtitle.textContent = 'Samacheer Kalvi';
  libraryText.append(libraryTitle, librarySubtitle);
  libraryOption.appendChild(libraryText);
  libraryOption.addEventListener('click', handlers.onPickCurriculumLibrary);
  grid.appendChild(libraryOption);

  const customOption = document.createElement('button');
  customOption.type = 'button';
  customOption.className = 'lesson-studio__curriculum-mode-option';
  customOption.appendChild(createIcon('palette', { size: 24 }));
  const customText = document.createElement('span');
  customText.className = 'lesson-studio__curriculum-mode-text';
  const customTitle = document.createElement('span');
  customTitle.className = 'lesson-studio__curriculum-mode-title';
  customTitle.textContent = '\u2728 Custom Curriculum';
  const customSubtitle = document.createElement('span');
  customSubtitle.className = 'lesson-studio__curriculum-mode-subtitle';
  customSubtitle.textContent = 'Create your own Units and Concepts';
  customText.append(customTitle, customSubtitle);
  customOption.appendChild(customText);
  customOption.addEventListener('click', handlers.onPickCustomCurriculum);
  grid.appendChild(customOption);

  section.appendChild(grid);
  return section;
}

// ---- Custom Curriculum: Choose Unit / Choose Concept (unchanged) -----

function renderChooseUnitStep(classroom, subject, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back to Curriculum Choice');
  backButton.addEventListener('click', () => handlers.onBackTo('choose-curriculum'));
  section.appendChild(backButton);

  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = `Choose Unit \u2014 ${subject.title}`;
  section.appendChild(heading);

  if (subject.units.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'lesson-studio__choice-grid';
    subject.units.forEach((unit) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lesson-studio__choice-option';
      button.textContent = unit.title;
      button.addEventListener('click', () => handlers.onChooseUnit(unit));
      grid.appendChild(button);
    });
    section.appendChild(grid);
  }

  section.appendChild(
    createInlineAddForm('New unit name (e.g. Force and Pressure)', '+ Add Unit', (title) => {
      const unit = learningRecordTeacherService.createUnit(classroom, subject.id, { title });
      workspaceService.save(classroom);
      handlers.onChooseUnit(unit);
    })
  );

  return section;
}

function renderChooseConceptStep(classroom, unit, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back to Units');
  backButton.addEventListener('click', handlers.onBackToUnitChoice);
  section.appendChild(backButton);

  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = `Choose Concept \u2014 ${unit.title}`;
  section.appendChild(heading);

  if (unit.concepts.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'lesson-studio__choice-grid';
    unit.concepts.forEach((concept) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lesson-studio__choice-option';
      button.textContent = concept.title;
      button.addEventListener('click', () => handlers.onChooseConcept(concept));
      grid.appendChild(button);
    });
    section.appendChild(grid);
  }

  section.appendChild(
    createInlineAddForm('New concept name (e.g. Friction)', '+ Add Concept', (title) => {
      const concept = learningRecordTeacherService.createConcept(classroom, unit.id, { title });
      workspaceService.save(classroom);
      handlers.onChooseConcept(concept);
    })
  );

  return section;
}

// ---- Curriculum Library: browse-only, no add-forms anywhere ----------

function renderCLCurriculumStep(handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';
  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = 'Choose a Curriculum';
  section.appendChild(heading);

  const listEl = document.createElement('div');
  listEl.className = 'lesson-studio__choice-grid';
  listEl.textContent = 'Loading\u2026';
  section.appendChild(listEl);

  curriculumLibraryService
    .getCurricula()
    .then((curricula) => {
      listEl.innerHTML = '';
      curricula.forEach((curriculum) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lesson-studio__choice-option';
        button.textContent = curriculum.name;
        button.addEventListener('click', () => handlers.onChooseCurriculum(curriculum));
        listEl.appendChild(button);
      });
    })
    .catch((error) => {
      console.error('[LessonStudioView] Failed to load curricula:', error);
      listEl.textContent = "Couldn't load the Curriculum Library. Check your connection and try again.";
    });

  return section;
}

function renderCLGradeStep(curriculum, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';
  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = `Choose Grade \u2014 ${curriculum.name}`;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'lesson-studio__choice-grid';
  curriculum.grades.forEach((grade) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lesson-studio__choice-option';
    button.textContent = grade.name;
    button.addEventListener('click', () => handlers.onChooseGrade(grade));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

function renderCLSubjectStep(grade, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';
  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = `Choose Subject \u2014 ${grade.name}`;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'lesson-studio__choice-grid';
  grade.subjects.forEach((subjectEntry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lesson-studio__choice-option';
    button.textContent = subjectEntry.name;
    button.addEventListener('click', () => handlers.onChooseSubjectEntry(subjectEntry));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

function renderCLUnitStep(selection, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  if (selection.loadError) {
    const error = document.createElement('p');
    error.className = 'lesson-studio__error';
    error.textContent = selection.loadError;
    section.appendChild(error);
    return section;
  }

  const pack = selection.selectedPack;
  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = 'Choose Unit';
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'lesson-studio__choice-grid';
  pack.units.forEach((sourceUnit) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lesson-studio__choice-option';
    button.textContent = sourceUnit.title;
    button.addEventListener('click', () => handlers.onChooseSourceUnit(sourceUnit));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

function renderCLConceptStep(sourceUnit, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back to Units');
  backButton.addEventListener('click', () => handlers.onBackTo('cl-choose-unit'));
  section.appendChild(backButton);

  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = `Choose Concept \u2014 ${sourceUnit.title}`;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'lesson-studio__choice-grid';
  sourceUnit.concepts.forEach((conceptTitle) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lesson-studio__choice-option';
    button.textContent = conceptTitle;
    button.addEventListener('click', () => handlers.onChooseSourceConcept(conceptTitle));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

// ---- Shared final step: name & start writing --------------------------

function renderNameLessonStep(handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = 'Start Writing \u2014 name your lesson';
  section.appendChild(heading);

  const form = document.createElement('div');
  form.className = 'lesson-studio__name-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'e.g. Introduction to Pressure';

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'btn btn--primary';
  startButton.textContent = 'Start Writing';
  startButton.addEventListener('click', () => {
    const title = input.value.trim();
    if (!title) return;
    handlers.onCreateLesson(title);
  });

  form.append(input, startButton);
  section.appendChild(form);
  input.focus();

  return section;
}

// ---- Shared small helper ----------------------------------------------

function createInlineAddForm(placeholder, buttonLabel, onAdd) {
  const form = document.createElement('div');
  form.className = 'lesson-studio__inline-add-form';

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
