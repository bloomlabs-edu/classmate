/**
 * utils/hashUtils.js
 *
 * Browser-side SHA-256, via the Web Crypto API already available in
 * every browser this app targets — no new dependency. Used exclusively
 * by the Learner Identity Bridge (see
 * repositories/firestoreLearnerConnectionRepository.js) to hash a
 * student verification code client-side before it is ever written to
 * Firestore, so the raw code itself is never persisted (see
 * models/LearnerConnection.js's own header comment).
 *
 * Must produce byte-identical hex output to
 * server/learnerVerification/hashUtils.js's own Node `crypto`-based
 * implementation for the same input string — both are covered by a
 * shared cross-environment test (tests/models/learnerConnection.test.js)
 * asserting exactly this, since a mismatch here would silently break
 * every redemption.
 */
export async function sha256Hex(text) {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  const data = new TextEncoder().encode(text);
  const digest = await cryptoObj.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
