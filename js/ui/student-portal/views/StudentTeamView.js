/**
 * ui/student-portal/views/StudentTeamView.js
 *
 * "Team" — a student's own group, expanded to focus on collaboration
 * (see this project's CHANGELOG for the navigation-simplification
 * decision): team stars, this week's team rank, every member's
 * individual contribution within the team, and a team-vs-team
 * classroom leaderboard.
 *
 * Deliberately does NOT include an individual student leaderboard —
 * that was an explicit decision; the only ranking shown here is
 * team-vs-team, and within-team it's each member's own star
 * contribution, not a ranked "who's #1 on my team" list.
 *
 * All data comes from studentPortalDataService.js's getTeamSummary();
 * this view only decides what to show and how to phrase it.
 */

import { getTeamSummary } from '../../../services/studentPortalDataService.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentTeamView(container) {
  container.innerHTML = '';

  const team = await getTeamSummary();

  const wrapper = document.createElement('div');
  wrapper.className = 'student-team';

  if (!team) {
    // A real, reachable state — a student simply may not be assigned
    // to a group yet.
    const title = document.createElement('h1');
    title.className = 'student-section__title';
    title.textContent = 'My Team';
    wrapper.appendChild(title);
    wrapper.appendChild(createEmptyStateElement({ message: 'Not assigned to a group yet \u2014 ask your teacher.' }));
    container.appendChild(wrapper);
    return;
  }

  const title = document.createElement('h1');
  title.className = 'student-section__title';
  title.textContent = team.teamName;
  wrapper.appendChild(title);

  // Team stars + this week's rank, side by side — the two headline
  // numbers for "how is my team doing," answered immediately.
  const statsRow = document.createElement('div');
  statsRow.className = 'student-team__stats-row';
  statsRow.appendChild(createStatCard('\u2b50', String(team.teamStars), 'team stars this week'));
  statsRow.appendChild(
    createStatCard(
      '\ud83c\udfc6',
      team.teamRank ? `#${team.teamRank}` : '\u2014',
      team.teamRank === 1 ? 'Leading the class!' : 'classroom rank this week'
    )
  );
  wrapper.appendChild(statsRow);

  // Members, sorted by their own contribution — "individual
  // contributions within the team," not a competitive ranked list.
  const membersHeading = document.createElement('h2');
  membersHeading.className = 'student-journey__section-title';
  membersHeading.textContent = 'Team Members';
  wrapper.appendChild(membersHeading);

  const list = document.createElement('div');
  list.className = 'student-team__list';
  team.members.forEach((member) => {
    const row = document.createElement('div');
    row.className = 'student-team__row' + (member.isSelf ? ' student-team__row--self' : '');

    row.appendChild(createAvatarElement({ studentId: member.studentId, name: member.name, size: 36 }));

    const nameEl = document.createElement('span');
    nameEl.className = 'student-team__row-name';
    nameEl.textContent = member.isSelf ? `${member.name} (You)` : member.name;
    row.appendChild(nameEl);

    const starsEl = document.createElement('span');
    starsEl.className = 'student-team__row-stars';
    starsEl.textContent = `${member.stars} \u2b50`;
    row.appendChild(starsEl);

    list.appendChild(row);
  });
  wrapper.appendChild(list);

  // Team-vs-team classroom leaderboard — every real group this week,
  // ranked. Deliberately team-only; see this file's header comment.
  const leaderboardHeading = document.createElement('h2');
  leaderboardHeading.className = 'student-journey__section-title';
  leaderboardHeading.textContent = 'Classroom Leaderboard';
  wrapper.appendChild(leaderboardHeading);

  const leaderboardList = document.createElement('div');
  leaderboardList.className = 'student-team__leaderboard';
  team.classroomLeaderboard.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'student-team__leaderboard-row' + (entry.rank === 1 ? ' student-team__leaderboard-row--first' : '');
    if (entry.teamName === team.teamName) row.classList.add('student-team__leaderboard-row--mine');

    const rankEl = document.createElement('span');
    rankEl.className = 'student-team__leaderboard-rank';
    rankEl.textContent = `#${entry.rank}`;

    const nameEl = document.createElement('span');
    nameEl.className = 'student-team__leaderboard-name';
    nameEl.textContent = entry.teamName;

    const starsEl = document.createElement('span');
    starsEl.className = 'student-team__leaderboard-stars';
    starsEl.textContent = `${entry.stars} \u2b50`;

    row.append(rankEl, nameEl, starsEl);
    leaderboardList.appendChild(row);
  });
  wrapper.appendChild(leaderboardList);

  // Space for future team achievements — a single, honest "nothing
  // here yet" line rather than a fake module, matching this app's own
  // established rule about not building empty-looking placeholders.
  const futureNote = document.createElement('p');
  futureNote.className = 'student-team__future-note';
  futureNote.textContent = 'Team achievements are coming soon.';
  wrapper.appendChild(futureNote);

  container.appendChild(wrapper);
}

function createStatCard(icon, value, caption) {
  const card = document.createElement('div');
  card.className = 'student-team__stat-card';

  const iconEl = document.createElement('span');
  iconEl.className = 'student-home__card-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

  const valueEl = document.createElement('p');
  valueEl.className = 'student-home__card-value';
  valueEl.textContent = value;

  const captionEl = document.createElement('p');
  captionEl.className = 'student-home__card-caption';
  captionEl.textContent = caption;

  card.append(iconEl, valueEl, captionEl);
  return card;
}
