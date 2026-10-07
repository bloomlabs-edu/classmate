/**
 * services/authService.js
 *
 * Isolates all Firebase Authentication logic behind a small API so no UI
 * component ever touches the Firebase SDK directly — main.js and views
 * only ever call initAuth(), onAuthStateChange(), signInWithGoogle(),
 * and signOutUser(). Google Sign-In only, for now. Session persistence
 * is explicit (browserLocalPersistence) so a signed-in teacher stays
 * signed in across browser restarts, not just page refreshes.
 *
 * This deliberately does NOT touch classroom data or localStorage at
 * all — see services/workspaceService.js, which is untouched by this
 * sprint. Authentication only identifies the teacher for now; wiring a
 * signed-in uid to Firestore-synced classrooms is a future sprint. The
 * shape here (a single init call, a single state-change subscription,
 * and a "safe profile" object) is meant to make that extension
 * straightforward without reworking this file's public API.
 *
 * IMPORTANT — data handling: Google Sign-In inherently returns the
 * signed-in user's email address as part of their Google profile —
 * there is no way to complete this kind of sign-in without Google
 * providing it. This app deliberately never reads, stores, logs, or
 * displays that email anywhere: toSafeProfile() below strips every
 * Firebase user down to only uid, displayName, and photoURL before it
 * is ever handed to the rest of the app. If a future sprint needs the
 * email itself (e.g. to key Firestore documents or manage
 * invitations), that is a new use of contact information and should be
 * escalated to the AI Working Committee first, per this organisation's
 * data-handling rules.
 */

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirebaseApp } from './firebaseApp.js';
import { logPersistenceEvent } from './persistenceLogger.js';

let auth = null;

/**
 * Initialises Firebase Auth (against the shared app from
 * services/firebaseApp.js) and sets session persistence to local
 * storage (survives closing the browser entirely, not just a page
 * refresh). Safe to call more than once — only the first call does
 * anything.
 */
export function initAuth() {
  if (auth) return;
  const app = getFirebaseApp();
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error('[authService] Failed to set auth persistence:', error);
  });
}

/**
 * Registers a listener that fires immediately with the current
 * signed-in teacher (or null) and again every time sign-in or sign-out
 * happens — this is the "auth state listener" the UI reacts to, rather
 * than any view calling Firebase directly. Returns Firebase's own
 * unsubscribe function.
 */
let authCallbackCount = 0;

export function onAuthStateChange(callback) {
  return onAuthStateChanged(auth, (firebaseUser) => {
    authCallbackCount += 1;
    // TEMPORARY DIAGNOSTIC LOGGING — instrumenting the auth lifecycle
    // to prove/disprove onAuthStateChanged firing more than once per
    // session (see this project's own investigation into why the
    // Learning workspace's Save UI disappears on the deployed app but
    // not on Live Server). Remove once that investigation concludes.
    logPersistenceEvent(`Auth callback #${authCallbackCount} (${authCallbackCount === 1 ? 'first' : 'SUBSEQUENT'})`, {
      uid: firebaseUser ? firebaseUser.uid : null,
    });

    if (firebaseUser) {
      // Pre-existing TEMPORARY DEBUG LOGGING — remove after cross-device
      // investigation. Deliberately logs UID only, not EMAIL: this app's
      // design (see the module doc comment above) never reads/stores/logs
      // the teacher's email, and console output here is likely to be
      // copy-pasted elsewhere while debugging. UID alone is enough to
      // confirm/rule out "different account signed in on this device."
      console.log('[AUTH]');
      console.log('UID:', firebaseUser.uid);
    }
    callback(firebaseUser ? toSafeProfile(firebaseUser) : null);
  });
}

/**
 * `prompt: 'select_account'` forces Google's account chooser to appear
 * every time — without it, signInWithPopup will often silently reuse
 * whichever Google account the browser is already signed into, rather
 * than asking. That's the actual mechanism behind not being able to
 * freely switch accounts: Firebase's own signOut() below correctly
 * clears this app's session, but the *browser's* underlying Google
 * session persists, so the next sign-in attempt would otherwise
 * silently reauthenticate as the same account instead of prompting.
 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return toSafeProfile(credential.user);
}

/**
 * "Sign in with Phone" (see docs/architecture/TV_PHONE_SIGNIN_DESIGN.md)
 * — redeems the one-time Firebase custom token a Cloud Function minted
 * for the teacher's own real uid (services/deviceSignInTvService.js)
 * after her explicit approval on her phone. The resulting session has
 * the exact same uid, role, and Firestore permissions as any other
 * sign-in method for that account — `signInWithCustomToken` itself
 * guarantees that; nothing else in this app needs to know this session
 * didn't come from `signInWithGoogle()`.
 *
 * Deliberately sets `browserSessionPersistence`, NOT this module's own
 * `initAuth()` default of `browserLocalPersistence` — a shared TV/
 * classroom display staying silently signed in as one specific
 * teacher indefinitely is a materially different risk than her own
 * laptop doing so (design decision #1). This persistence choice is
 * scoped to THIS sign-in call only, via `setPersistence()` immediately
 * before it — every other sign-in path (`signInWithGoogle()`) is
 * completely unaffected and keeps using the module-wide local
 * persistence `initAuth()` already set up.
 */
export async function signInWithCustomTokenForSharedDevice(customToken) {
  await setPersistence(auth, browserSessionPersistence);
  const credential = await signInWithCustomToken(auth, customToken);
  return toSafeProfile(credential.user);
}

export async function signOutUser() {
  await signOut(auth);
}

export function getCurrentUser() {
  return auth?.currentUser ? toSafeProfile(auth.currentUser) : null;
}

/**
 * The raw Firebase ID token (a signed JWT proving "this really is
 * uid X," not a contact detail) for the signed-in teacher — needed so
 * a trusted backend endpoint can verify who's calling it (see
 * services/deviceSignInApprovalService.js, which sends this as a
 * Bearer header to the getDeviceSignInRequestInfo/approveDeviceSignIn/
 * denyDeviceSignIn Cloud Functions). This is the one place outside
 * toSafeProfile() that reads anything off the raw Firebase user, but
 * it never touches email or any other field this module's own header
 * comment excludes.
 */
export async function getIdToken() {
  return auth?.currentUser ? auth.currentUser.getIdToken() : null;
}

/**
 * Strips a Firebase user down to only what this app is allowed to use —
 * see the module doc comment above for why email is excluded.
 */
function toSafeProfile(firebaseUser) {
  return {
    uid: firebaseUser.uid,
    displayName: firebaseUser.displayName || 'Teacher',
    photoURL: firebaseUser.photoURL || null,
  };
}
