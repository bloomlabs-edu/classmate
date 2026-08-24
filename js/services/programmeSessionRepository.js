/**
 * services/programmeSessionRepository.js
 *
 * Isolates Firestore access for ProgrammeSession history — mirrors
 * services/plannerRepository.js exactly, for exactly the same reason
 * stated there: ProgrammeSessions live in their own subcollection,
 * `classrooms/{classroomId}/programmeSessions/{sessionId}`, rather
 * than as a field on the classroom document, because a multi-year
 * history of daily programme occurrences is real, unbounded growth an
 * already-substantial classroom document shouldn't have to absorb,
 * and a single session update shouldn't require rewriting a whole
 * array. Scoping it under `classrooms/{classroomId}` — a direct
 * child, not doubly nested under a `learningProgrammes/{programmeId}`
 * path — keeps the same "membership of this classroom document
 * controls access" security-rule shape every other subcollection in
 * this app already uses (see firestore.rules), rather than
 * introducing a parallel one. A session's own `programmeId` field
 * plays the same role `Lesson.planningCycleId` already plays for
 * Planner: the thing a query filters by, not a path segment.
 *
 * A plain module, not a class — Learning Programmes has exactly one
 * storage implementation and one caller
 * (services/programmeSessionService.js), matching
 * services/plannerRepository.js's own precedent for a
 * single-provider repository (see that file's own header comment for
 * when this app DOES use the class/abstract-contract pattern instead).
 *
 * Deliberately calls getFirestore(), not initializeFirestore() — the
 * app's Firestore instance is already initialized once, with its
 * offline-persistence settings, by
 * repositories/firestoreClassroomRepository.js the first time a
 * classroom loads; calling initializeFirestore() a second time for
 * the same app throws. This app always loads a classroom before a
 * teacher could reach anything Learning-Programme-related, so that
 * instance already exists by the time this file's functions are ever
 * called.
 *
 * SANDBOX/TESTING NOTE: this file's imports (the
 * https://www.gstatic.com/... Firebase SDK URL imports) cannot be
 * loaded in a plain Node test run — Node's default ESM loader only
 * supports `file:`/`data:`/`node:` specifiers, not `https:`, and this
 * sandbox has no live Firestore project or Firebase CLI to test
 * against regardless (the same limitation already documented
 * elsewhere in this project's history). This file is therefore
 * exercised by manual review here, not by an automated test in this
 * phase — see the accompanying implementation report's own Testing
 * section for exactly what was and wasn't runnable in this
 * environment.
 */

import { getFirestore, collection, doc, setDoc, updateDoc, getDoc, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from './firebaseApp.js';

let db = null;

/**
 * PHASE 3 — exported so services/programmeSessionService.js's own
 * teacher-context calls (saveAttendancePatch()'s StudentEntry mirror,
 * saveGoalPatch()'s StudentEntry write for a usesStudentEntries
 * session) can pass the SAME Firestore instance this file already
 * uses into repositories/firestoreStudentEntryRepository.js's own
 * batch/merge functions — a writeBatch() must be created from one
 * specific db instance, and both halves of that batch (the
 * ProgrammeSession update and the StudentEntry mirror) need to be the
 * same instance. Never called by student-context code, which always
 * resolves its own, different (per-slot) instance instead — see
 * services/studentAuthService.js's own getFirestoreForSlot().
 */
export function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function programmeSessionsCollectionRef(classroomId) {
  return collection(getDb(), 'classrooms', classroomId, 'programmeSessions');
}

function programmeSessionDocRef(classroomId, sessionId) {
  return doc(programmeSessionsCollectionRef(classroomId), sessionId);
}

/** Persists a newly-created ProgrammeSession — a single small write, matching services/plannerRepository.js's own saveLesson(). */
export async function createSession(classroomId, session) {
  await setDoc(programmeSessionDocRef(classroomId, session.id), { ...session });
  return session;
}

/**
 * Persists a partial update to an already-existing session (e.g.
 * recording attendance, adding a goal, adding a teacher observation
 * as the session progresses) — an `updateDoc()`, not a full
 * `setDoc()`, so a concurrent, unrelated field write from another
 * teacher's own device isn't clobbered. `patch` is whatever subset of
 * fields actually changed; the caller
 * (services/programmeSessionService.js) is responsible for computing
 * it, this function stays "dumb," matching
 * repositories/firestoreStudentGoalsRepository.js's own updateCompletion()
 * convention.
 */
export async function updateSession(classroomId, sessionId, patch) {
  await updateDoc(programmeSessionDocRef(classroomId, sessionId), patch);
}

/** One ProgrammeSession by its own id, or `null` if it doesn't exist. */
export async function getSessionById(classroomId, sessionId) {
  const snapshot = await getDoc(programmeSessionDocRef(classroomId, sessionId));
  return snapshot.exists() ? snapshot.data() : null;
}

/** Every ProgrammeSession belonging to one Learning Programme, most recent date first — mirrors services/plannerRepository.js's own getLessonsForCycle(). */
export async function listSessionsForProgramme(classroomId, programmeId) {
  const sessionsQuery = query(
    programmeSessionsCollectionRef(classroomId),
    where('programmeId', '==', programmeId),
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(sessionsQuery);
  return snapshot.docs.map((docSnapshot) => docSnapshot.data());
}

/**
 * Every ProgrammeSession for one programme within an inclusive date
 * range (`"YYYY-MM-DD"` strings) — a later phase's own progress
 * derivation is the anticipated caller (see this project's own
 * Learning Programmes Audit Report §9), not built in Phase 1; this
 * function exists now purely as a repository-level building block,
 * matching the same "correct, ready-made logic exists so a future
 * caller doesn't have to invent its own" precedent
 * services/plannerService.js's own recordLessonStatusChange() already
 * sets for this app.
 */
export async function listSessionsForProgrammeInRange(classroomId, programmeId, { start, end }) {
  const sessionsQuery = query(
    programmeSessionsCollectionRef(classroomId),
    where('programmeId', '==', programmeId),
    where('date', '>=', start),
    where('date', '<=', end),
    orderBy('date', 'asc')
  );
  const snapshot = await getDocs(sessionsQuery);
  return snapshot.docs.map((docSnapshot) => docSnapshot.data());
}
