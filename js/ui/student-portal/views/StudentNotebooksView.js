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
import * as studentPortalDataService from '../../../services/studentPortalDataService.js';
import * as workRequestService from '../../../services/workRequestService.js';
import * as notebookConfigService from '../../../services/notebookConfigService.js';
import { getStatusMeta } from '../../views/WorkRequestRosterView.js';
import { getCellMeta } from '../../views/NotebookCheckpointsView.js';
import * as checkpointService from '../../../services/checkpointService.js';
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

  // A pure read for rendering — reuses the Student Portal's own
  // single live subscription when one exists for this exact
  // classroom, rather than an independent, redundant fresh read.
  const classroom =
    studentPortalDataService.getLiveClassroomIfSubscribed(activeProfile.classroomId) ??
    (await workspaceService.getClassroomOnce(activeProfile.classroomId));
  if (!classroom) {
    wrapper.appendChild(createEmptyStateElement({ message: 'Nothing to show right now.' }));
    return;
  }

  const obligations = workRequestService.getNotebookObligationsForStudent(classroom, activeProfile.studentId);
  const checkpointNotebooks = checkpointService.getCheckpointsForStudentAcrossNotebooks(classroom, activeProfile.studentId);
  const hasAnyCheckpoints = checkpointNotebooks.some((notebook) => notebook.checkpoints.length > 0);

  if (obligations.length === 0 && !hasAnyCheckpoints) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No notebook checks yet \u2014 nothing due right now.' }));
    return;
  }

  if (obligations.length > 0) {
    const list = document.createElement('div');
    list.className = 'student-notebooks__list';
    obligations.forEach((obligation) => {
      list.appendChild(renderObligationCard(obligation, classroom));
    });
    wrapper.appendChild(list);
  }

  wrapper.appendChild(renderCheckpointsSection(checkpointNotebooks, activeProfile.studentId));
}

/**
 * The new Checkpoints section — grouped by Notebook (Subject x
 * Notebook Type), reusing NotebookCheckpointsView.js's own
 * getCellMeta() directly for status language/color, not a second,
 * duplicated status model. Strictly read-only: no write handler is
 * passed to anything here at all, so there is structurally no path
 * from this section to a mutation.
 */
function renderCheckpointsSection(notebooks, studentId) {
  const section = document.createElement('div');
  section.className = 'student-notebooks__checkpoints-section';

  const heading = document.createElement('h2');
  heading.className = 'student-notebooks__checkpoints-heading';
  heading.textContent = 'Checkpoints';
  section.appendChild(heading);

  const allCheckpointEntries = notebooks.flatMap((notebook) => notebook.checkpoints);

  if (allCheckpointEntries.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No checkpoints have been added to your Notebooks yet.' }));
    return section;
  }

  const allCaughtUp = allCheckpointEntries.every(({ record }) => record && record.reviewStatus === 'complete');
  if (allCaughtUp) {
    const caughtUpMessage = document.createElement('p');
    caughtUpMessage.className = 'student-notebooks__all-caught-up';
    caughtUpMessage.textContent = '\ud83c\udf89 All caught up!';
    section.appendChild(caughtUpMessage);
  }

  notebooks.forEach((notebook) => {
    if (notebook.checkpoints.length === 0) return; // an empty Notebook renders nothing at all, never an empty table

    const notebookBlock = document.createElement('div');
    notebookBlock.className = 'student-notebooks__checkpoint-notebook';

    const notebookHeading = document.createElement('p');
    notebookHeading.className = 'student-notebooks__checkpoint-notebook-heading';
    notebookHeading.textContent = [notebook.subject.name, notebook.notebookType.name].filter(Boolean).join(' \u00b7 ');
    notebookBlock.appendChild(notebookHeading);

    notebook.checkpoints.forEach(({ checkpoint, record }) => {
      notebookBlock.appendChild(renderStudentCheckpointRow(checkpoint, record, studentId));
    });

    section.appendChild(notebookBlock);
  });

  return section;
}

