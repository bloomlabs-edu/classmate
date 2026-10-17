/**
 * functions/src/slack/slackIntegrationRepository.js
 *
 * Admin-SDK access to a teacher's Slack link — stored as a plain field
 * on their OWN existing `users/{uid}` document
 * (`slackIntegration: { slackUserId, slackTeamId, connectedAt,
 * disconnectedAt }`), NOT a separate subcollection. This mirrors
 * services/pushNotificationService.js's own `fcmTokens` field exactly
 * (same document, same reasoning): firestore.rules' existing
 * `users/{uid}` rule (`allow read, write: if request.auth != null &&
 * request.auth.uid == uid`) already covers an arbitrary new field on
 * that same document, so this feature needs NO new Firestore rule —
 * a subcollection would have needed one (see the top-level `users/{uid}`
 * block's own separate `classroomRefs` sub-rule for what that would
 * have looked like).
 *
 * Only ever the FOUR fields named in
 * docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md §4 —
 * never email, display name, avatar, or any other Slack profile field.
 * This module only ever receives what functions/src/slack/
 * oauthCallback.js explicitly passes it (itself only ever
 * slackUserId/slackTeamId/connectedAt — see that file's own
 * handleSlackIdentityLinkCallback()), so there is no code path here
 * that could persist anything beyond these four fields even if Slack's
 * own response contained more (see slackClient.js's own
 * fetchSlackIdentity() for where that upstream filtering actually
 * happens, and its corrected header comment for why Slack's response
 * itself is not guaranteed to already exclude those other fields).
 */

const USERS_COLLECTION = 'users';

function userDoc(adminDb, uid) {
  return adminDb.collection(USERS_COLLECTION).doc(uid);
}

/** `null` if this teacher has never connected Slack, or has disconnected without reconnecting since (see disconnectedAt). */
export async function getActiveSlackIntegration(adminDb, uid) {
  const snapshot = await userDoc(adminDb, uid).get();
  const integration = snapshot.exists ? snapshot.data()?.slackIntegration : null;
  if (!integration || integration.disconnectedAt) return null;
  return integration;
}

/** Creates the link, or reconnects a previously-disconnected one — always resets `disconnectedAt` to null and refreshes `connectedAt`. */
export async function saveSlackIntegration(adminDb, uid, { slackUserId, slackTeamId, connectedAt }) {
  await userDoc(adminDb, uid).set(
    { slackIntegration: { slackUserId, slackTeamId, connectedAt, disconnectedAt: null } },
    { merge: true }
  );
}
