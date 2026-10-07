/**
 * tests/functions/deviceSignIn/pairingSecret.test.js
 *
 * Pure unit tests — no Firestore, no emulator. See
 * functions/src/deviceSignIn/pairingSecret.js's own header comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePairingCode,
  generateTvSessionToken,
  hashSecret,
  safeEqualsHash,
  isValidPairingCodeShape,
  isValidTvSessionTokenShape,
} from '../../../functions/src/deviceSignIn/pairingSecret.js';

test('generatePairingCode: always an 8-digit numeric string, leading zeros preserved', () => {
  for (let i = 0; i < 200; i++) {
    const code = generatePairingCode();
    assert.match(code, /^\d{8}$/);
  }
});

test('generatePairingCode: not trivially constant across calls (sanity check on real randomness)', () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) codes.add(generatePairingCode());
  assert.ok(codes.size > 40, 'expected high uniqueness among 50 draws from a 10^8 space');
});

test('generateTvSessionToken: URL-safe, non-empty, unique per call', () => {
  const a = generateTvSessionToken();
  const b = generateTvSessionToken();
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
  assert.ok(a.length >= 32, 'expected a high-entropy token, not a short one');
});

test('hashSecret: deterministic — the same input always hashes the same', () => {
  assert.equal(hashSecret('12345678'), hashSecret('12345678'));
});

test('hashSecret: different inputs hash differently', () => {
  assert.notEqual(hashSecret('12345678'), hashSecret('12345679'));
});

test('hashSecret: never returns the raw input itself', () => {
  assert.notEqual(hashSecret('12345678'), '12345678');
});

test('safeEqualsHash: true for identical hex strings', () => {
  const hash = hashSecret('abc');
  assert.equal(safeEqualsHash(hash, hash), true);
});

test('safeEqualsHash: false for different hex strings', () => {
  assert.equal(safeEqualsHash(hashSecret('abc'), hashSecret('xyz')), false);
});

test('safeEqualsHash: false (never throws) for malformed input', () => {
  assert.equal(safeEqualsHash(null, undefined), false);
  assert.equal(safeEqualsHash('not-hex!!', hashSecret('abc')), false);
  assert.equal(safeEqualsHash('short', 'alsodifferentlength12345'), false);
});

test('isValidPairingCodeShape: accepts exactly 8 digits', () => {
  assert.equal(isValidPairingCodeShape('00000000'), true);
  assert.equal(isValidPairingCodeShape('12345678'), true);
});

test('isValidPairingCodeShape: rejects anything else', () => {
  assert.equal(isValidPairingCodeShape('1234567'), false); // too short
  assert.equal(isValidPairingCodeShape('123456789'), false); // too long
  assert.equal(isValidPairingCodeShape('1234abcd'), false); // non-numeric
  assert.equal(isValidPairingCodeShape(12345678), false); // not a string
  assert.equal(isValidPairingCodeShape(null), false);
  assert.equal(isValidPairingCodeShape(undefined), false);
});

test('isValidTvSessionTokenShape: accepts a real generated token', () => {
  assert.equal(isValidTvSessionTokenShape(generateTvSessionToken()), true);
});

test('isValidTvSessionTokenShape: rejects empty, non-string, oversized, or non-base64url input', () => {
  assert.equal(isValidTvSessionTokenShape(''), false);
  assert.equal(isValidTvSessionTokenShape(null), false);
  assert.equal(isValidTvSessionTokenShape(123), false);
  assert.equal(isValidTvSessionTokenShape('a'.repeat(513)), false);
  assert.equal(isValidTvSessionTokenShape('not valid! chars$'), false);
});
