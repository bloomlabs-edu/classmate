/**
 * ui/views/LearningManagementView.js
 *
 * Learning Management, rebuilt from a genuinely clean slate — the
 * previous implementation (and everything reachable only from it —
 * see the retired LearningRecordView.js and AddConceptsView.js) is
 * retired entirely, not patched further. This file builds up in
 * explicit, separately-approved milestones — nothing anticipated,
 * nothing stubbed in early.
 *
 * Milestone 1 (done): title, Back button, "+ Add Subject" with no
 * behavior at all.
 *
 * Milestone 2 (this file, right now): "+ Add Subject" opens Choose
 * Subject — reusing ui/components/SubjectPicker.js and
 * config/commonSubjectsConfig.js exactly as they already are, kept
 * specifically through the rebuild for this reason. The dialog
 * displays suggested subjects, allows a custom one, and can be
 * cancelled. This milestone validates that interaction only —
 * picking a subject (suggested or custom) does not create anything,
 * does not persist anything, does not link a curriculum, and does not
 * navigate anywhere beyond returning to this same home screen; a
 * console log is the only observable trace of a pick, there
 * specifically to confirm the picker's callback wiring is correct
 * without introducing any real effect. Choosing a subject and
 * cancelling are deliberately wired as two distinct handlers even
 * though both currently do the same thing (return home) — this is
 * what the next milestone will actually be able to build on, one
 * real behavior at a time.
 *
 * Not yet built, on purpose: persisting a chosen subject, rendering
 * it on the home screen, Choose Curriculum, and everything after it.
 *
 * Reused, unmodified: ui/components/SubjectPicker.js,
 * config/commonSubjectsConfig.js. Still untouched and waiting for a
 * later milestone: services/curriculumIndexRepository.js,
 * services/curriculumLinkingService.js, models/LearningSubject.js,
 * models/LearningUnit.js, models/LearningConcept.js,
 * services/learningRecordService.js / learningRecordTeacherService.js.
 */

import { createIcon } from '../components/Icon.js';
import { createSubjectPickerElement } from '../components/SubjectPicker.js';

export function renderLearningManagementView(container, { classrooms, onBack }) {
  let mode = 'home';

  function rerender() {
    renderView(container, mode, handlers);
  }

  const handlers = {
    onBack,
    onGoToChooseSubjectName: () => {
      mode = 'choose-subject-name';
      rerender();
    },
    onCancelChooseSubject: () => {
      mode = 'home';
      rerender();
    },
    /**
     * Deliberately does nothing but log and return home — no
     * services/learningRecordTeacherService.js call, no
     * services/workspaceService.js save, no
     * services/curriculumLinkingService.js call. This milestone is
     * only proving the picker calls back with the right subject
     * name, not building what happens next.
     */
    onChooseSubjectName: (subjectName) => {
      console.log('[LearningManagementView] Choose Subject picked (no persistence yet):', subjectName);
      mode = 'home';
      rerender();
    },
  };

  rerender();
}

function renderView(container, mode, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'learning-management__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  if (mode === 'home') {
    backButton.append('Back to Dashboard');
    backButton.addEventListener('click', handlers.onBack);
  } else {
    backButton.append('Back');
    backButton.addEventListener('click', handlers.onCancelChooseSubject);
  }
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = '\ud83d\udcda Learning Management';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'choose-subject-name') {
    wrapper.appendChild(renderChooseSubjectStep(handlers));
  } else {
    wrapper.appendChild(renderHomeStep(handlers));
  }

  container.appendChild(wrapper);
}

function renderHomeStep(handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--primary';
  addSubjectButton.textContent = '+ Add Subject';
  addSubjectButton.addEventListener('click', handlers.onGoToChooseSubjectName);
  section.appendChild(addSubjectButton);

  return section;
}

function renderChooseSubjectStep(handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = 'Choose Subject';
  section.appendChild(heading);

  section.appendChild(
    createSubjectPickerElement({
      existingSubjectTitles: [], // nothing persisted yet this milestone, so nothing to exclude
      otherButtonLabel: 'Custom Subject',
      onAddSubject: (subjectName) => handlers.onChooseSubjectName(subjectName),
    })
  );

  return section;
}
