import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateStepSummary } from '../../js/ui/components/GuidedStepFlow.js';

test('truncateStepSummary: short text passes through unchanged', () => {
  assert.equal(truncateStepSummary('Students understand plant classification.'), 'Students understand plant classification.');
});

test('truncateStepSummary: long text is truncated with an ellipsis, capped at maxLength', () => {
  const long = 'a'.repeat(200);
  const result = truncateStepSummary(long);
  assert.equal(result.length, 90);
  assert.ok(result.endsWith('…'));
});

test('truncateStepSummary: trims surrounding whitespace before measuring length', () => {
  assert.equal(truncateStepSummary('   padded text   '), 'padded text');
});

test('truncateStepSummary: an empty/undefined value returns an empty string, never throws', () => {
  assert.equal(truncateStepSummary(''), '');
  assert.equal(truncateStepSummary(undefined), '');
});

test('truncateStepSummary: a custom maxLength is honored', () => {
  assert.equal(truncateStepSummary('abcdefghij', 5), 'abcd…');
});
