/**
 * ui/student-portal/views/StudentProfileView.js
 *
 * A lightweight settings page: avatar, name, classroom, group, role,
 * Learning Bucket, plus "Customize Avatar" and "Manage Students"
 * actions.
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
 * Live Firestore data for name/classroom/group/role/bucket — see
 * services/studentPortalDataService.js.
 *
 * The Learning Bucket chip reuses config/bucketConfig.js entirely —
 * the exact same colors, labels, and getBucketRowStyle()/
 * getBucketLabel() the teacher-facing Student Profile
 * (ui/views/StudentProfileView.js) already uses, so a bucket change a
 * teacher makes (e.g. Red -> Yellow) shows up here in the same color
 * the teacher themselves sees, the next time this student opens their
 * own Profile — no separate color logic to keep in sync.
 */

import { getCurrentStudentProfile } from '../../../services/studentPortalDataService.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { getBucketRowStyle, getBucketLabel } from '../../../config/bucketConfig.js';
import { getEventCopyForViewer } from '../../../services/studentEventService.js';
import { formatDate } from '../../../utils/dateHelpers.js';

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

  const header = document.createElement('div');
  header.className = 'student-profile__header';

  const topRow = document.createElement('div');
  topRow.className = 'profile-header__top-row';

  const topRowSpacer = document.createElement('span');
  topRow.appendChild(topRowSpacer);

  if (onManageStudents) {
    const manageStudentsButton = document.createElement('button');
    manageStudentsButton.type = 'button';
    manageStudentsButton.className = 'btn btn--ghost student-profile__join-another';
    manageStudentsButton.textContent = 'Manage Students';
    manageStudentsButton.addEventListener('click', onManageStudents);
    topRow.appendChild(manageStudentsButton);
  }
  header.appendChild(topRow);

  const identityRow = document.createElement('div');
  identityRow.className = 'student-profile__identity-row';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'student-profile__avatar-wrap';
  avatarWrap.appendChild(
    createAvatarElement({
      studentId: profile.studentId,
      name: profile.name,
      size: 72,
      useDefaultIfMissing: true,
      className: 'student-profile__avatar',
    })
  );

  if (onCustomizeAvatar) {
    const customizeButton = document.createElement('button');
    customizeButton.type = 'button';
    customizeButton.className = 'student-profile__customize-avatar';
    customizeButton.setAttribute('aria-label', 'Customize Avatar');
    customizeButton.title = 'Customize Avatar';
    customizeButton.textContent = '\u270e';
    customizeButton.addEventListener('click', () => onCustomizeAvatar(profile.studentId));
    avatarWrap.appendChild(customizeButton);
  }
  identityRow.appendChild(avatarWrap);

  const titleBlock = document.createElement('div');
  titleBlock.className = 'student-profile__title-block';

  const name = document.createElement('h1');
  name.className = 'student-profile__name';
  name.textContent = profile.name;
  titleBlock.appendChild(name);

  if (profile.groupName) {
    const team = document.createElement('p');
    team.className = 'student-profile__team';
    team.textContent = profile.groupName;
    titleBlock.appendChild(team);
  }
  identityRow.appendChild(titleBlock);

  header.appendChild(identityRow);

  const bucketStyle = getBucketRowStyle(profile.bucket);
  const bucketChip = document.createElement('div');
  bucketChip.className = 'student-profile__bucket-chip';
  bucketChip.style.backgroundColor = bucketStyle.background;
  bucketChip.style.borderColor = bucketStyle.border;
  bucketChip.style.color = bucketStyle.text;
  bucketChip.textContent = `Learning Bucket: ${getBucketLabel(profile.bucket)}`;
  header.appendChild(bucketChip);

  // The four Journey metrics, as one horizontal chip row inside the
  // SAME header block — reusing profile-header__chip verbatim, the
  // exact class the Teacher Portal's own header already uses for its
  // own metrics. Same visual component, different role-appropriate
  // data, not a separately-designed metrics card underneath.
  const stats = document.createElement('div');
  stats.className = 'profile-header__stats';
  [
    ['Total Stars', profile.totalStars],
    ['Badges Earned', profile.badgeCount],
    ['Current Streak', profile.currentStreak],
    ['Biggest Climb', profile.biggestClimb],
  ].forEach(([label, value]) => {
    const chip = document.createElement('div');
    chip.className = 'profile-header__chip';
    const labelEl = document.createElement('span');
    labelEl.className = 'profile-header__chip-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'profile-header__chip-value';
    valueEl.textContent = String(value);
    chip.append(labelEl, valueEl);
    stats.appendChild(chip);
  });
  header.appendChild(stats);

  wrapper.appendChild(header);

  wrapper.appendChild(createRecentRecognitionSection(profile));

  container.appendChild(wrapper);
}

function createRecentRecognitionSection(profile) {
  const section = document.createElement('div');
  section.className = 'recent-recognition-section';

  const heading = document.createElement('h2');
  heading.className = 'recent-recognition-section__heading';
  heading.textContent = 'Recent Recognition';
  section.appendChild(heading);

  const events = profile.recentEvents || [];

  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'recent-recognition-section__empty';
    empty.textContent = 'No recognition yet.';
    section.appendChild(empty);
    return section;
  }

  events.forEach((event) => {
    const copy = getEventCopyForViewer(event, 'self');

    const card = document.createElement('div');
    card.className = 'recognition-moment-card';

    const title = document.createElement('p');
    title.className = 'recognition-moment-card__title';
    title.textContent = copy.title;
    card.appendChild(title);

    if (copy.message) {
      const message = document.createElement('p');
      message.className = 'recognition-moment-card__message';
      message.textContent = copy.message;
      card.appendChild(message);
    }

    const date = document.createElement('p');
    date.className = 'recognition-moment-card__date';
    date.textContent = formatDate(event.createdAt);
    card.appendChild(date);

    section.appendChild(card);
  });

  return section;
}
