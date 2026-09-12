import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  determineFirestoreTarget,
  PRODUCTION_HOSTNAMES,
  DEFAULT_EMULATOR_HOST,
  DEFAULT_EMULATOR_PORT,
} from '../../js/services/firestoreEnvironment.js';

function paramsOf(map) {
  return (key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
}

test('a recognized production hostname (classmate-302c2.web.app) defaults to production', () => {
  const result = determineFirestoreTarget({ hostname: 'classmate-302c2.web.app', getSearchParam: paramsOf({}) });
  assert.deepEqual(result, { mode: 'production' });
});

test('the other real Hosting alias (classmate-302c2.firebaseapp.com) also defaults to production', () => {
  const result = determineFirestoreTarget({ hostname: 'classmate-302c2.firebaseapp.com', getSearchParam: paramsOf({}) });
  assert.deepEqual(result, { mode: 'production' });
});

test('every PRODUCTION_HOSTNAMES entry resolves to production with no other input', () => {
  for (const hostname of PRODUCTION_HOSTNAMES) {
    assert.deepEqual(determineFirestoreTarget({ hostname, getSearchParam: paramsOf({}) }), { mode: 'production' });
  }
});

test('localhost, with no flags at all, defaults to the local emulator — not production (the core fix this round)', () => {
  const result = determineFirestoreTarget({ hostname: 'localhost', getSearchParam: paramsOf({}) });
  assert.deepEqual(result, { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT });
});

test('127.0.0.1, with no flags, also defaults to the emulator', () => {
  const result = determineFirestoreTarget({ hostname: '127.0.0.1', getSearchParam: paramsOf({}) });
  assert.deepEqual(result, { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT });
});

test('an unrecognized/unexpected hostname defaults to the emulator, not production (fail closed, not an allowlist bypass)', () => {
  const result = determineFirestoreTarget({ hostname: 'some-other-domain.example', getSearchParam: paramsOf({}) });
  assert.deepEqual(result, { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT });
});

test('no hostname at all (non-browser context) defaults to the emulator', () => {
  const result = determineFirestoreTarget({ hostname: null, getSearchParam: paramsOf({}) });
  assert.deepEqual(result, { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT });
});

test('?firestoreEmulator=host:port on a non-production hostname targets that emulator', () => {
  const result = determineFirestoreTarget({ hostname: 'localhost', getSearchParam: paramsOf({ firestoreEmulator: 'localhost:9099' }) });
  assert.deepEqual(result, { mode: 'emulator', host: 'localhost', port: 9099 });
});

test('?firestoreEmulator=host:port OVERRIDES even a production hostname — an explicit emulator request can only redirect away from production, so it is always honored', () => {
  const result = determineFirestoreTarget({ hostname: 'classmate-302c2.web.app', getSearchParam: paramsOf({ firestoreEmulator: 'localhost:8080' }) });
  assert.deepEqual(result, { mode: 'emulator', host: 'localhost', port: 8080 });
});

test('a malformed ?firestoreEmulator= value (no port) still resolves to the SAFE default emulator target, never falling through to production', () => {
  const result = determineFirestoreTarget({ hostname: 'localhost', getSearchParam: paramsOf({ firestoreEmulator: 'not-a-valid-target' }) });
  assert.deepEqual(result, { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT });
});

test('?firestoreProduction=1 on a non-production hostname is the deliberate escape hatch back to production', () => {
  const result = determineFirestoreTarget({ hostname: 'localhost', getSearchParam: paramsOf({ firestoreProduction: '1' }) });
  assert.deepEqual(result, { mode: 'production' });
});

test('?firestoreProduction=<anything but "1"> is NOT treated as opt-in — only the exact "1" counts', () => {
  const result = determineFirestoreTarget({ hostname: 'localhost', getSearchParam: paramsOf({ firestoreProduction: 'true' }) });
  assert.deepEqual(result, { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT });
});

test('allowProductionGlobal=true on a non-production hostname is the same deliberate escape hatch, for a global-flag-based harness instead of a query param', () => {
  const result = determineFirestoreTarget({ hostname: 'localhost', getSearchParam: paramsOf({}), allowProductionGlobal: true });
  assert.deepEqual(result, { mode: 'production' });
});

test('allowProductionGlobal is falsy by default — omitting it entirely does not accidentally opt into production', () => {
  const result = determineFirestoreTarget({ hostname: 'localhost', getSearchParam: paramsOf({}) });
  assert.equal(result.mode, 'emulator');
});

test('a getSearchParam that throws is treated as "no param present", never crashes the decision', () => {
  const throwingGetter = () => { throw new Error('boom'); };
  const result = determineFirestoreTarget({ hostname: 'localhost', getSearchParam: throwingGetter });
  assert.deepEqual(result, { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT });
});

test('calling with no arguments at all is safe and defaults to the emulator', () => {
  const result = determineFirestoreTarget();
  assert.deepEqual(result, { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT });
});
