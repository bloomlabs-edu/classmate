/**
 * ui/views/ConnectLearningHubView.js
 *
 * The ClassMate-side teacher workflow for the Learner Identity Bridge
 * — see docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md
 * for the full design this implements. Reached from the "Connect
 * Learning Hub" tile on ui/views/StudentAccessView.js's own Classroom
 * Access bento grid, as its own route (`connectLearningHub` — see
 * ui/router.js) rather than a section of that view, since this screen
 * needs real async Firestore reads (the classroom's own invitation,
 * and the pending-request queue) that StudentAccessView's synchronous,
 * already-loaded-`classroom`-object render was never built to perform.
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
 * The verification-code-issuance security binding (a code is only ever
 * redeemable by the exact learnerProfileId whose pending request it
 * was generated against) is enforced server-side — see
 * repositories/firestoreLearnerConnectionRepository.js's own
 * createStudentVerificationCodeForStudent() and
 * server/learnerVerification/verifyLearnerConnection.js's own
 * verifyStudentCode() — not by anything in this file. This view simply
 * always passes the reviewed row's own `learnerProfileId` through.
 */

import {
  createClassroomInvitationForClassroom,
  listClassroomInvitations,
  listRelationshipsForClassroom,
  createStudentVerificationCodeForStudent,
  rejectRelationship,
} from '../../repositories/firestoreLearnerConnectionRepository.js';
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
  let invitation = null; // the classroom's one active invitation, or null
  let relationships = null; // null = still loading
  let expandedRelationshipId = null;
  let selectedStudentId = null; // roster-picker draft for the currently expanded row only
  let issuedCode = null; // { relationshipId, rawCode, expiresAt } — transient, in-memory only; never persisted, never re-shown once the row changes
  let actionError = null;
  let isSubmittingAction = false;
  let isGeneratingInvitation = false;
  let notifiedPendingThisSession = false;

  const allRosterStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));

  function rerender() {
    renderConnectLearningHub(
      container,
      {
        classroom,
        loadError,
        invitation,
        relationships,
        expandedRelationshipId,
        selectedStudentId,
        issuedCode,
        actionError,
        isSubmittingAction,
        isGeneratingInvitation,
        allRosterStudents,
      },
      {
        onBack,
        onGenerateInvitation: async () => {
          isGeneratingInvitation = true;
          actionError = null;
          rerender();
          try {
            const created = await createClassroomInvitationForClassroom(classroom.id, currentUser?.uid);
            invitation = { id: created.invitationId, classroomId: classroom.id, code: created.code, status: 'active' };
          } catch (error) {
            console.error('[ConnectLearningHubView] Failed to generate a connection code:', error);
            actionError = GENERIC_ACTION_ERROR;
          }
          isGeneratingInvitation = false;
          rerender();
        },
        onToggleRow: (relationshipId) => {
          expandedRelationshipId = expandedRelationshipId === relationshipId ? null : relationshipId;
          // A fresh expand/collapse always clears any in-progress
          // picker selection and, critically, any issued code still
          // showing — the raw code must never be re-displayable once
          // this row's own review session ends (see this file's own
          // header comment, and models/LearnerConnection.js's own
          // createStudentVerificationCode() comment on why).
          selectedStudentId = null;
          issuedCode = null;
          actionError = null;
          rerender();
        },
        onSelectRosterStudent: (studentId) => {
          selectedStudentId = studentId;
          rerender();
        },
        onGenerateVerificationCode: async (relationship) => {
          if (!selectedStudentId) return;
          isSubmittingAction = true;
          actionError = null;
          rerender();
          try {
            const result = await createStudentVerificationCodeForStudent(
              classroom.id,
              selectedStudentId,
              currentUser?.uid,
              relationship.learnerProfileId
            );
            issuedCode = {
              relationshipId: buildRelationshipId(relationship.learnerProfileId, relationship.classroomId),
              rawCode: result.rawCode,
              expiresAt: result.expiresAt,
            };
          } catch (error) {
            console.error('[ConnectLearningHubView] Failed to generate a verification code:', error);
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
            issuedCode = null;
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

  Promise.all([listClassroomInvitations(classroom.id), listRelationshipsForClassroom(classroom.id)])
    .then(([invitations, rels]) => {
      invitation = invitations.find((inv) => inv.status === 'active') || null;
      relationships = rels;
      maybeNotifyPendingRequests();
      rerender();
    })
    .catch((error) => {
      console.error('[ConnectLearningHubView] Failed to load:', error);
      loadError = "Couldn't load Connect Learning Hub. Check your connection and try again.";
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
  title.textContent = 'Connect Learning Hub';
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

  content.appendChild(renderInvitationSection(state, handlers));

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
 * The classroom-wide invitation code — the first half of the bridge
 * (architecture doc §4): identifies this classroom only, never a
 * student, and is meant to be shared with the whole class the same way
 * the existing "Invite Students" code is. Reuses the exact
 * `.invite-students-card__code` display and copyText() helper every
 * other Classroom Access tile already uses — deliberately NOT the
 * "read this aloud" instruction, which only applies to the
 * student-specific verification code below (see renderIssuedCode()).
 */
function renderInvitationSection(state, handlers) {
  const section = document.createElement('div');
  section.className = 'connect-learning-hub__section';

  const heading = document.createElement('h2');
  heading.className = 'connect-learning-hub__section-heading';
  heading.textContent = 'Classroom connection code';
  section.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'connect-learning-hub__description';
  description.textContent = 'Share this with your class so learners can connect their Learning Hub account to this classroom. On its own, this code identifies your classroom only — it never grants access to a specific student.';
  section.appendChild(description);

  if (!state.invitation) {
    const generateButton = document.createElement('button');
    generateButton.type = 'button';
    generateButton.className = 'btn btn--primary';
    generateButton.textContent = state.isGeneratingInvitation ? 'Generating…' : 'Generate connection code';
    generateButton.disabled = state.isGeneratingInvitation;
    generateButton.addEventListener('click', handlers.onGenerateInvitation);
    section.appendChild(generateButton);
    return section;
  }

  const codeDisplay = document.createElement('div');
  codeDisplay.className = 'invite-students-card__code';
  codeDisplay.textContent = state.invitation.code;
  section.appendChild(codeDisplay);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn--ghost';
  copyButton.textContent = 'Copy Code';
  copyButton.addEventListener('click', () => copyText(state.invitation.code, 'Connection code copied to clipboard'));
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

  if (state.issuedCode) {
    detail.appendChild(renderIssuedCode(state.issuedCode));
    return detail;
  }

  const explanation = document.createElement('p');
  explanation.className = 'connect-learning-hub__row-detail-explanation';
  explanation.textContent = "We can't automatically match this Learning Hub learner to a student in your classroom. Select the student this request belongs to.";
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

  const generateButton = document.createElement('button');
  generateButton.type = 'button';
  generateButton.className = 'btn btn--primary';
  generateButton.textContent = state.isSubmittingAction ? 'Generating…' : 'Generate verification code';
  generateButton.disabled = !state.selectedStudentId || state.isSubmittingAction;
  generateButton.addEventListener('click', () => handlers.onGenerateVerificationCode(relationship));
  actions.appendChild(generateButton);

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

/**
 * The one-time display of a freshly generated verification code.
 * Deliberately the only place this raw code is ever rendered — it was
 * never written to Firestore (only its SHA-256 hash was, as the
 * document's own id; see createStudentVerificationCodeForStudent()'s
 * own header comment) and this component holds it only in the calling
 * view's own transient, in-memory state, cleared the moment this row
 * is collapsed or another row is expanded (see onToggleRow() above).
 * Both required instructional lines (architecture review item 2/5-6)
 * render as real text, not a tooltip or icon-only hint, and a clear
 * heading precedes the code value itself for screen readers.
 */
function renderIssuedCode(issuedCode) {
  const wrapper = document.createElement('div');
  wrapper.className = 'connect-learning-hub__issued-code';

  const heading = document.createElement('h4');
  heading.className = 'connect-learning-hub__issued-code-heading';
  heading.textContent = 'Verification code';
  wrapper.appendChild(heading);

  const codeDisplay = document.createElement('div');
  codeDisplay.className = 'invite-students-card__code';
  codeDisplay.textContent = issuedCode.rawCode;
  wrapper.appendChild(codeDisplay);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn--ghost';
  copyButton.textContent = 'Copy Code';
  copyButton.addEventListener('click', () => copyText(issuedCode.rawCode, 'Verification code copied to clipboard'));
  wrapper.appendChild(copyButton);

  const explainer = document.createElement('p');
  explainer.className = 'connect-learning-hub__description';
  explainer.textContent = 'This code lets the learner complete verification in Learning Hub. It stays PENDING until they redeem it there — this does not activate the connection by itself.';
  wrapper.appendChild(explainer);

  const hint = document.createElement('p');
  hint.className = 'connect-learning-hub__hint';
  hint.textContent = "Read this aloud, don't transmit it.";
  wrapper.appendChild(hint);

  return wrapper;
}
