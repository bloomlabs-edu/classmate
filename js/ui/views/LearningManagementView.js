/**
 * ui/views/LearningManagementView.js
 *
 * Learning Management, rebuilt from a genuinely clean slate — see
 * this file's own history in CHANGELOG.md for the full incremental
 * rebuild. The home screen's one responsibility: render exactly the
 * classroom's own persisted Subjects (via
 * ui/components/ExistingSubjectsList.js) and nothing else — no
 * suggestions, no placeholders, no empty-state copy of any kind.
 *
 * Creating a Subject (ui/components/AddSubjectModal.js) and assigning
 * it a curriculum (ui/components/AssignCurriculumModal.js) are two
 * separate, explicit teacher actions — a Subject appears on this home
 * screen the moment it's created, with no curriculum at all, and
 * shows "No curriculum assigned" on its own page until a teacher
 * deliberately assigns one. The data flow this maintains: Subject ->
 * Assigned Curriculum -> Units -> Concepts. A Subject never owns
 * Units independent of a curriculum; it has none until one is
 * assigned, and every Unit it then has is derived from that
 * curriculum's own data (see
 * services/curriculumLinkingService.js's assignCurriculumToSubject()),
 * not hardcoded here.
 *
 * Component hierarchy, and why the Subject Picker can never end up on
 * this home screen by accident:
 *
 *   LearningManagementView
 *   ├── ExistingSubjectsList     (persisted Subjects only — no
 *   │                             suggestion data, no fallback list)
 *   ├── "+ Add Subject" button   (trivial — stays inline here)
 *   ├── AddSubjectModal
 *   │     └── SubjectSelectionList  (the only file that imports
 *   │                                config/commonSubjectsConfig.js)
 *   └── AssignCurriculumModal    (opened from a Subject's own page,
 *                                  via ui/components/CurriculumMetadataLine.js)
 *
 * This file has no import reaching suggested-subject data anywhere in
 * its own tree — not directly, not transitively. That's what makes
 * "the home screen renders suggestions" structurally hard to
 * reintroduce by accident, not just currently untrue.
 *
 * Choose Class is back, minimally — skipped entirely when there's
 * only one classroom, the same "only ask when there's a real choice"
 * principle used throughout this app. Resolving a real,
 * currently-blocking gap (persistence needs a specific classroom),
 * not a speculative addition.
 *
 * Reused, unmodified: services/learningRecordService.js (reading
 * Subjects). Still untouched and waiting for a later milestone:
 * Concepts, the Resource Workspace.
 *
 * DEVELOPER UTILITIES: the home screen includes a temporary, clearly
 * marked "Developer Utilities" block with a "Reset Learning
 * Management (Current Classroom)" action — see
 * services/devLearningManagementResetService.js for exactly what it
 * does and does not touch. Remove that import, the block in
 * renderHomeStep(), and the service file itself before production;
 * everything is contained to make that removal a clean, three-part
 * deletion.
 */

import { createIcon } from '../components/Icon.js';
import { openAddSubjectModal } from '../components/AddSubjectModal.js';
import { openAssignCurriculumModal } from '../components/AssignCurriculumModal.js';
import { renderExistingSubjectsList } from '../components/ExistingSubjectsList.js';
import { renderCurriculumMetadataLine } from '../components/CurriculumMetadataLine.js';
import { getDisplayName } from '../../services/classroomService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as curriculumIndexRepository from '../../services/curriculumIndexRepository.js';
import { resetLearningManagementData } from '../../services/devLearningManagementResetService.js';

