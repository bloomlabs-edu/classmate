/**
 * ui/views/TeamProfileView.js
 *
 * The Team Profile — "what have we achieved together," the collective
 * counterpart to ui/views/StudentProfileView.js's "what have I
 * achieved." Reached from Classroom Management's own group card ("View
 * Profile"), never a second place to rename/add/remove a team — that
 * stays exactly where it already is (ui/views/ClassroomManagementView.js).
 *
 * Deliberately not another leaderboard: current standing/points/rank
 * come from the exact same live services/teamStatisticsService.js this
 * app already uses everywhere else (no parallel scoring), and the
 * achievement history comes from services/achievementService.js's
 * getTeamAchievementHistory() — a team's own Winning Team Member win
 * count/streak/best score, never an individual student's badge level
 * (a team can win a cycle even when a member was individually
 * ineligible that cycle; see that function's own header comment for
 * why the two are computed differently on purpose).
 */

import * as teamStatisticsService from '../../services/teamStatisticsService.js';
import * as scoreboardArchiveService from '../../services/scoreboardArchiveService.js';
import * as achievementService from '../../services/achievementService.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts[0][0].toUpperCase();
}

export async function renderTeamProfileView(container, { classroom, teamId, onBack, onSelectStudent }) {
  container.innerHTML = '';

  const team = classroom.teams.find((t) => t.id === teamId);
  if (!team) {
    const missing = document.createElement('div');
    missing.className = 'team-profile';
    missing.appendChild(createBackButton(onBack));
    missing.appendChild(createEmptyStateElement({ message: 'This team no longer exists.' }));
    container.appendChild(missing);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'team-profile';

  const header = document.createElement('div');
  header.className = 'learning-management__header';
  header.append(createBackButton(onBack));
  wrapper.appendChild(header);

  const identity = document.createElement('div');
  identity.className = 'team-profile__identity';
  identity.style.borderColor = getGroupColorHex(team.color);
  const swatch = document.createElement('span');
  swatch.className = 'team-profile__swatch';
  swatch.style.backgroundColor = getGroupColorHex(team.color);
  const name = document.createElement('h1');
  name.className = 'team-profile__name';
  name.textContent = team.name;
  identity.append(swatch, name);
  wrapper.appendChild(identity);

  // Current standing — the exact live numbers Class Mode/Tracker
  // already shows, never a separately-computed team total.
  const liveStandings = teamStatisticsService.getLiveTeamStandings(classroom);
  const liveEntry = liveStandings.find((entry) => entry.teamId === teamId);

  const statsRow = document.createElement('div');
  statsRow.className = 'team-profile__stats-row';
  statsRow.appendChild(buildStat('Current Standing', liveEntry ? `${liveEntry.score >= 0 ? '+' : ''}${liveEntry.score}` : '—'));
  statsRow.appendChild(buildStat('Rank This Cycle', liveEntry ? `#${liveEntry.rank}` : '—'));
  statsRow.appendChild(buildStat('Members', String(team.students.length)));
  wrapper.appendChild(statsRow);

  // Collective achievement history — Winning Team Member wins across
  // every closed Standing Cycle (services/scoreboardArchiveService.js's
  // own archives). No archives yet (a classroom that has never run
  // "Reset Scoreboard") genuinely has no closed cycles to report on —
  // shown as a real empty state, not a fabricated zero.
  const achievementsSection = document.createElement('div');
  achievementsSection.className = 'profile-section';
  const achievementsHeading = document.createElement('h2');
  achievementsHeading.className = 'profile-section__heading';
  achievementsHeading.textContent = 'Team Achievements';
  achievementsSection.appendChild(achievementsHeading);

  try {
    const archives = await scoreboardArchiveService.listArchives(classroom.id);
    if (archives.length === 0) {
      achievementsSection.appendChild(
        createEmptyStateElement({ message: 'No Standing Cycles have closed yet — achievements appear here once one does.' })
      );
    } else {
      const history = achievementService.getTeamAchievementHistory(archives, teamId);
      const statGrid = document.createElement('div');
      statGrid.className = 'team-profile__stats-row';
      statGrid.appendChild(buildStat('Winning Team Member Cycles', String(history.totalWins)));
      statGrid.appendChild(buildStat('Current Streak', history.currentStreak > 0 ? `${history.currentStreak} in a row` : '—'));
      statGrid.appendChild(buildStat('Best Cycle Score', history.bestCycleScore !== null ? `${history.bestCycleScore >= 0 ? '+' : ''}${history.bestCycleScore}` : '—'));
      achievementsSection.appendChild(statGrid);
    }
  } catch (error) {
    console.error('[TeamProfileView] Failed to load team achievement history:', error);
    const errorText = document.createElement('p');
    errorText.className = 'profile-section__meta';
    errorText.textContent = "Couldn't load this team's achievement history. Check your connection and try again.";
    achievementsSection.appendChild(errorText);
  }

  wrapper.appendChild(achievementsSection);

  // Members — a plain roster, not a ranked leaderboard (that already
  // exists in Class Mode/Tracker); tapping a member opens their own
  // Student Profile, matching every other member list in this app.
  const membersSection = document.createElement('div');
  membersSection.className = 'profile-section';
  const membersHeading = document.createElement('h2');
  membersHeading.className = 'profile-section__heading';
  membersHeading.textContent = 'Members';
  membersSection.appendChild(membersHeading);

  if (team.students.length === 0) {
    membersSection.appendChild(createEmptyStateElement({ message: 'No students in this team yet.' }));
  } else {
    const list = document.createElement('div');
    list.className = 'team-profile__member-list';
    team.students.forEach((student) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'team-profile__member-row';
      row.addEventListener('click', () => onSelectStudent(student.id));

      const avatar = document.createElement('span');
      avatar.className = 'team-profile__member-avatar';
      avatar.textContent = getInitials(student.name);

      const memberName = document.createElement('span');
      memberName.className = 'team-profile__member-name';
      memberName.textContent = student.name;

      row.append(avatar, memberName, createIcon('arrow-right', { size: 16 }));
      list.appendChild(row);
    });
    membersSection.appendChild(list);
  }

  wrapper.appendChild(membersSection);
  container.appendChild(wrapper);
}

function buildStat(label, value) {
  const stat = document.createElement('div');
  stat.className = 'team-profile__stat';
  const valueEl = document.createElement('p');
  valueEl.className = 'team-profile__stat-value';
  valueEl.textContent = value;
  const labelEl = document.createElement('p');
  labelEl.className = 'team-profile__stat-label';
  labelEl.textContent = label;
  stat.append(valueEl, labelEl);
  return stat;
}
