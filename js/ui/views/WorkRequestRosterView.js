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
 * Each row's own background is tinted with the student's bucket color
 * (config/bucketConfig.js's getBucketRowStyle(), very low opacity) —
 * bucket becomes part of the row's own identity, scannable at a
 * glance without a dedicated marker. The leading marker itself shows
 * group identity instead (ui/components/StudentNameElement.js's own
 * `leadingMarker: 'group'`), since a teacher checking notebooks
 * usually works through students by group, not by bucket — group is
 * the more useful glance-signal in this specific context. Status
 * chips use a distinctly different, more saturated palette from the
 * bucket tints so the two pieces of information (learner support
 * level vs. current WorkRequest status) never blend into each other.
 *
 * Row hierarchy, deliberately in this order: student name (primary),
 * group (secondary), status chip (tertiary), a subtle date once
 * something has actually happened, then the primary action.
 *
 * "Needs Correction," "Mark Absent," and "Reset Work Request" all
 * live in the row's own overflow ("\u22ef") menu — deliberately not
 * always-visible buttons next to the primary one, since none of them
 * are part of the common one-tap workflow. Reset is the one, simple
 * recovery path for any mistake (services/workRequestService.js's own
 * resetWorkRequestEntry()) — not a separate "undo" per possible
 * mistake, always returning to the true initial state.
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
import { getBucketRowStyle } from '../../config/bucketConfig.js';
import { formatDate } from '../../utils/dateHelpers.js';

export const STATUS_META = {
  assigned: { label: 'Awaiting Submission', chipClass: 'amber', icon: '\u23f3', buttonLabel: 'Mark Submitted', buttonClass: 'btn--secondary' },
  submitted: { label: 'Awaiting Review', chipClass: 'purple', icon: '\ud83d\udcc4', buttonLabel: 'Mark Reviewed', buttonClass: 'btn--primary' },
  needs_correction: { label: 'Needs Correction', chipClass: 'red', icon: '\u26a0\ufe0f', buttonLabel: 'Mark Resubmitted', buttonClass: 'btn--warning' },
  resubmitted: { label: 'Awaiting Review', chipClass: 'purple', icon: '\ud83d\udcc4', buttonLabel: 'Mark Reviewed', buttonClass: 'btn--primary' },
  reviewed: { label: 'Reviewed', chipClass: 'green', icon: '\u2705', buttonLabel: null, buttonClass: null },
  absent: { label: 'Absent', chipClass: 'gray', icon: '\ud83d\udeab', buttonLabel: null, buttonClass: null },
};

// 'Reviewed · Incomplete' is a distinct review OUTCOME, not a fifth
// lifecycle status (see models/WorkRequestEntry.js's own header
// comment) — but it still needs its own chip appearance, genuinely
// distinct from both plain 'Reviewed' (green) and 'Awaiting
// Submission' (amber), so a teacher scanning the roster can tell the
// two apart at a glance. Kept as a separate lookup, keyed by outcome,
// rather than folded into STATUS_META itself, since it's the one case
// where status alone doesn't determine the correct chip.
const REVIEWED_INCOMPLETE_META = { label: 'Reviewed \u00b7 Incomplete', chipClass: 'orange', icon: '\ud83d\udfe0', buttonLabel: null, buttonClass: null };

/** Resolves the correct chip/button metadata for an entry, accounting for reviewOutcome — the one case where `status` alone isn't enough. Exported so other views (e.g. ui/views/StudentProfileView.js's own Notebook tab) render the exact same status language and colors as this roster, rather than duplicating the lookup. */
export function getStatusMeta(entry) {
  if (entry.status === 'reviewed' && entry.reviewOutcome === 'incomplete') return REVIEWED_INCOMPLETE_META;
  return STATUS_META[entry.status];
}

// The four cards shown at the top, matching the mockup exactly. Every
// status (including the two without their own card) is still
// reachable as a filter via the legend below.
const SUMMARY_CARDS = [
  { id: 'total', label: 'Students', statuses: null },
  { id: 'assigned', label: 'Awaiting Submission', statuses: ['assigned'] },
  { id: 'awaiting_review', label: 'Awaiting Review', statuses: ['submitted', 'resubmitted'] },
  { id: 'reviewed', label: 'Reviewed', statuses: ['reviewed'] },
  { id: 'absent', label: 'Absent', statuses: ['absent'] },
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
      onMarkIncomplete,
      onMarkAbsent,
      onResetEntry,
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

  function onMarkIncomplete(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    workRequestService.markReviewIncomplete(request, studentId);
    openOverflowStudentId = null;
    rerender();
  }

  function onMarkAbsent(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    workRequestService.markAbsent(request, studentId);
    openOverflowStudentId = null;
    rerender();
  }

  function onResetEntry(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    workRequestService.resetWorkRequestEntry(request, studentId);
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
    const lastChecked = workRequestService.getLastChecked(classroom, student.id, request.subjectId, request.notebookTypeId);
    list.appendChild(
      createRosterRow(
        student,
        findTeamContaining(classroom, student.id),
        entry,
        expandedStudentIds.has(student.id),
        openOverflowStudentId === student.id,
        handlers,
        lastChecked
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

/**
 * Relative-time phrasing for workRequestService.js's own
 * getLastChecked() — a Notebook-level fact (survives this request
 * closing), deliberately phrased distinctly from the request-scoped
 * status chip right next to it, so the two pieces of information
 * never read as the same thing.
 */
function describeLastChecked(lastCheckedIso) {
  if (!lastCheckedIso) return 'Never checked';

  const lastCheckedDate = new Date(lastCheckedIso.slice(0, 10));
  const today = new Date(new Date().toISOString().slice(0, 10));
  const daysAgo = Math.round((today - lastCheckedDate) / (1000 * 60 * 60 * 24));

  if (daysAgo <= 0) return 'Checked today';
  if (daysAgo === 1) return 'Checked yesterday';
  if (daysAgo < 30) return `Last checked ${daysAgo} days ago`;
  const monthsAgo = Math.round(daysAgo / 30);
  return `Last checked ${monthsAgo} month${monthsAgo === 1 ? '' : 's'} ago`;
}

function createRosterRow(student, team, entry, isExpanded, isOverflowOpen, handlers, lastChecked) {
  const meta = getStatusMeta(entry);

  const row = document.createElement('div');
  row.className = 'work-request-roster__row';
  // Bucket becomes the row's own identity tint, per explicit product
  // decision — very low opacity, just enough to recognise the
  // learner category while scanning, never competing with the status
  // chip's own, deliberately distinct outline palette.
  row.style.backgroundColor = getBucketRowStyle(student.bucket).background;

  const mainLine = document.createElement('div');
  mainLine.className = 'work-request-roster__main-line';

  const expandButton = document.createElement('button');
  expandButton.type = 'button';
  expandButton.className = 'work-request-roster__expand-toggle';
  expandButton.setAttribute('aria-label', isExpanded ? 'Hide history' : 'Show history');
  expandButton.textContent = isExpanded ? '\u25be' : '\u25b8';
  expandButton.addEventListener('click', () => handlers.onToggleExpand(student.id));
  mainLine.appendChild(expandButton);

  mainLine.appendChild(
    createStudentNameElement({
      student,
      team,
      onSelect: (selectedStudent) => handlers.onSelectStudent(selectedStudent.id),
      leadingMarker: 'group',
      tintNameWithBucket: true,
    })
  );

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
    dateLine.textContent = describeMostRecentTransition(entry, history[history.length - 1].date);
    statusBlock.appendChild(dateLine);
  }

  const lastCheckedLine = document.createElement('span');
  lastCheckedLine.className = 'work-request-roster__last-checked';
  lastCheckedLine.textContent = describeLastChecked(lastChecked);
  statusBlock.appendChild(lastCheckedLine);

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

    const reviewOutcomeItems = [];
    if (entry.status === 'submitted' || entry.status === 'resubmitted') {
      reviewOutcomeItems.push(createOverflowMenuItem('Mark Incomplete', () => handlers.onMarkIncomplete(student.id)));
      reviewOutcomeItems.push(createOverflowMenuItem('Needs Correction', () => handlers.onMarkNeedsCorrection(student.id)));
    }
    if (reviewOutcomeItems.length > 0) {
      menu.appendChild(createOverflowMenuGroupLabel('Review Outcomes'));
      reviewOutcomeItems.forEach((item) => menu.appendChild(item));
    }

    const otherActionItems = [];
    if (entry.status !== 'reviewed') {
      otherActionItems.push(createOverflowMenuItem('Mark Absent', () => handlers.onMarkAbsent(student.id)));
    }
    if (entry.status !== 'assigned') {
      otherActionItems.push(createOverflowMenuItem('\u21ba Reset Work Request', () => handlers.onResetEntry(student.id)));
    }
    if (otherActionItems.length > 0) {
      menu.appendChild(createOverflowMenuGroupLabel('Other Actions'));
      otherActionItems.forEach((item) => menu.appendChild(item));
    }

    if (reviewOutcomeItems.length === 0 && otherActionItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'work-request-roster__overflow-empty';
      empty.textContent = 'No actions available';
      menu.appendChild(empty);
    }

    wrapper.appendChild(menu);
  }

  return wrapper;
}

function createOverflowMenuGroupLabel(text) {
  const label = document.createElement('p');
  label.className = 'work-request-roster__overflow-group-label';
  label.textContent = text;
  return label;
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
    const baseLabel = STATUS_META[step.status]?.label || step.status;
    label.textContent = step.status === 'reviewed' && step.reviewOutcome === 'incomplete' ? `${baseLabel} \u00b7 Incomplete` : baseLabel;

    const date = document.createElement('span');
    date.className = 'work-request-roster__history-date';
    date.textContent = formatDate(step.date);

    line.append(label, date);
    panel.appendChild(line);
  });

  return panel;
}

function describeMostRecentTransition(entry, isoDate) {
  const verb = { submitted: 'Submitted', resubmitted: 'Resubmitted', needs_correction: 'Reviewed', reviewed: 'Reviewed', absent: 'Marked' }[entry.status] || 'Updated';
  const outcomeSuffix = entry.status === 'reviewed' && entry.reviewOutcome === 'incomplete' ? ' \u00b7 Incomplete' : '';
  return `${verb} on ${formatDate(isoDate)}${outcomeSuffix}`;
}

function getClassroomStudents(classroom) {
  return classroom.teams.flatMap((team) => team.students);
}

function findTeamContaining(classroom, studentId) {
  return classroom.teams.find((team) => team.students.some((student) => student.id === studentId));
}
