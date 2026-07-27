/**
 * ui/components/WeeklySnapshotWidget.js
 *
 * Classroom Dashboard widget: a quick pulse on this week, built
 * entirely on services/studentProgressService.js (the Progress Engine
 * — see docs/PROGRESS_ENGINE.md). Three pieces, per the approved
 * Phase 2 layout:
 *   - Weekly Stars: total stars awarded classroom-wide this week (a
 *     quick "how much star activity happened" pulse, not a per-student
 *     figure — that's what the leaderboard preview below is for).
 *   - Weekly Leaderboard: the top 3 by rank (ties included in full —
 *     e.g. two students tied for #1 both show, which may show more
 *     than 3 names; see getRankInRange's tie handling).
 *   - Team Champion: whichever team(s) are rank 1 this week.
 */

import * as studentProgressService from '../../services/studentProgressService.js';
import { getWeekRange } from '../../utils/dateHelpers.js';
import { createEmptyStateElement } from './EmptyState.js';
import { createIcon, createIconBadge } from './Icon.js';

/**
 * A small, reliable rank indicator — a colored circular badge for the
 * top 3 (gold/silver/bronze), plain "#N" text beyond that. Built from
 * CSS/DOM rather than medal emoji: emoji rendering is inconsistent
 * across OS/browser combinations (this project has run into exactly
 * that rendering gap before, with 📒 falling back to a box glyph in
 * one test environment) — a real visibility concern, not just a
 * stylistic one, so this needed a platform-independent fix.
 */
function createRankIndicator(rank) {
  if (rank > 3) {
    const text = document.createElement('span');
    text.textContent = `#${rank}`;
    return text;
  }
  const badge = document.createElement('span');
  badge.className = `rank-badge rank-badge--${rank}`;
  badge.textContent = String(rank);
  return badge;
}

export function createWeeklySnapshotWidgetElement({ classroom, onSelectStudent }) {
  const widget = document.createElement('div');
  widget.className = 'dashboard-widget dashboard-widget--editorial dashboard-widget--learn';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-widget__heading';
  heading.appendChild(createIconBadge('trending-up', 'progress', { size: 28 }));
  heading.append('Weekly Snapshot');
  widget.appendChild(heading);

  const weekRange = getWeekRange();
  const rank = studentProgressService.getRankInRange(classroom, weekRange);
  const teamRank = studentProgressService.getTeamRankInRange(classroom, weekRange);

  const totalWeeklyStars = rank.reduce((sum, entry) => sum + entry.stars, 0);

  if (totalWeeklyStars === 0) {
    widget.appendChild(createEmptyStateElement({ message: 'No stars awarded yet \u2014 plenty of week left.' }));
    return widget;
  }

  const kpiCard = document.createElement('div');
  kpiCard.className = 'kpi-card';
  const kpiIcon = document.createElement('span');
  kpiIcon.className = 'kpi-card__icon';
  kpiIcon.textContent = '\u2b50';
  kpiIcon.setAttribute('aria-hidden', 'true');
  const kpiNumber = document.createElement('span');
  kpiNumber.className = 'kpi-card__number';
  kpiNumber.textContent = String(totalWeeklyStars);
  const kpiLabel = document.createElement('span');
  kpiLabel.className = 'kpi-card__label';
  kpiLabel.textContent = `${totalWeeklyStars === 1 ? 'star' : 'stars'} awarded this week`;
  kpiCard.append(kpiIcon, kpiNumber, kpiLabel);
  widget.appendChild(kpiCard);

  const topThree = rank.filter((entry) => entry.rank <= 3 && entry.stars > 0);
  if (topThree.length > 0) {
    const leaderboardHeading = document.createElement('h3');
    leaderboardHeading.className = 'dashboard-widget__subheading';
    leaderboardHeading.textContent = 'Weekly Leaderboard';
    widget.appendChild(leaderboardHeading);

    const list = document.createElement('ol');
    list.className = 'editorial-list';
    topThree.forEach((entry) => {
      const item = document.createElement('li');
      item.className = `editorial-list__row${entry.rank <= 3 ? ` editorial-list__row--rank-${entry.rank}` : ''}`;
      const rank = document.createElement('span');
      rank.className = 'editorial-list__rank';
      rank.appendChild(createRankIndicator(entry.rank));
      let name;
      if (onSelectStudent) {
        name = document.createElement('button');
        name.type = 'button';
        name.className = 'editorial-list__name student-name-link';
        name.addEventListener('click', () => onSelectStudent(entry.studentId));
      } else {
        name = document.createElement('span');
        name.className = 'editorial-list__name';
      }
      name.textContent = entry.studentName;
      const value = document.createElement('span');
      value.className = 'editorial-list__value';
      value.textContent = `${entry.stars} \u2b50`;
      item.append(rank, name, value);
      list.appendChild(item);
    });
    widget.appendChild(list);
  }

  const championTeams = teamRank.filter((entry) => entry.rank === 1 && entry.stars > 0);
  if (championTeams.length > 0) {
    const championHeading = document.createElement('h3');
    championHeading.className = 'dashboard-widget__subheading';
    championHeading.appendChild(createIcon('users', { size: 16 }));
    championHeading.append(' Team Champion');
    widget.appendChild(championHeading);

    const championLine = document.createElement('p');
    championLine.className = 'dashboard-widget__stat-line';
    championLine.textContent = championTeams.map((team) => `${team.teamName} (${team.stars} \u2b50)`).join(' \u00b7 ');
    widget.appendChild(championLine);
  }

  return widget;
}
