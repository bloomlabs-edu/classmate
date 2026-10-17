/**
 * tests/functions/slack/slackIntegrationRepository.emulator.test.js
 *
 * Real Firestore-emulator tests for
 * functions/src/slack/slackIntegrationRepository.js — proves the admin
 * write/read shape actually round-trips through real Firestore
 * (not just a mock), and that ONLY the four approved fields
 * (slackUserId, slackTeamId, connectedAt, disconnectedAt) ever land on
 * the document — see
 * docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md §4.
 *
 * Requires the Firestore emulator running (`firebase emulators:start
 * --only firestore --project demo-classmate-slack-test`).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getActiveSlackIntegration, saveSlackIntegration } from '../../../functions/src/slack/slackIntegrationRepository.js';

const PROJECT_ID = 'demo-classmate-slack-test';

let app;
let db;

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'slack-integration-repository-tests');
  db = getFirestore(app);
});

after(async () => {
  await app.delete();
});

beforeEach(async () => {
  const snap = await db.collection('users').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

test('getActiveSlackIntegration returns null when the teacher has never connected', async () => {
  assert.equal(await getActiveSlackIntegration(db, 'teacher-1'), null);
});

test('saveSlackIntegration writes exactly the four approved fields, nothing more', async () => {
  await saveSlackIntegration(db, 'teacher-1', { slackUserId: 'U123', slackTeamId: 'T456', connectedAt: '2026-09-22T00:00:00.000Z' });

  const snap = await db.collection('users').doc('teacher-1').get();
  const integration = snap.data().slackIntegration;
  assert.deepEqual(Object.keys(integration).sort(), ['connectedAt', 'disconnectedAt', 'slackTeamId', 'slackUserId']);
  assert.equal(integration.slackUserId, 'U123');
  assert.equal(integration.slackTeamId, 'T456');
  assert.equal(integration.disconnectedAt, null);
});

test('getActiveSlackIntegration returns the saved link', async () => {
  await saveSlackIntegration(db, 'teacher-1', { slackUserId: 'U123', slackTeamId: 'T456', connectedAt: '2026-09-22T00:00:00.000Z' });
  const integration = await getActiveSlackIntegration(db, 'teacher-1');
  assert.equal(integration.slackUserId, 'U123');
});

test('a disconnected link (disconnectedAt set) is treated as not connected', async () => {
  await saveSlackIntegration(db, 'teacher-1', { slackUserId: 'U123', slackTeamId: 'T456', connectedAt: '2026-09-22T00:00:00.000Z' });
  await db.collection('users').doc('teacher-1').update({ 'slackIntegration.disconnectedAt': '2026-09-23T00:00:00.000Z' });
  assert.equal(await getActiveSlackIntegration(db, 'teacher-1'), null);
});

test('reconnecting resets disconnectedAt back to null and refreshes connectedAt', async () => {
  await saveSlackIntegration(db, 'teacher-1', { slackUserId: 'U123', slackTeamId: 'T456', connectedAt: '2026-09-22T00:00:00.000Z' });
  await db.collection('users').doc('teacher-1').update({ 'slackIntegration.disconnectedAt': '2026-09-23T00:00:00.000Z' });

  await saveSlackIntegration(db, 'teacher-1', { slackUserId: 'U123', slackTeamId: 'T456', connectedAt: '2026-09-24T00:00:00.000Z' });
  const integration = await getActiveSlackIntegration(db, 'teacher-1');
  assert.equal(integration.disconnectedAt, null);
  assert.equal(integration.connectedAt, '2026-09-24T00:00:00.000Z');
});

test('saving Slack integration for one teacher never touches another teacher\'s own document', async () => {
  await db.collection('users').doc('teacher-2').set({ someOtherField: 'untouched' });
  await saveSlackIntegration(db, 'teacher-1', { slackUserId: 'U123', slackTeamId: 'T456', connectedAt: '2026-09-22T00:00:00.000Z' });

  const other = await db.collection('users').doc('teacher-2').get();
  assert.equal(other.data().someOtherField, 'untouched');
  assert.equal(other.data().slackIntegration, undefined);
});
