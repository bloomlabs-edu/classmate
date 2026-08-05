/**
 * ui/views/WorkRequestRosterView.js
 *
 * The teacher checking workflow, Milestone 2's own focus — reaching
 * this screen and advancing a student's entry should take as few
 * taps as possible, per explicit product decision. One primary
 * button per row advances the happy path
 * (services/workRequestService.js's own advanceStatus()) — its
 * label, color, and icon all driven by the entry's current status,
 * mirroring the same "state drives appearance" pattern
 * ui/views/GoalDashboardView.js's own status column already uses.
 *
 * A "Needs Correction" control appears only as a distinct, secondary
 * action, and only when the entry's own status makes it meaningful
 * (submitted/resubmitted) — per explicit product decision not to
 * make the exceptional case share the primary tap target with the
 * common workflow.
 *
 * Once an entry reaches 'reviewed' — the true terminal state (see
 * workRequestService.js's own getNextStatus(), which returns null for
 * it) — no button renders at all for that row, not a disabled one;
 * there's nothing further for the primary workflow to do here.
 *
 * Every row uses ui/components/StudentNameElement.js — the canonical
 * student identity component, not a bespoke rendering — clicking a
 * name opens the teacher-facing, private profile
 * (ui/views/StudentProfileView.js), correct for this teacher-side
 * screen (a Student Portal caller would open the public one instead).
 */

import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

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

export function renderWorkRequestRosterView(container, { classroom, requestId, onBack, onSelectStudent }) {
  function rerender() {
    render(container, classroom, requestId, { onBack, onSelectStudent, onAdvance, onMarkNeedsCorrection });
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

  rerender();
}

function render(container, classroom, requestId, handlers) {
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
    list.appendChild(createRosterRow(student, findTeamContaining(classroom, student.id), entry, handlers));
  });

  wrapper.appendChild(list);
  container.appendChild(wrapper);
}

function createRosterRow(student, team, entry, handlers) {
  const row = document.createElement('div');
  row.className = 'work-request-roster__row';

  row.appendChild(createStudentNameElement({ student, team, onSelect: handlers.onSelectStudent, size: 36 }));

  const statusLabel = document.createElement('span');
  statusLabel.className = `work-request-roster__status work-request-roster__status--${entry.status}`;
  statusLabel.textContent = STATUS_LABEL[entry.status];
  row.appendChild(statusLabel);

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

  row.appendChild(actions);
  return row;
}

function getClassroomStudents(classroom) {
  return classroom.teams.flatMap((team) => team.students);
}

function findTeamContaining(classroom, studentId) {
  return classroom.teams.find((team) => team.students.some((student) => student.id === studentId));
}
