/**
 * repositories/firestoreStudentEventReadStateRepository.js
 *
 * classrooms/{classroomId}/studentEventReadState/{studentUid} — one
 * small, student-owned document per student, holding which of their
 * own StudentEvents (see models/StudentEvent.js, classroom.studentEvents)
 * they've already seen. A dedicated collection, not a field on
 * classroom.studentEvents itself or the classroom document — the
 * event CONTENT stays exactly where it already lives (teacher-owned,
 * written only by a teacher's own classroom-doc update, per the
 * existing architecture this file deliberately does not touch); only
 * READ STATE moves somewhere a student can legitimately write to
 * directly, since writing the classroom document itself requires
 * memberUids membership a student's own identity can never have.
 *
 * Mirrors repositories/firestoreStudentGoalsRepository.js's own "accept
 * the caller's own per-slot Firestore instance as `db`" convention
 * exactly — every function here is called with the student's own
 * per-slot instance (see services/studentEventService.js), matching
 * firestore.rules's own direct `request.auth.uid == studentUid` check
 * for this collection: the same "your own uid, nothing else" shape
 * users/{uid} already uses, applied per classroom instead of globally.
 */

import { doc, getDoc, setDoc, onSnapshot, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const EMPTY_READ_STATE = Object.freeze({ readEventIds: [] });

function readStateDoc(db, classroomId, studentUid) {
  return doc(db, 'classrooms', classroomId, 'studentEventReadState', studentUid);
}

/** This student's own current read state — an empty shape (nothing read yet) if the document doesn't exist, matching every other "no data yet" convention in this app (never null/undefined for a caller to guard against separately). */
export async function getReadState(db, classroomId, studentUid) {
  const snapshot = await getDoc(readStateDoc(db, classroomId, studentUid));
  return snapshot.exists() ? snapshot.data() : EMPTY_READ_STATE;
}

/** Marks exactly one event read — setDoc+merge (not updateDoc) since this document may not exist yet for a student who hasn't read anything. arrayUnion is naturally idempotent, so re-marking an already-read event is a harmless no-op. */
export async function markEventRead(db, classroomId, studentUid, eventId) {
  await setDoc(readStateDoc(db, classroomId, studentUid), { readEventIds: arrayUnion(eventId) }, { merge: true });
}

/** Marks several events read in one write — the dwell-to-read behavior's own bulk equivalent of markEventRead() above. */
export async function markEventsRead(db, classroomId, studentUid, eventIds) {
  if (!eventIds || eventIds.length === 0) return;
  await setDoc(readStateDoc(db, classroomId, studentUid), { readEventIds: arrayUnion(...eventIds) }, { merge: true });
}

/** Live-subscribes to this student's own read state. Returns the unsubscribe function directly, matching repositories/firestoreClassroomRepository.js's own subscribeToClassroom() convention. */
export function subscribeToReadState(db, classroomId, studentUid, onChange, onError) {
  return onSnapshot(
    readStateDoc(db, classroomId, studentUid),
    (snapshot) => onChange(snapshot.exists() ? snapshot.data() : EMPTY_READ_STATE),
    (error) => onError?.(error)
  );
}
