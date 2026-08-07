/**
 * services/studentProgressService.js
 *
 * The application's derived-metrics layer — the single read-only source
 * for weekly/monthly stars, ranks, recognition winners, and
 * leaderboards. Consumes services/notebookService.js's
 * getStudentHistory() and each student's own `history` log (see
 * services/timelineService.js) and nothing else about their internal
 * shape — deliberate isolation, so either can change internally without
 * this file (or anything built on it) needing to change.
 *
 * PLATFORM-WIDE RULE: every star count and ranking anywhere in
 * ClassMate uses the NET score — positive minus negative — unless a
 * screen explicitly, visibly opts out (e.g. a "Recognition Wall"
 * showing only positive recognitions, clearly labeled as such).
 * getStarsInRange() below is the canonical, range-scoped
 * implementation of this rule — every ranking function in this file
 * (getRankInRange, getTeamStarsInRange, getTeamRankInRange,
 * getBiggestClimber, getLeaderboard) is built on top of it, so fixing
 * it once here fixes all of them at once. See
 * services/timelineService.js's own getNetPoints() for the all-time
 * (not range-scoped) equivalent.
 *
 * IMPORTANT: this service is read-only. It must never write to
 * Firestore, or mutate a classroom/student object — every function here
 * takes data in and returns a computed value out, nothing more.
 *
 *   Notebook Service + Timeline -> Student Progress Service -> Dashboard /
 *   Recognition / Leaderboards / Reports / Student Profile
 *
 * This file is safe to build against real production data today because
 * of one confirmed fact: services/studentService.js's resetAllScores()
 * (called by "Reset Session") only zeroes the score CACHE — it never
 * touches `student.history`, which is append-only and permanent. That's
 * what makes "historical weekly winners remain available" true without
 * any new storage: a "week" is just a date-range filter over data that
 * was never going away.
 *
 * ---------------------------------------------------------------------
 * Documented judgment calls (each a real product decision baked into
 * the math below — flagging them here rather than letting them hide):
 *
 *   - "Stars" means positive points only (kind: 'points', delta > 0) —
 *     mirrors services/timelineService.js's existing
 *     getTotalPositivePoints(), just scoped to a date range. Negative
 *     points (deductions) never count against a student's star total,
 *     matching this app's established visual language (stars are always
 *     a positive-only metric).
 *   - Ranking is standard "competition ranking": ties share a rank, and
 *     the next distinct value skips accordingly (1, 1, 3 — not 1, 1, 2).
 *     This is what makes "do not artificially break ties, celebrate
 *     co-winners" fall out naturally rather than needing special-case
 *     logic.
 *   - getLeaderboard() always returns the FULL ranked list, including
 *     students at zero — useful for a teacher browsing "who needs
 *     encouragement." getRecognitionWinners() additionally requires the
 *     winning value to be greater than zero, so an empty/brand-new
 *     classroom doesn't crown a "Star Performer" who earned nothing.
 *   - Biggest Climber only counts students with at least one history
 *     entry dated before the previous period even started — there's no
 *     enrollment-date field on Student to detect "joined this
 *     classroom mid-period" precisely, so a student's own earliest
 *     history entry is used as the closest available proxy. A student
 *     with zero prior history is excluded from climbing consideration
 *     entirely, rather than credited with an artificial climb from a
 *     baseline of zero.
 *   - Biggest Climber returns no winner at all if nobody's rank actually
 *     improved this period, rather than crowning whoever fell the least
 *     — this category is explicitly about rewarding real upward
 *     movement.
 *   - Longest Streak, when evaluated for "week" or "month", means the
 *     longest complete-in-a-row run that occurred within that date
 *     range specifically (naturally capped at ~7 or ~31) — not a
 *     student's all-time current streak. All-time longest streak still
 *     uses the same function with an unbounded range.
 * ---------------------------------------------------------------------
 */

import * as notebookService from './notebookService.js';
import * as notebookConfigService from './notebookConfigService.js';
import * as studentService from './studentService.js';
import {
  getTodayDateKey,
  getWeekRange,
  getPreviousWeekRange,
  getMonthRange,
  isDateKeyInRange,
} from '../utils/dateHelpers.js';
import { getRecognitionCategoryById } from '../config/recognitionCategories.js';

const ALL_TIME_RANGE = Object.freeze({ start: '0000-01-01', end: '9999-12-31' });

function getAllStudentsWithTeams(classroom) {
  return classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));
}

