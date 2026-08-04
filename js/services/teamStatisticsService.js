/**
 * services/teamStatisticsService.js
 *
 * Owns exactly one kind of computation: ranking teams and students by
 * their real, net, all-time score — nothing is ever persisted, every
 * number is derived fresh from the classroom snapshot each call.
 *
 * Deliberately narrow, per this project's own architecture review:
 * ranking (many entities -> an ordering) is a different shape of work
 * than public profile assembly (one entity -> its own public view),
 * and this service owns only the former. It has no opinion about who
 * is allowed to see a ranking, what a profile shows, or how a screen
 * navigates — it only answers "sorted by score, who's where."
 *
 * Reuses, rather than duplicates: teamService.getTeamScore() for a
 * team's own net score, and studentProgressService.js's own
 * rankDescending() (exported specifically for this reuse) for the
 * shared-rank-on-ties sort every leaderboard in this app already uses.
 * The one genuinely new piece here is ranking by net, all-time score
 * at all — every existing ranking function in
 * studentProgressService.js is date-range-scoped and positive-only
 * (built for Recognition Wall's "who earned the most this period"),
 * which can never represent a score that goes negative the way
 * student.score/getTeamScore() do.
 *
 * Ungrouped is excluded from every team-level ranking here, matching
 * the same exclusion services/classroomService.js's own
 * getOrCreateUngroupedTeam() establishes and GroupsWidget.js/
 * studentPortalDataService.js's getTeamSummary() already apply: it
 * isn't a group a teacher organized, so it doesn't belong in a
 * "standings" ranking of real teams. A student inside it is still
 * fully included in the class-wide leaderboard, since they're a real
 * student regardless of grouping.
 */

import * as teamService from './teamService.js';
import { rankDescending } from './studentProgressService.js';

function getRealTeams(classroom) {
  return classroom.teams.filter((team) => !team.isUngrouped);
}

/** Every real team, ranked by net score, highest first — ties share a rank. */
export function getTeamStandings(classroom) {
  const withScores = getRealTeams(classroom).map((team) => ({
    teamId: team.id,
    teamName: team.name,
    score: teamService.getTeamScore(team),
  }));

  return rankDescending(withScores, 'score');
}

/** One team's own members, ranked by their own net score, highest first. */
export function getTeamLeaderboard(classroom, teamId) {
  const team = classroom.teams.find((t) => t.id === teamId);
  if (!team) return [];

  const withScores = team.students.map((student) => ({
    studentId: student.id,
    studentName: student.name,
    score: student.score,
  }));

  return rankDescending(withScores, 'score');
}

/** Every student in the classroom, across every team (Ungrouped included — a real student regardless of grouping), ranked by net score, highest first. */
export function getClassLeaderboard(classroom) {
  const withScores = classroom.teams.flatMap((team) =>
    team.students.map((student) => ({
      studentId: student.id,
      studentName: student.name,
      teamId: team.id,
      teamName: team.name,
      score: student.score,
    }))
  );

  return rankDescending(withScores, 'score');
}

/** This student's own class-wide rank, or null if they're not found (e.g. a stale/deleted studentId). */
export function getStudentRank(classroom, studentId) {
  const entry = getClassLeaderboard(classroom).find((e) => e.studentId === studentId);
  return entry ? entry.rank : null;
}

/** This team's own standings rank, or null if it's not found or is the Ungrouped team (which never appears in getTeamStandings()). */
export function getTeamRank(classroom, teamId) {
  const entry = getTeamStandings(classroom).find((e) => e.teamId === teamId);
  return entry ? entry.rank : null;
}
