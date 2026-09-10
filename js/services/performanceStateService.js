/**
 * services/performanceStateService.js
 *
 * Computes the Class Mode name-highlight state ('climbing' | 'redemption' |
 * null) that ui/components/ClassModeStudentRow.js paints as a compact pill
 * directly behind a student's name — the performance/behaviour layer that
 * sits above the bucket colour (group/level) and below the score/stars/
 * movement badge (raw data). See docs/CLASSMATE_ARCHITECTURE_CURRENT_STATE.md
 * for where this fits; there is no separate design doc, since the whole
 * feature is this one small file plus the rendering it feeds.
 *
 * "Climber" is deliberately NOT recomputed here — it reuses whatever
 * `movement === 'up'` value
 * services/teamStatisticsService.js's own getClassLeaderboardWithMovement()
 * already produced for this exact row's own ▲/▼/→ badge (see
 * ui/components/TeamStandingsBoard.js, which computes it once and hands it
 * to both this function and the movement badge). There is no second,
 * competing definition of "climbing" anywhere in this file.
 *
 * Redemption, by contrast, has no existing equivalent anywhere in the app
 * (no weekly negative-count concept, no "5 stars in a day" concept, no
 * persisted per-student state machine) — this file is the smallest new
 * piece needed, deliberately built the same way every other derived stat
 * in this app is: a pure function over `student.history`, which is already
 * a permanent, append-only, never-pruned log (see
 * services/studentProgressService.js's own header comment). Recomputing
 * redemption status from history on every read means it needs no new
 * Student field, no migration for existing students, and — the actual
 * requirement — automatically survives a page refresh, navigating away, or
 * a new week starting, for exactly the same reason "last week's stars"
 * already does: nothing about it is stored anywhere except the history
 * entries that were always being saved anyway.
 *
 * The redemption rule (§ "Redemption requirement" in the brief this was
 * built against): once a student's NEGATIVE points in a single Monday-start
 * week exceed NEGATIVE_THRESHOLD, they enter redemption. Redemption is
 * "sticky" — it does not clear just because the current week's negative
 * count later drops back at or below the threshold. It only clears once
 * the student has strung together REDEMPTION_CONSECUTIVE_DAYS calendar
 * days in a row, each with at least REDEMPTION_DAILY_STAR_TARGET *positive*
 * points earned that day. This "5-star day" reading is an explicit
 * assumption, not something already defined elsewhere: this app has no
 * existing 1-5 rating concept, so "consistent 5 stars" is interpreted as
 * "earn at least 5 stars in a day," repeated on consecutive days. If a
 * fresh breach happens while already in redemption (a relapse), the
 * in-progress consecutive-day count resets — a relapse restarts the
 * countdown rather than being ignored because "already in redemption."
 * Completing redemption returns a student to the neutral state, never
 * straight to green — the "climbing" check above is entirely independent
 * and must separately be true for the green pill to reappear.
 */

import { getMondayStartOfWeek, shiftDateKey, getTodayDateKey } from '../utils/dateHelpers.js';

export const NEGATIVE_THRESHOLD = 3;
export const REDEMPTION_DAILY_STAR_TARGET = 5;
export const REDEMPTION_CONSECUTIVE_DAYS = 3;

/**
 * Whether `student` is currently in the sticky red/redemption state, as of
 * `todayDateKey` (defaults to today; a parameter purely so this stays
 * testable without mocking the system clock). Walks every calendar day from
 * the student's very first history entry through today exactly once —
 * O(days elapsed), not O(weeks × history) — tracking the current week's
 * running negative total and, while in redemption, the current streak of
 * "at least REDEMPTION_DAILY_STAR_TARGET positive points" days.
 */
export function isStudentInRedemption(student, todayDateKey = getTodayDateKey()) {
  const pointEntries = (student.history || []).filter((entry) => entry.kind === 'points');
  if (pointEntries.length === 0) return false;

  const entriesByDay = new Map();
  let firstDay = pointEntries[0].recordedAt.slice(0, 10);
  for (const entry of pointEntries) {
    const day = entry.recordedAt.slice(0, 10);
    if (day < firstDay) firstDay = day;
    if (!entriesByDay.has(day)) entriesByDay.set(day, []);
    entriesByDay.get(day).push(entry);
  }
  if (firstDay > todayDateKey) return false;

  let inRedemption = false;
  let goodStreak = 0;
  let currentWeekStart = null;
  let currentWeekNegatives = 0;
  let weekAlreadyTripped = false;

  for (let day = firstDay; day <= todayDateKey; day = shiftDateKey(day, 1)) {
    const weekStart = getMondayStartOfWeek(day);
    if (weekStart !== currentWeekStart) {
      currentWeekStart = weekStart;
      currentWeekNegatives = 0;
      weekAlreadyTripped = false;
    }

    const dayEntries = entriesByDay.get(day) || [];
    const negativeToday = dayEntries.filter((entry) => entry.delta < 0).reduce((sum, entry) => sum + Math.abs(entry.delta), 0);
    currentWeekNegatives += negativeToday;

    if (currentWeekNegatives > NEGATIVE_THRESHOLD && !weekAlreadyTripped) {
      weekAlreadyTripped = true;
      inRedemption = true;
      goodStreak = 0;
    }

    if (inRedemption) {
      const positiveToday = dayEntries.filter((entry) => entry.delta > 0).reduce((sum, entry) => sum + entry.delta, 0);
      goodStreak = positiveToday >= REDEMPTION_DAILY_STAR_TARGET ? goodStreak + 1 : 0;
      if (goodStreak >= REDEMPTION_CONSECUTIVE_DAYS) {
        inRedemption = false;
        goodStreak = 0;
      }
    }
  }

  return inRedemption;
}

/**
 * The single name-highlight state ClassModeStudentRow paints behind a
 * student's name: 'redemption' (red, overrides everything else) |
 * 'climbing' (green) | null (neutral, no pill). `isClimber` is the caller's
 * own already-computed `movement === 'up'` value (see this file's own
 * header comment for why it is never recomputed here).
 */
export function getNameHighlightState(student, { isClimber = false, todayDateKey = getTodayDateKey() } = {}) {
  if (isStudentInRedemption(student, todayDateKey)) return 'redemption';
  if (isClimber) return 'climbing';
  return null;
}
