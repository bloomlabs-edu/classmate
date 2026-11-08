/**
 * functions/index.js
 *
 * "Sign in with Phone" — TV/shared-device pairing (see
 * docs/architecture/TV_PHONE_SIGNIN_DESIGN.md). Every handler's real
 * logic lives in src/deviceSignIn/deviceSignInEndpoints.js, directly
 * unit/emulator-testable without this file; everything below is pure
 * onRequest/CORS/Express glue.
 *
 * `getAllowedOrigins()` is imported from ./src/slack/config.js — a
 * generic, non-secret, app-wide CORS allow-list (reused here rather
 * than duplicated, per explicit design decision — see this feature's
 * own implementation report). It is the one dependency this file has
 * outside its own src/deviceSignIn/ directory.
 *
 * App Check (decision #6 — "add it if this fits cleanly... do not let
 * it become a blocker"): `enforceAppCheck` is a one-line, zero-custom-
 * code option Cloud Functions v2 supports directly on `startDeviceSignIn`
 * and `pollDeviceSignIn` specifically (the two fully-unauthenticated
 * endpoints — getDeviceSignInRequestInfo/approveDeviceSignIn/
 * denyDeviceSignIn are already gated by a verified teacher ID token and
 * don't need it). Left OFF by default here because turning it on
 * requires a Firebase Console / App Check SDK registration step this
 * change cannot perform on its own (see this feature's own
 * implementation report) — flip `ENFORCE_APP_CHECK_ON_PUBLIC_ENDPOINTS`
 * to true once that registration exists and the client has been wired
 * to call `getToken()`/attach `X-Firebase-AppCheck`, never before (an
 * unregistered client would otherwise have every request rejected).
 *
 * `verifyLearnerConnection` (Learner Identity Bridge) previously
 * couldn't be defined here: its dependency,
 * src/verifyLearnerConnectionEndpoint.js, imported
 * ../../server/learnerVerification/verifyLearnerConnection.js — a path
 * outside functions/, which Cloud Functions never packages, so its
 * container crashed on startup and took every other function in this
 * file down with it (they all share one module load). Fixed by moving
 * that module (and its hashUtils/shape dependencies) into
 * src/learnerVerification/ — see that directory's own header comments.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAllowedOrigins } from './src/slack/config.js';
import {
  handleStartDeviceSignIn,
  handleGetDeviceSignInRequestInfo,
  handleApproveDeviceSignIn,
  handleDenyDeviceSignIn,
  handlePollDeviceSignIn,
} from './src/deviceSignIn/deviceSignInEndpoints.js';
import { handleVerifyLearnerConnectionRequest } from './src/verifyLearnerConnectionEndpoint.js';
import { handleGetNotebookObligationsForLearnerRequest } from './src/getNotebookObligationsForLearnerEndpoint.js';
import { handleActivateLearnerConnectionRequest } from './src/activateLearnerConnectionEndpoint.js';

if (getApps().length === 0) {
  initializeApp();
}

/**
 * Echoes back the request's Origin ONLY if it exactly matches
 * getAllowedOrigins(), and sets no CORS header at all otherwise —
 * never a wildcard, never reflecting an arbitrary unlisted origin.
 */
function applyCorsIfAllowed(req, res) {
  const origin = req.get('Origin');
  const isAllowed = typeof origin === 'string' && getAllowedOrigins().includes(origin);
  if (isAllowed) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  return isAllowed;
}

const ENFORCE_APP_CHECK_ON_PUBLIC_ENDPOINTS = false;

function getClientKey(req) {
  // Cloud Functions v2 runs behind Cloud Run's own load balancer —
  // `req.ip` is populated by the Functions Framework from the real
  // client address it receives, which is the value this app trusts
  // here. Never blank: an unresolvable address still gets the literal
  // string 'unknown', which is itself just one more (if coarse) rate-
  // limit bucket, never a bypass.
  return req.ip || 'unknown';
}