export function renderLearningManagementView(container, { classrooms, onBack, onOpenCurriculumManagement }) {
  const singleClassroomMode = classrooms.length === 1;

  let mode = singleClassroomMode ? 'home' : 'choose-class';
  let selectedClassroom = singleClassroomMode ? classrooms[0] : null;
  let selectedSubject = null;
  let selectedPartName = null; // set once a Part is chosen, for a Subject whose curriculum actually has them
  // Fetched once per Subject selection, not on every re-render — see
  // ui/components/CurriculumMetadataLine.js's own header comment for
  // why this lives here instead of inside that component. One of:
  // {status:'loading'} | {status:'ready', curriculumIndex} |
  // {status:'none'} | {status:'error'}.
  let selectedSubjectCurriculumState = null;

  function rerender() {
    renderView(
      container,
      mode,
      { classrooms, selectedClassroom, selectedSubject, selectedPartName, selectedSubjectCurriculumState, singleClassroomMode },
      handlers
    );
  }

  function loadCurriculumStateFor(subject) {
    if (!subject.linkedCurriculumIndexId) {
      selectedSubjectCurriculumState = { status: 'none' };
      rerender();
      return;
    }

    selectedSubjectCurriculumState = { status: 'loading' };
    rerender();
    curriculumIndexRepository
      .getIndex(subject.linkedCurriculumIndexId)
      .then((curriculumIndex) => {
        // A different Subject may have been opened while this was in
        // flight — don't let a stale response overwrite it.
        if (selectedSubject !== subject) return;
        selectedSubjectCurriculumState = curriculumIndex ? { status: 'ready', curriculumIndex } : { status: 'none' };
        rerender();
      })
      .catch((error) => {
        console.error('[LearningManagementView] Failed to load the Subject\u2019s linked Curriculum Index:', error);
        if (selectedSubject !== subject) return;
        selectedSubjectCurriculumState = { status: 'error' };
        rerender();
      });
  }

  const handlers = {
    onBack,
    onChooseClass: (classroom) => {
      selectedClassroom = classroom;
      mode = 'home';
      rerender();
    },
    onGoToAddSubject: () => {
      const existingSubjectTitles = learningRecordService.getSubjects(selectedClassroom).map((subject) => subject.title);
      openAddSubjectModal({
        classroom: selectedClassroom,
        existingSubjectTitles,
        onSubjectAdded: () => {
          // The modal already persisted and saved the Subject itself
          // (services/learningRecordTeacherService.js +
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
      loadCurriculumStateFor(subject);
    },
    onGoToAssignCurriculum: () => {
      openAssignCurriculumModal({
        classroom: selectedClassroom,
        subject: selectedSubject,
        onCurriculumAssigned: () => {
          // The modal already assigned and saved the curriculum
          // (services/curriculumLinkingService.js +
          // services/workspaceService.js) — reload this Subject's
          // curriculum state so Units now render from what was just
          // assigned.
          loadCurriculumStateFor(selectedSubject);
        },
        onOpenCurriculumManagement,
      });
    },
    onChoosePart: (partName) => {
      selectedPartName = partName;
      rerender();
    },
    onBackTo: (targetMode) => {
      mode = targetMode;
      rerender();
    },
    onRemoveSubject: (subject) => {
      const confirmed = window.confirm(`Remove "${subject.title}" from this classroom?\n\nThis removes its Units and Concepts. This cannot be undone.`);
      if (!confirmed) return;
      learningRecordTeacherService.deleteSubject(selectedClassroom, subject.id);
      workspaceService.save(selectedClassroom);
      // Whether this was triggered from the home list or from the
      // Subject's own page, there's no longer a Subject to show —
      // always land back on the home screen, not wherever we
      // happened to be.
      mode = 'home';
      rerender();
    },
    onResetLearningManagement: () => {
      const confirmed = window.confirm(
        'Reset Learning Management for this classroom?\n\nThis removes every Subject, Unit, Concept, and curriculum link for this classroom only. Students, attendance, and classroom settings are not affected. This cannot be undone.'
      );
      if (!confirmed) return;
      resetLearningManagementData(selectedClassroom);
      workspaceService.save(selectedClassroom);
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
    wrapper.appendChild(renderSubjectStep(state.selectedSubject, state.selectedSubjectCurriculumState, state.selectedPartName, handlers));
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
 * The home screen's one responsibility: render exactly the
 * classroom's own persisted Subjects, nothing else. Renders nothing
 * at all beyond "+ Add Subject" when there are none — no heading, no
 * empty-state copy, no suggestions.
 */
function renderHomeStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const subjects = learningRecordService.getSubjects(classroom);
  if (subjects.length > 0) {
    section.appendChild(renderExistingSubjectsList(subjects, handlers.onChooseSubject, handlers.onRemoveSubject));
  }

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--primary';
  addSubjectButton.textContent = '+ Add Subject';
  addSubjectButton.addEventListener('click', handlers.onGoToAddSubject);
  section.appendChild(addSubjectButton);

  section.appendChild(renderDeveloperUtilities(handlers));

  return section;
}

/**
 * DEVELOPER-ONLY — see services/devLearningManagementResetService.js's
 * own header comment for exactly what "Reset Learning Management"
 * does and does not touch. Remove this whole function, its one call
 * site above, and that service file before production.
 */
function renderDeveloperUtilities(handlers) {
  const devSection = document.createElement('div');
  devSection.className = 'learning-management__dev-utilities';

  const devHeading = document.createElement('p');
  devHeading.className = 'learning-management__dev-utilities-heading';
  devHeading.textContent = 'Developer Utilities';
  devSection.appendChild(devHeading);

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn btn--danger';
  resetButton.textContent = 'Reset Learning Management (Current Classroom)';
  resetButton.addEventListener('click', handlers.onResetLearningManagement);
  devSection.appendChild(resetButton);

  return devSection;
}

/**
 * Adapts to the Subject's own linked curriculum rather than forcing
 * a level that doesn't exist: a Subject whose Units carry more than
 * one distinct `partName` shows Parts first; anything else (no
 * Parts at all, or a Part already chosen) shows Units directly.
 * Units themselves are a plain list for now — Concepts are a later
 * milestone, not stubbed in here ahead of time.
 *
 * The curriculum metadata line (see
 * ui/components/CurriculumMetadataLine.js) always renders directly
 * beneath the title, per the frozen design — quiet, always present,
 * never its own card. `curriculumState` is fetched once, in
 * renderLearningManagementView()'s onChooseSubject handler, and
 * cached there — this function is a pure, synchronous render of
 * whatever that state currently is, deliberately not an async fetch
 * of its own. Navigating between Parts re-renders this function
 * repeatedly (every onChoosePart call), and a fetch living here would
 * mean re-fetching, and re-flashing "Loading…", on every single one
 * of those clicks for data that never changed.
 *
 * Units/Parts render only once curriculumState confirms a curriculum
 * actually exists ('ready'); for every other status ('loading',
 * 'none', 'error') this section is simply absent, per the frozen
 * design's "Units remain unavailable until [a curriculum is chosen]."
 *
 * "Remove Subject" is available here too, not just on the home
 * screen's own list (ui/components/ExistingSubjectsList.js) —
 * regardless of curriculum state, since it's a general
 * subject-management action, not tied to whether a curriculum happens
 * to be assigned yet.
 */
function renderSubjectStep(subject, curriculumState, selectedPartName, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = subject.title;
  section.appendChild(heading);

  const metadataSlot = document.createElement('div');
  renderCurriculumMetadataLine(metadataSlot, { curriculumState, onAssignCurriculum: handlers.onGoToAssignCurriculum });
  section.appendChild(metadataSlot);

  const divider = document.createElement('hr');
  divider.className = 'learning-management__subject-divider';
  section.appendChild(divider);

  if (curriculumState.status === 'ready') {
    section.appendChild(renderUnitsOrParts(subject, selectedPartName, handlers));
  }

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn--danger-text learning-management__subject-remove';
  removeButton.textContent = 'Remove Subject';
  removeButton.addEventListener('click', () => handlers.onRemoveSubject(subject));
  section.appendChild(removeButton);

  return section;
}

function renderUnitsOrParts(subject, selectedPartName, handlers) {
  const wrapper = document.createElement('div');

  const distinctPartNames = [...new Set(subject.units.map((unit) => unit.partName).filter(Boolean))];

  if (distinctPartNames.length > 0 && selectedPartName === null) {
    const partHeading = document.createElement('p');
    partHeading.className = 'learning-management__intro';
    partHeading.textContent = 'Parts';
    wrapper.appendChild(partHeading);

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
    wrapper.appendChild(grid);
    return wrapper;
  }

  const unitsToShow = selectedPartName ? subject.units.filter((unit) => unit.partName === selectedPartName) : subject.units;

  const unitsHeading = document.createElement('p');
  unitsHeading.className = 'learning-management__intro';
  unitsHeading.textContent = 'Units';
  wrapper.appendChild(unitsHeading);

  const list = document.createElement('div');
  list.className = 'learning-management__subject-list';
  unitsToShow.forEach((unit) => {
    const item = document.createElement('p');
    item.className = 'learning-management__subject-list-item';
    item.textContent = unit.title;
    list.appendChild(item);
  });
  wrapper.appendChild(list);

  return wrapper;
}
