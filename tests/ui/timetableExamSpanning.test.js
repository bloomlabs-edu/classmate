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
import { groupPeriodsForExamSpanning } from '../../js/ui/views/timetableExamSpanning.js';

function period(periodNumber) {
  return { periodNumber };
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
