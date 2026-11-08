/**
 * ui/views/ConnectLearningHubView.js
 *
 * The ClassMate-side teacher workflow for the Learner Identity Bridge
 * — see docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md
 * for the full design this implements. Reached from the "Connect
 * Learning Hub" tile on ui/views/StudentAccessView.js's own Classroom
 * Access bento grid, as its own route (`connectLearningHub` — see
 * ui/router.js) rather than a section of that view, since this screen
 * needs a real async Firestore read (the pending-request queue) that
 * StudentAccessView's synchronous, already-loaded-`classroom`-object
 * render was never built to perform.
 *
 * Three things this screen deliberately does NOT do, each one a direct
 * requirement from the architecture doc / this feature's own review:
 *
 * 1. Never shows a learner name, email, or any inferred identity for a
 *    pending request — ClassMate has none of that for a Learning Hub
 *    learner (see §8 of the architecture doc, "no trusted automatic
 *    mapping exists"). Only a de-emphasized, truncated
 *    `learnerProfileId`, a relative timestamp, and a status pill.
 * 2. Never uses `onSnapshot` for the queue — `listRelationshipsForClassroom`
 *    is a one-time fetch; every mutation (generate code, reject)
 *    re-fetches explicitly afterward instead of relying on a live
 *    listener.
 * 3. Never lets a teacher type/paste a free-form student id anywhere —
 *    the roster picker (ui/components/SearchableSelect.js,
 *    `allowCustom: false`) only ever offers this classroom's own real
 *    roster, assembled the same
 *    `classroom.teams.flatMap((team) => team.students)` way
 *    ui/components/StudentMultiSelect.js already does.
 *
 * Never routes through, imports, or revives any Student Mode file
 * (StudentDeviceFlow.js, StudentJoinClassroomView.js,
 * StudentRosterPickerView.js, Goals/Recognition/Feed/Today/
 * Parent-Access/Avatar-Builder) — this is a distinct, ClassMate-owned
 * connection to a separate product (Learning Hub), built entirely on
 * top of the existing `learnerClassroomRelationships` bridge, not a
 * Student Mode join flow.
 *
 * SINGLE-CODE JOIN A CLASSROOM (product decision): picking a roster
 * student for a pending request activates the connection DIRECTLY —
 * no verification code is generated, shown, or transmitted to the
 * learner anywhere in this flow anymore. The activation itself is
 * authorized server-side by this teacher's own verified ClassMate
 * identity (functions/src/activateLearnerConnectionEndpoint.js ->
 * functions/src/learnerVerification/activateLearnerConnection.js) —
 * not by anything in this file. This view simply always passes the
 * reviewed row's own `learnerProfileId` and the picked `studentId`
 * through; the server independently re-verifies this teacher is a
 * real member of this exact classroom and that the student is really
 * on its live roster before ever writing anything.
 *
 * The OLDER code-based path (createStudentVerificationCodeForStudent(),
 * verifyStudentCode(), the studentVerificationCodes collection) still
 * exists, untouched, as infrastructure — this view just no longer
 * calls it. See services/learnerConnectionActivationService.js's own
 * header comment for the full "why" behind this change.
 *
 * UNIFIED CLASSROOM CODE (product decision): this view no longer
 * generates its own, separate "connection code" — classroomInvitationCodes
 * is legacy, read-only infrastructure now (still honored server-side,
 * see functions/src/learnerVerification/verifyLearnerConnection.js's own
 * resolveInvitationClassroomId()). Learners connect using the exact same
 * `classroom.classroomStudentJoinCode` StudentAccessView.js's single
 * "Invite Students" tile already displays for ClassMate Student Mode —
 * this screen only ever echoes that same value, read-only, never
 * generates a second one.
 */

import {
  listRelationshipsForClassroom,
  rejectRelationship,
} from '../../repositories/firestoreLearnerConnectionRepository.js';
import { activateLearnerConnection } from '../../services/learnerConnectionActivationService.js';
import { getIdToken } from '../../services/authService.js';
import { buildRelationshipId } from '../../models/LearnerConnection.js';
import {
  statusLabel,
  statusModifier,
  truncateLearnerProfileId,
  groupRelationshipsByQueueSection,
  buildRosterOptions,
  buildPendingWaveNotificationId,
} from './ConnectLearningHubDisplay.js';
import { getDisplayName } from '../../services/classroomService.js';
import * as notificationService from '../../services/notificationService.js';
import { NOTIFICATION_CATEGORIES } from '../../config/notificationCategories.js';
import { showToast } from '../components/Toast.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { createSearchableSelect } from '../components/SearchableSelect.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { formatRelativeTimestamp } from '../../utils/dateHelpers.js';
import { copyText } from './StudentAccessView.js';

