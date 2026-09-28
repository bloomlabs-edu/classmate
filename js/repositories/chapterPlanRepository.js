/**
 * repositories/chapterPlanRepository.js
 *
 * Isolates Firestore access for ChapterPlans — its own domain, not
 * folded into repositories/... for LessonPlans, Lessons, or Resources
 * (see models/ChapterPlan.js's own header comment for why a Chapter
 * Plan is none of those). Same storage pattern
 * services/lessonPlanRepository.js already established for LessonPlans
 * — `classrooms/{classroomId}/chapterPlans/{chapterPlanId}` — and for
 * the same reasons: a growing library of chapter plans (each with
 * real, possibly long text content and a review history) is exactly
 * the unbounded growth the classroom document shouldn't have to
 * absorb, and one plan's edit/status change is a single small write,
 * not a rewrite of every plan in the classroom.
 *
 * A plain module, not a class — this app only uses the class/
 * abstract-contract pattern when multiple storage providers genuinely
 * need to be swappable (see lessonPlanRepository.js's own header
 * comment); ChapterPlan has exactly one implementation.
 *
 * Deliberately calls getFirestore(), not initializeFirestore() — same
 * reasoning as every other repository in this app.
 *
 * Only the operations Phase 1's domain foundation actually needs are
 * implemented here (save/get-one/get-all-for-classroom/delete) — no
 * speculative query methods for UI that doesn't exist yet.
 */

import { getFirestore, collection, doc, getDoc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function chapterPlansCollectionRef(classroomId) {
  return collection(getDb(), 'classrooms', classroomId, 'chapterPlans');
}

/** Persists one ChapterPlan (create or update) — a single small write, not a rewrite of every plan in the classroom. */
export async function saveChapterPlan(classroomId, chapterPlan) {
  const ref = doc(chapterPlansCollectionRef(classroomId), chapterPlan.id);
  await setDoc(ref, { ...chapterPlan });
  return chapterPlan;
}

/** One ChapterPlan by its own id, or null. */
export async function getChapterPlanById(classroomId, chapterPlanId) {
  const snapshot = await getDoc(doc(chapterPlansCollectionRef(classroomId), chapterPlanId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/**
 * Every ChapterPlan in one classroom, in one query — plain one-time
 * fetch, not a live listener, matching lessonPlanRepository.js's own
 * "simple and explicit over cached and synchronized" convention.
 * Callers filter this same full list by `status`/`subjectId`/
 * `createdByUid` themselves — no separate query per filter.
 */
export async function getChapterPlansForClassroom(classroomId) {
  const snapshot = await getDocs(chapterPlansCollectionRef(classroomId));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes a ChapterPlan document — a Fellow's own explicit "Delete draft" action, never a side effect of any status transition. */
export async function deleteChapterPlan(classroomId, chapterPlanId) {
  await deleteDoc(doc(chapterPlansCollectionRef(classroomId), chapterPlanId));
}
