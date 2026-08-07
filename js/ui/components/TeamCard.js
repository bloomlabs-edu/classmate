/**
 * ui/components/TeamCard.js
 *
 * Renders one team card: a header with the team name and total score,
 * and the list of students (see ClassModeStudentRow.js for the actual
 * tap/swipe/long-press interactions). The header is tinted with the
 * team's assigned colour; a student's row uses their Learning Bucket as
 * its visual identity (soft pastel background + coloured left border) —
 * unchanged from earlier sprints.
 *
 * `highlightTeamId` triggers a one-shot "pulse" animation on this card's
 * total when it was the team whose score just changed. Since every
 * action fully re-renders the tracker, this element is always freshly
 * created, so the CSS animation just plays on mount — no cleanup needed.
 *
 * `onTapTeam` is optional — when provided (the Student Portal's own
 * "tapping a team opens that team's page"), the header becomes a real
 * button; when absent (the Teacher Portal, where the header has never
 * needed to navigate anywhere), it stays a plain, non-interactive
 * heading, exactly as before. `tapActionLabel` is forwarded straight
 * through to every student row — see ClassModeStudentRow.js's own
 * header comment for what it controls.
 */

import { getGroupColorHex } from '../../config/groupColorConfig.js';
import { createClassModeStudentRow } from './ClassModeStudentRow.js';

export function createTeamCardElement(team, teamScore, { onTap, onSwipeLeft, onLongPress, onTapTeam, tapActionLabel, highlightTeamId, movement, studentMovements = {} } = {}) {
  const card = document.createElement('article');
  card.className = 'team-card';
  card.dataset.teamId = team.id;

  const header = document.createElement(onTapTeam ? 'button' : 'header');
  header.className = 'team-card__header';
  header.style.backgroundColor = team.color ? getGroupColorHex(team.color) : '';
  if (onTapTeam) {
    header.type = 'button';
    header.classList.add('team-card__header--clickable');
    header.addEventListener('click', onTapTeam);
  }

  const title = document.createElement('h2');
  title.className = 'team-card__name';
  title.textContent = team.name;

  const total = document.createElement('span');
  total.className = 'team-card__total';
  if (highlightTeamId && team.id === highlightTeamId) {
    total.classList.add('team-card__total--pulse');
  }
  total.textContent = `${teamScore} \u2b50`;
  total.setAttribute('aria-label', `${team.name} total score: ${teamScore} stars`);

  header.append(title, total);

  if (movement) {
    header.appendChild(createMovementIndicator(movement, team.name));
  }

  const list = document.createElement('ul');
  list.className = 'student-list';
  team.students.forEach((student) => {
    list.appendChild(
      createClassModeStudentRow(student, { onTap, onSwipeLeft, onLongPress, tapActionLabel, movement: studentMovements[student.id] })
    );
  });

  card.append(header, list);
  return card;
}

/**
 * Renders services/teamStatisticsService.js's own `{ movement,
 * movementAmount }` shape — 'up'/'down'/'same', comparing against
 * MOVEMENT_BASELINES.sincePeriodStart (a fixed anchor at this
 * period's own start, not a rolling day-to-day one, per that
 * function's own comment: "a month-long competition should read as
 * a season, not a daily scoreboard flip"). This component only ever
 * renders the plain facts it's handed; the comparison itself lives
 * entirely in the service.
 */
function createMovementIndicator(movement, teamName) {
  const indicator = document.createElement('span');
  indicator.className = `team-card__movement team-card__movement--${movement.movement}`;

  const symbol = { up: '\u2191', down: '\u2193', same: '\u2192' }[movement.movement];
  indicator.textContent = movement.movement === 'same' ? symbol : `${symbol}${movement.movementAmount}`;
  indicator.setAttribute(
    'aria-label',
    movement.movement === 'same'
      ? `${teamName} has not changed position since the period started`
      : `${teamName} moved ${movement.movement} ${movement.movementAmount} position${movement.movementAmount === 1 ? '' : 's'} since the period started`
  );

  return indicator;
}
