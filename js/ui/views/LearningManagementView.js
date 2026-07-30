/**
 * ui/views/LearningManagementView.js
 *
 * Learning Management, rebuilt from scratch. The previous
 * implementation accumulated navigation modes and assumptions across
 * many milestones (a full Curriculum Explorer, a Library-pack source,
 * a "Manage full syllabus" hand-off, diagnostic instrumentation from
 * chasing a bug) until incremental patches were no longer the
 * cleanest way to move forward — this file replaces it entirely
 * rather than patching it further, per that explicit decision.
 *
 * Deliberately a minimal, working vertical slice right now, nothing
 * more:
 *
 *   Learning Management -> Add Subject -> Choose Subject
 *     -> Choose Curriculum -> the Subject appears on the home screen
 *
 * Parts, Units, Concepts, and the existing Resource Workspace are NOT
 * wired in yet — a Subject shown on the home screen today has nothing
 * to click into. That is this slice's actual scope, not a gap to
 * silently work around; each of those gets added as its own,
 * separately validated increment on top of this one.
 *
 * Reused as-is, unmodified, because each is already a clean, general
 * building block with no baked-in assumption this rebuild conflicts
 * with: services/learningRecordService.js (reading Subjects),
 * services/curriculumIndexRepository.js (a teacher's own Curriculum
 * Indexes), services/curriculumLinkingService.js (matching a chosen
 * subject name to a curriculum and creating the LearningSubject/Units
 * from it), services/workspaceService.js (persistence), and
 * ui/components/SubjectPicker.js (the common-subject-name buttons +
 * free-text fallback). Nothing about *navigation state* — modes,
 * steps, back-chains — is carried over from the retired file; that
 * part is written fresh here.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as curriculumIndexRepository from '../../services/curriculumIndexRepository.js';
import * as curriculumLinkingService from '../../services/curriculumLinkingService.js';
import { getDisplayName } from '../../services/classroomService.js';
import { createIcon } from '../components/Icon.js';
import { createSubjectPickerElement } from '../components/SubjectPicker.js';

export function renderLearningManagementView(container, { classrooms, onBack }) {
  // Choose Class only earns its place when there's an actual choice
  // to make — a teacher running one classroom should never be asked
  // to pick it.
  const singleClassroomMode = classrooms.length === 1;

  let mode = singleClassroomMode ? 'home' : 'choose-class';
  let selectedClassroom = singleClassroomMode ? classrooms[0] : null;
  let chosenSubjectName = null; // set in Choose Subject, read by Choose Curriculum

  function rerender() {
    renderView(
      container,
      mode,
      { classrooms, selectedClassroom, chosenSubjectName, singleClassroomMode },
      handlers
    );
  }

  const handlers = {
    onBack,
    onChooseClass: (classroom) => {
      selectedClassroom = classroom;
      mode = 'home';
      rerender();
    },
    onGoToChooseSubjectName: () => {
      mode = 'choose-subject-name';
      rerender();
    },
    /**
     * A teacher is never asked to confirm a choice that isn't
     * actually a choice: if exactly one Curriculum Index matches the
     * chosen subject name, it's linked immediately and Choose
     * Curriculum is skipped entirely, the same principle Choose
     * Class already applies for a single classroom.
     */
    onChooseSubjectName: async (subjectName) => {
      chosenSubjectName = subjectName;
      try {
        const allIndexes = await curriculumIndexRepository.listIndexes();
        const matches = curriculumLinkingService.findAvailableCurriculumIndexesForSubject(selectedClassroom, allIndexes, subjectName);
        if (matches.length === 1) {
          curriculumLinkingService.linkCurriculumIndex(selectedClassroom, matches[0], subjectName);
          workspaceService.save(selectedClassroom);
          mode = 'home';
        } else {
          mode = 'choose-curriculum';
        }
      } catch (error) {
        console.error('[LearningManagementView] Failed to load Curriculum Indexes:', error);
        mode = 'choose-curriculum';
      }
      rerender();
    },
    onChooseCurriculumForSubject: (curriculumIndex, subjectName) => {
      curriculumLinkingService.linkCurriculumIndex(selectedClassroom, curriculumIndex, subjectName);
      workspaceService.save(selectedClassroom);
      mode = 'home';
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
    const previous = {
      home: 'choose-class',
      'choose-subject-name': 'home',
      'choose-curriculum': 'choose-subject-name',
    }[mode];
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
  } else if (mode === 'home') {
    wrapper.appendChild(renderHomeStep(state.selectedClassroom, handlers));
  } else if (mode === 'choose-subject-name') {
    wrapper.appendChild(renderChooseSubjectNameStep(state.selectedClassroom, handlers));
  } else if (mode === 'choose-curriculum') {
    wrapper.appendChild(renderChooseCurriculumStep(state.selectedClassroom, state.chosenSubjectName, handlers));
  }

  container.appendChild(wrapper);
}

// ---- Choose Class -------------------------------------------------------

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

// ---- Home: the classroom's existing Subjects, and Add Subject -----------

/**
 * Data-driven, and only that — renders exactly
 * services/learningRecordService.js's own getSubjects(classroom),
 * nothing precomputed, nothing default. A brand-new classroom's own
 * Subjects array is genuinely empty, so this renders nothing here but
 * "+ Add Subject" — no heading, no empty-state copy, "nothing else."
 * A Subject shown here isn't yet clickable to anything (Parts/Units/
 * Concepts/Resources are later increments), so these render as plain
 * text, not buttons — nothing here should look actionable before it
 * actually is.
 */
function renderHomeStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const subjects = learningRecordService.getSubjects(classroom);
  if (subjects.length > 0) {
    const list = document.createElement('div');
    list.className = 'learning-management__subject-list';
    subjects.forEach((subject) => {
      const item = document.createElement('p');
      item.className = 'learning-management__subject-list-item';
      item.textContent = subject.title;
      list.appendChild(item);
    });
    section.appendChild(list);
  }

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--primary';
  addSubjectButton.textContent = '+ Add Subject';
  addSubjectButton.addEventListener('click', handlers.onGoToChooseSubjectName);
  section.appendChild(addSubjectButton);

  return section;
}

// ---- Choose Subject: a plain subject name, nothing about curricula yet --

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

// ---- Choose Curriculum: which of the teacher's own curricula backs it ---

/**
 * Skipped entirely when exactly one Curriculum Index matches (see
 * onChooseSubjectName above) — reached only on a genuine choice: zero
 * matches (nothing to link yet) or two or more (a real curriculum to
 * pick between). Options show only each curriculum's own name
 * ("Samacheer Kalvi," "NCERT") — the subject name was just chosen in
 * the previous step and is never repeated here.
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
