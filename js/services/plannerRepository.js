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

import { getFirestore, collection, doc, getDoc, setDoc, getDocs, query, where, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
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

/** The Lesson attached to one concrete Teaching Slot (see services/timetableService.js's buildTeachingSlotId()), or null if that period has no lesson plan attached yet. Used by the Timetable UI to decide "attach a new lesson plan" vs. "open the existing one." */
export async function getLessonByTeachingSlotId(classroomId, teachingSlotId) {
  const lessonsQuery = query(lessonsCollectionRef(classroomId), where('teachingSlotId', '==', teachingSlotId));
  const snapshot = await getDocs(lessonsQuery);
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

/**
 * One Lesson by its own id, directly — what
 * services/studentPortalDataService.js's getConceptFeedbackForLesson()
 * uses to resolve a StudentEvent's own lessonId pointer into the
 * current, live executedConceptIds every time a student opens the
 * Concept Feedback flow (never a snapshot carried in the event's own
 * payload — see config/studentEventNavigation.js's own header comment
 * for why that convention matters here specifically).
 *
 * Optional `firestoreOverride` — Phase N fix: a real student device's
 * DEFAULT app (this file's own getDb()) is NEVER signed in to anything
 * (only its per-slot app is — see studentAuthService.js's own header
 * comment on why a shared default-app Auth instance can't be reused
 * for a student identity). firestore.rules's own lessons/{lessonId}
 * read rule requires request.auth != null, so calling this with no
 * override from student-side code would always fail with
 * PERMISSION_DENIED in production — a genuine, pre-existing Phase M
 * bug, only surfaced now by Phase N's own real-identity-mechanism E2E
 * test (an earlier, simplified test harness happened to sign in
 * anonymously on the default app directly, masking this). Every
 * teacher-side caller is unaffected — they never pass this argument,
 * so getDb() (the default app, where a teacher's own real Google
 * session already lives) is used exactly as before.
 */
export async function getLessonById(classroomId, lessonId, firestoreOverride = null) {
  const activeDb = firestoreOverride || getDb();
  const snapshot = await getDoc(doc(collection(activeDb, 'classrooms', classroomId, 'lessons'), lessonId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Every Lesson whose own `date` falls within [startDateKey, endDateKey] (inclusive) — what the Timetable Week/Day grid fetches in one query per visible range, rather than one query per period. */
export async function getLessonsForDateRange(classroomId, startDateKey, endDateKey) {
  const lessonsQuery = query(lessonsCollectionRef(classroomId), where('date', '>=', startDateKey), where('date', '<=', endDateKey));
  const snapshot = await getDocs(lessonsQuery);
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}
