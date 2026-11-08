/**
 * functions/src/getNotebookObligationsForLearnerEndpoint.js
 *
 * The framework-agnostic CORE of the read-only Notebook Obligations
 * endpoint Learning Hub calls to show a learner their own outstanding
 * notebook work — deliberately separated from any HTTP/`onRequest`
 * glue (see ../index.js), matching this repo's own "extract
 * pure/testable logic" convention already established by
 * ./verifyLearnerConnectionEndpoint.js.
 *
 * This endpoint performs NO Firestore writes anywhere, ever — it is
 * strictly a read. It reuses the SAME two trust primitives the Learner
 * Identity Bridge already established and already tested, unmodified:
 *   1. ./learningHubAuth.js        — is this really a Learning Hub caller?
 *   2. ./learnerProfileOwnership.js — does that caller actually own the
 *      learnerProfileId they're claiming?
 * Neither module is touched by this file. Both are imported exactly as
 * verifyLearnerConnectionEndpoint.js already imports them, with the
 * same TEST-ONLY `deps` override shape.
 *
 * Untrusted request shape (the ONLY thing a caller may ever send):
 *
 *   Header:  Authorization: Bearer <Learning Hub Firebase ID token>
 *   Body:    { learnerProfileId: string, classroomId: string }
 *
 * No other field is ever accepted — a request containing ANY key
 * outside this exact pair (including, but not limited to, `studentId`)
 * is rejected outright with 400, not silently stripped. `studentId` is
 * never a request input anywhere in this file; see step 2 below and
 * step 4, where it is instead resolved exclusively server-side from the
 * caller's own authoritative, ACTIVE `learnerClassroomRelationships`
 * record — never from anything the caller asserts.
 *
 * Response contract — the complete, exhaustive set of fields this
 * endpoint will EVER return, enforced by this file's own allowlist
 * construction below (every object literal here is built field-by-
 * field, never via object spread of anything Firestore-sourced) and
 * proven by tests/functions/getNotebookObligationsForLearnerEndpoint.test.js's
 * own "response schema allowlist" test:
 *   - 401 { ok: false, error: 'unauthenticated' }
 *   - 400 { ok: false, error: 'invalid_request' }
 *   - 200 { ok: false, error: 'obligations_unavailable' } — every
 *     domain-level rejection from this point on (unowned profile, no
 *     ACTIVE relationship, classroom mismatch, classroom not found,
 *     OR an unexpected exception while loading/projecting classroom
 *     data — e.g. a malformed/legacy WorkRequest a future security
 *     review didn't anticipate either, not just the one
 *     ./notebookObligationsProjection.js now defends against directly)
 *     collapses to this identical shape, matching this bridge's own
 *     anti-oracle convention (verifyLearnerConnectionEndpoint.js's own
 *     GENERIC_FAILURE) — a caller cannot distinguish any of those
 *     cases from one another, and never sees classroom contents,
 *     student identifiers, or a stack trace instead.
 *   - 200 { ok: true, status: { summary: {awaitingSubmission,
 *     awaitingReview, needsCorrection, reviewed, absent: <counts>},
 *     items: {awaitingSubmission: [...], awaitingReview: [...],
 *     needsCorrection: [...], reviewed: [...], absent: [...]} } } —
 *     CHECKPOINT-AWARE as of this change: built from
 *     ./notebookStatusProjection.js's getNotebookStatusForStudent(),
 *     which merges BOTH of ClassMate's notebook-tracking systems (the
 *     newer, now-default Checkpoint system and the legacy WorkRequest
 *     "obligations" system this endpoint originally and exclusively
 *     returned), with checkpoint tracking winning on any identity
 *     collision — see that file's own header comment for the full
 *     precedence rule, ported byte-for-byte from
 *     js/services/notebookStatusService.js. Each item is explicitly
 *     rebuilt below as {source, title, subjectId, notebookTypeId,
 *     dueDate, updatedAt, actionable} — the projection's own internal
 *     `id`/`checkpointId`/`requestId` fields (ClassMate-internal
 *     identifiers with no established need on Learning Hub's side) are
 *     deliberately NOT forwarded, matching this endpoint's own
 *     field-minimization discipline.
 *
 * BREAKING CHANGE from the original {obligations: [...]} shape — no
 * caller existed on Learning Hub's side for the original shape yet
 * (confirmed before this change), so there is no live consumer to
 * migrate; this is not a versioned/dual-shape response.
 *
 * Never logs the bearer token, learnerProfileId, classroomId,
 * studentId, or any returned obligation/status content — see this
 * repo's own data-handling posture in
 * docs/architecture/NOTEBOOK_OBLIGATIONS_ENDPOINT.md.
 */

