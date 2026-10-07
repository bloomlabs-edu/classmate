/**
 * functions/src/deviceSignIn/pairingSecret.js
 *
 * Pure, dependency-free crypto helpers for the "Sign in with Phone" TV
 * pairing flow — no Firestore, no HTTP, directly unit-testable without
 * an emulator, matching this repo's own established "extract
 * pure/testable logic" convention (functions/src/slack/stateToken.js,
 * functions/src/learnerProfileOwnership.js).
 *
 * TWO distinct secrets exist per pairing session, deliberately not one:
 *
 *   1. The PAIRING CODE — an 8-digit number, shown on the TV as both a
 *      QR payload and plain text, and typed/scanned by the teacher's
 *      phone. This is, by its own nature, visible to anyone glancing at
 *      the TV — it is the "public half" of this handshake.
 *   2. The TV SESSION TOKEN — a 256-bit random value returned ONLY in
 *      `startDeviceSignIn`'s own HTTP response to the TV itself, never
 *      displayed, never put in the QR. This is the "private half": the
 *      TV's own proof that IT is the device that started this specific
 *      session, not merely someone who saw the screen. `pollDeviceSignIn`
 *      requires both — approving the pairing code alone is not enough
 *      to redeem a session; see deviceSignInRepository.js's own
 *      consumeApprovedSession(), which checks this token hash before
 *      revealing anything about the session's real state. This is what
 *      satisfies design decision #3's "bind the approval to the
 *      specific pairing session and TV session," concretely.
 *
 * Both are hashed with SHA-256 before ever being written to Firestore
 * — the document id the pairing code hashes to is just an index, never
 * a reversible encoding of it — mirroring the exact convention already
 * established by `classrooms/{id}/studentVerificationCodes/{codeHash}`
 * (see docs/architecture/STUDENT_PROFILE_BRIDGE_SECURITY_REVIEW.md).
 * Neither raw secret is ever persisted server-side, anywhere, at any
 * point — not even transiently in a log line (this module never logs).
 */
import { randomInt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { PAIRING_CODE_DIGITS, TV_SESSION_TOKEN_BYTES } from './config.js';

/**
 * A cryptographically secure, uniformly-distributed N-digit numeric
 * string (leading zeros preserved) — `node:crypto`'s `randomInt`, never
 * `Math.random()` (the latter is what config/../utils/idGenerator.js's
 * own generateJoinCode() uses, which is the right call for ITS purpose
 * — a Firestore-membership-gated join request, not a direct bearer path
 * to a live session — but the wrong bar here; see this feature's own
 * config.js header comment on why entropy here is deliberately
 * compensated for by TTL + hashing + rate limiting rather than relied
 * on alone).
 */
export function generatePairingCode() {
  const max = 10 ** PAIRING_CODE_DIGITS;
  const value = randomInt(0, max);
  return String(value).padStart(PAIRING_CODE_DIGITS, '0');
}

/** The TV's own private binding secret — see this file's own header comment. base64url, URL-safe, never containing characters that would need escaping in a query string (not that this is ever put in one — it never leaves the TV<->function channel). */
export function generateTvSessionToken() {
  return randomBytes(TV_SESSION_TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex digest — the one hashing function every caller in this feature uses, so a lookup computed one place is always comparable to one stored another. */
export function hashSecret(rawValue) {
  return createHash('sha256').update(String(rawValue), 'utf8').digest('hex');
}

/**
 * Constant-time equality for two hex digests — used wherever a caller
 * compares a freshly-computed hash against a stored one instead of
 * relying on a Firestore document-id lookup to already prove equality
 * (e.g. the TV session token hash stored ALONGSIDE the pairing-code-
 * keyed document, not used as its own lookup key). Returns false
 * (never throws) for any malformed input — mirrors
 * functions/src/slack/stateToken.js's own safeEquals().
 */
export function safeEqualsHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** True only for a well-formed N-digit numeric pairing code — the one shape check every caller validates untrusted input against before ever hashing/looking it up. */
export function isValidPairingCodeShape(value) {
  return typeof value === 'string' && new RegExp(`^\\d{${PAIRING_CODE_DIGITS}}$`).test(value);
}

/** True only for a well-formed TV session token — base64url, non-empty, bounded (generous upper bound, not an exact-length check, so this never has to change in lockstep with TV_SESSION_TOKEN_BYTES). */
export function isValidTvSessionTokenShape(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}
