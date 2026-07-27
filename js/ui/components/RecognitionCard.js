/**
 * ui/components/RecognitionCard.js
 *
 * A single recognition category's winner(s), presented as a card.
 * Shared by the Dashboard's Recognition Wall (compact variant) and the
 * Recognition Screen (full variant) — extracted from what used to be a
 * private function inside RecognitionWidget.js, so it's genuinely
 * reusable rather than reusable in name only.
 *
 * The `full` variant answers all four questions a Winner Card should
 * answer immediately:
 *   Who?      -> initials + name(s), co-winners shown side by side, never truncated
 *   Why?      -> category.reasonText
 *   How much? -> the key statistic, formatted prominently (e.g. "5 Stars",
 *                "12-Day Streak", "98% Notebook Completion",
 *                "+4 Rank Positions") — never buried inside a sentence
 *   When?     -> the period label
 * The `compact` variant (Dashboard Wall, many cards visible at once) shows
 * only icon + label + name(s) — enough to recognize at a glance, without
 * the density a full breakdown per card would need at that scale.
 *
 * Team Champion is a deliberate presentation exception: its winners have
 * a `teamName`, not a `studentName`, and render with a group icon rather
 * than initials — a different variant of the same card, not forced into
 * the per-student model.
 *
 * Designed to double as the basis for a future printable certificate,
 * Wall of Fame, or assembly announcement without any change to the data
 * it's given: every value here is already plain, structured data
 * returned by services/studentProgressService.js (student/team name,
 * rank, stars, streak, completion %, movement) — this file only ever
 * formats and lays it out, never computes it. A future certificate
 * layout is a new consumer of the same props, not a reason to touch the
 * Progress Engine.
 *
 * No profile photos anywhere — initials only, matching the org's policy
 * on minors, and consistent with the Student Dashboard preview design.
 */

import { createIcon } from './Icon.js';

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const PERIOD_LABELS = Object.freeze({
  week: 'This Week',
  month: 'This Month',
  all_time: 'All Time',
});

/**
 * The prominent key statistic — deliberately per-resolverId rather than
 * a generic "value: N", since each category's number needs different
 * units to be self-explanatory at a glance.
 */
function formatKeyStatistic(category, winner) {
  switch (category.resolverId) {
    case 'stars':
    case 'team_stars':
      return `${winner.stars} ${winner.stars === 1 ? 'Star' : 'Stars'}`;
    case 'streak':
      return `${winner.streak}-Day Streak`;
    case 'notebook_completion':
      return `${winner.completionPercent}% Notebook Completion`;
    case 'biggest_climber':
      return `+${winner.movement} Rank Position${winner.movement === 1 ? '' : 's'}`;
    default:
      return '';
  }
}

function isTeamWinner(winner) {
  return winner.teamName !== undefined;
}

export function createRecognitionCardElement({ category, winners, period, variant = 'full', onSelectStudent }) {
  const card = document.createElement('div');
  card.className = variant === 'compact' ? 'recognition-card recognition-card--compact' : 'recognition-card recognition-card--full';

  const header = document.createElement('div');
  header.className = 'recognition-card__header';
  const icon = document.createElement('span');
  icon.className = 'recognition-card__icon';
  icon.textContent = category.icon;
  const label = document.createElement('span');
  label.className = 'recognition-card__label';
  label.textContent = category.label;
  header.append(icon, label);
  card.appendChild(header);

  const winnersRow = document.createElement('div');
  winnersRow.className = 'recognition-card__winners';

  winners.forEach((winner) => {
    const winnerEl = document.createElement('div');
    winnerEl.className = 'recognition-card__winner';

    const avatar = document.createElement('span');
    avatar.className = isTeamWinner(winner)
      ? 'recognition-card__avatar recognition-card__avatar--team'
      : 'recognition-card__avatar';
    if (isTeamWinner(winner)) {
      avatar.appendChild(createIcon('users', { size: 18 }));
    } else {
      avatar.textContent = getInitials(winner.studentName);
    }

    let name;
    if (onSelectStudent && !isTeamWinner(winner)) {
      name = document.createElement('button');
      name.type = 'button';
      name.className = 'recognition-card__winner-name student-name-link';
      name.addEventListener('click', () => onSelectStudent(winner.studentId));
    } else {
      name = document.createElement('span');
      name.className = 'recognition-card__winner-name';
    }
    name.textContent = isTeamWinner(winner) ? winner.teamName : winner.studentName;

    winnerEl.append(avatar, name);
    winnersRow.appendChild(winnerEl);
  });

  card.appendChild(winnersRow);

  if (variant === 'full') {
    const reason = document.createElement('p');
    reason.className = 'recognition-card__reason';
    reason.textContent = category.reasonText;
    card.appendChild(reason);

    const stat = document.createElement('div');
    stat.className = 'recognition-card__stat';
    stat.textContent = formatKeyStatistic(category, winners[0]);
    card.appendChild(stat);

    const periodEl = document.createElement('div');
    periodEl.className = 'recognition-card__period';
    periodEl.textContent = PERIOD_LABELS[period] || period;
    card.appendChild(periodEl);
  }

  return card;
}
