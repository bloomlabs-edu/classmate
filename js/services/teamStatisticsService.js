/**
 * services/teamStatisticsService.js
 *
 * Owns exactly one kind of computation: ranking teams and students by
 * their real, net score within a given period — nothing is ever
 * persisted, every number is derived fresh from the classroom
 * snapshot each call.
 *
 * Built around one generic `period` shape — `{ start, end }`, two
 * "YYYY-MM-DD" date keys, inclusive — rather than separate
 * month-specific functions. This milestone only ever calls
 * getCurrentMonthPeriod(), but every ranking function below takes a
 * period as a plain parameter, so a future week view, a past month's
 * archive, or an all-time view (a period wide enough to cover
 * everything) all reuse these exact same functions — no new ranking
 * logic, ever, just a different period passed in.
 *
 * Deliberately derives from `student.history`, never `student.score`.
 * `student.score` is documented (see services/timelineService.js) as
 * a derived cache, not the source of truth, and the existing "Reset
 * Session" action (services/studentService.js's resetAllScores())
 * zeroes that cache while leaving `history` completely untouched —
 * meaning `score` can silently desync from the real record at any
 * time, by design. Every number here is instead a live sum over
 * `history` entries whose `recordedAt` falls within the given period,
 * net (both positive and negative points count) — mirroring the exact
 * "history is permanent, a period is just a date-range filter over
 * data that never goes away" principle
 * services/studentProgressService.js's own weekly/monthly star
 * calculations already prove out in production, just without that
 * file's own positive-only ("stars") restriction, since standings
 * need true net performance, not recognition received.
 *
 * Ungrouped is excluded from every team-level ranking here, matching
 * the same exclusion services/classroomService.js's own
 * getOrCreateUngroupedTeam() establishes and GroupsWidget.js/
 * studentPortalDataService.js's getTeamSummary() already apply. A
 * student inside it is still fully included in the class-wide
 * leaderboard, since they're a real student regardless of grouping.
 *
 * Reuses studentProgressService.js's own rankDescending() (exported
 * specifically for this reuse) for the shared-rank-on-ties sort every
 * leaderboard in this app already uses.
 */

import { rankDescending } from './studentProgressService.js';
import { getMonthRange, getTodayDateKey, isDateKeyInRange } from '../utils/dateHelpers.js';

/** The live, current calendar month — the only period this milestone actually uses. Not a teacher-managed concept, not stored anywhere: "the current month" is simply a fact about today's date, so there is nothing to create, close, or migrate. */
export function getCurrentMonthPeriod() {
  return getMonthRange(getTodayDateKey());
}

function getRealTeams(classroom) {
  return classroom.teams.filter((team) => !team.isUngrouped);
}

/** Net point total for one student within a period — both positive and negative entries count, unlike studentProgressService.js's own "stars" (positive-only) convention. */
function getStudentScoreInPeriod(student, period) {
  return (student.history || [])
    .filter((entry) => entry.kind === 'points')
    .filter((entry) => isDateKeyInRange(entry.recordedAt.slice(0, 10), period))
    .reduce((sum, entry) => sum + entry.delta, 0);
}

function getTeamScoreInPeriod(team, period) {
  return team.students.reduce((sum, student) => sum + getStudentScoreInPeriod(student, period), 0);
}

/** Every real team, ranked by net score within `period`, highest first — ties share a rank. Plain ranking only; see getTeamStandingsWithMovement() for the richer, movement-enriched version the shared standings board actually uses. */
export function getTeamStandings(classroom, period) {
  const withScores = getRealTeams(classroom).map((team) => ({
    teamId: team.id,
    teamName: team.name,
    score: getTeamScoreInPeriod(team, period),
  }));

  return rankDescending(withScores, 'score');
}

/** One team's own members, ranked by their own net score within `period`, highest first. Plain ranking only; see getTeamLeaderboardWithMovement() for the richer version. */
export function getTeamLeaderboard(classroom, teamId, period) {
  const team = classroom.teams.find((t) => t.id === teamId);
  if (!team) return [];

  const withScores = team.students.map((student) => ({
    studentId: student.id,
    studentName: student.name,
    score: getStudentScoreInPeriod(student, period),
  }));

  return rankDescending(withScores, 'score');
}

/** Every student in the classroom, across every team (Ungrouped included), ranked by net score within `period`, highest first. Plain ranking only; see getClassLeaderboardWithMovement() for the richer version. */
export function getClassLeaderboard(classroom, period) {
  const withScores = classroom.teams.flatMap((team) =>
    team.students.map((student) => ({
      studentId: student.id,
      studentName: student.name,
      teamId: team.id,
      teamName: team.name,
      score: getStudentScoreInPeriod(student, period),
    }))
  );

  return rankDescending(withScores, 'score');
}

