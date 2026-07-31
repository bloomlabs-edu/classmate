/**
 * ui/components/AddSubjectModal.js
 *
 * "Add Subject" — Choose Subject only. Creating a Subject and
 * assigning it a curriculum are two separate, explicit teacher
 * actions now, not one combined step (curriculum assignment lives in
 * ui/components/AssignCurriculumModal.js instead, triggered from the
 * Subject page once it exists). A Subject created here has
 * `linkedCurriculumIndexId: null` and `units: []` — "Science" appears
 * on the Learning Management home screen immediately, and shows "No
 * curriculum assigned" until a teacher deliberately assigns one
 * afterward.
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
 * Selecting a suggested subject, or confirming a custom one (Enter),
 * proceeds immediately — creates and persists the bare Subject right
 * there, no further step, no returning to Learning Management first.
 * `onSubjectAdded(subject)` is the one thing this file hands back to
 * its caller — everything about what happens once a Subject exists,
 * including assigning it a curriculum, is that caller's own concern.
 */

import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as workspaceService from '../../services/workspaceService.js';
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

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Choose Subject';
  modal.appendChild(heading);

  modal.appendChild(
    renderSubjectSelectionList({
      existingSubjectTitles,
      onSelect: (subjectName) => {
        const subject = learningRecordTeacherService.createSubject(classroom, { title: subjectName });
        workspaceService.save(classroom);
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
