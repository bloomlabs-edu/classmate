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
 * movement AND session performance.
 *
 * Two genuinely different metrics, kept deliberately separate rather
 * than conflated into one badge:
 *   - Session star delta (the PRIMARY badge) — "how many stars this
 *     student earned this session," from
 *     services/classSessionService.js's own
 *     getStudentStarDeltaSinceSessionStart(), itself a pure derivation
 *     over student.history (every award/deduction already writes a
 *     real, signed delta there) — no new persistence.
 *   - Ranking movement (the SECONDARY badge) — "where this student
 *     stands relative to the whole class since the period started,"
 *     unchanged from the prior milestone: still CLASS-WIDE (not
 *     team-relative), still from
 *     services/teamStatisticsService.js's own
 *     getClassLeaderboardWithMovement().
 * Both are computed exactly ONCE here, for the entire classroom, and
 * handed down as plain data. Team score/movement is unchanged
 * (getTeamStandingsWithMovement()).
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
import { getStudentStarDeltaSinceSessionStart } from '../../services/classSessionService.js';

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

    const sortedStudents = [...team.students].sort((a, b) => b.score - a.score);
    const studentSessionDeltas = {};
    sortedStudents.forEach((student) => {
      studentSessionDeltas[student.id] = getStudentStarDeltaSinceSessionStart(classroom, student);
    });

    grid.appendChild(
      createTeamCardElement(team, standing ? standing.score : 0, {
        highlightTeamId: highlight.teamId,
        onTap,
        onSwipeLeft,
        onLongPress,
        onTapTeam: onTapTeam ? () => onTapTeam(team.id) : undefined,
        movement: standing ? { movement: standing.movement, movementAmount: standing.movementAmount } : undefined,
        studentMovements,
        studentSessionDeltas,
        sortedStudents,
      })
    );
  });

  return grid;
}
