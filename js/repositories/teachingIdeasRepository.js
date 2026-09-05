/**
 * repositories/teachingIdeasRepository.js
 *
 * Isolates Firestore access for Teaching Ideas — a deliberately
 * separate, TOP-LEVEL `teachingIdeas/{lessonPlanId}` collection, never
 * a subcollection under `classrooms/{classroomId}` (see
 * services/lessonPlanRepository.js's own header comment for why
 * LessonPlan itself lives there). Teaching Ideas is a derived,
 * read-only-to-normal-users projection of an APPROVED LessonPlan —
 * globally discoverable across classrooms by explicit Phase 4 product
 * direction — and a classroom-scoped path can't express "readable by
 * any authenticated ClassMate user regardless of which classroom they
 * belong to" without either scanning every classroom or exposing the
 * classroom-scoped `lessonPlans` collection itself more broadly.
 * Precedent for a top-level (non-classroom) collection already exists
 * in this app: `joinCodes/{code}` and `users/{uid}` (see
 * firestore.rules) — this isn't a new kind of thing for this codebase,
 * just a new instance of an existing kind.
 *
 * The document id is deliberately the SAME as its source LessonPlan's
 * own id (never a fresh random id) — one approved LessonPlan produces
 * at most one Teaching Idea projection, and reusing the id makes that
 * 1:1 relationship structurally obvious rather than needing a separate
 * `sourceLessonPlanId` lookup just to find it.
 *
 * `publish()` is a create-only operation from this file's own
 * perspective — it always calls setDoc on a doc keyed by the source
 * plan's id, which Firestore treats as a create the first time and
 * would treat as an overwrite on a second call. The firestore.rules
 * block for this collection is what actually prevents a second,
 * different write from ever landing (`allow update: if false`) — see
 * that rule's own header comment for the full reasoning. This file
 * itself has no opinion on that; it only isolates the Firestore calls,
 * same as every other *Repository.js in this app.
 *
 * A plain module, not a class — same reasoning as
 * lessonPlanRepository.js's own header comment.
 */

import { getFirestore, collection, doc, getDoc, setDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function teachingIdeasCollectionRef() {
  return collection(getDb(), 'teachingIdeas');
}

/** Publishes (creates) the Teaching Idea projection for one approved LessonPlan — see this file's own header comment on why this is a create, never an update, from the app's own perspective. */
export async function publishTeachingIdea(teachingIdea) {
  const ref = doc(teachingIdeasCollectionRef(), teachingIdea.sourceLessonPlanId);
  await setDoc(ref, { ...teachingIdea });
  return teachingIdea;
}

/** One Teaching Idea by its own (== source LessonPlan's) id, or null. */
export async function getTeachingIdeaById(lessonPlanId) {
  const snapshot = await getDoc(doc(teachingIdeasCollectionRef(), lessonPlanId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/**
 * Every Teaching Idea whose `conceptIds` includes the given concept —
 * a real, server-side Firestore query (`array-contains`), not a
 * fetch-everything-then-filter — so this stays bounded and fast
 * regardless of how many Teaching Ideas exist globally across every
 * classroom in ClassMate. This is the ONE query this repository
 * exposes for discovery; per Phase 4's own explicit "Concept is the
 * main contextual join point" direction, every real discovery entry
 * point (Concept Workspace, the Builder's own current-lesson context)
 * already has a concept to scope by before it ever needs to list
 * anything — there is no supported "list every Teaching Idea in
 * ClassMate with no concept filter" call.
 */
export async function getTeachingIdeasForConcept(conceptId) {
  const q = query(teachingIdeasCollectionRef(), where('conceptIds', 'array-contains', conceptId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}
