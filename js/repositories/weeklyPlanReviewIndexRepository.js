/**
 * repositories/weeklyPlanReviewIndexRepository.js
 *
 * Isolates Firestore access for the Weekly Plan Review Index — a
 * deliberately separate, TOP-LEVEL `weeklyPlanReviewIndex/{lessonPlanId}`
 * collection, never a subcollection under `classrooms/{classroomId}`
 * (mirrors repositories/teachingIdeasRepository.js's own header comment
 * for why: a classroom-scoped path can't express "discoverable by a
 * Program Manager across every classroom they belong to" without either
 * scanning every classroom the app has no permission to list, or
 * fetching every LessonPlan in every one of the PM's own classrooms just
 * to filter client-side). Precedent for a top-level collection already
 * exists in this app: `teachingIdeas/{lessonPlanId}`, `joinCodes/{code}`,
 * `users/{uid}` — this isn't a new kind of thing for this codebase.
 *
 * Unlike Teaching Ideas (create-only, immutable once published), this
 * index is genuinely mutable — `upsertReviewIndexEntry()` is a create-
 * or-update, called every time a LessonPlan's review lifecycle
 * transitions (submit, request changes, approve — see
 * services/weeklyPlanReviewIndexService.js and this repo's own
 * firestore.rules block for this collection). The document id is always
 * the source LessonPlan's own id — one plan, one index entry, updated
 * in place, never a new document per review round.
 *
 * A plain module, not a class — same reasoning as
 * lessonPlanRepository.js's own header comment.
 */

import { getFirestore, collection, doc, setDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function weeklyPlanReviewIndexCollectionRef() {
  return collection(getDb(), 'weeklyPlanReviewIndex');
}

/** Creates or overwrites the one index entry for `entry.lessonPlanId` — never a new document per review round (see this file's own header comment). */
export async function upsertReviewIndexEntry(entry) {
  const ref = doc(weeklyPlanReviewIndexCollectionRef(), entry.lessonPlanId);
  await setDoc(ref, { ...entry });
  return entry;
}

/**
 * Every review-index entry belonging to any of `classroomIds` — the one
 * query a Program Manager's Weekly Plans queue needs
 * (ui/views/ProgramManagerWeeklyPlansView.js), given the list of
 * classrooms they're already a real member of. Firestore's own `in`
 * operator is capped at 30 values per query, so `classroomIds` is
 * chunked here rather than silently truncating a PM authorized across
 * more classrooms than that — unlikely at today's scale, but not
 * assumed away.
 */
export async function getReviewIndexEntriesForClassroomIds(classroomIds) {
  if (!classroomIds || classroomIds.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < classroomIds.length; i += 30) {
    chunks.push(classroomIds.slice(i, i + 30));
  }

  const chunkedResults = await Promise.all(
    chunks.map(async (chunk) => {
      const q = query(weeklyPlanReviewIndexCollectionRef(), where('classroomId', 'in', chunk));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
    })
  );

  return chunkedResults.flat();
}
