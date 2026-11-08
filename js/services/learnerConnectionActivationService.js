/**
 * services/learnerConnectionActivationService.js
 *
 * Single-code Join a Classroom (product decision): the teacher's own
 * authenticated Cloud Function call that directly activates a pending
 * Learner Identity Bridge connection — see
 * functions/src/learnerVerification/activateLearnerConnection.js's own
 * header comment for the full design this implements, and
 * ui/views/ConnectLearningHubView.js for the one caller.
 *
 * Isolates this one authenticated Cloud Functions call behind a small
 * API, same convention as services/deviceSignInApprovalService.js —
 * requires the teacher's own Firebase ID token
 * (services/authService.js's getIdToken()), exactly like that file's
 * own approveDeviceSignIn().
 *
 * Deliberately a separate file from repositories/
 * firestoreLearnerConnectionRepository.js (that file's own header
 * comment: "the ONLY file that knows the Firestore path shapes...
 * Deliberately does NOT implement code redemption/verification") —
 * this is a Cloud Functions call, not a Firestore write, matching this
 * app's existing split between Firestore repositories and Cloud-
 * Function-calling services.
 */
import { PRODUCTION_HOSTNAMES } from './firestoreEnvironment.js';

const PROJECT_ID = 'classmate-302c2';
const REGION = 'us-central1';
const DEFAULT_FUNCTIONS_EMULATOR_HOST = '127.0.0.1';
const DEFAULT_FUNCTIONS_EMULATOR_PORT = 5001;

function getFunctionsBaseUrl() {
  const hostname = typeof window !== 'undefined' ? window.location?.hostname : null;
  if (typeof hostname === 'string' && PRODUCTION_HOSTNAMES.includes(hostname)) {
    return `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
  }
  return `http://${DEFAULT_FUNCTIONS_EMULATOR_HOST}:${DEFAULT_FUNCTIONS_EMULATOR_PORT}/${PROJECT_ID}/${REGION}`;
}

async function postJson(path, idToken, body) {
  const response = await fetch(`${getFunctionsBaseUrl()}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { httpStatus: response.status, data };
}

/**
 * Activates a PENDING relationship for the picked roster student — no
 * code generated, shown, or transmitted anywhere. Returns `{ok: true,
 * studentId}` on success, or `{ok: false, reason}` (`'unauthenticated'`,
 * `'invalid_request'`, `'forbidden'`, `'student_not_on_roster'`,
 * `'not_pending'`, or `'error'`) for every other case — never throws,
 * matching deviceSignInApprovalService.js's own convention.
 */
export async function activateLearnerConnection(idToken, { classroomId, learnerProfileId, studentId }) {
  if (!idToken) return { ok: false, reason: 'unauthenticated' };
  try {
    const { httpStatus, data } = await postJson('activateLearnerConnection', idToken, { classroomId, learnerProfileId, studentId });
    if (httpStatus === 401) return { ok: false, reason: 'unauthenticated' };
    if (httpStatus === 400) return { ok: false, reason: 'invalid_request' };
    if (!data?.ok) return { ok: false, reason: data?.error || 'activation_failed' };
    return { ok: true, studentId: data.studentId };
  } catch (error) {
    console.error('[learnerConnectionActivationService] activateLearnerConnection() failed:', error);
    return { ok: false, reason: 'error' };
  }
}
