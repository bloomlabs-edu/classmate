/**
 * ui/student-portal/views/StudentProfileView.js
 *
 * A lightweight settings page: avatar, name, classroom, group, role,
 * plus "Customize Avatar" and "Manage Students" actions.
 *
 * The avatar shown here is always the illustrated 2D avatar (custom
 * or default) — never initials — since this is the student's own
 * profile; see ui/components/AvatarDisplay.js's `useDefaultIfMissing`
 * for why "self" always gets a real avatar rather than a fallback.
 * Phase 1: the avatar config itself lives in this device's
 * localStorage only (see services/avatarConfigService.js) — no photo
 * upload anywhere, not a missing feature, a deliberate decision (see
 * this project's CHANGELOG).
 *
 * Live Firestore data for name/classroom/group/role — see
 * services/studentPortalDataService.js.
 */

import { getCurrentStudentProfile } from '../../../services/studentPortalDataService.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';

export async function renderStudentProfileView(container, { onManageStudents, onCustomizeAvatar }) {
  container.innerHTML = '';

  const profile = await getCurrentStudentProfile();

  const wrapper = document.createElement('div');
  wrapper.className = 'student-profile';

  if (!profile) {
    const notice = document.createElement('p');
    notice.className = 'student-home__empty-notice';
    notice.textContent = "We couldn't load your profile right now. Try rejoining your classroom.";
    wrapper.appendChild(notice);
    container.appendChild(wrapper);
    return;
  }

  wrapper.appendChild(
    createAvatarElement({
      studentId: profile.studentId,
      name: profile.name,
      size: 96,
      useDefaultIfMissing: true,
      className: 'student-profile__avatar',
    })
  );

  if (onCustomizeAvatar) {
    const customizeButton = document.createElement('button');
    customizeButton.type = 'button';
    customizeButton.className = 'btn btn--text student-profile__customize-avatar';
    customizeButton.textContent = 'Customize Avatar';
    customizeButton.addEventListener('click', () => onCustomizeAvatar(profile.studentId));
    wrapper.appendChild(customizeButton);
  }

  const name = document.createElement('h1');
  name.className = 'student-profile__name';
  name.textContent = profile.name;
  wrapper.appendChild(name);

  const details = document.createElement('dl');
  details.className = 'student-profile__details';
  details.append(
    createDetailRow('Classroom', profile.classroomName),
    createDetailRow('Group', profile.groupName || 'Not assigned yet'),
    createDetailRow('Role', profile.role)
  );
  wrapper.appendChild(details);

  if (onManageStudents) {
    const manageStudentsButton = document.createElement('button');
    manageStudentsButton.type = 'button';
    manageStudentsButton.className = 'btn btn--ghost student-profile__join-another';
    manageStudentsButton.textContent = 'Manage Students';
    manageStudentsButton.addEventListener('click', onManageStudents);
    wrapper.appendChild(manageStudentsButton);
  }

  container.appendChild(wrapper);
}

function createDetailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'student-profile__detail-row';

  const dt = document.createElement('dt');
  dt.className = 'student-profile__detail-label';
  dt.textContent = label;

  const dd = document.createElement('dd');
  dd.className = 'student-profile__detail-value';
  dd.textContent = value;

  row.append(dt, dd);
  return row;
}
