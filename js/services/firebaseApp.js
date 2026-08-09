/**
 * services/firebaseApp.js
 *
 * The single place Firebase's App instance gets created. Both
 * authService.js and repositories/firestoreClassroomRepository.js need
 * the *same* initialized app — Firebase throws if initializeApp() is
 * called twice for the default app — so both import getFirebaseApp()
 * from here instead of each calling initializeApp() themselves.
 */

import { initializeApp, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { firebaseConfig } from '../config/firebaseConfig.js';

let app = null;

export function getFirebaseApp() {
  if (!app) {
    // Not getApps().length > 0 — that returns EVERY initialized app,
    // named or default, so it can't tell "the default app already
    // exists" apart from "only a named app exists" (e.g. a student
    // slot's own app, see studentAuthService.js). getApp() throws if
    // the specific (default) app hasn't been created, which is
    // exactly the real signal needed here.
    try {
      app = getApp();
    } catch {
      app = initializeApp(firebaseConfig);
    }
  }
  return app;
}
