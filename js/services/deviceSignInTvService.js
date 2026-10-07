/**
 * services/deviceSignInTvService.js
 *
 * The TV/shared-device half of "Sign in with Phone" (see
 * docs/architecture/TV_PHONE_SIGNIN_DESIGN.md). Isolates every
 * Cloud Functions call behind a small API so
 * ui/views/TvSignInView.js never touches `fetch()` directly — same
 * "no UI component touches Firebase/fetch directly" convention as
 * services/slackIntegrationService.js.
 *
 * Holds the pairing code and the TV's own private session token ONLY
 * in memory (module-scoped variables, never localStorage/sessionStorage)
 * — there is nothing on this device worth persisting across a reload;
 * a refreshed TV should start a brand-new pairing session, not resume
 * a stale one. `getFunctionsBaseUrl()` deliberately duplicates
 * slackIntegrationService.js's own tiny private helper rather than
 * extracting a shared one — that is the existing convention in this
 * codebase (each service that calls Cloud Functions owns this exact
 * ~8-line function itself), not an oversight.
 */
import { PRODUCTION_HOSTNAMES } from './firestoreEnvironment.js';

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

/** A short, non-sensitive, DISPLAY-ONLY device hint for the teacher's own approval screen — never trusted for any security decision on the backend (see functions/src/deviceSignIn/deviceSignInEndpoints.js's own sanitizeDeviceLabel()). */
function buildDeviceLabel() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/SmartTV|Tizen|WebOS|CrKey/i.test(ua)) return 'Classroom TV';
  if (/Chrome/i.test(ua)) return 'Chrome device';
  if (/Firefox/i.test(ua)) return 'Firefox device';
  if (/Safari/i.test(ua)) return 'Safari device';
  return 'Shared device';
}

/**
 * Starts a new pairing session. Returns `{ok: true, pairingCode,
 * tvSessionToken, expiresAt}` on success, or `{ok: false, reason}` —
 * `reason` is `'rate_limited'` for a 429, `'error'` for anything else
 * (network failure, non-2xx, malformed response).
 */
export async function startPairingSession() {
  try {
    const response = await fetch(`${getFunctionsBaseUrl()}/startDeviceSignIn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceLabel: buildDeviceLabel() }),
    });
    const data = await response.json();
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (!response.ok || !data?.ok || !data?.pairingCode || !data?.tvSessionToken) return { ok: false, reason: 'error' };
    return { ok: true, pairingCode: data.pairingCode, tvSessionToken: data.tvSessionToken, expiresAt: data.expiresAt };
  } catch (error) {
    console.error('[deviceSignInTvService] startPairingSession() failed:', error);
    return { ok: false, reason: 'error' };
  }
}

/**
 * One poll — never throws. Returns one of:
 *   {status: 'pending'}
 *   {status: 'denied'}
 *   {status: 'expired'}            — including "invalid"/not-found, collapsed identically (see functions/src/deviceSignIn/deviceSignInEndpoints.js's own anti-oracle comment)
 *   {status: 'approved', customToken}
 *   {status: 'rate_limited'}
 *   {status: 'network_error'}
 */
export async function pollPairingSession(pairingCode, tvSessionToken) {
  try {
    const response = await fetch(`${getFunctionsBaseUrl()}/pollDeviceSignIn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, tvSessionToken }),
    });
    if (response.status === 429) return { status: 'rate_limited' };
    const data = await response.json();
    if (!response.ok || !data) return { status: 'network_error' };
    if (!data.ok) return { status: 'expired' };
    if (data.status === 'approved') return { status: 'approved', customToken: data.customToken };
    return { status: data.status }; // 'pending' | 'denied' | 'expired'
  } catch (error) {
    console.error('[deviceSignInTvService] pollPairingSession() failed:', error);
    return { status: 'network_error' };
  }
}

/**
 * The QR payload — a deep link straight into the phone's approval
 * screen (js/ui/router.js's own `approve-sign-in/{code}` route), so
 * scanning it never requires the teacher to type anything. The plain
 * pairing code is ALSO always shown as text on the TV (decision #2) for
 * the manual-entry fallback — this function exists only for the QR
 * image itself.
 */
export function buildApprovalDeepLink(pairingCode) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/#/approve-sign-in/${pairingCode}`;
}

/**
 * QA FINDING (2026-10-07): once `signInWithCustomTokenForSharedDevice()`
 * resolves, Firebase's own `onAuthStateChanged` fires — the SAME event
 * js/main.js's top-level auth listener reacts to. Before this flag
 * existed, main.js's own `tvSignIn` route guard ("already signed in ->
 * redirect to /teacher") raced ui/views/TvSignInView.js's own brief
 * "✓ Signed in as..." confirmation message and always won (it's wired
 * directly into the primary auth-state subscription that drives the
 * whole app's re-render; the view's own confirmation is one more await
 * tick behind it) — so the real sign-in succeeded every time (confirmed:
 * same uid, full app access) but the confirmation screen decision #7
 * calls for was never actually visible, even for an instant.
 *
 * `TvSignInView.js` sets this to true BEFORE calling
 * `signInWithCustomTokenForSharedDevice()`, and back to false only once
 * its own confirmation has been shown and it is ready to navigate away
 * itself. While true, main.js's `tvSignIn` branch defers entirely to
 * the view — no new render, no redirect — rather than fighting over
 * the same DOM. This is UI sequencing only; it does not change what
 * gets authenticated, when, or how.
 */
let transitioningAfterApproval = false;

export function isTransitioningAfterApproval() {
  return transitioningAfterApproval;
}

export function setTransitioningAfterApproval(value) {
  transitioningAfterApproval = value;
}
