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
import * as notebookReviewService from '../../services/notebookReviewService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { getBucketRowStyle } from '../../config/bucketConfig.js';
import { formatDate } from '../../utils/dateHelpers.js';
import { restoreObject } from '../../utils/objectRollback.js';

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

export function renderWorkRequestRosterView(container, { classroom, requestId, currentUser, onBack, onSelectStudent }) {
  const expandedStudentIds = new Set();
  let openOverflowStudentId = null;
  let activeFilterStatuses = null;

  function rerender() {
    render(container, classroom, requestId, expandedStudentIds, openOverflowStudentId, activeFilterStatuses, {
      onBack,
      onSelectStudent,
      onAdvance,
      onEditReview,
      onMarkNeedsCorrection,
      onMarkIncomplete,
      onMarkAbsent,
      onResetEntry,
      onToggleExpand,
      onToggleOverflow,
      onSetFilter,
      rerender,
    });
  }

  /**
   * The primary one-tap button. Every transition EXCEPT into 'reviewed'
   * behaves exactly as before (services/workRequestService.js's own
   * advanceStatus(), no criteria involved — "Mark Submitted"/"Mark
   * Resubmitted" are not review events). The one transition INTO
   * 'reviewed' is intercepted here and redirected to the criteria
   * checklist modal instead of flipping the status directly —
   * services/notebookReviewService.js's own submitNotebookReview() does
   * that flip itself, alongside awarding whatever criteria were
   * checked, so the two can never happen independently of each other.
   */
  function onAdvance(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    const entry = workRequestService.getEntryForStudent(request, studentId);
    if (!entry) return;

    if (workRequestService.getNextStatus(entry.status) === 'reviewed') {
      openReviewModal({ classroom, request, studentId, currentUser, mode: 'submit', onDone: rerender });
      return;
    }

    workRequestService.advanceStatus(request, studentId);
    rerender();
  }

  /**
   * Corrects the review that was JUST given — never re-walks the
   * lifecycle (the entry is already 'reviewed'), only reopens the same
   * checklist pre-filled with the current award so a teacher can fix a
   * mis-click without it reading as a second, independent review (see
   * services/notebookReviewService.js's own editNotebookReview()).
   */
  function onEditReview(studentId) {
    const request = workRequestService.getWorkRequestById(classroom, requestId);
    openOverflowStudentId = null;
    openReviewModal({ classroom, request, studentId, currentUser, mode: 'edit', onDone: rerender });
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

  const pinButton = document.createElement('button');
  pinButton.type = 'button';
  pinButton.className = 'btn btn--text';
  pinButton.textContent = request.pinnedToDashboard ? 'Unpin from Dashboard' : '\ud83d\udccc Pin to Dashboard';
  pinButton.addEventListener('click', () => {
    // Pinning only changes visibility on the Dashboard's Open Work
    // section (see services/workTypes/NotebookWorkType.js) — never
    // request.status, entries, or anything else. Not assignment.
    request.pinnedToDashboard = !request.pinnedToDashboard;
    workspaceService.save(classroom);
    handlers.rerender();
  });
  wrapper.appendChild(pinButton);

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

  // Compact, cumulative NOTEBOOK-RECOGNITION points only (see
  // services/notebookReviewService.js's own
  // getCumulativeNotebookRecognitionPoints() — never this student's
  // whole-app star total, and never this one review's own score, which
  // the expanded history panel below already shows per-award). Opens
  // the student's own profile — the Notebooks tab there has the full,
  // per-award criteria breakdown — so this number is always
  // individually verifiable from right here, matching
  // ui/components/ClassModeStudentRow.js's own compact pill styling for
  // visual consistency with "the existing ClassMate student-list
  // design," reused rather than inventing a second points-pill look.
  const pointsPill = document.createElement('button');
  pointsPill.type = 'button';
  pointsPill.className = 'student-row__points work-request-roster__points-pill';
  pointsPill.textContent = `${notebookReviewService.getCumulativeNotebookRecognitionPoints(student)} ⭐`;
  pointsPill.title = 'Notebook recognition points — open profile for the full award history';
  pointsPill.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onSelectStudent(student.id);
  });
  statusBlock.appendChild(pointsPill);

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
    // Only offered once a review actually exists to correct \u2014 a
    // 'reviewed' entry from before this feature existed has nothing in
    // entry.reviews yet (see models/NotebookReview.js's own
    // getCurrentReview()), and there is deliberately no way to create
    // one retroactively; its next genuine resubmission cycle gets a
    // fresh, real review instead.
    if (entry.status === 'reviewed' && notebookReviewService.getCurrentReview(entry)) {
      otherActionItems.push(createOverflowMenuItem('Edit Review', () => handlers.onEditReview(student.id)));
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

  if (entry.reviews && entry.reviews.length > 0) {
    panel.appendChild(createReviewHistorySection(entry));
  }

  return panel;
}

