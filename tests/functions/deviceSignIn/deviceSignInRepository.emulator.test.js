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
const LATER = '2026-10-07T10:02:00.000Z'; // +2 minutes — an arbitrary not-yet-expired future instant; these repository functions take expiresAtIso/nowIso as explicit params, so this need not track PAIRING_SESSION_TTL_MS itself (that constant is only consumed in deviceSignInEndpoints.js)
const JUST_BEFORE_EXPIRY = '2026-10-07T10:01:59.000Z'; // 1s before LATER, when LATER is used as expiresAtIso
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
  assert.deepEqual(info, { deviceLabel: 'Classroom TV', createdAt: NOW, expiresAt: LATER });
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

test('consumeApprovedSession: EXPIRED PAIRING CODE -> rejected; the FIRST poll to notice records real `expired` status (an UPDATE, NOT a delete — this is the actual race fix)', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: PAST_EXPIRY });

  const result = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: LATER });
  assert.deepEqual(result, { ok: false, reason: 'expired' });

  // The document must still exist, now as the real terminal `expired`
  // status — NOT deleted. This is what closes the production race: a
  // concurrent Approve attempt landing right after this poll must find
  // a real, observable `expired` state, never a vanished document it
  // would otherwise misreport as `not_found`.
  const snap = await db.collection(SESSIONS_COLLECTION).doc(codeHash).get();
  assert.ok(snap.exists, 'a routine poll discovering expiry must record it via UPDATE, never DELETE the document');
  assert.equal(snap.data().status, 'expired');

  // A SECOND poll, now observing the already-recorded terminal state, is
  // the one that performs cleanup.
  const second = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: LATER });
  assert.deepEqual(second, { ok: false, reason: 'expired' });
  const snapAfterSecondPoll = await db.collection(SESSIONS_COLLECTION).doc(codeHash).get();
  assert.equal(snapAfterSecondPoll.exists, false, 'cleanup happens once the terminal state has already been observed once, not on the poll that discovers it');
});

test('REQUIREMENT A — pending + before expiry: a routine TV poll does not expire the session, and Approve still succeeds afterward', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });

  // A routine poll, still comfortably before expiresAt.
  const poll = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: JUST_BEFORE_EXPIRY });
  assert.deepEqual(poll, { ok: false, reason: 'pending' });

  const snap = await db.collection(SESSIONS_COLLECTION).doc(codeHash).get();
  assert.equal(snap.data().status, 'pending', 'a poll before expiry must never alter status');

  // Approve, moments later but still before expiresAt, must still succeed.
  const approve = await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-a', nowIso: JUST_BEFORE_EXPIRY });
  assert.deepEqual(approve, { ok: true });
});

test('REQUIREMENT B — pending + after expiry: a TV poll transitions the session to EXPIRED (not deleted), and a subsequent Approve attempt fails cleanly, never silently', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });

  const pollAfterExpiry = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: '2026-10-07T10:03:00.000Z' });
  assert.deepEqual(pollAfterExpiry, { ok: false, reason: 'expired' });

  const snap = await db.collection(SESSIONS_COLLECTION).doc(codeHash).get();
  assert.ok(snap.exists, 'the poll must not silently delete the session');
  assert.equal(snap.data().status, 'expired');

  const approveAfterward = await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-b', nowIso: '2026-10-07T10:03:00.000Z' });
  assert.deepEqual(approveAfterward, { ok: false, reason: 'expired' }, 'approval after authoritative server expiry must still be rejected — cleanly, with a real reason, never a misleading not_found');
});

test('REQUIREMENT C1 — a legitimate approval that commits BEFORE a concurrent poll observes expiry must not be destroyed by that poll', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });

  // Approve commits first, still before expiresAt.
  const approve = await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-c1', nowIso: JUST_BEFORE_EXPIRY });
  assert.deepEqual(approve, { ok: true });

  // A poll arriving AFTER expiresAt must still find and deliver the
  // already-approved token — an approved session is never re-subject to
  // the TTL check (see consumeApprovedSession()'s own point 4).
  const pollAfterExpiry = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: '2026-10-07T10:03:00.000Z' });
  assert.deepEqual(pollAfterExpiry, { ok: true, customToken: 'tok-c1' });
});

test('REQUIREMENT C2 — once a poll has recorded expiry, approval deterministically fails; it can never "win" after the server has already observed the TTL elapsed', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });

  const poll = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: '2026-10-07T10:03:00.000Z' });
  assert.deepEqual(poll, { ok: false, reason: 'expired' });

  const approve = await approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-c2', nowIso: '2026-10-07T10:03:00.000Z' });
  assert.deepEqual(approve, { ok: false, reason: 'expired' });
});

test('REQUIREMENT C3 — a genuine concurrent race between Approve and a just-past-expiry poll produces exactly one deterministic, safe outcome', async () => {
  const codeHash = freshCodeHash();
  const tvSessionTokenHash = freshTokenHash();
  await createSession(db, { codeHash, tvSessionTokenHash, deviceLabel: 'TV', nowIso: NOW, expiresAtIso: LATER });

  // Both transactions start from the same still-pending snapshot and
  // race to commit: one observes "just before expiry" (approve), the
  // other "just after" (poll). Firestore's transaction retry-on-conflict
  // semantics guarantee exactly one of these commits first and the other
  // retries against the now-changed document — never a lost update, and
  // never a state where the poll destroys a decision the approve call
  // already made (or vice versa).
  const [approveResult, pollResult] = await Promise.all([
    approveSession(db, { codeHash, approvedByUid: 'teacher-1', customToken: 'tok-c3', nowIso: JUST_BEFORE_EXPIRY }),
    consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: '2026-10-07T10:03:00.000Z' }),
  ]);

  // Exactly two safe, mutually-consistent outcomes are possible
  // depending on commit order — approve-wins (poll then immediately
  // collects the real token) or expiry-wins (approve is cleanly
  // rejected as expired). Both are secure; what must NEVER happen is a
  // lost/ambiguous update, a thrown error reaching the caller, or the
  // poll reporting anything other than 'pending'/'expired'/ok:true.
  const approveWon = approveResult.ok === true;
  if (approveWon) {
    assert.deepEqual(pollResult, { ok: true, customToken: 'tok-c3' }, 'if approve committed first, the poll must deliver that exact token');
  } else {
    assert.deepEqual(approveResult, { ok: false, reason: 'expired' }, 'if approve lost the race to expiry, it must fail with a real, clean reason — never not_found');
    assert.ok(pollResult.reason === 'expired' || pollResult.ok === true, 'the poll itself must land on a well-defined terminal outcome either way');
  }

  // Whichever outcome occurred, the pairing session must never be left
  // retrievable as a usable, unconsumed token afterward (single-use
  // guarantee preserved under real concurrency).
  const followUpPoll = await consumeApprovedSession(db, { codeHash, tvSessionTokenHash, nowIso: '2026-10-07T10:04:00.000Z' });
  assert.notEqual(followUpPoll.ok, true, 'no token may be collectible twice, regardless of which side of the race won');
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
