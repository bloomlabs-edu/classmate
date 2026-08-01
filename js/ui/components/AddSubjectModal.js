/**
 * ui/components/AddSubjectModal.js
 *
 * "+ Add Subject" — Choose Subject, then Choose Curriculum, as one
 * continuous modal overlay. Reverted per explicit product decision:
 * a Subject is not created until the teacher successfully selects a
 * curriculum — no "incomplete" Subject ever exists with a name but no
 * curriculum. If the teacher cancels curriculum selection (Cancel, or
 * closing the modal), nothing is created at all, because
 * services/curriculumLinkingService.js's createSubjectWithCurriculum()
 * is the only thing that ever persists anything here, and it's only
 * ever called from the final confirm action below.
 *
 * Appended straight to `document.body`, entirely separate from
 * whatever container ui/views/LearningManagementView.js renders
 * into, which is what actually keeps a teacher "on the Learning
 * Management page" rather than just visually implying it.
 *
 * Component hierarchy, and the safeguard it provides: this file is
 * the *only* place ui/components/SubjectSelectionList.js is ever
 * rendered from, and that file is the *only* file in this whole
 * workflow that imports config/commonSubjectsConfig.js. Neither
 * ui/views/LearningManagementView.js nor
 * ui/components/ExistingSubjectsList.js has any import that reaches
 * suggested-subject data — the home screen structurally cannot
 * render a subject picker by accident, because nothing in its own
 * import graph leads there.
 *
 * Step 1, Choose Subject: selecting a suggested subject, or
 * confirming a custom one (Enter), advances immediately to Choose
 * Curriculum within this same modal — it does not create anything
 * yet and does not return to Learning Management.
 *
 * Step 2, Choose Curriculum: which of the teacher's own Curriculum
 * Indexes match the chosen subject name (see
 * services/curriculumLinkingService.js's
 * findAvailableCurriculumIndexesForSubject()), shown as real radio
 * inputs with the chosen subject name echoed above them. Always shown
 * and always requires an explicit confirm click, even with exactly
 * one match — a teacher is never auto-assigned a curriculum, only
 * ever choosing one deliberately. Zero matches shows an actionable
 * state — "Open Curriculum Management" — rather than a dead end, and
 * still creates nothing.
 *
 * `onSubjectAdded(subject)` fires only after the final confirm click
 * actually succeeds — everything about what happens once a Subject
 * exists is the caller's own concern, not this file's.
 */

import * as curriculumIndexRepository from '../../services/curriculumIndexRepository.js';
import * as curriculumLinkingService from '../../services/curriculumLinkingService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { renderSubjectSelectionList } from './SubjectSelectionList.js';

export function openAddSubjectModal({ classroom, existingSubjectTitles, onSubjectAdded, onOpenCurriculumManagement }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Choose Subject');

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  function renderChooseSubjectStep() {
    modal.innerHTML = '';
    modal.setAttribute('aria-label', 'Choose Subject');

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = 'Choose Subject';
    modal.appendChild(heading);

    modal.appendChild(
      renderSubjectSelectionList({
        existingSubjectTitles,
        onSelect: (chosenSubject) => renderChooseCurriculumStep(chosenSubject),
      })
    );

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', close);
    actions.appendChild(cancelButton);
    modal.appendChild(actions);
  }

  function renderChooseCurriculumStep(chosenSubject) {
    const { subjectId, title: subjectName } = chosenSubject;
    modal.innerHTML = '';
    modal.setAttribute('aria-label', 'Choose Curriculum');

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = 'Choose Curriculum';
    modal.appendChild(heading);

    const subjectLabel = document.createElement('p');
    subjectLabel.className = 'modal__label';
    const subjectNameEl = document.createElement('strong');
    subjectNameEl.className = 'choose-subject-modal__subject-name';
    subjectNameEl.textContent = subjectName;
    subjectLabel.append('Subject:', subjectNameEl);
    modal.appendChild(subjectLabel);

    const loadingNote = document.createElement('p');
    loadingNote.className = 'modal__description';
    loadingNote.textContent = 'Loading\u2026';
    modal.appendChild(loadingNote);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'btn btn--text';
    backButton.textContent = 'Back';
    backButton.addEventListener('click', renderChooseSubjectStep);
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', close);
    actions.append(backButton, cancelButton);
    modal.appendChild(actions);

    curriculumIndexRepository
      .listIndexes()
      .then((allIndexes) => {
        // No Subject exists yet in this flow, so there's nothing
        // classroom-side to exclude beyond curricula already used by
        // OTHER Subjects — findAvailableCurriculumIndexesForSubject
        // already handles that. Matched by subjectId, never by
        // subjectName — see services/curriculumLinkingService.js's own
        // header comment for why this is the actual fix for a real,
        // confirmed bug where two independently-typed subject text
        // fields silently failed to match.
        const matches = curriculumLinkingService.findAvailableCurriculumIndexesForSubject(classroom, allIndexes, subjectId);

        loadingNote.remove();

        if (matches.length === 0) {
          const emptyNote = document.createElement('p');
          emptyNote.className = 'modal__description';
          emptyNote.textContent = `No curriculum is available for ${subjectName}. You need to create a ${subjectName} curriculum before this subject can be added.`;
          modal.insertBefore(emptyNote, actions);

          const openCurriculumManagementButton = document.createElement('button');
          openCurriculumManagementButton.type = 'button';
          openCurriculumManagementButton.className = 'btn btn--primary';
          openCurriculumManagementButton.textContent = 'Open Curriculum Management';
          openCurriculumManagementButton.addEventListener('click', () => {
            close();
            onOpenCurriculumManagement();
          });
          actions.prepend(openCurriculumManagementButton);
          return;
        }

        // Always shown, even with exactly one match — a teacher is
        // never auto-assigned a curriculum, only ever choosing one
        // explicitly.
        const optionsList = document.createElement('div');
        optionsList.className = 'choose-subject-modal__radio-list';
        let selectedIndex = null;

        matches.forEach((index, i) => {
          const optionRow = document.createElement('label');
          optionRow.className = 'choose-subject-modal__radio-row';

          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'choose-curriculum-option';
          radio.value = index.id;
          radio.id = `choose-curriculum-option-${i}`;
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
        confirmButton.textContent = 'Add Subject';
        confirmButton.disabled = true;
        confirmButton.addEventListener('click', () => {
          if (!selectedIndex) return;
          // Nothing is created until this exact moment — createSubjectWithCurriculum()
          // builds the complete Subject (curriculum link + every Unit)
          // atomically and pushes it in one step.
          const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, subjectName, subjectId, selectedIndex);
          workspaceService.save(classroom);
          close();
          onSubjectAdded(subject);
        });
        actions.prepend(confirmButton);
      })
      .catch((error) => {
        console.error('[AddSubjectModal] Failed to load Curriculum Indexes:', error);
        loadingNote.textContent = "Couldn't load available curricula. Check your connection and try again.";
      });
  }

  renderChooseSubjectStep();
}
