/**
 * services/goalStatisticsService.js
 *
 * Every number here is computed fresh, every call, directly from
 * goalCompletionService.js's own raw completion history — nothing is
 * ever cached or stored, per explicit product decision ("statistics
 * should always be computed from completion records"). Mirrors
 * studentProgressService.js's own streak algorithm exactly (walk a
 * sorted history, count consecutive entries), reimplemented here
 * rather than imported from it, since that service is scoped to
 * Notebook Tracker specifically — Goals is its own domain, per this
 * project's own "keep responsibilities separated" instruction, not a
 * caller of Notebook Tracker's logic.
 *
 * All functions take one Goal (via its `goalId`), not a student —
 * matching how a Goal already belongs to exactly one student and
 * category; a caller wanting a student's overall picture calls these
 * once per goal returned by goalService.getGoalsForStudent() and
 * combines the results itself (see the teacher dashboard's own
 * per-student aggregate, which does exactly this).
 */

import { getCompletionHistory } from './goalCompletionService.js';
import { getTodayDateKey, getWeekRange, isDateKeyInRange } from '../utils/dateHelpers.js';

function shiftBack(dateKey, days) {
  const date = new Date(dateKey);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Consecutive completed days ending on the most recent entry — zero if the most recent entry isn't today or yesterday (a stale, long-past run shouldn't still read as an active streak). Mirrors studentProgressService.js's getCurrentStreak() shape. */
export function getCurrentStreak(cycle, goalId) {
  const history = getCompletionHistory(cycle, goalId);
  if (history.length === 0) return 0;

  const today = getTodayDateKey();
  const mostRecent = history[history.length - 1];
  const daysSinceMostRecent = Math.round((new Date(today) - new Date(mostRecent)) / 86400000);
  if (daysSinceMostRecent > 1) return 0;

  let streak = 1;
  for (let i = history.length - 1; i > 0; i--) {
    if (shiftBack(history[i], 1) === history[i - 1]) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

/** The longest run of consecutive completed days anywhere in this goal's history. Mirrors studentProgressService.js's getBestStreak() exactly. */
export function getLongestStreak(cycle, goalId) {
  const history = getCompletionHistory(cycle, goalId);

  let best = 0;
  let current = 0;
  let previousDate = null;
  history.forEach((dateKey) => {
    current = previousDate && shiftBack(dateKey, 1) === previousDate ? current + 1 : 1;
    best = Math.max(best, current);
    previousDate = dateKey;
  });
  return best;
}

export function isCompletedToday(cycle, goalId) {
  return getCompletionHistory(cycle, goalId).includes(getTodayDateKey());
}

/** Completion % within the current week (Monday-Sunday), against however many days of the week have actually elapsed so far — not the full 7, so a Tuesday isn't measured against days that haven't happened yet. */
export function getWeeklyCompletionPercent(cycle, goalId) {
  const range = getWeekRange();
  const today = getTodayDateKey();
  const daysElapsed = Math.round((new Date(today) - new Date(range.start)) / 86400000) + 1;

  const history = getCompletionHistory(cycle, goalId).filter((dateKey) => isDateKeyInRange(dateKey, range));
  return daysElapsed > 0 ? Math.round((history.length / daysElapsed) * 100) : 0;
}

/** Overall completion % since the goal's own cycle started — against the cycle's own elapsed days (start through today, or through the cycle's own end date once it has closed), not raw history length, so a goal isn't penalized for days before its cycle began. */
export function getOverallCompletionPercent(cycle, goalId) {
  const today = getTodayDateKey();
  const effectiveEnd = cycle.endDate && cycle.endDate < today ? cycle.endDate : today;
  const totalDays = Math.max(1, Math.round((new Date(effectiveEnd) - new Date(cycle.startDate)) / 86400000) + 1);

  const history = getCompletionHistory(cycle, goalId).filter((dateKey) => dateKey >= cycle.startDate && dateKey <= effectiveEnd);
  return Math.round((history.length / totalDays) * 100);
}

/**
 * One student's aggregate picture across every goal they have in this
 * cycle — exactly the shape the teacher dashboard's own table needs
 * (Today X/Y, best current streak, overall completion %). Deliberately
 * a service-level function, not view logic, the same "computed,
 * testable, reusable" principle every other statistic in this file
 * follows — the view only ever renders what this returns, never
 * computes anything itself.
 */
export function getStudentSummary(cycle, student, categoryCount) {
  const goals = cycle.goals.filter((goal) => goal.studentId === student.id);

  const todayCompletedCount = goals.filter((goal) => isCompletedToday(cycle, goal.id)).length;
  const bestCurrentStreak = goals.reduce((best, goal) => Math.max(best, getCurrentStreak(cycle, goal.id)), 0);
  const overallCompletionPercent =
    goals.length > 0
      ? Math.round(goals.reduce((sum, goal) => sum + getOverallCompletionPercent(cycle, goal.id), 0) / goals.length)
      : 0;

  return {
    studentId: student.id,
    studentName: student.name,
    todayCompletedCount,
    totalCategories: categoryCount,
    bestCurrentStreak,
    overallCompletionPercent,
  };
}
