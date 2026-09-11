/**
 * ui/views/TeamProfileView.js
 *
 * The Team Profile — "what have we achieved together," the collective
 * counterpart to ui/views/StudentProfileView.js's "what have I
 * achieved." Reachable from every place a team is shown as a real
 * entity (see this file's own callers in js/main.js for the exact
 * list — Class Mode's own team cards, the Dashboard Groups widget,
 * Classroom Management's group cards, and the Scoreboard Archive's
 * own historical team cards), never a second place to rename/add/
 * remove a team — that stays exactly where it already is
 * (ui/views/ClassroomManagementView.js).
 *
 * Bento composition, reusing the same hierarchy language
 * ui/views/ReportsView.js/ui/views/ScoreboardArchiveView.js already
 * established (hero -> secondary row -> full-width history), not a
 * second Bento system:
 *   hero      — team identity + current standing
 *   secondary — Members (compact roster) | Achievements (generic,
 *               events-driven — see below)
 *   full-width — Recent Team History (chronological cycles)
 *
 * Achievements is deliberately NOT built on
 * services/achievementService.js's getTeamAchievementHistory() — that
 * function is Winning-Team-Member-specific by design (it re-runs the
 * actual award rule; see its own header comment). This view instead
 * uses summarizeTeamAchievements(), the generic, events-driven
 * counterpart: whatever badge types this team's own Achievement
 * Events actually name appear here automatically, with no hard-coded
 * "Winning Team Member" assumption anywhere in this file.
 *
 * Current standing/points come from the exact same live
 * services/teamStatisticsService.js this app already uses everywhere
 * else (no parallel scoring). Historical accuracy is inherited for
 * free from services/scoreboardArchiveService.js's own point-in-time
 * archives — an Achievement Event's own teamId/teamName reflect
 * whichever team actually existed at that cycle's own close, never
 * today's roster; a student who has since left or moved teams simply
 * doesn't affect what already happened.
 */

import * as teamStatisticsService from '../../services/teamStatisticsService.js';
import * as scoreboardArchiveService from '../../services/scoreboardArchiveService.js';
import * as achievementService from '../../services/achievementService.js';
import { createBadge } from '../components/Badge.js';
import { BADGE_SIZES } from '../../config/badgeDefinitions.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts[0][0].toUpperCase();
}

function formatDisplayDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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

  const bento = document.createElement('div');
  bento.className = 'team-profile__bento';

  // --- Hero: identity + current standing (the live number, never a
  // separately-computed team total) ---
  const liveStandings = teamStatisticsService.getLiveTeamStandings(classroom);
  const liveEntry = liveStandings.find((entry) => entry.teamId === teamId);

  const hero = document.createElement('div');
  hero.className = 'team-profile__hero';
  hero.style.borderColor = getGroupColorHex(team.color);
  const swatch = document.createElement('span');
  swatch.className = 'team-profile__swatch';
  swatch.style.backgroundColor = getGroupColorHex(team.color);
  const name = document.createElement('h1');
  name.className = 'team-profile__name';
  name.textContent = team.name;
  const standing = document.createElement('p');
  standing.className = 'team-profile__hero-standing';
  standing.textContent = liveEntry ? `Current Standing: ${liveEntry.score >= 0 ? '+' : ''}${liveEntry.score} · Rank #${liveEntry.rank}` : 'Current Standing: —';
  hero.append(swatch, name, standing);
  bento.appendChild(hero);

  // --- Secondary row: Members | Achievements ---
  const secondaryRow = document.createElement('div');
  secondaryRow.className = 'team-profile__secondary-row';

  secondaryRow.appendChild(buildMembersTile(team, onSelectStudent));

  let allEvents = [];
  let archives = [];
  try {
    [allEvents, archives] = await Promise.all([
      achievementService.listAllEvents(classroom.id),
      scoreboardArchiveService.listArchives(classroom.id),
    ]);
  } catch (error) {
    console.error('[TeamProfileView] Failed to load team achievements:', error);
  }

  secondaryRow.appendChild(buildAchievementsTile(allEvents, teamId));
  bento.appendChild(secondaryRow);

  // --- Full-width: Recent Team History ---
  bento.appendChild(buildHistoryTile(archives, allEvents, teamId));

  wrapper.appendChild(bento);
  container.appendChild(wrapper);
}

