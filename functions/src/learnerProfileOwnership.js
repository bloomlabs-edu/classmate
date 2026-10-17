/**
 * functions/src/learnerProfileOwnership.js
 *
 * Resolves "does this already-verified Learning Hub uid actually
 * own/control this learnerProfileId?" by calling Learning Hub's own,
 * dedicated ownership-verification Cloud Function
 * (`verifyLearnerProfileOwnership`, project `learning-hub-b2586`,
 * region `us-central1`) via service-to-service Google OIDC — never by
 * reading Learning Hub's Firestore directly, never by trusting the
 * request body's own claim. See
 * docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md §28 for
 * the two candidate designs this was chosen from; this file implements
 * candidate (a)'s sibling — a dedicated cross-project IAM-gated HTTPS
 * call — now that the underlying GCP identity/IAM plumbing has actually
 * been provisioned (a real, narrowly-scoped service account,
 * `learning-hub-profile-verifier@classmate-302c2.iam.gserviceaccount.com`,
 * granted `roles/run.invoker` on that ONE Learning Hub Cloud Run
 * service — nothing broader, no Firestore role anywhere).
 *
 * WHO ClassMate authenticates AS, calling out: this module deliberately
 * does NOT run this whole Cloud Function as the dedicated service
 * account below — that was tried and is wrong (see ../index.js's own
 * header comment on `verifyLearnerConnection`): this same function also
 * performs its own Firestore reads/writes, which would break with
 * PERMISSION_DENIED if the function's runtime identity were narrowed to
 * a service account that ONLY has `roles/run.invoker` on Learning Hub's
 * function and nothing else. Instead, this module IMPERSONATES the
 * narrow service account for this one outbound call only, via
 * `Impersonated` (google-auth-library) — the function keeps its normal
 * default runtime identity (with normal Firestore access) for
 * everything else, and briefly borrows the narrow identity's token only
 * to mint the OIDC ID token below. This requires the function's own
 * default runtime service account to be granted
 * `roles/iam.serviceAccountTokenCreator` on
 * `learning-hub-profile-verifier@classmate-302c2.iam.gserviceaccount.com`
 * (a deploy-time IAM step, not something this code can verify at call
 * time — a missing grant here fails closed via the same try/catch as
 * every other failure mode below, not a special case).
 *
 * `getIdTokenClient(TARGET_URL)` mints a Google-signed OIDC identity
 * token with `TARGET_URL` baked in as the `aud` claim, signed as the
 * impersonated service account — this is what Learning Hub's own
 * IAM-gated Cloud Run service checks before accepting the request at
 * all (a request whose OIDC token names the wrong audience, or comes
 * from a service account IAM hasn't granted `roles/run.invoker` to, is
 * rejected by GCP's own infrastructure before this repository's code on
 * the far side ever runs). No shared secret, API key, or Firestore
 * credential of any kind crosses this boundary — exactly per this
 * task's own explicit prohibition list.
 *
 * FAIL-CLOSED, uniformly, across every failure category — mirroring
 * this bridge's established anti-oracle convention
 * (server/learnerVerification/verifyLearnerConnection.js's own
 * GENERIC_FAILURE, functions/src/learningHubAuth.js's own
 * collapsed-to-null failure modes): a non-200 response, a malformed
 * response body, a thrown network/authentication error, and the
 * complete absence of any usable ambient GCP credentials (the "missing
 * configuration" case — realistically, and DELIBERATELY PROVEN in this
 * module's own test suite using the REAL, non-mocked default path, not
 * just a mock: any environment without `gcloud`/ADC configured, such as
 * this very repository's own local dev/test sandbox) all collapse to
 * the identical `false`. This function's caller
 * (verifyLearnerConnectionEndpoint.js) already treats every `false`
 * identically to every other verification failure, so this module does
 * not need its own separate anti-oracle layer beyond "just return
 * false, uniformly" — that guarantee lives one level up, unchanged by
 * this file.
 */
import { GoogleAuth, Impersonated, IdTokenClient } from 'google-auth-library';

/**
 * The dedicated, narrowly-scoped service account this module
 * impersonates for the one outbound call below — granted
 * `roles/run.invoker` on Learning Hub's ownership function and nothing
 * else (see this file's own header comment for why the whole function
 * does NOT run as this identity).
 */
export const LEARNING_HUB_PROFILE_VERIFIER_SERVICE_ACCOUNT =
  'learning-hub-profile-verifier@classmate-302c2.iam.gserviceaccount.com';