function renderStudentCheckpointRow(checkpoint, record) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'student-notebooks__checkpoint-row';

  const meta = getCellMeta(checkpoint, record);

  const titleEl = document.createElement('span');
  titleEl.className = 'student-notebooks__checkpoint-row-title';
  titleEl.textContent = checkpoint.title;
  row.appendChild(titleEl);

  const statusEl = document.createElement('span');
  statusEl.className = `student-notebooks__checkpoint-row-status student-notebooks__checkpoint-row-status--${meta.chipClass}`;
  statusEl.textContent = `${meta.icon} ${meta.label}`;
  row.appendChild(statusEl);

  const dateEl = document.createElement('span');
  dateEl.className = 'student-notebooks__checkpoint-row-date';
  dateEl.textContent = record?.submittedDate ? formatDate(record.submittedDate) : '\u2014';
  row.appendChild(dateEl);

  row.addEventListener('click', () => showCheckpointDetailSheet(checkpoint, record));
  return row;
}

/**
 * A strictly read-only detail sheet — no Mark Submitted, no
 * Complete/Incomplete, no date editor, no delete, no reorder, per
 * explicit product decision. Only ever built with a Cancel/Close
 * action; nothing here calls any checkpointService write function at
 * all, so there is no code path to a mutation from this screen.
 */
function showCheckpointDetailSheet(checkpoint, record) {
  const overlay = document.createElement('div');
  overlay.className = 'notebook-checkpoints__cell-editor-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'notebook-checkpoints__cell-editor student-notebooks__checkpoint-detail';

  const heading = document.createElement('p');
  heading.className = 'notebook-checkpoints__cell-editor-heading';
  heading.textContent = checkpoint.title;
  sheet.appendChild(heading);

  if (checkpoint.description) {
    const description = document.createElement('p');
    description.className = 'student-notebooks__checkpoint-detail-description';
    description.textContent = checkpoint.description;
    sheet.appendChild(description);
  }

  const meta = getCellMeta(checkpoint, record);
  const statusLine = document.createElement('p');
  statusLine.className = `student-notebooks__checkpoint-row-status student-notebooks__checkpoint-row-status--${meta.chipClass}`;
  statusLine.textContent = `${meta.icon} ${meta.label}`;
  sheet.appendChild(statusLine);

  const datesList = document.createElement('div');
  datesList.className = 'student-notebooks__checkpoint-detail-dates';
  const givenLine = document.createElement('p');
  givenLine.textContent = `Given: ${formatDate(checkpoint.givenDate)}`;
  datesList.appendChild(givenLine);
  if (checkpoint.dueDate) {
    const dueLine = document.createElement('p');
    dueLine.textContent = `Due: ${formatDate(checkpoint.dueDate)}`;
    datesList.appendChild(dueLine);
  }
  if (record?.submittedDate) {
    const submittedLine = document.createElement('p');
    submittedLine.textContent = `Submitted: ${formatDate(record.submittedDate)}`;
    datesList.appendChild(submittedLine);
  }
  if (record?.reviewedDate) {
    const reviewedLine = document.createElement('p');
    reviewedLine.textContent = `Reviewed: ${formatDate(record.reviewedDate)}`;
    datesList.appendChild(reviewedLine);
  }
  sheet.appendChild(datesList);

  // Only rendered when a real note genuinely exists — per explicit
  // instruction, never an empty "Teacher feedback" section.
  if (record?.teacherNote) {
    const noteLabel = document.createElement('p');
    noteLabel.className = 'notebook-checkpoints__cell-editor-section-label';
    noteLabel.textContent = 'Teacher:';
    sheet.appendChild(noteLabel);
    const noteText = document.createElement('p');
    noteText.className = 'student-notebooks__checkpoint-detail-note';
    noteText.textContent = `\u201c${record.teacherNote}\u201d`;
    sheet.appendChild(noteText);
  }

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--text';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => overlay.remove());
  sheet.appendChild(closeButton);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
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
