/**
 * ui/components/RecognitionWall.js
 *
 * Renders a closed Standing Cycle's own recognition record — "who was
 * recognised, for what, and (where relevant) on which team" — reused
 * by ui/views/ScoreboardArchiveView.js's own archive detail page. The
 * one, shared rendering path for this concept; nothing else in the app
 * builds a second version of it.
 *
 * Consumes services/achievementEngine.js's own groupEventsForRecognitionWall()
 * output directly — this file does no grouping/eligibility logic of
 * its own, only layout. It never assumes "Winning Team Member" is the
 * only badge that can appear: it renders whatever badge-type groups it
 * was given, in whatever order groupEventsForRecognitionWall() returned
 * them, so a future badge family shows up here automatically the
 * moment its own Achievement Events exist for this cycle — no redesign
 * needed.
 *
 * `resolveStudentName(studentId)` is supplied by the caller — see this
 * file's own header note on why name resolution isn't this component's
 * job: ScoreboardArchiveView.js resolves names from the ARCHIVE's own
 * frozen roster (point-in-time correct), never from the classroom's
 * current student list, which is exactly what keeps this historically
 * accurate for a student who has since changed teams or left entirely.
 */

import { createBadge } from './Badge.js';
import { createEmptyStateElement } from './EmptyState.js';
import { BADGE_THEMES, BADGE_SIZES } from '../../config/badgeDefinitions.js';

function createRecipientCard(recipient, resolveStudentName) {
  const card = document.createElement('div');
  card.className = 'recognition-wall__recipient';

  const name = document.createElement('span');
  name.className = 'recognition-wall__recipient-name';
  name.textContent = resolveStudentName(recipient.studentId);
  card.appendChild(name);

  const standing = document.createElement('span');
  standing.className = 'recognition-wall__recipient-standing';
  standing.textContent = recipient.standing >= 0 ? `+${recipient.standing}` : String(recipient.standing);
  card.appendChild(standing);

  return card;
}

function createBadgeGroupSection(group, resolveStudentName) {
  const section = document.createElement('div');
  section.className = 'recognition-wall__group';

  // Browser-feedback correction (2026-09-11, visual refinement round):
  // "the badge should look like a badge" — a hero card built around
  // config/badgeDefinitions.js's own "standard" (72-96px) recognition-card
  // size tier, not a small icon beside a text label. This card
  // identifies the badge TYPE being celebrated this cycle, so its
  // artwork is deliberately not tied to any one recipient's own
  // cumulative level (which recipient's level would it even show?) —
  // `showLevel: false` keeps it purely the recognition object itself.
  const heading = document.createElement('div');
  heading.className = 'recognition-wall__group-heading';
  heading.style.backgroundColor = BADGE_THEMES[group.definition.theme].light;
  heading.appendChild(createBadge({ family: group.definition.family, recognitionType: group.definition.recognitionType, level: 1, size: BADGE_SIZES.standard, showLevel: false }));
  const title = document.createElement('p');
  title.className = 'recognition-wall__group-title';
  title.textContent = group.definition.title;
  heading.appendChild(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'recognition-wall__group-subtitle';
  subtitle.textContent = 'Earned this cycle';
  heading.appendChild(subtitle);
  section.appendChild(heading);

  const recipientArea = document.createElement('div');
  recipientArea.className = 'recognition-wall__recipient-area';

  if (group.teamGroups) {
    // Team-based recognition (e.g. Winning Team Member) — every tied
    // winning team appears, each as its own column; no tiebreaker, no
    // "top team only" truncation.
    group.teamGroups.forEach((teamGroup) => {
      const teamColumn = document.createElement('div');
      teamColumn.className = 'recognition-wall__team-column';

      const teamName = document.createElement('p');
      teamName.className = 'recognition-wall__team-name';
      teamName.textContent = teamGroup.teamName || 'Team';
      teamColumn.appendChild(teamName);

      const recipientList = document.createElement('div');
      recipientList.className = 'recognition-wall__recipient-list';
      teamGroup.recipients.forEach((recipient) => recipientList.appendChild(createRecipientCard(recipient, resolveStudentName)));
      teamColumn.appendChild(recipientList);

      recipientArea.appendChild(teamColumn);
    });
  } else {
    // No team context on this badge's events — a flat recipient list.
    const recipientList = document.createElement('div');
    recipientList.className = 'recognition-wall__recipient-list';
    group.recipients.forEach((recipient) => recipientList.appendChild(createRecipientCard(recipient, resolveStudentName)));
    recipientArea.appendChild(recipientList);
  }

  section.appendChild(recipientArea);
  return section;
}

/**
 * `groups` — services/achievementEngine.js's groupEventsForRecognitionWall()
 * output, already filtered to one cycle's own events.
 * `resolveStudentName` — `(studentId) => string`, using the archive's
 * own frozen roster.
 */
export function createRecognitionWall({ groups, resolveStudentName }) {
  const wall = document.createElement('section');
  wall.className = 'recognition-wall';

  const heading = document.createElement('h2');
  heading.className = 'recognition-wall__heading';
  heading.textContent = '🏆 Recognition Wall';
  wall.appendChild(heading);

  if (groups.length === 0) {
    wall.appendChild(createEmptyStateElement({ message: 'No recognitions were awarded for this cycle.' }));
    return wall;
  }

  groups.forEach((group) => wall.appendChild(createBadgeGroupSection(group, resolveStudentName)));
  return wall;
}
