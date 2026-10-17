/**
 * tests/functions/learningHubAuth.test.js
 *
 * Real Auth-emulator tests for functions/src/learningHubAuth.js — the
 * one piece of the trusted endpoint responsible for verifying that a
 * Firebase ID token genuinely came from Learning Hub's own Firebase
 * project, not merely that it's a well-formed JWT.
 *
 * Tokens are minted via the REAL Auth emulator wire protocol (custom
 * token -> signInWithCustomToken exchange, see emulatorAuthHelpers.js)
 * — not hand-rolled JWTs — so what's proven is the actual Admin SDK
 * verification behavior, not a reimplementation of it.
 *
 * A single running Auth emulator instance issues every token in this
 * file under one ambient project id (whatever `--project` it was
 * started with). "Correct project" vs "wrong project" is therefore
 * expressed by which project id THE VERIFIER is configured to expect
 * (LEARNING_HUB_FIREBASE_PROJECT_ID), not by running two emulators —
 * this exercises the exact same audience-pinning code path either way:
 * a real token is accepted only when the verifier's configured
 * expected project matches the token's actual audience, and rejected
 * otherwise, with no distinguishing error information leaked.
 *
 * Requires the Auth + Firestore emulators running
 * (`firebase emulators:start --only firestore,auth --project
 * demo-classmate-bridge-test-endpoint`).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mintEmulatorIdToken } from './emulatorAuthHelpers.js';

const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const EMULATOR_PROJECT_ID = 'demo-classmate-bridge-test-endpoint'; // whatever the running emulator was started with
const WRONG_PROJECT_ID = 'demo-a-completely-different-project';

let verifyLearningHubIdToken;

before(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = EMULATOR_PROJECT_ID;
  ({ verifyLearningHubIdToken } = await import('../../functions/src/learningHubAuth.js'));
});

test('a real, valid token from the correctly-configured project verifies to the right uid', async () => {
  process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = EMULATOR_PROJECT_ID;
  const token = await mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: EMULATOR_PROJECT_ID, uid: 'lh-real-uid-1' });
  const uid = await verifyLearningHubIdToken(token);
  assert.equal(uid, 'lh-real-uid-1');
});

test('missing token (empty string) fails closed', async () => {
  assert.equal(await verifyLearningHubIdToken(''), null);
});

test('a garbage/malformed token string fails closed', async () => {
  assert.equal(await verifyLearningHubIdToken('this-is-not-a-jwt-at-all'), null);
});

test('a non-string token input fails closed rather than throwing', async () => {
  assert.equal(await verifyLearningHubIdToken(undefined), null);
  assert.equal(await verifyLearningHubIdToken(null), null);
  assert.equal(await verifyLearningHubIdToken(12345), null);
});

test('a real, well-formed, unexpired token whose actual audience does not match what the verifier is configured to expect fails closed (the "wrong Firebase project" case)', async () => {
  const token = await mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: EMULATOR_PROJECT_ID, uid: 'lh-real-uid-2' });
  process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = WRONG_PROJECT_ID;
  try {
    const uid = await verifyLearningHubIdToken(token);
    assert.equal(uid, null);
  } finally {
    process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = EMULATOR_PROJECT_ID;
  }
});

test('a caller cannot distinguish "wrong project" from "garbage token" from the return value alone (both are the identical null)', async () => {
  const wrongProjectToken = await mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: EMULATOR_PROJECT_ID, uid: 'lh-real-uid-3' });
  process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = WRONG_PROJECT_ID;
  try {
    const resultA = await verifyLearningHubIdToken(wrongProjectToken);
    const resultB = await verifyLearningHubIdToken('garbage');
    assert.equal(resultA, resultB);
    assert.equal(resultA, null);
  } finally {
    process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = EMULATOR_PROJECT_ID;
  }
});

test('LEARNING_HUB_FIREBASE_PROJECT_ID unset fails closed by throwing, rather than silently verifying against ClassMate\'s own default project', async () => {
  const previous = process.env.LEARNING_HUB_FIREBASE_PROJECT_ID;
  delete process.env.LEARNING_HUB_FIREBASE_PROJECT_ID;
  try {
    await assert.rejects(() => verifyLearningHubIdToken('anything'));
  } finally {
    process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = previous;
  }
});
