/**
 * repositories/firestoreStudentConceptRecordsRepository.js
 *
 * The only file that knows the path shape for
 * classrooms/{classroomId}/studentConceptRecords/{recordId} — a
 * dedicated collection for the per-student half of Learning Record
 * (see models/StudentConceptRecord.js), migrated out of
 * classrooms/{id}'s own teams[].students[].learningRecord map per the
 * Phase N architecture decision: student-owned writable data lives in
 * its own collection, never nested inside the teacher-owned classroom
 * document — the exact same reasoning already applied to
 * firestoreStudentGoalsRepository.js, mirrored here.
 *
 * recordId is DETERMINISTIC — `${uid}_${conceptId}`, keyed on the
 * WRITER'S OWN real Firebase Auth uid, deliberately NOT
 * `${studentId}_${conceptId}` (an earlier draft of this file used that
 * instead — caught and fixed before shipping, see below). `studentId`
 * is still stored as an ordinary field for the teacher side to
 * correlate a record back to a real roster student (see
 * services/conceptRecordMerge.js), but it is never part of the
 * document's own physical id or of any security check.
 *
 * WHY NOT key on studentId: this app has no cryptographic proof that a
 * given anonymous uid genuinely belongs to a given studentId (see
 * firestore.rules's own studentGoals comment — that link was built,
 * then rolled back). studentId is client-supplied and trusted at face
 * value, same as studentGoals/feedPosts already accept. If the
 * document id were `${studentId}_${conceptId}`, that id would be fully
 * predictable in advance by ANY authenticated device (roster student
 * ids and concept ids are both readable) — a hostile device could
 * pre-create every real student's own record for every concept, each
 * time stamping ITS OWN uid onto it. Because Firestore evaluates any
 * write to an already-existing id as `update` (never `create`,
 * regardless of client method), and update requires
 * request.auth.uid == resource.data.uid, this would PERMANENTLY lock
 * every real student out of ever creating their own genuine record for
 * whatever concepts got squatted first — a real device-vs-device
 * denial-of-service, not merely bad data. Keying on uid instead closes
 * this off structurally: a hostile or buggy write can only ever
 * pre-empt itself (its own future writes under its own uid), never
 * another real device's, since request.resource.data.uid ==
 * request.auth.uid is enforced on every create.
 *
 * The tradeoff, openly noted: if the same real student is ever
 * approved on two different devices (studentDeviceService.js's own
 * trusted-device model allows this — e.g. siblings sharing a home
 * phone and a school tablet), their understanding fragments into two
 * separate records, one per device's own uid, rather than one unified
 * one. This is not a new gap this file introduces — it's the exact
 * same property firestoreStudentGoalsRepository.js's own
 * listGoalsForStudent() already has today (its own query already
 * filters by uid alongside studentId, so a goal submitted from a
 * different device's uid was already invisible to another device's own
 * read, before this file ever existed).
 *
 * Every write here (create or update) goes through the STUDENT's own
 * per-slot Firestore instance (studentAuthService.js's own
 * getFirestoreForSlot()) — this is what makes request.auth.uid on the
 * wire genuinely that student's own linked identity, for
 * firestore.rules to check against. There is deliberately no
 * teacher-write path in this file at all: setNotebookStatus()/
 * resolveHelpRequest() (services/learningRecordTeacherService.js) have
 * zero real callers anywhere in the app today (confirmed directly), so
 * per explicit Phase N product decision, no teacher write permission or
 * repository function is built for them ahead of a UI that doesn't
 * exist yet — only real, live behavior gets a persistence path. The
 * teacher's own reads (listRecordsForConcepts, listRecordsForClassroom)
 * use the teacher's own default-app Firestore instance, authorized via
 * memberUids exactly like every other teacher-side read in this app.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

function teacherDb() {
  return getFirestore(getFirebaseApp());
}

function recordsCollection(db, classroomId) {
  return collection(db, 'classrooms', classroomId, 'studentConceptRecords');
}

/** The one, deterministic id for a given device's own record on a given concept — keyed on uid, not studentId; see this file's own header comment on why. */
export function buildRecordId(uid, conceptId) {
  return `${uid}_${conceptId}`;
}

function recordDoc(db, classroomId, uid, conceptId) {
  return doc(db, 'classrooms', classroomId, 'studentConceptRecords', buildRecordId(uid, conceptId));
}

/**
 * Creates this device's own record for one concept for the very first
 * time — called from the student's own per-slot Firestore instance.
 * `db` and `uid` are passed in explicitly, never resolved here,
 * matching firestoreStudentGoalsRepository.js's own convention (which
 * slot's instance to use is a caller concern). notebook/helpRequested
 * are always models/StudentConceptRecord.js's own createStudentConceptRecord()
 * defaults here — matching firestore.rules's own create rule exactly
 * — since a student is never allowed to set either field themselves.
 *
 * Callers must check getRecord() first and call this only when no
 * record exists yet — see updateUnderstanding() below for the
 * already-exists path. Split into two functions (create via setDoc,
 * update via updateDoc) rather than one always-setDoc upsert
 * specifically so update's Firestore-rules check
 * (diff().affectedKeys().hasOnly([...])) only ever has to reason about
 * the fields actually sent in an update payload, not about whether an
 * unrelated field's re-sent value happens to be unchanged — mirrors
 * firestoreStudentGoalsRepository.js's own updateCompletion(), a
 * genuinely partial write, not submitGoal()'s own always-setDoc shape.
 */
