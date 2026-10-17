/**
 * functions/src/verifyLearnerConnectionEndpoint.js
 *
 * The framework-agnostic CORE of the trusted Learning Hub verification
 * endpoint — deliberately separated from any HTTP/`onRequest` glue (see
 * ../index.js) so it is directly unit- and emulator-testable without
 * deploying anything or running an HTTP server, matching this repo's
 * own "extract pure/testable logic" convention
 * (js/models/LearnerConnection.js's own header comment).
 *
 * Wraps, and does not modify or duplicate, the already-implemented and
 * already-tested transaction logic in
 * server/learnerVerification/verifyLearnerConnection.js. Everything
 * this file adds is strictly upstream of that module: authenticate the
 * caller, bind their claimed learnerProfileId to that authenticated
 * identity, validate the request shape, then delegate.
 *
 * Untrusted request shape (the ONLY thing a Learning Hub caller ever
 * sends — see the architecture doc's "Endpoint Trust Boundary" section):
 *
 *   Header:  Authorization: Bearer <Learning Hub Firebase ID token>
 *   Body:    {
 *              learnerProfileId: string,
 *              classroomId: string,
 *              credentialType: 'invitation' | 'verification',
 *              credential: string
 *            }
 *
 * `studentId` is never an accepted input, by construction: it is not in
 * the destructured field list below, and a request that includes it
 * anyway is rejected outright (not silently ignored) — see step 2.
 */

import { createConnectionRequest, verifyStudentCode } from '../../server/learnerVerification/verifyLearnerConnection.js';
import { verifyLearningHubIdToken as defaultVerifyLearningHubIdToken } from './learningHubAuth.js';
import { verifyLearnerProfileOwnership as defaultVerifyLearnerProfileOwnership } from './learnerProfileOwnership.js';

/** Identical generic failure shape to server/learnerVerification/verifyLearnerConnection.js's own GENERIC_FAILURE — every domain-level rejection from this endpoint is indistinguishable from every other, by design (anti-oracle). Transport-level rejections (401/400, below) are a different, deliberate layer — see this file's own inline notes at each return site for why those are safe to distinguish. */
const GENERIC_FAILURE = Object.freeze({ ok: false, error: 'verification_failed' });
const UNAUTHENTICATED = Object.freeze({ ok: false, error: 'unauthenticated' });
const INVALID_REQUEST = Object.freeze({ ok: false, error: 'invalid_request' });

const MAX_ID_LENGTH = 200;
const MAX_CREDENTIAL_LENGTH = 64;

function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * @param {object} params
 * @param {string|undefined} params.authorizationHeader - raw header value, e.g. "Bearer <token>"
 * @param {unknown} params.body - parsed JSON request body, untrusted
 * @param {object} params.deps
 * @param {import('firebase-admin/firestore').Firestore} params.deps.adminDb - ClassMate's OWN Firestore Admin instance (never Learning Hub's) — required, no default, so this module can never silently talk to the wrong project
 * @param {(idToken: string) => Promise<string|null>} [params.deps.verifyLearningHubIdToken] - TEST-ONLY override; production always uses the real cross-project verifier
 * @param {(uid: string, learnerProfileId: string) => Promise<boolean>} [params.deps.verifyLearnerProfileOwnership] - TEST-ONLY override; production always uses the fail-closed stub (see learnerProfileOwnership.js) until a real cross-project data contract exists
 * @returns {Promise<{httpStatus: number, body: object}>}
 */
export async function handleVerifyLearnerConnectionRequest({ authorizationHeader, body, deps }) {
  if (!deps || !deps.adminDb) {
    throw new Error('handleVerifyLearnerConnectionRequest requires deps.adminDb (ClassMate\'s own Firestore Admin instance)');
  }
  const verifyIdToken = deps.verifyLearningHubIdToken ?? defaultVerifyLearningHubIdToken;
  const verifyOwnership = deps.verifyLearnerProfileOwnership ?? defaultVerifyLearnerProfileOwnership;

  // --- 1. Authentication: is there a real, verified Learning Hub caller at all? ---
  // 401 here reveals nothing about any classroom, student, or learner —
  // only "you are not an authenticated caller," the same thing any
  // unauthenticated request to any endpoint would learn. Safe to
  // distinguish from the domain-level GENERIC_FAILURE below.
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    return { httpStatus: 401, body: UNAUTHENTICATED };
  }
  const idToken = authorizationHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    return { httpStatus: 401, body: UNAUTHENTICATED };
  }

  let verifiedUid = null;
  try {
    verifiedUid = await verifyIdToken(idToken);
  } catch {
    verifiedUid = null;
  }
  if (!verifiedUid) {
    return { httpStatus: 401, body: UNAUTHENTICATED };
  }

  // --- 2. Request shape validation ---
  // Also reveals nothing domain-specific — a malformed request is
  // rejected identically regardless of what (if anything) it was
  // trying to name.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { httpStatus: 400, body: INVALID_REQUEST };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'studentId')) {
    // studentId is never an accepted input. Rejected outright, not
    // silently stripped — silently ignoring it would let a caller
    // probe whether the field is read at all by observing behavior
    // change; an outright, unconditional 400 does not.
    return { httpStatus: 400, body: INVALID_REQUEST };
  }
  const { learnerProfileId, classroomId, credentialType, credential } = body;
  const shapeIsValid =
    isBoundedString(learnerProfileId, MAX_ID_LENGTH) &&
    isBoundedString(classroomId, MAX_ID_LENGTH) &&
    isBoundedString(credential, MAX_CREDENTIAL_LENGTH) &&
    (credentialType === 'invitation' || credentialType === 'verification');
  if (!shapeIsValid) {
    return { httpStatus: 400, body: INVALID_REQUEST };
  }

  // --- 3. Identity binding: does learnerProfileId actually belong to verifiedUid? ---
  // From here on, EVERY rejection uses the identical domain-level
  // GENERIC_FAILURE, at 200 — a caller cannot distinguish "your
  // learnerProfileId isn't yours" from "wrong classroom" from "bad
  // code" from "already active", by design.
  let ownsProfile = false;
  try {
    ownsProfile = await verifyOwnership(verifiedUid, learnerProfileId);
  } catch {
    ownsProfile = false;
  }
  if (!ownsProfile) {
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }

  // --- 4. Delegate to the already-tested trusted verification module ---
  // This endpoint performs NO Firestore writes of its own, anywhere —
  // every write this request can possibly cause happens exclusively
  // inside createConnectionRequest/verifyStudentCode's own transaction
  // logic, unchanged from what the prior review already verified.
  const result =
    credentialType === 'invitation'
      ? await createConnectionRequest(deps.adminDb, { learnerProfileId, classroomId, invitationCode: credential })
      : await verifyStudentCode(deps.adminDb, { learnerProfileId, classroomId, rawCode: credential });

  return { httpStatus: 200, body: result };
}
