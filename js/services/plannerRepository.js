/**
 * services/plannerRepository.js
 *
 * Isolates Firestore access for the Planner domain — named
 * `plannerRepository`, not `plannerLessonRepository`, so it can own
 * persistence for the whole domain as it grows, not just Lessons.
 * Today that's just Lessons: PlanningCycles live directly on the
 * classroom document (see models/Classroom.js's own `planner` field)
 * and are persisted the ordinary way, via
 * services/workspaceService.js's save() — no Firestore code needed
 * for those here at all.
 *
 * Lessons live in their own subcollection,
 * `classrooms/{classroomId}/lessons/{lessonId}`, rather than as a
 * field on the classroom document or a top-level collection. Storage
 * trade-off, decided deliberately: a multi-year history of daily
 * lessons across several periods a week is real, unbounded growth an
 * already-substantial classroom document shouldn't have to absorb,
 * and per-lesson status updates (marking one lesson taught) become a
 * single small document write instead of rewriting a whole array.
 * Scoping it under `classrooms/{classroomId}` rather than a top-level
 * `lessons` collection keeps the same "membership of this classroom
 * document controls access" security-rule shape already used
 * elsewhere in this app, rather than introducing a parallel one.
 *
 * A plain module, not a class — this app only uses the
 * class/abstract-contract pattern (see
 * repositories/classroomRepository.js /
 * repositories/firestoreClassroomRepository.js) when multiple storage
 * providers genuinely need to be swappable. Planner has exactly one
 * implementation and one caller (services/plannerService.js); a plain
 * module matches services/curriculumIndexRepository.js's own
 * precedent for a single-provider repository more closely than it
 * matches Classroom's multi-provider case.
 *
 * Deliberately calls getFirestore(), not initializeFirestore(): the
 * app's Firestore instance is already initialized once, with its
 * offline-persistence settings, by
 * repositories/firestoreClassroomRepository.js the first time a
 * classroom loads — calling initializeFirestore() a second time for
 * the same app throws. getFirestore() retrieves whatever instance
 * already exists (this app always loads a classroom before a teacher
 * could reach anything Planner-related, so that instance is already
 * set up correctly by the time this file's functions are ever called)
 * rather than configuring a second, conflicting one.
 */

import { getFirestore, collection, doc, setDoc, getDocs, query, where, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from './firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function lessonsCollectionRef(classroomId) {
  return collection(getDb(), 'classrooms', classroomId, 'lessons');
}

/** Persists a whole batch of newly-generated Lessons in one atomic write — what services/plannerService.js's generateAndSaveLessons() calls right after the engine produces them. */
export async function saveLessons(classroomId, lessons) {
  const batch = writeBatch(getDb());
  const collRef = lessonsCollectionRef(classroomId);

  for (const lesson of lessons) {
    const ref = doc(collRef, lesson.id);
    batch.set(ref, { ...lesson });
  }

  await batch.commit();
  return lessons;
}

/** Persists one already-existing Lesson — a single small write, e.g. after a status change, not a rewrite of every lesson in the cycle. */
export async function saveLesson(classroomId, lesson) {
  const ref = doc(lessonsCollectionRef(classroomId), lesson.id);
  await setDoc(ref, { ...lesson });
  return lesson;
}

/** Every Lesson belonging to one Planning Cycle, for this classroom. */
export async function getLessonsForCycle(classroomId, planningCycleId) {
  const lessonsQuery = query(lessonsCollectionRef(classroomId), where('planningCycleId', '==', planningCycleId));
  const snapshot = await getDocs(lessonsQuery);
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}
