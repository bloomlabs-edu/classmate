/**
 * tests/functions/slack/corsConfiguration.emulator.test.js
 *
 * Real HTTP tests against the LIVE Functions emulator for
 * slackIdentityLinkStart's CORS handling (functions/index.js's own
 * applyCorsIfAllowed()) — a transport-layer concern that only exists on
 * the deployed/emulated Cloud Function itself, not on the pure
 * handleSlackIdentityLinkStart() core already covered by
 * oauthCallback.test.js. That's why this test talks to a real HTTP
 * endpoint rather than importing a function directly, unlike every
 * other file in this directory.
 *
 * Written after discovering, by testing directly against this exact
 * emulator, that firebase-functions' own built-in `cors: [...]` option
 * reflected back an ARBITRARY, unlisted origin rather than restricting
 * to the array — i.e. behaved like `Access-Control-Allow-Origin: *`.
 * This test exists specifically to catch that regression again if it
 * ever comes back (from a firebase-functions upgrade, or a future
 * edit), by asserting the disallowed-origin case has NO CORS header at
 * all, not just that the allowed-origin case has the right one.
 *
 * Requires: the Functions emulator running at 127.0.0.1:5001 for
 * project classmate-302c2 (`firebase emulators:start --only
 * functions,firestore,auth --project classmate-302c2`), with
 * functions/.env.local's CLASSMATE_APP_BASE_URL set to exactly
 * `http://127.0.0.1:8000` (this feature's own documented local test
 * value — see this project's Slack Phase 1 E2E test plan) and
 * functions/.secret.local populated (any values — this test never
 * reaches the point of using them, since every request here is
 * unauthenticated by design).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ENDPOINT = 'http://127.0.0.1:5001/classmate-302c2/us-central1/slackIdentityLinkStart';
const ALLOWED_ORIGIN = 'http://127.0.0.1:8000'; // must match functions/.env.local's CLASSMATE_APP_BASE_URL
const DISALLOWED_ORIGIN = 'https://evil.example.com';

test('preflight OPTIONS from the allowed local origin gets a matching Access-Control-Allow-Origin and 204', async () => {
  const response = await fetch(ENDPOINT, {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization,Content-Type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(response.headers.get('access-control-allow-headers') || '', /Authorization/);
});

test('preflight OPTIONS from a disallowed origin gets NO Access-Control-Allow-Origin header at all', async () => {
  const response = await fetch(ENDPOINT, {
    method: 'OPTIONS',
    headers: { Origin: DISALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('an actual POST from the allowed origin gets the CORS header AND still enforces authentication (401)', async () => {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { Origin: ALLOWED_ORIGIN } });
  assert.equal(response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test('an actual POST from a disallowed origin gets NO CORS header (the browser, not this test, is what actually blocks it)', async () => {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { Origin: DISALLOWED_ORIGIN } });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('a same-origin-style request with no Origin header at all (e.g. a non-browser caller) gets no CORS header, and authentication is still enforced', async () => {
  const response = await fetch(ENDPOINT, { method: 'POST' });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.status, 401);
});
