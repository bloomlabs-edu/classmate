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
 * ClassModeStudentRow.js) entirely unchanged — those were already
 * pure, callback-driven components with zero teacher-specific logic
 * baked in; the only piece genuinely missing was this grid wrapper.
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
import { getTeamScore } from '../../services/teamService.js';

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

  teamsWithStudents.forEach((team) => {
    grid.appendChild(
      createTeamCardElement(team, getTeamScore(team), {
        highlightTeamId: highlight.teamId,
        onTap,
        onSwipeLeft,
        onLongPress,
        onTapTeam: onTapTeam ? () => onTapTeam(team.id) : undefined,
      })
    );
  });

  return grid;
}
