/**
 * ui/student-portal/views/StudentPublicProfileView.js
 *
 * The canonical Student Public Profile — Phase 1. Takes only
 * `studentId` and `onBack`, with no dependency on how it was reached
 * (Team Standings today; a future Community Feed, Recognition cards,
 * and future leaderboards will all open this exact same screen). All
 * data comes from studentPortalDataService.js's
 * getPublicProfileForStudent() — this view only decides how to
 * arrange what that function already computed, never recalculating
 * anything itself.
 *
 * Every section below reuses an existing service or component rather
 * than reimplementing it:
 *   - Header stats: teamStatisticsService.js (via the data function)
 *   - Badge grid: the exact .achievement-grid/.achievement-card
 *     markup ui/views/StudentProfileView.js's own Behaviour Badges
 *     section already uses
 *   - Recognition timeline: StudentJourneyView.js's own exported
 *     renderEventCard() — the identical card structure, not a rebuilt
 *     one, but called with `viewer: 'peer'` rather than the default
 *     'self': the events shown here happened to a CLASSMATE, not the
 *     person currently looking at this screen, so the copy inside
 *     each card must stay neutral ("Earned a star") rather than
 *     second-person ("You earned a star!") — confirmed by direct
 *     trace after this exact confusion showed up in production.
 *   - Bucket color: config/bucketConfig.js's getBucketRowStyle()/
 *     getBucketLabel(), same as every other bucket display in this app
 *   - Learning Hub / Assessments / Community: createEmptyStateElement(),
 *     no new placeholder component
 *
 * Never shows teacher-only information — no notes, no session-score
 * history, no bucket-change controls, nothing beyond what a classmate
 * is already allowed to see (this app's own bucket colors are already
 * visible classroom-wide, per explicit product decision, so bucket
 * stays here deliberately).
 */

import { getPublicProfileForStudent } from '../../../services/studentPortalDataService.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { getBucketRowStyle, getBucketLabel } from '../../../config/bucketConfig.js';
import { renderEventCard } from './StudentJourneyView.js';

export async function renderStudentPublicProfileView(container, { studentId, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-public-profile';
  wrapper.appendChild(createBackButton(onBack));

  const profile = await getPublicProfileForStudent(studentId);

  if (!profile) {
    wrapper.appendChild(createEmptyStateElement({ message: "This student's profile isn't available right now." }));
    container.appendChild(wrapper);
    return;
  }

  wrapper.appendChild(renderHeader(profile));
  wrapper.appendChild(renderRecognitionSection(profile));
  wrapper.appendChild(renderJourneySection(profile));
  wrapper.appendChild(renderPlaceholderSection('Learning Hub', 'Learning Hub progress will show up here once it\u2019s available.'));
  wrapper.appendChild(renderPlaceholderSection('Assessments', 'Assessment results aren\u2019t shown on public profiles yet.'));
  wrapper.appendChild(renderPlaceholderSection('Community', 'Community Feed posts will appear here in a future update.'));

  container.appendChild(wrapper);
}

function renderHeader(profile) {
  const header = document.createElement('div');
  header.className = 'student-public-profile__header';

  const bucketStyle = getBucketRowStyle(profile.bucket);
  header.style.backgroundColor = bucketStyle.background;
  header.style.color = bucketStyle.text;

  header.appendChild(createAvatarElement({ studentId: profile.studentId, name: profile.name, size: 72, useDefaultIfMissing: true }));

  const name = document.createElement('h1');
  name.className = 'student-public-profile__name';
  name.textContent = profile.name;
  header.appendChild(name);

  if (profile.teamName) {
    const team = document.createElement('p');
    team.className = 'student-public-profile__team';
    team.textContent = profile.teamName;
    header.appendChild(team);
  }

  const bucketChip = document.createElement('p');
  bucketChip.className = 'student-public-profile__bucket';
  bucketChip.textContent = `Learning Bucket: ${getBucketLabel(profile.bucket)}`;
  header.appendChild(bucketChip);

  const stats = document.createElement('div');
  stats.className = 'student-public-profile__stats';
  stats.append(
    createStatChip('Monthly Score', `${profile.monthlyScore} \u2b50`),
    createStatChip('Class Rank', profile.classRank ? `#${profile.classRank}` : '\u2014'),
    createStatChip('Team Rank', profile.teamRank ? `#${profile.teamRank}` : '\u2014')
  );
  header.appendChild(stats);

  return header;
}

function createStatChip(label, value) {
  const chip = document.createElement('div');
  chip.className = 'student-public-profile__stat-chip';
  const labelEl = document.createElement('span');
  labelEl.className = 'student-public-profile__stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'student-public-profile__stat-value';
  valueEl.textContent = value;
  chip.append(labelEl, valueEl);
  return chip;
}

function renderRecognitionSection(profile) {
  const section = document.createElement('div');
  section.className = 'student-public-profile__section';

  const heading = document.createElement('h2');
  heading.className = 'student-public-profile__section-heading';
  heading.textContent = 'Recognition';
  section.appendChild(heading);

  const badgeSummary = document.createElement('p');
  badgeSummary.className = 'student-public-profile__badge-summary';
  badgeSummary.textContent =
    profile.badgeCount > 0
      ? `${profile.badgeCount} badge${profile.badgeCount === 1 ? '' : 's'} earned \u2014 latest: ${profile.latestBadgeName}`
      : 'No badges earned yet.';
  section.appendChild(badgeSummary);

  if (profile.events.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'Nothing to show yet \u2014 check back after some recognition or activity.' }));
  } else {
    const timeline = document.createElement('div');
    timeline.className = 'student-public-profile__timeline';
    profile.events.forEach((event) => {
      // No navigation on a public profile's own timeline -- these
      // cards are read-only here, not a jumping-off point into
      // someone else's assessment results, etc.
      timeline.appendChild(renderEventCard(event, null, 'peer'));
    });
    section.appendChild(timeline);
  }

  return section;
}

function renderJourneySection(profile) {
  const section = document.createElement('div');
  section.className = 'student-public-profile__section';

  const heading = document.createElement('h2');
  heading.className = 'student-public-profile__section-heading';
  heading.textContent = 'Journey';
  section.appendChild(heading);

  const approvedGoals = profile.currentGoals.filter((goal) => goal.status === 'approved');

  if (approvedGoals.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No active goals to show right now.' }));
  } else {
    const list = document.createElement('div');
    list.className = 'student-public-profile__goals-list';
    approvedGoals.forEach((goal) => {
      const card = document.createElement('div');
      card.className = 'student-public-profile__goal-card';
      const category = document.createElement('p');
      category.className = 'student-public-profile__goal-category';
      category.textContent = goal.categoryName;
      const streak = document.createElement('p');
      streak.className = 'student-public-profile__goal-streak';
      streak.textContent = goal.currentStreak > 0 ? `\ud83d\udd25 ${goal.currentStreak} day streak` : `${goal.overallCompletionPercent}% complete this month`;
      card.append(category, streak);
      list.appendChild(card);
    });
    section.appendChild(list);
  }

  return section;
}

function renderPlaceholderSection(title, message) {
  const section = document.createElement('div');
  section.className = 'student-public-profile__section';

  const heading = document.createElement('h2');
  heading.className = 'student-public-profile__section-heading';
  heading.textContent = title;
  section.appendChild(heading);

  section.appendChild(createEmptyStateElement({ message }));
  return section;
}