const GENERIC_ACTION_ERROR = "Something went wrong. Try again.";

export function renderConnectLearningHubView(container, { classroom, currentUser, onBack }) {
  let loadError = null;
  let relationships = null; // null = still loading
  let expandedRelationshipId = null;
  let selectedStudentId = null; // roster-picker draft for the currently expanded row only
  let actionError = null;
  let isSubmittingAction = false;
  let notifiedPendingThisSession = false;

  const allRosterStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));

  function rerender() {
    renderConnectLearningHub(
      container,
      {
        classroom,
        loadError,
        relationships,
        expandedRelationshipId,
        selectedStudentId,
        actionError,
        isSubmittingAction,
        allRosterStudents,
      },
      {
        onBack,
        onToggleRow: (relationshipId) => {
          const wasExpanded = expandedRelationshipId === relationshipId;
          expandedRelationshipId = wasExpanded ? null : relationshipId;
          // A fresh expand/collapse always clears any in-progress picker
          // selection — this row's own review session has ended. EXCEPT
          // when the learner already made their own claim (LEARNER
          // SELF-IDENTITY CLAIM — see docs/architecture/
          // LEARNER_SELF_IDENTITY_CLAIM.md): the picker opens pre-filled
          // with their claimed student, turning "Confirm match" into a
          // single tap for the common case — the teacher can still pick
          // someone else, this is never the source of truth for the
          // actual write, only a starting point.
          const justExpanded = !wasExpanded && expandedRelationshipId;
          const expandedRelationship = justExpanded ? (relationships || []).find((r) => buildRelationshipId(r.learnerProfileId, r.classroomId) === expandedRelationshipId) : null;
          selectedStudentId = expandedRelationship?.claimedByLearner ? expandedRelationship.studentId : null;
          actionError = null;
          rerender();
        },
        onSelectRosterStudent: (studentId) => {
          selectedStudentId = studentId;
          rerender();
        },
        onActivateConnection: async (relationship) => {
          if (!selectedStudentId) return;
          isSubmittingAction = true;
          actionError = null;
          rerender();
          try {
            const idToken = await getIdToken();
            const result = await activateLearnerConnection(idToken, {
              classroomId: classroom.id,
              learnerProfileId: relationship.learnerProfileId,
              studentId: selectedStudentId,
            });
            if (!result.ok) {
              console.error('[ConnectLearningHubView] Failed to activate this connection:', result.reason);
              actionError = result.reason === 'student_already_linked'
                ? 'This student is already connected to a different Learning Hub account. Pick a different student, or resolve the other connection first.'
                : GENERIC_ACTION_ERROR;
            } else {
              showToast('Connection confirmed.');
              expandedRelationshipId = null;
              selectedStudentId = null;
              await refetchRelationships();
            }
          } catch (error) {
            console.error('[ConnectLearningHubView] Failed to activate this connection:', error);
            actionError = GENERIC_ACTION_ERROR;
          }
          isSubmittingAction = false;
          rerender();
        },
        onReject: async (relationship) => {
          const confirmed = window.confirm(
            "Reject this request? The learner will need to submit a new connection request from Learning Hub to try again."
          );
          if (!confirmed) return;
          isSubmittingAction = true;
          actionError = null;
          rerender();
          try {
            await rejectRelationship(buildRelationshipId(relationship.learnerProfileId, relationship.classroomId), currentUser?.uid);
            showToast('Request rejected.');
            expandedRelationshipId = null;
            selectedStudentId = null;
            await refetchRelationships();
          } catch (error) {
            console.error('[ConnectLearningHubView] Failed to reject this request:', error);
            actionError = GENERIC_ACTION_ERROR;
          }
          isSubmittingAction = false;
          rerender();
        },
      }
    );
  }

  async function refetchRelationships() {
    try {
      relationships = await listRelationshipsForClassroom(classroom.id);
    } catch (error) {
      // The mutation itself already succeeded (or already surfaced its
      // own actionError above) — a refresh failure here is secondary,
      // so the previous list stays on screen rather than being cleared.
      console.error('[ConnectLearningHubView] Failed to refresh the queue:', error);
    }
  }

  /**
   * Extends the existing teacher-notification system
   * (services/notificationService.js's own publishNotificationIfAbsent())
   * with a classroom-scoped, aggregated `connection_request_pending`
   * notification — one per PENDING WAVE, never one per learner request.
   * The notification id itself (ConnectLearningHubDisplay.js's own
   * buildPendingWaveNotificationId() — see that function's own header
   * comment for the full reasoning) is keyed off the oldest
   * currently-pending relationship, specifically so a fixed,
   * classroom-only id doesn't permanently suppress every notification
   * after the first one ever fires: once a whole wave resolves and a
   * later, genuinely new wave of pending requests arrives, the "oldest
   * pending" pointer necessarily changes, producing a fresh id that's
   * free to notify again. Published from here (a real teacher's own
   * already-open session, the same attribution pattern
   * services/feedService.js's subscribeToNewStudentPostsForClassroom()
   * already uses for its own non-teacher-triggered notification) rather
   * than from the server module that actually creates the PENDING
   * relationship, specifically because firestore.rules' notifications
   * create rule requires a real, authenticated classroom member as
   * createdByUid — exactly the one thing this view has that the
   * Admin-SDK-only bridge module does not. Never carries a learner
   * identity in its payload (`{ classroomId }` only) — the id itself is
   * built only from relationship ids this classroom's own teacher can
   * already read via listRelationshipsForClassroom(), so this is no new
   * exposure.
   */
  function maybeNotifyPendingRequests() {
    if (notifiedPendingThisSession || !currentUser?.uid) return;
    const notificationId = buildPendingWaveNotificationId(classroom.id, relationships || []);
    if (!notificationId) return;
    notifiedPendingThisSession = true;
    notificationService.publishNotificationIfAbsent(notificationId, classroom.id, {
      type: 'connection_request_pending',
      category: NOTIFICATION_CATEGORIES.CONNECTIONS,
      title: 'Learning Hub connection requests waiting',
      message: 'One or more learners are waiting to be matched to a student in your classroom.',
      payload: { classroomId: classroom.id },
      createdByUid: currentUser.uid,
    });
  }

  rerender();

  listRelationshipsForClassroom(classroom.id)
    .then((rels) => {
      relationships = rels;
      maybeNotifyPendingRequests();
      rerender();
    })
    .catch((error) => {
      console.error('[ConnectLearningHubView] Failed to load:', error);
      loadError = "Couldn't load Learning Hub Requests. Check your connection and try again.";
      rerender();
    });
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderConnectLearningHub(container, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'tracker-view connect-learning-hub';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(handlers.onBack));
  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Learning Hub Requests';
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = getDisplayName(state.classroom);
  titleBlock.append(title, subtitle);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'connect-learning-hub__error';
    error.textContent = state.loadError;
    content.appendChild(error);
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    return;
  }

  if (state.relationships === null) {
    const loading = document.createElement('p');
    loading.className = 'connect-learning-hub__loading';
    loading.textContent = 'Loading…';
    content.appendChild(loading);
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    return;
  }

  content.appendChild(renderInvitationSection(state));

  if (state.actionError) {
    const error = document.createElement('p');
    error.className = 'connect-learning-hub__action-error';
    error.textContent = state.actionError;
    content.appendChild(error);
  }

  content.appendChild(renderQueueSection(state, handlers));

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

