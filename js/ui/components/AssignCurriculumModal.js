/**
 * ui/components/AssignCurriculumModal.js
 *
 * "Assign curriculum →" — the always-available, explicit action for
 * connecting a curriculum to a Subject, separate from creating the
 * Subject itself (see ui/components/AddSubjectModal.js, which now
 * only ever creates a bare Subject — never a curriculum together with
 * it). Triggered from the Subject page
 * (ui/views/LearningManagementView.js's renderSubjectStep()) whenever
 * `curriculumState.status === 'none'` — the normal state for any
 * freshly-created Subject, not just a legacy/defensive edge case.
 * Shows which of the teacher's own Curriculum Indexes match this
 * Subject's own canonical subjectId (see
 * services/curriculumLinkingService.js's
 * findAvailableCurriculumIndexesForSubject()), as real radio inputs,
 * with the Subject's name echoed above them.
 *
 * Deliberately always shows this screen and requires an explicit
 * confirm click — even when only one Curriculum Index matches — per
 * explicit instruction: "the important part is that the teacher
 * chooses it." This is a different rule than "+ Add Subject"'s own
 * Choose Subject step, which proceeds immediately on a single click;
 * assigning a curriculum is a real, considered decision a teacher is
 * making about an already-named Subject, not a quick pick from a
 * list of names.
 *
 * Zero matches shows an actionable state — "Open Curriculum
 * Management" — rather than a dead end.
 *
 * Only the final "Assign Curriculum" confirm action here
 * (services/curriculumLinkingService.js's assignCurriculumToSubject(),
 * followed by services/workspaceService.js's save()) changes
 * anything. `onCurriculumAssigned()` is the one thing this file hands
 * back to its caller — everything about refreshing what the Subject
 * page shows afterward is that caller's own concern.
 */

import * as curriculumIndexRepository from '../../services/curriculumIndexRepository.js';
import * as curriculumLinkingService from '../../services/curriculumLinkingService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { logPersistenceEvent } from '../../services/persistenceLogger.js';

export function openAssignCurriculumModal({ classroom, subject, onCurriculumAssigned, onOpenCurriculumManagement }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Assign Curriculum');

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Assign Curriculum';
  modal.appendChild(heading);

  const subjectLabel = document.createElement('p');
  subjectLabel.className = 'modal__label';
  const subjectNameEl = document.createElement('strong');
  subjectNameEl.className = 'choose-subject-modal__subject-name';
  subjectNameEl.textContent = subject.title;
  subjectLabel.append('Subject:', subjectNameEl);
  modal.appendChild(subjectLabel);

  const loadingNote = document.createElement('p');
  loadingNote.className = 'modal__description';
  loadingNote.textContent = 'Loading\u2026';
  modal.appendChild(loadingNote);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);
  actions.appendChild(cancelButton);
  modal.appendChild(actions);

  curriculumIndexRepository
    .listIndexes()
    .then((allIndexes) => {
      loadingNote.remove();
      const matches = curriculumLinkingService.findAvailableCurriculumIndexesForSubject(classroom, allIndexes, subject.subjectId);

      if (matches.length === 0) {
        const emptyNote = document.createElement('p');
        emptyNote.className = 'modal__description';
        emptyNote.textContent = `No curriculum is set up for ${subject.title} yet.`;
        modal.insertBefore(emptyNote, actions);

        const openCurriculumManagementButton = document.createElement('button');
        openCurriculumManagementButton.type = 'button';
        openCurriculumManagementButton.className = 'btn btn--primary';
        openCurriculumManagementButton.textContent = 'Open Curriculum Library';
        openCurriculumManagementButton.addEventListener('click', () => {
          close();
          onOpenCurriculumManagement();
        });
        actions.prepend(openCurriculumManagementButton);
        return;
      }

      // Deliberately always shown, even with exactly one match — see
      // this file's own header comment for why this differs from
      // Add Subject's own auto-proceeding behavior.
      const optionsList = document.createElement('div');
      optionsList.className = 'choose-subject-modal__radio-list';
      let selectedIndex = null;

      matches.forEach((index, i) => {
        const optionRow = document.createElement('label');
        optionRow.className = 'choose-subject-modal__radio-row';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'assign-curriculum-option';
        radio.value = index.id;
        radio.id = `assign-curriculum-option-${i}`;
        radio.addEventListener('change', () => {
          selectedIndex = index;
          confirmButton.disabled = !selectedIndex;
        });

        const labelText = document.createElement('span');
        labelText.textContent = `${index.curriculum.name} \u2022 ${index.curriculum.grade}`;

        optionRow.append(radio, labelText);
        optionsList.appendChild(optionRow);
      });
      modal.insertBefore(optionsList, actions);

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'btn btn--primary';
      confirmButton.textContent = 'Assign Curriculum';
      confirmButton.disabled = true;
      confirmButton.addEventListener('click', () => {
        if (!selectedIndex) return;
        curriculumLinkingService.assignCurriculumToSubject(classroom, subject, selectedIndex);
        logPersistenceEvent('Curriculum assigned', { classroomId: classroom.id, subjectTitle: subject.title });
        workspaceService.markDirty(classroom.id);
        close();
        onCurriculumAssigned();
      });
      actions.prepend(confirmButton);
    })
    .catch((error) => {
      console.error('[AssignCurriculumModal] Failed to load Curriculum Indexes:', error);
      loadingNote.textContent = "Couldn't load available curricula. Check your connection and try again.";
    });
}
