/**
 * services/analyticsEventService.js
 *
 * The write-side of the Admin Dashboard's usage analytics — one
 * lightweight, immutable document per meaningful ClassMate action (see
 * firestore.rules' own analyticsEvents block for the exact 8 allowed
 * `type` values and field shape). Every call site elsewhere in this app
 * that calls logEvent() is documented at its own call site as to *why*
 * that specific action is "meaningful" enough to track — this file
 * itself only knows how to write one, safely.
 *
 * Deliberately fire-and-forget: logEvent() never throws and callers
 * never need to await or catch it. Analytics must never be able to
 * break, delay, or roll back the real feature it's attached to (e.g.
 * awarding a star to a student) — a network hiccup here should be
 * invisible to the teacher.
 *
 * Deliberately does NOT accept a studentId, student name, or any other
 * per-student identifier as a parameter at all — see this project's own
 * data-handling rules and services/authService.js's own precedent for
 * treating identity minimization as a hard constraint, not a preference.
 */

import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from './firebaseApp.js';
import { getCurrentUser } from './authService.js';

/**
 * @param {string} type - one of the 8 event types firestore.rules allows.
 * @param {{ classroomId?: string|null, meta?: object }} [options]
 */
export function logEvent(type, { classroomId = null, meta = {} } = {}) {
  const user = getCurrentUser();
  // No signed-in user (shouldn't happen for any real call site below,
  // since every one of them only runs after a teacher is already
  // signed in) — silently skip rather than throw; this is telemetry,
  // never a load-bearing part of the feature it's attached to.
  if (!user) return;

  const db = getFirestore(getFirebaseApp());
  addDoc(collection(db, 'analyticsEvents'), {
    type,
    uid: user.uid,
    classroomId,
    meta,
    createdAt: serverTimestamp(),
  }).catch((error) => {
    console.error('[analyticsEventService] Failed to log event:', type, error);
  });
}
