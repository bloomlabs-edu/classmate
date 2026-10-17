/**
 * tests/functions/slack/slackClient.test.js
 *
 * Every function in functions/src/slack/slackClient.js takes an
 * injectable `fetchImpl` specifically so these tests never make a real
 * network call to Slack — see that file's own header comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exchangeOAuthCode,
  fetchSlackIdentity,
  openDirectMessageChannel,
  postMessage,
} from '../../../functions/src/slack/slackClient.js';

function fakeFetch(responseBody, { ok = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok, json: async () => responseBody };
  };
  return { fetchImpl, calls };
}

test('exchangeOAuthCode posts form-encoded params and returns the raw response', async () => {
  const { fetchImpl, calls } = fakeFetch({ ok: true, access_token: 'xoxp-fake' });
  const result = await exchangeOAuthCode({
    code: 'the-code',
    redirectUri: 'https://example.com/callback',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl,
  });

  assert.equal(result.access_token, 'xoxp-fake');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  const sentBody = calls[0].options.body.toString();
  assert.match(sentBody, /code=the-code/);
  assert.match(sentBody, /client_secret=client-secret/);
});

/**
 * This is the test proving ClassMate's actual privacy boundary for
 * this feature — see config.js's own corrected comment on
 * SLACK_OIDC_SCOPE (2026-09-23): requesting only the `openid` scope
 * does NOT reliably stop Slack from returning name/email/profile-photo
 * data (confirmed live, against a real Slack App configured with ONLY
 * `openid`). The mock response below deliberately includes every kind
 * of extra field Slack's own docs list as possible
 * (docs.slack.dev/reference/methods/openid.connect.userInfo) —
 * standard OIDC fields (email, name, picture, given_name, family_name)
 * and Slack-specific ones (team name/domain, sized profile images) —
 * to prove none of them survive this function, not just the two most
 * obvious ones.
 */
test('fetchSlackIdentity extracts ONLY slackUserId and slackTeamId, discarding every other field Slack may return', async () => {
  const { fetchImpl } = fakeFetch({
    sub: 'U123',
    'https://slack.com/team_id': 'T456',
    email: 'should-never-be-read@example.com',
    email_verified: true,
    name: 'Should Never Be Read',
    given_name: 'Should',
    family_name: 'Never',
    picture: 'https://avatars.example.com/should-never-be-read.png',
    locale: 'en-US',
    'https://slack.com/user_id': 'U123',
    'https://slack.com/team_name': 'Should Never Be Read Workspace',
    'https://slack.com/team_domain': 'should-never-be-read',
    'https://slack.com/user_image_192': 'https://avatars.example.com/192.png',
  });
  const result = await fetchSlackIdentity({ accessToken: 'token', fetchImpl });

  assert.deepEqual(result, { ok: true, slackUserId: 'U123', slackTeamId: 'T456' });
  // Exhaustive, not just spot-checked: the ENTIRE key set of the
  // returned object is exactly these three — nothing else leaked
  // through, present or future.
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'slackTeamId', 'slackUserId']);
});

test('fetchSlackIdentity fails closed when required claims are missing', async () => {
  const { fetchImpl } = fakeFetch({ sub: 'U123' }); // no team id claim
  const result = await fetchSlackIdentity({ accessToken: 'token', fetchImpl });
  assert.equal(result.ok, false);
});

test('fetchSlackIdentity surfaces a Slack-reported error', async () => {
  const { fetchImpl } = fakeFetch({ error: 'invalid_token' });
  const result = await fetchSlackIdentity({ accessToken: 'bad-token', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_token');
});

test('openDirectMessageChannel returns the channel id on success', async () => {
  const { fetchImpl, calls } = fakeFetch({ ok: true, channel: { id: 'D123' } });
  const result = await openDirectMessageChannel({ botToken: 'xoxb-fake', slackUserId: 'U123', fetchImpl });
  assert.deepEqual(result, { ok: true, channelId: 'D123' });
  assert.match(calls[0].options.headers.Authorization, /xoxb-fake/);
});

test('openDirectMessageChannel surfaces account_inactive without throwing', async () => {
  const { fetchImpl } = fakeFetch({ ok: false, error: 'account_inactive' });
  const result = await openDirectMessageChannel({ botToken: 'xoxb-fake', slackUserId: 'U123', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'account_inactive');
});

test('postMessage sends channel/text/blocks as JSON', async () => {
  const { fetchImpl, calls } = fakeFetch({ ok: true });
  const result = await postMessage({ botToken: 'xoxb-fake', channel: 'D123', text: 'hi', blocks: [{ type: 'section' }], fetchImpl });
  assert.equal(result.ok, true);
  const sentBody = JSON.parse(calls[0].options.body);
  assert.equal(sentBody.channel, 'D123');
  assert.equal(sentBody.text, 'hi');
});

test('postMessage surfaces a rejection (e.g. channel_not_found) as a non-throwing failure', async () => {
  const { fetchImpl } = fakeFetch({ ok: false, error: 'channel_not_found' });
  const result = await postMessage({ botToken: 'xoxb-fake', channel: 'bad-channel', text: 'hi', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'channel_not_found');
});
