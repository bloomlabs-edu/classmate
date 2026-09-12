/**
 * tests/config/examNameConfig.test.js
 *
 * config/examNameConfig.js's own EXAM_NAMES registry — the predefined
 * exam-name select ui/views/TimetableView.js's openExamFormOverlay()
 * now uses instead of a free-text "Exam name" field. Confirms the
 * array is frozen (same "no accidental mutation" invariant
 * config/canonicalSubjectsConfig.js's own test file already checks for
 * that list) and that all 6 predefined names plus the "Other" sentinel
 * are present and distinct.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAM_NAMES, EXAM_NAME_CUSTOM_VALUE } from '../../js/config/examNameConfig.js';

test('EXAM_NAMES: is frozen', () => {
  assert.ok(Object.isFrozen(EXAM_NAMES));
});

test('EXAM_NAMES: contains exactly the 6 predefined names, in order', () => {
  assert.deepEqual(EXAM_NAMES, [
    '1st Mid Term Examinations',
    '2nd Mid Term Examinations',
    '3rd Mid Term Examinations',
    'Quarterly Examinations',
    'Half Yearly Examinations',
    'Final Examinations',
  ]);
});

test('EXAM_NAME_CUSTOM_VALUE: is a sentinel distinct from every real exam name', () => {
  assert.equal(EXAM_NAME_CUSTOM_VALUE, '__custom__');
  assert.ok(!EXAM_NAMES.includes(EXAM_NAME_CUSTOM_VALUE));
});
