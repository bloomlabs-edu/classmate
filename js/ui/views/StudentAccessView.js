/**
 * ui/views/StudentAccessView.js
 *
 * Rebuilt around the new classroom-code student join flow — one code,
 * shared once, instead of a PIN generated per student. See this
 * project's CHANGELOG for the architecture discussion this
 * implements (students JOIN via a shared code; the earlier per-
 * student PIN/invitation-link machinery still exists in the codebase,
 * unused by this page now, backing a secondary parent-connection path
 * that this phase deliberately left alone).
 *
 * The status list below the code is informational only, not a
 * bottleneck to clear — a student can be fully using the Portal with
 * "Not Joined Yet" showing for a slow-to-open classmate, and that's a
 * completely normal state, not a gap the teacher needs to act on.
 */

import * as classroomService from '../../services/classroomService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { showToast } from '../components/Toast.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { getDisplayName } from '../../services/classroomService.js';
import { APP_BASE_URL } from '../../config/appConfig.js';
import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';

export function renderStudentAccessView(container, { classroom, onBack, onSelectStudent }) {
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
  title.textContent = 'Student Access';
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = getDisplayName(classroom);
  titleBlock.append(title, subtitle);

  header.append(backButton, titleBlock);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  content.appendChild(
    createInviteStudentsCard(classroom, () => renderStudentAccessView(container, { classroom, onBack, onSelectStudent }))
  );
  content.appendChild(
    createDeviceSecurityCard(classroom, () => renderStudentAccessView(container, { classroom, onBack, onSelectStudent }))
  );

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
 * The one thing this page leads with now — a single code/link/QR the
 * teacher shares once (board, WhatsApp, projected), replacing forty
 * individual PIN-generation actions with one.
 */
function createInviteStudentsCard(classroom, rerender) {
  const card = document.createElement('div');
  card.className = 'settings-section invite-students-card';

  const heading = document.createElement('h2');
  heading.className = 'settings-page-heading';
  heading.textContent = 'Invite Students';
  heading.style.marginTop = '0';
  heading.style.paddingTop = '0';
  heading.style.borderTop = 'none';
  card.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'settings-section__meta';
  description.textContent = 'Share this once — on the board, over WhatsApp, or by projecting the QR code. No individual invitations needed.';
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
    const shareText = `\ud83c\udf89 You've been invited to join our classroom on ClassMate!\n\nOpen the Student Portal using the link below.\n\nClassroom Code:\n${code}\n\nStudent Portal:\n${link}`;
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
 * The Device Reset PIN — gates adding or removing a student profile
 * on a device that already trusts at least one student (see
 * services/studentDeviceService.js's trusted-device model). A teacher
 * reads this aloud when, say, a second sibling wants to add their own
 * profile onto a family phone that already has one approved. Switching
 * between profiles already approved on a device never needs this.
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
    "A device remembers up to 3 approved students (handy for siblings sharing a phone). Switching between them is free \u2014 but adding or removing a student on a device that's already claimed needs this PIN, so students can't casually add or remove each other.";
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
      'Generate a new PIN? Any device that hasn\u2019t used the current PIN yet will need the new one instead.'
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
    statusEl.textContent = student.hasJoinedPortal ? '\u2705 Joined' : '\u23f3 Not Joined Yet';
    row.appendChild(statusEl);

    list.appendChild(row);
  });

  return list;
}
