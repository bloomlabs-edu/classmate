/**
 * services/pushNotificationService.js
 *
 * Web push (Firebase Cloud Messaging) for teachers — Phase 1 of this
 * feature: registration/token-management ONLY. Nothing anywhere in
 * this app sends a push yet (see firebase.json's own lack of a
 * "functions" key — this project has no backend at all today; a
 * trusted server context is required to actually call FCM's send
 * API, since that requires a service-account credential that must
 * never reach the browser). This file exists so that plumbing is
 * already correct and in place before a later phase adds the
 * server-triggered sends that actually use it.
 *
 * Notification permission is requested ONLY when enableForCurrentUser()
 * below is called — i.e. only from a direct, explicit user action in
 * the UI (see ui/components/UserBar.js's own notification popover),
 * never automatically at sign-in. This matches every other browser
 * permission this app ever asks for: nothing is requested until a
 * teacher directly clicks something that means it.
 *
 * Reuses the app's existing single Firebase App instance
 * (services/firebaseApp.js) and existing service worker registration
 * (registered once, in main.js's own registerServiceWorker()) rather
 * than creating either of its own — see this project's own explicit
 * "no parallel architecture" direction for this feature.
 *
 * Tokens are stored on users/{uid}.fcmTokens (a map keyed by the
 * token itself, one entry per browser/device) — the exact same
 * document services/accentColorPreferenceService.js already reads
 * and writes for this teacher's other personal preferences. See
 * repositories/firestoreClassroomRepository.js's own
 * saveFcmToken()/removeFcmToken(). No new Firestore rule is needed:
 * users/{uid}'s existing `allow read, write: if request.auth != null
 * && request.auth.uid == uid` already covers this field, exactly like
 * every other field already stored there.
 */

import { getMessaging, getToken, deleteToken, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';
import { getFirebaseApp } from './firebaseApp.js';
import { vapidKey } from '../config/firebaseConfig.js';
import { firestoreClassroomRepository as repository } from '../repositories/firestoreClassroomRepository.js';

const VAPID_KEY_PLACEHOLDER = 'YOUR_VAPID_PUBLIC_KEY';

let messaging = null;

function getMessagingInstance() {
  if (!messaging) messaging = getMessaging(getFirebaseApp());
  return messaging;
}

/**
 * The service worker registration to hand to FCM — deliberately never
 * registers one itself; main.js's own registerServiceWorker() is the
 * only place that ever calls navigator.serviceWorker.register(), so
 * this just waits for whatever registration already exists (or is
 * still in flight) via the standard, no-op-safe
 * navigator.serviceWorker.ready promise.
 */
async function getExistingServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.ready;
}

/**
 * Whether this browser can support FCM web push at all (Safari and
 * some older/embedded browsers cannot; neither can a non-HTTPS,
 * non-localhost origin) — callers should check this before showing
 * any "Enable notifications" control at all, not just before calling
 * enableForCurrentUser().
 */
export async function isPushSupported() {
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/** Read-only, never triggers a permission prompt — lets the UI show "Enabled" / "Blocked" / "Not enabled yet" without side effects. */
export function getPermissionState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

/**
 * The one function that actually shows the browser's native
 * permission prompt — only ever called from a direct "Enable
 * notifications" click, never automatically. On success, saves the
 * resulting token to this teacher's own users/{uid}.fcmTokens.
 */
export async function enableForCurrentUser(uid) {
  if (!uid) return { success: false, reason: 'not-signed-in' };
  if (vapidKey === VAPID_KEY_PLACEHOLDER) return { success: false, reason: 'not-configured' };

  const registration = await getExistingServiceWorkerRegistration();
  if (!registration) return { success: false, reason: 'no-service-worker' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { success: false, reason: 'permission-denied' };
  }

  try {
    const token = await getToken(getMessagingInstance(), {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { success: false, reason: 'no-token' };

    await repository.saveFcmToken(uid, token, {
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
    });
    return { success: true };
  } catch (error) {
    console.error('[pushNotificationService] enableForCurrentUser() failed:', error);
    return { success: false, reason: 'error', error };
  }
}

/**
 * Reverses enableForCurrentUser() for this browser: deletes the
 * token's own FCM registration first (so this device stops being
 * deliverable even if the Firestore removal below somehow fails),
 * then removes the matching entry from users/{uid}.fcmTokens.
 */
export async function disableForCurrentUser(uid) {
  if (!uid) return { success: false, reason: 'not-signed-in' };

  try {
    const registration = await getExistingServiceWorkerRegistration();
    const currentToken = registration
      ? await getToken(getMessagingInstance(), { vapidKey, serviceWorkerRegistration: registration })
      : null;

    await deleteToken(getMessagingInstance());

    if (currentToken) {
      await repository.removeFcmToken(uid, currentToken);
    }
    return { success: true };
  } catch (error) {
    console.error('[pushNotificationService] disableForCurrentUser() failed:', error);
    return { success: false, reason: 'error', error };
  }
}
