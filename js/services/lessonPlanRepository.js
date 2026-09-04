/**
 * services/lessonPlanRepository.js
 *
 * Isolates Firestore access for LessonPlans — its own domain, not
 * folded into services/plannerRepository.js's Lessons (a scheduled
 * occurrence) or services/resourceRepository.js's Resources (a
 * reusable library asset). See models/LessonPlan.js's own header
 * comment for why a LessonPlan is neither of those.
 *
 * LessonPlans live in their own subcollection,
 * `classrooms/{classroomId}/lessonPlans/{lessonPlanId}` — the same
 * storage pattern plannerRepository.js/resourceRepository.js already
 * established, and for the same reasons: a growing library of lesson
 * plans (each with real, possibly long text content and a review
 * history) is exactly the unbounded growth the classroom document
 * shouldn't have to absorb, and a single plan's edit/status change
 * becomes one small document write rather than rewriting a whole
 * array. Scoping under `classrooms/{classroomId}` keeps the same
 * "membership of this classroom document controls access" security-
 * rule shape already used everywhere else in this app.
 *
 * A plain module, not a class — same reasoning as
 * plannerRepository.js's own header comment: this app only uses the
 * class/abstract-contract pattern when multiple storage providers
 * genuinely need to be swappable. LessonPlan has exactly one
 * implementation and one caller (services/lessonPlanService.js /
 * services/lessonPlanReviewService.js).
 *
 * Deliberately calls getFirestore(), not initializeFirestore() — see
 * plannerRepository.js's own comment for why; the same reasoning
 * applies verbatim here.
 */

import { getFirestore, collection, doc, getDoc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from './firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function lessonPlansCollectionRef(classroomId) {
  return collection(getDb(), 'classrooms', classroomId, 'lessonPlans');
}

/** Persists one LessonPlan (create or update) — a single small write, not a rewrite of every plan in the classroom. */
export async function saveLessonPlan(classroomId, lessonPlan) {
  const ref = doc(lessonPlansCollectionRef(classroomId), lessonPlan.id);
  await setDoc(ref, { ...lessonPlan });
  return lessonPlan;
}

/** One LessonPlan by its own id, or null. */
export async function getLessonPlanById(classroomId, lessonPlanId) {
  const snapshot = await getDoc(doc(lessonPlansCollectionRef(classroomId), lessonPlanId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/**
 * Every LessonPlan in one classroom, in one query — plain one-time
 * fetch, not a live listener, matching resourceRepository.js's own
 * "simple and explicit over cached and synchronized" convention for
 * exactly the same scale reasoning (a classroom's lesson-plan library
 * is realistically dozens of documents, not a case that needs
 * streaming updates on every read). Callers (the lesson-plans list
 * view, the reviewer queue) filter this same full list by `status`/
 * `createdByUid` themselves — no separate query per filter.
 */
export async function getLessonPlansForClassroom(classroomId) {
  const snapshot = await getDocs(lessonPlansCollectionRef(classroomId));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes a LessonPlan document — a teacher's own explicit "Delete draft" action, never a side effect of any status transition. */
export async function deleteLessonPlan(classroomId, lessonPlanId) {
  await deleteDoc(doc(lessonPlansCollectionRef(classroomId), lessonPlanId));
}
