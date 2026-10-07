/**
 * services/deviceSignInApprovalService.js
 *
 * The teacher's-own-phone half of "Sign in with Phone" (see
 * docs/architecture/TV_PHONE_SIGNIN_DESIGN.md). Isolates the three
 * authenticated Cloud Functions calls (info/approve/deny) behind a
 * small API, same convention as services/slackIntegrationService.js —
 * every call here requires the teacher's own Firebase ID token
 * (services/authService.js's getIdToken()), exactly like that file's
 * own beginConnect().
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

async function postJson(path, idToken, body) {
  const response = await fetch(`${getFunctionsBaseUrl()}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { httpStatus: response.status, data };
}

/**
 * What the teacher is about to approve — `{ok: true, deviceLabel,
 * requestedAt}` for a real, still-pending session, or `{ok: false,
 * reason}` (`'unauthenticated'`, `'invalid_request'`, `'rate_limited'`,
 * `'invalid_or_expired'`, or `'error'`) for every other case — never
 * throws.
 */
export async function getDeviceSignInRequestInfo(idToken, pairingCode) {
  if (!idToken) return { ok: false, reason: 'unauthenticated' };
  try {
    const { httpStatus, data } = await postJson('getDeviceSignInRequestInfo', idToken, { pairingCode });
    if (httpStatus === 401) return { ok: false, reason: 'unauthenticated' };
    if (httpStatus === 429) return { ok: false, reason: 'rate_limited' };
    if (httpStatus === 400) return { ok: false, reason: 'invalid_request' };
    if (!data?.ok) return { ok: false, reason: data?.error || 'invalid_or_expired' };
    return { ok: true, deviceLabel: data.deviceLabel, requestedAt: data.requestedAt };
  } catch (error) {
    console.error('[deviceSignInApprovalService] getDeviceSignInRequestInfo() failed:', error);
    return { ok: false, reason: 'error' };
  }
}

/** Approves the pairing session — the one explicit-consent action that lets the TV redeem a custom token. Never returns the token itself: it never leaves the server-to-TV path (see deviceSignInEndpoints.js's own comment). */
export async function approveDeviceSignIn(idToken, pairingCode) {
  if (!idToken) return { ok: false, reason: 'unauthenticated' };
  try {
    const { httpStatus, data } = await postJson('approveDeviceSignIn', idToken, { pairingCode });
    if (httpStatus === 401) return { ok: false, reason: 'unauthenticated' };
    if (httpStatus === 429) return { ok: false, reason: 'rate_limited' };
    if (!data?.ok) return { ok: false, reason: data?.error || 'invalid_or_expired' };
    return { ok: true };
  } catch (error) {
    console.error('[deviceSignInApprovalService] approveDeviceSignIn() failed:', error);
    return { ok: false, reason: 'error' };
  }
}

export async function denyDeviceSignIn(idToken, pairingCode) {
  if (!idToken) return { ok: false, reason: 'unauthenticated' };
  try {
    const { httpStatus, data } = await postJson('denyDeviceSignIn', idToken, { pairingCode });
    if (httpStatus === 401) return { ok: false, reason: 'unauthenticated' };
    if (httpStatus === 429) return { ok: false, reason: 'rate_limited' };
    if (!data?.ok) return { ok: false, reason: data?.error || 'invalid_or_expired' };
    return { ok: true };
  } catch (error) {
    console.error('[deviceSignInApprovalService] denyDeviceSignIn() failed:', error);
    return { ok: false, reason: 'error' };
  }
}
