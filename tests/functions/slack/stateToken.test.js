/**
 * tests/functions/slack/stateToken.test.js
 *
 * Pure tests, no emulator needed — functions/src/slack/stateToken.js
 * has no I/O of its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateToken, verifyStateToken } from '../../../functions/src/slack/stateToken.js';

const SECRET = 'test-secret-do-not-use-in-production';

test('round-trips a freshly created token back to the same uid', () => {
  const token = createStateToken({ uid: 'teacher-1', secret: SECRET });
  assert.equal(verifyStateToken({ token, secret: SECRET }), 'teacher-1');
});

test('rejects a token signed with a different secret', () => {
  const token = createStateToken({ uid: 'teacher-1', secret: SECRET });
  assert.equal(verifyStateToken({ token, secret: 'wrong-secret' }), null);
});

test('rejects an expired token', () => {
  const now = Date.now();
  const token = createStateToken({ uid: 'teacher-1', secret: SECRET, ttlMs: 1000, now });
  assert.equal(verifyStateToken({ token, secret: SECRET, now: now + 1001 }), null);
});

test('accepts a token right at its own expiry boundary', () => {
  const now = Date.now();
  const token = createStateToken({ uid: 'teacher-1', secret: SECRET, ttlMs: 1000, now });
  assert.equal(verifyStateToken({ token, secret: SECRET, now: now + 1000 }), 'teacher-1');
});

test('rejects a tampered payload (uid swapped after signing)', () => {
  const token = createStateToken({ uid: 'teacher-1', secret: SECRET });
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  const [, expiresAt, signature] = decoded.split('.');
  const forged = Buffer.from(`attacker-uid.${expiresAt}.${signature}`, 'utf8').toString('base64url');
  assert.equal(verifyStateToken({ token: forged, secret: SECRET }), null);
});

test('rejects garbage input without throwing', () => {
  assert.equal(verifyStateToken({ token: 'not-a-real-token', secret: SECRET }), null);
  assert.equal(verifyStateToken({ token: '', secret: SECRET }), null);
  assert.equal(verifyStateToken({ token: null, secret: SECRET }), null);
});

test('two tokens for the same uid minted at different times are not identical (no accidental determinism leak)', () => {
  const a = createStateToken({ uid: 'teacher-1', secret: SECRET, now: 1000 });
  const b = createStateToken({ uid: 'teacher-1', secret: SECRET, now: 2000 });
  assert.notEqual(a, b);
});
