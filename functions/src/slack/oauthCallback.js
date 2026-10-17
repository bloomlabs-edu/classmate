/**
 * functions/src/slack/oauthCallback.js
 *
 * The framework-agnostic core of Slack identity linking — deliberately
 * separated from any `onRequest` HTTP glue (see functions/index.js),
 * same "extract pure/testable logic" convention as
 * functions/src/verifyLearnerConnectionEndpoint.js. Every external
 * effect (verifying a ClassMate ID token, minting/checking the OAuth
 * `state`, calling Slack, writing Firestore) is passed in via `deps`,
 * so this file's own tests (tests/functions/slack/oauthCallback.test.js)
 * can exercise every branch — including Slack failure and a denied
 * consent screen — without a real network call.
 *
 * Two entry points, one per leg of the flow described in
 * docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md §5:
 *
 *   handleSlackIdentityLinkStart()    — step 3 (mint the Slack authorize URL)
 *   handleSlackIdentityLinkCallback() — steps 5-6 (Slack's own redirect back)
 *
 * Every failure branch in handleSlackIdentityLinkCallback() redirects
 * to the SAME generic `?slack=error` destination — deliberately not
 * distinguishing "bad state" from "Slack rejected the code" from
 * "Slack API down" in what the teacher's browser is sent to, so this
 * endpoint never becomes an oracle for probing the flow. Real
 * diagnostic detail still reaches Cloud Logging via `deps.onError`.
 */

const UNAUTHENTICATED = Object.freeze({ ok: false, error: 'unauthenticated' });

/**
 * @param {object} params
 * @param {string|undefined} params.authorizationHeader - "Bearer <ClassMate Firebase ID token>"
 * @param {object} params.deps
 * @param {(idToken: string) => Promise<string|null>} params.deps.verifyClassMateIdToken
 * @param {(uid: string) => string} params.deps.createStateToken
 * @param {(state: string) => string} params.deps.buildAuthorizeUrl
 * @returns {Promise<{httpStatus: number, body: object}>}
 */
export async function handleSlackIdentityLinkStart({ authorizationHeader, deps }) {
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    return { httpStatus: 401, body: UNAUTHENTICATED };
  }
  const idToken = authorizationHeader.slice('Bearer '.length).trim();
  if (!idToken) return { httpStatus: 401, body: UNAUTHENTICATED };

  let uid = null;
  try {
    uid = await deps.verifyClassMateIdToken(idToken);
  } catch {
    uid = null;
  }
  if (!uid) return { httpStatus: 401, body: UNAUTHENTICATED };

  const state = deps.createStateToken(uid);
  const url = deps.buildAuthorizeUrl(state);
  return { httpStatus: 200, body: { ok: true, url } };
}

/**
 * @param {object} params
 * @param {object} params.query - Slack's redirect query params: `{ code, state }` on success, `{ error }` if the teacher declined consent
 * @param {object} params.deps
 * @param {(state: string) => string|null} params.deps.verifyStateToken
 * @param {(code: string) => Promise<{access_token?: string, ok?: boolean}>} params.deps.exchangeOAuthCode
 * @param {(accessToken: string) => Promise<{ok: boolean, slackUserId?: string, slackTeamId?: string}>} params.deps.fetchSlackIdentity
 * @param {(uid: string, identity: {slackUserId: string, slackTeamId: string, connectedAt: string}) => Promise<void>} params.deps.saveSlackIntegration
 * @param {() => string} params.deps.nowIso
 * @param {(status: 'connected'|'error') => string} params.deps.buildRedirectUrl
 * @param {(context: string, error: unknown) => void} [params.deps.onError] - logging only, never affects the response
 * @returns {Promise<{httpStatus: number, redirectUrl: string}>}
 */
export async function handleSlackIdentityLinkCallback({ query, deps }) {
  const fail = (context, error) => {
    deps.onError?.(context, error);
    return { httpStatus: 302, redirectUrl: deps.buildRedirectUrl('error') };
  };

  if (!query || typeof query !== 'object') return fail('invalid_query', null);
  if (query.error) return fail('consent_declined', query.error);
  if (typeof query.code !== 'string' || !query.code || typeof query.state !== 'string' || !query.state) {
    return fail('missing_code_or_state', null);
  }

  const uid = deps.verifyStateToken(query.state);
  if (!uid) return fail('invalid_or_expired_state', null);

  let tokenResponse;
  try {
    tokenResponse = await deps.exchangeOAuthCode(query.code);
  } catch (error) {
    return fail('token_exchange_failed', error);
  }
  if (!tokenResponse?.ok || !tokenResponse?.access_token) {
    return fail('token_exchange_rejected', tokenResponse?.error);
  }

  let identity;
  try {
    identity = await deps.fetchSlackIdentity(tokenResponse.access_token);
  } catch (error) {
    return fail('identity_fetch_failed', error);
  }
  if (!identity?.ok) return fail('identity_fetch_rejected', identity?.error);

  try {
    await deps.saveSlackIntegration(uid, {
      slackUserId: identity.slackUserId,
      slackTeamId: identity.slackTeamId,
      connectedAt: deps.nowIso(),
    });
  } catch (error) {
    return fail('save_failed', error);
  }

  return { httpStatus: 302, redirectUrl: deps.buildRedirectUrl('connected') };
}
