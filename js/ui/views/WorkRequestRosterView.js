/**
 * ui/views/WorkRequestRosterView.js
 *
 * The teacher checking workflow, redesigned around the mockup that is
 * now the visual reference for WorkRequest UI platform-wide — the
 * architecture itself is unchanged: still WorkRequest/
 * WorkRequestEntry, still the one-tap lifecycle, still lifecycle
 * history inline, still no separate Timeline page.
 *
 * Summary cards (Students / Awaiting Submission / Awaiting Review /
 * Reviewed) are interactive filters, not static counters — tapping
 * one narrows the roster to exactly that status, tapping it again
 * clears the filter. The bottom legend is the same mechanism extended
 * to the two statuses that don't get their own top card (Needs
 * Correction, Absent), so every status is reachable as a filter, not
 * only the four most common ones.
 *
 * Per explicit product decision, avatars are reserved for contexts
 * where identity is the primary focus (profile pages, cards, tiles) —
 * this screen is about processing a stack of work quickly, so every
 * row uses ui/components/StudentNameElement.js with `showAvatar:
 * false`, leading with a bucket-colored swatch instead. Name is the
 * strongest visual element, team secondary, status tertiary (a
 * colored chip, with a subtle date underneath once something has
 * actually happened), dates always the most muted text on the row.
 *
 * "Needs Correction" and "Absent" both live in the row's own overflow
 * ("\u22ef") menu — deliberately not a second, always-visible button
 * next to the primary one, since both are exceptional actions, not
 * part of the common one-tap workflow.
 *
 * Tapping a row's own chevron expands its full lifecycle history
 * inline, in place — never a navigation, never a separate screen.
 *
 * services/workRequestService.js has no notebook-specific logic in
 * it, and neither does this view beyond reading `request.title`/
 * `subjectId` for display — this same component is meant to be the
 * standard for every future WorkRequest type (Worksheet, Reading Log,
 * Project, Lab Record), not rebuilt per type.
 */

import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { formatDate } from '../../utils/dateHelpers.js';

export const STATUS_META = {
  assigned: { label: 'Awaiting Submission', chipClass: 'amber', icon: '\u23f3', buttonLabel: 'Mark Submitted', buttonClass: 'btn--secondary' },
  submitted: { label: 'Awaiting Review', chipClass: 'purple', icon: '\ud83d\udcc4', buttonLabel: 'Mark Reviewed', buttonClass: 'btn--primary' },
  needs_correction: { label: 'Needs Correction', chipClass: 'red', icon: '\u26a0\ufe0f', buttonLabel: 'Mark Resubmitted', buttonClass: 'btn--warning' },
  resubmitted: { label: 'Awaiting Review', chipClass: 'purple', icon: '\ud83d\udcc4', buttonLabel: 'Mark Reviewed', buttonClass: 'btn--primary' },
  reviewed: { label: 'Reviewed', chipClass: 'green', icon: '\u2705', buttonLabel: null, buttonClass: null },
  absent: { label: 'Absent', chipClass: 'gray', icon: '\ud83d\udeab', buttonLabel: null, buttonClass: null },
};

// The four cards shown at the top, matching the mockup exactly. Every
// status (including the two without their own card) is still
// reachable as a filter via the legend below.
const SUMMARY_CARDS = [
  { id: 'total', label: 'Students', statuses: null },
  { id: 'assigned', label: 'Awaiting Submission', statuses: ['assigned'] },
  { id: 'awaiting_review', label: 'Awaiting Review', statuses: ['submitted', 'resubmitted'] },
  { id: 'reviewed', label: 'Reviewed', statuses: ['reviewed'] },
];