/** Standard competition ranking (ties share a rank; the next distinct value skips accordingly). Mutates and returns the sorted array. */
/**
 * Sorts descending by `valueKey`, assigning shared ranks for ties
 * (1, 1, 3, 4 — never 1, 1, 2, 3) — the standard competition-ranking
 * convention this app uses everywhere entities get ranked. Exported so
 * services/teamStatisticsService.js can reuse this exact logic for
 * all-time, net-score ranking rather than duplicating it — this
 * function itself has no opinion about what "value" means; callers
 * decide whether that's positive-only stars in a date range (this
 * file's own use) or net, all-time score (teamStatisticsService.js's).
 */
export function rankDescending(entries, valueKey) {
  const sorted = [...entries].sort((a, b) => b[valueKey] - a[valueKey]);

  let rank = 0;
  let previousValue = null;
  sorted.forEach((entry, index) => {
    if (entry[valueKey] !== previousValue) {
      rank = index + 1;
      previousValue = entry[valueKey];
    }
    entry.rank = rank;
  });

  return sorted;
}

// ---------------------------------------------------------------------
// Per-notebook metrics (prior-phase functions — unchanged)
// ---------------------------------------------------------------------

export function getCompletionPercent(classroom, subjectId, notebookTypeId, studentId) {
  const history = notebookService.getStudentHistory(classroom, subjectId, notebookTypeId, studentId);
  if (history.length === 0) return 0;

  const completeCount = history.filter((entry) => entry.completion === 'complete').length;
  return Math.round((completeCount / history.length) * 100);
}

/** Consecutive "complete" days ending on the most recent entry — breaks on anything else, including a gap in entries. */
export function getCurrentStreak(classroom, subjectId, notebookTypeId, studentId) {
  const history = notebookService.getStudentHistory(classroom, subjectId, notebookTypeId, studentId);

  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].completion === 'complete') {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

/** The longest run of consecutive "complete" entries anywhere in this student's history. */
export function getBestStreak(classroom, subjectId, notebookTypeId, studentId) {
  const history = notebookService.getStudentHistory(classroom, subjectId, notebookTypeId, studentId);

  let best = 0;
  let current = 0;
  history.forEach((entry) => {
    if (entry.completion === 'complete') {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  });
  return best;
}

/** The most recent date this student has any entry for this notebook, or null if never checked. */
export function getLastChecked(classroom, subjectId, notebookTypeId, studentId) {
  const history = notebookService.getStudentHistory(classroom, subjectId, notebookTypeId, studentId);
  return history.length > 0 ? history[history.length - 1].dateKey : null;
}

/** The longest complete-in-a-row run within {start, end} for one notebook — bounded, unlike getBestStreak. */
function getBestStreakInRangeForNotebook(classroom, subjectId, notebookTypeId, studentId, { start, end }) {
  const history = notebookService
    .getStudentHistory(classroom, subjectId, notebookTypeId, studentId)
    .filter((entry) => isDateKeyInRange(entry.dateKey, { start, end }));

  let best = 0;
  let current = 0;
  history.forEach((entry) => {
    if (entry.completion === 'complete') {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  });
  return best;
}

/** This student's best complete-in-a-row run, within {start, end}, across every configured notebook — used for Longest Streak recognition/leaderboard. */
export function getBestActiveStreakAcrossNotebooksInRange(classroom, studentId, { start, end }) {
  let best = 0;
  notebookConfigService.listSubjects(classroom).forEach((subject) => {
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      best = Math.max(best, getBestStreakInRangeForNotebook(classroom, subject.id, notebookType.id, studentId, { start, end }));
    });
  });
  return best;
}

/** This student's current active streak (right now), across every configured notebook — the highest of getCurrentStreak() over every notebook type. Used by Student Profile-style "how's this student doing right now" displays, not by period-scoped recognition. */
export function getBestActiveStreakAcrossNotebooks(classroom, studentId) {
  let best = 0;
  notebookConfigService.listSubjects(classroom).forEach((subject) => {
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      best = Math.max(best, getCurrentStreak(classroom, subject.id, notebookType.id, studentId));
    });
  });
  return best;
}

/** Aggregate completion % across every configured notebook, within {start, end} — null if this student has no entries in range at all (excluded from ranking, rather than shown at a misleading 0%). */
export function getOverallNotebookCompletionInRange(classroom, studentId, { start, end }) {
  let totalEntries = 0;
  let completeEntries = 0;

  notebookConfigService.listSubjects(classroom).forEach((subject) => {
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      const history = notebookService
        .getStudentHistory(classroom, subject.id, notebookType.id, studentId)
        .filter((entry) => isDateKeyInRange(entry.dateKey, { start, end }));

      totalEntries += history.length;
      completeEntries += history.filter((entry) => entry.completion === 'complete').length;
    });
  });

  return totalEntries === 0 ? null : Math.round((completeEntries / totalEntries) * 100);
}