export async function createRecord(db, { classroomId, studentId, conceptId, uid, understanding, notebook, helpRequested, updatedAt }) {
  await setDoc(recordDoc(db, classroomId, uid, conceptId), {
    classroomId,
    studentId,
    conceptId,
    uid,
    understanding,
    notebook,
    helpRequested,
    updatedAt,
  });
}

/**
 * Updates only the fields a student is actually allowed to control on
 * an ALREADY-EXISTING record — a genuinely partial write (updateDoc,
 * not setDoc), so it only ever touches understanding/updatedAt (and
 * helpRequested, once a real UI calls requestHelp()/withdrawHelpRequest()
 * — no live caller today, but the repository supports it regardless,
 * matching the model's own field set).
 */
export async function updateUnderstanding(db, classroomId, uid, conceptId, { understanding, updatedAt }) {
  await updateDoc(recordDoc(db, classroomId, uid, conceptId), { understanding, updatedAt });
}

/**
 * Whether this device already has a record for this concept — a QUERY
 * (not a getDoc() by the deterministic id), deliberately: Firestore
 * throws (not merely denies) when a rule's own `allow read` accesses
 * `resource.data.*` against a document that doesn't exist yet — the
 * VERY case this function needs to check safely for a student's own
 * first-ever record. A query's rule is only ever evaluated against
 * documents actually returned, so an empty result (including "this
 * device has never written this concept before") resolves cleanly,
 * never throws — the same reason
 * firestoreStudentGoalsRepository.js's own findGoal() is a query, not
 * a get-by-id, for this exact purpose.
 */
export async function findRecord(db, classroomId, uid, conceptId) {
  const snapshot = await getDocs(
    query(recordsCollection(db, classroomId), where('uid', '==', uid), where('conceptId', '==', conceptId))
  );
  return snapshot.empty ? null : snapshot.docs[0].data();
}

/**
 * Every record belonging to one specific device's own uid, across the
 * whole classroom — the student-side hydration read (see
 * services/conceptRecordHydrationService.js). Naturally bounded by how
 * many concepts THIS ONE device has personally touched, never by the
 * classroom's full syllabus size, so no conceptId filter is needed —
 * mirrors firestoreStudentGoalsRepository.js's own listGoalsForStudent()
 * shape, simplified further: uid alone is the true physical partition
 * key for this collection (see this file's own header comment), so no
 * separate studentId filter is needed to prove every possible result
 * satisfies firestore.rules's own allow read (resource.data.uid ==
 * request.auth.uid) — matching the exact, already-documented
 * list-query-provability requirement
 * firestoreStudentGoalsRepository.js's own findGoal()/
 * listGoalsForStudent() established first.
 */
export async function listRecordsForStudent(db, classroomId, { uid }) {
  const snapshot = await getDocs(query(recordsCollection(db, classroomId), where('uid', '==', uid)));
  return snapshot.docs.map((d) => d.data());
}

/**
 * Every student's record for a bounded set of concepts — the teacher-
 * side targeted hydration read (see
 * services/conceptRecordHydrationService.js), used by both
 * ConceptWorkspaceView.js (a single concept) and TimetableView.js's
 * feedback panel (one Lesson's own, typically few, executed concept
 * ids). Uses the TEACHER's own default-app Firestore instance —
 * teachers are already trusted via memberUids, same as every other
 * classroom-scoped read they make. Firestore's `in` operator supports
 * up to 30 values (v10.14.1) — comfortably more than either real
 * caller ever passes.
 */
export async function listRecordsForConcepts(classroomId, conceptIds) {
  if (conceptIds.length === 0) return [];
  const snapshot = await getDocs(query(recordsCollection(teacherDb(), classroomId), where('conceptId', 'in', conceptIds)));
  return snapshot.docs.map((d) => d.data());
}

/**
 * Every record in the whole classroom, unfiltered — available for a
 * future whole-roster/whole-syllabus teacher view (e.g.
 * getStudentUnderstandingSummary()/getOpenHelpRequests(), which have no
 * real UI caller yet — see services/learningRecordService.js). Not
 * wired into any hydration call site today, per explicit Phase N
 * "do not over-engineer" decision: neither real live consumer
 * (ConceptWorkspaceView.js, TimetableView.js) needs an unbounded
 * classroom-wide fetch, since each only ever needs a small, known set
 * of concept ids — see listRecordsForConcepts() above, which both
 * actually use.
 */
export async function listRecordsForClassroom(classroomId) {
  const snapshot = await getDocs(collection(teacherDb(), 'classrooms', classroomId, 'studentConceptRecords'));
  return snapshot.docs.map((d) => d.data());
}
