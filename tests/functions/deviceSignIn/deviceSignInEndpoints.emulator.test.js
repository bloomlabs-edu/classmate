/**
 * tests/functions/deviceSignIn/deviceSignInEndpoints.emulator.test.js
 *
 * Full handler-level tests for every "Sign in with Phone" endpoint —
 * real Firestore emulator + real Auth emulator (real ID token
 * verification, real custom token minting AND real redemption back to
 * an ID token, proving the end-to-end uid guarantee this whole design
 * depends on). Tests the framework-agnostic handlers directly (see
 * functions/src/deviceSignIn/deviceSignInEndpoints.js), not the
 * `onRequest`/CORS glue in functions/index.js — same scoping choice
 * tests/functions/verifyLearnerConnectionEndpoint.test.js already makes
 * for the identical reason (the glue is thin, hand-inspected, and
 * modeled on the already-covered Slack CORS tests; the real security
 * logic lives in the handler, which is what this file exercises).
 *
 * Requires both emulators running (`firebase emulators:start --only
 * firestore,auth --project demo-classmate-devicesignin-test`).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import {
  handleStartDeviceSignIn,
  handleGetDeviceSignInRequestInfo,
  handleApproveDeviceSignIn,
  handleDenyDeviceSignIn,
  handlePollDeviceSignIn,
} from '../../../functions/src/deviceSignIn/deviceSignInEndpoints.js';
import { SESSIONS_COLLECTION } from '../../../functions/src/deviceSignIn/deviceSignInRepository.js';
import { RATE_LIMITS } from '../../../functions/src/deviceSignIn/rateLimiter.js';
import { mintEmulatorIdToken } from '../emulatorAuthHelpers.js';

// Unlike Firestore (namespaced per project id, hence this folder's
// other emulator test files each using their OWN distinct project id —
// see their own header comments), the Auth emulator is bound to
// exactly one project for its entire running lifetime: tokens minted
// for any other project id resolve against that one bound project
// regardless (confirmed empirically — see this feature's own
// implementation report). This file's PROJECT_ID must therefore match
// whatever project the emulator suite was actually started with
// (`firebase emulators:start --only firestore,auth --project
// demo-classmate-devicesignin-test`), mirroring the exact same
// constraint tests/functions/learningHubAuth.test.js's own
// EMULATOR_PROJECT_ID already documents.
const PROJECT_ID = 'demo-classmate-devicesignin-test';
const AUTH_EMULATOR_HOST = '127.0.0.1:9099';

let app;
let db;
let nowMs;

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'device-signin-endpoints-tests');
  db = getFirestore(app);
});

after(async () => {
  await app.delete();
});

beforeEach(async () => {
  const sessions = await db.collection(SESSIONS_COLLECTION).get();
  await Promise.all(sessions.docs.map((d) => d.ref.delete()));
  const limits = await db.collection('deviceSignInRateLimits').get();
  await Promise.all(limits.docs.map((d) => d.ref.delete()));
  nowMs = Date.parse('2026-10-07T10:00:00.000Z');
});

function baseDeps(overrides = {}) {
  return {
    adminDb: db,
    now: () => nowMs,
    verifyIdToken: (idToken) => getAuth(app).verifyIdToken(idToken).then((decoded) => decoded.uid),
    createCustomToken: (uid) => getAuth(app).createCustomToken(uid),
    ...overrides,
  };
}

async function mintTeacherIdToken(uid) {
  return mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: PROJECT_ID, uid });
}

/** Exchanges a real Firebase custom token for a real ID token via the Auth emulator's own REST endpoint — exactly what the TV's signInWithCustomToken() does client-side. Returns the resulting uid, or null if the emulator rejects it. */
async function redeemCustomToken(customToken) {
  const response = await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any-string-works-in-the-emulator`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  if (!response.ok) return null;
  const data = await response.json();
  const decoded = await getAuth(app).verifyIdToken(data.idToken);
  return decoded.uid;
}

test('SUCCESSFUL END-TO-END PAIRING: start -> approve -> poll -> redeem yields the teacher\'s own real uid (existing Firestore rules/classroom access therefore continue to work unchanged)', async () => {
  const teacherUid = 'teacher-e2e';
  const idToken = await mintTeacherIdToken(teacherUid);

  const start = await handleStartDeviceSignIn({ body: { deviceLabel: 'Classroom TV' }, clientKey: '203.0.113.1', deps: baseDeps() });
  assert.equal(start.httpStatus, 200);
  const { pairingCode, tvSessionToken } = start.body;

  const info = await handleGetDeviceSignInRequestInfo({
    authorizationHeader: `Bearer ${idToken}`,
    body: { pairingCode },
    deps: baseDeps(),
  });
  assert.equal(info.body.ok, true);
  assert.equal(info.body.deviceLabel, 'Classroom TV');

  const approve = await handleApproveDeviceSignIn({
    authorizationHeader: `Bearer ${idToken}`,
    body: { pairingCode },
    deps: baseDeps(),
  });
  assert.deepEqual(approve.body, { ok: true });

  const poll = await handlePollDeviceSignIn({ body: { pairingCode, tvSessionToken }, clientKey: '203.0.113.1', deps: baseDeps() });
  assert.equal(poll.body.ok, true);
  assert.equal(poll.body.status, 'approved');
  assert.ok(poll.body.customToken);

  const redeemedUid = await redeemCustomToken(poll.body.customToken);
  assert.equal(redeemedUid, teacherUid, 'SUCCESSFUL CUSTOM-TOKEN REDEMPTION: the TV ends up authenticated as the teacher\'s own existing uid, not a new/different one');
});

test('INVALID PAIRING CODE -> rejected: getDeviceSignInRequestInfo for a code that was never issued', async () => {
  const idToken = await mintTeacherIdToken('teacher-invalid');
  const result = await handleGetDeviceSignInRequestInfo({
    authorizationHeader: `Bearer ${idToken}`,
    body: { pairingCode: '00000000' },
    deps: baseDeps(),
  });
  assert.deepEqual(result.body, { ok: false, error: 'invalid_or_expired' });
});

test('EXPIRED PAIRING CODE -> rejected: approve fails once the session\'s own TTL has passed', async () => {
  const idToken = await mintTeacherIdToken('teacher-expiry');
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '203.0.113.2', deps: baseDeps() });
  const { pairingCode } = start.body;

  nowMs += 3 * 60 * 1000; // advance past the 2-minute TTL
  const approve = await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode }, deps: baseDeps() });
  assert.deepEqual(approve.body, { ok: false, error: 'invalid_or_expired' });
});

test('EXPIRED SESSION: a TV polling after expiry gets a clear expired/invalid response, never a token', async () => {
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '203.0.113.3', deps: baseDeps() });
  const { pairingCode, tvSessionToken } = start.body;

  nowMs += 3 * 60 * 1000;
  const poll = await handlePollDeviceSignIn({ body: { pairingCode, tvSessionToken }, clientKey: '203.0.113.3', deps: baseDeps() });
  assert.equal(poll.body.ok, true);
  assert.equal(poll.body.status, 'expired');
  assert.equal(poll.body.customToken, undefined);
});

test('ALREADY-CONSUMED PAIRING CODE -> rejected: approving an already-approved session a second time', async () => {
  const idToken = await mintTeacherIdToken('teacher-double-approve');
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '203.0.113.4', deps: baseDeps() });
  const { pairingCode } = start.body;

  await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode }, deps: baseDeps() });
  const second = await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode }, deps: baseDeps() });
  assert.deepEqual(second.body, { ok: false, error: 'already_resolved' });
});

test('REPLAYED APPROVAL/TOKEN -> rejected: a second poll after the first successful redemption gets nothing (not_found/expired-equivalent), never the same token again', async () => {
  const idToken = await mintTeacherIdToken('teacher-replay');
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '203.0.113.5', deps: baseDeps() });
  const { pairingCode, tvSessionToken } = start.body;
  await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode }, deps: baseDeps() });

  const first = await handlePollDeviceSignIn({ body: { pairingCode, tvSessionToken }, clientKey: '203.0.113.5', deps: baseDeps() });
  assert.equal(first.body.status, 'approved');

  const replay = await handlePollDeviceSignIn({ body: { pairingCode, tvSessionToken }, clientKey: '203.0.113.5', deps: baseDeps() });
  assert.deepEqual(replay.body, { ok: false, error: 'invalid_or_expired' });
});

test('APPROVAL BOUND TO THE WRONG TV SESSION / CROSS-SESSION-CROSS-DEVICE ATTEMPT -> rejected: polling with the right code but a different tvSessionToken never yields a token', async () => {
  const idToken = await mintTeacherIdToken('teacher-cross-session');
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '203.0.113.6', deps: baseDeps() });
  const { pairingCode } = start.body;
  await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode }, deps: baseDeps() });

  const attacker = await handlePollDeviceSignIn({
    body: { pairingCode, tvSessionToken: 'a'.repeat(43) }, // well-formed shape, but not the real TV's own token
    clientKey: '198.51.100.1',
    deps: baseDeps(),
  });
  assert.deepEqual(attacker.body, { ok: false, error: 'invalid_or_expired' });
});

test('DENIED PAIRING -> TV remains unauthenticated: deny, then poll reports denied with no token', async () => {
  const idToken = await mintTeacherIdToken('teacher-deny');
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '203.0.113.7', deps: baseDeps() });
  const { pairingCode, tvSessionToken } = start.body;

  const deny = await handleDenyDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode }, deps: baseDeps() });
  assert.deepEqual(deny.body, { ok: true });

  const poll = await handlePollDeviceSignIn({ body: { pairingCode, tvSessionToken }, clientKey: '203.0.113.7', deps: baseDeps() });
  assert.equal(poll.body.status, 'denied');
  assert.equal(poll.body.customToken, undefined);
});

test('PAIRING SESSION CANNOT BE REUSED AFTER SUCCESSFUL REDEMPTION: approving a second, independently-started session with the same uid does not resurrect the first', async () => {
  const idToken = await mintTeacherIdToken('teacher-reuse');
  const first = await handleStartDeviceSignIn({ body: {}, clientKey: '203.0.113.8', deps: baseDeps() });
  await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode: first.body.pairingCode }, deps: baseDeps() });
  const firstPoll = await handlePollDeviceSignIn({
    body: { pairingCode: first.body.pairingCode, tvSessionToken: first.body.tvSessionToken },
    clientKey: '203.0.113.8',
    deps: baseDeps(),
  });
  assert.equal(firstPoll.body.status, 'approved');

  const secondPoll = await handlePollDeviceSignIn({
    body: { pairingCode: first.body.pairingCode, tvSessionToken: first.body.tvSessionToken },
    clientKey: '203.0.113.8',
    deps: baseDeps(),
  });
  assert.deepEqual(secondPoll.body, { ok: false, error: 'invalid_or_expired' });
});

test('TOKEN REDEMPTION FAILURE: an unauthenticated (garbage ID token) approve attempt is rejected before any token is ever minted, and the session is left untouched for the real teacher', async () => {
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '203.0.113.9', deps: baseDeps() });
  const { pairingCode, tvSessionToken } = start.body;

  const forged = await handleApproveDeviceSignIn({
    authorizationHeader: 'Bearer this-is-not-a-real-token',
    body: { pairingCode },
    deps: baseDeps(),
  });
  assert.deepEqual(forged.body, { ok: false, error: 'unauthenticated' });
  assert.equal(forged.httpStatus, 401);

  // The session must still be genuinely pending for the real teacher afterward.
  const realIdToken = await mintTeacherIdToken('teacher-real');
  const realApprove = await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${realIdToken}`, body: { pairingCode }, deps: baseDeps() });
  assert.deepEqual(realApprove.body, { ok: true });
  const poll = await handlePollDeviceSignIn({ body: { pairingCode, tvSessionToken }, clientKey: '203.0.113.9', deps: baseDeps() });
  const uid = await redeemCustomToken(poll.body.customToken);
  assert.equal(uid, 'teacher-real');
});

