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
 * the right place to enforce this project's own default-safe Firestore
 * environment policy — see firestoreEnvironment.js's own header
 * comment for the full policy and the 2026-09-12 incident that
 * prompted it (also: this project's memory "never-seed-production-
 * data"). In short: production is opt-in (only this app's own known
 * real Hosting hostnames reach it by default); every other context —
 * localhost, a scratchpad static-server port, a CI runner — defaults
 * to a local Firestore emulator instead, with no flag required.
 *
 * services/studentAuthService.js's own per-slot named Firebase Apps
 * are a SEPARATE code path this same policy also has to reach (each
 * slot creates its own Firebase App + its own Firestore instance,
 * bypassing getFirebaseApp() entirely) — see this file's own exported
 * ensureFirestoreEnvironmentConfigured(), which studentAuthService.js
 * calls directly for exactly that reason, so the same policy governs
 * every Firestore instance this app ever creates, not just the default
 * app's.
 */

import { initializeApp, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from '../config/firebaseConfig.js';
import { determineFirestoreTarget } from './firestoreEnvironment.js';

let app = null;

/** Which Firebase App instances (default + every named student-slot app) have already had ensureFirestoreEnvironmentConfigured() run — keyed by App object, since connectFirestoreEmulator() throws if called more than once for the same Firestore instance. */
const configuredApps = new WeakSet();

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
  ensureFirestoreEnvironmentConfigured(app);
  return app;
}

/**
 * Applies this app's Firestore-environment policy to `firebaseApp` —
 * safe to call any number of times for the same app (idempotent via
 * `configuredApps`), and safe/expected to be called once per DISTINCT
 * app instance (the default app, plus each of
 * studentAuthService.js's own per-slot named apps — each is its own
 * separate Firebase App with its own separate Firestore instance that
 * needs its own connectFirestoreEmulator() call). Exported specifically
 * so studentAuthService.js's getAppForSlot() can call this directly,
 * rather than duplicating (or, worse, silently omitting) this same
 * policy for its own apps.
 */
export function ensureFirestoreEnvironmentConfigured(firebaseApp) {
  if (configuredApps.has(firebaseApp)) return;
  configuredApps.add(firebaseApp);

  const target = determineFirestoreTarget({
    hostname: readHostname(),
    getSearchParam: readSearchParam,
    allowProductionGlobal: readAllowProductionGlobal(),
  });

  if (target.mode === 'production') return; // The real getFirestore() call elsewhere already talks to production by default — nothing to redirect.

  connectFirestoreEmulator(getFirestore(firebaseApp), target.host, target.port);
  // Loud and unmissable on purpose — an emulator redirect silently
  // active in what looks like a normal app load is exactly the kind of
  // thing that should never go unnoticed, in either direction (someone
  // expecting production and quietly not getting it is just as much a
  // problem as the reverse this safeguard exists to prevent).
  console.warn(`[firebaseApp] Firestore requests for app "${firebaseApp.name}" redirected to LOCAL EMULATOR at ${target.host}:${target.port}. Production Firestore (${firebaseConfig.projectId}) will NOT be read from or written to for the rest of this session. To use real production from a non-production hostname, pass ?firestoreProduction=1 explicitly.`);
}

function readHostname() {
  try {
    return typeof window !== 'undefined' ? window.location?.hostname ?? null : null;
  } catch {
    return null;
  }
}

function readSearchParam(key) {
  try {
    if (typeof window === 'undefined' || !window.location?.search) return null;
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}

function readAllowProductionGlobal() {
  try {
    return typeof window !== 'undefined' ? window.__CLASSMATE_ALLOW_PRODUCTION_FIRESTORE__ === true : false;
  } catch {
    return false;
  }
}
