/**
 * functions/src/deviceSignIn/config.js
 *
 * Non-secret "Sign in with Phone" (TV pairing) configuration — same
 * "plain constants file, no Secret Manager needed" convention as
 * functions/src/slack/config.js (this feature needs no secret at all:
 * unlike the Slack flow, nothing here is signed with a shared HMAC key
 * — every secret this feature creates is a random value whose only
 * copy worth protecting is hashed before it ever touches Firestore,
 * see pairingSecret.js).
 *
 * See docs/architecture/TV_PHONE_SIGNIN_DESIGN.md for the full design
 * these numbers implement.
 */

/** Decision #2: pairing sessions live for exactly 2 minutes. */
export const PAIRING_SESSION_TTL_MS = 2 * 60 * 1000;

/** Decision #2: an 8-digit numeric code, shown on the TV as both the QR payload and a plain typeable string. */
export const PAIRING_CODE_DIGITS = 8;

/**
 * The TV's own private binding secret (see pairingSecret.js's own
 * header comment on why this exists) — never shown on screen, never
 * encoded in the QR, so it needs no "easy to read aloud" constraint
 * the pairing code has. 32 random bytes (256 bits) is intentionally
 * far beyond brute-forceable, since this is the one value this whole
 * design actually relies on for real cryptographic strength — the
 * 8-digit pairing code's own ~26.6 bits is deliberately compensated
 * for by short TTL + hashing + rate limiting instead (see decision #2
 * and #5 — "appropriate rate limiting on pairing-code attempts" is not
 * a nice-to-have here, it is load-bearing).
 */
export const TV_SESSION_TOKEN_BYTES = 32;

/**
 * Fixed-window rate limits — see rateLimiter.js. `start`/`poll` are
 * keyed by caller IP (fully unauthenticated endpoints); `info`/
 * `approve`/`deny` are keyed by the caller's own verified Firebase uid
 * (authenticated endpoints — accountable, so a slightly more generous
 * budget is fine). `poll`'s own budget assumes a legitimate TV polling
 * roughly every 2s for up to the full 2-minute TTL (~60 requests) and
 * leaves real headroom above that for jitter/retries, while still
 * bounding how many pairing-code GUESSES a single source can attempt
 * per minute against `pollDeviceSignIn` specifically — see this
 * feature's own README section in the design doc on why entropy alone
 * was not treated as sufficient.
 */
export const RATE_LIMITS = Object.freeze({
  start: Object.freeze({ maxAttempts: 10, windowMs: 60 * 1000 }),
  poll: Object.freeze({ maxAttempts: 90, windowMs: 60 * 1000 }),
  info: Object.freeze({ maxAttempts: 20, windowMs: 60 * 1000 }),
  approve: Object.freeze({ maxAttempts: 10, windowMs: 60 * 1000 }),
  deny: Object.freeze({ maxAttempts: 10, windowMs: 60 * 1000 }),
});
