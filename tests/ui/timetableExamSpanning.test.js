/**
 * tests/ui/timetableExamSpanning.test.js
 *
 * Unit tests for ui/views/timetableExamSpanning.js's
 * groupPeriodsForExamSpanning() — the pure helper that decides which
 * consecutive periods in a day should draw as ONE spanning exam block
 * versus their own normal single-row cells. Extracted from
 * TimetableView.js's renderWeekGrid() specifically so this grouping
 * decision is testable without a DOM (this repo's Node test runner has
 * no DOM library — see tests/ui/timePickerState.test.js for the same
 * pattern).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPeriodsForExamSpanning, computeExamOverlayInset } from '../../js/ui/views/timetableExamSpanning.js';

function period(periodNumber) {
  return { periodNumber };
}

function timedPeriod(periodNumber, startTime, endTime) {
  return { periodNumber, startTime, endTime };
}

function event(startTime, endTime) {
  return { startTime, endTime };
}

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

// ---- computeExamOverlayInset() -------------------------------------------
//
// Round 4's exact-time fix: given the covered periods a spanning exam
// block occupies and the event's own real startTime/endTime, how far
// should the card's own top/bottom edges be inset from the spanned
// area's own top/bottom edges?

test('computeExamOverlayInset: an exam aligned exactly to its covered periods\' boundaries yields ~0% top/bottom inset (fills edge-to-edge, unchanged from before this fix)', () => {
  const coveredPeriods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15'), timedPeriod(3, '11:15', '12:00')];
  const result = computeExamOverlayInset({ event: event('09:45', '12:00'), coveredPeriods });
  assert.deepEqual(result, { topPercent: 0, bottomPercent: 0 });
});

test('computeExamOverlayInset: an exam starting 15 minutes into its first covered period yields a proportional non-zero top inset, and 0% bottom when it still ends exactly on the last period\'s own end', () => {
  // Periods: 09:45-10:30 / 10:30-11:15 / 11:15-12:00 / 12:00-12:30 (total range 09:45-12:30 = 165 minutes).
  const coveredPeriods = [
    timedPeriod(1, '09:45', '10:30'),
    timedPeriod(2, '10:30', '11:15'),
    timedPeriod(3, '11:15', '12:00'),
    timedPeriod(4, '12:00', '12:30'),
  ];
  const result = computeExamOverlayInset({ event: event('10:00', '12:30'), coveredPeriods });
  // (10:00 - 09:45) = 15 minutes of 165 total = 9.09...%
  assert.ok(Math.abs(result.topPercent - (15 / 165) * 100) < 0.01, `topPercent was ${result.topPercent}`);
  assert.equal(result.bottomPercent, 0);
});

test('computeExamOverlayInset: an exam ending before its last covered period\'s own end yields a proportional non-zero bottom inset', () => {
  const coveredPeriods = [timedPeriod(1, '09:00', '09:40'), timedPeriod(2, '09:40', '10:20')];
  // Total range 09:00-10:20 = 80 minutes; exam ends at 10:00, i.e. 20 minutes before the range's own end.
  const result = computeExamOverlayInset({ event: event('09:00', '10:00'), coveredPeriods });
  assert.equal(result.topPercent, 0);
  assert.ok(Math.abs(result.bottomPercent - (20 / 80) * 100) < 0.01, `bottomPercent was ${result.bottomPercent}`);
});

test('computeExamOverlayInset: a single-period exam still computes sensibly', () => {
  const coveredPeriods = [timedPeriod(1, '09:00', '09:40')];
  const result = computeExamOverlayInset({ event: event('09:10', '09:30'), coveredPeriods });
  // 10 minutes of 40 total = 25% top; ends 10 minutes early = 25% bottom.
  assert.ok(Math.abs(result.topPercent - 25) < 0.01);
  assert.ok(Math.abs(result.bottomPercent - 25) < 0.01);
});

test('computeExamOverlayInset: a time range extending outside the covered periods clamps to 0, never negative or over 100', () => {
  const coveredPeriods = [timedPeriod(1, '09:45', '10:30'), timedPeriod(2, '10:30', '11:15')];
  // Starts before the first covered period, ends after the last one.
  const result = computeExamOverlayInset({ event: event('09:00', '12:00'), coveredPeriods });
  assert.equal(result.topPercent, 0);
  assert.equal(result.bottomPercent, 0);
});

test('computeExamOverlayInset: missing/malformed input (no event, no covered periods, unparsable times) clamps gracefully to a full 0/0 block rather than throwing or producing NaN', () => {
  assert.deepEqual(computeExamOverlayInset({ event: null, coveredPeriods: [timedPeriod(1, '09:00', '09:40')] }), { topPercent: 0, bottomPercent: 0 });
  assert.deepEqual(computeExamOverlayInset({ event: event('09:00', '09:40'), coveredPeriods: [] }), { topPercent: 0, bottomPercent: 0 });
  assert.deepEqual(computeExamOverlayInset({ event: event('bad', 'bad'), coveredPeriods: [timedPeriod(1, '09:00', '09:40')] }), {
    topPercent: 0,
    bottomPercent: 0,
  });
});
