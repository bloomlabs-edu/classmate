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
  title.textContent = 'Notebook Tracker';
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

  if (obligations.length === 0 && checkpointNotebooks.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No notebook checks yet \u2014 nothing due right now.' }));
    return;
  }

  // A genuinely separate concern from the tabbed Checkpoints
  // component below — an "obligation" (see
  // workRequestService.js's own getNotebookObligationsForStudent())
  // is a notebook check that may not have any checkpoints attached
  // to it at all yet. Left completely unmodified by this redesign.
  if (obligations.length > 0) {
    const list = document.createElement('div');
    list.className = 'student-notebooks__list';
    obligations.forEach((obligation) => {
      list.appendChild(renderObligationCard(obligation, classroom));
    });
    wrapper.appendChild(list);
  }

  if (checkpointNotebooks.length > 0) {
    wrapper.appendChild(renderNotebookTabs(checkpointNotebooks));
  }
}

/**
 * The attached-tab + checkpoint-panel component — per explicit
 * product decision, one connected component (tab strip + content
 * panel share a single outer container), not four independent
 * buttons floating above a card. Reuses
 * checkpointService.getCheckpointsForStudentAcrossNotebooks()'s own
 * already-fetched data directly — no new Firestore read, no
 * re-fetch on tab switch, since every notebook's own checkpoints are
 * already in memory. Switching tabs only ever re-renders the content
 * panel in place (see rerenderPanel() below) — never navigates, never
 * touches the outer view at all.
 */
function renderNotebookTabs(notebooks) {
  const root = document.createElement('div');
  root.className = 'student-notebook-tabs';

  const tabStrip = document.createElement('div');
  tabStrip.className = 'student-notebook-tabs__strip';
  tabStrip.setAttribute('role', 'tablist');
  root.appendChild(tabStrip);

  const panel = document.createElement('div');
  panel.className = 'student-notebook-tabs__panel';
  panel.setAttribute('role', 'tabpanel');
  root.appendChild(panel);

  let activeIndex = 0;
  const tabButtons = [];

  function setActive(index) {
    activeIndex = index;
    tabButtons.forEach((button, i) => {
      button.classList.toggle('student-notebook-tabs__tab--active', i === index);
    });
    renderCheckpointPanel(panel, notebooks[index]);
  }

  notebooks.forEach((notebook, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'student-notebook-tabs__tab';
    tab.setAttribute('role', 'tab');

    const icon = document.createElement('span');
    icon.className = 'student-notebook-tabs__tab-icon';
    icon.textContent = '\ud83d\udcd6';
    icon.setAttribute('aria-hidden', 'true');
    tab.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'student-notebook-tabs__tab-label';
    label.textContent = [notebook.subject.name, notebook.notebookType.name].filter(Boolean).join(' \u00b7 ');
    tab.appendChild(label);

    tab.addEventListener('click', () => setActive(index));
    tabStrip.appendChild(tab);
    tabButtons.push(tab);
  });

  setActive(0);
  return root;
}

/**
 * The content panel for exactly one active notebook — a status
 * legend, then a clean checkpoint table. Deliberately shows only
 * this one student's own status: no other students, no names, no
 * teacher controls (Mark Submitted, review, create/edit, column
 * management), no submission-count statistics. getCellMeta() is
 * reused completely unmodified for status language/color — the
 * teacher-side view's own established status model, not a second,
 * duplicated one.
 */
function renderCheckpointPanel(panel, notebook) {
  panel.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'student-notebook-tabs__panel-heading';
  heading.textContent = 'Checkpoints';
  panel.appendChild(heading);

  if (notebook.checkpoints.length === 0) {
    panel.appendChild(createEmptyStateElement({ message: 'No checkpoints have been added to this Notebook yet.' }));
    return;
  }

  const legend = document.createElement('div');
  legend.className = 'student-notebook-tabs__legend';
  [
    { label: 'Complete', chipClass: 'green' },
    { label: 'Incomplete', chipClass: 'orange' },
    { label: 'Not submitted', chipClass: 'purple' },
  ].forEach(({ label, chipClass }) => {
    const item = document.createElement('span');
    item.className = 'student-notebook-tabs__legend-item';
    const dot = document.createElement('span');
    dot.className = `student-notebook-tabs__legend-dot student-notebook-tabs__legend-dot--${chipClass}`;
    item.appendChild(dot);
    const text = document.createElement('span');
    text.textContent = label;
    item.appendChild(text);
    legend.appendChild(item);
  });
  panel.appendChild(legend);

  const table = document.createElement('div');
  table.className = 'student-notebook-tabs__table';

  const headerRow = document.createElement('div');
  headerRow.className = 'student-notebook-tabs__row student-notebook-tabs__row--header';
  ['Checkpoint', 'Status', 'Submitted On', 'Reviewed On'].forEach((label, index) => {
    const cell = document.createElement('span');
    cell.textContent = label;
    if (index >= 2) cell.className = 'student-notebook-tabs__row-date';
    headerRow.appendChild(cell);
  });
  table.appendChild(headerRow);

  notebook.checkpoints.forEach(({ checkpoint, record }) => {
    table.appendChild(renderCheckpointRow(checkpoint, record));
  });
  panel.appendChild(table);
}

function renderCheckpointRow(checkpoint, record) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'student-notebook-tabs__row student-notebook-tabs__row--clickable';
  row.addEventListener('click', () => showCheckpointDetailSheet(checkpoint, record));

  const titleCell = document.createElement('span');
  titleCell.className = 'student-notebook-tabs__row-title';
  titleCell.textContent = checkpoint.title;
  row.appendChild(titleCell);

  const meta = getCellMeta(checkpoint, record);
  const statusCell = document.createElement('span');
  statusCell.className = `student-notebook-tabs__row-status student-notebook-tabs__row-status--${meta.chipClass}`;
  const statusDot = document.createElement('span');
  statusDot.className = `student-notebook-tabs__legend-dot student-notebook-tabs__legend-dot--${meta.chipClass}`;
  statusCell.appendChild(statusDot);
  const statusLabel = document.createElement('span');
  statusLabel.textContent = meta.label;
  statusCell.appendChild(statusLabel);
  row.appendChild(statusCell);

  const submittedCell = document.createElement('span');
  submittedCell.className = 'student-notebook-tabs__row-date';
  submittedCell.textContent = record?.submittedDate ? formatDate(record.submittedDate) : '\u2014';
  row.appendChild(submittedCell);

  const reviewedCell = document.createElement('span');
  reviewedCell.className = 'student-notebook-tabs__row-date';
  reviewedCell.textContent = record?.reviewedDate ? formatDate(record.reviewedDate) : '\u2014';
  row.appendChild(reviewedCell);

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
