/**
 * repositories/weeklyPlanSubmissionRepository.js
 *
 * Isolates Firestore access for WeeklyPlanSubmission — a deliberately
 * TOP-LEVEL `weeklyPlanSubmissions/{classroomId}_{teacherUid}_{weekStartDate}`
 * collection, same rationale as repositories/weeklyPlanReviewIndexRepository.js's
 * own header comment: a classroom-scoped path can't express "discoverable
 * by a Program Manager across every classroom they belong to" without
 * either scanning classrooms this app has no permission to `list`, or
 * fetching every classroom's own subcollection just to filter
 * client-side. Unlike that index, THIS collection is the canonical
 * source of its own status (see models/WeeklyPlanSubmission.js's own
 * header comment) — there is no separate content-bearing document being
 * mirrored, so no second "faithfulness" rule is needed, only ordinary
 * authorization (see firestore.rules' own `weeklyPlanSubmissions` block).
 *
 * A plain module, not a class — same convention as every other
 * repository in this codebase.
 */

import { getFirestore, collection, doc, getDoc, setDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';
import { buildWeeklyPlanSubmissionId } from '../models/WeeklyPlanSubmission.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function weeklyPlanSubmissionsCollectionRef() {
  return collection(getDb(), 'weeklyPlanSubmissions');
}

/** The one document for this Fellow+Classroom+Week, or `null` if it doesn't exist yet (the Fellow hasn't submitted — see models/WeeklyPlanSubmission.js's own "Not started"/"Draft" derivation, which is exactly why this returns `null` rather than a default-shaped record). */
export async function getSubmission(classroomId, teacherUid, weekStartDate) {
  const id = buildWeeklyPlanSubmissionId(classroomId, teacherUid, weekStartDate);
  const snapshot = await getDoc(doc(weeklyPlanSubmissionsCollectionRef(), id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Creates or overwrites the one submission document for `submission.id` — never a new document per review round, matching this collection's own deterministic-id convention. */
export async function upsertSubmission(submission) {
  const ref = doc(weeklyPlanSubmissionsCollectionRef(), submission.id);
  await setDoc(ref, { ...submission });
  return submission;
}

/**
 * Every WeeklyPlanSubmission belonging to any of `classroomIds`, for
 * exactly `weekStartDate` — the one query a Program Manager's Weekly
 * Plans queue needs, given the list of classrooms they're already a
 * real member of (same source as
 * ui/views/ProgramManagerObservationsView.js's own classroom list).
 * Chunked at 30 per Firestore's own `in` operator cap, same pattern as
 * weeklyPlanReviewIndexRepository.getReviewIndexEntriesForClassroomIds().
 */
export async function getSubmissionsForClassroomIdsAndWeek(classroomIds, weekStartDate) {
  if (!classroomIds || classroomIds.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < classroomIds.length; i += 30) {
    chunks.push(classroomIds.slice(i, i + 30));
  }

  const chunkedResults = await Promise.all(
    chunks.map(async (chunk) => {
      const q = query(
        weeklyPlanSubmissionsCollectionRef(),
        where('classroomId', 'in', chunk),
        where('weekStartDate', '==', weekStartDate)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
    })
  );

  return chunkedResults.flat();
}