/**
 * UNIFIED CLASSROOM CODE (product decision): the SAME code
 * StudentAccessView.js's "Invite Students" tile already shows for
 * ClassMate Student Mode — never a second, Learning-Hub-only code.
 * Read-only echo of `classroom.classroomStudentJoinCode`; this view
 * never generates one. If a classroom genuinely has none yet (only
 * possible for a classroom that predates this code existing at all —
 * see classroomService.createEmptyClassroom()'s own
 * ensureStudentJoinCode() call for every classroom created since), the
 * teacher is sent to Classroom Access, the one place that code is ever
 * generated, rather than duplicating that generation flow here.
 */
function renderInvitationSection(state) {
  const section = document.createElement('div');
  section.className = 'connect-learning-hub__section';

  const heading = document.createElement('h2');
  heading.className = 'connect-learning-hub__section-heading';
  heading.textContent = 'Your classroom code';
  section.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'connect-learning-hub__description';
  description.textContent = 'The same code you already share for ClassMate also connects a learner’s Learning Hub account to this classroom — there is nothing separate to generate or hand out.';
  section.appendChild(description);

  const code = state.classroom.classroomStudentJoinCode;

  if (!code) {
    const missingCodeNote = document.createElement('p');
    missingCodeNote.className = 'connect-learning-hub__description';
    missingCodeNote.textContent = 'This classroom doesn’t have a classroom code yet — generate one from Classroom Access first.';
    section.appendChild(missingCodeNote);
    return section;
  }

  const codeDisplay = document.createElement('div');
  codeDisplay.className = 'invite-students-card__code';
  codeDisplay.textContent = code;
  section.appendChild(codeDisplay);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn--ghost';
  copyButton.textContent = 'Copy Code';
  copyButton.addEventListener('click', () => copyText(code, 'Classroom code copied to clipboard'));
  section.appendChild(copyButton);

  return section;
}

