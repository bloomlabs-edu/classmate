/**
 * functions/src/getClassroomRosterForLearnerEndpoint.js
 *
 * The framework-agnostic CORE of the read-only roster endpoint Learning
 * Hub calls, right after resolving a classroom code, to let a learner
 * pick their own name off that classroom's real roster — see
 * docs/architecture/LEARNER_SELF_IDENTITY_CLAIM.md. Deliberately
 * separated from any HTTP/`onRequest` glue (see ../index.js), matching
 * this repo's own "extract pure/testable logic" convention already
 * established by ./verifyLearnerConnectionEndpoint.js.
 *
 * This endpoint performs NO Firestore writes anywhere, ever — strictly
 * a read. It reuses the SAME code resolution
 * ./learnerVerification/verifyLearnerConnection.js's own
 * resolveInvitationClassroomId() already provides for actual redemption
 * — never a second, parallel lookup — so a code that works for joining
 * always resolves the identical roster, and a code that doesn't resolve
 * at all reveals nothing about any classroom (the exact same anti-oracle
 * GENERIC_FAILURE shape verifyLearnerConnectionEndpoint.js uses for an
 * unresolvable code).
 *
 * Untrusted request shape (the ONLY thing a caller may ever send):
 *
 *   Header:  Authorization: Bearer <Learning Hub Firebase ID token>
 *   Body:    { invitationCode: string }
 *
 * No `learnerProfileId` is required or accepted — listing a roster
 * implicates no specific learner's own data, only "does this caller
 * hold a real, currently-valid classroom code." Any authenticated
 * Learning Hub caller who has the code can see the roster, exactly the
 * same trust level ClassMate's own Student Mode roster picker already
 * grants anyone holding the code (see StudentRosterPickerView.js) —
 * this endpoint does not weaken that, it mirrors it cross-project.
 *
 * Response contract — the complete, exhaustive set of fields this
 * endpoint will EVER return, built field-by-field below, never via
 * object spread of anything Firestore-sourced (matching this bridge's
 * own field-minimization discipline, see
 * getNotebookObligationsForLearnerEndpoint.js's own header comment):
 *   - 401 { ok: false, error: 'unauthenticated' }
 *   - 400 { ok: false, error: 'invalid_request' }
 *   - 200 { ok: false, error: 'verification_failed' } — the code does
 *     not resolve to any classroom (anti-oracle — identical shape to a
 *     failed redemption, never distinguishable from "this code never
 *     existed" vs. "it's revoked" vs. anything else).
 *   - 200 { ok: true, classroomId, classroomName, students: [{id, name,
 *     teamName}] } — every roster field beyond id/name/teamName
 *     (score, bucket, badges, notes, submissions, learningRecord,
 *     history, notebookBadgeCounts — see js/models/Student.js's own
 *     createStudent()) is deliberately never forwarded.
 *
 * Never logs: the bearer token, the invitation code value, or any
 * roster content (names included) — matching this bridge's existing
 * "never log the credential or anything it unlocks" rule.
 */

import { verifyLearningHubIdToken as defaultVerifyLearningHubIdToken } from './learningHubAuth.js';
import { resolveInvitationClassroomId } from './learnerVerification/verifyLearnerConnection.js';

const UNAUTHENTICATED = Object.freeze({ ok: false, error: 'unauthenticated' });
const INVALID_REQUEST = Object.freeze({ ok: false, error: 'invalid_request' });
/** Identical shape/error string to verifyLearnerConnectionEndpoint.js's own GENERIC_FAILURE for an unresolvable code — same anti-oracle boundary, same credential, so the two endpoints must never disagree about what an invalid code looks like from the outside. */
const GENERIC_FAILURE = Object.freeze({ ok: false, error: 'verification_failed' });

/**
 * DIAGNOSTIC HARDENING (see this file's own commit/PR for the incident
 * this closes: a missing LEARNING_HUB_FIREBASE_PROJECT_ID env var made
 * every real roster lookup fail with the single generic
 * 'verification_failed' shape, indistinguishable from an actually-bad
 * code). Logs ONE safe, categorized event per request outcome — never
 * the bearer token, the invitation code, a classroomId, or any roster
 * content — so an operator reading Cloud Logging can immediately tell
 * "no caller presented a token" apart from "the code didn't resolve"
 * apart from "ClassMate's own cross-project auth is misconfigured"
 * (that last one is learningHubAuth.js's own, separately-tagged
 * CONFIGURATION ERROR log — this function's own 'auth_rejected' event
 * covers everything upstream of this endpoint returning UNAUTHENTICATED,
 * whatever the underlying cause). The LEARNER-facing response shape is
 * completely unaffected by this logging — still the same anti-oracle
 * contract documented in this file's own header comment.
 */
