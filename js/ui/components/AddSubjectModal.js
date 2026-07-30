/**
 * ui/components/AddSubjectModal.js
 *
 * "Add Subject" — Choose Subject, then Choose Curriculum — as one
 * continuous overlay, not page navigation. Both steps render within
 * this same modal shell, swapping only their inner content; the
 * overlay is appended straight to `document.body`, entirely separate
 * from whatever container ui/views/LearningManagementView.js renders
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
 * Choose Subject: selecting a suggested subject, or confirming a
 * custom one (Enter), proceeds immediately — no returning to Learning
 * Management in between, per explicit instruction.
 *
 * Choose Curriculum: which of the teacher's own Curriculum Indexes
 * backs the chosen subject name (see
 * services/curriculumLinkingService.js's
 * findAvailableCurriculumIndexesForSubject()). Shown as real radio
 * inputs, one group, with the chosen subject name echoed above them
 * so a teacher is never confirming a curriculum without being
 * reminded what it's for. A teacher is never asked to confirm a
 * choice that isn't actually a choice: exactly one match links
 * immediately, skipping this step entirely; zero matches shows an
 * actionable state — "Open Curriculum Management" — rather than a
 * dead end.
 *
 * Only the final confirm action here
 * (services/curriculumLinkingService.js's linkCurriculumIndex(),
 * followed by services/workspaceService.js's save()) creates and
 * persists anything. `onSubjectAdded(subject)` is the one thing this
 * file hands back to its caller — everything about what happens once
 * a Subject exists is that caller's own concern, not this file's.
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
        onSelect: (subjectName) => renderChooseCurriculumStep(subjectName),
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

  function renderChooseCurriculumStep(subjectName) {
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
        const matches = curriculumLinkingService.findAvailableCurriculumIndexesForSubject(classroom, allIndexes, subjectName);

        // Never ask when there's no real choice.
        if (matches.length === 1) {
          const subject = curriculumLinkingService.linkCurriculumIndex(classroom, matches[0], subjectName);
          workspaceService.save(classroom);
          close();
          onSubjectAdded(subject);
          return;
        }

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
          labelText.textContent = `${index.curriculum.name} ${index.curriculum.grade}`;

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
          const subject = curriculumLinkingService.linkCurriculumIndex(classroom, selectedIndex, subjectName);
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
