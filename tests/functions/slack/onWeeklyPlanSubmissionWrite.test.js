/**
 * tests/functions/slack/onWeeklyPlanSubmissionWrite.test.js
 *
 * Pure tests for handleWeeklyPlanSubmissionWrite() — the trigger's own
 * testable core, with fake deps standing in for Firestore reads and
 * the Slack API. Covers exactly the failure-handling cases this
 * feature's architecture proposal calls out by name: Case A (teacher
 * not connected), Case B (Slack API failure), Case D (only the right
 * transition sends, no duplicates).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWeeklyPlanSubmissionWrite } from '../../../functions/src/slack/onWeeklyPlanSubmissionWrite.js';

const SUBMISSION_AFTER = { teacherUid: 'teacher-1', classroomId: 'classroom-1', weekStartDate: '2026-09-21', status: 'submitted' };

function makeDeps(overrides = {}) {
  return {
    getActiveSlackIntegration: async () => ({ slackUserId: 'U123', slackTeamId: 'T456' }),
    getClassroomLabel: async () => 'Grade 8B',
    openDirectMessageChannel: async () => ({ ok: true, channelId: 'D123' }),
    postMessage: async () => ({ ok: true }),
    onError: () => {},
    ...overrides,
  };
}

test('Case D: an unrelated field write (status unchanged) sends nothing', async () => {
  const result = await handleWeeklyPlanSubmissionWrite({
    before: { ...SUBMISSION_AFTER },
    after: { ...SUBMISSION_AFTER, updatedAt: 'later' },
    deps: makeDeps(),
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not_notifiable');
});

test('draft status never sends, even for a brand-new document', async () => {
  const result = await handleWeeklyPlanSubmissionWrite({
    before: null,
    after: { ...SUBMISSION_AFTER, status: 'draft' },
    deps: makeDeps(),
  });
  assert.equal(result.sent, false);
});

test('Case A: teacher has not connected Slack — skipped silently, not an error', async () => {
  const result = await handleWeeklyPlanSubmissionWrite({
    before: null,
    after: SUBMISSION_AFTER,
    deps: makeDeps({ getActiveSlackIntegration: async () => null }),
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not_connected');
});

test('successful send for a genuine submitted transition', async () => {
  let dmOpenedFor = null;
  let messageSentTo = null;
  const result = await handleWeeklyPlanSubmissionWrite({
    before: null,
    after: SUBMISSION_AFTER,
    deps: makeDeps({
      openDirectMessageChannel: async (slackUserId) => {
        dmOpenedFor = slackUserId;
        return { ok: true, channelId: 'D123' };
      },
      postMessage: async (channelId, message) => {
        messageSentTo = { channelId, message };
        return { ok: true };
      },
    }),
  });
  assert.equal(result.sent, true);
  assert.equal(result.transition, 'submitted');
  assert.equal(dmOpenedFor, 'U123');
  assert.equal(messageSentTo.channelId, 'D123');
  assert.match(messageSentTo.message.text, /Grade 8B/);
});

test('Case B: Slack conversations.open failing does not throw, and reports why', async () => {
  const result = await handleWeeklyPlanSubmissionWrite({
    before: null,
    after: SUBMISSION_AFTER,
    deps: makeDeps({ openDirectMessageChannel: async () => ({ ok: false, error: 'account_inactive' }) }),
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'open_dm_rejected');
});

test('Case B: Slack chat.postMessage failing does not throw, and reports why', async () => {
  const result = await handleWeeklyPlanSubmissionWrite({
    before: null,
    after: SUBMISSION_AFTER,
    deps: makeDeps({ postMessage: async () => ({ ok: false, error: 'channel_not_found' }) }),
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'post_message_rejected');
});

test('Case B: a thrown network error from the Slack client does not propagate', async () => {
  const result = await handleWeeklyPlanSubmissionWrite({
    before: null,
    after: SUBMISSION_AFTER,
    deps: makeDeps({
      openDirectMessageChannel: async () => {
        throw new Error('network down');
      },
    }),
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'open_dm_failed');
});

test('a classroom lookup failure falls back to a generic label rather than failing the whole send', async () => {
  let messageSentTo = null;
  const result = await handleWeeklyPlanSubmissionWrite({
    before: null,
    after: SUBMISSION_AFTER,
    deps: makeDeps({
      getClassroomLabel: async () => {
        throw new Error('boom');
      },
      postMessage: async (channelId, message) => {
        messageSentTo = message;
        return { ok: true };
      },
    }),
  });
  assert.equal(result.sent, true);
  assert.match(messageSentTo.text, /your classroom/);
});

test('changes_requested and approved also notify (the actor, e.g. a PM, is never the recipient — the Fellow whose plan it is always is)', async () => {
  for (const status of ['changes_requested', 'approved']) {
    const result = await handleWeeklyPlanSubmissionWrite({
      before: { ...SUBMISSION_AFTER, status: 'submitted' },
      after: { ...SUBMISSION_AFTER, status },
      deps: makeDeps(),
    });
    assert.equal(result.sent, true);
    assert.equal(result.transition, status);
  }
});