async function readJsonBody(req) {
  // Cloud Functions v2 (Functions Framework) already parses a
  // `Content-Type: application/json` body into `req.body` for us; a
  // non-object body (missing header, empty body, malformed JSON that
  // the framework already rejected upstream) degrades to `{}` here so
  // every handler's own shape validation is the single source of
  // truth for "was this a valid request," not a second, duplicate
  // check in this glue layer.
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function sendCorsPreflight(req, res, { methods }) {
  const originAllowed = applyCorsIfAllowed(req, res);
  if (originAllowed) {
    res.set('Access-Control-Allow-Methods', methods);
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  res.status(204).send('');
}

/** Step 1 — public; the TV calls this with no authentication at all. */
export const startDeviceSignIn = onRequest(
  { cors: false, invoker: 'public', enforceAppCheck: ENFORCE_APP_CHECK_ON_PUBLIC_ENDPOINTS },
  async (req, res) => {
    applyCorsIfAllowed(req, res);
    if (req.method === 'OPTIONS') return sendCorsPreflight(req, res, { methods: 'POST' });
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

    const { httpStatus, body } = await handleStartDeviceSignIn({
      body: await readJsonBody(req),
      clientKey: getClientKey(req),
      deps: { adminDb: getFirestore(), now: () => Date.now() },
    });
    res.status(httpStatus).json(body);
  }
);

/** Step 2 — the teacher's phone, already signed in, asks what it's about to approve. */
export const getDeviceSignInRequestInfo = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  applyCorsIfAllowed(req, res);
  if (req.method === 'OPTIONS') return sendCorsPreflight(req, res, { methods: 'POST' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { httpStatus, body } = await handleGetDeviceSignInRequestInfo({
    authorizationHeader: req.get('Authorization'),
    body: await readJsonBody(req),
    deps: {
      adminDb: getFirestore(),
      now: () => Date.now(),
      verifyIdToken: (idToken) => getAuth().verifyIdToken(idToken).then((decoded) => decoded.uid),
    },
  });
  res.status(httpStatus).json(body);
});

/** Step 3a — the teacher taps Approve on her phone. */
export const approveDeviceSignIn = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  applyCorsIfAllowed(req, res);
  if (req.method === 'OPTIONS') return sendCorsPreflight(req, res, { methods: 'POST' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { httpStatus, body } = await handleApproveDeviceSignIn({
    authorizationHeader: req.get('Authorization'),
    body: await readJsonBody(req),
    deps: {
      adminDb: getFirestore(),
      now: () => Date.now(),
      verifyIdToken: (idToken) => getAuth().verifyIdToken(idToken).then((decoded) => decoded.uid),
      createCustomToken: (uid) => getAuth().createCustomToken(uid),
    },
  });
  res.status(httpStatus).json(body);
});

/** Step 3b — the teacher taps Deny on her phone. */
export const denyDeviceSignIn = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  applyCorsIfAllowed(req, res);
  if (req.method === 'OPTIONS') return sendCorsPreflight(req, res, { methods: 'POST' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { httpStatus, body } = await handleDenyDeviceSignIn({
    authorizationHeader: req.get('Authorization'),
    body: await readJsonBody(req),
    deps: {
      adminDb: getFirestore(),
      now: () => Date.now(),
      verifyIdToken: (idToken) => getAuth().verifyIdToken(idToken).then((decoded) => decoded.uid),
    },
  });
  res.status(httpStatus).json(body);
});

/** Step 4 — public; the TV polls with its own private tv session token (see deviceSignInEndpoints.js). */
export const pollDeviceSignIn = onRequest(
  { cors: false, invoker: 'public', enforceAppCheck: ENFORCE_APP_CHECK_ON_PUBLIC_ENDPOINTS },
  async (req, res) => {
    applyCorsIfAllowed(req, res);
    if (req.method === 'OPTIONS') return sendCorsPreflight(req, res, { methods: 'POST' });
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

    const { httpStatus, body } = await handlePollDeviceSignIn({
      body: await readJsonBody(req),
      clientKey: getClientKey(req),
      deps: { adminDb: getFirestore(), now: () => Date.now() },
    });
    res.status(httpStatus).json(body);
  }
);

// -----------------------------------------------------------------------
// Learner Identity Bridge — the trusted endpoint Learning Hub's own
// backend calls (never a browser directly, so no CORS handling here,
// matching the server-to-server trust boundary documented in
// docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md).
// `invoker: 'public'` because this endpoint's real security boundary is
// the Learning Hub Firebase ID token check inside
// handleVerifyLearnerConnectionRequest (src/learningHubAuth.js) — not
// IAM allowlisting.
//
// Deliberately NO `serviceAccount` override here: this function also
// performs its own Firestore reads/writes (classroomInvitationCodes,
// studentVerificationCodes, learnerClassroomRelationships via
// createConnectionRequest/verifyStudentCode), so it must keep this
// project's normal default runtime identity, same as every sibling
// function in this file. The cross-project call to Learning Hub's
// IAM-gated endpoint uses a SEPARATE, narrowly-scoped identity via
// impersonation — see learnerProfileOwnership.js's own header comment
// for why forcing the whole function to run AS that narrow identity
// (instead of impersonating it for one outbound call) would silently
// break every Firestore operation here with PERMISSION_DENIED.
// -----------------------------------------------------------------------
export const verifyLearnerConnection = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: req.get('Authorization'),
    body: await readJsonBody(req),
    deps: { adminDb: getFirestore() },
  });
  res.status(httpStatus).json(body);
});

