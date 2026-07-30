/**
 * ui/views/LearningManagementView.js
 *
 * Learning Management, rebuilt from a genuinely clean slate — see
 * this file's own history in CHANGELOG.md for the full incremental
 * rebuild. This milestone: a chosen Subject is now genuinely
 * persisted (via ui/components/ChooseSubjectModal.js's Choose
 * Curriculum step), rendered on this home screen, and clicking it
 * navigates into its own structure — adapting to whether its linked
 * curriculum actually has Parts, rather than forcing a level that
 * doesn't exist.
 *
 * Choose Class is back, minimally — skipped entirely when there's
 * only one classroom, the same "only ask when there's a real choice"
 * principle already used throughout this app. It wasn't part of any
 * earlier milestone here because nothing needed a specific classroom
 * until persistence did; this is resolving a real, currently-blocking
 * gap, not a speculative addition.
 *
 * Reused, unmodified: services/learningRecordService.js (reading
 * Subjects), ui/components/ChooseSubjectModal.js (the whole Add
 * Subject workflow — this file only supplies it a classroom and a
 * callback), config/commonSubjectsConfig.js indirectly through that
 * modal. Still untouched and waiting for a later milestone: Concepts,
 * the Resource Workspace.
 */

import { createIcon } from '../components/Icon.js';
import { openChooseSubjectModal } from '../components/ChooseSubjectModal.js';
import { getDisplayName } from '../../services/classroomService.js';
import * as learningRecordService from '../../services/learningRecordService.js';

export function renderLearningManagementView(container, { classrooms, onBack }) {
  const singleClassroomMode = classrooms.length === 1;

  let mode = singleClassroomMode ? 'home' : 'choose-class';
  let selectedClassroom = singleClassroomMode ? classrooms[0] : null;
  let selectedSubject = null;
  let selectedPartName = null; // set once a Part is chosen, for a Subject whose curriculum actually has them

  function rerender() {
    renderView(container, mode, { classrooms, selectedClassroom, selectedSubject, selectedPartName, singleClassroomMode }, handlers);
  }

  const handlers = {
    onBack,
    onChooseClass: (classroom) => {
      selectedClassroom = classroom;
      mode = 'home';
      rerender();
    },
    onGoToAddSubject: () => {
      openChooseSubjectModal({
        classroom: selectedClassroom,
        onSubjectAdded: () => {
          // The modal already persisted and saved the Subject itself
          // (services/curriculumLinkingService.js +
          // services/workspaceService.js) — this only needs to
          // re-render so the home screen reads it back from
          // services/learningRecordService.js, the single source of
          // truth for what's actually persisted.
          rerender();
        },
      });
    },
    onChooseSubject: (subject) => {
      selectedSubject = subject;
      selectedPartName = null;
      mode = 'subject';
      rerender();
    },
    onChoosePart: (partName) => {
      selectedPartName = partName;
      rerender();
    },
    onBackTo: (targetMode) => {
      mode = targetMode;
      rerender();
    },
  };

  rerender();
}

function renderView(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'learning-management__header';

  const isEntryStep = mode === 'choose-class' || (mode === 'home' && state.singleClassroomMode);

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append(isEntryStep ? 'Back to Dashboard' : 'Back');
  backButton.addEventListener('click', () => {
    if (isEntryStep) return handlers.onBack();
    if (mode === 'subject' && state.selectedPartName) {
      // Back out of a Part's own units to that Subject's Part list,
      // not all the way home in one step.
      handlers.onChoosePart(null);
      return;
    }
    const previous = { home: 'choose-class', subject: 'home' }[mode];
    handlers.onBackTo(previous);
  });
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = '\ud83d\udcda Learning Management';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'choose-class') {
    wrapper.appendChild(renderChooseClassStep(state.classrooms, handlers));
  } else if (mode === 'subject') {
    wrapper.appendChild(renderSubjectStep(state.selectedSubject, state.selectedPartName, handlers));
  } else {
    wrapper.appendChild(renderHomeStep(state.selectedClassroom, handlers));
  }

  container.appendChild(wrapper);
}

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

/**
 * Data-driven — renders exactly
 * services/learningRecordService.js's own getSubjects(classroom).
 * A Subject is now genuinely clickable, navigating into its own
 * structure.
 */
function renderHomeStep(classroom, handlers) {
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
  addSubjectButton.addEventListener('click', handlers.onGoToAddSubject);
  section.appendChild(addSubjectButton);

  return section;
}

/**
 * Adapts to the Subject's own linked curriculum rather than forcing
 * a level that doesn't exist: a Subject whose Units carry more than
 * one distinct `partName` shows Parts first; anything else (no
 * Parts at all, or a Part already chosen) shows Units directly.
 * Units themselves are a plain list for now — Concepts are a later
 * milestone, not stubbed in here ahead of time.
 */
function renderSubjectStep(subject, selectedPartName, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = subject.title;
  section.appendChild(heading);

  const distinctPartNames = [...new Set(subject.units.map((unit) => unit.partName).filter(Boolean))];

  if (distinctPartNames.length > 0 && selectedPartName === null) {
    const partHeading = document.createElement('p');
    partHeading.className = 'learning-management__intro';
    partHeading.textContent = 'Parts';
    section.appendChild(partHeading);

    const grid = document.createElement('div');
    grid.className = 'learning-management__choice-grid';
    distinctPartNames.forEach((partName) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'learning-management__choice-option';
      button.textContent = partName;
      button.addEventListener('click', () => handlers.onChoosePart(partName));
      grid.appendChild(button);
    });
    section.appendChild(grid);
    return section;
  }

  const unitsToShow = selectedPartName ? subject.units.filter((unit) => unit.partName === selectedPartName) : subject.units;

  const unitsHeading = document.createElement('p');
  unitsHeading.className = 'learning-management__intro';
  unitsHeading.textContent = 'Units';
  section.appendChild(unitsHeading);

  const list = document.createElement('div');
  list.className = 'learning-management__subject-list';
  unitsToShow.forEach((unit) => {
    const item = document.createElement('p');
    item.className = 'learning-management__subject-list-item';
    item.textContent = unit.title;
    list.appendChild(item);
  });
  section.appendChild(list);

  return section;
}
