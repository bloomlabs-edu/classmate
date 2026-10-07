/**
 * functions/src/deviceSignIn/rateLimiter.js
 *
 * A small, generic, Firestore-backed fixed-window rate limiter —
 * Admin-SDK-only, same "no client Firestore rule needed because only
 * trusted server code ever reaches this collection" choice already
 * made for `deviceSignInSessions` itself (see
 * deviceSignInRepository.js's own header comment). Exists because this
 * feature's two fully-unauthenticated endpoints (`startDeviceSignIn`,
 * `pollDeviceSignIn`) have no caller identity to lean on, and the
 * 8-digit pairing code (decision #2) is deliberately NOT high-entropy
 * on its own — rate limiting is a REQUIRED control here, not a nice-to-
 * have (see config.js's own header comment).
 *
 * Deliberately generic (a `bucketKey` + `maxAttempts`/`windowMs`
 * budget) rather than hardcoded to one endpoint, so the same primitive
 * covers both the IP-keyed anonymous endpoints and the uid-keyed
 * authenticated ones (see deviceSignInEndpoints.js) without a second,
 * parallel implementation.
 */
import { RATE_LIMITS } from './config.js';

const RATE_LIMITS_COLLECTION = 'deviceSignInRateLimits';

/**
 * @param {import('firebase-admin/firestore').Firestore} adminDb
 * @param {string} bucketKey - e.g. "start:203.0.113.5" or "approve:teacherUid123" — already namespaced by the caller, this module has no opinion on format
 * @param {{maxAttempts: number, windowMs: number}} budget
 * @param {number} nowMs - ms since epoch, injectable for tests
 * @returns {Promise<boolean>} true if this attempt is allowed (and has been recorded), false if the budget is exhausted for the current window (NOT recorded again — a caller already over budget doesn't keep extending its own window by hammering)
 */
export async function checkAndRecordAttempt(adminDb, bucketKey, budget, nowMs = Date.now()) {
  const ref = adminDb.collection(RATE_LIMITS_COLLECTION).doc(encodeBucketKey(bucketKey));

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;

    const windowIsFresh = !data || nowMs - data.windowStart >= budget.windowMs;
    if (windowIsFresh) {
      tx.set(ref, { windowStart: nowMs, count: 1 });
      return true;
    }

    if (data.count >= budget.maxAttempts) {
      return false; // over budget — deliberately not written again, so a caller hammering past the limit doesn't itself generate unbounded writes
    }

    tx.update(ref, { count: data.count + 1 });
    return true;
  });
}

/** A Firestore document id must not contain "/" — bucketKey values here are always "label:identifier" where identifier may be an IP (":"-free for IPv4, but IPv6 contains ":") or a uid; encodeURIComponent keeps every case a valid single path segment without this module needing to know which case it's in. */
function encodeBucketKey(bucketKey) {
  return encodeURIComponent(bucketKey);
}

export { RATE_LIMITS };
