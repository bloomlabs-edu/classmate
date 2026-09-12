/**
 * services/firebaseApp.js
 *
 * The single place Firebase's App instance gets created. Both
 * authService.js and repositories/firestoreClassroomRepository.js need
 * the *same* initialized app — Firebase throws if initializeApp() is
 * called twice for the default app — so both import getFirebaseApp()
 * from here instead of each calling initializeApp() themselves.
 *
 * This is also the one place every *Firestore-backed* repository in
 * the app transitively passes through — every one of them calls
 * `getFirestore(getFirebaseApp())` (16 files, at last count: see e.g.
 * services/scheduledEventRepository.js's own getDb()). That makes this
 * the single correct place to guarantee an EXPLICIT, opt-in redirect
 * to a local Firestore emulator for automated test/browser-verification
 * harnesses — see maybeConnectFirestoreEmulator() below. Added after a
 * 2026-09-12 incident where unauthorized exam records were found in
 * real production data (`classmate-302c2`) with no other Firebase
 * project configured anywhere in this repo to redirect to instead —
 * see this project's own memory "never-seed-production-data" for the
 * full incident writeup. Every repository gets this redirect for free,
 * with zero changes to any of those 16 files, because they all resolve
 * their own Firestore instance via this same function.
 */

import { initializeApp, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from '../config/firebaseConfig.js';

let app = null;
let firestoreEmulatorConnectAttempted = false;

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
  maybeConnectFirestoreEmulator(app);
  return app;
}

/**
 * Redirects ALL Firestore traffic for this app to a local emulator —
 * but ONLY when a test harness has explicitly opted in, via either a
 * `?firestoreEmulator=host:port` URL query param or a
 * `window.__CLASSMATE_FIRESTORE_EMULATOR__ = 'host:port'` global set
 * BEFORE this module first runs. Deliberately NEVER automatic (e.g.
 * never inferred from "running on localhost" or "no auth session") —
 * this repo's existing, intended workflow is real local development
 * against the real `classmate-302c2` project (there is no separate dev
 * Firebase project to redirect to by default), so only an explicit,
 * deliberate per-harness signal may redirect Firestore elsewhere.
 *
 * Idempotent (guarded by firestoreEmulatorConnectAttempted) — the
 * Firestore SDK throws if connectFirestoreEmulator() is called more
 * than once, or after any other operation already ran against that
 * Firestore instance. Called from getFirebaseApp() itself so it always
 * runs before any repository's own getFirestore(getFirebaseApp())
 * performs its first real operation, regardless of which repository
 * happens to be used first.
 */
function maybeConnectFirestoreEmulator(app) {
  if (firestoreEmulatorConnectAttempted) return;
  firestoreEmulatorConnectAttempted = true;

  const target = readEmulatorTarget();
  if (!target) return;

  const [host, portText] = target.split(':');
  const port = Number(portText);
  if (!host || !Number.isFinite(port)) {
    console.error(`[firebaseApp] Ignoring malformed Firestore emulator target "${target}" — expected "host:port". Firestore requests will go to production (${firebaseConfig.projectId}).`);
    return;
  }

  connectFirestoreEmulator(getFirestore(app), host, port);
  // Loud and unmissable on purpose — an emulator redirect silently
  // active in what looks like a normal app load is exactly the kind of
  // thing that should never go unnoticed.
  console.warn(`[firebaseApp] Firestore requests redirected to LOCAL EMULATOR at ${target}. Production Firestore (${firebaseConfig.projectId}) will NOT be read from or written to for the rest of this session.`);
}

function readEmulatorTarget() {
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const fromQuery = new URLSearchParams(window.location.search).get('firestoreEmulator');
      if (fromQuery) return fromQuery;
    }
  } catch {
    /* no window/location in a non-browser context (e.g. a Node test) — fall through */
  }
  try {
    if (typeof window !== 'undefined' && window.__CLASSMATE_FIRESTORE_EMULATOR__) {
      return window.__CLASSMATE_FIRESTORE_EMULATOR__;
    }
  } catch {
    /* ignore */
  }
  return null;
}
