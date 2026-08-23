/**
 * config/firebaseConfig.js
 *
 * Your Firebase project's web config. These values are not secret —
 * Firebase's client-side config is designed to be shipped in the
 * browser; real access control happens via Firebase Security Rules, not
 * by hiding this object — but they DO need to be *your* project's
 * values, not the placeholders below.
 *
 * To get these:
 *   1. Go to https://console.firebase.google.com and create (or open) a project.
 *   2. Project Settings (gear icon) \u2192 General \u2192 "Your apps" \u2192 add a Web app.
 *   3. Copy the config object Firebase shows you into the object below.
 *   4. Authentication \u2192 Sign-in method \u2192 enable "Google".
 *   5. Authentication \u2192 Settings \u2192 Authorized domains \u2192 add whatever
 *      domain you're serving this app from (localhost is included by
 *      default for local testing).
 *
 * The placeholder values below will not work until you replace them —
 * Google Sign-In will fail with a Firebase config error.
 */

export const firebaseConfig = {
  apiKey: "AIzaSyB7mb9F_HvUzcRP7kIMlfTNPyFN0fJs2NM",
  authDomain: "classmate-302c2.firebaseapp.com",
  projectId: "classmate-302c2",
  storageBucket: "classmate-302c2.firebasestorage.app",
  messagingSenderId: "918151236425",
  appId: "1:918151236425:web:780d571a0415bd0b592898",
  measurementId: "G-GY32VNWDTF"
};

/**
 * Web Push certificate ("VAPID key pair") PUBLIC key -- used by
 * services/pushNotificationService.js's own getToken() call to
 * register this browser for Firebase Cloud Messaging web push.
 * Generate this in Firebase Console -> Project Settings -> Cloud
 * Messaging tab -> "Web configuration" section -> Web Push
 * certificates -> "Generate key pair" (only needed once per
 * project). Paste the resulting "Key pair" value below.
 *
 * This is the PUBLIC half of the pair -- safe to ship in the browser,
 * same trust model as the config object above. Firebase never exposes
 * the private half to any client; it stays entirely on Google's own
 * servers. Do not paste anything here other than that one public key
 * string from the console -- there is nothing secret to protect, but
 * also nothing else valid to put here.
 */
export const vapidKey = "BF-u75n5RBgyGyPOWx-gY33KXAMy3XsCNTqQdr9-dR_vWK0fT_LarlW7SJk_EO02xatVESAwDPcpnlhOYKEnEls";
