/**
 * functions/src/deviceSignIn/deviceSignInEndpoints.js
 *
 * The framework-agnostic CORE of every "Sign in with Phone" HTTP
 * endpoint — deliberately separated from `onRequest`/CORS/Express glue
 * (see ../../index.js) so it is directly unit- and emulator-testable
 * without deploying anything, matching this repo's own established
 * convention (functions/src/verifyLearnerConnectionEndpoint.js).
 *
 * Every handler takes `{ ..., deps }`, where `deps` always supplies
 * `adminDb`, `now` (ms-since-epoch, injectable for tests), and
 * whatever Admin SDK calls that handler needs — never imports
 * `firebase-admin` directly, so a test can supply a real emulator-
 * backed Firestore instance and a real or fake Auth verifier/minter
 * without this module caring which.
 *
 * See docs/architecture/TV_PHONE_SIGNIN_DESIGN.md for the full flow
 * these five handlers implement end to end.
 */
import {
  generatePairingCode,
  generateTvSessionToken,
  hashSecret,
  isValidPairingCodeShape,
  isValidTvSessionTokenShape,
} from './pairingSecret.js';
import { createSession, getPendingSessionInfo, approveSession, denySession, consumeApprovedSession } from './deviceSignInRepository.js';
import { checkAndRecordAttempt } from './rateLimiter.js';
import { PAIRING_SESSION_TTL_MS, RATE_LIMITS } from './config.js';

const MAX_DEVICE_LABEL_LENGTH = 80;
const MAX_CREATE_ATTEMPTS = 3; // retries on a genuine pairing-code hash collision only — see deviceSignInRepository.createSession()'s own header comment

const RATE_LIMITED = Object.freeze({ ok: false, error: 'rate_limited' });
const UNAUTHENTICATED = Object.freeze({ ok: false, error: 'unauthenticated' });
const INVALID_REQUEST = Object.freeze({ ok: false, error: 'invalid_request' });
const INVALID_OR_EXPIRED = Object.freeze({ ok: false, error: 'invalid_or_expired' });

/**
 * Strips ASCII control characters and bounds length — this value is
 * NEVER used in any security decision, only ever displayed back to the
 * teacher on her own approval screen, so this is purely a display-
 * safety/size guard, not an auth control. Filters by character code
 * rather than a regex literal containing control-character escapes, to
 * avoid any ambiguity about what actually ends up in this source file.
 */
function sanitizeDeviceLabel(rawLabel) {
  const text = typeof rawLabel === 'string' ? rawLabel : '';
  let stripped = '';
  for (const char of text) {
    const code = char.codePointAt(0);
    const isControlCharacter = code <= 31 || code === 127;
    if (!isControlCharacter) stripped += char;
  }
  stripped = stripped.trim();
  return stripped.slice(0, MAX_DEVICE_LABEL_LENGTH) || 'Unknown device';
}

async function verifyTeacherIdToken(authorizationHeader, verifyIdToken) {
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) return null;
  const idToken = authorizationHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;
  try {
    return await verifyIdToken(idToken);
  } catch {
    return null;
  }
}

/**
 * Step 1 — the TV requests a brand-new pairing session. Public, no
 * authentication possible (the TV has none yet — that is the entire
 * point of this feature), so this is the one endpoint where IP-keyed
 * rate limiting is the ONLY control standing between an anonymous
 * caller and unbounded session creation.
 *
 * Returns the raw pairing code and the TV's own private session token
 * — the ONLY time either ever leaves this backend in plaintext. Both
 * are immediately hashed before being written to Firestore (see
 * deviceSignInRepository.createSession()); this function holds the raw
 * values in memory only for the duration of this one call.
 */
export async function handleStartDeviceSignIn({ body, clientKey, deps }) {
  const allowed = await checkAndRecordAttempt(deps.adminDb, `start:${clientKey || 'unknown'}`, RATE_LIMITS.start, deps.now());
  if (!allowed) return { httpStatus: 429, body: RATE_LIMITED };

  const deviceLabel = sanitizeDeviceLabel(body?.deviceLabel);

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const pairingCode = deps.generatePairingCode ? deps.generatePairingCode() : generatePairingCode();
    const tvSessionToken = deps.generateTvSessionToken ? deps.generateTvSessionToken() : generateTvSessionToken();
    const nowMs = deps.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAtIso = new Date(nowMs + PAIRING_SESSION_TTL_MS).toISOString();

    try {
      // eslint-disable-next-line no-await-in-loop
      await createSession(deps.adminDb, {
        codeHash: hashSecret(pairingCode),
        tvSessionTokenHash: hashSecret(tvSessionToken),
        deviceLabel,
        nowIso,
        expiresAtIso,
      });
      return { httpStatus: 200, body: { ok: true, pairingCode, tvSessionToken, expiresAt: expiresAtIso } };
    } catch (error) {
      // ALREADY_EXISTS (gRPC code 6) is the one error worth retrying on
      // (see deviceSignInRepository.createSession()'s own header
      // comment) — anything else is a genuine failure, surfaced as-is.
      if (error?.code !== 6 && error?.code !== 'already-exists') throw error;
    }
  }

  return { httpStatus: 500, body: { ok: false, error: 'could_not_allocate_session' } };
}

/**
 * Step 2 — the phone, already teacher-authenticated, asks "what am I
 * about to approve?" before showing its own confirm screen.
 */
