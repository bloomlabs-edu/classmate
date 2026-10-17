/**
 * functions/index.js
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
import { defineSecret } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { handleSlackIdentityLinkStart, handleSlackIdentityLinkCallback } from './src/slack/oauthCallback.js';
import { createStateToken as signSlackStateToken, verifyStateToken as verifySlackStateToken } from './src/slack/stateToken.js';
import { exchangeOAuthCode as exchangeSlackOAuthCode, fetchSlackIdentity as fetchSlackUserIdentity } from './src/slack/slackClient.js';
import { saveSlackIntegration } from './src/slack/slackIntegrationRepository.js';
import { getSlackClientId, getIdentityLinkRedirectUri, getAppBaseUrl, getAllowedOrigins, SLACK_OIDC_AUTHORIZE_URL, SLACK_OIDC_SCOPE } from './src/slack/config.js';
import { onWeeklyPlanSubmissionWrite } from './src/slack/onWeeklyPlanSubmissionWrite.js';
import {
  handleStartDeviceSignIn,
  handleGetDeviceSignInRequestInfo,
  handleApproveDeviceSignIn,
  handleDenyDeviceSignIn,
  handlePollDeviceSignIn,
} from './src/deviceSignIn/deviceSignInEndpoints.js';
import { handleVerifyLearnerConnectionRequest } from './src/verifyLearnerConnectionEndpoint.js';

if (getApps().length === 0) {
  initializeApp();
}

// Slack integration secrets — Secret Manager only (see
// docs/architecture/SLACK_INTEGRATION_APP_CONFIGURATION.md §7). Never
// a plain env var, never committed, never reachable from js/ (this
// app's entire client bundle ships to the browser — see
// firebase.json's own hosting.public: "." for confirmation nothing
// under js/ is private).
const slackClientSecret = defineSecret('SLACK_CLIENT_SECRET');
const slackStateSigningSecret = defineSecret('SLACK_STATE_SIGNING_SECRET');

/**
 * Step 3 of the identity-link flow
 * (docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md §5): a
 * signed-in teacher's browser calls this (with their own ClassMate
 * Firebase ID token as a Bearer header) to get the Slack "Sign in with
 * Slack" URL to redirect to. A plain `onRequest`, not `onCall` — this
 * project's client code has no existing convention for calling a
 * callable function.
 * `getAuth()` here uses ClassMate's OWN default Admin app (unlike
 * src/learningHubAuth.js's deliberately separate, cross-project app) —
 * this token is always a ClassMate-issued one.
 *
 * This function IS called directly from a browser (see
 * services/slackIntegrationService.js's
 * own beginConnect(), a cross-origin fetch() with an Authorization
 * header, which triggers a real CORS preflight). `cors: false` would
 * silently break this in BOTH local testing and production (the
 * deployed client's origin and this function's own origin are
 * different there too).
 *
 * Deliberately does NOT use the built-in `cors: [...]` option here —
 * testing against this exact emulator proved it reflects back ANY
 * requesting origin (including an arbitrary, unlisted one), not just
 * ones in the array, in the installed firebase-functions version. That
 * is exactly the `Access-Control-Allow-Origin: *`-equivalent behavior
 * this feature must never have. `applyCorsIfAllowed()` below is a
 * small, explicit, directly-testable substitute: it echoes back the
 * request's Origin ONLY if it exactly matches getAllowedOrigins(), and
 * sets no CORS header at all otherwise — verified in
 * tests/functions/slack/corsConfiguration.emulator.test.js.
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

export const slackIdentityLinkStart = onRequest(
  { cors: false, invoker: 'public', secrets: [slackStateSigningSecret] },
  async (req, res) => {
    const originAllowed = applyCorsIfAllowed(req, res);

    if (req.method === 'OPTIONS') {
      // Preflight — only advertise POST/Authorization for an origin
      // that's actually allowed; an unlisted origin gets a bare,
      // header-less 204, which the browser's own CORS enforcement
      // then blocks the real request on regardless of what this
      // response's status code is.
      if (originAllowed) {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }

    const { httpStatus, body } = await handleSlackIdentityLinkStart({
      authorizationHeader: req.get('Authorization'),
      deps: {
        verifyClassMateIdToken: (idToken) =>
          getAuth()
            .verifyIdToken(idToken)
            .then((decoded) => decoded.uid)
            .catch(() => null),
        createStateToken: (uid) => signSlackStateToken({ uid, secret: slackStateSigningSecret.value() }),
        buildAuthorizeUrl: (state) =>
          `${SLACK_OIDC_AUTHORIZE_URL}?${new URLSearchParams({
            response_type: 'code',
            client_id: getSlackClientId(),
            scope: SLACK_OIDC_SCOPE,
            redirect_uri: getIdentityLinkRedirectUri(),
            state,
          }).toString()}`,
      },
    });

    res.status(httpStatus).json(body);
  }
);

/**
 * Step 5-6: Slack's own redirect back after the teacher answers its
 * consent screen. Never returns JSON to the browser — always redirects
 * onward to ClassMate's own app (see
 * src/slack/oauthCallback.js's own `buildRedirectUrl`), success or
 * failure alike, so a teacher never sees a bare API response.
 */