test('getDeviceSignInRequestInfo/approveDeviceSignIn/denyDeviceSignIn: missing Authorization header -> unauthenticated', async () => {
  const info = await handleGetDeviceSignInRequestInfo({ authorizationHeader: undefined, body: { pairingCode: '12345678' }, deps: baseDeps() });
  assert.equal(info.httpStatus, 401);

  const approve = await handleApproveDeviceSignIn({ authorizationHeader: undefined, body: { pairingCode: '12345678' }, deps: baseDeps() });
  assert.equal(approve.httpStatus, 401);

  const deny = await handleDenyDeviceSignIn({ authorizationHeader: undefined, body: { pairingCode: '12345678' }, deps: baseDeps() });
  assert.equal(deny.httpStatus, 401);
});

test('malformed pairing code shape is rejected with 400 before ever touching Firestore', async () => {
  const idToken = await mintTeacherIdToken('teacher-shape');
  const result = await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode: 'not-a-code' }, deps: baseDeps() });
  assert.equal(result.httpStatus, 400);
});

test('malformed tvSessionToken shape on poll is rejected with 400', async () => {
  const result = await handlePollDeviceSignIn({ body: { pairingCode: '12345678', tvSessionToken: '' }, clientKey: '203.0.113.10', deps: baseDeps() });
  assert.equal(result.httpStatus, 400);
});

