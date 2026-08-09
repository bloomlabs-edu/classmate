/**
 * repositories/firestoreFeedRepository.js
 *
 * classrooms/{classroomId}/feedPosts/{postId} — a dedicated
 * collection, mirroring firestoreStudentGoalsRepository.js's own,
 * already-proven pattern exactly: student-owned writable content
 * lives in its own collection, never nested inside the teacher-owned
 * classroom document, since a student write needs to go through
 * their own per-slot Firestore instance (studentAuthService.js's
 * getFirestoreForSlot()) — the same reason goals moved there.
 *
 * Comments live in a subcollection
 * (classrooms/{classroomId}/feedPosts/{postId}/comments/{commentId})
 * rather than a nested array on the post — the one place this
 * deliberately departs from "nest everything," for a concrete reason:
 * comments are the one part of a post that can grow unboundedly on a
 * popular post, and Firestore's per-document size limit makes an
 * unbounded array the wrong shape here. Reactions stay a small,
 * bounded array directly on the post (reactorUids) — safe at
 * classroom scale (tens of students, not thousands).
 *
 * Media (photo/video/audio upload) is intentionally NOT implemented
 * here — see this project's own Class Feed design history. This app
 * has zero existing Firebase Storage usage anywhere, and introducing
 * it is a genuine infrastructure/security decision, not something to
 * fold into this feature quietly. `media` on a post is modeled
 * (`{ type, status }`) so the UI/data shape is forward-compatible,
 * but nothing here ever writes an actual file.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';
import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

function teacherDb() {
  return getFirestore(getFirebaseApp());
}

function postsCollection(db, classroomId) {
  return collection(db, 'classrooms', classroomId, 'feedPosts');
}

function postDoc(db, classroomId, postId) {
  return doc(db, 'classrooms', classroomId, 'feedPosts', postId);
}

function commentsCollection(db, classroomId, postId) {
  return collection(db, 'classrooms', classroomId, 'feedPosts', postId, 'comments');
}

function commentDoc(db, classroomId, postId, commentId) {
  return doc(db, 'classrooms', classroomId, 'feedPosts', postId, 'comments', commentId);
}

/**
 * Creates a new post, authored by `uid` — the student's own per-slot
 * Firestore instance is passed in by the caller (see
 * feedService.js), same convention as submitGoal().
 *
 * `source` is optional and, when present, is shaped exactly like a
 * StudentEvent's own { type, payload } (see
 * config/studentEventNavigation.js) — reused deliberately, not a new
 * linking mechanism.
 */
export async function createPost(db, { classroomId, studentId, uid, authorName, text, source = null, media = null }) {
  const postId = generateId();
  await setDoc(postDoc(db, classroomId, postId), {
    id: postId,
    classroomId,
    studentId,
    uid,
    authorName,
    text,
    source,
    media,
    createdAt: getCurrentIsoDate(),
    reactorUids: [],
    commentCount: 0,
    removedByTeacher: false,
  });
  return postId;
}

/** Newest-first, matching the explicit "chronological, no ranking" requirement. Any authenticated reader within this classroom — see firestore.rules's own comment on this collection for why. */
export async function listPosts(db, classroomId) {
  const snapshot = await getDocs(query(postsCollection(db, classroomId), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((d) => d.data());
}

/** A student's own reaction toggle — adds or removes exactly their own uid, nothing else on the document. */
export async function toggleReaction(db, classroomId, postId, uid, isReacting) {
  const snapshot = await getDoc(postDoc(db, classroomId, postId));
  const existing = snapshot.exists() ? snapshot.data() : null;
  if (!existing) return;
  const reactorUids = isReacting
    ? [...new Set([...(existing.reactorUids || []), uid])]
    : (existing.reactorUids || []).filter((u) => u !== uid);
  await updateDoc(postDoc(db, classroomId, postId), { reactorUids });
}

/** Author-only or teacher — enforced by firestore.rules, not just this function's own caller. */
export async function deletePost(db, classroomId, postId) {
  await deleteDoc(postDoc(db, classroomId, postId));
}

/** Teacher-side soft removal — kept in Firestore, filtered out of every classmate-facing read, matching the same non-destructive posture already used for rejected/pending goals. Uses the teacher's own default-app instance. */
export async function removePostAsTeacher(classroomId, postId) {
  await updateDoc(postDoc(teacherDb(), classroomId, postId), { removedByTeacher: true });
}

/** Teacher-side media approval. */
export async function setMediaStatus(classroomId, postId, status) {
  await updateDoc(postDoc(teacherDb(), classroomId, postId), { 'media.status': status });
}

export async function addComment(db, classroomId, postId, { studentId, uid, authorName, text }) {
  const commentId = generateId();
  await setDoc(commentDoc(db, classroomId, postId, commentId), {
    id: commentId,
    postId,
    studentId,
    uid,
    authorName,
    text,
    createdAt: getCurrentIsoDate(),
  });
  await updateDoc(postDoc(db, classroomId, postId), { commentCount: await getCommentCount(db, classroomId, postId) });
  return commentId;
}

async function getCommentCount(db, classroomId, postId) {
  const snapshot = await getDocs(commentsCollection(db, classroomId, postId));
  return snapshot.docs.length;
}

/** Oldest-first — a normal reading order for a comment thread, unlike posts themselves. */
export async function listComments(db, classroomId, postId) {
  const snapshot = await getDocs(query(commentsCollection(db, classroomId, postId), orderBy('createdAt', 'asc')));
  return snapshot.docs.map((d) => d.data());
}

/** Author-only or teacher, same as deletePost — enforced by firestore.rules. `db` is whichever Firestore instance the caller passes in (a student's own per-slot instance, or the teacher's default one). */
export async function deleteComment(db, classroomId, postId, commentId) {
  await deleteDoc(commentDoc(db, classroomId, postId, commentId));
  const snapshot = await getDocs(commentsCollection(db, classroomId, postId));
  await updateDoc(postDoc(db, classroomId, postId), { commentCount: snapshot.docs.length });
}

export function teacherFirestore() {
  return teacherDb();
}
