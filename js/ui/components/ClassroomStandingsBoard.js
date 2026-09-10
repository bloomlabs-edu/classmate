/**
 * ui/components/ClassroomStandingsBoard.js
 *
 * A shared, read-only team standings board — originally built for a
 * "shared standings board between teacher and student portal" per an
 * earlier product decision, though neither the Dashboard nor the
 * Student Portal's Team tab currently calls it (both now use
 * ui/components/TeamStandingsBoard.js, the LIVE tap-to-award board —
 * confirmed by direct inspection while building Weekly Reports, which
 * is this component's first actual caller:
 * ui/views/WeeklyReportDetailView.js). Deliberately NOT the same
 * component as TeamStandingsBoard.js for that use — a historical
 * week's standings must never look tappable/editable, the same reason
 * ui/views/ScoreboardArchiveView.js's own detail view already avoids
 * reusing it. If a live Dashboard/Team-tab standings board is ever
 * built again, reusing this plain, read-only-by-default one (rather
 * than a third implementation) is the right move.
 *
 * Entirely a pure function of `classroom` — every number comes from
 * services/teamStatisticsService.js's getTeamStandingsWithMovement(),
 * called fresh on every render, current month only
 * (getCurrentMonthPeriod()). This component holds no state of its own
 * and performs no comparison itself; it only draws whatever the
 * service already computed. Real-time updates are therefore "free":
 * whatever re-renders this element with a fresh `classroom` (the
 * Student Portal's single live subscription, or the teacher side's
 * own existing classroom subscription) automatically reflects the
 * latest standings, with no separate wiring needed here.
 *
 * Movement shows both direction and magnitude together (↑2, ↓3, →) —
 * a bare arrow with no number doesn't answer "how much," which is the
 * whole point of a month-long story ("the arrows tell the story of
 * the competition"), not just a same/different flag.
 *
 * `onSelectTeam` is optional — when provided, each row becomes a real
 * button; when absent, rows render as plain, non-interactive divs.
 * This milestone's own callers don't pass it yet (Team Details has
 * its own drill-down screen intentionally out of scope here), but the
 * seam exists now so wiring it in later never requires touching this
 * component.
 *
 * Bucket color never appears here at all — "Support Level ≠
 * Contribution," per explicit product decision; this board only ever
 * reflects net score.
 *
 * `period` and `heading` (both optional) were added for
 * ui/views/WeeklyReportDetailView.js's own historical Weekly Reports —
 * passing a past week's own {start, end} range reuses this exact same
 * board, unchanged, to show that week's own team standings (movement
 * "since period start" then correctly means "since that week's own
 * Monday," not "since this month began" — see
 * services/teamStatisticsService.js's own MOVEMENT_BASELINES comment
 * for why the baseline is always the given period's own first day).
 * Both default to the original, still-current behavior (this month,
 * "Classroom Standings"), so the teacher Dashboard and the Student
 * Portal's Team tab — neither of which passes either — are completely
 * unaffected. `periodLabel` (also optional, defaults to "this month")
 * feeds the movement row's own aria-label, so a Weekly Report's screen
 * reader announcement correctly says "since this week began" instead.
 */

import * as teamStatisticsService from '../../services/teamStatisticsService.js';
import { createEmptyStateElement } from './EmptyState.js';

const MOVEMENT_ARROWS = { up: '\u2191', down: '\u2193', same: '\u2192' };

export function createClassroomStandingsBoardElement({
  classroom,
  onSelectTeam,
  period,
  heading: headingText = '\ud83c\udfc6 Classroom Standings',
  periodLabel = 'this month',
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'standings-board';

  const heading = document.createElement('h2');
  heading.className = 'standings-board__heading';
  heading.textContent = headingText;
  wrapper.appendChild(heading);

  const resolvedPeriod = period || teamStatisticsService.getCurrentMonthPeriod();
  const standings = teamStatisticsService.getTeamStandingsWithMovement(classroom, resolvedPeriod);

  if (standings.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No teams yet \u2014 once students are grouped, standings will appear here.' }));
    return wrapper;
  }

  const list = document.createElement('div');
  list.className = 'standings-board__list';

  standings.forEach((entry) => {
    const row = document.createElement(onSelectTeam ? 'button' : 'div');
    row.className = 'standings-board__row';
    if (onSelectTeam) {
      row.type = 'button';
      row.classList.add('standings-board__row--clickable');
      row.addEventListener('click', () => onSelectTeam(entry.teamId));
    }

    const rankEl = document.createElement('span');
    rankEl.className = 'standings-board__rank';
    rankEl.textContent = `#${entry.rank}`;
    row.appendChild(rankEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'standings-board__team-name';
    nameEl.textContent = entry.teamName;
    row.appendChild(nameEl);

    const scoreEl = document.createElement('span');
    scoreEl.className = 'standings-board__score';
    scoreEl.textContent = `${entry.score} \u2b50`;
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
