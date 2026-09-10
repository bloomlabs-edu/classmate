/**
 * ui/components/StudentStandingsBoard.js
 *
 * The class-wide, cross-team student ranking with movement — the
 * per-student sibling of ui/components/ClassroomStandingsBoard.js
 * (same row shape, same CSS classes, same movement-arrow convention),
 * built for ui/views/WeeklyReportDetailView.js's own historical
 * Student Standings section. Entirely a pure function of `classroom`
 * and `period`: every number comes from
 * services/teamStatisticsService.js's own
 * getClassLeaderboardWithMovement() — no new ranking rule, this file
 * only ever draws whatever that service already computed.
 *
 * Deliberately does NOT reuse ui/components/LeaderboardList.js (the
 * Recognition Screen's own ranked list): that component has no
 * movement-badge slot, and adding one there risked a visual change to
 * a screen this feature was never asked to touch. This is a new,
 * small, focused component instead — visually consistent with
 * ClassroomStandingsBoard (same `standings-board__*` classes) rather
 * than inventing a third visual language for "a ranked list."
 *
 * Contains only what teamStatisticsService already returns:
 * studentId/studentName/teamId/teamName/score/rank/movement/
 * movementAmount — no bucket, no badges, no notes, no behaviour/
 * redemption state. This is what makes it safe to show to students
 * unmodified (see WeeklyReportDetailView.js's own header comment on
 * student privacy): there is nothing sensitive in this data to
 * accidentally leak in the first place.
 *
 * `highlightStudentId` (optional) visually marks one row — the
 * Student Portal's own "this is you" personalization; the Teacher
 * Portal simply never passes it.
 */

import * as teamStatisticsService from '../../services/teamStatisticsService.js';
import { createEmptyStateElement } from './EmptyState.js';

const MOVEMENT_ARROWS = { up: '↑', down: '↓', same: '→' };

export function createStudentStandingsBoardElement({
  classroom,
  period,
  onSelectStudent,
  highlightStudentId,
  heading: headingText = '⭐ Student Standings',
  periodLabel = 'this period',
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'standings-board';

  const heading = document.createElement('h2');
  heading.className = 'standings-board__heading';
  heading.textContent = headingText;
  wrapper.appendChild(heading);

  const standings = teamStatisticsService.getClassLeaderboardWithMovement(classroom, period);

  if (standings.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No students in this classroom yet.' }));
    return wrapper;
  }

  const list = document.createElement('div');
  list.className = 'standings-board__list';

  standings.forEach((entry) => {
    const isSelf = highlightStudentId && entry.studentId === highlightStudentId;
    const row = document.createElement(onSelectStudent ? 'button' : 'div');
    row.className = 'standings-board__row' + (isSelf ? ' standings-board__row--self' : '');
    if (onSelectStudent) {
      row.type = 'button';
      row.classList.add('standings-board__row--clickable');
      row.addEventListener('click', () => onSelectStudent(entry.studentId));
    }

    const rankEl = document.createElement('span');
    rankEl.className = 'standings-board__rank';
    rankEl.textContent = `#${entry.rank}`;
    row.appendChild(rankEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'standings-board__team-name';
    nameEl.textContent = isSelf ? `${entry.studentName} (You)` : entry.studentName;
    row.appendChild(nameEl);

    const scoreEl = document.createElement('span');
    scoreEl.className = 'standings-board__score';
    scoreEl.textContent = `${entry.score} ⭐`;
    row.appendChild(scoreEl);

    const movementEl = document.createElement('span');
    movementEl.className = `standings-board__movement standings-board__movement--${entry.movement}`;
    movementEl.textContent =
      entry.movement === 'same' ? MOVEMENT_ARROWS.same : `${MOVEMENT_ARROWS[entry.movement]}${entry.movementAmount}`;
    movementEl.setAttribute(
      'aria-label',
      entry.movement === 'same'
        ? `No change since ${periodLabel} began`
        : `${entry.movement === 'up' ? 'Climbed' : 'Dropped'} ${entry.movementAmount} position${entry.movementAmount === 1 ? '' : 's'} since ${periodLabel} began`
    );
    row.appendChild(movementEl);

    list.appendChild(row);
  });

  wrapper.appendChild(list);
  return wrapper;
}
