/**
 * ui/views/ProgrammeSessionView.js
 *
 * "Today's Session" — now a session DASHBOARD, not a notebook. This
 * round's own redesign turns what used to be one long scroll of four
 * form-like sections into: a header, a compact "TODAY" stats strip,
 * and four destination blocks (Attendance · Goals · Activities ·
 * Observations). Attendance and Daily Goals are summary cards that
 * drill into their own focused screens
 * (ui/views/ProgrammeAttendanceView.js, ProgrammeGoalsReviewView.js) —
 * both involve one control per roster student, which doesn't fit as
 * inline dashboard content without recreating the exact "notebook"
 * problem this redesign exists to fix. Activities and Observations
 * stay on this page: Activities because there are usually only a
 * handful and they're glanceable as chips; Observations because
 * adding a new one shouldn't require leaving the page, even though
 * viewing the full list still does (ui/views/ProgrammeObservationsView.js).
 *
 * DEFAULT STATE MUST BE CLEAN, PER THIS PROJECT'S OWN EXPLICIT
 * REDESIGN PRINCIPLE: no permanently visible blank input field
 * anywhere on this page. Every add/edit control (Activities'
 * suggestion picker, Observations' entry form) is reached through an
 * explicit action and reveals only once tapped — see
 * buildActivitiesBlock() below for the one case that still lives
 * directly on this page.
 *
 * DATA FLOW — unchanged: VIEW -> services/programmeSessionService.js
 * -> Firestore. This view never mutates `classroom` and never calls
 * services/workspaceService.js's save() for anything here —
 * ProgrammeSession data lives entirely in its own Firestore
 * subcollection, with its own persistence path.
 *
 * EDITABILITY / LOADING — unchanged from every prior round: a session
 * is editable only if it's today's own session for a still-active
 * programme (see ProgrammeSessionHelpers.js's own isSessionEditable());
 * reopening this screen always loads the already-persisted session
 * and renders exactly what's there — nothing here regenerates,
 * resets, or re-derives historical state.
 */

import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../services/programmeSessionService.js';
import {
  isSessionEditable,
  resolveSessionRoster,
  countAttendanceByStatus,
  countStudentsWithGoals,
  countActivities,
  countObservations,
} from '../components/ProgrammeSessionHelpers.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { openAddObservationModal } from '../components/AddObservationModal.js';
import { createOverflowMenu } from '../components/OverflowMenu.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { formatDateKey } from '../../utils/dateHelpers.js';

// View-local, deliberately NOT part of the domain model — see this
// project's own prior audit for why: Phase 1.6's default configuration
// has no stored "suggested activities" field, and adding one now
// would be a data-model change nothing in this round asked for. Purely
// a UI quick-fill convenience; the actual recorded activity is always
// whatever text ends up in `activities[]`, suggested or freely typed.
const SUGGESTED_ACTIVITIES = ['Guided Reading', 'Partner Speaking', 'Vocabulary Game'];

// A small, view-local icon lookup for the three known suggestions,
// with a generic fallback for any freely-typed activity name — purely
// cosmetic, never persisted, never read back from anywhere.
const ACTIVITY_ICON_BY_NAME = {
  'Guided Reading': '\ud83d\udcd6',
  'Partner Speaking': '\ud83d\udde3\ufe0f',
  'Vocabulary Game': '\ud83d\udd24',
};
const DEFAULT_ACTIVITY_ICON = '\ud83d\udccc';

