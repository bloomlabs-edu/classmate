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
 * Milestone 2 (superseded by this one): "+ Add Subject" originally
 * navigated to a full-screen Choose Subject step. That's been
 * replaced — a teacher now stays on this exact page the whole time;
 * "+ Add Subject" opens ui/components/ChooseSubjectModal.js as a
 * centered overlay instead. This page itself no longer has any modes
 * or steps of its own at all — it's just the one screen, plus
 * whatever the modal shows on top of it.
 *
 * Milestone 3 (this one, right now): the modal — a selectable list of
 * suggested subjects, "Custom Subject" as the list's own final row,
 * an inert search placeholder, and Cancel/Next actions. See that
 * file's own header comment for the full interaction. Still no
 * persistence, no curriculum linking: `onNext` only logs the chosen
 * subject name and does nothing else — Choose Curriculum is a later,
 * separately-approved milestone.
 *
 * Not yet built, on purpose: persisting a chosen subject, rendering
 * it on the home screen, Choose Curriculum, and everything after it.
 *
 * Reused, unmodified: ui/components/ChooseSubjectModal.js,
 * config/commonSubjectsConfig.js. ui/components/SubjectPicker.js is
 * untouched and still available for other uses, just not this one —
 * this modal's list-of-selectable-rows interaction is a different
 * shape than that component's chips, so it's a new component rather
 * than a reskin. Still untouched and waiting for a later milestone:
 * services/curriculumIndexRepository.js,
 * services/curriculumLinkingService.js, models/LearningSubject.js,
 * models/LearningUnit.js, models/LearningConcept.js,
 * services/learningRecordService.js / learningRecordTeacherService.js.
 */

import { createIcon } from '../components/Icon.js';
import { openChooseSubjectModal } from '../components/ChooseSubjectModal.js';

export function renderLearningManagementView(container, { classrooms, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'learning-management__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back to Dashboard');
  backButton.addEventListener('click', onBack);
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = '\ud83d\udcda Learning Management';
  header.appendChild(title);

  wrapper.appendChild(header);

  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--primary';
  addSubjectButton.textContent = '+ Add Subject';
  addSubjectButton.addEventListener('click', () => {
    openChooseSubjectModal({
      /**
       * Deliberately does nothing but log — no
       * services/learningRecordTeacherService.js call, no
       * services/workspaceService.js save, no
       * services/curriculumLinkingService.js call, and no navigation
       * to a Choose Curriculum step. This milestone is only proving
       * the modal's own interaction works, not building what happens
       * after it.
       */
      onNext: (subjectName) => {
        console.log('[LearningManagementView] Choose Subject: Next clicked (no persistence yet):', subjectName);
      },
      onCancel: () => {
        // The modal has already closed itself; the page underneath
        // never changed, so there's genuinely nothing else to do.
      },
    });
  });
  section.appendChild(addSubjectButton);

  wrapper.appendChild(section);

  container.appendChild(wrapper);
}
