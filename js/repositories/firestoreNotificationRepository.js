/**
 * repositories/firestoreNotificationRepository.js
 *
 * classrooms/{classroomId}/notifications/{notificationId} — a
 * dedicated collection, mirroring firestoreFeedRepository.js's own
 * shape (plain functions, not a class, matching this specific
 * collection's own simpler needs rather than
 * firestoreClassroomRepository.js's larger class).
 *
 * Unlike feedPosts, there is no student-facing write path here at all
 * — every function below always uses the teacher's own default-app
 * Firestore instance. See firestore.rules's own comment on this
 * collection for why creation is restricted to an authenticated
 * classroom member writing their own uid as createdByUid: this
 * repository has no equivalent of feedRepository's `db` parameter
 * (a student's own per-slot instance) because nothing here is ever
 * meant to be callable from a student's own identity.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  arrayUnion,
  runTransaction,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';
import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

// A recent-activity popover, not a full history screen — see
// UserBar.js's own notification list. Bounding the live query keeps
// both the listener's own cost and the popover's own rendered list
// small regardless of how long a classroom has existed.
const RECENT_LIMIT = 20;

function teacherDb() {
  return getFirestore(getFirebaseApp());
}

function notificationsCollection(classroomId) {
  return collection(teacherDb(), 'classrooms', classroomId, 'notifications');
}

function notificationDoc(classroomId, notificationId) {
  return doc(teacherDb(), 'classrooms', classroomId, 'notifications', notificationId);
}

/**
 * Creates a new notification, authored by `createdByUid` — always the
 * real, authenticated caller (see firestore.rules's own create rule
 * for this collection, which requires this).
 *
 * `readBy` defaults to empty (nobody's seen it yet) but may be seeded
 * with the creator's own uid by a caller that wants to exclude them
 * from their own notification — see services/feedService.js's
 * createPostAsTeacher() for why a post's own author shouldn't see it
 * as unread. Firestore rules don't need to know about this: `readBy`
 * is already a plain, unrestricted-at-create-time array field.
 */
export async function createNotification(classroomId, { type, category, title, message, payload = {}, createdByUid, readBy = [] }) {
  const notificationId = generateId();
  await setDoc(notificationDoc(classroomId, notificationId), {
    id: notificationId,
    classroomId,
    type,
    category,
    title,
    message,
    payload,
    createdAt: getCurrentIsoDate(),
    createdByUid,
    readBy,
  });
  return notificationId;
}

/**
 * Creates a notification at a CALLER-CHOSEN, deterministic id — used
 * only where more than one independent client can race to create the
 * exact same logical notification at once (see services/feedService.js's
 * own subscribeToNewStudentPostsForClassroom(): every teacher who has a
 * classroom open runs their own independent listener, so more than one
 * of them can notice the same new student post at nearly the same
 * moment). A plain setDoc() here would let a second, later writer
 * silently overwrite the first one's document — wiping out any
 * readBy entries already added in between, however narrow that window
 * is in practice. Wrapping the check-then-write in a transaction closes
 * that window entirely: whichever client's transaction commits first
 * really does create it; every other concurrent one reads it as
 * already existing and does nothing, leaving the first writer's
 * document (and everyone's own independent readBy state on it)
 * completely untouched. Every teacher therefore always ends up reading
 * the exact same one document, never a duplicate per teacher.
 *
 * Silently returns without writing if a notification at this id
 * already exists — this is the intended, expected outcome for every
 * caller except the one that actually wins the race, not an error.
 */
export async function createNotificationIfAbsent(classroomId, notificationId, { type, category, title, message, payload = {}, createdByUid }) {
  const ref = notificationDoc(classroomId, notificationId);
  await runTransaction(teacherDb(), async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists()) return;
    transaction.set(ref, {
      id: notificationId,
      classroomId,
      type,
      category,
      title,
      message,
      payload,
      createdAt: getCurrentIsoDate(),
      createdByUid,
      readBy: [],
    });
  });
  return notificationId;
}

/** The most recent notifications for this classroom, newest-first — a one-time read, matching listPosts()'s own convention. Most callers want subscribeToNotifications() below instead, for live updates. */
export async function listNotifications(classroomId) {
  const snapshot = await getDocs(query(notificationsCollection(classroomId), orderBy('createdAt', 'desc'), limit(RECENT_LIMIT)));
  return snapshot.docs.map((d) => d.data());
}

/** Live-updates `onChange` with the most recent notifications, newest-first, every time this classroom's own notifications change. Returns the unsubscribe function directly, matching firestoreClassroomRepository.js's own subscribeToClassroom()/subscribeToClassroomRefs() convention exactly. */
export function subscribeToNotifications(classroomId, onChange, onError) {
  return onSnapshot(
    query(notificationsCollection(classroomId), orderBy('createdAt', 'desc'), limit(RECENT_LIMIT)),
    (snapshot) => onChange(snapshot.docs.map((d) => d.data())),
    (error) => onError?.(error)
  );
}

/** Marks one notification read for exactly this uid — adds only their own uid to readBy, never touches any other field. Matches firestore.rules's own update rule for this collection (readBy is the one field a plain member may ever change). */
export async function markRead(classroomId, notificationId, uid) {
  await updateDoc(notificationDoc(classroomId, notificationId), { readBy: arrayUnion(uid) });
}
