/**
 * services/learningHubFirebaseApp.js
 *
 * The single place a SECOND, Learning-Hub-pointed Firebase App gets
 * created — Student-Facing External Activities (ClassMate Phase 2).
 * Mirrors services/firebaseApp.js's own getFirebaseApp() exactly, just
 * targeting a different project's config and a different app name, so
 * this never collides with — and never has to reinitialize — the
 * default app already used everywhere else in this codebase (see that
 * file's own header comment for why initializeApp() can only be called
 * once per named app).
 *
 * Reuses services/firebaseApp.js's own exported
 * ensureFirestoreEnvironmentConfigured() UNCHANGED — that function
 * already takes `firebaseApp` as a parameter specifically so
 * services/studentAuthService.js's own per-slot named apps could call
 * it too (see that file's own usage); this is simply a second caller of
 * the exact same, already-reviewed policy, not a second
 * production-vs-emulator decision invented here. That means: on any
 * hostname NOT in firestoreEnvironment.js's own PRODUCTION_HOSTNAMES
 * allowlist, BOTH the default app (classmate-302c2) AND this one
 * (learning-hub-b2586) redirect to the SAME local Firestore emulator
 * (127.0.0.1:8080) automatically — a single local emulator process
 * keeps the two projects' data fully isolated by project id, so no
 * second emulator/port is needed for local dev or tests.
 *
 * Learning Hub's config values below are copied verbatim from
 * learning-hub/app/firebase.js — not secret (same "client config
 * identifies the project, rules are the real boundary" convention this
 * app's own firebaseConfig.js already documents), but genuinely a
 * DIFFERENT project than classmate-302c2: different apiKey, appId,
 * messagingSenderId, authDomain. This file never writes anything —
 * see services/learningHubConceptService.js / learningHubActivityService.js,
 * the only two callers, both read-only by construction.
 */

import { initializeApp, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { ensureFirestoreEnvironmentConfigured } from './firebaseApp.js';

const LEARNING_HUB_APP_NAME = 'learningHub';

const learningHubFirebaseConfig = {
  apiKey: 'AIzaSyD-tHXPqF3iqZ3fwmzjdGVoDsK8s60CB58',
  authDomain: 'learning-hub-b2586.firebaseapp.com',
  projectId: 'learning-hub-b2586',
  storageBucket: 'learning-hub-b2586.firebasestorage.app',
  messagingSenderId: '174031544555',
  appId: '1:174031544555:web:ad2078e4ff21e001739eae',
};

let app = null;

/**
 * Returns the one, lazily-created, named Firebase App instance pointed
 * at learning-hub-b2586 — idempotent (safe to call from every read
 * site; `initializeApp()` throws if called twice for the same name, so
 * this always checks `getApp(name)` first, same pattern
 * getFirebaseApp() and studentAuthService.js's getAppForSlot() already
 * both use). Never returns or touches the DEFAULT app
 * (services/firebaseApp.js's own getFirebaseApp()) — these are two
 * entirely separate App objects, two separate Firestore instances,
 * living side by side in the same page.
 */
export function getLearningHubFirebaseApp() {
  if (!app) {
    try {
      app = getApp(LEARNING_HUB_APP_NAME);
    } catch {
      app = initializeApp(learningHubFirebaseConfig, LEARNING_HUB_APP_NAME);
    }
  }
  ensureFirestoreEnvironmentConfigured(app);
  return app;
}

/**
 * Convenience — the Firestore instance for the Learning Hub app,
 * already environment-configured. Every caller should go through this
 * rather than calling getFirestore(getLearningHubFirebaseApp()) itself,
 * so there is exactly one place this wiring happens.
 */
export function getLearningHubFirestore() {
  return getFirestore(getLearningHubFirebaseApp());
}
