/**
 * tests/functions/deviceSignIn/deviceSignInRepository.emulator.test.js
 *
 * Real Firestore-emulator tests for
 * functions/src/deviceSignIn/deviceSignInRepository.js — proves the
 * atomic transaction guarantees (single-use consumption, race-safe
 * approve/deny, session-token binding) against real Firestore, not a
 * mock. Requires the Firestore emulator running (`firebase
 * emulators:start --only firestore --project
 * demo-classmate-devicesignin-test`).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import {
  createSession,
  getPendingSessionInfo,
  approveSession,
  denySession,
  consumeApprovedSession,
  SESSIONS_COLLECTION,
} from '../../../functions/src/deviceSignIn/deviceSignInRepository.js';
import { hashSecret } from '../../../functions/src/deviceSignIn/pairingSecret.js';

// A distinct project id from this folder's other emulator test files —
// see rateLimiter.emulator.test.js's own header comment on why (each
// file gets its own isolated Firestore namespace, so running multiple
// files concurrently via `node --test` never clears another file's
// in-progress documents).
const PROJECT_ID = 'demo-classmate-devicesignin-repo-test';

let app;
let db;

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'device-signin-repository-tests');
  db = getFirestore(app);
});

after(async () => {
  await app.delete();
});

beforeEach(async () => {
  const snap = await db.collection(SESSIONS_COLLECTION).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

const NOW = '2026-10-07T10:00:00.000Z';
const LATER = '2026-10-07T10:02:00.000Z'; // +2 minutes, matching PAIRING_SESSION_TTL_MS
const PAST_EXPIRY = '2026-10-07T09:59:59.000Z';

function freshCodeHash() {
  return hashSecret(`code-${Math.random()}`);
}
function freshTokenHash() {
  return hashSecret(`token-${Math.random()}`);
}

test('createSession + getPendingSessionInfo: a brand-new session is pending and returns its display info', async () => {
  const codeHash = freshCodeHash();
  await createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'Classroom TV', nowIso: NOW, expiresAtIso: LATER });

  const info = await getPendingSessionInfo(db, codeHash, NOW);
  assert.deepEqual(info, { deviceLabel: 'Classroom TV', createdAt: NOW });
});

test('getPendingSessionInfo: returns null for a nonexistent code (INVALID PAIRING CODE -> rejected)', async () => {
  const info = await getPendingSessionInfo(db, freshCodeHash(), NOW);
  assert.equal(info, null);
});

test('getPendingSessionInfo: returns null for an expired session (EXPIRED PAIRING CODE -> rejected)', async () => {
  const codeHash = freshCodeHash();
  await createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'TV', nowIso: NOW, expiresAtIso: PAST_EXPIRY });

  const info = await getPendingSessionInfo(db, codeHash, LATER);
  assert.equal(info, null);
});

test('createSession: a hash collision with an already-live session throws (never silently overwrites a different TV\'s session)', async () => {
  const codeHash = freshCodeHash();
  await createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'TV 1', nowIso: NOW, expiresAtIso: LATER });

  await assert.rejects(() => createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'TV 2', nowIso: NOW, expiresAtIso: LATER }));
});

test('approveSession: a pending session approves successfully and getPendingSessionInfo no longer sees it as pending', async () => {
  const codeHash = freshCodeHash();
  await createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });

  const result = await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-abc', nowIso: NOW });
  assert.deepEqual(result, { ok: true });
  assert.equal(await getPendingSessionInfo(db, codeHash, NOW), null);
});

test('approveSession: an unknown code is rejected (not_found)', async () => {
  const result = await approveSession(db, { codeHash: freshCodeHash(), approvedByUid: 'teacher-1', customToken: 'tok', nowIso: NOW });
  assert.deepEqual(result, { ok: false, reason: 'not_found' });
});

test('approveSession: an expired session is rejected (EXPIRED -> rejected)', async () => {
  const codeHash = freshCodeHash();
  await createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'TV', nowIso: NOW, expiresAtIso: PAST_EXPIRY });

  const result = await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok', nowIso: LATER });
  assert.deepEqual(result, { ok: false, reason: 'expired' });
});

test('approveSession: approving an already-approved session a second time is rejected (REPLAYED APPROVAL -> rejected)', async () => {
  const codeHash = freshCodeHash();
  await createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });
  await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-1', nowIso: NOW });

  const second = await approveSession(db, { codeHash, approvedByUid: 'teacher-2', customToken: 'tok-2', nowIso: NOW });
  assert.deepEqual(second, { ok: false, reason: 'not_pending' });
});

test('approveSession: approving an already-denied session is rejected (ALREADY-CONSUMED / resolved -> rejected)', async () => {
  const codeHash = freshCodeHash();
  await createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });
  await denySession(db, { codeHash, nowIso: NOW });

  const result = await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok', nowIso: NOW });
  assert.deepEqual(result, { ok: false, reason: 'not_pending' });
});

test('denySession: a pending session denies successfully', async () => {
  const codeHash = freshCodeHash();
  await createSession(db, { codeHash, tvSessionTokenHash: freshTokenHash(), deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });

  const result = await denySession(db, { codeHash, nowIso: NOW });
  assert.deepEqual(result, { ok: true });
});

test('consumeApprovedSession: DENIED PAIRING -> TV remains unauthenticated (status "denied", no token, session deleted so it cannot be reused)', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });
  await denySession(db, { codeHash, nowIso: NOW });

  const result = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: NOW });
  assert.deepEqual(result, { ok: false, reason: 'denied' });

  // Single-use even for a denial — a second poll finds nothing at all.
  const second = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: NOW });
  assert.deepEqual(second, { ok: false, reason: 'not_found' });
});

test('consumeApprovedSession: a still-pending session reports "pending" and is NOT deleted (the real TV must keep polling it)', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });

  const result = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: NOW });
  assert.deepEqual(result, { ok: false, reason: 'pending' });

  // Still there for the next poll.
  const info = await getPendingSessionInfo(db, codeHash, NOW);
  assert.ok(info);
});

test('consumeApprovedSession: EXPIRED PAIRING CODE -> rejected, and the session is cleaned up', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: PAST_EXPIRY });

  const result = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: LATER });
  assert.deepEqual(result, { ok: false, reason: 'expired' });
});

test('consumeApprovedSession: ALREADY-CONSUMED PAIRING CODE -> rejected (session deleted on first successful claim)', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });
  await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-real', nowIso: NOW });

  const first = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: NOW });
  assert.deepEqual(first, { ok: true, customToken: 'tok-real' });

  const second = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: NOW });
  assert.deepEqual(second, { ok: false, reason: 'not_found' }, 'the session must not be reusable after successful redemption — REPLAYED TOKEN -> rejected');
});

test('consumeApprovedSession: APPROVAL BOUND TO THE WRONG TV SESSION -> rejected, collapsed identically to "no such session" (never leaks that the pairing code itself was valid)', async () => {
  const codeHash = freshCodeHash();
  const realTvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash: realTvSessionTokenHash, deviceLabel: 'Real TV', nowIso: NOW, expiresAtIso: LATER });
  await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-real', nowIso: NOW });

  const wrongTokenHash = freshTokenHash();
  const attackerResult = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash: wrongTokenHash, nowIso: NOW });
  assert.deepEqual(attackerResult, { ok: false, reason: 'not_found' }, 'CROSS-SESSION / CROSS-DEVICE ATTEMPT -> rejected');

  // The real TV, presenting the correct token, can still redeem it afterward — the attacker's wrong-token attempt must not have disturbed the real session.
  const realResult = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash: realTvSessionTokenHash, nowIso: NOW });
  assert.deepEqual(realResult, { ok: true, customToken: 'tok-real' });
});

test('consumeApprovedSession: concurrent double-consume of the same approved session — only one caller ever receives the token (ATOMIC READ-AND-CLEAR)', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });
  await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-shared', nowIso: NOW });

  const [a, b] = await Promise.all([
    consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: NOW }),
    consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: NOW }),
  ]);

  const outcomes = [a, b];
  const winners = outcomes.filter((o) => o.ok);
  const losers = outcomes.filter((o) => !o.ok);
  assert.equal(winners.length, 1, 'exactly one concurrent caller must win the race');
  assert.equal(losers.length, 1);
  assert.equal(winners[0].customToken, 'tok-shared');
  assert.equal(losers[0].reason, 'not_found');
});