export async function renderProgrammeSessionView(
  container,
  { classroom, programmeId, sessionId, onBack, onOpenAttendance, onOpenGoals, onOpenObservations }
) {
  container.innerHTML = '';

  const programme = learningProgrammeService.getLearningProgrammeById(classroom, programmeId);
  if (!programme) {
    container.appendChild(createEmptyStateElement({ message: 'This Learning Programme could not be found.' }));
    return;
  }

  const session = await programmeSessionService.getSessionById(classroom.id, sessionId);
  if (!session) {
    container.appendChild(createEmptyStateElement({ message: 'This session could not be found.' }));
    return;
  }
  // PHASE 3.7 — this dashboard only ever READS session.goals (via
  // countStudentsWithGoals() below, for the stats strip) — it never
  // writes goals itself (that's ProgrammeGoalsReviewView.js's own
  // job) — so hydration alone, with no goalWriter, is all this screen
  // needs. A no-op for a session created before this phase.
  await programmeSessionService.hydrateSessionGoals(classroom.id, session);

  const editable = isSessionEditable(session, programme);
  const roster = resolveSessionRoster(classroom, programme, session, editable);

  const wrapper = document.createElement('div');
  wrapper.className = 'programme-session-view';

  wrapper.appendChild(buildHeader(programme, session, roster, editable, onBack));
  wrapper.appendChild(buildStatsStrip(session, roster, editable));

  const { element: saveIndicator, persistPatch } = createSaveIndicatorController(classroom.id, session);
  wrapper.appendChild(saveIndicator);

  if (roster.length === 0) {
    wrapper.appendChild(
      createEmptyStateElement({
        message: editable ? 'No active members yet \u2014 add students from Settings to begin.' : 'No students were recorded in this session.',
      })
    );
    wrapper.appendChild(buildActivitiesBlock(session, editable, persistPatch, () => renderProgrammeSessionView(container, { classroom, programmeId, sessionId, onBack, onOpenAttendance, onOpenGoals, onOpenObservations })));
    container.appendChild(wrapper);
    return;
  }

  const blocks = document.createElement('div');
  blocks.className = 'programme-session-view__blocks';

  blocks.appendChild(buildAttendanceBlock(session, roster, editable, () => onOpenAttendance(session.id)));
  blocks.appendChild(buildGoalsBlock(session, roster, editable, () => onOpenGoals(session.id)));
  blocks.appendChild(
    buildActivitiesBlock(session, editable, persistPatch, () =>
      renderProgrammeSessionView(container, { classroom, programmeId, sessionId, onBack, onOpenAttendance, onOpenGoals, onOpenObservations })
    )
  );
  blocks.appendChild(
    buildObservationsBlock(programme, session, roster, editable, persistPatch, () => onOpenObservations(session.id), () =>
      renderProgrammeSessionView(container, { classroom, programmeId, sessionId, onBack, onOpenAttendance, onOpenGoals, onOpenObservations })
    )
  );

  wrapper.appendChild(blocks);
  container.appendChild(wrapper);
}

function buildHeader(programme, session, roster, editable, onBack) {
  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(onBack));

  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = programme.name;
  titleBlock.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  const dateText = formatDateKey(session.date);
  subtitle.textContent = `${dateText} \u00b7 ${roster.length} student${roster.length === 1 ? '' : 's'}${editable ? '' : ' \u00b7 Read-only'}`;
  titleBlock.appendChild(subtitle);

  header.appendChild(titleBlock);
  return header;
}

/**
 * The compact "TODAY" stats strip — plain text, matching
 * `.profile-section__meta`'s own existing typography rather than a
 * heavier KPI-card treatment, per this project's own explicit "keep
 * it compact, like a dashboard summary, not another section"
 * direction. Shows only real, already-available data — no invented
 * statistics: attendance counts, a goal-coverage count, an activity
 * count, and a Topic line only when `session.title` is actually set
 * (no new field, no new UI to set it this round — see this file's
 * own header comment).
 */
function buildStatsStrip(session, roster, editable) {
  const strip = document.createElement('div');
  strip.className = 'programme-session-view__stats-strip';

  const label = document.createElement('p');
  label.className = 'programme-session-view__stats-strip-label';
  label.textContent = 'TODAY';
  strip.appendChild(label);

  const counts = countAttendanceByStatus(session, roster, editable);
  const attendanceLine = document.createElement('p');
  attendanceLine.className = 'programme-session-view__stats-strip-line';
  attendanceLine.textContent = `${counts.present} Present \u00b7 ${counts.absent} Absent \u00b7 ${counts.late} Late`;
  strip.appendChild(attendanceLine);

  const goalsWithCount = countStudentsWithGoals(session, roster);
  const activitiesCount = countActivities(session);
  const secondLineParts = [`${goalsWithCount} Goal${goalsWithCount === 1 ? '' : 's'}`, `${activitiesCount} Activit${activitiesCount === 1 ? 'y' : 'ies'}`];
  if (session.title) secondLineParts.push(`Topic: ${session.title}`);
  const secondLine = document.createElement('p');
  secondLine.className = 'programme-session-view__stats-strip-line';
  secondLine.textContent = secondLineParts.join(' \u00b7 ');
  strip.appendChild(secondLine);

  return strip;
}

