/**
 * ui/components/TeamStandingsBoard.js
 *
 * The one, canonical classroom standings board — "one component, two
 * consumers," per explicit product decision. This is the exact same
 * board Class Mode has always shown, extracted from
 * ui/views/TrackerView.js's own inline team-grid loop into its own
 * reusable function; nothing about the rendering itself changed.
 *
 * Reuses ui/components/TeamCard.js (and, through it,
 * ClassModeStudentRow.js) entirely unchanged in spirit — those were
 * already pure, callback-driven components with zero teacher-specific
 * logic baked in; the only piece genuinely missing was this grid
 * wrapper, and now, per explicit product decision, per-student
 * movement.
 *
 * Team score/movement comes from
 * services/teamStatisticsService.js's own getTeamStandingsWithMovement().
 * Student movement is deliberately CLASS-WIDE, not team-relative — per
 * explicit product decision: the motivational signal is "how have you
 * grown, personally, since the period started," not "how do you
 * compare to your four teammates." getClassLeaderboardWithMovement()
 * already existed and already ranks across the whole classroom (see
 * that function's own use of classroom.teams.flatMap()) — computed
 * ONCE here, for the entire classroom, not once per team; every team
 * card looks its own students up from that one shared map. Neither
 * TeamCard.js nor ClassModeStudentRow.js recalculates anything — they
 * only render whatever movement object they're given.
 *
 * A session-performance badge ("+3⭐ this session," alongside the
 * ranking badge) was tried here and then deliberately removed as
 * unnecessary visual clutter — see
 * services/classSessionService.js's own
 * getStudentStarDeltaSinceSessionStart() for the still-correct,
 * still-tested underlying calculation, which nothing here calls
 * anymore. This was a pure rendering removal — no business logic was
 * touched, since nothing else in the app ever read this computation's
 * output for anything besides that one badge.
 *
 * Each team's own roster is sorted by current score, descending,
 * before being handed to TeamCard — per explicit product decision,
 * "a leaderboard should visibly reorder as scores change, not stay in
 * static roster order." The sort happens ONCE, here, on a COPY of
 * team.students — TeamCard.js and ClassModeStudentRow.js never sort
 * anything themselves, and the real team.students array itself is
 * never mutated (nothing else in the app that reads team.students
 * directly should have its own assumptions about order disturbed).
 *
 * `onTap`/`onSwipeLeft`/`onLongPress` are passed straight through to
 * every student row, exactly as TrackerView.js already did. All three
 * are optional here (student rows handle a missing onSwipeLeft/
 * onLongPress gracefully — see ClassModeStudentRow.js's own comment):
 * the Teacher Portal supplies all three (award star / deduct point /
 * Quick Actions); the Student Portal supplies only onTap (open a
 * public profile) and onTapTeam (open that team's page), leaving the
 * rest genuinely absent — not a "student version with fewer
 * features," the identical board with fewer callbacks wired in.
 */

import { createTeamCardElement } from './TeamCard.js';
import { createEmptyStateElement } from './EmptyState.js';
import { getTeamStandingsWithMovement, getClassLeaderboardWithMovement, getCurrentMonthPeriod } from '../../services/teamStatisticsService.js';
import { getNetPoints } from '../../services/timelineService.js';

export function createTeamStandingsBoardElement({ classroom, onTap, onSwipeLeft, onLongPress, onTapTeam, highlight = {} }) {
  const grid = document.createElement('section');
  grid.className = 'team-grid';
  grid.setAttribute('aria-label', 'Teams');

  const teamsWithStudents = classroom.teams.filter((team) => team.students.length > 0);

  if (teamsWithStudents.length === 0) {
    grid.appendChild(
      createEmptyStateElement({ message: 'No groups in this classroom yet. Add some from Settings \u2192 Groups.' })
    );
    return grid;
  }

  const period = getCurrentMonthPeriod();
  const standingsWithMovement = getTeamStandingsWithMovement(classroom, period);

  const studentMovements = {};
  getClassLeaderboardWithMovement(classroom, period).forEach((entry) => {
    studentMovements[entry.studentId] = { movement: entry.movement, movementAmount: entry.movementAmount };
  });

  teamsWithStudents.forEach((team) => {
    const standing = standingsWithMovement.find((entry) => entry.teamId === team.id);
    const sortedStudents = [...team.students].sort((a, b) => getNetPoints(b) - getNetPoints(a));

    grid.appendChild(
      createTeamCardElement(team, standing ? standing.score : 0, {
        highlightTeamId: highlight.teamId,
        onTap,
        onSwipeLeft,
        onLongPress,
        onTapTeam: onTapTeam ? () => onTapTeam(team.id) : undefined,
        movement: standing ? { movement: standing.movement, movementAmount: standing.movementAmount } : undefined,
        studentMovements,
        sortedStudents,
      })
    );
  });

  return grid;
}
