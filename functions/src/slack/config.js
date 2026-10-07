/**
 * functions/src/slack/config.js
 *
 * Non-secret Slack integration configuration — anything that does NOT
 * need Secret Manager (see functions/index.js for the three real
 * secrets: SLACK_BOT_TOKEN, SLACK_CLIENT_SECRET,
 * SLACK_STATE_SIGNING_SECRET). Slack's OAuth Client ID is not
 * sensitive (it's public in every Slack "Add to Slack" URL), so it
 * lives here as a plain env var, not a secret.
 *
 * `CLASSMATE_APP_BASE_URL` deliberately defaults to the real
 * production Hosting URL (see services/firestoreEnvironment.js's own
 * PRODUCTION_HOSTNAMES) but is fully overridable via env var
 * specifically so a local/emulator test run never redirects a test
 * teacher's browser at real production — see
 * docs/architecture/SLACK_INTEGRATION_APP_CONFIGURATION.md and this
 * feature's own test plan for the exact value to set while testing.
 */

export function getSlackClientId() {
  const value = process.env.SLACK_CLIENT_ID;
  if (!value) throw new Error('SLACK_CLIENT_ID is not configured.');
  return value;
}

export function getIdentityLinkRedirectUri() {
  return process.env.SLACK_IDENTITY_LINK_REDIRECT_URI || 'https://us-central1-classmate-302c2.cloudfunctions.net/slackIdentityLinkCallback';
}

export function getAppBaseUrl() {
  return process.env.CLASSMATE_APP_BASE_URL || 'https://classmate-302c2.web.app';
}

// Origins allowed to call slackIdentityLinkStart via fetch() from a
// browser (see functions/index.js) — deliberately the production
// Hosting origins PLUS whatever getAppBaseUrl() currently resolves to,
// never a wildcard. In production that's just a duplicate of the first
// entry (deduped below); in local/emulator testing, CLASSMATE_APP_BASE_URL
// is already the one env var this feature uses to mean "the app
// instance we're testing against" (see this file's own header comment
// on that variable) — reusing it here means the CORS allowlist can
// never drift out of sync with where redirects actually point.
const PRODUCTION_ORIGINS = ['https://classmate-302c2.web.app', 'https://classmate-302c2.firebaseapp.com'];

export function getAllowedOrigins() {
  return [...new Set([...PRODUCTION_ORIGINS, getAppBaseUrl()])];
}

// Only the `openid` scope — deliberately never `profile` or `email`.
//
// CORRECTED 2026-09-23, after live testing against a real Slack App
// (User Token Scopes confirmed to contain ONLY `openid`, nothing else):
// requesting `openid` alone does NOT stop Slack's own consent screen
// from disclosing name/email/profile image, and does not guarantee
// Slack's actual openid.connect.userInfo response excludes them either
// — Slack's own reference docs (docs.slack.dev/reference/methods/
// openid.connect.userInfo) list those as possible response fields
// without documenting which scope gates which field. The privacy
// boundary here is therefore NOT "Slack cannot send this" — it is
// "ClassMate extracts and persists only `sub`/team_id, and discards
// everything else Slack may include," enforced entirely in code (see
// slackClient.js's own fetchSlackIdentity() and its own test asserting
// exactly this against a mock response containing email/name/picture).
// See docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md §4
// for the corresponding correction to that review document.
export const SLACK_OIDC_SCOPE = 'openid';

export const SLACK_OIDC_AUTHORIZE_URL = 'https://slack.com/openid/connect/authorize';
export const SLACK_OIDC_TOKEN_URL = 'https://slack.com/api/openid.connect.token';
export const SLACK_OIDC_USERINFO_URL = 'https://slack.com/api/openid.connect.userInfo';
export const SLACK_CONVERSATIONS_OPEN_URL = 'https://slack.com/api/conversations.open';
export const SLACK_CHAT_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

// The Slack team-id claim's exact key on the OIDC userinfo response —
// named once here so both the callback and any test double stay in
// sync on the exact string.
export const SLACK_TEAM_ID_CLAIM = 'https://slack.com/team_id';