/**
 * Builds the production `googleAuth`-shaped default: impersonates
 * LEARNING_HUB_PROFILE_VERIFIER_SERVICE_ACCOUNT using this function's
 * own ambient runtime credentials as the source, then mints an OIDC ID
 * token from that impersonated identity. Matches the same
 * `{ getIdTokenClient(url) -> { request(opts) } }` shape the TEST-ONLY
 * `deps.googleAuth` override already uses, so this is a drop-in
 * production default, not a parallel code path.
 */
function buildImpersonatedGoogleAuth() {
  return {
    getIdTokenClient: async (targetAudience) => {
      const sourceClient = await new GoogleAuth().getClient();
      const impersonated = new Impersonated({
        sourceClient,
        targetPrincipal: LEARNING_HUB_PROFILE_VERIFIER_SERVICE_ACCOUNT,
        lifetime: 60,
      });
      return new IdTokenClient({ idTokenProvider: impersonated, targetAudience });
    },
  };
}

/**
 * Exactly the URL Learning Hub's ownership function is deployed at.
 * Deliberately a hardcoded module constant, not environment-configured
 * like `LEARNING_HUB_FIREBASE_PROJECT_ID` elsewhere in this bridge —
 * this value is not an environment-specific secret or a deploy-time
 * choice, it is the literal, fixed identity of the one specific
 * cross-project function this module is allowed to call, and the OIDC
 * audience Learning Hub's own IAM check is pinned to. Making it
 * env-overridable would only create a way to accidentally (or
 * maliciously, via a compromised environment) redirect this call
 * somewhere else entirely.
 */
export const LEARNING_HUB_OWNERSHIP_ENDPOINT_URL =
  'https://us-central1-learning-hub-b2586.cloudfunctions.net/verifyLearnerProfileOwnership';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * @param {string} uid - the Learning Hub uid, already verified by
 *   learningHubAuth.js — trustworthy as "this really is a Learning Hub
 *   account," but not yet sufficient on its own to prove ownership of
 *   any particular learnerProfileId (that's what this function answers)
 * @param {string} learnerProfileId - the profile id the caller claims
 *   to be acting as
 * @param {object} [deps]
 * @param {{getIdTokenClient: (targetUrl: string) => Promise<{request: (opts: {url: string, method: string, data: unknown, validateStatus: (status: number) => boolean}) => Promise<{status: number, data: unknown}>}>}} [deps.googleAuth] -
 *   TEST-ONLY override standing in for a real `GoogleAuth` instance.
 *   Production always constructs a real one, which resolves ITS OWN
 *   ambient runtime credentials — see this file's own header comment
 *   for why that depends on ../index.js's deploy-time `serviceAccount`
 *   configuration, not on anything this function does.
 * @returns {Promise<boolean>}
 */
export async function verifyLearnerProfileOwnership(uid, learnerProfileId, deps = {}) {
  if (!isNonEmptyString(uid) || !isNonEmptyString(learnerProfileId)) {
    return false;
  }

  const googleAuth = deps.googleAuth ?? buildImpersonatedGoogleAuth();

  let client;
  try {
    client = await googleAuth.getIdTokenClient(LEARNING_HUB_OWNERSHIP_ENDPOINT_URL);
  } catch {
    // Covers both a genuine client-construction/authentication failure
    // AND "missing configuration" — no ambient GCP credentials
    // available at all (Application Default Credentials not found).
    // This is the REAL, unmocked failure mode in any environment
    // without gcloud/ADC set up, including this repository's own local
    // test sandbox — see this module's own test suite, which proves
    // this exact path fails closed using the real GoogleAuth(), not a
    // mock, precisely because that environment already reproduces it.
    return false;
  }

  let response;
  try {
    response = await client.request({
      url: LEARNING_HUB_OWNERSHIP_ENDPOINT_URL,
      method: 'POST',
      data: { uid, learnerProfileId },
      // gaxios (which this client is built on) throws on a non-2xx
      // response by default — that would fold "IAM rejected this
      // service account" and "Learning Hub said not-owned" into the
      // same code path as a genuine network error, undesirable given
      // this function's own uniform-false contract already handles
      // both correctly, but for clearer, more maintainable code this
      // inspects the status explicitly below instead of relying on
      // gaxios's default throw-on-non-2xx behavior.
      validateStatus: () => true,
    });
  } catch {
    // Network failure, timeout, or any other thrown transport error.
    return false;
  }

  if (!response || response.status !== 200) {
    return false;
  }

  const data = response.data;
  if (!data || typeof data !== 'object' || data.valid !== true) {
    return false;
  }

  return true;
}
