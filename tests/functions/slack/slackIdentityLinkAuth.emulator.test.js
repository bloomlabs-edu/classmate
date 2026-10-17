/**
 * tests/functions/slack/slackIdentityLinkAuth.emulator.test.js
 *
 * Proves the ONE real-infrastructure dependency
 * handleSlackIdentityLinkStart() has in production (see
 * functions/index.js's own `verifyClassMateIdToken` wiring): that a
 * REAL Firebase ID token, verified against ClassMate's OWN Firebase
 * project (unlike src/learningHubAuth.js's deliberately cross-project
 * verifier), correctly authenticates the caller. Mirrors
 * tests/functions/learningHubAuth.test.js's own "mint via the real
 * Auth emulator wire protocol" convention.
 *
 * Everything else in the start/callback flow (state signing, Slack
 * API calls, Firestore save) is already covered without an emulator in
 * tests/functions/slack/oauthCallback.test.js — this file exists only
 * to prove the auth boundary itself, using the SAME
 * handleSlackIdentityLinkStart() core functions/index.js actually
 * calls, with only its own Slack-specific deps stubbed.
 *
 * Requires the Auth emulator running (`firebase emulators:start --only
 * auth --project demo-classmate-slack-test`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { mintEmulatorIdToken } from '../emulatorAuthHelpers.js';
import { handleSlackIdentityLinkStart } from '../../../functions/src/slack/oauthCallback.js';

const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const PROJECT_ID = 'demo-classmate-slack-test';

let app;

before(() => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'slack-identity-link-auth-tests');
});

after(async () => {
  await app.delete();
});

function realVerifyDeps() {
  return {
    verifyClassMateIdToken: (idToken) =>
      getAuth(app)
        .verifyIdToken(idToken)
        .then((decoded) => decoded.uid)
        .catch(() => null),
    createStateToken: (uid) => `state-for-${uid}`,
    buildAuthorizeUrl: (state) => `https://slack.com/openid/connect/authorize?state=${state}`,
  };
}

test('a real, valid ClassMate ID token authenticates and binds the state to its own uid', async () => {
  const idToken = await mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: PROJECT_ID, uid: 'real-teacher-uid' });

  const { httpStatus, body } = await handleSlackIdentityLinkStart({
    authorizationHeader: `Bearer ${idToken}`,
    deps: realVerifyDeps(),
  });

  assert.equal(httpStatus, 200);
  assert.equal(body.url, 'https://slack.com/openid/connect/authorize?state=state-for-real-teacher-uid');
});

test('a garbage bearer token is rejected by the REAL verifier, not just a fake one', async () => {
  const { httpStatus, body } = await handleSlackIdentityLinkStart({
    authorizationHeader: 'Bearer this-is-not-a-real-firebase-id-token',
    deps: realVerifyDeps(),
  });
  assert.equal(httpStatus, 401);
  assert.equal(body.ok, false);
});
