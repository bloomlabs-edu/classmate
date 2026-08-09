/**
 * services/studentAuthService.js
 *
 * Milestone 1A — Student Auth Slots.
 *
 * Establishes THREE independent Firebase Anonymous Auth identities in
 * one browser — one per existing device slot (see
 * studentDeviceService.js's own MAX_APPROVED_PROFILES = 3 and its new
 * slotIndex field) — so that later milestones can give Firestore
 * rules something real, per-student, and unforgeable to check
 * (request.auth.uid), rather than trusting a client-supplied
 * studentId. This file does nothing with that identity yet: no
 * enrollment tokens, no studentAuthLinks, no Firestore rule changes,
 * no writes gated by it. It only proves the identity itself can exist,
 * independently, per slot.
 *
 * Deliberately a SEPARATE, named Firebase App per slot
 * ('studentSlot0'/'studentSlot1'/'studentSlot2'), never the default
 * app services/firebaseApp.js's own getFirebaseApp() returns — that
 * default app is the teacher's own, Google-authenticated session (see
 * authService.js). A single shared Auth instance only ever tracks one
 * current user; signing a student in anonymously on the SAME instance
 * a teacher is Google-signed-in on would silently sign the teacher
 * out. Each slot's own named app carries its own, independently
 * persisted Auth state, verified as a real, working mechanism via a
 * disposable manual test (firebase-slot-test.html) before this file
 * was written, not assumed from documentation alone.
 *
 * Errors from Firebase itself are never swallowed here — every
 * function either resolves with a real UID or rejects with the real
 * error. No silent fallback, per explicit product decision for this
 * milestone.
 */

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from '../config/firebaseConfig.js';
import * as studentDeviceService from './studentDeviceService.js';

export const SLOT_COUNT = 3;

function slotAppName(slotIndex) {
  return `studentSlot${slotIndex}`;
}

/**
 * This slot's own named Firebase App instance — created once, reused
 * on every subsequent call. Mirrors services/firebaseApp.js's own
 * "getApps().length > 0 ? getApp() : initializeApp(...)" idempotent
 * pattern, extended to a specific named app rather than the default
 * one.
 */
function getAppForSlot(slotIndex) {
  const name = slotAppName(slotIndex);
  const existing = getApps().find((app) => app.name === name);
  return existing || initializeApp(firebaseConfig, name);
}

/** This slot's own Auth instance — one per named app, never shared with the teacher's own default-app Auth instance. */
export function getAuthForSlot(slotIndex) {
  return getAuth(getAppForSlot(slotIndex));
}

/**
 * This slot's own Firestore instance — required for any write made on
 * a student's behalf (enrollment redemption, goal submission). Using
 * services/firebaseApp.js's own default-app Firestore instance here
 * would be wrong: that instance is tied to the DEFAULT app's own Auth
 * state (the teacher's, if any is signed in) — Firestore attaches
 * whichever Auth belongs to the same named app its own instance was
 * created from, not just "whichever Auth happens to be signed in
 * somewhere." A write issued from the wrong Firestore instance would
 * carry the wrong request.auth (or none at all) on the wire,
 * regardless of whether this slot's own anonymous sign-in succeeded.
 *
 * Plain getFirestore(), not the persistent-cache setup
 * firestoreClassroomRepository.js uses for the teacher-side default
 * app — offline persistence isn't needed for this scoped addition.
 */
export function getFirestoreForSlot(slotIndex) {
  return getFirestore(getAppForSlot(slotIndex));
}

const persistenceReadyBySlot = {};

/** Ensures this slot's own Auth instance is set to survive a page refresh/browser restart, exactly once per slot per page load. */
async function ensurePersistence(slotIndex) {
  if (persistenceReadyBySlot[slotIndex]) return;
  await setPersistence(getAuthForSlot(slotIndex), browserLocalPersistence);
  persistenceReadyBySlot[slotIndex] = true;
}

/**
 * This slot's own anonymous Firebase UID — signing in if this slot has
 * no persisted user yet, reusing the existing one otherwise. Never
 * creates a second anonymous user for a slot that already has one.
 *
 * Throws the real Firebase error on failure — no silent fallback, per
 * explicit product decision for this milestone.
 */
export async function ensureAnonymousSignIn(slotIndex) {
  await ensurePersistence(slotIndex);
  const auth = getAuthForSlot(slotIndex);

  if (auth.currentUser) {
    return auth.currentUser.uid;
  }

  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}

/**
 * The currently-active student profile's own slot, signed in and
 * ready. Returns { slotIndex, uid }, or null if no student profile is
 * currently active on this device at all.
 *
 * This is the "when the active profile changes, use that profile's
 * corresponding Auth instance" behavior — called wherever the app
 * needs to know which Auth identity currently applies, rather than
 * that decision being made once and cached, since the active profile
 * can change at any time via the existing profile switcher.
 */
export async function getAuthForActiveProfile() {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return null;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return null;

  const uid = await ensureAnonymousSignIn(slotIndex);
  return { slotIndex, uid };
}