/** Pending shown first, Recently decided (ACTIVE + REJECTED/REVOKED) second and collapsed — matches the architecture doc's own "multiple pending requests are never merged" requirement: every row below is one distinct relationship document, one per (learnerProfileId, classroomId) pair, never grouped by anything else. */
function renderQueueSection(state, handlers) {
  const section = document.createElement('div');
  section.className = 'connect-learning-hub__section';

  const heading = document.createElement('h2');
  heading.className = 'connect-learning-hub__section-heading';
  heading.textContent = 'Connection requests';
  section.appendChild(heading);

  const { pending, decided } = groupRelationshipsByQueueSection(state.relationships);

  if (state.relationships.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No Learning Hub connection requests yet.', compact: true }));
    return section;
  }

  const pendingGroup = document.createElement('div');
  pendingGroup.className = 'connect-learning-hub__queue-group';
  const pendingHeading = document.createElement('h3');
  pendingHeading.className = 'connect-learning-hub__queue-group-heading';
  pendingHeading.textContent = `Pending (${pending.length})`;
  pendingGroup.appendChild(pendingHeading);

  if (pending.length === 0) {
    pendingGroup.appendChild(createEmptyStateElement({ message: 'Nothing waiting for review.', compact: true }));
  } else {
    const list = document.createElement('div');
    list.className = 'connect-learning-hub__list';
    pending.forEach((relationship) => list.appendChild(renderPendingRow(relationship, state, handlers)));
    pendingGroup.appendChild(list);
  }
  section.appendChild(pendingGroup);

  if (decided.length > 0) {
    const details = document.createElement('details');
    details.className = 'connect-learning-hub__queue-group';
    const summary = document.createElement('summary');
    summary.className = 'connect-learning-hub__queue-group-heading';
    summary.textContent = `Recently decided (${decided.length})`;
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'connect-learning-hub__list';
    decided.forEach((relationship) => list.appendChild(renderDecidedRow(relationship)));
    details.appendChild(list);
    section.appendChild(details);
  }

  return section;
}

function statusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `connect-learning-hub__status-badge connect-learning-hub__status-badge--${statusModifier(status)}`;
  badge.textContent = statusLabel(status);
  return badge;
}

/** A simple, non-interactive row — "Recently decided" is informational only, no further action possible on an ACTIVE/REJECTED/REVOKED relationship from this screen. */
function renderDecidedRow(relationship) {
  const row = document.createElement('div');
  row.className = 'connect-learning-hub__row';

  const main = document.createElement('div');
  main.className = 'connect-learning-hub__row-main';

  const identity = document.createElement('div');
  identity.className = 'connect-learning-hub__row-identity';
  const idEl = document.createElement('span');
  idEl.className = 'connect-learning-hub__row-id';
  idEl.textContent = truncateLearnerProfileId(relationship.learnerProfileId);
  idEl.title = 'Learning Hub learner id (never a name or email — ClassMate has none for Learning Hub learners)';
  const timeEl = document.createElement('span');
  timeEl.className = 'connect-learning-hub__row-time';
  timeEl.textContent = formatRelativeTimestamp(relationship.createdAt);
  identity.append(idEl, timeEl);
  main.appendChild(identity);

  main.appendChild(statusBadge(relationship.status));
  row.appendChild(main);
  return row;
}

