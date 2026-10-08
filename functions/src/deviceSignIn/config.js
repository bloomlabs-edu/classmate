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

/**
 * CHANGED 2026-10-08, first real physical-device QA round (see
 * docs/architecture/TV_PHONE_SIGNIN_RACE_INVESTIGATION.md): raised from
 * the original 2 minutes to 5. A first-time real flow genuinely needs
 * that long — unlock the phone, open the camera, scan the QR (or type
 * the code by hand), get through Google's own account chooser if she
 * isn't already signed in on her phone, read the confirm screen, then
 * explicitly tap Approve. 2 minutes proved too tight for that in
 * practice; 5 minutes is still a deliberately short-lived window, not a
 * loosening of the security model — the pairing code is still single-
 * use, still hashed-only at rest, still rate-limited, and still bound
 * to one specific TV session (see deviceSignInRepository.js). This is
 * the ONE place this value is defined — every TTL comparison in this
 * feature reads it from here, never a duplicated literal.
 */
export const PAIRING_SESSION_TTL_MS = 5 * 60 * 1000;

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
 * budget is fine). `poll`'s own window is per 60 seconds (not per
 * session lifetime), so a legitimate TV polling roughly every 2s (~30
 * requests per 60s window) stays comfortably under budget regardless of
 * how long PAIRING_SESSION_TTL_MS itself is — raising that TTL does not
 * widen this budget. `maxAttempts: 90` leaves real headroom above that
 * ~30 for jitter/retries, while still
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
