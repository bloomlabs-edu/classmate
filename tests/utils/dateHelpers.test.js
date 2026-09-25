/**
 * tests/utils/dateHelpers.test.js
 *
 * Real, executed unit tests against utils/dateHelpers.js's own pure,
 * exported getWeekLabel() — added for the Class Mode Student Profile's
 * weekly-chart week-by-week navigation. No DOM, no Firebase.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeekLabel, getMondayStartOfWeek, shiftDateKey, formatDateKeyRange } from '../../js/utils/dateHelpers.js';

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
