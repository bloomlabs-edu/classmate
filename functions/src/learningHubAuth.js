/**
 * functions/src/learningHubAuth.js
 *
 * Verifies a Firebase ID token issued by LEARNING HUB'S OWN Firebase
 * project — never ClassMate's. ClassMate's default Admin app
 * (`initializeApp()`, no name) is bound to ClassMate's own project
 * (`classmate-302c2`, per .firebaserc); using it to verify a Learning
 * Hub token would check the wrong audience and reject every genuine
 * Learning Hub caller. This module exists specifically so that mistake
 * is structurally impossible — it always talks to a SEPARATELY named
 * Admin app, constructed only for this one purpose.
 *
 * Requires no Learning Hub SECRET of any kind. Verifying the RSA
 * signature on a Firebase ID token uses Google's own public certificate
 * endpoint (identical for every Firebase project, including
 * ClassMate's own) — not the issuing project's private service-account
 * key. The only Learning-Hub-specific value this needs is its
 * (non-secret) Firebase **project ID**, supplied via the
 * `LEARNING_HUB_FIREBASE_PROJECT_ID` environment variable (see
 * docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md's
 * "Production Configuration" section) — never hard-coded, never
 * committed. If it is unset, every verification attempt fails closed
 * (throws at app-construction time) rather than silently verifying
 * against the wrong project or skipping verification.
 *
 * `initializeApp({ projectId }, name)` is called deliberately WITHOUT an
 * explicit `credential` field — proven safe for this exact purpose in
 * this repo's own emulator-backed tests (tests/server/
 * verifyLearnerConnection.test.js already does the same thing for its
 * own project, and passes). In a real Cloud Functions runtime, the SDK
 * resolves Application Default Credentials from the function's own
 * ambient service identity automatically; those credentials are never
 * used for `verifyIdToken`'s actual signature check (which is
 * credential-independent, see above) — they would only matter if this
 * module ever called something else (e.g. Learning Hub Firestore),
 * which it deliberately does not (see
 * functions/src/learnerProfileOwnership.js for why that's a separate,
 * currently-unresolved concern, not something bolted on here).
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// DIAGNOSTIC HARDENING (production incident: a redeploy of
// verifyLearnerConnection/getClassroomRosterForLearner from a git
// worktree that never had functions/.env.classmate-302c2 silently
// dropped this env var, making every real Learning Hub caller fail
// closed as "unauthenticated" with no distinguishing signal anywhere —
// see docs/architecture/LEARNER_SELF_IDENTITY_CLAIM.md's own incident
// note). This is an INFRASTRUCTURE misconfiguration, categorically
// different from "a caller presented a bad/expired token" — the two
// must stay externally indistinguishable (anti-oracle, for the
// caller), but MUST be distinguishable to an operator reading Cloud
// Logging, or this exact class of regression goes unnoticed again
// until a real user hits it. Logged on EVERY occurrence, deliberately
// not throttled to "once per container" — the true frequency/volume of
// an ongoing misconfiguration is itself useful incident signal, and
// Cloud Logging has no real cost or noise problem at the volume a
// single function's own request rate produces.
function getLearningHubApp() {
  const projectId = process.env.LEARNING_HUB_FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error(
      '[learningHubAuth] CONFIGURATION ERROR: LEARNING_HUB_FIREBASE_PROJECT_ID is not set on this deployed function. ' +
        'Every Learning Hub caller will be rejected as unauthenticated until this is fixed — this is an infrastructure ' +
        'problem, not a caller/token problem. See functions/.env.<project-id> (gitignored; must exist on the machine ' +
        'running `firebase deploy`, including in any fresh git worktree) and this file\'s own header comment.'
    );
    throw new Error(
      'LEARNING_HUB_FIREBASE_PROJECT_ID is not configured — refusing to verify a Learning Hub token against an unknown/default project.'
    );
  }
  // Named per-project, not a single fixed name: in production this env
  // var is a fixed deployment-time value for the life of the process,
  // so this is equivalent to a single cached app either way. Keying by
  // project id specifically avoids a real bug class — a stale cached
  // app silently continuing to verify against whatever project it was
  // FIRST constructed for, even after configuration changes — which
  // matters directly for this module's own test suite (see
  // tests/functions/learningHubAuth.test.js's "wrong project" cases,
  // which deliberately reconfigure this env var within one process).
  const appName = `learning-hub-token-verifier-${projectId}`;
  const existing = getApps().find((app) => app.name === appName);
  if (existing) return existing;
  return initializeApp({ projectId }, appName);
}

/**
 * @param {string} idToken - the raw bearer token presented by the caller
 * @returns {Promise<string|null>} the verified Learning Hub uid, or null
 *   for any invalid, expired, wrong-audience, or malformed token — every
 *   failure category collapses to the same `null`, deliberately (the
 *   caller, verifyLearnerConnectionEndpoint.js, must not be able to
 *   distinguish "expired" from "wrong project" from "garbage string",
 *   matching this bridge's existing anti-oracle convention).
 *
 *   EXCEPTION, UNCHANGED FROM BEFORE: a missing
 *   LEARNING_HUB_FIREBASE_PROJECT_ID still REJECTS (throws) rather than
 *   resolving to null — getLearningHubApp()'s own throw is deliberately
 *   not caught here (see tests/functions/learningHubAuth.test.js's own
 *   "fails closed by throwing" test). Every real caller
 *   (verifyLearnerConnectionEndpoint.js, getClassroomRosterForLearnerEndpoint.js)
 *   already wraps its own call to this function in try/catch and
 *   collapses that rejection to the identical external UNAUTHENTICATED
 *   result a bad token would also produce — the anti-oracle guarantee
 *   holds at THAT layer, not by making this function swallow the
 *   exception itself. This function only adds a distinctly-tagged,
 *   safe (no token/code content) log line when that throw is about to
 *   happen, so an operator can tell "infrastructure misconfigured" apart
 *   from "a caller sent a bad token" in Cloud Logging — a caller still
 *   can't, from the response alone, and neither of this function's own
 *   two outcomes (throw vs. null) changed from before this logging was
 *   added.
 */
export async function verifyLearningHubIdToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length === 0) return null;
  const app = getLearningHubApp();
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    return decoded.uid;
  } catch (err) {
    // TOKEN verification failure (expired/garbage/wrong audience) — a
    // real, normal occurrence, not an infrastructure bug. Logged with
    // its own distinct tag so Cloud Logging never conflates it with
    // the CONFIGURATION ERROR case above; never logs the token itself.
    console.error('[learningHubAuth] TOKEN VERIFICATION FAILED (not a configuration issue):', (err && (err.code || err.name)) || 'unknown');
    return null;
  }
}
