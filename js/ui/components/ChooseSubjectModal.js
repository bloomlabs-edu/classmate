/**
 * ui/components/ChooseSubjectModal.js
 *
 * "Choose Subject" -> "Choose Curriculum" -> a real, persisted
 * Subject — one continuous modal overlay, not page navigation, per
 * the explicit "guided workflow" instruction. Both steps render
 * within the same overlay/shell, swapping only their inner content —
 * never closing and reopening a second modal — which is what actually
 * keeps this feeling like one workflow rather than two separate
 * dialogs in sequence.
 *
 * No "coming soon" messaging anywhere in this file, by explicit
 * instruction — search was removed entirely rather than kept as an
 * inert placeholder; it will be added back as a real, working field
 * when it's actually implemented, not before.
 *
 * Step 1, Choose Subject: unchanged in shape from the previous
 * milestone — a selectable list of config/commonSubjectsConfig.js's
 * COMMON_SUBJECTS, "Custom Subject" as the list's own final row.
 *
 * Step 2, Choose Curriculum: reuses
 * services/curriculumLinkingService.js's
 * findAvailableCurriculumIndexesForSubject() to find which of the
 * teacher's own Curriculum Indexes could back the chosen subject
 * name. A teacher is never asked to confirm a choice that isn't
 * actually a choice: exactly one match links immediately, skipping
 * this step entirely, the same "only ask when there's a real choice"
 * principle already used throughout this app (Choose Class, Choose
 * Subject's own "Next" gating). Zero matches still shows this step,
 * with an honest message and a way back — not a dead end.
 *
 * Only Step 2's own confirm action
 * (services/curriculumLinkingService.js's linkCurriculumIndex(),
 * followed by services/workspaceService.js's save()) actually
 * creates and persists a Subject. `onSubjectAdded(subject)` is the
 * one thing this file hands back to its caller (see
 * ui/views/LearningManagementView.js) — everything about what
 * happens after a Subject exists is that caller's own concern.
 */

import { COMMON_SUBJECTS } from '../../config/commonSubjectsConfig.js';
import * as curriculumIndexRepository from '../../services/curriculumIndexRepository.js';
import * as curriculumLinkingService from '../../services/curriculumLinkingService.js';
import * as workspaceService from '../../services/workspaceService.js';

export function openChooseSubjectModal({ classroom, onSubjectAdded }) {
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

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = 'Choose Subject';
    modal.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'choose-subject-modal__list';

    let selectedSubjectName = null;
    const rowElements = [];

    function selectRow(rowEl, subjectName) {
      rowElements.forEach((el) => el.classList.remove('choose-subject-modal__row--selected'));
      rowEl.classList.add('choose-subject-modal__row--selected');
      selectedSubjectName = subjectName;
      nextButton.disabled = !selectedSubjectName;
    }

    COMMON_SUBJECTS.forEach((subjectName) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'choose-subject-modal__row';
      row.textContent = subjectName;
      row.addEventListener('click', () => selectRow(row, subjectName));
      rowElements.push(row);
      list.appendChild(row);
    });

    const customRow = document.createElement('button');
    customRow.type = 'button';
    customRow.className = 'choose-subject-modal__row choose-subject-modal__row--custom';
    customRow.textContent = 'Custom Subject';
    rowElements.push(customRow);

    const customFieldWrapper = document.createElement('div');
    customFieldWrapper.className = 'choose-subject-modal__custom-field';
    customFieldWrapper.hidden = true;

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'modal__input';
    customInput.placeholder = 'Type a subject name';
    customInput.addEventListener('input', () => {
      selectedSubjectName = customInput.value.trim() || null;
      nextButton.disabled = !selectedSubjectName;
    });
    customFieldWrapper.appendChild(customInput);

    customRow.addEventListener('click', () => {
      rowElements.forEach((el) => el.classList.remove('choose-subject-modal__row--selected'));
      customRow.classList.add('choose-subject-modal__row--selected');
      customFieldWrapper.hidden = false;
      customInput.focus();
      selectedSubjectName = customInput.value.trim() || null;
      nextButton.disabled = !selectedSubjectName;
    });

    list.appendChild(customRow);
    list.appendChild(customFieldWrapper);
    modal.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'btn btn--primary';
    nextButton.textContent = 'Next';
    nextButton.disabled = true;
    nextButton.addEventListener('click', () => {
      if (!selectedSubjectName) return;
      renderChooseCurriculumStep(selectedSubjectName);
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', close);

    actions.append(nextButton, cancelButton);
    modal.appendChild(actions);
  }

  function renderChooseCurriculumStep(subjectName) {
    modal.innerHTML = '';

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = 'Choose Curriculum';
    modal.appendChild(heading);

    const loadingNote = document.createElement('p');
    loadingNote.className = 'modal__description';
    loadingNote.textContent = 'Loading\u2026';
    modal.appendChild(loadingNote);

    const backAndCancel = document.createElement('div');
    backAndCancel.className = 'modal__actions';
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
    backAndCancel.append(backButton, cancelButton);
    modal.appendChild(backAndCancel);

    curriculumIndexRepository
      .listIndexes()
      .then((allIndexes) => {
        const matches = curriculumLinkingService.findAvailableCurriculumIndexesForSubject(classroom, allIndexes, subjectName);

        // Never ask when there's no real choice — exactly one match
        // links immediately, the same principle already used for
        // Choose Class and this modal's own Next button.
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
          emptyNote.textContent = `No curricula available for ${subjectName} yet \u2014 build one in Curriculum Management first.`;
          modal.insertBefore(emptyNote, backAndCancel);
          return;
        }

        const list = document.createElement('div');
        list.className = 'choose-subject-modal__list';
        let selectedIndex = null;
        const rowElements = [];

        matches.forEach((index) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'choose-subject-modal__row';
          row.textContent = index.curriculum.name;
          row.addEventListener('click', () => {
            rowElements.forEach((el) => el.classList.remove('choose-subject-modal__row--selected'));
            row.classList.add('choose-subject-modal__row--selected');
            selectedIndex = index;
            addSubjectButton.disabled = !selectedIndex;
          });
          rowElements.push(row);
          list.appendChild(row);
        });
        modal.insertBefore(list, backAndCancel);

        const addSubjectButton = document.createElement('button');
        addSubjectButton.type = 'button';
        addSubjectButton.className = 'btn btn--primary';
        addSubjectButton.textContent = 'Add Subject';
        addSubjectButton.disabled = true;
        addSubjectButton.addEventListener('click', () => {
          if (!selectedIndex) return;
          const subject = curriculumLinkingService.linkCurriculumIndex(classroom, selectedIndex, subjectName);
          workspaceService.save(classroom);
          close();
          onSubjectAdded(subject);
        });
        backAndCancel.prepend(addSubjectButton);
      })
      .catch((error) => {
        console.error('[ChooseSubjectModal] Failed to load Curriculum Indexes:', error);
        loadingNote.textContent = "Couldn't load available curricula. Check your connection and try again.";
      });
  }

  renderChooseSubjectStep();
}
