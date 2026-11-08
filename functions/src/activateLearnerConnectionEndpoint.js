/**
 * functions/src/activateLearnerConnectionEndpoint.js
 *
 * The framework-agnostic CORE of the "activate this pending Learning
 * Hub connection" endpoint — a classroom's own teacher calls this
 * directly from ConnectLearningHubView.js after picking a roster
 * student for a pending request. Deliberately separated from
 * `onRequest`/CORS glue (see ../index.js), matching this repo's own
 * established convention (functions/src/deviceSignIn/deviceSignInEndpoints.js,
 * functions/src/verifyLearnerConnectionEndpoint.js).
 *
 * Authenticated with the TEACHER's OWN ClassMate Firebase ID token —
 * same-project verification (`getAuth().verifyIdToken()` against
 * ClassMate's own already-initialized Admin app), not a cross-project
 * check. Mirrors deviceSignInEndpoints.js's own verifyTeacherIdToken()
 * exactly (same shape, duplicated rather than imported, matching this
 * repo's existing per-file convention for small shared helpers — see
 * e.g. isBoundedString, duplicated across every endpoint file rather
 * than centralized).
 *
 * Untrusted request shape (the ONLY thing a caller may ever send):
 *
 *   Header:  Authorization: Bearer <ClassMate Firebase ID token (the teacher's own)>
 *   Body:    { classroomId: string, learnerProfileId: string, studentId: string }
 *
 * learnerProfileId is Learning Hub's own opaque learner-profile id —
 * ClassMate never interprets it, exactly as the rest of the Learner
 * Identity Bridge already treats it (see
 * docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md).
 *
 * Response contract:
 *   - 401 { ok: false, error: 'unauthenticated' }
 *   - 400 { ok: false, error: 'invalid_request' }
 *   - 200 { ok: false, error: 'not_found' | 'forbidden' | 'student_not_on_roster' | 'not_pending' } —
 *     specific, not anti-oracle: the caller here is always an
 *     already-authenticated ClassMate teacher acting on their own
 *     classroom's own queue, not an untrusted public caller probing
 *     for information, so there is no oracle to protect against the
 *     way the learner-facing side of this bridge must.
 *   - 200 { ok: true, status: 'ACTIVE', studentId }
 *
 * Never logs the bearer token, learnerProfileId, classroomId, or
 * studentId.
 */

import { activateRelationshipForStudent as defaultActivateRelationshipForStudent } from './learnerVerification/activateLearnerConnection.js';

const MAX_ID_LENGTH = 200;
const UNAUTHENTICATED = Object.freeze({ ok: false, error: 'unauthenticated' });
const INVALID_REQUEST = Object.freeze({ ok: false, error: 'invalid_request' });
const ALLOWED_BODY_FIELDS = Object.freeze(['classroomId', 'learnerProfileId', 'studentId']);

const REASON_TO_ERROR = Object.freeze({
  classroom_not_found: 'not_found',
  forbidden: 'forbidden',
  student_not_on_roster: 'student_not_on_roster',
  not_pending: 'not_pending',
});

function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
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
 * @param {object} params
 * @param {string|undefined} params.authorizationHeader
 * @param {unknown} params.body
 * @param {object} params.deps
 * @param {import('firebase-admin/firestore').Firestore} params.deps.adminDb
 * @param {(idToken: string) => Promise<string>} params.deps.verifyIdToken - resolves to a uid, or throws/rejects on any failure
 * @param {typeof activateRelationshipForStudent} [params.deps.activateRelationshipForStudent] - TEST-ONLY override
 * @returns {Promise<{httpStatus: number, body: object}>}
 */
export async function handleActivateLearnerConnectionRequest({ authorizationHeader, body, deps }) {
  if (!deps || !deps.adminDb) {
    throw new Error('handleActivateLearnerConnectionRequest requires deps.adminDb');
  }
  const verifyIdToken = deps.verifyIdToken;
  if (typeof verifyIdToken !== 'function') {
    throw new Error('handleActivateLearnerConnectionRequest requires deps.verifyIdToken');
  }
  const activateRelationshipForStudent = deps.activateRelationshipForStudent ?? defaultActivateRelationshipForStudent;

  const uid = await verifyTeacherIdToken(authorizationHeader, verifyIdToken);
  if (!uid) return { httpStatus: 401, body: UNAUTHENTICATED };

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { httpStatus: 400, body: INVALID_REQUEST };
  }
  const hasOnlyAllowedFields = Object.keys(body).every((key) => ALLOWED_BODY_FIELDS.includes(key));
  if (!hasOnlyAllowedFields) return { httpStatus: 400, body: INVALID_REQUEST };

  const { classroomId, learnerProfileId, studentId } = body;
  const shapeIsValid =
    isBoundedString(classroomId, MAX_ID_LENGTH) &&
    isBoundedString(learnerProfileId, MAX_ID_LENGTH) &&
    isBoundedString(studentId, MAX_ID_LENGTH);
  if (!shapeIsValid) return { httpStatus: 400, body: INVALID_REQUEST };

  const result = await activateRelationshipForStudent(deps.adminDb, {
    classroomId,
    studentId,
    teacherUid: uid,
    learnerProfileId,
  });

  if (!result.ok) {
    return { httpStatus: 200, body: { ok: false, error: REASON_TO_ERROR[result.reason] || 'activation_failed' } };
  }
  return { httpStatus: 200, body: { ok: true, status: 'ACTIVE', studentId: result.studentId } };
}
