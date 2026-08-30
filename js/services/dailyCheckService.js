/**
 * services/dailyCheckService.js
 *
 * The 'daily' trackingMode counterpart to services/checkpointService.js
 * — owns DailyCheck records (see models/DailyCheck.js), the notebook's
 * own expected-checking-day rules, and streak calculation. Reusable
 * for any notebook type configured as 'daily' (English Handwriting is
 * the first real example, never a special case coded here by name).
 *
 * `classroom.dailyChecks` is never assumed present — defaulted at the
 * read/write boundary here, the same way workRequestService.js treats
 * `classroom.workRequests`, since this is a brand-new field on an app
 * with many already-deployed classrooms.
 *
 * Expected checking days — deliberately the smallest coherent
 * calendar-awareness this app has today (see this project's own
 * investigation: no classroom-level working-day/holiday concept
 * exists anywhere else to reuse). A day is an expected checking day
 * for a given 'daily' notebook type when BOTH:
 *   - it falls on a working weekday (Monday–Friday, this app's one
 *     fixed assumption — there is no per-classroom configurable
 *     working-week concept to read instead); AND
 *   - it is not in that notebook type's own dailySettings.excludedDates
 *     (the generic "holiday / no-check day" list — see
 *     models/NotebookType.js's own header comment for why this isn't
 *     hardcoded as "holiday" specifically).
 *
 * Streak semantics (per explicit product spec): a student's streak is
 * the number of consecutive EXPECTED checking days, walking backward
 * from a given date, on which they have a 'checked' DailyCheck record
 * — skipping (never breaking on) any day that isn't an expected
 * checking day at all, and stopping (breaking) the moment an expected
 * checking day has no 'checked' record. A lower score never affects
 * this — streak is about completion only, never quality (see
 * getCurrentStreak() below, which never reads `score` at all).
 */

import { createDailyCheck } from '../models/DailyCheck.js';
import { getTodayDateKey, shiftDateKey } from '../utils/dateHelpers.js';

function listDailyChecks(classroom) {
  return classroom.dailyChecks || [];
}

/** Every DailyCheck record for one notebook type, most recent first — mirrors checkpointService.js's own listCheckpointsForNotebook() naming. */
export function listDailyChecksForNotebook(classroom, subjectId, notebookTypeId) {
  return listDailyChecks(classroom)
    .filter((record) => record.subjectId === subjectId && record.notebookTypeId === notebookTypeId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** One student's own record for one exact date, or null if that day was never marked — a day with no record is "not checked," never fabricated as one. */
export function getRecordForStudentOnDate(classroom, subjectId, notebookTypeId, studentId, date) {
  return (
    listDailyChecks(classroom).find(
      (record) =>
        record.subjectId === subjectId &&
        record.notebookTypeId === notebookTypeId &&
        record.studentId === studentId &&
        record.date === date
    ) || null
  );
}

/**
 * Marks (or updates) one student's daily check for one date — an
 * upsert, the same "find or create" shape checkpointService.js's own
 * findOrCreateRecord() already follows. `score` is only ever set when
 * explicitly passed; passing `status: 'not_checked'` (the "undo a
 * mark" path) always clears any previously-recorded score, since an
 * unchecked day has no quality to record.
 */
export function setDailyCheck(classroom, { subjectId, notebookTypeId, studentId, date, status = 'checked', score }) {
  if (!classroom.dailyChecks) classroom.dailyChecks = [];

  const existing = getRecordForStudentOnDate(classroom, subjectId, notebookTypeId, studentId, date);
  if (existing) {
    existing.status = status;
    if (status === 'not_checked') {
      delete existing.score;
    } else if (score !== undefined) {
      existing.score = score;
    }
    return existing;
  }

  const record = createDailyCheck({ subjectId, notebookTypeId, studentId, date, status, score });
  classroom.dailyChecks.push(record);
  return record;
}

/** Sunday=0 ... Saturday=6, parsed the same "YYYY-MM-DD" way shiftDateKey()/toDateKey() already do — kept local since timetableService.js's own equivalent isn't exported and this is a one-line utility, not something worth threading a new export through for. */
function weekdayOfDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

/** Monday-Friday — this app's one fixed working-week assumption (see this file's own header comment: no configurable per-classroom working-week concept exists to read instead). */
export function isWorkingWeekday(dateKey) {
  const weekday = weekdayOfDateKey(dateKey);
  return weekday >= 1 && weekday <= 5;
}

/** Whether this exact date is in this notebook type's own excluded-dates list. Safe to call even before dailySettings exists (treats it as no exclusions yet). */
export function isExcludedDate(notebookType, dateKey) {
  return Boolean(notebookType.dailySettings?.excludedDates?.includes(dateKey));
}

/** A working weekday that hasn't been explicitly excluded for this notebook type — the one predicate everything else (streak, the daily view's own holiday state) is built from. */
export function isExpectedCheckingDay(notebookType, dateKey) {
  return isWorkingWeekday(dateKey) && !isExcludedDate(notebookType, dateKey);
}

// A hard safety bound only — never a product rule. Prevents an
// unbounded walk if a notebook has been checked every single expected
// day since long before this feature existed (~11 years of calendar
// days), not a real streak cap.
const MAX_STREAK_LOOKBACK_DAYS = 4000;

/**
 * Walks backward from `asOfDate` (defaults to today), counting
 * consecutive expected checking days with a 'checked' record for this
 * student, skipping every day that isn't an expected checking day at
 * all (weekends, and this notebook type's own excluded dates), and
 * stopping at the first expected checking day with no 'checked'
 * record. Never reads `score` — a lower score never breaks a streak,
 * per explicit product decision (see this file's own header comment).
 */
export function getCurrentStreak(classroom, subjectId, notebookTypeId, notebookType, studentId, { asOfDate } = {}) {
  let cursor = asOfDate || getTodayDateKey();
  let streak = 0;

  for (let step = 0; step < MAX_STREAK_LOOKBACK_DAYS; step += 1) {
    if (!isExpectedCheckingDay(notebookType, cursor)) {
      cursor = shiftDateKey(cursor, -1);
      continue;
    }
    const record = getRecordForStudentOnDate(classroom, subjectId, notebookTypeId, studentId, cursor);
    if (record?.status !== 'checked') break;
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  return streak;
}