import { verifyLearningHubIdToken as defaultVerifyLearningHubIdToken } from './learningHubAuth.js';
import { verifyLearnerProfileOwnership as defaultVerifyLearnerProfileOwnership } from './learnerProfileOwnership.js';
import { getNotebookStatusForStudent } from './notebookStatusProjection.js';

const STATUS_BUCKET_KEYS = ['awaitingSubmission', 'awaitingReview', 'needsCorrection', 'reviewed', 'absent'];

/**
 * Explicit, field-by-field response item — never a spread of the
 * projection's own internal item shape. Drops `id`/`checkpointId`/
 * `requestId` deliberately (see this file's own header comment).
 */
function toResponseItem(item) {
  return {
    source: item.source,
    title: item.title,
    subjectId: item.subjectId,
    notebookTypeId: item.notebookTypeId,
    dueDate: item.dueDate,
    updatedAt: item.updatedAt,
    actionable: item.actionable,
  };
}

function toResponseStatus(status) {
  const items = {};
  STATUS_BUCKET_KEYS.forEach((key) => {
    items[key] = (status.items[key] || []).map(toResponseItem);
  });
  return { summary: { ...status.summary }, items };
}

const UNAUTHENTICATED = Object.freeze({ ok: false, error: 'unauthenticated' });
const INVALID_REQUEST = Object.freeze({ ok: false, error: 'invalid_request' });
/** Identical generic failure shape for every domain-level rejection — never distinguishable from one another, by design (anti-oracle), matching verifyLearnerConnectionEndpoint.js's own GENERIC_FAILURE convention. */
const GENERIC_FAILURE = Object.freeze({ ok: false, error: 'obligations_unavailable' });

const MAX_ID_LENGTH = 200;
const ALLOWED_BODY_FIELDS = Object.freeze(['learnerProfileId', 'classroomId']);
const ACTIVE_RELATIONSHIP_STATUS = 'ACTIVE';

function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function buildRelationshipId(learnerProfileId, classroomId) {
  return `${learnerProfileId}_${classroomId}`;
}

/**
 * @param {object} params
 * @param {string|undefined} params.authorizationHeader - raw header value, e.g. "Bearer <token>"
 * @param {unknown} params.body - parsed JSON request body, untrusted
 * @param {object} params.deps
 * @param {import('firebase-admin/firestore').Firestore} params.deps.adminDb - ClassMate's OWN Firestore Admin instance (never Learning Hub's) — required, no default, so this module can never silently talk to the wrong project
 * @param {(idToken: string) => Promise<string|null>} [params.deps.verifyLearningHubIdToken] - TEST-ONLY override; production always uses the real cross-project verifier
 * @param {(uid: string, learnerProfileId: string) => Promise<boolean>} [params.deps.verifyLearnerProfileOwnership] - TEST-ONLY override; production always uses the real cross-project IAM-gated check
 * @returns {Promise<{httpStatus: number, body: object}>}
 */
