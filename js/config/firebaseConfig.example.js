/**
 * config/firebaseConfig.example.js
 *
 * Template for js/config/firebaseConfig.js — that file holds your
 * Firebase project's web app config and IS committed to the
 * repository (see project README). This is a normal part of the
 * shipped app, not a secret: Firebase's client-side config is
 * designed to be public — anyone using the deployed app can already
 * see every one of these values in their browser's dev tools. Real
 * access control happens entirely through Firestore Security Rules
 * (see firestore.rules) and the Authorized Domains list, not through
 * hiding this file.
 *
 * Setup:
 *   1. Copy this file to firebaseConfig.js (same folder).
 *   2. Go to https://console.firebase.google.com and create (or open) a project.
 *   3. Project Settings (gear icon) \u2192 General \u2192 "Your apps" \u2192 add a Web app.
 *   4. Copy the config object Firebase shows you into firebaseConfig.js,
 *      replacing the placeholders below.
 *   5. Authentication \u2192 Sign-in method \u2192 enable "Google".
 *   6. Authentication \u2192 Settings \u2192 Authorized domains \u2192 add whatever
 *      domain you're serving this app from (localhost is included by
 *      default for local testing).
 *   7. Firestore Database \u2192 Rules \u2192 paste firestore.rules \u2192 Publish.
 *   8. Only needed for browser push notifications (see
 *      services/pushNotificationService.js): Project Settings \u2192
 *      Cloud Messaging tab \u2192 "Web configuration" \u2192 Web Push
 *      certificates \u2192 "Generate key pair", then paste that key
 *      below as vapidKey.
 */

export const firebaseConfig = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

/** See setup step 8 above. */
export const vapidKey = 'YOUR_VAPID_PUBLIC_KEY';
