/**
 * tests/functions/slack/oauthCallback.test.js
 *
 * Pure tests for functions/src/slack/oauthCallback.js's framework-
 * agnostic core, with every dependency faked — proves the flow's own
 * branching (auth, consent-declined, invalid state, Slack failures,
 * save failure, success) without a real Firebase project, Firestore,
 * or Slack API call. Real-auth-emulator wiring is covered separately
 * in tests/functions/slack/slackIdentityLinkAuth.emulator.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSlackIdentityLinkStart, handleSlackIdentityLinkCallback } from '../../../functions/src/slack/oauthCallback.js';

test('start: rejects a missing Authorization header', async () => {
  const { httpStatus, body } = await handleSlackIdentityLinkStart({ authorizationHeader: undefined, deps: {} });
  assert.equal(httpStatus, 401);
  assert.equal(body.ok, false);
});

test('start: rejects a header that is not "Bearer <token>"', async () => {
  const { httpStatus } = await handleSlackIdentityLinkStart({ authorizationHeader: 'Basic abc', deps: {} });
  assert.equal(httpStatus, 401);
});

test('start: rejects an invalid ClassMate ID token', async () => {
  const { httpStatus } = await handleSlackIdentityLinkStart({
    authorizationHeader: 'Bearer bad-token',
    deps: { verifyClassMateIdToken: async () => null },
  });
  assert.equal(httpStatus, 401);
});

test('start: on a valid token, returns a URL built from the signed state', async () => {
  const { httpStatus, body } = await handleSlackIdentityLinkStart({
    authorizationHeader: 'Bearer good-token',
    deps: {
      verifyClassMateIdToken: async (token) => (token === 'good-token' ? 'teacher-1' : null),
      createStateToken: (uid) => `state-for-${uid}`,
      buildAuthorizeUrl: (state) => `https://slack.com/authorize?state=${state}`,
    },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, true);
  assert.equal(body.url, 'https://slack.com/authorize?state=state-for-teacher-1');
});

function makeCallbackDeps(overrides = {}) {
  return {
    verifyStateToken: (state) => (state === 'valid-state' ? 'teacher-1' : null),
    exchangeOAuthCode: async () => ({ ok: true, access_token: 'access-token' }),
    fetchSlackIdentity: async () => ({ ok: true, slackUserId: 'U123', slackTeamId: 'T456' }),
    saveSlackIntegration: async () => {},
    nowIso: () => '2026-09-22T00:00:00.000Z',
    buildRedirectUrl: (status) => `https://classmate-302c2.web.app/#/teacher?slack=${status}`,
    onError: () => {},
    ...overrides,
  };
}

test('callback: a declined consent screen redirects to the generic error destination', async () => {
  const { httpStatus, redirectUrl } = await handleSlackIdentityLinkCallback({
    query: { error: 'access_denied' },
    deps: makeCallbackDeps(),
  });
  assert.equal(httpStatus, 302);
  assert.match(redirectUrl, /slack=error/);
});

test('callback: missing code/state redirects to the generic error destination', async () => {
  const { redirectUrl } = await handleSlackIdentityLinkCallback({ query: {}, deps: makeCallbackDeps() });
  assert.match(redirectUrl, /slack=error/);
});

test('callback: an invalid/expired state redirects to the generic error destination', async () => {
  const { redirectUrl } = await handleSlackIdentityLinkCallback({
    query: { code: 'abc', state: 'not-valid' },
    deps: makeCallbackDeps(),
  });
  assert.match(redirectUrl, /slack=error/);
});

test('callback: a rejected token exchange redirects to the generic error destination', async () => {
  const { redirectUrl } = await handleSlackIdentityLinkCallback({
    query: { code: 'abc', state: 'valid-state' },
    deps: makeCallbackDeps({ exchangeOAuthCode: async () => ({ ok: false, error: 'invalid_code' }) }),
  });
  assert.match(redirectUrl, /slack=error/);
});

test('callback: a rejected identity fetch redirects to the generic error destination', async () => {
  const { redirectUrl } = await handleSlackIdentityLinkCallback({
    query: { code: 'abc', state: 'valid-state' },
    deps: makeCallbackDeps({ fetchSlackIdentity: async () => ({ ok: false, error: 'missing_identity_claims' }) }),
  });
  assert.match(redirectUrl, /slack=error/);
});

test('callback: a Firestore save failure redirects to the generic error destination', async () => {
  const { redirectUrl } = await handleSlackIdentityLinkCallback({
    query: { code: 'abc', state: 'valid-state' },
    deps: makeCallbackDeps({
      saveSlackIntegration: async () => {
        throw new Error('boom');
      },
    }),
  });
  assert.match(redirectUrl, /slack=error/);
});

test('callback: the success path writes exactly slackUserId/slackTeamId/connectedAt and redirects to "connected"', async () => {
  let saved = null;
  const { httpStatus, redirectUrl } = await handleSlackIdentityLinkCallback({
    query: { code: 'abc', state: 'valid-state' },
    deps: makeCallbackDeps({
      saveSlackIntegration: async (uid, identity) => {
        saved = { uid, identity };
      },
    }),
  });
  assert.equal(httpStatus, 302);
  assert.match(redirectUrl, /slack=connected/);
  assert.deepEqual(saved, {
    uid: 'teacher-1',
    identity: { slackUserId: 'U123', slackTeamId: 'T456', connectedAt: '2026-09-22T00:00:00.000Z' },
  });
});
