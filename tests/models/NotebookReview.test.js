/**
 * tests/models/NotebookReview.test.js
 *
 * models/NotebookReview.js — one review-event record, its totalPoints
 * derivation, and getCurrentReview()'s "last one wins" lookup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotebookReview, getCurrentReview } from '../../js/models/NotebookReview.js';

test('createNotebookReview: totalPoints is derived from criteriaAwarded, never a separately-passed number', () => {
  const review = createNotebookReview({
    requestId: 'wr1',
    studentId: 'stu1',
    criteriaAwarded: [
      { criterionId: 'c1', label: 'Timely submission', points: 1 },
      { criterionId: 'c2', label: 'Neat handwriting', points: 1 },
    ],
  });
  assert.equal(review.totalPoints, 2);
});

test('createNotebookReview: zero criteria awarded is a real, valid review with totalPoints 0, never undefined/NaN', () => {
  const review = createNotebookReview({ requestId: 'wr1', studentId: 'stu1', criteriaAwarded: [] });
  assert.equal(review.totalPoints, 0);
  assert.deepEqual(review.criteriaAwarded, []);
});

test('createNotebookReview: generates a real id, and defaults supersedesReviewId/pointsEntryId to null', () => {
  const review = createNotebookReview({ requestId: 'wr1', studentId: 'stu1' });
  assert.equal(typeof review.id, 'string');
  assert.ok(review.id.length > 0);
  assert.equal(review.supersedesReviewId, null);
  assert.equal(review.pointsEntryId, null);
});

test('getCurrentReview: null for an entry with no reviews array at all (legacy "reviewed" entry from before this feature)', () => {
  assert.equal(getCurrentReview({ reviews: undefined }), null);
});

test('getCurrentReview: null for an entry with an empty reviews array', () => {
  assert.equal(getCurrentReview({ reviews: [] }), null);
});

test('getCurrentReview: always the LAST element — edits/resubmission reviews are appended, never inserted/replaced', () => {
  const first = createNotebookReview({ requestId: 'wr1', studentId: 'stu1', criteriaAwarded: [{ criterionId: 'c1', label: 'A', points: 1 }] });
  const second = createNotebookReview({ requestId: 'wr1', studentId: 'stu1', criteriaAwarded: [], supersedesReviewId: first.id });
  const entry = { reviews: [first, second] };
  assert.equal(getCurrentReview(entry).id, second.id);
});
