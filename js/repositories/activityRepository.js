/**
 * repositories/activityRepository.js
 *
 * Isolates Firestore access for Activities (see models/Activity.js) —
 * mirrors services/resourceRepository.js's own storage pattern and
 * reasoning exactly: an Activity has independent identity/lifecycle
 * from the Concept it's attached to, so it lives in its own
 * subcollection rather than being embedded in the classroom document.
 *
 * `classrooms/{classroomId}/activities/{activityId}` — scoped under
 * the classroom (not a top-level `activities` collection) for the
 * same security-rule-shape reason resourceRepository.js's own header
 * comment gives: membership of the classroom document already
 * controls access, so nothing new needs to be introduced for this
 * subcollection either.
 *
 * Deliberately no live listener/cache — a plain async fetch, same
 * "simple and explicit over cached and synchronized until an actual
 * need appears" convention as resourceRepository.js's
 * getResourcesForClassroom().
 *
 * A plain module, not a class — same reasoning as
 * resourceRepository.js's own header comment: this app only uses the
 * class/abstract-contract pattern when multiple storage providers
 * genuinely need to be swappable. Activity has exactly one
 * implementation and one caller (services/learningIntegrationService.js).
 */

import { getFirestore, collection, doc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function activitiesCollectionRef(classroomId) {
  return collection(getDb(), 'classrooms', classroomId, 'activities');
}

/** Persists one Activity (create or update) — a single small write. */
export async function saveActivity(classroomId, activity) {
  const ref = doc(activitiesCollectionRef(classroomId), activity.id);
  await setDoc(ref, { ...activity });
  return activity;
}

/** Permanently removes an Activity document. */
export async function deleteActivityDoc(classroomId, activityId) {
  const ref = doc(activitiesCollectionRef(classroomId), activityId);
  await deleteDoc(ref);
}

/**
 * Every Activity belonging to one classroom, in one query. Not scoped
 * to a single Concept in this query — callers
 * (services/learningIntegrationService.js) resolve a specific
 * Concept's subset from this full list themselves, the same shape
 * resourceRepository.js's getResourcesForClassroom() already
 * established for Resources.
 */
export async function getActivitiesForClassroom(classroomId) {
  const snapshot = await getDocs(activitiesCollectionRef(classroomId));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}
