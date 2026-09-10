/**
 * services/weeklyReportService.js
 *
 * Weekly Reports — a permanent, week-by-week record of the classroom's
 * achievements. Deliberately a THIN orchestration layer, not a second
 * calculation engine: every number here comes from
 * services/studentProgressService.js's own Recognition dispatch
 * (getRecognitionWinners(), generalized with an anchor date for exactly
 * this feature — see that function's own comment) and
 * services/teamStatisticsService.js's own team/student standings
 * (getTeamStandingsWithMovement()/getClassLeaderboardWithMovement(),
 * which already accept an arbitrary {start, end} period and needed no
 * changes at all). Nothing in this file is a new ranking rule.
 *
 * NO SNAPSHOT — this is the whole point. "A week is just a date-range
 * filter over data that never resets" (see studentProgressService.js's
 * own header comment): the Monday Reset Scoreboard action
 * (services/scoreboardArchiveService.js) only ever zeroes the LIVE
 * `score` cache and starts a new scoring period — it has never touched
 * `student.history`, which is what every function this file calls
 * actually reads. A past week's report is therefore always
 * reconstructable for as long as `student.history` exists, with no
 * separate historical store to keep in sync.
 *
 * Weeks are Monday-start, matching every other weekly calculation in
 * this app (utils/dateHelpers.js's own getMondayStartOfWeek()). The
 * data range for recognitions/standings is the standard Monday–Sunday
 * week (getWeekRange()/getPreviousWeekRange() — the same range Star
 * Performer, Team Champion, etc. have always used for "this week").
 * The display LABEL ("This Week" / "Last Week" / "Aug 24–28") reuses
 * utils/dateHelpers.js's own getWeekLabel() verbatim — the same one
 * ui/components/WeeklyNetPointsGraph.js's own week-navigation already
 * uses, deliberately kept to its existing Monday–Friday school-week
 * span for that label's text, which is a separate concern from the
 * Monday–Sunday data range above.
 */

import * as studentProgressService from './studentProgressService.js';
import { listRecognitionCategoriesForPeriod } from '../config/recognitionCategories.js';
import { getMondayStartOfWeek, getTodayDateKey, shiftDateKey, getWeekLabel } from '../utils/dateHelpers.js';

/**
 * Every navigable week's own Monday key, newest (current week) first,
 * back through the earliest week any student in this classroom has
 * recorded history — the classroom-wide equivalent of
 * ui/components/WeeklyNetPointsGraph.js's own per-student navigation
 * bound. The current week is always included, even for a brand-new
 * classroom with no history at all yet (matching the existing
 * app-wide convention that the current, still-unfolding week is
 * always a valid thing to look at).
 */
export function getNavigableWeekStarts(classroom, todayDateKey = getTodayDateKey()) {
  const currentWeekStart = getMondayStartOfWeek(todayDateKey);
  const earliestWeekStart = studentProgressService.getEarliestClassroomActivityWeekStart(classroom);
  const startBound = earliestWeekStart && earliestWeekStart < currentWeekStart ? earliestWeekStart : currentWeekStart;

  const weekStarts = [];
  for (let weekStart = currentWeekStart; weekStart >= startBound; weekStart = shiftDateKey(weekStart, -7)) {
    weekStarts.push(weekStart);
  }
  return weekStarts;
}

/**
 * Navigation facts for one selected week — bounds, label, and whether
 * it's the current week. `weekAnchorDateKey` may be any date within
 * the desired week (normalized to that week's own Monday); omitted
 * (or falsy) defaults to the current week, matching every other
 * "no selection yet" default already established in this app (Class
 * Mode's own weekly chart, Recognition's own period tabs).
 */
export function getWeekNavigationInfo(classroom, weekAnchorDateKey, todayDateKey = getTodayDateKey()) {
  const currentWeekStart = getMondayStartOfWeek(todayDateKey);
  const weekStart = weekAnchorDateKey ? getMondayStartOfWeek(weekAnchorDateKey) : currentWeekStart;
  const earliestWeekStart = studentProgressService.getEarliestClassroomActivityWeekStart(classroom);

  return {
    weekStart,
    weekLabel: getWeekLabel(weekStart, todayDateKey),
    isCurrentWeek: weekStart === currentWeekStart,
    canGoPrevious: earliestWeekStart !== null && weekStart > earliestWeekStart,
    canGoNext: weekStart < currentWeekStart,
    previousWeekStart: shiftDateKey(weekStart, -7),
    nextWeekStart: shiftDateKey(weekStart, 7),
  };
}

/**
 * The full Weekly Report for one week: navigation facts plus every
 * recognition category that supports the 'week' period (currently all
 * five: Star Performer, Longest Learning Streak, Notebook Champion,
 * Biggest Climber, Team Champion — see config/recognitionCategories.js),
 * each resolved against THIS week specifically via
 * getRecognitionWinners()'s own anchor-date parameter. Categories with
 * no winner this particular week are simply omitted (matching
 * ui/components/RecognitionWidget.js's own existing convention) rather
 * than rendered as an empty placeholder.
 */
export function getWeeklyReport(classroom, weekAnchorDateKey, todayDateKey = getTodayDateKey()) {
  const navigation = getWeekNavigationInfo(classroom, weekAnchorDateKey, todayDateKey);

  const recognitions = listRecognitionCategoriesForPeriod('week')
    .map((category) => ({
      category,
      winners: studentProgressService.getRecognitionWinners(classroom, category.id, 'week', navigation.weekStart),
    }))
    .filter((entry) => entry.winners.length > 0);

  return { ...navigation, recognitions };
}