export function renderWorkRequestRosterView(container, { classroom, requestId, onBack, onSelectStudent }) {
  const expandedStudentIds = new Set();
  let openOverflowStudentId = null;
  let activeFilterStatuses = null;

  function rerender() {
    render(container, classroom, requestId, expandedStudentIds, openOverflowStudentId, activeFilterStatuses, {
      onBack,
      onSelectStudent,
      onAdvance,
      onMarkNeedsCorrection,
      onMarkAbsent,
      onToggleExpand,
      onToggleOverflow,
      onSetFilter,
    });
  }

  function onAdvance(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    workRequestService.advanceStatus(request, studentId);
    rerender();
  }

  function onMarkNeedsCorrection(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    workRequestService.markNeedsCorrection(request, studentId);
    openOverflowStudentId = null;
    rerender();
  }

  function onMarkAbsent(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    workRequestService.markAbsent(request, studentId);
    openOverflowStudentId = null;
    rerender();
  }

  function onToggleExpand(studentId) {
    if (expandedStudentIds.has(studentId)) expandedStudentIds.delete(studentId);
    else expandedStudentIds.add(studentId);
    rerender();
  }

  function onToggleOverflow(studentId) {
    openOverflowStudentId = openOverflowStudentId === studentId ? null : studentId;
    rerender();
  }

  function onSetFilter(statuses) {
    // Tapping the already-active filter clears it — a toggle, not a one-way drill.
    const isSame = JSON.stringify(statuses) === JSON.stringify(activeFilterStatuses);
    activeFilterStatuses = isSame ? null : statuses;
    rerender();
  }

  rerender();
}

function render(container, classroom, requestId, expandedStudentIds, openOverflowStudentId, activeFilterStatuses, handlers) {
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

  const allStudents = getClassroomStudents(classroom);
  wrapper.appendChild(createSummaryCards(request, allStudents.length, activeFilterStatuses, handlers.onSetFilter));

  const visibleStudents = activeFilterStatuses
    ? allStudents.filter((student) => activeFilterStatuses.includes(workRequestService.getEntryForStudent(request, student.id)?.status))
    : allStudents;

  const list = document.createElement('div');
  list.className = 'work-request-roster__list';

  visibleStudents.forEach((student) => {
    const entry = workRequestService.getEntryForStudent(request, student.id);
    if (!entry) return;
    list.appendChild(
      createRosterRow(
        student,
        findTeamContaining(classroom, student.id),
        entry,
        expandedStudentIds.has(student.id),
        openOverflowStudentId === student.id,
        handlers
      )
    );
  });
  wrapper.appendChild(list);

  wrapper.appendChild(createLegend(activeFilterStatuses, handlers.onSetFilter));

  container.appendChild(wrapper);
}

function createSummaryCards(request, totalStudents, activeFilterStatuses, onSetFilter) {
  const row = document.createElement('div');
  row.className = 'work-request-roster__summary';

  SUMMARY_CARDS.forEach((card) => {
    const count = card.statuses
      ? card.statuses.reduce((sum, status) => sum + workRequestService.getEntriesByStatus(request, status).length, 0)
      : totalStudents;

    const isActive = card.statuses && JSON.stringify(card.statuses) === JSON.stringify(activeFilterStatuses);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `work-request-roster__summary-card work-request-roster__summary-card--${card.id}${isActive ? ' work-request-roster__summary-card--active' : ''}`;
    if (card.statuses) button.addEventListener('click', () => onSetFilter(card.statuses));
    else button.disabled = true; // "Students" is a real total, not a filter -- nothing to narrow to.

    const countEl = document.createElement('span');
    countEl.className = 'work-request-roster__summary-count';
    countEl.textContent = String(count);

    const labelEl = document.createElement('span');
    labelEl.className = 'work-request-roster__summary-label';
    labelEl.textContent = card.label;

    button.append(countEl, labelEl);
    row.appendChild(button);
  });

  return row;
}

function createLegend(activeFilterStatuses, onSetFilter) {
  const legend = document.createElement('div');
  legend.className = 'work-request-roster__legend';

  Object.entries(STATUS_META).forEach(([status, meta]) => {
    const isActive = activeFilterStatuses && activeFilterStatuses.length === 1 && activeFilterStatuses[0] === status;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `work-request-roster__chip work-request-roster__legend-chip work-request-roster__chip--${meta.chipClass}${isActive ? ' work-request-roster__legend-chip--active' : ''}`;
    chip.textContent = meta.label;
    chip.addEventListener('click', () => onSetFilter([status]));
    legend.appendChild(chip);
  });

  return legend;
}

