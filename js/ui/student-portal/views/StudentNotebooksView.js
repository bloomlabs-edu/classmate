/**
 * ui/student-portal/views/StudentNotebooksView.js
 *
 * A student's own notebook/HW obligations — what's due, when, and its
 * current status. Deliberately read-only: nothing here writes
 * anything at all, since submission itself is a physical act a
 * teacher records (see ui/views/WorkRequestRosterView.js) — this
 * view only answers "what do I need to submit, and have I?"
 *
 * Reuses services/workRequestService.js's own
 * getNotebookObligationsForStudent() entirely — no new data model,
 * no new collection, no new Firestore rule. The classroom read here
 * uses the exact same mechanism studentGoalsService.js's own
 * getGoalCycleForCurrentStudent() already does
 * (workspaceService.getClassroomOnce(), covered by the classroom
 * document's own existing "readable by anyone with the id" rule) —
 * this view needs no write access at all, so it needs no per-slot
 * Firestore instance or anonymous sign-in either.
 */

import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { getActiveProfile } from '../../../services/studentDeviceService.js';
import * as workspaceService from '../../../services/workspaceService.js';
import * as workRequestService from '../../../services/workRequestService.js';
import * as notebookConfigService from '../../../services/notebookConfigService.js';
import { getStatusMeta } from '../../views/WorkRequestRosterView.js';
import { formatDate } from '../../../utils/dateHelpers.js';

export async function renderStudentNotebooksView(container, { onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-notebooks';

  const header = document.createElement('div');
  header.className = 'student-notebooks__header';
  header.appendChild(createBackButton(onBack));
  const title = document.createElement('h1');
  title.className = 'student-section__title';
  title.textContent = 'Notebooks';
  header.appendChild(title);
  wrapper.appendChild(header);

  container.appendChild(wrapper);

  const activeProfile = getActiveProfile();
  if (!activeProfile) {
    wrapper.appendChild(createEmptyStateElement({ message: 'Nothing to show right now.' }));
    return;
  }

  const classroom = await workspaceService.getClassroomOnce(activeProfile.classroomId);
  if (!classroom) {
    wrapper.appendChild(createEmptyStateElement({ message: 'Nothing to show right now.' }));
    return;
  }

  const obligations = workRequestService.getNotebookObligationsForStudent(classroom, activeProfile.studentId);

  if (obligations.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No notebook checks yet \u2014 nothing due right now.' }));
    return;
  }

  const list = document.createElement('div');
  list.className = 'student-notebooks__list';

  obligations.forEach((obligation) => {
    list.appendChild(renderObligationCard(obligation, classroom));
  });

  wrapper.appendChild(list);
}

function renderObligationCard(obligation, classroom) {
  const card = document.createElement('div');
  card.className = 'student-notebooks__card';

  const subject = notebookConfigService.getSubjectById(classroom, obligation.subjectId);
  const notebookType = notebookConfigService.getNotebookTypeById(classroom, obligation.notebookTypeId);

  const heading = document.createElement('p');
  heading.className = 'student-notebooks__subject';
  heading.textContent = [subject?.name, notebookType?.name].filter(Boolean).join(' \u00b7 ') || obligation.title;
  card.appendChild(heading);

  const meta = getStatusMeta({ status: obligation.status, reviewOutcome: obligation.reviewOutcome });

  const isDone = obligation.status === 'reviewed' || obligation.status === 'absent';
  if (!isDone) {
    const dueLine = document.createElement('p');
    dueLine.className = 'student-notebooks__due';
    dueLine.textContent = obligation.dueDate ? `Due ${formatDate(obligation.dueDate)}` : 'No due date set';
    card.appendChild(dueLine);
  }

  const statusLine = document.createElement('p');
  statusLine.className = `student-notebooks__status student-notebooks__status--${meta?.chipClass || 'gray'}`;
  statusLine.textContent = `${meta?.icon || ''} ${meta?.label || obligation.status}`.trim();
  card.appendChild(statusLine);

  return card;
}
