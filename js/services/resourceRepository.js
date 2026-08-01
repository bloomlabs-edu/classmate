/**
 * services/resourceRepository.js
 *
 * Isolates Firestore access for Resources — Learning Hub's own domain,
 * genuinely independent of Curriculum (see models/Resource.js,
 * models/ConceptResourceLink.js, docs/UNIFIED_PLATFORM_ARCHITECTURE.md
 * for the full domain-boundary reasoning). A Resource is valid and
 * fully usable even if no Concept links to it.
 *
 * Resources live in their own subcollection,
 * `classrooms/{classroomId}/resources/{resourceId}`, the same storage
 * pattern services/plannerRepository.js already established for
 * Lessons, and for the same reasons: a growing library of reusable
 * teaching resources (with real content — a Reading's blocks, a future
 * Worksheet's own shape) is exactly the kind of unbounded growth the
 * single classroom document shouldn't have to absorb, and per-resource
 * edits (renaming one resource, editing its content) become a single
 * small document write instead of rewriting a whole array. Scoping it
 * under `classrooms/{classroomId}` rather than a top-level `resources`
 * collection keeps the same "membership of this classroom document
 * controls access" security-rule shape already used everywhere else in
 * this app, rather than introducing a parallel one — see that file's
 * own comment for the same reasoning applied to Lessons.
 *
 * Deliberately no live listener/cache here — per explicit product
 * decision, Resource access is a plain async fetch
 * (getResourcesForClassroom below), the same one-time-query shape
 * plannerRepository.js's own getLessonsForCycle() already uses, not a
 * long-lived subscription kept in sync somewhere else. Learning Hub
 * concerns stay inside Learning Hub's own files; nothing here asks
 * services/workspaceService.js to know Resources exist at all.
 *
 * A plain module, not a class — same reasoning as
 * plannerRepository.js's own header comment: this app only uses the
 * class/abstract-contract pattern when multiple storage providers
 * genuinely need to be swappable (see
 * repositories/firestoreClassroomRepository.js). Resource has exactly
 * one implementation and one caller (services/resourceService.js).
 *
 * Deliberately calls getFirestore(), not initializeFirestore() — see
 * plannerRepository.js's own comment for why; the same reasoning
 * applies verbatim here.
 */

import { getFirestore, collection, doc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from './firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function resourcesCollectionRef(classroomId) {
  return collection(getDb(), 'classrooms', classroomId, 'resources');
}

/** Persists one Resource (create or update) — a single small write, not a rewrite of every resource in the classroom. */
export async function saveResource(classroomId, resource) {
  const ref = doc(resourcesCollectionRef(classroomId), resource.id);
  await setDoc(ref, { ...resource });
  return resource;
}

/** Permanently removes a Resource document — a Learning Hub operation (see models/Resource.js's own independent-lifecycle reasoning), never triggered as a side effect of unlinking it from a Concept. */
export async function deleteResourceDoc(classroomId, resourceId) {
  const ref = doc(resourcesCollectionRef(classroomId), resourceId);
  await deleteDoc(ref);
}

/**
 * Every Resource belonging to one classroom, in one query. Not scoped
 * to a single Concept — Resources have no concept of "belonging" to
 * one (see models/Resource.js) — callers (services/resourceService.js)
 * resolve a specific Concept's linked subset from this full list
 * themselves. A plain one-time fetch, not a live listener: simple and
 * explicit over cached and synchronized, per explicit product
 * direction, and consistent with this app's own established
 * philosophy of not building infrastructure for a scale problem it
 * doesn't have yet — a classroom's resource library is realistically
 * a few dozen items at most, not a case that needs streaming updates
 * on every read.
 */
export async function getResourcesForClassroom(classroomId) {
  const snapshot = await getDocs(resourcesCollectionRef(classroomId));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