/** A summary block: heading, one or two lines of real data, one primary action. Shared shell for the Attendance and Daily Goals blocks — Activities and Observations need slightly richer content, so they build their own. */
function buildSummaryBlock({ heading, summaryLines, actionLabel, onAction }) {
  const block = document.createElement('div');
  block.className = 'programme-session-view__block';

  const headingEl = document.createElement('h2');
  headingEl.className = 'programme-session-view__block-heading';
  headingEl.textContent = heading;
  block.appendChild(headingEl);

  summaryLines.forEach((line) => {
    const lineEl = document.createElement('p');
    lineEl.className = 'programme-session-view__block-summary';
    lineEl.textContent = line;
    block.appendChild(lineEl);
  });

  const actionButton = document.createElement('button');
  actionButton.type = 'button';
  actionButton.className = 'btn btn--primary programme-session-view__block-action';
  actionButton.textContent = actionLabel;
  actionButton.addEventListener('click', onAction);
  block.appendChild(actionButton);

  return block;
}

function buildAttendanceBlock(session, roster, editable, onOpen) {
  const counts = countAttendanceByStatus(session, roster, editable);
  return buildSummaryBlock({
    heading: 'ATTENDANCE',
    summaryLines: [`${roster.length} students \u00b7 ${counts.present} present \u00b7 ${counts.absent} absent \u00b7 ${counts.late} late`],
    actionLabel: editable ? 'Mark Attendance' : 'View Attendance',
    onAction: onOpen,
  });
}

function buildGoalsBlock(session, roster, editable, onOpen) {
  const goalsWithCount = countStudentsWithGoals(session, roster);
  return buildSummaryBlock({
    heading: 'DAILY GOALS',
    summaryLines: [`${goalsWithCount} / ${roster.length} students have goals`],
    actionLabel: editable ? 'View / Review Goals' : 'View Goals',
    onAction: onOpen,
  });
}

/**
 * Activities — stays on the dashboard, per this round's own approved
 * information architecture, since a handful of chips is glanceable
 * without needing a separate screen. Each recorded activity is a real
 * chip, not embedded text, with its own "⋮" reusing
 * ui/components/OverflowMenu.js directly (the established, platform-
 * wide pattern for "manage a standalone object") — never a custom
 * menu built from scratch. "+ Add Activity" is collapsed by default;
 * tapping it reveals the same quick-suggestion buttons + custom-text
 * field this feature has always had, inline, in place — never a
 * permanently visible input.
 */
function buildActivitiesBlock(session, editable, persistPatch, redraw) {
  const block = document.createElement('div');
  block.className = 'programme-session-view__block programme-session-view__block--activities';

  const headingEl = document.createElement('h2');
  headingEl.className = 'programme-session-view__block-heading';
  headingEl.textContent = 'ACTIVITIES';
  block.appendChild(headingEl);

  if (session.activities.length === 0) {
    const noneNote = document.createElement('p');
    noneNote.className = 'programme-session-view__block-summary';
    noneNote.textContent = 'No activities recorded yet.';
    block.appendChild(noneNote);
  } else {
    const chipList = document.createElement('div');
    chipList.className = 'programme-session-view__activity-chip-list';
    session.activities.forEach((activity, index) => {
      chipList.appendChild(buildActivityChip(session, activity, index, editable, persistPatch, redraw));
    });
    block.appendChild(chipList);
  }

  if (editable) {
    block.appendChild(buildAddActivityDisclosure(session, persistPatch, redraw));
  }

  return block;
}