/** This student's own rank within `period`, or null if not found. */
export function getStudentRank(classroom, studentId, period) {
  const entry = getClassLeaderboard(classroom, period).find((e) => e.studentId === studentId);
  return entry ? entry.rank : null;
}

/** This team's own standings rank within `period`, or null if not found (including the Ungrouped team, which never appears in getTeamStandings()). */
export function getTeamRank(classroom, teamId, period) {
  const entry = getTeamStandings(classroom, period).find((e) => e.teamId === teamId);
  return entry ? entry.rank : null;
}

/**
 * Baseline resolvers for the "WithMovement" functions below — each
 * takes the current `period` and returns the *comparison* period to
 * measure movement against. Kept as small, separate, swappable
 * functions rather than one hardcoded choice, so a future comparison
 * strategy (e.g. "since last week," inside a still-ongoing month) is
 * a new function here, never a change to the "WithMovement"
 * functions themselves.
 */
export const MOVEMENT_BASELINES = {
  /**
   * Cumulative standings through the end of this period's own first
   * day — a *fixed* baseline that never moves for the rest of the
   * period, giving a stable "have you climbed since this competition
   * began" signal. This is the one this milestone actually uses, per
   * explicit product decision: a month-long competition should read
   * as a season, not a daily scoreboard flip that degenerates into
   * "everyone shows same" after a day or two.
   */
  sincePeriodStart(period) {
    return { start: period.start, end: period.start };
  },
};

/** Attaches previousRank/movement/movementAmount to every entry in `currentEntries`, comparing each against its own rank in `baselineEntries` (matched by `idKey`) — the one comparison implementation every "WithMovement" function below shares. */
function attachMovement(currentEntries, baselineEntries, idKey) {
  return currentEntries.map((entry) => {
    const baselineEntry = baselineEntries.find((b) => b[idKey] === entry[idKey]);
    const previousRank = baselineEntry ? baselineEntry.rank : entry.rank;
    const movementAmount = Math.abs(previousRank - entry.rank);
    let movement = 'same';
    if (previousRank > entry.rank) movement = 'up';
    else if (previousRank < entry.rank) movement = 'down';
    return { ...entry, previousRank, movement, movementAmount };
  });
}

/**
 * getTeamStandings(), with every entry additionally carrying
 * `previousRank`, `movement` ('up' | 'down' | 'same'), and
 * `movementAmount` (a non-negative count of positions gained or
 * lost) — comparing each team's rank right now against its own rank
 * at `getBaseline(period)` (defaults to
 * MOVEMENT_BASELINES.sincePeriodStart — see that function's own
 * comment for why a fixed, whole-period anchor was chosen over a
 * rolling day-to-day one). The shared standings board (see Milestone
 * B) decides how to render this (↑2, ↓1, →, colors, animations) —
 * this function only ever hands back the plain facts.
 *
 * On the very first day of a new period, the baseline period and the
 * current period are identical, so every team naturally ties and
 * correctly shows 'same' — there is no real prior standing yet to
 * have moved from.
 */
export function getTeamStandingsWithMovement(classroom, period, getBaseline = MOVEMENT_BASELINES.sincePeriodStart) {
  const current = getTeamStandings(classroom, period);
  const baseline = getTeamStandings(classroom, getBaseline(period));
  return attachMovement(current, baseline, 'teamId');
}

/** getTeamLeaderboard(), enriched with previousRank/movement/movementAmount the same way getTeamStandingsWithMovement() is — see that function's own comment for the exact semantics. */
export function getTeamLeaderboardWithMovement(classroom, teamId, period, getBaseline = MOVEMENT_BASELINES.sincePeriodStart) {
  const current = getTeamLeaderboard(classroom, teamId, period);
  const baseline = getTeamLeaderboard(classroom, teamId, getBaseline(period));
  return attachMovement(current, baseline, 'studentId');
}

/** getClassLeaderboard(), enriched with previousRank/movement/movementAmount the same way getTeamStandingsWithMovement() is — see that function's own comment for the exact semantics. */
export function getClassLeaderboardWithMovement(classroom, period, getBaseline = MOVEMENT_BASELINES.sincePeriodStart) {
  const current = getClassLeaderboard(classroom, period);
  const baseline = getClassLeaderboard(classroom, getBaseline(period));
  return attachMovement(current, baseline, 'studentId');
}