/**
 * The criteria-scoring breakdown for every review event on this entry
 * (see models/NotebookReview.js's own append-only design) \u2014 this IS the
 * "individually verifiable" award history for this one notebook: which
 * criteria earned a point, who reviewed it, and when. A superseded
 * review (one an "Edit Review" has since corrected) stays listed, just
 * visually de-emphasized and labeled "Superseded" rather than removed
 * \u2014 it is still a real, past event.
 */
function createReviewHistorySection(entry) {
  const section = document.createElement('div');
  section.className = 'work-request-roster__review-history';

  const heading = document.createElement('p');
  heading.className = 'work-request-roster__review-history-heading';
  heading.textContent = 'Review scoring';
  section.appendChild(heading);

  const current = notebookReviewService.getCurrentReview(entry);

  [...entry.reviews].reverse().forEach((review) => {
    const card = document.createElement('div');
    card.className = 'work-request-roster__review-card';
    if (review.id !== current?.id) card.classList.add('work-request-roster__review-card--superseded');

    const headerLine = document.createElement('div');
    headerLine.className = 'work-request-roster__review-card-header';

    const scoreEl = document.createElement('span');
    scoreEl.className = 'work-request-roster__review-score';
    scoreEl.textContent = `${review.totalPoints} point${review.totalPoints === 1 ? '' : 's'}`;
    headerLine.appendChild(scoreEl);

    if (review.id !== current?.id) {
      const supersededTag = document.createElement('span');
      supersededTag.className = 'work-request-roster__review-superseded-tag';
      supersededTag.textContent = 'Superseded';
      headerLine.appendChild(supersededTag);
    }

    const dateEl = document.createElement('span');
    dateEl.className = 'work-request-roster__review-date';
    dateEl.textContent = formatDate(review.reviewedAt);
    headerLine.appendChild(dateEl);

    card.appendChild(headerLine);

    const criteriaList = document.createElement('ul');
    criteriaList.className = 'work-request-roster__review-criteria-list';
    review.criteriaAwarded.forEach((criterion) => {
      const item = document.createElement('li');
      item.textContent = `\u2713 ${criterion.label}`;
      criteriaList.appendChild(item);
    });
    if (review.criteriaAwarded.length === 0) {
      const item = document.createElement('li');
      item.className = 'work-request-roster__review-criteria-empty';
      item.textContent = 'No criteria met';
      criteriaList.appendChild(item);
    }
    card.appendChild(criteriaList);

    section.appendChild(card);
  });

  return section;
}

function describeMostRecentTransition(entry, isoDate) {
  const verb = { submitted: 'Submitted', resubmitted: 'Resubmitted', needs_correction: 'Reviewed', reviewed: 'Reviewed', absent: 'Marked' }[entry.status] || 'Updated';
  const outcomeSuffix = entry.status === 'reviewed' && entry.reviewOutcome === 'incomplete' ? ' \u00b7 Incomplete' : '';
  return `${verb} on ${formatDate(isoDate)}${outcomeSuffix}`;
}

