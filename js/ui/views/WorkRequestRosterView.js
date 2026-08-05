/**
 * ui/views/WorkRequestRosterView.js
 *
 * The teacher checking workflow — one page, per explicit product
 * decision: current lifecycle status AND lifecycle history both live
 * here, so there is never a reason to navigate to a separate Timeline
 * screen for the same WorkRequest. The old Notebook Tracker's
 * Timeline page existed only because the previous day-by-day
 * register had no other way to answer "what happened over time" —
 * a WorkRequestEntry already carries its own answer
 * (services/workRequestService.js's getEntryHistory()), so that
 * separate page is retired entirely, not just no-longer-linked-to.
 *
 * One primary button per row advances the happy path
 * (workRequestService.js's own advanceStatus()) — its label, color,
 * and icon all driven by the entry's current status, mirroring the
 * same "state drives appearance" pattern
 * ui/views/GoalDashboardView.js's own status column already uses.
 * "Needs Correction" is the one distinct, secondary action, and only
 * appears when the entry's own status makes it meaningful.
 *
 * A colored dot (\ud83d\udfe2/\ud83d\udfe1/\ud83d\udd34) communicates where a notebook
 * currently sits without needing to open anything — tapping a row
 * expands its own full history inline, in place, never navigating
 * away. Once an entry reaches 'reviewed' (the true terminal state —
 * see workRequestService.js's own getNextStatus(), which returns null
 * for it), no button renders at all for that row, not a disabled one.
 *
 * Every row uses ui/components/StudentNameElement.js — the canonical
 * student identity component (avatar, bucket color, name primary,
 * team secondary, consistent click behavior) — never a bespoke
 * rendering. Clicking a name opens the teacher-facing, private
 * profile (ui/views/StudentProfileView.js), correct for this
 * teacher-side screen.
 *
 * The old Submission/Completion dropdown controls
 * (ui/components/NotebookRoster.js) never appear anywhere on this
 * page — they belong to the retired NotebookSubmission model, not
 * this one.
 */

import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { formatDate } from '../../utils/dateHelpers.js';

const STATUS_BUTTON = {
  assigned: { label: 'Mark Submitted', className: 'btn--secondary' },
  submitted: { label: 'Mark Reviewed', className: 'btn--primary' },
  needs_correction: { label: 'Mark Resubmitted', className: 'btn--warning' },
  resubmitted: { label: 'Mark Reviewed', className: 'btn--primary' },
};

const STATUS_LABEL = {
  assigned: 'Awaiting Submission',
  submitted: 'Submitted',
  needs_correction: 'Needs Correction',
  resubmitted: 'Resubmitted',
  reviewed: 'Reviewed',
};

// Communicates where a notebook sits at a glance, per explicit
// product decision — green once genuine forward progress has been
// made (submitted, or fully reviewed), amber while a correction is
// outstanding, red while nothing has happened yet.
const STATUS_DOT = {
  assigned: '\ud83d\udd34',
  submitted: '\ud83d\udfe2',
  needs_correction: '\ud83d\udfe1',
  resubmitted: '\ud83d\udfe2',
  reviewed: '\ud83d\udfe2',
};

export function renderWorkRequestRosterView(container, { classroom, requestId, onBack, onSelectStudent }) {
  const expandedStudentIds = new Set();

  function rerender() {
    render(container, classroom, requestId, expandedStudentIds, { onBack, onSelectStudent, onAdvance, onMarkNeedsCorrection, onToggleExpand });
  }

  function onAdvance(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    workRequestService.advanceStatus(request, studentId);
    rerender();
  }

  function onMarkNeedsCorrection(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    workRequestService.markNeedsCorrection(request, studentId);
    rerender();
  }

  function onToggleExpand(studentId) {
    if (expandedStudentIds.has(studentId)) expandedStudentIds.delete(studentId);
    else expandedStudentIds.add(studentId);
    rerender();
  }

  rerender();
}

