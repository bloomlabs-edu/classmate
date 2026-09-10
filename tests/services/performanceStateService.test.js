/**
 * tests/services/performanceStateService.test.js
 *
 * Real, executed unit tests against
 * services/performanceStateService.js's own pure, exported functions —
 * isStudentInRedemption() and getNameHighlightState(). No DOM, no
 * Firebase; student fixtures are plain { history: [...] } objects built
 * directly against the model documented in models/Student.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStudentInRedemption, getNameHighlightState, NEGATIVE_THRESHOLD, REDEMPTION_DAILY_STAR_TARGET, REDEMPTION_CONSECUTIVE_DAYS } from '../../js/services/performanceStateService.js';

let idCounter = 0;
function pointEntry(dateKey, delta) {
  idCounter += 1;
  return { id: `e${idCounter}`, kind: 'points', label: delta > 0 ? 'Star' : 'Negative', delta, recordedAt: `${dateKey}T10:00:00.000Z` };
}

function studentWithHistory(entries) {
  return { id: 's1', name: 'Test Student', history: entries };
}

// A fixed Monday-start week for deterministic fixtures: 2026-09-07 (Mon)
// through 2026-09-13 (Sun); 2026-09-14 is the following Monday.
const MON = '2026-09-07';
const TUE = '2026-09-08';
const WED = '2026-09-09';
const THU = '2026-09-10';
const FRI = '2026-09-11';
const NEXT_MON = '2026-09-14';
const NEXT_TUE = '2026-09-15';
const NEXT_WED = '2026-09-16';

test('constants match the documented product rule (>3 negatives/week; 5-star days; 3 in a row)', () => {
  assert.equal(NEGATIVE_THRESHOLD, 3);
  assert.equal(REDEMPTION_DAILY_STAR_TARGET, 5);
  assert.equal(REDEMPTION_CONSECUTIVE_DAYS, 3);
});

test('no history at all: not in redemption', () => {
  const student = studentWithHistory([]);
  assert.equal(isStudentInRedemption(student, MON), false);
});

test('Example 1 shape: 5 stars, 2 negatives, no redemption -> climbing gives GREEN', () => {
  const student = studentWithHistory([pointEntry(MON, 5), pointEntry(MON, -1), pointEntry(MON, -1)]);
  assert.equal(isStudentInRedemption(student, MON), false);
  assert.equal(getNameHighlightState(student, { isClimber: true, todayDateKey: MON }), 'climbing');
});

test('Example 2 shape: 4 negatives in the week overrides climbing -> RED', () => {
  const student = studentWithHistory([pointEntry(MON, -1), pointEntry(TUE, -1), pointEntry(WED, -1), pointEntry(THU, -1)]);
  assert.equal(isStudentInRedemption(student, THU), true);
  assert.equal(getNameHighlightState(student, { isClimber: true, todayDateKey: THU }), 'redemption');
});

test('exactly 3 negatives in a week does NOT trip redemption (threshold is > 3, not >= 3)', () => {
  const student = studentWithHistory([pointEntry(MON, -1), pointEntry(TUE, -1), pointEntry(WED, -1)]);
  assert.equal(isStudentInRedemption(student, WED), false);
});

test('Example 3 shape: negatives later drop back under the threshold, but redemption stays sticky', () => {
  const student = studentWithHistory([
    pointEntry(MON, -1), pointEntry(MON, -1), pointEntry(MON, -1), pointEntry(MON, -1), // 4 negatives Monday -> trips
    pointEntry(TUE, 1), // one lone star, nowhere near a 5-star day
  ]);
  assert.equal(isStudentInRedemption(student, TUE), true);
});

test('redemption never clears from a single 5-star day alone (needs 3 IN A ROW)', () => {
  const student = studentWithHistory([
    pointEntry(MON, -4), // trips redemption
    pointEntry(TUE, 5), // one good day only
  ]);
  assert.equal(isStudentInRedemption(student, TUE), true);
});

test('Example 4/7 shape: 3 consecutive 5-star days after the breach clears redemption to neutral (not green)', () => {
  const student = studentWithHistory([
    pointEntry(MON, -4), // trips redemption on Monday
    pointEntry(TUE, 5),
    pointEntry(WED, 5),
    pointEntry(THU, 5),
  ]);
  assert.equal(isStudentInRedemption(student, THU), false);
  // Redeemed but not currently climbing -> Example 6: NEUTRAL, never green.
  assert.equal(getNameHighlightState(student, { isClimber: false, todayDateKey: THU }), null);
});

test('a gap day (0 stars) between good days breaks the consecutive-day streak', () => {
  const student = studentWithHistory([
    pointEntry(MON, -4), // trips redemption
    pointEntry(TUE, 5),
    // WED: no entries at all -> 0 stars that day, streak resets
    pointEntry(THU, 5),
    pointEntry(FRI, 5),
  ]);
  // Only 2 in a row (Thu, Fri) by Friday - still in redemption.
  assert.equal(isStudentInRedemption(student, FRI), true);
});

test('Example 5: after redemption completes, climbing again produces GREEN, never RED -> GREEN directly', () => {
  const student = studentWithHistory([
    pointEntry(MON, -4), // trips redemption
    pointEntry(TUE, 5),
    pointEntry(WED, 5),
    pointEntry(THU, 5), // redeemed as of Thursday
  ]);
  assert.equal(getNameHighlightState(student, { isClimber: true, todayDateKey: THU }), 'climbing');
});

test('a relapse in a NEW week resets an in-progress redemption streak back to zero', () => {
  const student = studentWithHistory([
    pointEntry(MON, -4), // week 1 trips redemption
    pointEntry(TUE, 5),
    pointEntry(WED, 5), // 2 good days in a row so far, not yet redeemed
    pointEntry(NEXT_MON, -4), // week 2: a fresh breach before completing redemption
    pointEntry(NEXT_TUE, 5),
    pointEntry(NEXT_WED, 5), // only 2 in a row again since the relapse
  ]);
  assert.equal(isStudentInRedemption(student, NEXT_WED), true);
});

test('RED never transitions directly to GREEN: redeeming clears to neutral even when isClimber is (incorrectly) passed true before the streak completes', () => {
  const student = studentWithHistory([pointEntry(MON, -4)]); // in redemption, no good days yet
  assert.equal(getNameHighlightState(student, { isClimber: true, todayDateKey: MON }), 'redemption');
});
