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
  apiKey: "AIzaSyARidXhRt9RejPIJxtwfzeQRzyZXVT1HzM",
  authDomain: "classroom-tracker-f797e.firebaseapp.com",
  projectId: "classroom-tracker-f797e",
  storageBucket: "classroom-tracker-f797e.firebasestorage.app",
  messagingSenderId: "203174865366",
  appId: "1:203174865366:web:708bf2b08bf226ef0f1c77"
};