function createRosterRow(student, team, entry, isExpanded, isOverflowOpen, handlers) {
  const meta = STATUS_META[entry.status];

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

  mainLine.appendChild(createStudentNameElement({ student, team, onSelect: handlers.onSelectStudent, showAvatar: false }));

  const statusBlock = document.createElement('div');
  statusBlock.className = 'work-request-roster__status-block';

  const chip = document.createElement('span');
  chip.className = `work-request-roster__chip work-request-roster__chip--${meta.chipClass}`;
  chip.textContent = `${meta.icon} ${meta.label}`;
  statusBlock.appendChild(chip);

  const history = workRequestService.getEntryHistory(entry);
  if (history.length > 1) {
    const dateLine = document.createElement('span');
    dateLine.className = 'work-request-roster__date';
    dateLine.textContent = describeMostRecentTransition(entry.status, history[history.length - 1].date);
    statusBlock.appendChild(dateLine);
  }
  mainLine.appendChild(statusBlock);

  const actions = document.createElement('div');
  actions.className = 'work-request-roster__actions';

  if (meta.buttonLabel) {
    const primaryButton = document.createElement('button');
    primaryButton.type = 'button';
    primaryButton.className = `btn ${meta.buttonClass}`;
    primaryButton.textContent = meta.buttonLabel;
    primaryButton.addEventListener('click', () => handlers.onAdvance(student.id));
    actions.appendChild(primaryButton);
  }
  // Reviewed and Absent render no primary button at all -- not a
  // disabled one. There is genuinely nothing further to do.

  actions.appendChild(createOverflowMenu(student, entry, isOverflowOpen, handlers));
  mainLine.appendChild(actions);
  row.appendChild(mainLine);

  if (isExpanded) {
    row.appendChild(createHistoryPanel(entry));
  }

  return row;
}

function createOverflowMenu(student, entry, isOpen, handlers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'work-request-roster__overflow';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'work-request-roster__overflow-trigger';
  trigger.setAttribute('aria-label', `More actions for ${student.name}`);
  trigger.textContent = '\u22ef';
  trigger.addEventListener('click', () => handlers.onToggleOverflow(student.id));
  wrapper.appendChild(trigger);

  if (isOpen) {
    const menu = document.createElement('div');
    menu.className = 'work-request-roster__overflow-menu';

    if (entry.status === 'submitted' || entry.status === 'resubmitted') {
      menu.appendChild(createOverflowMenuItem('Needs Correction', () => handlers.onMarkNeedsCorrection(student.id)));
    }
    if (entry.status !== 'reviewed') {
      menu.appendChild(createOverflowMenuItem('Absent', () => handlers.onMarkAbsent(student.id)));
    }
    if (menu.children.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'work-request-roster__overflow-empty';
      empty.textContent = 'No actions available';
      menu.appendChild(empty);
    }

    wrapper.appendChild(menu);
  }

  return wrapper;
}

function createOverflowMenuItem(label, onClick) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'work-request-roster__overflow-item';
  item.textContent = label;
  item.addEventListener('click', onClick);
  return item;
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
    label.textContent = STATUS_META[step.status]?.label || step.status;

    const date = document.createElement('span');
    date.className = 'work-request-roster__history-date';
    date.textContent = formatDate(step.date);

    line.append(label, date);
    panel.appendChild(line);
  });

  return panel;
}

function describeMostRecentTransition(status, isoDate) {
  const verb = { submitted: 'Submitted', resubmitted: 'Resubmitted', needs_correction: 'Reviewed', reviewed: 'Reviewed', absent: 'Marked' }[status] || 'Updated';
  return `${verb} on ${formatDate(isoDate)}`;
}

function getClassroomStudents(classroom) {
  return classroom.teams.flatMap((team) => team.students);
}

function findTeamContaining(classroom, studentId) {
  return classroom.teams.find((team) => team.students.some((student) => student.id === studentId));
}