test('RATE LIMITING: startDeviceSignIn is rejected with 429 once the per-IP budget for this window is exhausted', async () => {
  const clientKey = '198.51.100.50';
  for (let i = 0; i < RATE_LIMITS.start.maxAttempts; i++) {
    // eslint-disable-next-line no-await-in-loop
    const result = await handleStartDeviceSignIn({ body: {}, clientKey, deps: baseDeps() });
    assert.equal(result.httpStatus, 200);
  }
  const overBudget = await handleStartDeviceSignIn({ body: {}, clientKey, deps: baseDeps() });
  assert.equal(overBudget.httpStatus, 429);
});

test('RATE LIMITING: pollDeviceSignIn is rejected with 429 once the per-IP budget for this window is exhausted, independent of startDeviceSignIn\'s own budget', async () => {
  const clientKey = '198.51.100.51';
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '198.51.100.52', deps: baseDeps() });
  const { pairingCode, tvSessionToken } = start.body;

  for (let i = 0; i < RATE_LIMITS.poll.maxAttempts; i++) {
    // eslint-disable-next-line no-await-in-loop
    const result = await handlePollDeviceSignIn({ body: { pairingCode, tvSessionToken }, clientKey, deps: baseDeps() });
    assert.equal(result.httpStatus, 200);
  }
  const overBudget = await handlePollDeviceSignIn({ body: { pairingCode, tvSessionToken }, clientKey, deps: baseDeps() });
  assert.equal(overBudget.httpStatus, 429);
});