/**
 * An expandable, keyboard-accessible row (a real `<button>`, not a
 * clickable `<div>` — native focus/Enter/Space behavior for free) for
 * one still-unverified request. Expanding reveals the explicit
 * "can't automatically match" explanation (architecture doc §8) and
 * the roster picker — never a learner name/identity beyond the
 * truncated id already shown collapsed.
 */
function renderPendingRow(relationship, state, handlers) {
  const relationshipId = buildRelationshipId(relationship.learnerProfileId, relationship.classroomId);
  const isExpanded = state.expandedRelationshipId === relationshipId;

  const wrapper = document.createElement('div');

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'connect-learning-hub__row';
  row.setAttribute('aria-expanded', String(isExpanded));
  row.addEventListener('click', () => handlers.onToggleRow(relationshipId));

  const main = document.createElement('div');
  main.className = 'connect-learning-hub__row-main';

  const identity = document.createElement('div');
  identity.className = 'connect-learning-hub__row-identity';
  const idEl = document.createElement('span');
  idEl.className = 'connect-learning-hub__row-id';
  idEl.textContent = truncateLearnerProfileId(relationship.learnerProfileId);
  idEl.title = 'Learning Hub learner id (never a name or email — ClassMate has none for Learning Hub learners)';
  const timeEl = document.createElement('span');
  timeEl.className = 'connect-learning-hub__row-time';
  timeEl.textContent = formatRelativeTimestamp(relationship.createdAt);
  identity.append(idEl, timeEl);
  main.appendChild(identity);

  main.appendChild(statusBadge(relationship.status));
  row.appendChild(main);
  wrapper.appendChild(row);

  if (isExpanded) {
    wrapper.appendChild(renderPendingRowDetail(relationship, state, handlers));
  }

  return wrapper;
}

function renderPendingRowDetail(relationship, state, handlers) {
  const detail = document.createElement('div');
  detail.className = 'connect-learning-hub__row-detail';

  const claimedEntry = relationship.claimedByLearner
    ? state.allRosterStudents.find(({ student }) => student.id === relationship.studentId)
    : null;

  const explanation = document.createElement('p');
  explanation.className = 'connect-learning-hub__row-detail-explanation';
  explanation.textContent = claimedEntry
    ? `This learner selected their own name when joining. Confirm it's ${claimedEntry.student.name}, or pick someone else below.`
    : relationship.claimedByLearner
      ? "This learner selected a name when joining, but that student is no longer on your live roster. Select the correct student below."
      : "We can't automatically match this Learning Hub learner to a student in your classroom. Select the student this request belongs to.";
  detail.appendChild(explanation);

  const rosterOptions = buildRosterOptions(state.allRosterStudents);

  const picker = createSearchableSelect({
    options: rosterOptions,
    value: state.selectedStudentId || '',
    placeholder: 'Find a student…',
    allowCustom: false,
    onSelect: (studentId) => handlers.onSelectRosterStudent(studentId),
  });
  detail.appendChild(picker.wrapper);

  const selectedEntry = state.allRosterStudents.find(({ student }) => student.id === state.selectedStudentId);
  if (selectedEntry) {
    const confirmRow = document.createElement('div');
    confirmRow.className = 'connect-learning-hub__row-selected-student';
    confirmRow.appendChild(createStudentNameElement({ student: selectedEntry.student, team: selectedEntry.team, leadingMarker: 'avatar', size: 32 }));
    detail.appendChild(confirmRow);
  }

  const actions = document.createElement('div');
  actions.className = 'connect-learning-hub__row-actions';

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'btn btn--primary';
  confirmButton.textContent = state.isSubmittingAction ? 'Confirming…' : 'Confirm match';
  confirmButton.disabled = !state.selectedStudentId || state.isSubmittingAction;
  confirmButton.addEventListener('click', () => handlers.onActivateConnection(relationship));
  actions.appendChild(confirmButton);

  const rejectButton = document.createElement('button');
  rejectButton.type = 'button';
  rejectButton.className = 'btn btn--text btn--danger-text';
  rejectButton.textContent = 'Reject';
  rejectButton.disabled = state.isSubmittingAction;
  rejectButton.addEventListener('click', () => handlers.onReject(relationship));
  actions.appendChild(rejectButton);

  detail.appendChild(actions);
  return detail;
}
