/**
 * functions/src/slack/stateToken.js
 *
 * Signs/verifies the OAuth `state` parameter used by the "Sign in with
 * Slack" identity-linking flow (see functions/src/slack/oauthCallback.js
 * and docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md §5).
 * Its one job: prove that whoever completes the Slack consent screen
 * and gets redirected back is the SAME already-authenticated ClassMate
 * teacher who started the flow, and that the flow hasn't gone stale.
 *
 * Deliberately pure and dependency-free (no Firestore, no Slack SDK)
 * so it's directly unit-testable without any emulator — same
 * "extract pure/testable logic" convention already used elsewhere in
 * this codebase (e.g. functions/src/learnerProfileOwnership.js).
 *
 * Format: base64url(`${uid}.${expiresAt}.${hmacHex}`). Not a JWT —
 * there's no need for a header/alg negotiation here, since both the
 * signer and verifier are this same module, always using HMAC-SHA256
 * with one shared secret (SLACK_STATE_SIGNING_SECRET).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes — enough time to complete Slack's own consent screen, short enough to bound replay risk if a state value ever leaked (e.g. via a referrer header).

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

/** Constant-time comparison of two hex strings — returns false (never throws) for any malformed input, including mismatched lengths. */
function safeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * @param {object} params
 * @param {string} params.uid - the already-authenticated ClassMate teacher's uid to bind this flow to
 * @param {string} params.secret - SLACK_STATE_SIGNING_SECRET's value
 * @param {number} [params.ttlMs] - override for tests
 * @param {number} [params.now] - override for tests (ms since epoch)
 * @returns {string} an opaque token safe to pass through Slack's own `state` query param
 */
export function createStateToken({ uid, secret, ttlMs = DEFAULT_TTL_MS, now = Date.now() }) {
  if (!uid || !secret) throw new Error('createStateToken requires both uid and secret.');
  const expiresAt = now + ttlMs;
  const payload = `${uid}.${expiresAt}`;
  return base64UrlEncode(`${payload}.${sign(payload, secret)}`);
}

/**
 * @returns {string|null} the bound uid if `token` is well-formed, correctly signed, and not expired; `null` for every other case (malformed, tampered, or expired) — collapsed to one outcome deliberately, matching this repo's existing anti-oracle convention (functions/src/verifyLearnerConnectionEndpoint.js).
 */
export function verifyStateToken({ token, secret, now = Date.now() }) {
  if (typeof token !== 'string' || !token || !secret) return null;
  let decoded;
  try {
    decoded = base64UrlDecode(token);
  } catch {
    return null;
  }
  const parts = decoded.split('.');
  if (parts.length !== 3) return null;
  const [uid, expiresAtText, signature] = parts;
  if (!uid || !expiresAtText || !signature) return null;

  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || now > expiresAt) return null;

  const expectedSignature = sign(`${uid}.${expiresAtText}`, secret);
  if (!safeEquals(signature, expectedSignature)) return null;

  return uid;
}
