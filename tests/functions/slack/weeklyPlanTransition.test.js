/**
 * tests/functions/slack/weeklyPlanTransition.test.js
 *
 * Pure tests for the exact decision that keeps
 * functions/src/slack/onWeeklyPlanSubmissionWrite.js from sending a
 * duplicate DM on an unrelated field write, or any DM at all for
 * DRAFT — see that file's own header comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectNotifiableTransition } from '../../../functions/src/slack/weeklyPlanTransition.js';

test('a brand-new document created directly as submitted is notifiable', () => {
  assert.equal(detectNotifiableTransition(null, { status: 'submitted' }), 'submitted');
});

test('submitted -> changes_requested is notifiable', () => {
  assert.equal(detectNotifiableTransition({ status: 'submitted' }, { status: 'changes_requested' }), 'changes_requested');
});

test('changes_requested -> submitted (a resubmit) is notifiable', () => {
  assert.equal(detectNotifiableTransition({ status: 'changes_requested' }, { status: 'submitted' }), 'submitted');
});

test('submitted -> approved is notifiable', () => {
  assert.equal(detectNotifiableTransition({ status: 'submitted' }, { status: 'approved' }), 'approved');
});

test('draft is never notifiable, even as a brand-new document', () => {
  assert.equal(detectNotifiableTransition(null, { status: 'draft' }), null);
});

test('draft -> draft is not notifiable', () => {
  assert.equal(detectNotifiableTransition({ status: 'draft' }, { status: 'draft' }), null);
});

test('an unrelated field write with the SAME status does not re-notify', () => {
  assert.equal(
    detectNotifiableTransition({ status: 'approved', reviewerUid: 'a' }, { status: 'approved', reviewerUid: 'a', updatedAt: 'later' }),
    null
  );
});

test('a document delete (after is null) is not notifiable', () => {
  assert.equal(detectNotifiableTransition({ status: 'submitted' }, null), null);
});
