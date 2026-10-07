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
 * generic, non-secret, app-wide CORS allow-list that happens to live
 * alongside this codebase's Slack integration work (reused here rather
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