/**
 * The criteria checklist overlay — opened by onAdvance() (the entry's
 * FIRST review for this submission cycle) or onEditReview() (correcting
 * the current review of an already-'reviewed' entry). Shared between
 * both modes: same checklist, same "+ Add custom criterion" control,
 * only the submit action and the pre-checked state differ (see `mode`
 * below). Reuses .carry-forward-overlay's own fixed-backdrop/centered-
 * box shell, the same convention every other overlay in this app
 * (e.g. ui/views/TimetableView.js's Manage Timetable flow) already
 * follows.
 */
function openReviewModal({ classroom, request, studentId, currentUser, mode, onDone }) {
  const entry = workRequestService.getEntryForStudent(request, studentId);
  if (!entry) return;

  const existingReview = mode === 'edit' ? notebookReviewService.getCurrentReview(entry) : null;
  const checkedCriterionIds = new Set((existingReview?.criteriaAwarded || []).map((c) => c.criterionId));
  let newCriterionLabel = '';
  let errorMessage = '';
  // Guards re-entrancy during the one real async gap in this overlay
  // (awaiting the actual Firestore write) — without this, a second
  // click on "Save Review"/"Add" while the first is still in flight
  // could run the whole award/rollback logic twice concurrently.
  let isSaving = false;
  let isAddingCriterion = false;

  const overlay = document.createElement('div');
  overlay.className = 'carry-forward-overlay work-request-review-overlay';

  function close() {
    overlay.remove();
  }

  function renderBox() {
    overlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'carry-forward-overlay__box work-request-review-overlay__box';

    const title = document.createElement('h2');
    title.className = 'work-request-review-overlay__title';
    title.textContent = mode === 'edit' ? 'Edit Notebook Review' : 'Review Notebook';
    box.appendChild(title);

    const { submissionDateKey, isLate } = notebookReviewService.computeSubmissionTimeliness(entry, request);
    const timelyRow = document.createElement('div');
    timelyRow.className = `work-request-review-overlay__criterion work-request-review-overlay__criterion--system${isLate ? ' work-request-review-overlay__criterion--unmet' : ''}`;
    const timelyLabel = document.createElement('span');
    timelyLabel.textContent = `${isLate ? '✗' : '✓'} Timely submission`;
    timelyRow.appendChild(timelyLabel);
    const timelyNote = document.createElement('span');
    timelyNote.className = 'work-request-review-overlay__criterion-note';
    timelyNote.textContent = isLate
      ? `Submitted ${submissionDateKey ? formatDate(submissionDateKey) : 'after'} — due ${formatDate(request.dueDate)}. Determined automatically; cannot be awarded.`
      : 'Determined automatically from the submission and due dates.';
    timelyRow.appendChild(timelyNote);
    box.appendChild(timelyRow);

    const criteria = notebookConfigService.listReviewCriteria(classroom).filter((c) => !c.isSystemDetermined);
    const list = document.createElement('div');
    list.className = 'work-request-review-overlay__criteria-list';
    criteria.forEach((criterion) => {
      const row = document.createElement('label');
      row.className = 'work-request-review-overlay__criterion';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checkedCriterionIds.has(criterion.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) checkedCriterionIds.add(criterion.id);
        else checkedCriterionIds.delete(criterion.id);
      });
      row.appendChild(checkbox);

      const label = document.createElement('span');
      label.textContent = criterion.label;
      row.appendChild(label);

      list.appendChild(row);
    });
    box.appendChild(list);

    const addRow = document.createElement('div');
    addRow.className = 'work-request-review-overlay__add-row';
    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = 'Add a custom criterion (e.g. Labelled diagrams)';
    addInput.value = newCriterionLabel;
    addInput.addEventListener('input', () => {
      newCriterionLabel = addInput.value;
    });
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--secondary';
    addButton.textContent = isAddingCriterion ? 'Adding…' : 'Add';
    addButton.disabled = isAddingCriterion || isSaving;
    addButton.addEventListener('click', async () => {
      if (isAddingCriterion) return;

      const created = notebookConfigService.addCustomReviewCriterion(classroom, newCriterionLabel);
      if (!created) {
        errorMessage = 'Enter a new, not-already-used criterion name.';
        renderBox();
        return;
      }

      isAddingCriterion = true;
      errorMessage = '';
      renderBox();

      try {
        await workspaceService.saveExplicitly(classroom);
      } catch (error) {
        // Roll back the in-memory addition exactly — removeReviewCriterion()
        // is the same function Settings' own "remove criterion" action
        // would use, reused here rather than re-deriving the filter.
        notebookConfigService.removeReviewCriterion(classroom, created.id);
        isAddingCriterion = false;
        errorMessage = 'Could not save the new criterion — check your connection and try again. Nothing was added.';
        renderBox();
        return;
      }

      isAddingCriterion = false;
      checkedCriterionIds.add(created.id); // a criterion a teacher just added for THIS review is obviously meant to apply to it
      newCriterionLabel = '';
      errorMessage = '';
      renderBox();
    });
    addRow.append(addInput, addButton);
    box.appendChild(addRow);

    if (errorMessage) {
      const error = document.createElement('p');
      error.className = 'work-request-review-overlay__error';
      error.textContent = errorMessage;
      box.appendChild(error);
    }

    const actions = document.createElement('div');
    actions.className = 'work-request-review-overlay__actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = isSaving;
    cancelButton.addEventListener('click', close);
    actions.appendChild(cancelButton);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--primary';
    saveButton.textContent = isSaving ? 'Saving…' : mode === 'edit' ? 'Save Correction' : 'Save Review';
    saveButton.disabled = isSaving || isAddingCriterion;
    saveButton.addEventListener('click', async () => {
      if (isSaving) return;

      const criterionIds = [...checkedCriterionIds];
      const reviewedByUid = currentUser?.uid || null;

      // Snapshot BEFORE mutating, so a failed save can restore both
      // objects to exactly their pre-operation state — the entry
      // (status/history/reviewOutcome/reviews) and the student
      // (history/score), the full set of fields either service
      // function can touch, without having to track each one
      // individually and risk missing one as that logic evolves.
      const studentForRollback = findStudentById(classroom, studentId);
      const entrySnapshot = JSON.parse(JSON.stringify(entry));
      const studentSnapshot = studentForRollback ? JSON.parse(JSON.stringify(studentForRollback)) : null;

      const result =
        mode === 'edit'
          ? notebookReviewService.editNotebookReview(classroom, request, studentId, { criterionIds, reviewedByUid })
          : notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds, reviewedByUid });

      if (!result) {
        errorMessage = 'This notebook can no longer be reviewed in its current state — it may have just changed elsewhere.';
        renderBox();
        return;
      }

      isSaving = true;
      errorMessage = '';
      renderBox();

      try {
        await workspaceService.saveExplicitly(classroom);
      } catch (error) {
        restoreObject(entry, entrySnapshot);
        if (studentForRollback) restoreObject(studentForRollback, studentSnapshot);
        isSaving = false;
        errorMessage = 'Could not save this review — check your connection and try again. Nothing was recorded.';
        renderBox();
        return;
      }

      close();
      onDone();
    });
    actions.appendChild(saveButton);

    box.appendChild(actions);
    overlay.appendChild(box);
  }

  renderBox();
  document.body.appendChild(overlay);
}

/** Same small lookup services/notebookReviewService.js/services/recognitionService.js each keep their own private copy of — used here only to snapshot/restore a student object around a review save (see openReviewModal()'s own saveButton handler), not for anything that belongs in a shared service. */
function findStudentById(classroom, studentId) {
  for (const team of classroom.teams || []) {
    const student = team.students.find((s) => s.id === studentId);
    if (student) return student;
  }
  return null;
}

function getClassroomStudents(classroom) {
  return classroom.teams.flatMap((team) => team.students);
}

function findTeamContaining(classroom, studentId) {
  return classroom.teams.find((team) => team.students.some((student) => student.id === studentId));
}
