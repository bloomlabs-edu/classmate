/**
 * repositories/firestoreSlackIntegrationRepository.js
 *
 * Client-side access to a teacher's own `users/{uid}.slackIntegration`
 * field — the exact same document and rule
 * repositories/firestoreClassroomRepository.js's saveFcmToken()/
 * removeFcmToken() already read/write for `fcmTokens`, just a
 * different field on it (see functions/src/slack/
 * slackIntegrationRepository.js's own header comment for why this
 * needed no new Firestore rule).
 *
 * The CONNECT write never happens from this file, or anywhere in the
 * browser at all — only functions/src/slack/oauthCallback.js's
 * `slackIdentityLinkCallback` (a trusted backend, holding Slack's
 * client secret) ever writes `slackUserId`/`slackTeamId`/`connectedAt`.
 * This file only ever READS that result, and writes the one field a
 * teacher's own "Disconnect Slack" click is allowed to touch:
 * `disconnectedAt` — mirroring markRead()'s own "only touch the one
 * field this action is actually allowed to change" convention in
 * repositories/firestoreNotificationRepository.js.
 */
import { getFirestore, doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function userDoc(uid) {
  return doc(getDb(), 'users', uid);
}

/** `null` if this teacher has never connected Slack, or has disconnected without reconnecting since. */
export async function getActiveSlackIntegrationOnce(uid) {
  const snapshot = await getDoc(userDoc(uid));
  const integration = snapshot.exists() ? snapshot.data()?.slackIntegration : null;
  if (!integration || integration.disconnectedAt) return null;
  return integration;
}

/** Sets `disconnectedAt` only — never touches slackUserId/slackTeamId/connectedAt, so a later reconnect (see functions/src/slack/slackIntegrationRepository.js's own saveSlackIntegration()) has a complete history to overwrite, not a half-erased record. */
export async function disconnectSlack(uid) {
  await updateDoc(userDoc(uid), { 'slackIntegration.disconnectedAt': new Date().toISOString() });
}
