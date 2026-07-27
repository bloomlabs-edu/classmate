/**
 * ui/views/LessonStudioView.js
 *
 * The dedicated front door to lesson authoring — reached via the
 * Dashboard's "✏️ Create Lesson" button (see ContinueWorkingWidget.js),
 * a separate, equally prominent button from "📚 Manage Lessons"
 * because they do different things: Manage Lessons builds the
 * syllabus tree; this is specifically about *writing* — creating and
 * resuming Reading lessons. Existing subjects/units/concepts are
 * reused here, never recreated — this view has no syllabus-editing
 * capability of its own, by design (see the "no syllabus yet" empty
 * state below, which points back to Manage Lessons rather than
 * duplicating it).
 *
 * Three states, decided purely by what already exists in the
 * classroom — never a mode a teacher has to choose manually:
 *   - No subjects at all yet -> "build your syllabus first," a link
 *     back to Manage Lessons.
 *   - Subjects exist, but no Reading lesson has ever been written ->
 *     the onboarding funnel: Choose Subject -> Choose Unit -> Choose
 *     Concept -> Start Writing.
 *   - At least one Reading lesson exists -> the hub: Recent Lessons,
 *     Continue Writing (the single most recent one), Create New
 *     Lesson (the same funnel as onboarding, reused, not duplicated).
 *
 * Self-contained, same pattern as every other view in this feature:
 * no router, no URL, local state only for which funnel step is
 * active. Takes the classroom directly and two callbacks: `onBack`
 * (return to the Dashboard) and `onOpenManageLessons` (for the
 * no-syllabus-yet empty state only).
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as resourceService from '../../services/resourceService.js';
import { getResourceTypeIcon } from '../../config/resourceTypeConfig.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';
import { renderReadingEditorView } from './ReadingEditorView.js';

export function renderLessonStudioView(container, { classroom, onBack, onOpenManageLessons }) {
  // 'hub' (default — decided by what already exists), 'choose-subject',
  // 'choose-unit', 'choose-concept', or 'name-lesson'. selectedSubject/
  // selectedUnit/selectedConcept only matter alongside the later
  // funnel steps.
  let mode = 'hub';
  let selectedSubject = null;
  let selectedUnit = null;
  let selectedConcept = null;

  function rerender() {
    renderStudio(container, classroom, mode, { selectedSubject, selectedUnit }, {
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
        mode = 'choose-unit';
        rerender();
      },
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
      onBackToSubjectChoice: () => {
        mode = 'choose-subject';
        selectedUnit = null;
        rerender();
      },
      onBackToUnitChoice: () => {
        mode = 'choose-unit';
        rerender();
      },
    });
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
  } else if (mode === 'choose-unit') {
    wrapper.appendChild(renderChooseUnitStep(selection.selectedSubject, handlers));
  } else if (mode === 'choose-concept') {
    wrapper.appendChild(renderChooseConceptStep(selection.selectedUnit, handlers));
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

  const hasAnySubjects = learningRecordService.getSubjects(classroom).length > 0;

  if (!hasAnySubjects) {
    section.appendChild(
      createEmptyStateElement({ message: "You'll need a Subject, Unit, and Concept before writing a lesson." })
    );

    const manageLessonsButton = document.createElement('button');
    manageLessonsButton.type = 'button';
    manageLessonsButton.className = 'btn btn--primary';
    manageLessonsButton.textContent = '\ud83d\udcda Build Your Syllabus';
    manageLessonsButton.addEventListener('click', handlers.onOpenManageLessons);
    section.appendChild(manageLessonsButton);
    return section;
  }

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
  ['Choose Subject', 'Choose Unit', 'Choose Concept', 'Start Writing'].forEach((step) => {
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

// ---- Funnel steps (shared by onboarding and "Create New Lesson") --------

function renderChooseSubjectStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = 'Choose Subject';
  section.appendChild(heading);

  const subjects = learningRecordService.getSubjects(classroom);
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

  return section;
}

function renderChooseUnitStep(subject, handlers) {
  const section = document.createElement('div');
  section.className = 'lesson-studio__section';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back to Subjects');
  backButton.addEventListener('click', handlers.onBackToSubjectChoice);
  section.appendChild(backButton);

  const heading = document.createElement('p');
  heading.className = 'lesson-studio__step-heading';
  heading.textContent = `Choose Unit \u2014 ${subject.title}`;
  section.appendChild(heading);

  if (subject.units.length === 0) {
    section.appendChild(createEmptyStateElement({ message: `${subject.title} has no units yet. Add one in Manage Lessons first.` }));
    return section;
  }

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

  return section;
}

function renderChooseConceptStep(unit, handlers) {
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

  if (unit.concepts.length === 0) {
    section.appendChild(createEmptyStateElement({ message: `${unit.title} has no concepts yet. Add one in Manage Lessons first.` }));
    return section;
  }

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

  return section;
}

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