function render(container, classroom, requestId, expandedStudentIds, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'work-request-roster';
  wrapper.appendChild(createBackButton(handlers.onBack));

  const request = workRequestService.getWorkRequestById(classroom, requestId);
  if (!request) {
    wrapper.appendChild(createEmptyStateElement({ message: "This request isn't available right now." }));
    container.appendChild(wrapper);
    return;
  }

  const title = document.createElement('h1');
  title.className = 'work-request-roster__title';
  title.textContent = request.title;
  wrapper.appendChild(title);

  const subject = notebookConfigService.getSubjectById(classroom, request.subjectId);
  const meta = document.createElement('p');
  meta.className = 'work-request-roster__meta';
  meta.textContent = [subject?.name, request.dueDate ? `Due ${request.dueDate}` : null].filter(Boolean).join(' \u00b7 ');
  wrapper.appendChild(meta);

  const students = getClassroomStudents(classroom);
  const list = document.createElement('div');
  list.className = 'work-request-roster__list';

  students.forEach((student) => {
    const entry = workRequestService.getEntryForStudent(request, student.id);
    if (!entry) return;
    list.appendChild(
      createRosterRow(student, findTeamContaining(classroom, student.id), entry, expandedStudentIds.has(student.id), handlers)
    );
  });

  wrapper.appendChild(list);
  container.appendChild(wrapper);
}

function createRosterRow(student, team, entry, isExpanded, handlers) {
  const row = document.createElement('div');
  row.className = 'work-request-roster__row';

  const mainLine = document.createElement('div');
  mainLine.className = 'work-request-roster__main-line';

  const expandButton = document.createElement('button');
  expandButton.type = 'button';
  expandButton.className = 'work-request-roster__expand-toggle';
  expandButton.setAttribute('aria-label', isExpanded ? 'Hide history' : 'Show history');
  expandButton.textContent = isExpanded ? '\u25be' : '\u25b8';
  expandButton.addEventListener('click', () => handlers.onToggleExpand(student.id));
  mainLine.appendChild(expandButton);

  const dot = document.createElement('span');
  dot.className = 'work-request-roster__dot';
  dot.textContent = STATUS_DOT[entry.status];
  dot.setAttribute('aria-hidden', 'true');
  mainLine.appendChild(dot);

  mainLine.appendChild(createStudentNameElement({ student, team, onSelect: handlers.onSelectStudent, size: 36 }));

  const statusLabel = document.createElement('span');
  statusLabel.className = `work-request-roster__status work-request-roster__status--${entry.status}`;
  statusLabel.textContent = STATUS_LABEL[entry.status];
  mainLine.appendChild(statusLabel);

  const actions = document.createElement('div');
  actions.className = 'work-request-roster__actions';

  const buttonConfig = STATUS_BUTTON[entry.status];
  if (buttonConfig) {
    const primaryButton = document.createElement('button');
    primaryButton.type = 'button';
    primaryButton.className = `btn ${buttonConfig.className}`;
    primaryButton.textContent = buttonConfig.label;
    primaryButton.addEventListener('click', () => handlers.onAdvance(student.id));
    actions.appendChild(primaryButton);
  }
  // Reviewed (terminal) renders no button at all here -- not a
  // disabled one. There is genuinely nothing further to do.

  if (entry.status === 'submitted' || entry.status === 'resubmitted') {
    const correctionButton = document.createElement('button');
    correctionButton.type = 'button';
    correctionButton.className = 'btn btn--text work-request-roster__correction-button';
    correctionButton.textContent = 'Needs Correction';
    correctionButton.addEventListener('click', () => handlers.onMarkNeedsCorrection(student.id));
    actions.appendChild(correctionButton);
  }

  mainLine.appendChild(actions);
  row.appendChild(mainLine);

  if (isExpanded) {
    row.appendChild(createHistoryPanel(entry));
  }

  return row;
}

function createHistoryPanel(entry) {
  const panel = document.createElement('div');
  panel.className = 'work-request-roster__history';

  const history = workRequestService.getEntryHistory(entry);
  history.forEach((step) => {
    const line = document.createElement('div');
    line.className = 'work-request-roster__history-step';

    const label = document.createElement('span');
    label.className = 'work-request-roster__history-label';
    label.textContent = STATUS_LABEL[step.status];

    const date = document.createElement('span');
    date.className = 'work-request-roster__history-date';
    date.textContent = formatDate(step.date);

    line.append(label, date);
    panel.appendChild(line);
  });

  return panel;
}

function getClassroomStudents(classroom) {
  return classroom.teams.flatMap((team) => team.students);
}

function findTeamContaining(classroom, studentId) {
  return classroom.teams.find((team) => team.students.some((student) => student.id === studentId));
}
