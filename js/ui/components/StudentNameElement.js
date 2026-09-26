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
 * `tintNameWithBucket` (default false) — when true, the student's own
 * name text uses config/bucketConfig.js's own `nameColor` (dark,
 * desaturated shades — dark green/amber/maroon), harmonizing with a
 * row that's already bucket-themed as a whole (see
 * ui/views/WorkRequestRosterView.js). Deliberately opt-in, not the
 * default: this component is reused in contexts (leaderboards, event
 * cards) where the surrounding row isn't bucket-tinted at all, and a
 * silent global name-color change there wasn't asked for.
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
 *
 * `performanceBucketKey` — the architectural seam between this
 * component's two genuinely different bucket signals. Left unset
 * (the default), `'avatar'`/`'swatch'` colour from `student.bucket`
 * — the teacher-assigned, classroom-wide Learning Bucket
 * (config/bucketConfig.js) — exactly as before; every existing call
 * site (Notebooks, Dashboard, Reports, leaderboards, ...) keeps that
 * meaning unchanged. A caller in an assessment-PERFORMANCE context
 * (Scorecard, Assessment Gradebook) instead passes this explicitly —
 * `'red' | 'yellow' | 'green' | null`, i.e. exactly what
 * config/assessmentMarksColorConfig.js's own getMarksBucketKey()
 * already returns, `null` meaning "no mark recorded yet", which must
 * render as neutral/"Not Assessed", never as Red (see that file's own
 * header comment — this is the one bug this component must not
 * reintroduce). Passing `null` explicitly is therefore NOT the same
 * as leaving the option unset: unset reads `student.bucket`; `null`
 * means "this student has a resolved performance state and it is
 * Not Assessed." Two independent concepts, deliberately never merged
 * into one bucket key.
 */

import { createAvatarElement } from './AvatarDisplay.js';
import { getBucketRowStyle, getBucketLabel } from '../../config/bucketConfig.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';
import { getPerformanceBucketLabel } from '../../config/assessmentMarksColorConfig.js';

export function createStudentNameElement({ student, team, onSelect, size = 40, leadingMarker = 'avatar', tintNameWithBucket = false, performanceBucketKey } = {}) {
  const usingPerformanceBucket = performanceBucketKey !== undefined;
  const resolvedBucketKey = usingPerformanceBucket ? performanceBucketKey : student.bucket;
  const bucketStyle = getBucketRowStyle(resolvedBucketKey);
  const bucketAccessibleLabel = usingPerformanceBucket ? getPerformanceBucketLabel(resolvedBucketKey) : getBucketLabel(resolvedBucketKey);

  const element = document.createElement(onSelect ? 'button' : 'div');
  element.className = 'student-name-element';
  if (onSelect) {
    element.type = 'button';
    element.classList.add('student-name-element--clickable');
    element.addEventListener('click', () => onSelect(student));
  }

  if (leadingMarker === 'avatar') {
    const avatarWrapper = document.createElement('span');
    avatarWrapper.className = 'student-name-element__avatar';
    avatarWrapper.style.borderColor = bucketStyle.border;
    avatarWrapper.appendChild(createAvatarElement({ studentId: student.id, name: student.name, size, useDefaultIfMissing: true }));
    element.appendChild(avatarWrapper);
  } else if (leadingMarker === 'swatch') {
    const swatch = document.createElement('span');
    swatch.className = 'student-name-element__swatch';
    swatch.style.backgroundColor = bucketStyle.border;
    // Colour is never the only channel communicating state — see this
    // file's own performanceBucketKey header comment — so the swatch
    // carries its bucket meaning as a real accessible name/tooltip
    // (role="img", not aria-hidden) rather than a purely decorative dot.
    swatch.setAttribute('role', 'img');
    swatch.setAttribute('aria-label', bucketAccessibleLabel);
    swatch.title = bucketAccessibleLabel;
    element.appendChild(swatch);
  } else if (leadingMarker === 'group' && team) {
    const badge = document.createElement('span');
    badge.className = 'student-name-element__group-badge';
    badge.style.backgroundColor = team.color ? getGroupColorHex(team.color) : 'var(--color-muted)';
    badge.textContent = abbreviateTeamName(team.name);
    badge.setAttribute('aria-hidden', 'true');
    element.appendChild(badge);
  }

  const textBlock = document.createElement('span');
  textBlock.className = 'student-name-element__text';

  const name = document.createElement('span');
  name.className = 'student-name-element__name';
  name.textContent = student.name;
  if (tintNameWithBucket) {
    name.style.color = bucketStyle.nameColor;
  }
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

/** A single, compact color-code letter for a team's own badge — deliberately just one letter, since the full team name already renders as its own line right below (see the `team` block above); a longer abbreviation would only duplicate what's already spelled out unambiguously one line down. */
function abbreviateTeamName(name) {
  return name.trim().slice(0, 1).toUpperCase();
}
