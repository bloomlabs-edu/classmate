/**
 * ui/components/AssignCurriculumToClassroomModal.js
 *
 * "Assign Curriculum" — Path B of the two curriculum-assignment entry
 * points (see services/curriculumLinkingService.js's own header
 * comment): reached from a Curriculum Index's own detail page
 * (ui/views/CurriculumManagementView.js's renderIndexReviewUnitsStep())
 * rather than from a Subject's page. "Choose classroom/subject" here,
 * then Assign — using the exact same underlying relationship Path A's
 * ui/components/AssignCurriculumModal.js already reads and writes
 * (services/curriculumLinkingService.js's findAssignableSubjectForCurriculum()/
 * assignCurriculumToSubject()/createSubjectWithCurriculum()/
 * isCurriculumIndexLinked()). No second assignment mechanism.
 *
 * One row per classroom, each showing its own real status up front —
 * "Already assigned to X", "Assign to X", or "Create '{subject}' and
 * assign" — rather than a second "choose classroom" step followed by
 * a separate "choose subject" step; a classroom only ever has at most
 * one Subject this curriculum could go to (see
 * findAssignableSubjectForCurriculum()'s own header comment on why it
 * never matches a Subject that already has a *different* curriculum
 * linked), so there's nothing left to separately "choose" once the
 * classroom is picked. Skips the list entirely and shows that one
 * classroom's own row directly when there's only one classroom at
 * all — this app's existing "only ask when there's a real choice"
 * principle (see ui/views/LearningManagementView.js's own
 * singleClassroomMode).
 */

import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as curriculumLinkingService from '../../services/curriculumLinkingService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { getCanonicalSubjectById } from '../../services/subjectIdentityService.js';
import { getDisplayName } from '../../services/classroomService.js';
import { logPersistenceEvent } from '../../services/persistenceLogger.js';
import { showToast } from './Toast.js';

export function openAssignCurriculumToClassroomModal({ curriculumIndex, classrooms, onAssigned }) {
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

  const subjectId = curriculumIndex.curriculum.subjectId;
  const subjectTitle = getCanonicalSubjectById(subjectId)?.title || curriculumIndex.curriculum.subject;

  function assign(classroom, subject) {
    curriculumLinkingService.assignCurriculumToSubject(classroom, subject, curriculumIndex);
    logPersistenceEvent('Curriculum assigned', { classroomId: classroom.id, subjectTitle: subject.title });
    finishAssignment(classroom);
  }

  function createAndAssign(classroom) {
    const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, subjectTitle, subjectId, curriculumIndex);
    logPersistenceEvent('Subject added', { classroomId: classroom.id, subjectTitle: subject.title });
    finishAssignment(classroom);
  }

  function finishAssignment(classroom) {
    workspaceService.markDirty(classroom.id);
    close();
    showToast(`Assigned to ${getDisplayName(classroom)}`);
    onAssigned?.();
  }

  function render() {
    modal.innerHTML = '';

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = 'Assign Curriculum';
    modal.appendChild(heading);

    const subjectLabel = document.createElement('p');
    subjectLabel.className = 'modal__label';
    subjectLabel.textContent = `${curriculumIndex.curriculum.name} • ${curriculumIndex.curriculum.grade}`;
    modal.appendChild(subjectLabel);

    if (classrooms.length === 0) {
      const emptyNote = document.createElement('p');
      emptyNote.className = 'modal__description';
      emptyNote.textContent = 'No classrooms to assign this curriculum to yet.';
      modal.appendChild(emptyNote);
    } else {
      const list = document.createElement('div');
      list.className = 'assign-curriculum-classroom-modal__list';
      classrooms.forEach((classroom) => list.appendChild(renderClassroomRow(classroom)));
      modal.appendChild(list);
    }

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn--text';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', close);
    actions.appendChild(closeButton);
    modal.appendChild(actions);
  }

  function renderClassroomRow(classroom) {
    const row = document.createElement('div');
    row.className = 'assign-curriculum-classroom-modal__row';

    const name = document.createElement('span');
    name.className = 'assign-curriculum-classroom-modal__row-name';
    name.textContent = getDisplayName(classroom);
    row.appendChild(name);

    const alreadyLinked = curriculumLinkingService.isCurriculumIndexLinked(classroom, curriculumIndex.id);
    if (alreadyLinked) {
      const status = document.createElement('span');
      status.className = 'assign-curriculum-classroom-modal__row-status';
      status.textContent = 'Already assigned in this classroom';
      row.appendChild(status);
      return row;
    }

    const existingSubject = curriculumLinkingService.findAssignableSubjectForCurriculum(classroom, subjectId);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--secondary assign-curriculum-classroom-modal__row-action';
    if (existingSubject) {
      button.textContent = `Assign to ${existingSubject.title}`;
      button.addEventListener('click', () => assign(classroom, existingSubject));
    } else {
      button.textContent = `Create "${subjectTitle}" and assign`;
      button.addEventListener('click', () => createAndAssign(classroom));
    }
    row.appendChild(button);

    return row;
  }

  render();
}
