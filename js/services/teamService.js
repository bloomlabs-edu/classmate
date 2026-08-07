/**
 * services/teamService.js
 *
 * Operations on the Teams that belong to a single Classroom. Teams live
 * nested inside `classroom.teams` (see models/Team.js), so every function
 * here takes the classroom it should operate on rather than holding its
 * own module-level list.
 */

import { createTeam } from '../models/Team.js';
import { getDefaultGroupColor } from '../config/groupColorConfig.js';
import * as studentService from './studentService.js';
import { getNetPoints } from './timelineService.js';

export function getTeamById(classroom, teamId) {
  return classroom.teams.find((team) => team.id === teamId) || null;
}

/** New teams get the next default colour in rotation (see config/groupColorConfig.js). */
export function addTeam(classroom, name) {
  const team = createTeam({ name, color: getDefaultGroupColor(classroom.teams.length) });
  classroom.teams.push(team);
  return team;
}

export function renameTeam(classroom, teamId, newName) {
  const team = getTeamById(classroom, teamId);
  if (team) team.name = newName;
  return team;
}

export function updateTeamColor(classroom, teamId, colorId) {
  const team = getTeamById(classroom, teamId);
  if (team) team.color = colorId;
  return team;
}

export function removeTeam(classroom, teamId) {
  const before = classroom.teams.length;
  classroom.teams = classroom.teams.filter((team) => team.id !== teamId);
  return classroom.teams.length < before;
}

/**
 * Deletes a Group without ever deleting the students in it — every
 * student is moved to `destinationTeamId` first (Ungrouped, or
 * another real group the teacher picked), and only then is the now-
 * empty group actually removed. Returns false without changing
 * anything if the group or destination doesn't exist, or if a teacher
 * somehow targets a group as its own destination.
 */
export function removeTeamAndRelocateStudents(classroom, teamId, destinationTeamId) {
  if (teamId === destinationTeamId) return false;
  const team = getTeamById(classroom, teamId);
  const destination = getTeamById(classroom, destinationTeamId);
  if (!team || !destination) return false;

  // Move from the end backward so splicing doesn't skip students —
  // moveStudentToTeam mutates team.students in place.
  [...team.students].forEach((student) => {
    studentService.moveStudentToTeam(classroom, teamId, student.id, destinationTeamId);
  });

  return removeTeam(classroom, teamId);
}

/**
 * A team's score is always derived from its students, never stored —
 * see models/Team.js for why.
 */
/** Per the platform-wide net-score rule (see services/timelineService.js's own getNetPoints()) — derived directly from history, never the potentially-stale student.score cache. */
export function getTeamScore(team) {
  return team.students.reduce((sum, student) => sum + getNetPoints(student), 0);
}
