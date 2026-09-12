/**
 * ui/views/StudentAccessView.js
 *
 * "Classroom Access" — a Bento-style access hub, not a stack of
 * identically-weighted settings sections. Genuinely different
 * purposes, given genuinely different visual weights (per explicit
 * product direction — these must never read as "N versions of the
 * same permission"):
 *
 *   Students  -> join my class   (large/primary tile — the one thing
 *                                 this page leads with)
 *   Co-Teacher -> teach with me  (medium tile — full access)
 *   Program Manager -> review my Weekly Plans (medium tile — narrow,
 *                                 real membership: REVIEW_LESSON_PLAN/
 *                                 APPROVE_LESSON_PLAN only, added
 *                                 alongside Co-Teacher for Programme
 *                                 Manager Weekly Plan Review — its own
 *                                 separate code, never interchangeable
 *                                 with the Co-Teacher one)
 *   Visitor    -> explore my class (medium tile — read-only demo,
 *                                 never a classroom member — see
 *                                 services/visitorAccessService.js's
 *                                 own header comment for why this is
 *                                 architecturally NOTHING like the
 *                                 other three)
 *
 * Device Security is real, kept working exactly as before, but
 * deliberately demoted to a small, quiet section below the three
 * tiles — informational/secondary, never competing with the
 * invitation actions above it.
 *
 * Bento composition, not "everything is a rounded card": one shared
 * quiet base (no shadows/gradients), hierarchy from size/typography,
 * restrained per-tile accent color — see .classroom-access-bento* in
 * css/styles.css.
 */

import * as classroomService from '../../services/classroomService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as memberService from '../../services/memberService.js';
import * as visitorAccessService from '../../services/visitorAccessService.js';
import { buildCoTeacherInvitationMessage, buildVisitorInvitationMessage, buildProgramManagerInvitationMessage } from '../../services/invitationMessageService.js';
import { ensureJoinCode, ensureProgramManagerJoinCode } from '../../services/classroomService.js';
import { MEMBER_ROLES } from '../../config/memberRoles.js';
import { showToast } from '../components/Toast.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { getDisplayName } from '../../services/classroomService.js';
import { APP_BASE_URL } from '../../config/appConfig.js';
import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';

export function renderStudentAccessView(container, { classroom, currentUser, onBack, onSelectStudent }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'tracker-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';

  const backButton = createBackButton(onBack);

  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Classroom Access';
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = getDisplayName(classroom);
  titleBlock.append(title, subtitle);

  header.append(backButton, titleBlock);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const rerender = () => renderStudentAccessView(container, { classroom, currentUser, onBack, onSelectStudent });

  const bento = document.createElement('div');
  bento.className = 'classroom-access-bento';
  bento.appendChild(createInviteStudentsTile(classroom, rerender));
  bento.appendChild(createInviteCoTeacherTile(classroom, currentUser, rerender));
  bento.appendChild(createInviteProgramManagerTile(classroom, currentUser, rerender));
  bento.appendChild(createVisitorAccessTile(classroom, currentUser, rerender));
  content.appendChild(bento);

  content.appendChild(createDeviceSecurityCard(classroom, rerender));

  const allStudents = classroom.teams.flatMap((team) => team.students);
  if (allStudents.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'There are no students in this classroom yet.' }));
  } else {
    content.appendChild(createJoinedStatusList(allStudents, onSelectStudent));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

/**
 * Copies `text` to the clipboard, with the same
 * toast-on-success/alert-on-failure fallback every code-copy button on
 * this page already used before this redesign — one shared place for
 * that fallback chain rather than repeating it per button.
 */
async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch (error) {
    console.error('[StudentAccessView] Failed to copy to clipboard:', error);
    window.alert(text);
  }
}

/**
 * One prominent "Share with ___" action (native share when supported,
 * falling back to clipboard copy exactly like createInviteStudentsTile()'s
 * own existing "Share with Students" button — same fallback chain,
 * same tone, applied to the two new invitation types), plus a smaller,
 * always-present "Copy invitation" action for copying the message
 * without invoking the native share sheet even when one's available.
 * Two buttons, never three — the prominent Share button itself IS the
 * "use native sharing if supported" affordance, not a separate one on
 * top of it.
 */
