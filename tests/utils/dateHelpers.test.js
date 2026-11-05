/**
 * tests/utils/dateHelpers.test.js
 *
 * Real, executed unit tests against utils/dateHelpers.js's own pure,
 * exported getWeekLabel() — added for the Class Mode Student Profile's
 * weekly-chart week-by-week navigation. No DOM, no Firebase.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeekLabel, getMondayStartOfWeek, shiftDateKey, formatDateKeyRange, getTodayDateKey, toDateKey, isValidDateKey } from '../../js/utils/dateHelpers.js';

const TODAY = '2026-09-10'; // Thursday
const THIS_WEEK_MONDAY = getMondayStartOfWeek(TODAY); // 2026-09-07

test('the week containing today reads "This Week"', () => {
  assert.equal(getWeekLabel(THIS_WEEK_MONDAY, TODAY), 'This Week');
});

test('the immediately preceding week reads "Last Week"', () => {
  const lastWeekMonday = shiftDateKey(THIS_WEEK_MONDAY, -7);
  assert.equal(getWeekLabel(lastWeekMonday, TODAY), 'Last Week');
});

test('an older week within one calendar month reads as a compact date range', () => {
  // 2026-08-24 (Mon) - 2026-08-28 (Fri)
  assert.equal(getWeekLabel('2026-08-24', TODAY), 'Aug 24–28');
});

test('a week whose Mon-Fri span crosses a calendar month boundary shows both months', () => {
  // 2026-07-27 (Mon) .. 2026-07-31 (Fri) — stays within July, sanity check first.
  assert.equal(getWeekLabel('2026-07-27', TODAY), 'Jul 27–31');
  // A genuine cross-month week: Monday 2026-06-29 -> Friday 2026-07-03.
  assert.equal(getWeekLabel('2026-06-29', TODAY), 'Jun 29 – Jul 3');
});

test('two weeks back from today is neither "This Week" nor "Last Week"', () => {
  const twoWeeksAgoMonday = shiftDateKey(THIS_WEEK_MONDAY, -14);
  const label = getWeekLabel(twoWeeksAgoMonday, TODAY);
  assert.notEqual(label, 'This Week');
  assert.notEqual(label, 'Last Week');
});

// ---- formatDateKeyRange() — the examination DATE RANGE feature -----------

test('formatDateKeyRange: a single-day range (start === end) shows one plain date, never "X – X"', () => {
  assert.equal(formatDateKeyRange('2026-09-24', '2026-09-24'), '24 Sep 2026');
});

test('formatDateKeyRange: a multi-day range within one month/year shows a compact "24–30 Sep 2026" form', () => {
  assert.equal(formatDateKeyRange('2026-09-24', '2026-09-30'), '24–30 Sep 2026');
});

test('formatDateKeyRange: a range crossing a month boundary within the same year spells out both months', () => {
  assert.equal(formatDateKeyRange('2026-09-28', '2026-10-02'), '28 Sep – 2 Oct 2026');
});

test('formatDateKeyRange: a range crossing a year boundary spells out both full dates including year', () => {
  assert.equal(formatDateKeyRange('2026-12-29', '2027-01-03'), '29 Dec 2026 – 3 Jan 2027');
});

// ---------------------------------------------------------------------
// getMondayStartOfWeek(getTodayDateKey()) — the exact composition
// ui/views/ProgramManagerWeeklyPlanQueueView.js's getNextWeekStartDate()
// and ui/views/ChapterPlanEditorView.js's "Open This Week" both use.
// A deployed defect once fed getCurrentIsoDate() (a full ISO timestamp)
// into getMondayStartOfWeek() instead, producing "NaN-NaN-NaN" and a
// rendered "Invalid Date NaN-NaN" — these tests lock in the correct
// composition and document the exact shape of that regression.
// ---------------------------------------------------------------------

test('getMondayStartOfWeek(getTodayDateKey()): produces a real "YYYY-MM-DD" Monday, never NaN-NaN-NaN', () => {
  const monday = getMondayStartOfWeek(getTodayDateKey());
  assert.match(monday, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(monday, 'NaN-NaN-NaN');
  const [, month, day] = monday.split('-').map(Number);
  assert.ok(month >= 1 && month <= 12);
  assert.ok(day >= 1 && day <= 31);
});

test('shiftDateKey(getMondayStartOfWeek(getTodayDateKey()), 7): the "next week start" composition used by getNextWeekStartDate() and "Open This Week" is a valid dateKey, never NaN-NaN-NaN', () => {
  const nextWeekStart = shiftDateKey(getMondayStartOfWeek(getTodayDateKey()), 7);
  assert.match(nextWeekStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(nextWeekStart, 'NaN-NaN-NaN');
});

test('REGRESSION CHARACTERIZATION — feeding a full ISO timestamp (getCurrentIsoDate()-shaped input) into getMondayStartOfWeek() is exactly the deployed bug: it silently produces "NaN-NaN-NaN" instead of throwing, which is why this must never be done again', () => {
  const isoTimestamp = new Date().toISOString(); // e.g. "2026-09-29T10:39:57.123Z"
  assert.equal(getMondayStartOfWeek(isoTimestamp), 'NaN-NaN-NaN');
});

// ---------------------------------------------------------------------
// isValidDateKey — the Readiness Champion late-submission bug's own
// date-validity guard (services/notebookBadgeAwardService.js).
// ---------------------------------------------------------------------

test('isValidDateKey: true for a well-formed real calendar date', () => {
  assert.equal(isValidDateKey('2026-09-10'), true);
  assert.equal(isValidDateKey('2026-01-01'), true);
  assert.equal(isValidDateKey('2024-02-29'), true); // real leap day
});

test('isValidDateKey: false for missing/empty/non-string values', () => {
  assert.equal(isValidDateKey(null), false);
  assert.equal(isValidDateKey(undefined), false);
  assert.equal(isValidDateKey(''), false);
  assert.equal(isValidDateKey(20260910), false);
});

test('isValidDateKey: false for a full ISO timestamp — the exact shape getCurrentIsoDate() produces, never a valid date key', () => {
  assert.equal(isValidDateKey('2026-09-10T10:39:57.123Z'), false);
  assert.equal(isValidDateKey(new Date().toISOString()), false);
});

test('isValidDateKey: false for out-of-range month/day that Date() would otherwise silently roll over (e.g. "2026-13-40" -> some date in 2027)', () => {
  assert.equal(isValidDateKey('2026-13-01'), false);
  assert.equal(isValidDateKey('2026-02-30'), false); // Feb never has 30 days
  assert.equal(isValidDateKey('2025-02-29'), false); // 2025 is not a leap year
});

test('isValidDateKey: false for malformed strings that merely resemble a date', () => {
  assert.equal(isValidDateKey('not-a-date'), false);
  assert.equal(isValidDateKey('2026/09/10'), false);
  assert.equal(isValidDateKey('10-09-2026'), false);
});

// ---------------------------------------------------------------------
// toDateKey / getTodayDateKey — timezone-boundary behaviour. These
// build the date key from LOCAL getFullYear()/getMonth()/getDate()
// (never UTC/toISOString()), so a moment near a UTC day boundary keys
// correctly to the CALLER's own local calendar day regardless of how
// far local time is offset from UTC — exactly the property
// evaluateReadinessChampion()'s due-date comparison depends on.
// ---------------------------------------------------------------------

test('toDateKey: keys to the LOCAL calendar day, not the UTC day, for a moment where the two disagree', () => {
  // 2026-11-04T23:30:00 in a UTC+5:30 locale (e.g. IST) is already
  // 2026-11-05T18:00:00Z in UTC — if a date key were ever derived via
  // toISOString().slice(0, 10) instead of local getters, this moment
  // would wrongly key to "2026-11-05". toDateKey() must key to whatever
  // this JS runtime's own local calendar day actually is for that
  // instant, consistently with new Date().getFullYear()/getMonth()/getDate().
  const instant = new Date(2026, 10, 4, 23, 30, 0); // local: 4 Nov 2026, 11:30 PM
  const key = toDateKey(instant);
  assert.equal(key, '2026-11-04');
  assert.equal(key, `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`);
});

test('toDateKey: a moment just after local midnight keys to the NEW local day, not the previous one', () => {
  const instant = new Date(2026, 10, 5, 0, 15, 0); // local: 5 Nov 2026, 12:15 AM
  assert.equal(toDateKey(instant), '2026-11-05');
});
