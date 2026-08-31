/**
 * ui/components/AddSubjectModal.js
 *
 * "+ Add Subject" — Choose Subject, then done. A Subject is a real,
 * persisted classroom concept the moment it's named; it does not
 * require a curriculum to exist. Reverted back from the earlier
 * "Choose Subject -> Choose Curriculum, created only once both are
 * chosen" combined flow — that atomicity existed to avoid an
 * "incomplete" Subject with no curriculum, but it also meant a Subject
 * could never be created at all if curriculum matching produced zero
 * results (a real, confirmed dead end: a compatible Curriculum Index
 * genuinely existed but a teacher had no way to create the Subject and
 * assign it separately). Per the current, explicit architecture:
 *
 *   CURRICULUM RESOURCE (a Curriculum Index in the library) and
 *   CLASSROOM SUBJECT (this Subject) are two different things.
 *   CURRICULUM ASSIGNMENT (linking one to the other) is its own,
 *   always-available action — see ui/components/AssignCurriculumModal.js,
 *   reached from a Subject's own page (ui/views/LearningManagementView.js's
 *   renderSubjectStep()) via "Assign curriculum ->" whenever
 *   `curriculumState.status === 'none'`. This modal's only job is
 *   creating the Subject; assignment always happens there afterward,
 *   whether that's immediately (the common case) or later.
 *
 * Appended straight to `document.body`, entirely separate from
 * whatever container ui/views/LearningManagementView.js renders into.
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
 * `onSubjectAdded(subject)` fires the instant the Subject is created
 * and saved — the caller (ui/views/LearningManagementView.js) uses
 * this to land directly on that Subject's own page, where assigning a
 * curriculum (if one's available) is the natural next action.
 */

import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { logPersistenceEvent } from '../../services/persistenceLogger.js';
import { renderSubjectSelectionList } from './SubjectSelectionList.js';

export function openAddSubjectModal({ classroom, existingSubjectTitles, onSubjectAdded }) {
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
        onSelect: (chosenSubject) => {
          const { subjectId, title } = chosenSubject;
          const subject = learningRecordTeacherService.createSubject(classroom, { title, subjectId });
          logPersistenceEvent('Subject added', { classroomId: classroom.id, subjectTitle: title });
          workspaceService.markDirty(classroom.id);
          close();
          onSubjectAdded(subject);
        },
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

  renderChooseSubjectStep();
}