function buildActivityChip(session, activity, index, editable, persistPatch, redraw) {
  const chip = document.createElement('div');
  chip.className = 'programme-session-view__activity-chip';

  const icon = document.createElement('span');
  icon.className = 'programme-session-view__activity-chip-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = ACTIVITY_ICON_BY_NAME[activity.name] || DEFAULT_ACTIVITY_ICON;
  chip.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'programme-session-view__activity-chip-label';
  label.textContent = activity.notes ? `${activity.name} \u2014 ${activity.notes}` : activity.name;
  chip.appendChild(label);

  if (editable) {
    chip.appendChild(
      createOverflowMenu({
        ariaLabel: `Actions for ${activity.name}`,
        actions: [
          {
            label: 'Remove',
            danger: true,
            onClick: async () => {
              programmeSessionService.removeActivity(session, index);
              await persistPatch(() => programmeSessionService.buildActivitiesPatch(session));
              redraw();
            },
          },
        ],
      })
    );
  }

  return chip;
}

/** Collapsed by default — see this file's own header comment for why no add-input may sit permanently visible. Reveals the same quick-suggestion buttons + custom-text field this feature has always had. */
function buildAddActivityDisclosure(session, persistPatch, redraw) {
  const wrapper = document.createElement('div');
  wrapper.className = 'programme-session-view__add-activity-disclosure';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'btn btn--text';
  toggleButton.textContent = '+ Add Activity';

  const revealContainer = document.createElement('div');
  revealContainer.className = 'programme-session-view__add-activity-row';
  revealContainer.hidden = true;

  SUGGESTED_ACTIVITIES.forEach((name) => {
    const quickButton = document.createElement('button');
    quickButton.type = 'button';
    quickButton.className = 'btn btn--ghost';
    quickButton.textContent = name;
    quickButton.addEventListener('click', async () => {
      programmeSessionService.recordActivity(session, { name });
      await persistPatch(() => programmeSessionService.buildActivitiesPatch(session));
      redraw();
    });
    revealContainer.appendChild(quickButton);
  });

  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'modal__input';
  customInput.placeholder = 'Custom activity\u2026';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--secondary';
  addButton.textContent = 'Add';
  addButton.addEventListener('click', async () => {
    const name = customInput.value.trim();
    if (!name) return;
    programmeSessionService.recordActivity(session, { name });
    await persistPatch(() => programmeSessionService.buildActivitiesPatch(session));
    redraw();
  });
  revealContainer.append(customInput, addButton);

  toggleButton.addEventListener('click', () => {
    revealContainer.hidden = !revealContainer.hidden;
    toggleButton.textContent = revealContainer.hidden ? '+ Add Activity' : 'Cancel';
  });

  wrapper.append(toggleButton, revealContainer);
  return wrapper;
}

/**
 * Observations — a summary + [View Observations] drill-in, exactly
 * like Attendance/Goals, but ALSO offers "+ Add Observation" directly
 * here, since adding a new one shouldn't require a detour through the
 * full list first. Opens ui/components/AddObservationModal.js — never
 * a permanently visible input on this page.
 */
function buildObservationsBlock(programme, session, roster, editable, persistPatch, onOpen, redraw) {
  const block = document.createElement('div');
  block.className = 'programme-session-view__block';

  const headingEl = document.createElement('h2');
  headingEl.className = 'programme-session-view__block-heading';
  headingEl.textContent = 'OBSERVATIONS';
  block.appendChild(headingEl);

  const count = countObservations(session);
  const summary = document.createElement('p');
  summary.className = 'programme-session-view__block-summary';
  summary.textContent = `${count} observation${count === 1 ? '' : 's'} recorded`;
  block.appendChild(summary);

  const viewButton = document.createElement('button');
  viewButton.type = 'button';
  viewButton.className = 'btn btn--primary programme-session-view__block-action';
  viewButton.textContent = 'View Observations';
  viewButton.addEventListener('click', onOpen);
  block.appendChild(viewButton);

  if (editable && roster.length > 0) {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--text';
    addButton.textContent = '+ Add Observation';
    addButton.addEventListener('click', () => {
      openAddObservationModal({
        roster,
        onSave: async ({ studentId, note }) => {
          programmeSessionService.recordTeacherObservation(programme, session, { studentId, note });
          await persistPatch(() => programmeSessionService.buildTeacherObservationPatch(session, studentId));
          redraw();
        },
      });
    });
    block.appendChild(addButton);
  }

  return block;
}
