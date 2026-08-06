/**
 * ui/components/StudentNameElement.js
 *
 * The canonical way a student's identity renders anywhere in this
 * app — name (primary), team (secondary), and consistent click
 * behavior, with a configurable leading identity marker. Introduced
 * per explicit product decision while building the WorkRequest
 * feature, but not scoped to it: every student row throughout the
 * platform should eventually migrate to this, replacing the ad-hoc
 * rendering currently duplicated across NotebookTimeline.js,
 * LeaderboardList.js, WeeklySnapshotWidget.js, RecognitionCard.js,
 * ActivitiesView.js, and StudentAccessView.js — all of which already
 * share the `.student-name-link` click-behavior class, but each
 * render the visual identity itself differently, or not at all.
 *
 * Visual hierarchy is deliberate: the name is the primary element
 * (bold, full opacity); the team is secondary (smaller, muted) — this
 * directly fixes the "Siddharth · Alpha, equal weight" problem found
 * in the old NotebookRoster.js's own single, undifferentiated string.
 *
 * `leadingMarker` picks what leads the row, since different contexts
 * genuinely need different information there, not one universal
 * choice:
 *   'avatar' (default) — identity is the primary focus: profile
 *     pages, cards, tiles.
 *   'swatch' — a small, bucket-colored square. Faster to scan than
 *     repeated avatars in a dense list where bucket is the relevant
 *     signal.
 *   'group' — a small, colored badge showing this student's own team
 *     (reusing config/groupColorConfig.js's own team colors — the
 *     exact color a team's own header already uses). For contexts
 *     where a teacher is working through students by group (the
 *     WorkRequest roster), group is the more useful glance-signal
 *     than bucket, which can instead drive the row's own background
 *     tint (see ui/views/WorkRequestRosterView.js) rather than
 *     needing its own marker here too.
 *   'none' — no leading marker at all.
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
import { getGroupColorHex } from '../../config/groupColorConfig.js';

export function createStudentNameElement({ student, team, onSelect, size = 40, leadingMarker = 'avatar' } = {}) {
  const element = document.createElement(onSelect ? 'button' : 'div');
  element.className = 'student-name-element';
  if (onSelect) {
    element.type = 'button';
    element.classList.add('student-name-element--clickable');
    element.addEventListener('click', () => onSelect(student));
  }

  if (leadingMarker === 'avatar') {
    const bucketStyle = getBucketRowStyle(student.bucket);
    const avatarWrapper = document.createElement('span');
    avatarWrapper.className = 'student-name-element__avatar';
    avatarWrapper.style.borderColor = bucketStyle.border;
    avatarWrapper.appendChild(createAvatarElement({ studentId: student.id, name: student.name, size, useDefaultIfMissing: true }));
    element.appendChild(avatarWrapper);
  } else if (leadingMarker === 'swatch') {
    const bucketStyle = getBucketRowStyle(student.bucket);
    const swatch = document.createElement('span');
    swatch.className = 'student-name-element__swatch';
    swatch.style.backgroundColor = bucketStyle.border;
    swatch.setAttribute('aria-hidden', 'true');
    element.appendChild(swatch);
  } else if (leadingMarker === 'group' && team) {
    const badge = document.createElement('span');
    badge.className = 'student-name-element__group-badge';
    badge.style.backgroundColor = team.color ? getGroupColorHex(team.color) : 'var(--color-muted)';
    badge.textContent = team.name.charAt(0).toUpperCase();
    badge.setAttribute('aria-hidden', 'true');
    element.appendChild(badge);
  }

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