function buildMembersTile(team, onSelectStudent) {
  const tile = document.createElement('div');
  tile.className = 'team-profile__tile';

  const heading = document.createElement('h2');
  heading.className = 'team-profile__tile-heading';
  heading.textContent = `Members · ${team.students.length}`;
  tile.appendChild(heading);

  if (team.students.length === 0) {
    tile.appendChild(createEmptyStateElement({ message: 'No students in this team yet.' }));
    return tile;
  }

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
  tile.appendChild(list);
  return tile;
}

/**
 * Generic, events-driven — see this file's own header comment on why
 * this is deliberately not getTeamAchievementHistory(). Badge artwork
 * at "standard" (72-96px) scale, per the established size tiers
 * (config/badgeDefinitions.js) — a significant team achievement, not a
 * tiny utility icon.
 */
function buildAchievementsTile(allEvents, teamId) {
  const tile = document.createElement('div');
  tile.className = 'team-profile__tile';

  const heading = document.createElement('h2');
  heading.className = 'team-profile__tile-heading';
  heading.textContent = 'Achievements';
  tile.appendChild(heading);

  const summaries = achievementService.summarizeTeamAchievements(allEvents, teamId);
  if (summaries.length === 0) {
    tile.appendChild(createEmptyStateElement({ message: 'No achievements yet — these appear once a Standing Cycle closes with this team recognised.' }));
    return tile;
  }

  const list = document.createElement('div');
  list.className = 'team-profile__achievement-list';
  summaries.forEach((summary) => {
    const row = document.createElement('div');
    row.className = 'team-profile__achievement-row';
    row.appendChild(createBadge({ family: summary.definition.family, recognitionType: summary.definition.recognitionType, level: summary.cycleCount, size: BADGE_SIZES.standard, showLevel: false }));
    const text = document.createElement('div');
    text.className = 'team-profile__achievement-text';
    const title = document.createElement('p');
    title.className = 'team-profile__achievement-title';
    title.textContent = summary.definition.title;
    const count = document.createElement('p');
    count.className = 'team-profile__achievement-count';
    count.textContent = `${summary.cycleCount} cycle${summary.cycleCount === 1 ? '' : 's'}`;
    text.append(title, count);
    row.appendChild(text);
    list.appendChild(row);
  });
  tile.appendChild(list);
  return tile;
}

/**
 * Recent Team History — every cycle (real Scoreboard Archive) this
 * team appears in, newest first, with its own total that cycle and
 * whichever recognitions actually resulted from it (generic across
 * badge types, same as the Achievements tile above). Never
 * reconstructs a historical fact from current data — each row's own
 * team total and recognitions come straight from that one archive's
 * own frozen record and that one cycle's own Achievement Events.
 */
function buildHistoryTile(archives, allEvents, teamId) {
  const tile = document.createElement('div');
  tile.className = 'team-profile__tile team-profile__tile--history';

  const heading = document.createElement('h2');
  heading.className = 'team-profile__tile-heading';
  heading.textContent = 'Recent Team History';
  tile.appendChild(heading);

  const relevant = archives
    .filter((archive) => archive.teams.some((t) => t.id === teamId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8);

  if (relevant.length === 0) {
    tile.appendChild(createEmptyStateElement({ message: 'No Standing Cycles have closed yet — history appears here once one does.' }));
    return tile;
  }

  const list = document.createElement('div');
  list.className = 'team-profile__history-list';
  relevant.forEach((archive) => {
    const teamInCycle = archive.teams.find((t) => t.id === teamId);
    const cycleEvents = allEvents.filter((event) => event.cycleId === archive.id && event.teamId === teamId);
    const badgeTypes = achievementService.summarizeTeamAchievements(cycleEvents, teamId);

    const row = document.createElement('div');
    row.className = 'team-profile__history-row';

    const dateEl = document.createElement('span');
    dateEl.className = 'team-profile__history-date';
    dateEl.textContent = formatDisplayDate(archive.createdAt);
    row.appendChild(dateEl);

    const scoreEl = document.createElement('span');
    scoreEl.className = 'team-profile__history-score';
    scoreEl.textContent = teamInCycle ? `${teamInCycle.total >= 0 ? '+' : ''}${teamInCycle.total}` : '—';
    row.appendChild(scoreEl);

    if (badgeTypes.length > 0) {
      const recognitionEl = document.createElement('span');
      recognitionEl.className = 'team-profile__history-recognition';
      recognitionEl.textContent = badgeTypes.map((b) => b.definition.title).join(', ');
      row.appendChild(recognitionEl);
    }

    list.appendChild(row);
  });
  tile.appendChild(list);
  return tile;
}