export async function handleGetNotebookObligationsForLearnerRequest({ authorizationHeader, body, deps }) {
  if (!deps || !deps.adminDb) {
    throw new Error('handleGetNotebookObligationsForLearnerRequest requires deps.adminDb (ClassMate\'s own Firestore Admin instance)');
  }
  const verifyIdToken = deps.verifyLearningHubIdToken ?? defaultVerifyLearningHubIdToken;
  const verifyOwnership = deps.verifyLearnerProfileOwnership ?? defaultVerifyLearnerProfileOwnership;

  // --- 1. Authentication: is there a real, verified Learning Hub caller at all? ---
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

  // --- 2. Request shape validation: ONLY learnerProfileId + classroomId, nothing else ---
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { httpStatus: 400, body: INVALID_REQUEST };
  }
  const hasOnlyAllowedFields = Object.keys(body).every((key) => ALLOWED_BODY_FIELDS.includes(key));
  if (!hasOnlyAllowedFields) {
    // Covers studentId specifically (never an accepted input, by
    // construction) and any other unexpected field — rejected
    // outright, not silently stripped, for the same anti-probing
    // reason verifyLearnerConnectionEndpoint.js's own studentId check
    // documents.
    return { httpStatus: 400, body: INVALID_REQUEST };
  }
  const { learnerProfileId, classroomId } = body;
  const shapeIsValid = isBoundedString(learnerProfileId, MAX_ID_LENGTH) && isBoundedString(classroomId, MAX_ID_LENGTH);
  if (!shapeIsValid) {
    return { httpStatus: 400, body: INVALID_REQUEST };
  }

  // --- 3. Identity binding: does learnerProfileId actually belong to verifiedUid? ---
  // From here on, EVERY rejection uses the identical domain-level
  // GENERIC_FAILURE, at 200 — a caller cannot distinguish "not your
  // profile" from "no active relationship" from "wrong classroom" from
  // "classroom not found," by design.
  let ownsProfile = false;
  try {
    ownsProfile = await verifyOwnership(verifiedUid, learnerProfileId);
  } catch {
    ownsProfile = false;
  }
  if (!ownsProfile) {
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }

  // --- 4. Resolve studentId EXCLUSIVELY from the authoritative, ACTIVE
  //        learnerClassroomRelationships record — read fresh on every
  //        request, never cached, never trusted from the request body
  //        (studentId isn't even an accepted field — see step 2). ---
  let relationshipSnap;
  try {
    relationshipSnap = await deps.adminDb
      .collection('learnerClassroomRelationships')
      .doc(buildRelationshipId(learnerProfileId, classroomId))
      .get();
  } catch {
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }
  if (!relationshipSnap.exists) {
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }
  const relationship = relationshipSnap.data();
  if (
    !relationship ||
    relationship.status !== ACTIVE_RELATIONSHIP_STATUS ||
    relationship.classroomId !== classroomId || // defense in depth — the doc id already scopes this
    !relationship.studentId
  ) {
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }
  const studentId = relationship.studentId;

  // --- 5. Load the classroom server-side and reuse the existing,
  //        unmodified projection. ---
  let classroomSnap;
  try {
    classroomSnap = await deps.adminDb.collection('classrooms').doc(classroomId).get();
  } catch {
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }
  if (!classroomSnap.exists) {
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }

  // Defense in depth, matching every other step above: even though
  // ./notebookStatusProjection.js (via ./notebookObligationsProjection.js)
  // now guards its own known malformed-entries case (see that file's
  // own header comment), this still wraps the whole classroom-data-
  // access + projection step so NO shape of malformed/legacy classroom
  // data — known or not yet discovered — can ever surface an uncaught
  // exception, a stack trace, or any response shape other than the
  // same anti-oracle GENERIC_FAILURE every other failure in this file
  // already uses. Never logs the caught error: it could contain
  // classroom contents.
  let status;
  try {
    const classroom = classroomSnap.data();
    status = toResponseStatus(getNotebookStatusForStudent(classroom, studentId));
  } catch {
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }

  return { httpStatus: 200, body: { ok: true, status } };
}
