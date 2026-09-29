/**
 * services/slackIntegrationService.js
 *
 * Everything ui/components/UserBar.js's "Connect/Disconnect Slack"
 * control needs, isolating both Firestore access
 * (repositories/firestoreSlackIntegrationRepository.js) and the one
 * Cloud Function call this app makes (slackIdentityLinkStart) behind a
 * small API — same "no UI component touches Firebase/fetch directly"
 * convention as every other service in this app.
 *
 * `getFunctionsBaseUrl()` deliberately mirrors
 * services/firestoreEnvironment.js's own production-is-opt-in policy
 * (see that file's header comment, and this project's own
 * "never-seed-production-data" incident) rather than inventing a
 * separate rule for Cloud Functions: only this app's own known,
 * real Hosting hostnames are treated as production; every other
 * hostname (localhost, a scratchpad server, CI) talks to the LOCAL
 * Functions emulator by default. There is no small-scale harm to
 * calling the real slackIdentityLinkStart from a dev machine the way
 * there is with Firestore (it can't write classroom data), but a
 * mismatched target would still send a test teacher's browser to the
 * wrong Slack app during testing — see this feature's own test plan
 * for the exact local Functions emulator command this expects.
 */
import { PRODUCTION_HOSTNAMES } from './firestoreEnvironment.js';
import { getActiveSlackIntegrationOnce, disconnectSlack } from '../repositories/firestoreSlackIntegrationRepository.js';

const PROJECT_ID = 'classmate-302c2';
const REGION = 'us-central1';
const DEFAULT_FUNCTIONS_EMULATOR_HOST = '127.0.0.1';
const DEFAULT_FUNCTIONS_EMULATOR_PORT = 5001;

function getFunctionsBaseUrl() {
  const hostname = typeof window !== 'undefined' ? window.location?.hostname : null;
  if (typeof hostname === 'string' && PRODUCTION_HOSTNAMES.includes(hostname)) {
    return `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
  }
  return `http://${DEFAULT_FUNCTIONS_EMULATOR_HOST}:${DEFAULT_FUNCTIONS_EMULATOR_PORT}/${PROJECT_ID}/${REGION}`;
}

/** `{ connected: boolean }` — never returns the stored slackUserId/slackTeamId to the UI; the popover only ever needs to know whether a link exists, matching the content allow-list this feature is built around. */
export async function getConnectionStatus(uid) {
  if (!uid) return { connected: false };
  try {
    const integration = await getActiveSlackIntegrationOnce(uid);
    return { connected: Boolean(integration) };
  } catch (error) {
    console.error('[slackIntegrationService] getConnectionStatus() failed:', error);
    return { connected: false };
  }
}

/**
 * Starts the "Sign in with Slack" flow: asks the trusted backend for a
 * ready-to-use authorize URL (bound to `idToken`'s own uid via a
 * signed, short-lived state — see functions/src/slack/stateToken.js),
 * then does a full top-level navigation to it. A fetch-and-redirect,
 * not a popup — Slack's own OIDC consent screen expects a normal
 * top-level navigation, and this app has no existing popup-OAuth
 * pattern to match instead.
 */
export async function beginConnect(idToken) {
  if (!idToken) return { success: false, reason: 'not-signed-in' };
  try {
    const response = await fetch(`${getFunctionsBaseUrl()}/slackIdentityLinkStart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const body = await response.json();
    if (!body?.ok || !body?.url) return { success: false, reason: 'start-failed' };
    window.location.href = body.url;
    return { success: true };
  } catch (error) {
    console.error('[slackIntegrationService] beginConnect() failed:', error);
    return { success: false, reason: 'error', error };
  }
}

/** Reverses a connection — see repositories/firestoreSlackIntegrationRepository.js's own disconnectSlack() for exactly what field this touches. */
export async function disconnect(uid) {
  if (!uid) return { success: false };
  try {
    await disconnectSlack(uid);
    return { success: true };
  } catch (error) {
    console.error('[slackIntegrationService] disconnect() failed:', error);
    return { success: false, error };
  }
}