/** Students whose every entry within {start, end}, across every configured notebook, was 'complete' — requires at least one entry to qualify. */
export function getPerfectNotebookStudents(classroom, { start, end }) {
  return getAllStudentsWithTeams(classroom)
    .map(({ student }) => ({
      studentId: student.id,
      studentName: student.name,
      completionPercent: getOverallNotebookCompletionInRange(classroom, student.id, { start, end }),
    }))
    .filter((entry) => entry.completionPercent === 100);
}

// ---------------------------------------------------------------------
// Stars (points), week/month scoped
// ---------------------------------------------------------------------

/** Sum of this student's positive points logged within {start, end} — "stars" excludes deductions by design (see file header). */
/**
 * A student's own NET star total within {start, end} — positive minus
 * negative, per the platform-wide rule that every star count and
 * ranking uses net score unless a screen explicitly, visibly opts out
 * (see this file's own module header). Previously filtered to
 * `entry.delta > 0` only — confirmed and fixed: that filter meant
 * Weekly Snapshot, Team Champion, Biggest Climber, and the Weekly
 * Leaderboard (every one of them routes through this function, via
 * getRankInRange()/getTeamStarsInRange()/getLeaderboard()) were all
 * ranking on positive-only totals, not the net score the rest of the
 * platform already uses.
 */
export function getStarsInRange(classroom, studentId, { start, end }) {
  const found = studentService.findStudentInClassroom(classroom, studentId);
  if (!found) return 0;

  return (found.student.history || [])
    .filter((entry) => entry.kind === 'points')
    .filter((entry) => isDateKeyInRange(entry.recordedAt.slice(0, 10), { start, end }))
    .reduce((sum, entry) => sum + entry.delta, 0);
}

/** Every student's star total within {start, end}, ranked (ties share a rank). The full list — see getRecognitionWinners() for "who actually won." */
export function getRankInRange(classroom, { start, end }) {
  const withStars = getAllStudentsWithTeams(classroom).map(({ student, team }) => ({
    studentId: student.id,
    studentName: student.name,
    teamId: team.id,
    stars: getStarsInRange(classroom, student.id, { start, end }),
  }));

  return rankDescending(withStars, 'stars');
}

/** Sum of every student's stars on one team, within {start, end} — for Team Champion. */
export function getTeamStarsInRange(classroom, teamId, { start, end }) {
  const team = classroom.teams.find((t) => t.id === teamId);
  if (!team) return 0;
  return team.students.reduce((sum, student) => sum + getStarsInRange(classroom, student.id, { start, end }), 0);
}

/** Every team's star total within {start, end}, ranked — for the Team Champion category/leaderboard. */
export function getTeamRankInRange(classroom, { start, end }) {
  const withStars = classroom.teams.map((team) => ({
    teamId: team.id,
    teamName: team.name,
    stars: getTeamStarsInRange(classroom, team.id, { start, end }),
  }));

  return rankDescending(withStars, 'stars');
}

/** Every student's best complete-in-a-row streak within {start, end}, ranked — for the Longest Learning Streak category/leaderboard. */
export function getStreakRankInRange(classroom, { start, end }) {
  const withStreaks = getAllStudentsWithTeams(classroom).map(({ student, team }) => ({
    studentId: student.id,
    studentName: student.name,
    teamId: team.id,
    streak: getBestActiveStreakAcrossNotebooksInRange(classroom, student.id, { start, end }),
  }));

  return rankDescending(withStreaks, 'streak');
}

/** Every student's overall notebook completion % within {start, end}, ranked — students with no notebook activity in range are excluded entirely (see getOverallNotebookCompletionInRange). */
export function getNotebookCompletionRankInRange(classroom, { start, end }) {
  const withCompletion = getAllStudentsWithTeams(classroom)
    .map(({ student, team }) => ({
      studentId: student.id,
      studentName: student.name,
      teamId: team.id,
      completionPercent: getOverallNotebookCompletionInRange(classroom, student.id, { start, end }),
    }))
    .filter((entry) => entry.completionPercent !== null);

  return rankDescending(withCompletion, 'completionPercent');
}

// ---------------------------------------------------------------------
// Biggest Climber (progress, not achievement — see file header)
// ---------------------------------------------------------------------

function studentHasHistoryBefore(classroom, studentId, dateKey) {
  const found = studentService.findStudentInClassroom(classroom, studentId);
  if (!found) return false;
  return (found.student.history || []).some((entry) => entry.recordedAt.slice(0, 10) < dateKey);
}

/**
 * Whoever's star rank improved the most from {previousRange} to
 * {currentRange} — returns every student tied for the biggest
 * improvement (co-winners), or an empty array if nobody actually
 * climbed this period. Star total this period is the secondary
 * tie-breaker, per the product decision that rank movement (not raw
 * star totals) is the primary measure of improvement.
 */
