/**
 * tests/services/studentGuidanceService.test.js
 *
 * services/studentGuidanceService.js's own buildGuidanceMessage() —
 * the "brief, constructive guidance" required by Workstream 1,
 * deliberately built from numbers already shown on the profile (never
 * a fabricated score-to-bucket threshold, since bucket assignment is a
 * teacher's own manual call, not score-derived — see that function's
 * own header comment).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGuidanceMessage } from '../../js/services/studentGuidanceService.js';

function profile(overrides = {}) {
  return { negativePoints: 0, netScore: 0, totalStars: 0, ...overrides };
}

function notebookStatus(overrides = {}) {
  return { summary: { awaitingSubmission: 0, awaitingReview: 0, needsCorrection: 0, reviewed: 0, absent: 0, ...overrides } };
}

test('negative points takes priority and names the exact count', () => {
  const message = buildGuidanceMessage(profile({ negativePoints: 3 }), notebookStatus({ awaitingSubmission: 2 }));
  assert.match(message, /3 negative points/);
});

test('negative points uses singular wording for exactly 1', () => {
  const message = buildGuidanceMessage(profile({ negativePoints: 1 }), notebookStatus());
  assert.match(message, /1 negative point(?!s)/);
});

test('with zero negative points, pending notebooks are surfaced instead', () => {
  const message = buildGuidanceMessage(profile({ negativePoints: 0 }), notebookStatus({ awaitingSubmission: 2 }));
  assert.match(message, /2 notebooks waiting/);
});

test('pending-notebook count uses singular wording for exactly 1', () => {
  const message = buildGuidanceMessage(profile({ negativePoints: 0 }), notebookStatus({ awaitingSubmission: 1 }));
  assert.match(message, /1 notebook waiting(?! on your submission notebooks)/);
});

test('with no negative points and nothing pending, a positive catch-up message is shown', () => {
  const message = buildGuidanceMessage(profile({ negativePoints: 0 }), notebookStatus({ awaitingSubmission: 0 }));
  assert.match(message, /all caught up/i);
});

test('never fabricates a bucket-threshold claim', () => {
  const message = buildGuidanceMessage(profile({ negativePoints: 5 }), notebookStatus({ awaitingSubmission: 5 }));
  assert.doesNotMatch(message, /bucket/i);
});
