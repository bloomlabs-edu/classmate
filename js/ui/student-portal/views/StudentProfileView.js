/**
 * ui/student-portal/views/StudentProfileView.js
 *
 * Shows the generated avatar (initials + deterministic color — see
 * utils/avatarGenerator.js), name, classroom, group, and role, plus a
 * "Switch Student" action, for a parent linked to more than one child
 * entry screen. No photo upload anywhere:
 * not a missing feature, a deliberate decision (see this project's
 * CHANGELOG). getAvatarForPerson() already branches on a `type` field
 * specifically so that adding real photo support later is a change to
 * that one function, not to this view.
 *
 * Live Firestore data — see services/studentPortalDataService.js.
 */

import { getCurrentStudentProfile } from '../../../services/studentPortalDataService.js';
import { getAvatarForPerson } from '../../../utils/avatarGenerator.js';

export async function renderStudentProfileView(container, { onSwitchStudent }) {
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

  const avatar = getAvatarForPerson(profile);

  const avatarEl = document.createElement('div');
  avatarEl.className = 'student-profile__avatar';
  if (avatar.type === 'generated') {
    avatarEl.style.backgroundColor = avatar.color;
    avatarEl.textContent = avatar.initials;
  }
  // A future avatar.type === 'photo' branch would set avatarEl's
  // background to an <img> instead — not implemented, since photo
  // support isn't built (see this file's own module comment).
  wrapper.appendChild(avatarEl);

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

  if (onSwitchStudent) {
    const joinAnotherButton = document.createElement('button');
    joinAnotherButton.type = 'button';
    joinAnotherButton.className = 'btn btn--ghost student-profile__join-another';
    joinAnotherButton.textContent = 'Switch Student';
    joinAnotherButton.addEventListener('click', onSwitchStudent);
    wrapper.appendChild(joinAnotherButton);
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
