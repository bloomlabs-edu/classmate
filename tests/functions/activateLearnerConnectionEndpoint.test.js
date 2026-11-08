/**
 * tests/functions/activateLearnerConnectionEndpoint.test.js
 *
 * Real emulator tests (Firestore + Auth) for
 * functions/src/activateLearnerConnectionEndpoint.js — the single-code
 * Join a Classroom path's own HTTP-facing handler. Mirrors
 * tests/functions/deviceSignIn/deviceSignInEndpoints.emulator.test.js's
 * own convention (a real teacher's own ClassMate ID token, minted via
 * the Auth emulator) since this endpoint is authenticated the same
 * way deviceSignInEndpoints.js's handlers are — a teacher's own
 * same-project identity, not a cross-project Learning Hub identity
 * (contrast tests/functions/verifyLearnerConnectionEndpoint.test.js,
 * which is the cross-project case).
 *
 * This suite deliberately does NOT re-prove every transaction-level
 * property already covered by
 * tests/server/activateLearnerConnection.test.js (concurrency, every
 * isolation combination) — it proves the NEW layer this endpoint adds:
 * that a caller must present a real, verifiable ID token; that the
 * request body is validated against a strict field allowlist; and
 * that each failure reason from the pure logic maps to the documented
 * response shape.
 *
 * Requires the Firestore + Auth emulators running (`firebase
 * emulators:start --only firestore,auth --project
 * demo-classmate-bridge-test-endpoint`) — same project id
 * tests/functions/verifyLearnerConnectionEndpoint.test.js already uses,
 * for the same reason (one already-running emulator pair, shared
 * across endpoint suites, isolated via per-suite collection wipes).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { mintEmulatorIdToken } from './emulatorAuthHelpers.js';
import { handleActivateLearnerConnectionRequest } from '../../functions/src/activateLearnerConnectionEndpoint.js';
import { RELATIONSHIP_STATUS } from '../../js/models/LearnerConnection.js';

const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const PROJECT_ID = 'demo-classmate-bridge-test-endpoint';

let app;
let db;

const CLASSROOM_A = 'activate-endpoint-classroom-a';
const STUDENT_A1 = 'activate-endpoint-student-a1';
const TEACHER_A = 'activate-endpoint-teacher-a';
const TEACHER_OTHER = 'activate-endpoint-teacher-not-a-member';
const LEARNER_1 = 'activate-endpoint-learner-1';

before(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'activate-endpoint-tests');
  db = getFirestore(app);
});

after(async () => {
  await app.delete();
});

function deps() {
  return {
    adminDb: db,
    verifyIdToken: (idToken) => getAuth(app).verifyIdToken(idToken).then((decoded) => decoded.uid),
  };
}

async function mintIdToken(uid) {
  return mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: PROJECT_ID, uid });
}

async function wipe(collectionPath) {
  const snap = await db.collection(collectionPath).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function seedClassroom() {
  await db.doc(`classrooms/${CLASSROOM_A}`).set({
    ownerUid: TEACHER_A,
    memberUids: [TEACHER_A],
    teams: [{ id: 't1', name: 'Team', students: [{ id: STUDENT_A1, name: STUDENT_A1 }] }],
  });
}

async function seedPendingRelationship(learnerProfileId = LEARNER_1) {
  await db.doc(`learnerClassroomRelationships/${learnerProfileId}_${CLASSROOM_A}`).set({
    learnerProfileId,
    classroomId: CLASSROOM_A,
    studentId: null,
    status: RELATIONSHIP_STATUS.PENDING,
    createdAt: 'now',
  });
}

beforeEach(async () => {
  await Promise.all([wipe('classrooms'), wipe('learnerClassroomRelationships')]);
  await seedClassroom();
});

test('UNAUTHENTICATED: no Authorization header at all', async () => {
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: undefined,
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: STUDENT_A1 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 401);
  assert.deepEqual(result.body, { ok: false, error: 'unauthenticated' });
});

test('UNAUTHENTICATED: a malformed/garbage bearer token is rejected, not thrown', async () => {
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: 'Bearer not-a-real-token',
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: STUDENT_A1 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 401);
  assert.deepEqual(result.body, { ok: false, error: 'unauthenticated' });
});

test('UNAUTHENTICATED: header present but not a Bearer scheme', async () => {
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: idToken, // missing the "Bearer " prefix
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: STUDENT_A1 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 401);
});

test('INVALID REQUEST: missing a required field', async () => {
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 400);
  assert.deepEqual(result.body, { ok: false, error: 'invalid_request' });
});

test('INVALID REQUEST: a field outside the strict allowlist is rejected outright (e.g. an injected status/verifiedVia attempt)', async () => {
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: STUDENT_A1, status: 'ACTIVE' },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 400);
  assert.deepEqual(result.body, { ok: false, error: 'invalid_request' });
});

test('INVALID REQUEST: non-string field values are rejected', async () => {
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: 12345 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 400);
});

test('INVALID REQUEST: no body at all', async () => {
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: null,
    deps: deps(),
  });
  assert.equal(result.httpStatus, 400);
});

test('SUCCESS: a real teacher, a real pending relationship, a real roster student -> 200 ACTIVE', async () => {
  await seedPendingRelationship();
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: STUDENT_A1 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, { ok: true, status: 'ACTIVE', studentId: STUDENT_A1 });

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().status, 'ACTIVE');
  assert.equal(snap.data().verifiedByUid, TEACHER_A);
});

test('FORBIDDEN: a real, authenticated teacher who is not a member of this classroom gets a specific, non-anti-oracle forbidden response (this caller is always an already-authenticated teacher reviewing their own queue, not an untrusted public prober)', async () => {
  await seedPendingRelationship();
  const idToken = await mintIdToken(TEACHER_OTHER);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: STUDENT_A1 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, { ok: false, error: 'forbidden' });
});

test('STUDENT NOT ON ROSTER mapped correctly', async () => {
  await seedPendingRelationship();
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: 'not-a-real-student' },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, { ok: false, error: 'student_not_on_roster' });
});

test('NOT PENDING mapped correctly (no relationship seeded at all)', async () => {
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: STUDENT_A1 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, { ok: false, error: 'not_pending' });
});

test('CLASSROOM NOT FOUND mapped correctly', async () => {
  const idToken = await mintIdToken(TEACHER_A);
  const result = await handleActivateLearnerConnectionRequest({
    authorizationHeader: `Bearer ${idToken}`,
    body: { classroomId: 'no-such-classroom', learnerProfileId: LEARNER_1, studentId: STUDENT_A1 },
    deps: deps(),
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, { ok: false, error: 'not_found' });
});

test('NEVER LOGS SENSITIVE VALUES: a successful call\'s own console output (if any) never includes the bearer token, learnerProfileId, classroomId, or studentId', async () => {
  await seedPendingRelationship();
  const idToken = await mintIdToken(TEACHER_A);
  const originalLog = console.log;
  const originalError = console.error;
  const logged = [];
  console.log = (...args) => logged.push(args.join(' '));
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await handleActivateLearnerConnectionRequest({
      authorizationHeader: `Bearer ${idToken}`,
      body: { classroomId: CLASSROOM_A, learnerProfileId: LEARNER_1, studentId: STUDENT_A1 },
      deps: deps(),
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const combined = logged.join('\n');
  assert.equal(combined.includes(idToken), false);
  assert.equal(combined.includes(LEARNER_1), false);
});