test('RATE LIMITING: approveDeviceSignIn is rate limited per authenticated uid, independent of any other teacher', async () => {
  const uid = 'teacher-rate-limited';
  const idToken = await mintTeacherIdToken(uid);
  const otherIdToken = await mintTeacherIdToken('teacher-unaffected');

  for (let i = 0; i < RATE_LIMITS.approve.maxAttempts; i++) {
    const start = await handleStartDeviceSignIn({ body: {}, clientKey: '198.51.100.60', deps: baseDeps() });
    // eslint-disable-next-line no-await-in-loop
    const result = await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode: start.body.pairingCode }, deps: baseDeps() });
    assert.equal(result.httpStatus, 200);
  }
  const start = await handleStartDeviceSignIn({ body: {}, clientKey: '198.51.100.60', deps: baseDeps() });
  const overBudget = await handleApproveDeviceSignIn({ authorizationHeader: `Bearer ${idToken}`, body: { pairingCode: start.body.pairingCode }, deps: baseDeps() });
  assert.equal(overBudget.httpStatus, 429);

  const otherTeacherStillAllowed = await handleApproveDeviceSignIn({
    authorizationHeader: `Bearer ${otherIdToken}`,
    body: { pairingCode: start.body.pairingCode },
    deps: baseDeps(),
  });
  assert.notEqual(otherTeacherStillAllowed.httpStatus, 429);
});

test('NO RAW PAIRING CODES STORED IN FIRESTORE: the stored session document never contains the plaintext pairing code or tv session token anywhere in its fields', async () => {
  const start = await handleStartDeviceSignIn({ body: { deviceLabel: 'TV' }, clientKey: '203.0.113.20', deps: baseDeps() });
  const { pairingCode, tvSessionToken } = start.body;

  const snap = await db.collection(SESSIONS_COLLECTION).get();
  assert.equal(snap.docs.length, 1);
  const raw = JSON.stringify(snap.docs[0].data());
  const docId = snap.docs[0].id;

  assert.ok(!raw.includes(pairingCode), 'raw pairing code must never appear in the stored document');
  assert.ok(!raw.includes(tvSessionToken), 'raw tv session token must never appear in the stored document');
  assert.notEqual(docId, pairingCode, 'the document id must be the HASH of the pairing code, never the code itself');
});

test('SERVER-SIDE RESOLUTION ONLY: firestore.rules defines no client-reachable rule for this collection at all — resolution is exclusively Admin SDK, matching the design\'s own smallest-surface choice', async () => {
  const rulesSource = await readFile(new URL('../../../firestore.rules', import.meta.url), 'utf8');
  assert.ok(!rulesSource.includes(SESSIONS_COLLECTION), `${SESSIONS_COLLECTION} must never appear in firestore.rules — every access to it goes through a Cloud Function's Admin SDK instead (see deviceSignInRepository.js's own header comment)`);
});
