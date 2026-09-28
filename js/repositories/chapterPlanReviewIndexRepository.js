/**
 * repositories/chapterPlanReviewIndexRepository.js
 *
 * Isolates Firestore access for the Chapter Plan Review Index — a
 * DELIBERATELY SEPARATE, TOP-LEVEL `chapterPlanReviewIndex/{chapterPlanId}`
 * collection, never a subcollection of `classrooms`. Mirrors
 * repositories/weeklyPlanReviewIndexRepository.js's own shape and
 * reasoning exactly: a classroom-scoped path can't express
 * "discoverable by a Program Manager across every classroom they
 * belong to" without either scanning classrooms this app has no
 * permission to `list`, or fetching every ChapterPlan in every one of
 * the PM's own classrooms just to filter client-side.
 *
 * Like weeklyPlanReviewIndex (and unlike the create-only, immutable
 * `teachingIdeas`), this index is genuinely mutable — one entry per
 * source ChapterPlan, upserted every time that plan's review lifecycle
 * transitions. The document id is always the source ChapterPlan's own
 * id — one plan, one index entry, updated in place, never a new
 * document per review round.
 *
 * This is FOUNDATION ONLY (Phase 1): the repository + its Firestore
 * rule (see firestore.rules' own `chapterPlanReviewIndex` block) exist
 * so later phases can build the actual PM queue on top of them. Building
 * the entry itself (a future buildChapterPlanReviewIndexEntry(),
 * mirroring services/weeklyPlanReviewIndexService.js's own
 * buildReviewIndexEntry()) is explicitly deferred to the phase that
 * builds services/chapterPlanReviewService.js, since it needs that
 * service's own getSubmissionLabel()-equivalent to compute
 * `submissionLabel` — not duplicated here ahead of that.
 *
 * A plain module, not a class — same reasoning as every other
 * repository in this app.
 */

import { getFirestore, collection, doc, setDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function chapterPlanReviewIndexCollectionRef() {
  return collection(getDb(), 'chapterPlanReviewIndex');
}

/** Creates or overwrites the one index entry for `entry.chapterPlanId` — never a new document per review round (see this file's own header comment). */
export async function upsertChapterPlanReviewIndexEntry(entry) {
  const ref = doc(chapterPlanReviewIndexCollectionRef(), entry.chapterPlanId);
  await setDoc(ref, { ...entry });
  return entry;
}

/**
 * Every review-index entry belonging to any of `classroomIds` — the
 * one query a Program Manager's future Chapter Plans queue will need,
 * given the list of classrooms they're already a real member of.
 * Chunked at 30 per Firestore's own `in`-operator cap, same as
 * repositories/weeklyPlanReviewIndexRepository.js's own
 * getReviewIndexEntriesForClassroomIds().
 */
export async function getChapterPlanReviewIndexEntriesForClassroomIds(classroomIds) {
  if (!classroomIds || classroomIds.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < classroomIds.length; i += 30) {
    chunks.push(classroomIds.slice(i, i + 30));
  }

  const chunkedResults = await Promise.all(
    chunks.map(async (chunk) => {
      const q = query(chapterPlanReviewIndexCollectionRef(), where('classroomId', 'in', chunk));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
    })
  );

  return chunkedResults.flat();
}
