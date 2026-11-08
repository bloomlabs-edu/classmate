/**
 * tests/functions/getNotebookObligationsForLearnerEndpoint.test.js
 *
 * Real emulator tests (Firestore + Auth) for
 * functions/src/getNotebookObligationsForLearnerEndpoint.js — the
 * read-only Notebook Obligations endpoint's own core logic:
 * authentication, identity binding, request shape validation,
 * authoritative relationship resolution, and delegation to the
 * already-tested, unmodified
 * functions/src/notebookObligationsProjection.js projection.
 *
 * Mirrors tests/functions/verifyLearnerConnectionEndpoint.test.js's own
 * structure and conventions: `verifyLearnerProfileOwnership` is
 * exercised in both the REAL production path (proving the strongest
 * currently-honest guarantee in an environment with no Application
 * Default Credentials configured — see
 * tests/functions/learnerProfileOwnership.test.js's own "MISSING
 * CONFIGURATION" test for why that's the real, unmocked failure mode
 * here) and via an INJECTED test-only resolver, clearly separated, to
 * prove the rest of the pipeline (relationship resolution, classroom
 * loading, projection delegation, field minimization) independently of
 * that unresolved cross-project credential.
 *
 * Requires the Firestore + Auth emulators running (`firebase
 * emulators:start --only firestore,auth --project
 * demo-classmate-bridge-test-endpoint` — this specific project id
 * matters: it must match the PROJECT_ID constant below, which is
 * deliberately aligned with the sibling suites
 * (learningHubAuth.test.js, verifyLearnerConnectionEndpoint.test.js)
 * so all of them can run together against one shared emulator
 * instance — see the inline comment on that constant for why).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { mintEmulatorIdToken } from './emulatorAuthHelpers.js';
import { handleGetNotebookObligationsForLearnerRequest } from '../../functions/src/getNotebookObligationsForLearnerEndpoint.js';

const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
// Matches the project id the sibling suites (learningHubAuth.test.js,
// verifyLearnerConnectionEndpoint.test.js) already standardize on, so
// this file can run in the same single emulator session as those —
// the Auth emulator's real token issuance/verification is tied to the
// project id `emulators:start --project` was given, not fully
// project-agnostic, so every functions test file sharing one emulator
// instance must agree on this value.
const PROJECT_ID = 'demo-classmate-bridge-test-endpoint';

let app;
let db;
let validBearerToken;
const REAL_LEARNING_HUB_UID = 'obligations-test-lh-uid';

const CLASSROOM_A = 'obligations-classroom-a';
const CLASSROOM_B = 'obligations-classroom-b';
const STUDENT_1 = 'obligations-student-1';
const STUDENT_2 = 'obligations-student-2';
const LEARNER_1 = 'obligations-learner-1';
const LEARNER_2 = 'obligations-learner-2';

before(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = PROJECT_ID;
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'notebook-obligations-endpoint-tests');
  db = getFirestore(app);
  validBearerToken = `Bearer ${await mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: PROJECT_ID, uid: REAL_LEARNING_HUB_UID })}`;
});

after(async () => {
  await app.delete();
});

async function wipe(collectionPath) {
  const snap = await db.collection(collectionPath).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function seedClassroom(classroomId, { students = [], workRequests = [], notebookConfig = null, checkpoints = [] } = {}) {
  await db.doc(`classrooms/${classroomId}`).set({
    ownerUid: 'obligations-teacher',
    memberUids: ['obligations-teacher'],
    teams: [{ id: 't1', name: 'Team', students: students.map((id) => ({ id, name: id })) }],
    workRequests,
    ...(notebookConfig ? { notebookConfig } : {}),
    checkpoints,
  });
}

// A Bloom-Force-19-shaped fixture: this migration's own real reference
// classroom for checkpoint-tracked notebooks (see this task's approved
// test plan). Not the real classroom's actual data (never read here) —
// just its tracking SHAPE: a real notebookConfig plus real checkpoints,
// no WorkRequest at all, matching how an active, checkpoint-only
// classroom actually looks.
function checkpointNotebookConfig() {
  return {
    subjects: [{ id: 'subj-science', name: 'Science' }],
    notebookTypes: [{ id: 'nbtype-main', subjectId: 'subj-science', name: 'Notebook' }],
  };
}
function checkpointFixture(id, studentId, overrides = {}) {
  return {
    id,
    subjectId: 'subj-science',
    notebookTypeId: 'nbtype-main',
    title: `Week ${id}`,
    dueDate: '2026-11-15',
    order: 0,
    records: [{ studentId, submissionStatus: 'not_submitted', ...overrides }],
  };
}

async function seedRelationship(learnerProfileId, classroomId, { status, studentId }) {
  await db.doc(`learnerClassroomRelationships/${learnerProfileId}_${classroomId}`).set({
    learnerProfileId,
    classroomId,
    studentId: studentId ?? null,
    status,
    createdAt: 'now',
    updatedAt: 'now',
  });
}

function notebookWorkRequest(id, studentId, overrides = {}) {
  return {
    id,
    type: 'notebook',
    title: `Notebook Check ${id}`,
    subjectId: 'subject-science',
    notebookTypeId: 'notebook-type-main',
    dueDate: '2026-11-15',
    status: 'open',
    entries: [{ id: `${id}-entry`, studentId, status: 'assigned', reviewOutcome: null, updatedAt: '2026-10-20T00:00:00.000Z' }],
    ...overrides,
  };
}

beforeEach(async () => {
  await Promise.all([wipe('classrooms'), wipe('learnerClassroomRelationships')]);
});

function ownershipResolverFor(trustedUid, trustedLearnerProfileId) {
  return async (uid, learnerProfileId) => uid === trustedUid && learnerProfileId === trustedLearnerProfileId;
}

// --------------------------------------------------------------------
// Authentication
// --------------------------------------------------------------------

test('missing Authorization header -> 401 unauthenticated', async () => {
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: undefined,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'unauthenticated');
});

test('malformed Authorization header (no "Bearer " prefix) -> 401', async () => {
  const { httpStatus } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: 'Basic sometoken',
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 401);
});

test('invalid/garbage token -> 401', async () => {
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: 'Bearer garbage-not-a-real-token',
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 401);
  assert.equal(body.error, 'unauthenticated');
});

test('a token from the wrong project -> 401', async () => {
  const { httpStatus } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: {
      adminDb: db,
      verifyLearningHubIdToken: async () => null, // simulates learningHubAuth.js rejecting a wrong-project token (proven directly in learningHubAuth.test.js)
    },
  });
  assert.equal(httpStatus, 401);
});

test('a valid token authenticates successfully (proven by reaching past the 401 gate into request validation)', async () => {
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { classroomId: CLASSROOM_A }, // deliberately incomplete
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'invalid_request');
});

// --------------------------------------------------------------------
// Request validation
// --------------------------------------------------------------------

test('malformed body (array instead of object) -> 400 invalid_request', async () => {
  const { httpStatus } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: ['not', 'an', 'object'],
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
});

test('missing learnerProfileId -> 400 invalid_request', async () => {
  const { httpStatus } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { classroomId: CLASSROOM_A },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
});

test('missing classroomId -> 400 invalid_request', async () => {
  const { httpStatus } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1 },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
});

test('a request that includes a studentId field is rejected outright, even if every other field is valid (studentId injection attempt)', async () => {
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_1 },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'invalid_request');
});

test('any other unexpected field is rejected outright, not silently ignored', async () => {
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, includeArchived: true },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'invalid_request');
});

test('an oversized learnerProfileId or classroomId -> 400 invalid_request', async () => {
  const tooLong = 'x'.repeat(201);
  const first = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: tooLong, classroomId: CLASSROOM_A },
    deps: { adminDb: db },
  });
  assert.equal(first.httpStatus, 400);
  const second = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: tooLong },
    deps: { adminDb: db },
  });
  assert.equal(second.httpStatus, 400);
});

test('non-string learnerProfileId/classroomId -> 400 invalid_request', async () => {
  const { httpStatus } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: 12345, classroomId: CLASSROOM_A },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
});

// --------------------------------------------------------------------
// Identity binding / authoritative relationship resolution
// --------------------------------------------------------------------

test('PRODUCTION DEFAULT: even a fully authenticated, well-formed request cannot reach obligations today in this sandbox — the real ownership check has no Application Default Credentials here and fails closed', async () => {
  await seedClassroom(CLASSROOM_A, { students: [STUDENT_1], workRequests: [notebookWorkRequest('wr1', STUDENT_1)] });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db }, // no override — exercises the REAL functions/src/learnerProfileOwnership.js
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'obligations_unavailable');
  assert.equal(body.status, undefined, 'no status data may ever accompany a failure response');
});

test('unowned learnerProfileId (ownership resolver declines) -> generic failure, no obligations leaked', async () => {
  await seedClassroom(CLASSROOM_A, { students: [STUDENT_1], workRequests: [notebookWorkRequest('wr1', STUDENT_1)] });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: async () => false },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'obligations_unavailable');
});

test('an ownership resolver throwing an error is treated as "not owned", not as an unhandled crash', async () => {
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: {
      adminDb: db,
      verifyLearnerProfileOwnership: async () => { throw new Error('simulated cross-project lookup failure'); },
    },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, false);
});

test('no learnerClassroomRelationships record at all -> generic failure', async () => {
  await seedClassroom(CLASSROOM_A, { students: [STUDENT_1], workRequests: [notebookWorkRequest('wr1', STUDENT_1)] });
  const { body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(body.ok, false);
  assert.equal(body.error, 'obligations_unavailable');
});

test('a PENDING (not yet ACTIVE) relationship -> generic failure, studentId never resolved from a non-active record', async () => {
  await seedClassroom(CLASSROOM_A, { students: [STUDENT_1], workRequests: [notebookWorkRequest('wr1', STUDENT_1)] });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'PENDING', studentId: null });
  const { body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(body.ok, false);
  assert.equal(body.error, 'obligations_unavailable');
});

test('a REVOKED relationship -> generic failure, even though it still names a real studentId', async () => {
  await seedClassroom(CLASSROOM_A, { students: [STUDENT_1], workRequests: [notebookWorkRequest('wr1', STUDENT_1)] });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'REVOKED', studentId: STUDENT_1 });
  const { body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(body.ok, false);
  assert.equal(body.error, 'obligations_unavailable');
});

test('classroom mismatch: an ACTIVE relationship exists for a DIFFERENT classroom than the one requested -> generic failure', async () => {
  await seedClassroom(CLASSROOM_A, { students: [STUDENT_1], workRequests: [notebookWorkRequest('wr1', STUDENT_1)] });
  await seedClassroom(CLASSROOM_B, { students: [], workRequests: [] });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  // The learner is ACTIVE in CLASSROOM_A but the request names CLASSROOM_B.
  const { body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_B },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(body.ok, false);
  assert.equal(body.error, 'obligations_unavailable');
});

test('ACTIVE relationship but the classroom document itself no longer exists -> generic failure, not a crash', async () => {
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, false);
});

// --------------------------------------------------------------------
// Real success paths
// --------------------------------------------------------------------

test('a fully valid, ACTIVE, authenticated, owned request returns the real (legacy) status for that student', async () => {
  await seedClassroom(CLASSROOM_A, {
    students: [STUDENT_1],
    workRequests: [notebookWorkRequest('wr1', STUDENT_1, { title: 'Science Notebook', dueDate: '2026-12-01' })],
  });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status.summary.awaitingSubmission, 1);
  assert.equal(body.status.items.awaitingSubmission.length, 1);
  assert.equal(body.status.items.awaitingSubmission[0].source, 'workRequest');
  assert.equal(body.status.items.awaitingSubmission[0].title, 'Science Notebook');
  assert.equal(body.status.items.awaitingSubmission[0].dueDate, '2026-12-01');
  assert.equal(body.status.items.awaitingSubmission[0].actionable, true);
});

test('CHECKPOINT-AWARE: a Bloom-Force-19-shaped classroom (checkpoint-tracked notebook, no WorkRequest at all) returns real checkpoint status, not an empty result', async () => {
  await seedClassroom(CLASSROOM_A, {
    students: [STUDENT_1],
    notebookConfig: checkpointNotebookConfig(),
    checkpoints: [
      checkpointFixture('cp1', STUDENT_1, { submissionStatus: 'not_submitted' }),
      { ...checkpointFixture('cp2', STUDENT_1), order: 1, records: [{ studentId: STUDENT_1, submissionStatus: 'submitted', reviewStatus: 'complete', updatedAt: '2026-11-10T00:00:00.000Z' }] },
    ],
  });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status.summary.awaitingSubmission, 1);
  assert.equal(body.status.summary.reviewed, 1);
  assert.equal(body.status.items.awaitingSubmission[0].source, 'checkpoint');
  assert.equal(body.status.items.reviewed[0].source, 'checkpoint');
});

test('CHECKPOINT-AWARE: checkpoint tracking wins over a stale legacy obligation for the SAME notebook identity -- no double-count, matching the approved precedence rule', async () => {
  await seedClassroom(CLASSROOM_A, {
    students: [STUDENT_1],
    notebookConfig: checkpointNotebookConfig(),
    checkpoints: [{ ...checkpointFixture('cp1', STUDENT_1), records: [{ studentId: STUDENT_1, submissionStatus: 'submitted', reviewStatus: 'complete', updatedAt: '2026-11-10T00:00:00.000Z' }] }],
    // Stale WorkRequest for the EXACT same (subjectId, notebookTypeId) identity -- must be dropped, not merged.
    workRequests: [{ id: 'wr-stale', type: 'notebook', title: 'Stale Check', subjectId: 'subj-science', notebookTypeId: 'nbtype-main', dueDate: '2026-10-01', status: 'open', entries: [{ id: 'e1', studentId: STUDENT_1, status: 'assigned', reviewOutcome: null, updatedAt: '2026-09-01T00:00:00.000Z' }] }],
  });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  const { body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  const totalItems = Object.values(body.status.items).reduce((sum, arr) => sum + arr.length, 0);
  assert.equal(totalItems, 1, 'exactly one item total -- the stale legacy obligation for the same identity must never surface as a second item');
  assert.equal(body.status.summary.awaitingSubmission, 0);
  assert.equal(body.status.summary.reviewed, 1);
  assert.equal(body.status.items.reviewed[0].source, 'checkpoint');
});

test('empty results: ACTIVE relationship + real classroom, but no notebook entries for this student -> {ok: true, status: {summary: all-zero, items: all-empty}}', async () => {
  await seedClassroom(CLASSROOM_A, { students: [STUDENT_1], workRequests: [] });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  const { httpStatus, body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 200);
  assert.deepEqual(body, {
    ok: true,
    status: {
      summary: { awaitingSubmission: 0, awaitingReview: 0, needsCorrection: 0, reviewed: 0, absent: 0 },
      items: { awaitingSubmission: [], awaitingReview: [], needsCorrection: [], reviewed: [], absent: [] },
    },
  });
});

test('two students in one classroom: each learner sees ONLY their own student\'s status, never the other\'s', async () => {
  await seedClassroom(CLASSROOM_A, {
    students: [STUDENT_1, STUDENT_2],
    workRequests: [notebookWorkRequest('wr-s1', STUDENT_1, { title: 'Student 1 Check' }), notebookWorkRequest('wr-s2', STUDENT_2, { title: 'Student 2 Check' })],
  });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  await seedRelationship(LEARNER_2, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_2 });

  const deps = {
    adminDb: db,
    verifyLearnerProfileOwnership: async (uid, learnerProfileId) =>
      (uid === REAL_LEARNING_HUB_UID && learnerProfileId === LEARNER_1) || (uid === 'other-lh-uid' && learnerProfileId === LEARNER_2),
  };

  const resultForLearner1 = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps,
  });
  assert.equal(resultForLearner1.body.status.items.awaitingSubmission.length, 1);
  assert.equal(resultForLearner1.body.status.items.awaitingSubmission[0].title, 'Student 1 Check');

  const otherLearnerToken = `Bearer ${await mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: PROJECT_ID, uid: 'other-lh-uid' })}`;
  const resultForLearner2 = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: otherLearnerToken,
    body: { learnerProfileId: LEARNER_2, classroomId: CLASSROOM_A },
    deps,
  });
  assert.equal(resultForLearner2.body.status.items.awaitingSubmission.length, 1);
  assert.equal(resultForLearner2.body.status.items.awaitingSubmission[0].title, 'Student 2 Check');
});

test('SECURITY: Caller A cannot read Caller B\'s obligations by submitting B\'s learnerProfileId while authenticated as A', async () => {
  await seedClassroom(CLASSROOM_A, {
    students: [STUDENT_1, STUDENT_2],
    workRequests: [notebookWorkRequest('wr-s1', STUDENT_1), notebookWorkRequest('wr-s2', STUDENT_2)],
  });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });
  await seedRelationship(LEARNER_2, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_2 });

  // Authenticated as REAL_LEARNING_HUB_UID (owns LEARNER_1 only), but claims LEARNER_2.
  const { body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_2, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(body.ok, false);
  assert.equal(body.error, 'obligations_unavailable');
});

// --------------------------------------------------------------------
// Response schema allowlist — field minimization
// --------------------------------------------------------------------

test('RESPONSE SCHEMA ALLOWLIST: a success response contains exactly {ok, status}, status contains exactly {summary, items} with all 5 bucket keys, and each item contains exactly the seven approved fields -- never requestId/checkpointId/id/studentId -- even when the underlying data has extra junk fields', async () => {
  await seedClassroom(CLASSROOM_A, {
    students: [STUDENT_1],
    notebookConfig: checkpointNotebookConfig(),
    checkpoints: [{
      ...checkpointFixture('cp1', STUDENT_1),
      records: [{ studentId: STUDENT_1, submissionStatus: 'not_submitted', secretInternalField: 'should-never-leak' }],
    }],
    workRequests: [
      notebookWorkRequest('wr1', STUDENT_1, {
        subjectId: 'subj-other', // a DIFFERENT identity from the checkpoint above, so both surface
        notebookTypeId: 'nbtype-other',
        secretInternalField: 'should-never-leak',
        teacherNotes: 'private teacher commentary',
        entries: [
          {
            id: 'wr1-entry',
            studentId: STUDENT_1,
            status: 'assigned',
            reviewOutcome: null,
            updatedAt: '2026-10-20T00:00:00.000Z',
            internalAuditTrail: ['should-never-leak-either'],
          },
        ],
      }),
    ],
  });
  await seedRelationship(LEARNER_1, CLASSROOM_A, { status: 'ACTIVE', studentId: STUDENT_1 });

  const { body } = await handleGetNotebookObligationsForLearnerRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });

  assert.deepEqual(new Set(Object.keys(body)), new Set(['ok', 'status']));
  assert.deepEqual(new Set(Object.keys(body.status)), new Set(['summary', 'items']));
  assert.deepEqual(new Set(Object.keys(body.status.summary)), new Set(['awaitingSubmission', 'awaitingReview', 'needsCorrection', 'reviewed', 'absent']));
  assert.deepEqual(new Set(Object.keys(body.status.items)), new Set(['awaitingSubmission', 'awaitingReview', 'needsCorrection', 'reviewed', 'absent']));

  assert.equal(body.status.items.awaitingSubmission.length, 2, 'both the checkpoint item and the different-identity legacy item should surface');
  const ALLOWED_ITEM_FIELDS = new Set(['source', 'title', 'subjectId', 'notebookTypeId', 'dueDate', 'updatedAt', 'actionable']);
  for (const item of body.status.items.awaitingSubmission) {
    assert.deepEqual(new Set(Object.keys(item)), ALLOWED_ITEM_FIELDS);
    assert.ok(!('id' in item), 'the projection\'s internal id field must never leak');
    assert.ok(!('checkpointId' in item), 'checkpointId is ClassMate-internal and must never leak');
    assert.ok(!('requestId' in item), 'requestId is ClassMate-internal and must never leak');
    assert.ok(!('studentId' in item), 'studentId must never appear in the response — Learning Hub already knows it');
    assert.ok(!('secretInternalField' in item));
    assert.ok(!('teacherNotes' in item));
    assert.ok(!('internalAuditTrail' in item));
  }
});

test('RESPONSE SCHEMA ALLOWLIST: every failure response contains exactly {ok, error}, never any status data', async () => {
  const cases = [
    { authorizationHeader: undefined, body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A } },
    { authorizationHeader: validBearerToken, body: { classroomId: CLASSROOM_A } },
    { authorizationHeader: validBearerToken, body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_1 } },
  ];
  for (const req of cases) {
    const { body } = await handleGetNotebookObligationsForLearnerRequest({ ...req, deps: { adminDb: db } });
    assert.deepEqual(new Set(Object.keys(body)), new Set(['ok', 'error']));
    assert.equal(body.ok, false);
  }
});

// --------------------------------------------------------------------
// Dependency contract
// --------------------------------------------------------------------

test('adminDb is a required dependency — the endpoint refuses to guess/default a Firestore instance', async () => {
  await assert.rejects(() =>
    handleGetNotebookObligationsForLearnerRequest({
      authorizationHeader: validBearerToken,
      body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A },
      deps: {},
    })
  );
});
