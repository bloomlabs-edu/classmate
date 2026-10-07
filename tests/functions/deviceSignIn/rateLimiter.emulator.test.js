/**
 * tests/functions/deviceSignIn/rateLimiter.emulator.test.js
 *
 * Real Firestore-emulator tests for
 * functions/src/deviceSignIn/rateLimiter.js. Requires the Firestore
 * emulator running (`firebase emulators:start --only firestore --project
 * demo-classmate-devicesignin-test`).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { checkAndRecordAttempt } from '../../../functions/src/deviceSignIn/rateLimiter.js';

// A distinct project id from the other deviceSignIn emulator test
// files — Firestore emulator data is namespaced per project id, so
// this keeps concurrent `node --test` runs of multiple files in this
// folder from clearing/colliding on each other's documents (the Auth
// emulator, unlike Firestore, IS bound to one single project for the
// life of the running emulator — see
// deviceSignInEndpoints.emulator.test.js's own header comment for why
// that file alone must match whatever project the emulator suite was
// actually started with).
const PROJECT_ID = 'demo-classmate-devicesignin-ratelimit-test';

let app;
let db;

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'rate-limiter-tests');
  db = getFirestore(app);
});

after(async () => {
  await app.delete();
});

beforeEach(async () => {
  const snap = await db.collection('deviceSignInRateLimits').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

test('the first attempt in a fresh window is always allowed', async () => {
  const allowed = await checkAndRecordAttempt(db, 'bucket-a', { maxAttempts: 1, windowMs: 60000 }, 1000);
  assert.equal(allowed, true);
});

test('a second attempt within the same window, over budget, is rejected', async () => {
  await checkAndRecordAttempt(db, 'bucket-b', { maxAttempts: 1, windowMs: 60000 }, 1000);
  const allowed = await checkAndRecordAttempt(db, 'bucket-b', { maxAttempts: 1, windowMs: 60000 }, 2000);
  assert.equal(allowed, false);
});

test('attempts up to maxAttempts within one window are all allowed', async () => {
  const results = [];
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await checkAndRecordAttempt(db, 'bucket-c', { maxAttempts: 5, windowMs: 60000 }, 1000 + i));
  }
  assert.deepEqual(results, [true, true, true, true, true]);
});

test('the attempt immediately after maxAttempts, same window, is rejected', async () => {
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await checkAndRecordAttempt(db, 'bucket-d', { maxAttempts: 5, windowMs: 60000 }, 1000 + i);
  }
  const sixth = await checkAndRecordAttempt(db, 'bucket-d', { maxAttempts: 5, windowMs: 60000 }, 1005);
  assert.equal(sixth, false);
});

test('a fresh window (now - windowStart >= windowMs) resets the budget', async () => {
  await checkAndRecordAttempt(db, 'bucket-e', { maxAttempts: 1, windowMs: 60000 }, 1000);
  assert.equal(await checkAndRecordAttempt(db, 'bucket-e', { maxAttempts: 1, windowMs: 60000 }, 1000 + 60000), true);
});

test('two different bucket keys never share a budget', async () => {
  await checkAndRecordAttempt(db, 'start:1.2.3.4', { maxAttempts: 1, windowMs: 60000 }, 1000);
  const otherIp = await checkAndRecordAttempt(db, 'start:5.6.7.8', { maxAttempts: 1, windowMs: 60000 }, 1000);
  assert.equal(otherIp, true);
});

test('a bucket key containing characters unsafe for a Firestore document id (e.g. an IPv6 address) still works', async () => {
  const allowed = await checkAndRecordAttempt(db, 'poll:2001:db8::1', { maxAttempts: 1, windowMs: 60000 }, 1000);
  assert.equal(allowed, true);
});

test('an over-budget caller hammering repeatedly does not itself extend or reset the window', async () => {
  await checkAndRecordAttempt(db, 'bucket-f', { maxAttempts: 1, windowMs: 60000 }, 1000);
  await checkAndRecordAttempt(db, 'bucket-f', { maxAttempts: 1, windowMs: 60000 }, 1100); // rejected, should not reset anything
  await checkAndRecordAttempt(db, 'bucket-f', { maxAttempts: 1, windowMs: 60000 }, 1200); // also rejected
  // Still within the ORIGINAL window (started at 1000) at t=1200+59000=60200 — must remain rejected until the window truly elapses from its original start.
  const stillBlocked = await checkAndRecordAttempt(db, 'bucket-f', { maxAttempts: 1, windowMs: 60000 }, 1000 + 59000);
  assert.equal(stillBlocked, false);
  const windowElapsed = await checkAndRecordAttempt(db, 'bucket-f', { maxAttempts: 1, windowMs: 60000 }, 1000 + 60000);
  assert.equal(windowElapsed, true);
});
