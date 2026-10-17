/**
 * tests/functions/learnerProfileOwnership.test.js
 *
 * functions/src/learnerProfileOwnership.js calls a REAL, deployed,
 * IAM-gated cross-project Cloud Function (Learning Hub's own
 * verifyLearnerProfileOwnership) — there is no local emulator for
 * that, and this task explicitly calls for "mocked GoogleAuth /
 * ID-token client" tests, not a live network call. Every test in this
 * file except the "missing configuration" one injects a fake
 * `googleAuth` object shaped exactly like the real `GoogleAuth`
 * instance's own two-method surface this module actually uses
 * (`getIdTokenClient(url) -> {request(opts)}`), so what's being
 * proven is this module's OWN response-handling and request-shaping
 * logic, not google-auth-library's internals (which are Google's to
 * test, not this repository's).
 *
 * The "missing configuration" test is the one deliberate exception —
 * it exercises the REAL, un-mocked default `new GoogleAuth()` path,
 * specifically because this repository's own test/dev sandbox has no
 * `gcloud`/Application Default Credentials configured at all (see the
 * prior investigation report), which reproduces the real
 * "no ambient GCP credentials available" failure mode directly,
 * without needing to fake it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLearnerProfileOwnership,
  LEARNING_HUB_OWNERSHIP_ENDPOINT_URL,
} from '../../functions/src/learnerProfileOwnership.js';

const UID = 'lh-uid-ownership-1';
const LEARNER_PROFILE_ID = 'learner-profile-ownership-1';

function fakeGoogleAuthReturning(response, { onGetIdTokenClient, onRequest } = {}) {
  return {
    getIdTokenClient: async (targetUrl) => {
      onGetIdTokenClient?.(targetUrl);
      return {
        request: async (opts) => {
          onRequest?.(opts);
          return response;
        },
      };
    },
  };
}

test('exact target URL: getIdTokenClient and the request itself both use LEARNING_HUB_OWNERSHIP_ENDPOINT_URL exactly', async () => {
  assert.equal(
    LEARNING_HUB_OWNERSHIP_ENDPOINT_URL,
    'https://us-central1-learning-hub-b2586.cloudfunctions.net/verifyLearnerProfileOwnership'
  );
  let audienceUrl;
  let requestUrl;
  const googleAuth = fakeGoogleAuthReturning(
    { status: 200, data: { valid: true } },
    {
      onGetIdTokenClient: (url) => { audienceUrl = url; },
      onRequest: (opts) => { requestUrl = opts.url; },
    }
  );
  await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(audienceUrl, LEARNING_HUB_OWNERSHIP_ENDPOINT_URL);
  assert.equal(requestUrl, LEARNING_HUB_OWNERSHIP_ENDPOINT_URL);
});

test('exact request body: POSTs exactly {uid, learnerProfileId}, nothing more, nothing less, no studentId', async () => {
  let capturedOpts;
  const googleAuth = fakeGoogleAuthReturning(
    { status: 200, data: { valid: true } },
    { onRequest: (opts) => { capturedOpts = opts; } }
  );
  await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(capturedOpts.method, 'POST');
  assert.deepEqual(capturedOpts.data, { uid: UID, learnerProfileId: LEARNER_PROFILE_ID });
  assert.equal(Object.keys(capturedOpts.data).length, 2);
  assert.ok(!('studentId' in capturedOpts.data));
});

test('VALID ownership response: HTTP 200 + {valid: true} -> true', async () => {
  const googleAuth = fakeGoogleAuthReturning({ status: 200, data: { valid: true } });
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, true);
});

test('INVALID ownership response: HTTP 200 + {valid: false} -> false', async () => {
  const googleAuth = fakeGoogleAuthReturning({ status: 200, data: { valid: false } });
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('NON-200 response: HTTP 403 (e.g. IAM rejected, or Learning Hub itself declines) -> false, even with a body that looks superficially valid', async () => {
  const googleAuth = fakeGoogleAuthReturning({ status: 403, data: { valid: true } });
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('NON-200 response: HTTP 500 -> false', async () => {
  const googleAuth = fakeGoogleAuthReturning({ status: 500, data: {} });
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('MALFORMED response: HTTP 200 but body has no `valid` field at all -> false', async () => {
  const googleAuth = fakeGoogleAuthReturning({ status: 200, data: { something: 'else' } });
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('MALFORMED response: HTTP 200 but body is not an object (string) -> false', async () => {
  const googleAuth = fakeGoogleAuthReturning({ status: 200, data: 'not-an-object' });
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('MALFORMED response: HTTP 200 but body is null -> false', async () => {
  const googleAuth = fakeGoogleAuthReturning({ status: 200, data: null });
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('MALFORMED response: `valid` is truthy but not strictly boolean true (e.g. the string "true") -> false, strict equality required', async () => {
  const googleAuth = fakeGoogleAuthReturning({ status: 200, data: { valid: 'true' } });
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('CLIENT/AUTHENTICATION ERROR: client.request() throws (e.g. network failure, or a transport-level auth rejection) -> false, not an unhandled rejection', async () => {
  const googleAuth = {
    getIdTokenClient: async () => ({
      request: async () => { throw new Error('simulated network/auth failure'); },
    }),
  };
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('CLIENT/AUTHENTICATION ERROR: getIdTokenClient() itself throws (e.g. cannot mint an ID token for this audience) -> false', async () => {
  const googleAuth = {
    getIdTokenClient: async () => { throw new Error('simulated getIdTokenClient failure'); },
  };
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('TIMEOUT: a request that rejects with a timeout-shaped error still fails closed, not thrown up to the caller', async () => {
  const timeoutError = Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });
  const googleAuth = {
    getIdTokenClient: async () => ({ request: async () => { throw timeoutError; } }),
  };
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID, { googleAuth });
  assert.equal(result, false);
});

test('MISSING CONFIGURATION: with no googleAuth override, the REAL default GoogleAuth() path fails closed in this environment (no Application Default Credentials configured here) rather than throwing up to the caller', async () => {
  const result = await verifyLearnerProfileOwnership(UID, LEARNER_PROFILE_ID);
  assert.equal(result, false);
});

test('malformed uid/learnerProfileId inputs fail closed without attempting any network call at all', async () => {
  let called = false;
  const googleAuth = {
    getIdTokenClient: async () => { called = true; return { request: async () => ({ status: 200, data: { valid: true } }) }; },
  };
  assert.equal(await verifyLearnerProfileOwnership('', LEARNER_PROFILE_ID, { googleAuth }), false);
  assert.equal(await verifyLearnerProfileOwnership(UID, '', { googleAuth }), false);
  assert.equal(await verifyLearnerProfileOwnership(null, LEARNER_PROFILE_ID, { googleAuth }), false);
  assert.equal(await verifyLearnerProfileOwnership(UID, undefined, { googleAuth }), false);
  assert.equal(called, false, 'no network call should be attempted for malformed inputs');
});
