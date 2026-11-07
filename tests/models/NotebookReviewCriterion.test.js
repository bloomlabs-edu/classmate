/**
 * tests/models/NotebookReviewCriterion.test.js
 *
 * models/NotebookReviewCriterion.js — the reusable criterion factory and
 * the frozen default-criteria seed list.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNotebookReviewCriterion,
  DEFAULT_NOTEBOOK_REVIEW_CRITERIA,
  TIMELY_SUBMISSION_CRITERION_KEY,
} from '../../js/models/NotebookReviewCriterion.js';

test('createNotebookReviewCriterion: generates a real id and defaults isSystemDetermined/isCustom to false', () => {
  const criterion = createNotebookReviewCriterion({ label: 'Neat handwriting' });
  assert.equal(typeof criterion.id, 'string');
  assert.ok(criterion.id.length > 0);
  assert.equal(criterion.label, 'Neat handwriting');
  assert.equal(criterion.isSystemDetermined, false);
  assert.equal(criterion.isCustom, false);
});

test('createNotebookReviewCriterion: an explicit id is preserved, never overwritten — needed so a stored criterion round-trips unchanged', () => {
  const criterion = createNotebookReviewCriterion({ id: 'fixed-id', label: 'Organization' });
  assert.equal(criterion.id, 'fixed-id');
});

test('createNotebookReviewCriterion: two criteria with no explicit id get different real ids', () => {
  const a = createNotebookReviewCriterion({ label: 'A' });
  const b = createNotebookReviewCriterion({ label: 'B' });
  assert.notEqual(a.id, b.id);
});

test('DEFAULT_NOTEBOOK_REVIEW_CRITERIA: exactly 4 seeded criteria, exactly one of them system-determined (Timely submission)', () => {
  assert.equal(DEFAULT_NOTEBOOK_REVIEW_CRITERIA.length, 4);
  const systemDetermined = DEFAULT_NOTEBOOK_REVIEW_CRITERIA.filter((c) => c.isSystemDetermined);
  assert.equal(systemDetermined.length, 1);
  assert.equal(systemDetermined[0].key, TIMELY_SUBMISSION_CRITERION_KEY);
  assert.equal(systemDetermined[0].label, 'Timely submission');
});

test('DEFAULT_NOTEBOOK_REVIEW_CRITERIA: the other 3 defaults match the documented product requirement exactly', () => {
  const labels = DEFAULT_NOTEBOOK_REVIEW_CRITERIA.map((c) => c.label);
  assert.ok(labels.includes('Neat handwriting'));
  assert.ok(labels.includes('Organization'));
  assert.ok(labels.includes('Punctuation and sentence rules'));
});
