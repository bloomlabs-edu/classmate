/**
 * tests/config/assessmentMarksColorConfig.test.js
 *
 * Regression coverage for the confirmed business rule:
 *
 *   RED:    percent <  passMarkPercent
 *   YELLOW: passMarkPercent <= percent < GREEN_THRESHOLD_PERCENT (70)
 *   GREEN:  percent >= GREEN_THRESHOLD_PERCENT
 *
 * This is specifically the regression suite for the bug where a
 * static, hardcoded MARKS_COLOR_THRESHOLDS (yellow starting at a fixed
 * 36%) was completely disconnected from a specific Assessment's own
 * edited passMarkPercent — a Pass Mark of 35% still classified a 35%
 * score as Red, because 35 < the old hardcoded 36. That hardcoded
 * threshold has been removed entirely; every test below asserts the
 * boundary is wherever `passMarkPercent` actually is, not a fixed
 * number.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMarksColorClass, getMarksBucketKey, getPerformanceBucketLabel, GREEN_THRESHOLD_PERCENT } from '../../js/config/assessmentMarksColorConfig.js';

function bucketFor(marks, maximumMarks, passMarkPercent) {
  return getMarksBucketKey(marks, maximumMarks, passMarkPercent);
}

test('THE CRITICAL LIVE REGRESSION: Pass Mark 35%, Kavisri 35/100 -> Yellow, never Red or Green', () => {
  assert.equal(bucketFor(35, 100, 35), 'yellow');
});

test('Pass Mark = 35: exact boundary values', () => {
  assert.equal(bucketFor(34.99, 100, 35), 'red');
  assert.equal(bucketFor(35, 100, 35), 'yellow');
  assert.equal(bucketFor(35.01, 100, 35), 'yellow');
  assert.equal(bucketFor(69.99, 100, 35), 'yellow');
  assert.equal(bucketFor(70, 100, 35), 'green');
  assert.equal(bucketFor(70.01, 100, 35), 'green');
});

test('Pass Mark = 40: Red/Yellow boundary moves to 40, Green stays at 70', () => {
  assert.equal(bucketFor(39.99, 100, 40), 'red');
  assert.equal(bucketFor(40, 100, 40), 'yellow');
  assert.equal(bucketFor(69.99, 100, 40), 'yellow');
  assert.equal(bucketFor(70, 100, 40), 'green');
});

test('Pass Mark = 30: Red/Yellow boundary moves to 30, Green stays at 70', () => {
  assert.equal(bucketFor(29.99, 100, 30), 'red');
  assert.equal(bucketFor(30, 100, 30), 'yellow');
  assert.equal(bucketFor(69.99, 100, 30), 'yellow');
  assert.equal(bucketFor(70, 100, 30), 'green');
});

test('Pass Mark = 50: Red/Yellow boundary moves to 50, Green stays at 70', () => {
  assert.equal(bucketFor(49.99, 100, 50), 'red');
  assert.equal(bucketFor(50, 100, 50), 'yellow');
  assert.equal(bucketFor(69.99, 100, 50), 'yellow');
  assert.equal(bucketFor(70, 100, 50), 'green');
});

test('NON-100 MAXIMUM: classification uses the normalized percentage, never raw marks compared directly to a percentage threshold (maximum = 50, Pass Mark = 35%)', () => {
  assert.equal(bucketFor(17.49, 50, 35), 'red', '17.49/50 = 34.98%');
  assert.equal(bucketFor(17.5, 50, 35), 'yellow', '17.5/50 = exactly 35%');
  assert.equal(bucketFor(30, 50, 35), 'yellow', '30/50 = 60%');
  assert.equal(bucketFor(35, 50, 35), 'green', '35/50 = exactly 70%');
});

test('GREEN THRESHOLD IS INDEPENDENT OF PASS MARK: raising the Pass Mark never moves the Green boundary away from 70%', () => {
  [10, 30, 35, 40, 50, 65].forEach((passMarkPercent) => {
    assert.equal(bucketFor(69.99, 100, passMarkPercent), passMarkPercent > 69.99 ? 'red' : 'yellow', `passMark=${passMarkPercent}`);
    assert.equal(bucketFor(70, 100, passMarkPercent), 'green', `Green must start at exactly 70% regardless of passMark=${passMarkPercent}`);
  });
  assert.equal(GREEN_THRESHOLD_PERCENT, 70);
});

test('getMarksColorClass returns the matching CSS class name for each bucket (used directly for cell/legend styling)', () => {
  assert.equal(getMarksColorClass(34.99, 100, 35), 'gradebook-cell--low');
  assert.equal(getMarksColorClass(35, 100, 35), 'gradebook-cell--mid');
  assert.equal(getMarksColorClass(70, 100, 35), 'gradebook-cell--high');
});

test('PASS_MARK_PERCENT default: omitting passMarkPercent falls back to the system-wide default (36), matching every pre-existing, never-edited Assessment', () => {
  assert.equal(bucketFor(35.99, 100), 'red');
  assert.equal(bucketFor(36, 100), 'yellow');
});

// Total Marks feature — the exact worked examples from that feature's
// own product brief: Total Marks = 50, Pass Mark = 35%. Confirms the
// bucket classification is driven entirely by the NORMALIZED
// percentage (marks / configured maximum), never a comparison against
// the raw mark itself.
test('TOTAL MARKS WORKED EXAMPLES: Total = 50, Pass Mark = 35%', () => {
  assert.equal(bucketFor(17, 50, 35), 'red', '17/50 = 34% -> below Pass Mark -> Red/Fail');
  assert.equal(bucketFor(18, 50, 35), 'yellow', '18/50 = 36% -> at/above Pass Mark, below 70% -> Yellow/Pass');
  assert.equal(bucketFor(35, 50, 35), 'green', '35/50 = 70% -> at Green threshold -> Green/Pass');
  assert.equal(bucketFor(25, 50, 35), 'yellow', '25/50 = 50% -> Yellow/Pass');
});

test('a blank/null mark is never coloured or bucketed, regardless of Pass Mark', () => {
  assert.equal(getMarksColorClass(null, 100, 35), null);
  assert.equal(bucketFor(null, 100, 35), null);
});

// Student identity swatch labels (ui/components/StudentNameElement.js's own
// `performanceBucketKey`) — the accessible/tooltip text a teacher or
// screen-reader user sees standing in for the swatch colour. Critically,
// `null` (no mark recorded) must read as "Not Assessed", never as a
// falsy-string fallback that could visually collide with "Needs Help" (Red).
test('getPerformanceBucketLabel: each bucket key maps to its own human label, and null/unrecognised always reads Not Assessed, never Red', () => {
  assert.equal(getPerformanceBucketLabel('red'), 'Needs Help');
  assert.equal(getPerformanceBucketLabel('yellow'), 'Developing');
  assert.equal(getPerformanceBucketLabel('green'), 'Strong');
  assert.equal(getPerformanceBucketLabel(null), 'Not Assessed');
  assert.equal(getPerformanceBucketLabel(undefined), 'Not Assessed');
});