export async function handleGetDeviceSignInRequestInfo({ authorizationHeader, body, deps }) {
  const uid = await verifyTeacherIdToken(authorizationHeader, deps.verifyIdToken);
  if (!uid) return { httpStatus: 401, body: UNAUTHENTICATED };

  const allowed = await checkAndRecordAttempt(deps.adminDb, `info:${uid}`, RATE_LIMITS.info, deps.now());
  if (!allowed) return { httpStatus: 429, body: RATE_LIMITED };

  const pairingCode = body?.pairingCode;
  if (!isValidPairingCodeShape(pairingCode)) return { httpStatus: 400, body: INVALID_REQUEST };

  const nowIso = new Date(deps.now()).toISOString();
  const info = await getPendingSessionInfo(deps.adminDb, hashSecret(pairingCode), nowIso);
  if (!info) return { httpStatus: 200, body: INVALID_OR_EXPIRED };

  // `expiresAt` lets the phone show a real countdown (UX only — the
  // server below still independently re-validates expiresAt at the
  // actual Approve/Deny call; this is never trusted for authorization).
  return { httpStatus: 200, body: { ok: true, deviceLabel: info.deviceLabel, requestedAt: info.createdAt, expiresAt: info.expiresAt } };
}

const REASON_TO_MESSAGE = Object.freeze({
  not_found: 'invalid_or_expired',
  expired: 'invalid_or_expired',
  not_pending: 'already_resolved',
});

/** Step 3a — the teacher taps Approve. Mints the custom token BEFORE the transactional approve: minting is a stateless JWT-signing operation with no Firestore side effect of its own, so if the transaction then finds the session no longer approvable (lost a race, already resolved, expired), the freshly-minted token is simply discarded — never written anywhere, never returned to any caller. This ordering keeps the transaction itself free of any Admin Auth call, which Firestore transactions cannot safely retry around anyway. */
export async function handleApproveDeviceSignIn({ authorizationHeader, body, deps }) {
  const uid = await verifyTeacherIdToken(authorizationHeader, deps.verifyIdToken);
  if (!uid) return { httpStatus: 401, body: UNAUTHENTICATED };

  const allowed = await checkAndRecordAttempt(deps.adminDb, `approve:${uid}`, RATE_LIMITS.approve, deps.now());
  if (!allowed) return { httpStatus: 429, body: RATE_LIMITED };

  const pairingCode = body?.pairingCode;
  if (!isValidPairingCodeShape(pairingCode)) return { httpStatus: 400, body: INVALID_REQUEST };

  const customToken = await deps.createCustomToken(uid);
  const nowIso = new Date(deps.now()).toISOString();

  const result = await approveSession(deps.adminDb, { codeHash: hashSecret(pairingCode), approvedByUid: uid, customToken, nowIso });
  if (!result.ok) return { httpStatus: 200, body: { ok: false, error: REASON_TO_MESSAGE[result.reason] || 'invalid_or_expired' } };

  return { httpStatus: 200, body: { ok: true } };
}

/** Step 3b — the teacher taps Deny. No token is ever minted on this path. */
export async function handleDenyDeviceSignIn({ authorizationHeader, body, deps }) {
  const uid = await verifyTeacherIdToken(authorizationHeader, deps.verifyIdToken);
  if (!uid) return { httpStatus: 401, body: UNAUTHENTICATED };

  const allowed = await checkAndRecordAttempt(deps.adminDb, `deny:${uid}`, RATE_LIMITS.deny, deps.now());
  if (!allowed) return { httpStatus: 429, body: RATE_LIMITED };

  const pairingCode = body?.pairingCode;
  if (!isValidPairingCodeShape(pairingCode)) return { httpStatus: 400, body: INVALID_REQUEST };

  const nowIso = new Date(deps.now()).toISOString();
  const result = await denySession(deps.adminDb, { codeHash: hashSecret(pairingCode), nowIso });
  if (!result.ok) return { httpStatus: 200, body: { ok: false, error: REASON_TO_MESSAGE[result.reason] || 'invalid_or_expired' } };

  return { httpStatus: 200, body: { ok: true } };
}

const POLL_REASON_TO_STATUS = Object.freeze({
  expired: 'expired',
  denied: 'denied',
  pending: 'pending',
});

/**
 * Step 4 — the TV polls, presenting BOTH the pairing code and its own
 * private tv session token (see consumeApprovedSession()'s own header
 * comment for why the token is checked first and why that's what makes
 * this endpoint safe to leave fully unauthenticated). Public, so this
 * is the other IP-rate-limited endpoint.
 */
export async function handlePollDeviceSignIn({ body, clientKey, deps }) {
  const allowed = await checkAndRecordAttempt(deps.adminDb, `poll:${clientKey || 'unknown'}`, RATE_LIMITS.poll, deps.now());
  if (!allowed) return { httpStatus: 429, body: RATE_LIMITED };

  const pairingCode = body?.pairingCode;
  const tvSessionToken = body?.tvSessionToken;
  if (!isValidPairingCodeShape(pairingCode) || !isValidTvSessionTokenShape(tvSessionToken)) {
    return { httpStatus: 400, body: INVALID_REQUEST };
  }

  const nowIso = new Date(deps.now()).toISOString();
  const result = await consumeApprovedSession(deps.adminDb, {
    codeHash: hashSecret(pairingCode),
    tvSessionTokenHash: hashSecret(tvSessionToken),
    nowIso,
  });

  if (!result.ok) {
    if (result.reason === 'not_found') return { httpStatus: 200, body: INVALID_OR_EXPIRED };
    return { httpStatus: 200, body: { ok: true, status: POLL_REASON_TO_STATUS[result.reason] } };
  }

  return { httpStatus: 200, body: { ok: true, status: 'approved', customToken: result.customToken } };
}