function logRosterOutcome(event, extra) {
  console.log(JSON.stringify(Object.assign({ endpoint: 'getClassroomRosterForLearner', event, ts: new Date().toISOString() }, extra || {})));
}

const MAX_CREDENTIAL_LENGTH = 64;

function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * @param {object} params
 * @param {string|undefined} params.authorizationHeader
 * @param {unknown} params.body
 * @param {object} params.deps
 * @param {import('firebase-admin/firestore').Firestore} params.deps.adminDb - ClassMate's OWN Firestore Admin instance
 * @param {(idToken: string) => Promise<string|null>} [params.deps.verifyLearningHubIdToken] - TEST-ONLY override
 * @returns {Promise<{httpStatus: number, body: object}>}
 */
export async function handleGetClassroomRosterForLearnerRequest({ authorizationHeader, body, deps }) {
  if (!deps || !deps.adminDb) {
    throw new Error('handleGetClassroomRosterForLearnerRequest requires deps.adminDb (ClassMate\'s own Firestore Admin instance)');
  }
  const verifyIdToken = deps.verifyLearningHubIdToken ?? defaultVerifyLearningHubIdToken;

  // --- 1. Authentication: is there a real, verified Learning Hub caller at all? ---
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    logRosterOutcome('auth_rejected', { reason: 'missing_bearer_header' });
    return { httpStatus: 401, body: UNAUTHENTICATED };
  }
  const idToken = authorizationHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    logRosterOutcome('auth_rejected', { reason: 'empty_token' });
    return { httpStatus: 401, body: UNAUTHENTICATED };
  }

  let verifiedUid = null;
  try {
    verifiedUid = await verifyIdToken(idToken);
  } catch {
    verifiedUid = null;
  }
  if (!verifiedUid) {
    // Deliberately a single, generic reason at THIS layer — a bad
    // token and a misconfigured LEARNING_HUB_FIREBASE_PROJECT_ID both
    // land here, but learningHubAuth.js's own verifyLearningHubIdToken()
    // already logged which one, distinctly, with its own tag
    // ('CONFIGURATION ERROR' vs. 'TOKEN VERIFICATION FAILED') — this
    // line is the "something upstream rejected auth" marker an
    // operator correlates against that more specific log line.
    logRosterOutcome('auth_rejected', { reason: 'token_verification_returned_null' });
    return { httpStatus: 401, body: UNAUTHENTICATED };
  }

  // --- 2. Request shape validation ---
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    logRosterOutcome('invalid_request', { reason: 'malformed_body' });
    return { httpStatus: 400, body: INVALID_REQUEST };
  }
  const { invitationCode } = body;
  if (!isBoundedString(invitationCode, MAX_CREDENTIAL_LENGTH)) {
    logRosterOutcome('invalid_request', { reason: 'invitationCode_not_a_bounded_string' });
    return { httpStatus: 400, body: INVALID_REQUEST };
  }

  // --- 3. Resolve the code — the exact same resolution redemption itself uses ---
  const classroomId = await resolveInvitationClassroomId(deps.adminDb, invitationCode);
  if (!classroomId) {
    logRosterOutcome('code_unresolvable');
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }

  const classroomSnap = await deps.adminDb.collection('classrooms').doc(classroomId).get();
  if (!classroomSnap.exists) {
    // Structurally shouldn't happen (a code resolves only to a real
    // classroomId), but a deleted classroom whose code pointer outlived
    // it must still fail closed, identically to any other bad code.
    logRosterOutcome('classroom_missing_after_resolution');
    return { httpStatus: 200, body: GENERIC_FAILURE };
  }
  const classroom = classroomSnap.data();

  const students = (classroom.teams || []).flatMap((team) =>
    (team.students || []).map((student) => ({
      id: student.id,
      name: student.name,
      teamName: team.name || null,
    }))
  );

  logRosterOutcome('success', { studentCount: students.length });

  return {
    httpStatus: 200,
    body: {
      ok: true,
      classroomId,
      classroomName: classroom.classroomName || null,
      students,
    },
  };
}
