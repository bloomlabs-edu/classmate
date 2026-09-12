/**
 * tests/ui/timetableExamSpanning.test.js
 *
 * Unit tests for ui/views/timetableExamSpanning.js:
 * - groupPeriodsForExamSpanning() — the pure helper that decides which
 *   consecutive periods in a day should draw as ONE spanning exam
 *   block versus their own normal single-row cells.
 * - computeDayAxisStartMinutes() / computeDayAxisEndMinutes() /
 *   computePeriodDurationMinutes() / computeEventOverlayGeometry() —
 *   Round 5's pure, DOM-free time-to-pixel geometry helpers, replacing
 *   Round 4's percentage-of-rendered-cell computeExamOverlayInset()
 *   (removed — no longer used anywhere after this rewrite).
 *
 * Extracted from TimetableView.js's renderWeekGrid()/renderDayGrid()
 * specifically so these decisions are testable without a DOM (this
 * repo's Node test runner has no DOM library — see
 * tests/ui/timePickerState.test.js for the same pattern).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupPeriodsForExamSpanning,
  computeDayAxisStartMinutes,
  computeDayAxisEndMinutes,
  computePeriodDurationMinutes,
  computeEventOverlayGeometry,
  PIXELS_PER_MINUTE,
} from '../../js/ui/views/timetableExamSpanning.js';

function period(periodNumber) {
  return { periodNumber };
}

function timedPeriod(periodNumber, startTime, endTime) {
  return { periodNumber, startTime, endTime };
}

function event(startTime, endTime) {
  return { startTime, endTime };
}

// ---- groupPeriodsForExamSpanning() ---------------------------------------

test('no suppressed periods: every period is its own single-length group, in order', () => {
  const periods = [period(1), period(2), period(3)];
  const effectivePeriods = [
    { periodNumber: 1 },
    { periodNumber: 2 },
    { periodNumber: 3 },
  ];
  const groups = groupPeriodsForExamSpanning(periods, effectivePeriods);
  assert.deepEqual(groups, [
    { startIndex: 0, length: 1, suppressedByEventId: null },
    { startIndex: 1, length: 1, suppressedByEventId: null },
    { startIndex: 2, length: 1, suppressedByEventId: null },
  ]);
});

test('a 3-period exam merges into ONE group spanning all 3 periods', () => {
  const periods = [period(1), period(2), period(3)];
  const effectivePeriods = [
    { periodNumber: 1, suppressedByEventId: 'exam-1' },
    { periodNumber: 2, suppressedByEventId: 'exam-1' },
    { periodNumber: 3, suppressedByEventId: 'exam-1' },
  ];
  const groups = groupPeriodsForExamSpanning(periods, effectivePeriods);
  assert.deepEqual(groups, [{ startIndex: 0, length: 3, suppressedByEventId: 'exam-1' }]);
});

test('an exam in the middle of the day: normal periods before and after stay their own groups', () => {
  const periods = [period(1), period(2), period(3), period(4), period(5)];
  const effectivePeriods = [
    { periodNumber: 1 },
    { periodNumber: 2, suppressedByEventId: 'exam-1' },
    { periodNumber: 3, suppressedByEventId: 'exam-1' },
    { periodNumber: 4 },
    { periodNumber: 5 },
  ];
  const groups = groupPeriodsForExamSpanning(periods, effectivePeriods);
  assert.deepEqual(groups, [
    { startIndex: 0, length: 1, suppressedByEventId: null },
    { startIndex: 1, length: 2, suppressedByEventId: 'exam-1' },
    { startIndex: 3, length: 1, suppressedByEventId: null },
    { startIndex: 4, length: 1, suppressedByEventId: null },
  ]);
});

test('two DIFFERENT exams on the same day (non-adjacent) produce two separate groups, never merged', () => {
  const periods = [period(1), period(2), period(3), period(4)];
  const effectivePeriods = [
    { periodNumber: 1, suppressedByEventId: 'exam-a' },
    { periodNumber: 2 },
    { periodNumber: 3, suppressedByEventId: 'exam-b' },
    { periodNumber: 4, suppressedByEventId: 'exam-b' },
  ];
  const groups = groupPeriodsForExamSpanning(periods, effectivePeriods);
  assert.deepEqual(groups, [
    { startIndex: 0, length: 1, suppressedByEventId: 'exam-a' },
    { startIndex: 1, length: 1, suppressedByEventId: null },
    { startIndex: 2, length: 2, suppressedByEventId: 'exam-b' },
  ]);
});

test('two DIFFERENT exams back-to-back (adjacent periods, different event ids) are NOT merged into one group', () => {
  const periods = [period(1), period(2), period(3)];
  const effectivePeriods = [
    { periodNumber: 1, suppressedByEventId: 'exam-a' },
    { periodNumber: 2, suppressedByEventId: 'exam-b' },
    { periodNumber: 3, suppressedByEventId: 'exam-b' },
  ];
  const groups = groupPeriodsForExamSpanning(periods, effectivePeriods);
  assert.deepEqual(groups, [
    { startIndex: 0, length: 1, suppressedByEventId: 'exam-a' },
    { startIndex: 1, length: 2, suppressedByEventId: 'exam-b' },
  ]);
});

test('a period with no matching effective period (e.g. missing from schedule) is treated as an ungrouped, unsuppressed period', () => {
  const periods = [period(1), period(2)];
  const effectivePeriods = [{ periodNumber: 1 }];
  const groups = groupPeriodsForExamSpanning(periods, effectivePeriods);
  assert.deepEqual(groups, [
    { startIndex: 0, length: 1, suppressedByEventId: null },
    { startIndex: 1, length: 1, suppressedByEventId: null },
  ]);
});

test('does not create or reference any ScheduledEvent object — only reads/echoes suppressedByEventId strings', () => {
  const periods = [period(1), period(2)];
  const effectivePeriods = [
    { periodNumber: 1, suppressedByEventId: 'exam-1' },
    { periodNumber: 2, suppressedByEventId: 'exam-1' },
  ];
  const groups = groupPeriodsForExamSpanning(periods, effectivePeriods);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].suppressedByEventId, 'exam-1');
  // Nothing beyond the plain id string is fabricated.
  assert.deepEqual(Object.keys(groups[0]).sort(), ['length', 'startIndex', 'suppressedByEventId']);
});

// ---- computePeriodDurationMinutes() --------------------------------------

test('computePeriodDurationMinutes: a normal period returns its real duration in minutes', () => {
  assert.equal(computePeriodDurationMinutes(timedPeriod(1, '09:45', '10:30')), 45);
});

test('computePeriodDurationMinutes: missing/unparsable/zero-or-negative-width times return null, never NaN', () => {
  assert.equal(computePeriodDurationMinutes({ startTime: null, endTime: '10:30' }), null);
  assert.equal(computePeriodDurationMinutes({ startTime: 'bad', endTime: '10:30' }), null);
  assert.equal(computePeriodDurationMinutes(timedPeriod(1, '10:30', '10:30')), null);
  assert.equal(computePeriodDurationMinutes(timedPeriod(1, '11:00', '10:30')), null);
  assert.equal(computePeriodDurationMinutes(undefined), null);
});

// ---- computeDayAxisStartMinutes() / computeDayAxisEndMinutes() ----------

test('computeDayAxisStartMinutes: the earliest period start, regardless of list order', () => {
  const periods = [timedPeriod(2, '10:30', '11:15'), timedPeriod(1, '09:45', '10:30'), timedPeriod(3, '11:15', '12:00')];
  assert.equal(computeDayAxisStartMinutes(periods), 9 * 60 + 45);
});

test('computeDayAxisEndMinutes: the latest period end, regardless of list order', () => {
  const periods = [timedPeriod(2, '10:30', '11:15'), timedPeriod(1, '09:45', '10:30'), timedPeriod(3, '11:15', '12:30')];
  assert.equal(computeDayAxisEndMinutes(periods), 12 * 60 + 30);
});

test('computeDayAxisStartMinutes/EndMinutes: an empty or all-unparsable period list is handled safely (0 / null), never throws', () => {
  assert.equal(computeDayAxisStartMinutes([]), 0);
  assert.equal(computeDayAxisStartMinutes([{ startTime: 'bad' }]), 0);
  assert.equal(computeDayAxisEndMinutes([]), null);
  assert.equal(computeDayAxisEndMinutes([{ endTime: 'bad' }]), null);
});

// ---- computeEventOverlayGeometry() ---------------------------------------
//
// Round 5's actual fix: pure pixel geometry from a fixed
// pixels-per-minute scale and a fixed day-axis start — never a
// percentage of any rendered/measured dimension.

test('case 1: exam starts exactly at a period boundary — geometry aligns with that boundary', () => {
  const periods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15')];
  const dayAxisStartMinutes = computeDayAxisStartMinutes(periods);
  const result = computeEventOverlayGeometry({ event: event('10:30', '11:15'), dayAxisStartMinutes });
  // 10:30 is 45 minutes after the 09:45 axis start.
  assert.equal(result.topPx, 45 * PIXELS_PER_MINUTE);
  assert.equal(result.heightPx, 45 * PIXELS_PER_MINUTE);
});

test('case 2: exam starts in the middle of a period — top offset reflects the mid-period start', () => {
  const periods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15'), timedPeriod(3, '11:15', '12:00')];
  const dayAxisStartMinutes = computeDayAxisStartMinutes(periods);
  // Starts 15 minutes into period 1 (10:00), ends exactly on period 3's own end.
  const result = computeEventOverlayGeometry({ event: event('10:00', '12:00'), dayAxisStartMinutes });
  assert.equal(result.topPx, 15 * PIXELS_PER_MINUTE);
  assert.equal(result.heightPx, (12 * 60 - (9 * 60 + 45) - 15) * PIXELS_PER_MINUTE);
});

test('case 3: exam ends in the middle of a period — height reflects the mid-period end', () => {
  const periods = [timedPeriod(1, '09:00', '09:40'), timedPeriod(2, '09:40', '10:20')];
  const dayAxisStartMinutes = computeDayAxisStartMinutes(periods);
  // 09:00 - 10:00 (ends 20 minutes into period 2).
  const result = computeEventOverlayGeometry({ event: event('09:00', '10:00'), dayAxisStartMinutes });
  assert.equal(result.topPx, 0);
  assert.equal(result.heightPx, 60 * PIXELS_PER_MINUTE);
});

test('case 4: exam crosses multiple periods — height spans the full real duration', () => {
  const periods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15'), timedPeriod(3, '11:15', '12:00'), timedPeriod(4, '12:00', '12:30')];
  const dayAxisStartMinutes = computeDayAxisStartMinutes(periods);
  const result = computeEventOverlayGeometry({ event: event('10:00', '12:30'), dayAxisStartMinutes });
  assert.equal(result.topPx, 15 * PIXELS_PER_MINUTE);
  assert.equal(result.heightPx, 150 * PIXELS_PER_MINUTE); // 10:00 -> 12:30 = 150 minutes
});

test('case 5: exam exactly matches several whole periods — geometry equals their combined real duration', () => {
  const periods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15'), timedPeriod(3, '11:15', '12:00')];
  const dayAxisStartMinutes = computeDayAxisStartMinutes(periods);
  const result = computeEventOverlayGeometry({ event: event('09:45', '12:00'), dayAxisStartMinutes });
  assert.equal(result.topPx, 0);
  assert.equal(result.heightPx, 135 * PIXELS_PER_MINUTE); // 09:45 -> 12:00 = 135 minutes
});

test('case 6 (the critical invariant): the same exam produces IDENTICAL geometry regardless of any other periods’ data', () => {
  // Two scenarios differing ONLY in "how much content/duration other,
  // irrelevant periods have" — the target exam's own axis-relevant
  // inputs (dayAxisStartMinutes) are identical in both, so the
  // function call is identical, so the result must be bit-for-bit
  // identical. computeEventOverlayGeometry()'s own signature —
  // { event, dayAxisStartMinutes, dayAxisEndMinutes, pixelsPerMinute }
  // — has no row-height/DOM/"other periods" parameter at all for a
  // lesson's content to ever reach.
  const examEvent = event('10:00', '12:30');

  const periodsScenarioA = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15'), timedPeriod(3, '11:15', '12:00'), timedPeriod(4, '12:00', '12:30')];
  // Scenario B: a LATER, unrelated period (5) with a wildly different
  // duration — simulating "period 5 grew because its lesson has many
  // concepts" — appended after the exam's own covered range.
  const periodsScenarioB = [...periodsScenarioA, timedPeriod(5, '12:30', '15:00')];

  const resultA = computeEventOverlayGeometry({ event: examEvent, dayAxisStartMinutes: computeDayAxisStartMinutes(periodsScenarioA) });
  const resultB = computeEventOverlayGeometry({ event: examEvent, dayAxisStartMinutes: computeDayAxisStartMinutes(periodsScenarioB) });

  assert.deepEqual(resultA, resultB);
  assert.equal(resultA.topPx, 15 * PIXELS_PER_MINUTE);
  assert.equal(resultA.heightPx, 150 * PIXELS_PER_MINUTE);

  // Also true when passing wholly fabricated, nonsensical axis-start
  // values that happen to coincide — proving the function itself
  // never reads anything beyond its own declared inputs.
  const resultC = computeEventOverlayGeometry({ event: examEvent, dayAxisStartMinutes: 9 * 60 + 45, dayAxisEndMinutes: 999 });
  const resultD = computeEventOverlayGeometry({ event: examEvent, dayAxisStartMinutes: 9 * 60 + 45, dayAxisEndMinutes: 12 * 60 + 30 });
  assert.deepEqual(resultC, resultD);
});

test('case 7: malformed/missing time input is handled safely — never NaN/negative/throws', () => {
  assert.deepEqual(computeEventOverlayGeometry({ event: null, dayAxisStartMinutes: 0 }), { topPx: 0, heightPx: 0 });
  assert.deepEqual(computeEventOverlayGeometry({ event: event(null, '10:00'), dayAxisStartMinutes: 0 }), { topPx: 0, heightPx: 0 });
  assert.deepEqual(computeEventOverlayGeometry({ event: event('10:00', null), dayAxisStartMinutes: 0 }), { topPx: 0, heightPx: 0 });
  assert.deepEqual(computeEventOverlayGeometry({ event: event('bad', 'bad'), dayAxisStartMinutes: 0 }), { topPx: 0, heightPx: 0 });
  assert.deepEqual(computeEventOverlayGeometry({ event: event('11:00', '10:00'), dayAxisStartMinutes: 0 }), { topPx: 0, heightPx: 0 }); // end before start
  const result = computeEventOverlayGeometry({ event: event('10:00', '11:00'), dayAxisStartMinutes: NaN });
  assert.ok(Number.isFinite(result.topPx) && result.topPx >= 0);
  assert.ok(Number.isFinite(result.heightPx) && result.heightPx >= 0);
});

test('case 8: an exam starting before the first period clamps its top to 0 rather than going negative', () => {
  const periods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15')];
  const dayAxisStartMinutes = computeDayAxisStartMinutes(periods);
  const result = computeEventOverlayGeometry({ event: event('09:00', '10:30'), dayAxisStartMinutes });
  assert.equal(result.topPx, 0);
  // Clamped start (09:45) -> 10:30 = 45 minutes, not the unclamped 90.
  assert.equal(result.heightPx, 45 * PIXELS_PER_MINUTE);
});

test('case 8b: an exam ending after the last period clamps its end to the day axis end rather than overrunning', () => {
  const periods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15')];
  const dayAxisStartMinutes = computeDayAxisStartMinutes(periods);
  const dayAxisEndMinutes = computeDayAxisEndMinutes(periods);
  const result = computeEventOverlayGeometry({ event: event('10:30', '13:00'), dayAxisStartMinutes, dayAxisEndMinutes });
  assert.equal(result.topPx, 45 * PIXELS_PER_MINUTE);
  // Clamped end (11:15) -> only 45 minutes of height, not the unclamped 150.
  assert.equal(result.heightPx, 45 * PIXELS_PER_MINUTE);
});

test('case 8c: an exam spanning entirely outside the day axis (starts before, ends after) still clamps to a sane, non-negative block', () => {
  const periods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15')];
  const dayAxisStartMinutes = computeDayAxisStartMinutes(periods);
  const dayAxisEndMinutes = computeDayAxisEndMinutes(periods);
  const result = computeEventOverlayGeometry({ event: event('06:00', '18:00'), dayAxisStartMinutes, dayAxisEndMinutes });
  assert.equal(result.topPx, 0);
  assert.equal(result.heightPx, 90 * PIXELS_PER_MINUTE); // the full 09:45-11:15 axis range
});