function createInvitationActions({ message, shareLabel }) {
  const row = document.createElement('div');
  row.className = 'invite-students-card__actions';

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'btn btn--primary';
  shareButton.appendChild(createIcon('share-2', { size: 14 }));
  shareButton.append(` ${shareLabel}`);
  shareButton.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join on ClassMate', text: message });
        return;
      } catch (error) {
        // Cancelled the native share sheet, or it's unavailable — fall through to copy.
      }
    }
    copyText(message, 'Invitation copied to clipboard');
  });
  row.appendChild(shareButton);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn--ghost';
  copyButton.textContent = 'Copy invitation';
  copyButton.addEventListener('click', () => copyText(message, 'Invitation copied to clipboard'));
  row.appendChild(copyButton);

  return row;
}

/**
 * The one thing this page leads with now — a single code/link the
 * teacher shares once (board, WhatsApp, projected), replacing forty
 * individual PIN-generation actions with one. Unchanged functionality
 * from before this redesign; only its visual weight (the large,
 * primary Bento tile) changed.
 */
function createInviteStudentsTile(classroom, rerender) {
  const card = document.createElement('div');
  card.className = 'classroom-access-bento__tile classroom-access-bento__tile--primary';

  const iconBadge = document.createElement('div');
  iconBadge.className = 'classroom-access-bento__icon-badge';
  iconBadge.appendChild(createIcon('users', { size: 22 }));
  card.appendChild(iconBadge);

  const heading = document.createElement('h2');
  heading.className = 'classroom-access-bento__heading';
  heading.textContent = 'Invite Students';
  card.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'classroom-access-bento__description';
  description.textContent = 'Join my class — share one code with the whole class at once. On the board, over WhatsApp, or projected. No individual invitations needed.';
  card.appendChild(description);

  if (!classroom.classroomStudentJoinCode) {
    // Only classrooms created before this feature existed can reach
    // this branch — every classroom created going forward already has
    // a code (see classroomService.createEmptyClassroom()). Generating
    // one here happens only in direct response to a click, never
    // automatically as a side effect of rendering this page — see
    // this project's CHANGELOG on why a render function must never
    // perform a write.
    const generateButton = document.createElement('button');
    generateButton.type = 'button';
    generateButton.className = 'btn btn--primary';
    generateButton.textContent = 'Generate Classroom Code';
    generateButton.addEventListener('click', () => {
      classroomService.ensureStudentJoinCode(classroom);
      workspaceService.save(classroom);
      workspaceService.createStudentJoinCodeMapping(classroom.classroomStudentJoinCode, classroom.id);
      rerender();
    });
    card.appendChild(generateButton);
    return card;
  }

  const code = classroom.classroomStudentJoinCode;
  const link = `${APP_BASE_URL}#/student`;

  const codeDisplay = document.createElement('div');
  codeDisplay.className = 'invite-students-card__code';
  codeDisplay.textContent = code;
  card.appendChild(codeDisplay);

  const actions = document.createElement('div');
  actions.className = 'invite-students-card__actions';

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'btn btn--primary btn--large';
  shareButton.textContent = 'Share with Students';
  shareButton.addEventListener('click', async () => {
    const shareText = `🎉 You've been invited to join our classroom on ClassMate!\n\nOpen the Student Portal using the link below.\n\nClassroom Code:\n${code}\n\nStudent Portal:\n${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join our classroom on ClassMate', text: shareText });
        return;
      } catch (error) {
        // Cancelled the native share sheet, or it's unavailable — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      showToast('Invitation copied to clipboard');
    } catch (error) {
      console.error('[StudentAccessView] Failed to copy invitation:', error);
      window.alert(shareText);
    }
  });
  actions.appendChild(shareButton);

  const copyCodeButton = document.createElement('button');
  copyCodeButton.type = 'button';
  copyCodeButton.className = 'btn btn--ghost';
  copyCodeButton.textContent = 'Copy Code';
  copyCodeButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyCodeButton.textContent = 'Copied!';
      setTimeout(() => { copyCodeButton.textContent = 'Copy Code'; }, 1500);
    } catch (error) {
      console.error('[StudentAccessView] Failed to copy code:', error);
      window.alert(`Classroom code: ${code}`);
    }
  });
  actions.appendChild(copyCodeButton);

  card.appendChild(actions);
  return card;
}

/**
 * The co-teacher join code — full classroom access. Only shown to the
 * classroom owner; a non-owner has no reason to hand this code out
 * (unchanged gate from before this redesign). New in this redesign:
 * a ready-to-share invitation message (see
 * services/invitationMessageService.js's own buildCoTeacherInvitationMessage())
 * with explicit Copy invitation / Share actions, alongside the
 * existing bare Copy Code.
 */
function createInviteCoTeacherTile(classroom, currentUser, rerender) {
  const card = document.createElement('div');
  card.className = 'classroom-access-bento__tile classroom-access-bento__tile--medium';

  const isOwner = currentUser && memberService.isOwner(classroom, currentUser.uid);
  if (!isOwner) return card;

  const iconBadge = document.createElement('div');
  iconBadge.className = 'classroom-access-bento__icon-badge classroom-access-bento__icon-badge--co-teacher';
  iconBadge.appendChild(createIcon('user-plus', { size: 20 }));
  card.appendChild(iconBadge);

  const heading = document.createElement('h2');
  heading.className = 'classroom-access-bento__heading';
  heading.textContent = 'Invite a Co-Teacher';
  card.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'classroom-access-bento__description';
  description.textContent = 'Teach with me — full access to students, scores, and settings, same as you.';
  card.appendChild(description);

  if (!classroom.classroomJoinCode) {
    const generateButton = document.createElement('button');
    generateButton.type = 'button';
    generateButton.className = 'btn btn--primary';
    generateButton.textContent = 'Generate Classroom ID';
    generateButton.addEventListener('click', () => {
      ensureJoinCode(classroom);
      workspaceService.save(classroom);
      workspaceService.createJoinCodeMapping(classroom.classroomJoinCode, classroom.id, MEMBER_ROLES.TEACHER);
      rerender();
    });
    card.appendChild(generateButton);
    return card;
  }

  const codeDisplay = document.createElement('div');
  codeDisplay.className = 'invite-students-card__code';
  codeDisplay.textContent = classroom.classroomJoinCode;
  card.appendChild(codeDisplay);

  const message = buildCoTeacherInvitationMessage({ classroomName: getDisplayName(classroom), code: classroom.classroomJoinCode });
  card.appendChild(createInvitationActions({ message, shareLabel: 'Share with Co-Teacher' }));

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn--ghost';
  copyButton.textContent = 'Copy Code';
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(classroom.classroomJoinCode);
      copyButton.textContent = 'Copied!';
      setTimeout(() => { copyButton.textContent = 'Copy Code'; }, 1500);
    } catch (error) {
      console.error('[StudentAccessView] Failed to copy join code:', error);
      window.alert(`Classroom ID: ${classroom.classroomJoinCode}`);
    }
  });
  card.appendChild(copyButton);

  return card;
}

/**
 * The Program Manager join code — Programme Manager Weekly Plan Review's
 * own invite tile, deliberately its own code (never
 * classroom.classroomJoinCode) and its own member role, never full
 * co-teacher access. Owner-only, same gate as Co-Teacher above — this
 * is exactly as high-stakes a grant (a new person gains standing
 * membership on this classroom), just a narrower one.
 *
 * This is the concrete answer to "how does a Program Manager actually
 * get authorized against a specific classroom": the classroom's own
 * OWNER decides to share this code with them; redeeming it (the same
 * "Join a Classroom" flow a co-teacher already uses) adds them as a
 * real `members` entry with role `program_manager` — see
 * services/workspaceService.js's joinClassroomByCode(), which resolves
 * the role from this code's own mapping, never from anything the
 * joining user chooses.
 */
function createInviteProgramManagerTile(classroom, currentUser, rerender) {
  const card = document.createElement('div');
  card.className = 'classroom-access-bento__tile classroom-access-bento__tile--medium';

  const isOwner = currentUser && memberService.isOwner(classroom, currentUser.uid);
  if (!isOwner) return card;

  const iconBadge = document.createElement('div');
  iconBadge.className = 'classroom-access-bento__icon-badge classroom-access-bento__icon-badge--program-manager';
  iconBadge.appendChild(createIcon('clipboard-list', { size: 20 }));
  card.appendChild(iconBadge);

  const heading = document.createElement('h2');
  heading.className = 'classroom-access-bento__heading';
  heading.textContent = 'Invite a Program Manager';
  card.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'classroom-access-bento__description';
  description.textContent = 'Review my Weekly Plans — access to review submitted lesson plans and leave feedback. No access to students, scores, or settings.';
  card.appendChild(description);

  if (!classroom.programManagerJoinCode) {
    const generateButton = document.createElement('button');
    generateButton.type = 'button';
    generateButton.className = 'btn btn--primary';
    generateButton.textContent = 'Generate Program Manager Code';
    generateButton.addEventListener('click', () => {
      ensureProgramManagerJoinCode(classroom);
      workspaceService.save(classroom);
      workspaceService.createJoinCodeMapping(classroom.programManagerJoinCode, classroom.id, MEMBER_ROLES.PROGRAM_MANAGER);
      rerender();
    });
    card.appendChild(generateButton);
    return card;
  }

  const codeDisplay = document.createElement('div');
  codeDisplay.className = 'invite-students-card__code';
  codeDisplay.textContent = classroom.programManagerJoinCode;
  card.appendChild(codeDisplay);

  const message = buildProgramManagerInvitationMessage({ classroomName: getDisplayName(classroom), code: classroom.programManagerJoinCode });
  card.appendChild(createInvitationActions({ message, shareLabel: 'Share with Program Manager' }));

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn--ghost';
  copyButton.textContent = 'Copy Code';
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(classroom.programManagerJoinCode);
      copyButton.textContent = 'Copied!';
      setTimeout(() => { copyButton.textContent = 'Copy Code'; }, 1500);
    } catch (error) {
      console.error('[StudentAccessView] Failed to copy program manager join code:', error);
      window.alert(`Classroom ID: ${classroom.programManagerJoinCode}`);
    }
  });
  card.appendChild(copyButton);

  return card;
}

/**
 * Visitor Access — presented to both the teacher and the invitee as a
 * "Classroom Tour" (see ui/views/VisitorAccessView.js's own header
 * comment), never as a permissions feature — but underneath, exactly
 * the same Visitor Access this project has always called it: NOT a
 * classroom member, NOT interchangeable with the co-teacher code above
 * (see services/visitorAccessService.js's own header comment for the
 * full architecture reasoning — this reads a sanitized, structure-only
 * snapshot, never the real classroom document). Any current member
 * (not owner-only, unlike Co-Teacher above) may create or revoke it —
 * lower stakes than granting full teacher access, matching the same
 * "any member" gate the Student code and Device Security PIN already
 * use, not the stricter owner-only gate reserved for handing out full
 * access.
 */
function createVisitorAccessTile(classroom, currentUser, rerender) {
  const card = document.createElement('div');
  card.className = 'classroom-access-bento__tile classroom-access-bento__tile--medium';

  const iconBadge = document.createElement('div');
  iconBadge.className = 'classroom-access-bento__icon-badge classroom-access-bento__icon-badge--visitor';
  iconBadge.appendChild(createIcon('eye', { size: 20 }));
  card.appendChild(iconBadge);

  const heading = document.createElement('h2');
  heading.className = 'classroom-access-bento__heading';
  heading.textContent = 'Show to a Visitor';
  card.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'classroom-access-bento__description';
  description.textContent = 'Explore my classroom — invite another teacher on a guided tour of how your classroom works.';
  card.appendChild(description);

  if (!classroom.visitorAccessCode) {
    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'btn btn--primary';
    createButton.textContent = 'Create Classroom Tour';
    createButton.addEventListener('click', () => {
      classroomService.ensureVisitorAccessCode(classroom);
      workspaceService.save(classroom);
      const snapshot = visitorAccessService.buildVisitorSnapshot(classroom);
      workspaceService.createVisitorAccess(classroom.visitorAccessCode, classroom.id, snapshot);
      rerender();
    });
    card.appendChild(createButton);
    return card;
  }

  const code = classroom.visitorAccessCode;
  const link = `${APP_BASE_URL}#/visitor/${code}`;

  const codeDisplay = document.createElement('div');
  codeDisplay.className = 'invite-students-card__code';
  codeDisplay.textContent = code;
  card.appendChild(codeDisplay);

  const message = buildVisitorInvitationMessage({ classroomName: getDisplayName(classroom), code, link });
  card.appendChild(createInvitationActions({ message, shareLabel: 'Share Classroom Tour' }));

  const revokeButton = document.createElement('button');
  revokeButton.type = 'button';
  revokeButton.className = 'btn btn--text btn--danger-text';
  revokeButton.textContent = 'Stop sharing';
  revokeButton.addEventListener('click', async () => {
    const confirmed = window.confirm('Stop sharing this classroom tour? Anyone who still has the link will no longer be able to open it.');
    if (!confirmed) return;
    try {
      await workspaceService.revokeVisitorAccess(code);
      classroomService.revokeVisitorAccessCode(classroom);
      workspaceService.save(classroom);
      rerender();
    } catch (error) {
      console.error('[StudentAccessView] Failed to revoke Visitor Access:', error);
      window.alert("Couldn't revoke this visitor link. Check your connection and try again.");
    }
  });
  card.appendChild(revokeButton);

  return card;
}

/**
 * The Device Reset PIN — gates adding or removing a student profile
 * on a device that already trusts at least one student (see
 * services/studentDeviceService.js's trusted-device model). A teacher
 * reads this aloud when, say, a second sibling wants to add their own
 * profile onto a family phone that already has one approved. Switching
 * between profiles already approved on a device never needs this.
 *
 * Deliberately demoted to a small, quiet section BELOW the three
 * invitation tiles now (per this redesign's own product direction) —
 * unchanged behavior, only its visual weight changed.
 */
function createDeviceSecurityCard(classroom, rerender) {
  const card = document.createElement('div');
  card.className = 'settings-section device-security-card';

  const heading = document.createElement('h2');
  heading.className = 'settings-page-heading';
  heading.textContent = 'Device Security';
  card.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'settings-section__meta';
  description.textContent =
    "A device remembers up to 3 approved students (handy for siblings sharing a phone). Switching between them is free — but adding or removing a student on a device that's already claimed needs this PIN, so students can't casually add or remove each other.";
  card.appendChild(description);

  if (!classroom.deviceResetPin) {
    // Same reasoning as the invite code above: generated only in
    // direct response to this click, never as a side effect of
    // rendering this page.
    const generateButton = document.createElement('button');
    generateButton.type = 'button';
    generateButton.className = 'btn btn--primary';
    generateButton.textContent = 'Generate Device Reset PIN';
    generateButton.addEventListener('click', () => {
      classroomService.ensureDeviceResetPin(classroom);
      workspaceService.save(classroom);
      rerender();
    });
    card.appendChild(generateButton);
    return card;
  }

  const pinDisplay = document.createElement('div');
  pinDisplay.className = 'invite-students-card__code';
  pinDisplay.textContent = classroom.deviceResetPin;
  card.appendChild(pinDisplay);

  const regenerateButton = document.createElement('button');
  regenerateButton.type = 'button';
  regenerateButton.className = 'btn btn--ghost';
  regenerateButton.textContent = 'Generate New PIN';
  regenerateButton.addEventListener('click', () => {
    const confirmed = window.confirm(
      'Generate a new PIN? Any device that hasn’t used the current PIN yet will need the new one instead.'
    );
    if (!confirmed) return;
    classroomService.regenerateDeviceResetPin(classroom);
    workspaceService.save(classroom);
    rerender();
  });
  card.appendChild(regenerateButton);

  return card;
}

/**
 * Informational only — no actions, no urgency styling. "Not joined
 * yet" is a completely normal, expected state here, not a bottleneck;
 * there is nothing for the teacher to individually do about it, since
 * there's no per-student credential to generate or send anymore.
 */
function createJoinedStatusList(allStudents, onSelectStudent) {
  const list = document.createElement('div');
  list.className = 'student-access-list';

  allStudents.forEach((student) => {
    const row = document.createElement('div');
    row.className = 'student-access-row';

    let nameEl;
    if (onSelectStudent) {
      nameEl = document.createElement('button');
      nameEl.type = 'button';
      nameEl.className = 'student-access-row__name student-name-link';
      nameEl.addEventListener('click', () => onSelectStudent(student.id));
    } else {
      nameEl = document.createElement('p');
      nameEl.className = 'student-access-row__name';
    }
    nameEl.textContent = student.name;
    row.appendChild(nameEl);

    const statusEl = document.createElement('p');
    statusEl.className = 'student-access-row__status' + (student.hasJoinedPortal ? ' student-access-row__status--linked' : '');
    statusEl.textContent = student.hasJoinedPortal ? '✅ Joined' : '⏳ Not Joined Yet';
    row.appendChild(statusEl);

    list.appendChild(row);
  });

  return list;
}
