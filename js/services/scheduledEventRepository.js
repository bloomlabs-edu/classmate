/**
 * services/scheduledEventRepository.js
 *
 * Isolates Firestore access for Scheduled Events (models/ScheduledEvent.js)
 * — its own subcollection, `classrooms/{classroomId}/scheduledEvents/{eventId}`,
 * mirroring services/plannerRepository.js's own Lessons storage exactly
 * and for the identical reason: a multi-year history of exams/events is
 * real, unbounded growth an already-substantial classroom document
 * shouldn't have to absorb, and one event's own edit/delete becomes a
 * single small document write.
 *
 * Deliberately calls getFirestore(), not initializeFirestore() — same
 * reasoning as plannerRepository.js's own header comment: the app's
 * Firestore instance is already initialized elsewhere by the time
 * anything here is ever called.
 *
 * A plain module, not a class — same reasoning as
 * plannerRepository.js's own header comment (exactly one implementation,
 * exactly one real caller domain).
 */

import { getFirestore, collection, doc, getDoc, setDoc, getDocs, deleteDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from './firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function scheduledEventsCollectionRef(classroomId) {
  return collection(getDb(), 'classrooms', classroomId, 'scheduledEvents');
}

/** Persists one ScheduledEvent (create or update) — a single small write, matching services/plannerRepository.js's own saveLesson(). */
export async function saveScheduledEvent(classroomId, event) {
  await setDoc(doc(scheduledEventsCollectionRef(classroomId), event.id), { ...event });
  return event;
}

/** One ScheduledEvent by its own id, or null. */
export async function getScheduledEventById(classroomId, eventId) {
  const snapshot = await getDoc(doc(scheduledEventsCollectionRef(classroomId), eventId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/**
 * Every ScheduledEvent whose own `date` falls within [startDateKey,
 * endDateKey] (inclusive) — what the Timetable Week/Day/Calendar views
 * and the Dashboard's own schedule widget all fetch in one query per
 * visible range, matching services/plannerRepository.js's own
 * getLessonsForDateRange() exactly.
 */
export async function getScheduledEventsForDateRange(classroomId, startDateKey, endDateKey) {
  const eventsQuery = query(scheduledEventsCollectionRef(classroomId), where('date', '>=', startDateKey), where('date', '<=', endDateKey));
  const snapshot = await getDocs(eventsQuery);
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes one ScheduledEvent — a teacher's own explicit "Delete" action from the School Calendar / Exams management flow. Unlike Lessons (which never deletes), an event is genuinely deletable — deleting a mistakenly-scheduled exam is a real, expected action. */
export async function deleteScheduledEvent(classroomId, eventId) {
  await deleteDoc(doc(scheduledEventsCollectionRef(classroomId), eventId));
}