export const slackIdentityLinkCallback = onRequest(
  { cors: false, invoker: 'public', secrets: [slackStateSigningSecret, slackClientSecret] },
  async (req, res) => {
    const { httpStatus, redirectUrl } = await handleSlackIdentityLinkCallback({
      query: req.query,
      deps: {
        verifyStateToken: (state) => verifySlackStateToken({ token: state, secret: slackStateSigningSecret.value() }),
        exchangeOAuthCode: (code) =>
          exchangeSlackOAuthCode({
            code,
            redirectUri: getIdentityLinkRedirectUri(),
            clientId: getSlackClientId(),
            clientSecret: slackClientSecret.value(),
          }),
        fetchSlackIdentity: (accessToken) => fetchSlackUserIdentity({ accessToken }),
        saveSlackIntegration: (uid, identity) => saveSlackIntegration(getFirestore(), uid, identity),
        nowIso: () => new Date().toISOString(),
        buildRedirectUrl: (status) => `${getAppBaseUrl()}/#/teacher?slack=${status}`,
        onError: (context, error) => console.error('[slackIdentityLinkCallback]', context, error),
      },
    });

    res.redirect(httpStatus, redirectUrl);
  }
);

// The WeeklyPlanSubmission Firestore trigger — see
// src/slack/onWeeklyPlanSubmissionWrite.js's own header comment for why
// this reacts to Firestore state rather than being called from
// services/weeklyPlanSubmissionService.js directly.
export { onWeeklyPlanSubmissionWrite };

// -----------------------------------------------------------------------
// "Sign in with Phone" — TV/shared-device pairing (see
// docs/architecture/TV_PHONE_SIGNIN_DESIGN.md). Every handler's real
// logic lives in src/deviceSignIn/deviceSignInEndpoints.js, directly
// unit/emulator-testable without this file; everything below is pure
// onRequest/CORS/Express glue, same split as the Slack functions above.
//
// App Check (decision #6 — "add it if this fits cleanly... do not let
// it become a blocker"): `enforceAppCheck` is a one-line, zero-custom-
// code option Cloud Functions v2 supports directly on `startDeviceSignIn`
// and `pollDeviceSignIn` specifically (the two fully-unauthenticated
// endpoints — getDeviceSignInRequestInfo/approveDeviceSignIn/
// denyDeviceSignIn are already gated by a verified teacher ID token and
// don't need it). Left OFF by default here because turning it on
// requires a Firebase Console / App Check SDK registration step this
// change cannot perform on its own (see this feature's own
// implementation report) — flip `ENFORCE_APP_CHECK_ON_PUBLIC_ENDPOINTS`
// to true once that registration exists and the client has been wired
// to call `getToken()`/attach `X-Firebase-AppCheck`, never before (an
// unregistered client would otherwise have every request rejected).
// -----------------------------------------------------------------------
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
// handleVerifyLearnerConnectionRequest (src/learningHubAuth.js), the
// same pattern already used for the Slack identity-link endpoints
// above — not IAM allowlisting.
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