// -----------------------------------------------------------------------
// Notebook Obligations — read-only endpoint Learning Hub calls to show a
// learner their own outstanding notebook work. See
// docs/architecture/NOTEBOOK_OBLIGATIONS_ENDPOINT.md for the full
// security design. Same trust boundary as verifyLearnerConnection
// above: `invoker: 'public'` because the real security gate is the
// Learning Hub ID token + ownership check inside
// handleGetNotebookObligationsForLearnerRequest, not IAM allowlisting —
// Cloud Run/Functions IAM has no notion of "a valid Learning Hub user,"
// only "a valid Google Cloud caller identity," which Learning Hub's
// backend does not have one of to present. No CORS handling — this is a
// server-to-server call from Learning Hub's own backend, never a
// browser directly.
//
// `Cache-Control: private, no-store` on every response, success or
// failure: this endpoint's entire response can contain a real learner's
// notebook status data, and must never be cached by any intermediary or
// the caller's own HTTP stack.
//
// Deliberately NO `serviceAccount` override, matching verifyLearnerConnection
// above — this function reads ClassMate's own Firestore
// (learnerClassroomRelationships, classrooms) with the project's normal
// default runtime identity; the cross-project ownership check inside
// learnerProfileOwnership.js uses its own separate, narrowly-scoped
// impersonated identity for that one outbound call only (see that
// file's own header comment).
//
// Never logs req.body, the Authorization header, or the response body —
// this repo's existing handlers already avoid logging any request
// content; this endpoint adds no logging of its own.
//
// CHECKPOINT-AWARE as of this change: see
// functions/src/getNotebookObligationsForLearnerEndpoint.js's own
// header comment for the response shape change (obligations:[] ->
// status:{summary, items}) this now returns.
// -----------------------------------------------------------------------
export const getNotebookObligationsForLearner = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: req.get('Authorization'),
    body: await readJsonBody(req),
    deps: { adminDb: getFirestore() },
  });
  res.status(httpStatus).json(body);
});

// -----------------------------------------------------------------------
// Activate Learner Connection — single-code Join a Classroom (product
// decision): a classroom's own teacher, reviewing the pending-request
// queue in ui/views/ConnectLearningHubView.js, calls this directly to
// activate a pending request once they've picked the real roster
// student it belongs to — no second, learner-facing code is generated
// or transmitted anywhere in this path. See
// functions/src/learnerVerification/activateLearnerConnection.js's own
// header comment for why this does not weaken the bridge's own
// documented invariant (ACTIVE is reachable only via Admin SDK — this
// IS an Admin SDK operation, just authorized by a verified teacher
// identity instead of a redemption code).
//
// Reached directly by the TEACHER's own ClassMate browser (same
// project, not cross-project) — manual CORS via applyCorsIfAllowed(),
// the same pattern getDeviceSignInRequestInfo/approveDeviceSignIn/
// denyDeviceSignIn above already use for this exact reason (a known,
// fixed ClassMate origin, echoed back only if it matches
// getAllowedOrigins() — never a wildcard).
//
// The old code-based path (createStudentVerificationCodeForStudent(),
// verifyStudentCode(), studentVerificationCodes) is untouched by this
// addition — nothing here modifies, revokes, or disables it.
// -----------------------------------------------------------------------
export const activateLearnerConnection = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  applyCorsIfAllowed(req, res);
  if (req.method === 'OPTIONS') return sendCorsPreflight(req, res, { methods: 'POST' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { httpStatus, body } = await handleActivateLearnerConnectionRequest({
    authorizationHeader: req.get('Authorization'),
    body: await readJsonBody(req),
    deps: {
      adminDb: getFirestore(),
      verifyIdToken: (idToken) => getAuth().verifyIdToken(idToken).then((decoded) => decoded.uid),
    },
  });
  res.status(httpStatus).json(body);
});
