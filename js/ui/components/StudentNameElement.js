/**
 * ui/components/StudentNameElement.js
 *
 * The canonical way a student's identity renders anywhere in this
 * app — avatar, bucket color, name (primary), team (secondary), and
 * consistent click behavior. Introduced per explicit product
 * decision while building the WorkRequest feature, but not scoped to
 * it: every student row throughout the platform should eventually
 * migrate to this, replacing the ad-hoc rendering currently
 * duplicated across NotebookRoster.js, NotebookTimeline.js,
 * LeaderboardList.js, WeeklySnapshotWidget.js, RecognitionCard.js,
 * ActivitiesView.js, and StudentAccessView.js — all of which already
 * share the `.student-name-link` click-behavior class, but each
 * render the visual identity itself differently, or not at all.
 *
 * Visual hierarchy is deliberate: the name is the primary element
 * (bold, full opacity); the team is secondary (smaller, muted) — this
 * directly fixes the "Siddharth · Alpha, equal weight" problem found
 * in NotebookRoster.js's own single, undifferentiated string.
 *
 * Bucket color is always shown — a small colored ring around the
 * avatar, reusing config/bucketConfig.js's getBucketRowStyle()
 * directly, the same color every other bucket display in this app
 * already uses. Per explicit product decision, buckets are visible
 * classroom-wide already, so this is never hidden.
 *
 * `onSelect`, when provided, makes the whole element a real button
 * (matching this app's own "optional callback, plain element when
 * absent" convention already established for
 * ui/components/TeamStandingsBoard.js's own onTapTeam). Deliberately
 * takes the callback itself, not an opinion about where it navigates
 * — a teacher-side caller opens the private profile
 * (ui/views/StudentProfileView.js); a Student Portal caller opens the
 * public one (ui/student-portal/views/StudentPublicProfileView.js).
 * This component has no opinion about which.
 */

import { createAvatarElement } from './AvatarDisplay.js';
import { getBucketRowStyle } from '../../config/bucketConfig.js';

export function createStudentNameElement({ student, team, onSelect, size = 40 } = {}) {
  const element = document.createElement(onSelect ? 'button' : 'div');
  element.className = 'student-name-element';
  if (onSelect) {
    element.type = 'button';
    element.classList.add('student-name-element--clickable');
    element.addEventListener('click', () => onSelect(student));
  }

  const bucketStyle = getBucketRowStyle(student.bucket);
  const avatarWrapper = document.createElement('span');
  avatarWrapper.className = 'student-name-element__avatar';
  avatarWrapper.style.borderColor = bucketStyle.border;
  avatarWrapper.appendChild(createAvatarElement({ studentId: student.id, name: student.name, size, useDefaultIfMissing: true }));
  element.appendChild(avatarWrapper);

  const textBlock = document.createElement('span');
  textBlock.className = 'student-name-element__text';

  const name = document.createElement('span');
  name.className = 'student-name-element__name';
  name.textContent = student.name;
  textBlock.appendChild(name);

  if (team) {
    const teamLabel = document.createElement('span');
    teamLabel.className = 'student-name-element__team';
    teamLabel.textContent = team.name;
    textBlock.appendChild(teamLabel);
  }

  element.appendChild(textBlock);
  return element;
}