export function getBiggestClimber(classroom, { currentRange, previousRange }) {
  const currentRanks = getRankInRange(classroom, currentRange);
  const previousRanks = getRankInRange(classroom, previousRange);
  const previousRankByStudentId = new Map(previousRanks.map((entry) => [entry.studentId, entry]));

  const climbers = currentRanks
    .map((current) => {
      const previous = previousRankByStudentId.get(current.studentId);
      // Checked against currentRange.start (not previousRange.start): the
      // question is "did this student have any tracked activity before
      // THIS period began" — if their earliest-ever entry happens to
      // fall exactly on the previous period's first day, that's
      // legitimate prior history, not a brand-new student. Requiring
      // history strictly before the previous period's start would wrongly
      // exclude exactly that case.
      if (!previous || !studentHasHistoryBefore(classroom, current.studentId, currentRange.start)) return null;

      return {
        studentId: current.studentId,
        studentName: current.studentName,
        teamId: current.teamId,
        previousRank: previous.rank,
        currentRank: current.rank,
        movement: previous.rank - current.rank, // positive = climbed
        stars: current.stars,
      };
    })
    .filter(Boolean)
    .filter((entry) => entry.movement > 0);

  if (climbers.length === 0) return [];

  const maxMovement = Math.max(...climbers.map((entry) => entry.movement));
  const topMovers = climbers.filter((entry) => entry.movement === maxMovement);

  if (topMovers.length === 1) return topMovers;

  const maxStars = Math.max(...topMovers.map((entry) => entry.stars));
  return topMovers.filter((entry) => entry.stars === maxStars);
}

// ---------------------------------------------------------------------
// Recognition / Leaderboard dispatch — the single entry point Phases
// 2 and 3 (Dashboard, Recognition screen) should use, rather than
// calling the metric-specific functions above directly.
// ---------------------------------------------------------------------

function resolveRangeForPeriod(period) {
  const today = getTodayDateKey();
  if (period === 'week') return getWeekRange(today);
  if (period === 'month') return getMonthRange(today);
  return ALL_TIME_RANGE;
}

function resolvePreviousRangeForPeriod(period) {
  const today = getTodayDateKey();
  if (period === 'week') return getPreviousWeekRange(today);
  if (period === 'month') {
    const [year, month] = today.split('-').map(Number);
    const previousMonthDate = new Date(year, month - 2, 1); // one calendar month before the current one
    const previousMonthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}-01`;
    return getMonthRange(previousMonthKey);
  }
  return null; // biggest_climber never declares 'all_time' as a valid period — see config/recognitionCategories.js
}

const VALUE_KEY_BY_RESOLVER = Object.freeze({
  stars: 'stars',
  streak: 'streak',
  notebook_completion: 'completionPercent',
  team_stars: 'stars',
});

/** The full ranked list for one recognition category/period — always includes zero-value entries, for teachers browsing "who needs encouragement." */
export function getLeaderboard(classroom, categoryId, period) {
  const category = getRecognitionCategoryById(categoryId);
  if (!category || !category.periods.includes(period)) return [];

  const range = resolveRangeForPeriod(period);

  switch (category.resolverId) {
    case 'stars':
      return getRankInRange(classroom, range);
    case 'streak':
      return getStreakRankInRange(classroom, range);
    case 'notebook_completion':
      return getNotebookCompletionRankInRange(classroom, range);
    case 'team_stars':
      return getTeamRankInRange(classroom, range);
    case 'biggest_climber': {
      const previousRange = resolvePreviousRangeForPeriod(period);
      return previousRange ? getBiggestClimber(classroom, { currentRange: range, previousRange }) : [];
    }
    default:
      return [];
  }
}

/**
 * Whoever actually won this category/period — rank-1 ties all included
 * (co-winners, never artificially broken), and excluded entirely if the
 * winning value is zero (an empty/brand-new classroom shouldn't crown a
 * "Star Performer" who earned nothing). Biggest Climber's leaderboard is
 * already just the winners (see getBiggestClimber), so it's returned as-is.
 */
export function getRecognitionWinners(classroom, categoryId, period) {
  const category = getRecognitionCategoryById(categoryId);
  if (!category) return [];

  if (category.resolverId === 'biggest_climber') {
    return getLeaderboard(classroom, categoryId, period);
  }

  const leaderboard = getLeaderboard(classroom, categoryId, period);
  const valueKey = VALUE_KEY_BY_RESOLVER[category.resolverId];

  return leaderboard.filter((entry) => entry.rank === 1 && (!valueKey || entry[valueKey] > 0));
}
