/**
 * functions/src/slack/slackClient.js
 *
 * The ONLY module in this app that talks to Slack's HTTP API. Every
 * other Slack-related module (oauthCallback.js,
 * onWeeklyPlanSubmissionWrite.js) calls through here rather than
 * building Slack requests itself — keeps the Slack Web API's own
 * request/response shape in exactly one place.
 *
 * Every function takes an explicit `fetchImpl` (defaulting to the
 * runtime's global `fetch` — available natively on Node 20, no new
 * dependency needed) so tests can inject a fake and assert on exactly
 * what was sent, without a real network call — same `deps` injection
 * convention already used throughout functions/src/
 * (see verifyLearnerConnectionEndpoint.js).
 *
 * Deliberately uses ONLY the approved scopes end-to-end: the OIDC
 * functions here request nothing beyond the `openid` scope itself (see
 * config.js's own comment on SLACK_OIDC_SCOPE for why Slack's actual
 * response to that request is NOT guaranteed to be limited to `sub` +
 * team id in return — only what fetchSlackIdentity() below reads out
 * of it is), and the messaging functions use only `conversations.open`
 * (im:write) + `chat.postMessage` (chat:write) — see
 * docs/architecture/SLACK_INTEGRATION_APP_CONFIGURATION.md §3.
 */
import {
  SLACK_OIDC_TOKEN_URL,
  SLACK_OIDC_USERINFO_URL,
  SLACK_CONVERSATIONS_OPEN_URL,
  SLACK_CHAT_POST_MESSAGE_URL,
  SLACK_TEAM_ID_CLAIM,
} from './config.js';

/**
 * Exchanges the one-time `code` Slack's redirect handed back for an
 * access token — the standard OAuth 2.0 / OIDC authorization-code
 * exchange, server-to-server (never exposes the client secret to a
 * browser).
 */
export async function exchangeOAuthCode({ code, redirectUri, clientId, clientSecret, fetchImpl = fetch }) {
  const response = await fetchImpl(SLACK_OIDC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
    }),
  });
  return response.json();
}

/**
 * Resolves the two, and only two, identifiers this app ever persists
 * from Slack (see slackIntegrationRepository.js): the Slack user id
 * and the Slack team id. Reads the userinfo response directly rather
 * than decoding the id_token's own JWT locally — the access token was
 * already obtained via a direct, authenticated HTTPS call to Slack's
 * own token endpoint above, so a further independent signature check
 * here would add complexity without adding trust.
 *
 * Deliberately destructures ONLY these two fields out of Slack's
 * response. This is NOT belt-and-braces on top of a scope-level
 * guarantee — live testing (2026-09-23, against a real Slack App with
 * ONLY the `openid` User Token Scope configured) confirmed Slack's own
 * consent screen discloses name/email/profile image regardless, so its
 * userinfo response may genuinely include `email`, `name`, `picture`,
 * and similar fields even for an `openid`-only request (see config.js's
 * own corrected comment on SLACK_OIDC_SCOPE). This function is
 * therefore THE place ClassMate's entire privacy boundary for this
 * feature is actually enforced: whatever Slack includes, only `sub`
 * and the team_id claim are ever read into a variable — everything
 * else in `body` is discarded when this function returns, never
 * logged, never passed to any caller. See this file's own test
 * (slackClient.test.js) for a mock response containing email/name/
 * picture, asserting they never appear on the returned object.
 */
export async function fetchSlackIdentity({ accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(SLACK_OIDC_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json();
  if (body?.error) return { ok: false, error: body.error };
  const slackUserId = body?.sub;
  const slackTeamId = body?.[SLACK_TEAM_ID_CLAIM];
  if (!slackUserId || !slackTeamId) return { ok: false, error: 'missing_identity_claims' };
  return { ok: true, slackUserId, slackTeamId };
}

/** Opens (or resolves the existing) DM channel with a specific Slack user — required before chat.postMessage can DM them (im:write). */
export async function openDirectMessageChannel({ botToken, slackUserId, fetchImpl = fetch }) {
  const response = await fetchImpl(SLACK_CONVERSATIONS_OPEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ users: slackUserId }),
  });
  const body = await response.json();
  if (!body?.ok) return { ok: false, error: body?.error || 'unknown_error' };
  return { ok: true, channelId: body.channel?.id };
}

/** Posts one message (chat:write) to a channel id — a DM channel id from openDirectMessageChannel() above for Phase 1's DM-only scope. */
export async function postMessage({ botToken, channel, text, blocks, fetchImpl = fetch }) {
  const response = await fetchImpl(SLACK_CHAT_POST_MESSAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text, blocks }),
  });
  const body = await response.json();
  if (!body?.ok) return { ok: false, error: body?.error || 'unknown_error' };
  return { ok: true };
}
