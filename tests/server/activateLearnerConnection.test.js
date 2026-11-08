/**
 * tests/server/activateLearnerConnection.test.js
 *
 * Real Firestore emulator + firebase-admin tests for
 * functions/src/learnerVerification/activateLearnerConnection.js — the
 * single-code Join a Classroom path's own trusted transaction. Mirrors
 * tests/server/verifyLearnerConnection.test.js's own structure and
 * emulator-sharing convention (same PROJECT_ID, same beforeEach wipe
 * pattern) since both suites are Admin-SDK-only (no auth token
 * involved at this layer — that is
 * tests/functions/activateLearnerConnectionEndpoint.test.js's job).
 *
 * Covers every check activateRelationshipForStudent() documents in its
 * own header comment: classroom existence, live teacher membership,
 * live roster membership, and a genuinely PENDING relationship — plus
 * concurrency and cross-classroom/cross-learner isolation.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { activateRelationshipForStudent } from '../../functions/src/learnerVerification/activateLearnerConnection.js';
import { RELATIONSHIP_STATUS } from '../../js/models/LearnerConnection.js';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

// Same shared emulator project id as tests/server/verifyLearnerConnection.test.js
// and tests/rules/learnerConnection.rules.test.js — see that file's own
// header comment for why (only this one project id gets its ruleset
// dynamically refreshed by the suite that actually targets it via
// @firebase/rules-unit-testing; every other project id, including this
// one, just needs a real, running Firestore emulator instance, which
// this suite's own beforeEach() keeps isolated via collection wipes).
const PROJECT_ID = 'demo-classmate-bridge-test';

let app;
let db;

const CLASSROOM_A = 'classroom-a-activate';
const CLASSROOM_B = 'classroom-b-activate';
const STUDENT_A1 = 'student-a1-activate';
const STUDENT_A2 = 'student-a2-activate';
const STUDENT_B1 = 'student-b1-activate';
const TEACHER_A = 'teacher-a-activate';
const TEACHER_OTHER = 'teacher-not-a-member-activate';
const LEARNER_1 = 'learner-1-activate';
const LEARNER_2 = 'learner-2-activate';

before(() => {
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'activate-learner-connection-tests');
  db = getFirestore(app);
});

after(async () => {
  await app.delete();
});

async function wipeCollection(name) {
  const snap = await db.collection(name).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function seedClassroom(classroomId, { memberUids, students }) {
  await db.doc(`classrooms/${classroomId}`).set({
    ownerUid: memberUids[0],
    memberUids,
    teams: [{ id: 't1', name: 'Team', students: students.map((id) => ({ id, name: id })) }],
  });
}

async function seedPendingRelationship(learnerProfileId, classroomId) {
  await db.doc(`learnerClassroomRelationships/${learnerProfileId}_${classroomId}`).set({
    learnerProfileId,
    classroomId,
    studentId: null,
    status: RELATIONSHIP_STATUS.PENDING,
    createdAt: 'now',
  });
}

beforeEach(async () => {
  await Promise.all([wipeCollection('classrooms'), wipeCollection('learnerClassroomRelationships')]);
  await seedClassroom(CLASSROOM_A, { memberUids: [TEACHER_A], students: [STUDENT_A1, STUDENT_A2] });
  await seedClassroom(CLASSROOM_B, { memberUids: ['teacher-b-activate'], students: [STUDENT_B1] });
});

test('SUCCESS: a genuinely pending relationship, a real classroom-member teacher, and a real roster student activates the relationship with no code involved', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A1,
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.studentId, STUDENT_A1);
  assert.equal(result.classroomId, CLASSROOM_A);

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().status, RELATIONSHIP_STATUS.ACTIVE);
  assert.equal(snap.data().studentId, STUDENT_A1);
  assert.equal(snap.data().verifiedVia, 'teacher-direct-match');
  assert.equal(snap.data().verifiedByUid, TEACHER_A);
});

test('CLASSROOM NOT FOUND: activation fails if the classroom itself does not exist', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  const result = await activateRelationshipForStudent(db, {
    classroomId: 'no-such-classroom',
    studentId: STUDENT_A1,
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'classroom_not_found');
});

test('FORBIDDEN: a caller who is not genuinely a member of this classroom cannot activate anything in it, even naming a real roster student and a real pending relationship', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A1,
    teacherUid: TEACHER_OTHER,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'forbidden');

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().status, RELATIONSHIP_STATUS.PENDING, 'must remain untouched');
});

test('FORBIDDEN (cross-classroom): a real teacher of classroom B cannot activate a relationship in classroom A', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A1,
    teacherUid: 'teacher-b-activate',
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'forbidden');
});

test('STUDENT NOT ON ROSTER: a studentId that does not exist on this classroom\'s live roster fails, even with a genuine teacher and a genuine pending relationship', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: 'a-student-id-that-does-not-exist',
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'student_not_on_roster');
});

test('STUDENT NOT ON ROSTER (cross-classroom roster): a studentId that is real, but only on a DIFFERENT classroom\'s roster, fails', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_B1,
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'student_not_on_roster');
});

test('NOT PENDING (missing): activation fails if no relationship exists at all for this (learnerProfileId, classroomId) pair', async () => {
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A1,
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_pending');
});

test('NOT PENDING (already ACTIVE): activation fails for a relationship already ACTIVE against a different student, and does not overwrite it', async () => {
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: RELATIONSHIP_STATUS.ACTIVE, createdAt: 'now',
  });
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A2,
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_pending');

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().studentId, STUDENT_A1, 'the original ACTIVE relationship must remain untouched');
});

test('NOT PENDING (REJECTED): a rejected relationship cannot be silently reactivated by this path', async () => {
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: RELATIONSHIP_STATUS.REJECTED, createdAt: 'now',
  });
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A1,
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_pending');
});

test('NOT PENDING (REVOKED): a revoked relationship cannot be silently reactivated by this path — the learner must re-request first (createConnectionRequest), same as the code-based path requires', async () => {
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: RELATIONSHIP_STATUS.REVOKED, createdAt: 'now',
  });
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A1,
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_pending');
});

test('ISOLATION: activating one learner\'s pending relationship never touches a different learner\'s own pending relationship in the same classroom', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  await seedPendingRelationship(LEARNER_2, CLASSROOM_A);
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A1,
    teacherUid: TEACHER_A,
    learnerProfileId: LEARNER_1,
  });
  assert.equal(result.ok, true);

  const other = await db.doc(`learnerClassroomRelationships/${LEARNER_2}_${CLASSROOM_A}`).get();
  assert.equal(other.data().status, RELATIONSHIP_STATUS.PENDING, 'a different learner\'s own pending relationship must remain untouched');
});

test('CONCURRENT ACTIVATION: two simultaneous activation attempts naming the SAME student for the same pending relationship (e.g. a double-click) resolve to exactly one success', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  const [resultA, resultB] = await Promise.all([
    activateRelationshipForStudent(db, { classroomId: CLASSROOM_A, studentId: STUDENT_A1, teacherUid: TEACHER_A, learnerProfileId: LEARNER_1 }),
    activateRelationshipForStudent(db, { classroomId: CLASSROOM_A, studentId: STUDENT_A1, teacherUid: TEACHER_A, learnerProfileId: LEARNER_1 }),
  ]);
  const successes = [resultA, resultB].filter((r) => r.ok);
  assert.equal(successes.length, 1, 'exactly one of the two concurrent activation attempts must succeed');
});

test('CONCURRENT ACTIVATION (conflicting students): two simultaneous activation attempts naming DIFFERENT students for the same pending relationship still resolve to exactly one success, and the relationship ends up consistent with whichever one actually won', async () => {
  await seedPendingRelationship(LEARNER_1, CLASSROOM_A);
  const [resultA, resultB] = await Promise.all([
    activateRelationshipForStudent(db, { classroomId: CLASSROOM_A, studentId: STUDENT_A1, teacherUid: TEACHER_A, learnerProfileId: LEARNER_1 }),
    activateRelationshipForStudent(db, { classroomId: CLASSROOM_A, studentId: STUDENT_A2, teacherUid: TEACHER_A, learnerProfileId: LEARNER_1 }),
  ]);
  const successes = [resultA, resultB].filter((r) => r.ok);
  assert.equal(successes.length, 1, 'exactly one of the two conflicting concurrent activation attempts must succeed');

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().studentId, successes[0].studentId, 'the persisted studentId must match whichever attempt actually won, never a mix of both');
});

test('missing required fields fail closed with \'forbidden\' rather than throwing', async () => {
  const result = await activateRelationshipForStudent(db, {
    classroomId: CLASSROOM_A,
    studentId: STUDENT_A1,
    teacherUid: TEACHER_A,
    learnerProfileId: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'forbidden');
});
