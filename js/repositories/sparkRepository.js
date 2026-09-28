/**
 * repositories/sparkRepository.js
 *
 * Isolates Firestore access for Sparks (see models/Spark.js) — a
 * DELIBERATELY SEPARATE, TOP-LEVEL `sparks/{sparkId}` collection, never
 * a subcollection of `classrooms`, for the same "must be discoverable
 * across every classroom, not just its author's own" reasoning
 * repositories/weeklyPlanReviewIndexRepository.js's own header comment
 * already documents for that collection. Precedent for a top-level
 * collection already exists in this app (`teachingIdeas`,
 * `weeklyPlanReviewIndex`, `joinCodes`, `users`).
 *
 * A plain module, not a class — same reasoning as every other
 * repository in this app.
 *
 * Phase 1 scope: the minimum CRUD + ONE discovery query
 * (`getSparksForLinkedCurriculumUnitId`, keyed off the cross-classroom
 * chapter identity — see models/Spark.js's own header comment on why
 * that field, not `curriculumUnitIds`, is the one worth an indexed
 * query today) that later phases' "Browse Sparks" UI would build on.
 * Subject/grade/type/text filtering is left to the service layer
 * (services/sparkService.js's own filterSparks()), composed client-side
 * over whichever query already narrows the result set the most — no
 * composite-index query methods for a filter combination no caller
 * exists to use.
 *
 * Phase 3 addition: `getSparksBySubjectId()` — a second, still-narrow
 * query, needed because a ChapterPlan's `linkedCurriculumUnitId` is
 * genuinely, honestly sometimes null (see models/ChapterPlan.js's own
 * header comment) — with no cross-classroom chapter identity to query
 * by, ui/components/SparkBrowser.js's own discovery priority list
 * ("1. linkedCurriculumUnitId, ... 3. subject") needs a real fallback
 * query, not silently zero results. Still one indexed field, still no
 * generalized search — the same shape as the query above, just a
 * different field.
 */

import { getFirestore, collection, doc, getDoc, setDoc, deleteDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function sparksCollectionRef() {
  return collection(getDb(), 'sparks');
}

/** Persists one Spark (create or update) — a single small write. */
export async function saveSpark(spark) {
  const ref = doc(sparksCollectionRef(), spark.id);
  await setDoc(ref, { ...spark });
  return spark;
}

/** One Spark by its own id, or null. */
export async function getSparkById(sparkId) {
  const snapshot = await getDoc(doc(sparksCollectionRef(), sparkId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/**
 * Every Spark tagged with this exact cross-classroom chapter identity
 * — the query "Browse Sparks relevant to the current chapter" (a later
 * phase's own UI) will actually run. Deliberately not offered for a
 * `null` `linkedCurriculumUnitId` (a Firestore `==null` query would
 * return every generically-authored Spark at once, unbounded, which no
 * caller needs yet).
 */
export async function getSparksForLinkedCurriculumUnitId(linkedCurriculumUnitId) {
  if (!linkedCurriculumUnitId) return [];
  const snapshot = await getDocs(query(sparksCollectionRef(), where('linkedCurriculumUnitId', '==', linkedCurriculumUnitId)));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/**
 * Every Spark tagged with this subject — the fallback discovery query
 * for a chapter with no `linkedCurriculumUnitId` to key off of (see
 * this file's own header comment). `subjectIds` is an array field on
 * Spark (see models/Spark.js) — `array-contains` is the one Firestore
 * operator that can query it without a composite index.
 */
export async function getSparksBySubjectId(subjectId) {
  if (!subjectId) return [];
  const snapshot = await getDocs(query(sparksCollectionRef(), where('subjectIds', 'array-contains', subjectId)));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes a Spark document — its own creator's explicit action only (enforced by firestore.rules, not here). */
export async function deleteSpark(sparkId) {
  await deleteDoc(doc(sparksCollectionRef(), sparkId));
}
