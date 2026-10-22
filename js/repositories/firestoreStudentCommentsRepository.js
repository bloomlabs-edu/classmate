/**
 * repositories/firestoreStudentCommentsRepository.js
 *
 * The only file that knows the path shape for
 * classrooms/{classroomId}/studentComments/{commentId} — a dedicated,
 * TEACHER-ONLY collection, never a field anywhere on the classroom
 * document itself. That separation is deliberate and load-bearing: the
 * classroom document at classrooms/{classroomId} is readable with NO
 * authentication at all once a caller has its id (see firestore.rules's
 * own "Student join codes" header comment — this is how a student
 * device joins with no sign-in) — so anything stored inside
 * teams[].students[] would be world-readable the moment a classroom id
 * leaks, which a private teacher comment about a student must never
 * be. This collection has its own, far stricter rule (classroom-member
 * read/write only — see firestore.rules's own block for this
 * collection).
 *
 * Always used from the TEACHER's own default-app Firestore instance —
 * there is no student-facing read or write path for this collection at
 * all, unlike repositories/firestoreStudentGoalsRepository.js's own
 * split between a student's per-slot instance and the teacher's.
 *
 * services/commentService.js is the only caller — see that file's own
 * header comment for the teacher-facing API built on top of this.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

function teacherDb() {
  return getFirestore(getFirebaseApp());
}

function commentsCollection(classroomId) {
  return collection(teacherDb(), 'classrooms', classroomId, 'studentComments');
}

function commentDoc(classroomId, commentId) {
  return doc(teacherDb(), 'classrooms', classroomId, 'studentComments', commentId);
}

/** Creates a new private comment document. `comment` is already a fully-shaped object from models/StudentComment.js's own createStudentComment(). */
export async function createComment(classroomId, comment) {
  await setDoc(commentDoc(classroomId, comment.id), comment);
  return comment;
}

/** Edits an existing comment's own text — never studentId/workItemRef/createdByUid, matching firestore.rules's own update allowlist for this collection. */
export async function updateCommentText(classroomId, commentId, { text, updatedByUid }) {
  await updateDoc(commentDoc(classroomId, commentId), {
    text,
    updatedByUid,
    updatedAt: getCurrentIsoDate(),
  });
}

export async function getCommentById(classroomId, commentId) {
  const snapshot = await getDoc(commentDoc(classroomId, commentId));
  return snapshot.exists() ? snapshot.data() : null;
}

/** Every private comment about one student, within one classroom — teacher-only, newest first. */
export async function listCommentsForStudent(classroomId, studentId) {
  const snapshot = await getDocs(query(commentsCollection(classroomId), where('studentId', '==', studentId)));
  return snapshot.docs.map((d) => d.data()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
