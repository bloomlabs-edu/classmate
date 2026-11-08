/**
 * tests/functions/getClassroomRosterForLearnerEndpoint.test.js
 *
 * Real emulator tests (Firestore + Auth) for
 * functions/src/getClassroomRosterForLearnerEndpoint.js — the read-only
 * roster endpoint behind LEARNER SELF-IDENTITY CLAIM (see
 * docs/architecture/LEARNER_SELF_IDENTITY_CLAIM.md): authentication,
 * request shape validation, code resolution (both the canonical
 * studentJoinCodes path and the legacy classroomInvitationCodes
 * fallback), and the exact, minimized field set the response ever
 * returns.
 *
 * Mirrors tests/functions/verifyLearnerConnectionEndpoint.test.js's own
 * structure and project-id convention so this file can run in the same
 * shared emulator session as its sibling endpoint suites.
 *
 * Requires the Firestore + Auth emulators running (`firebase
 * emulators:start --only firestore,auth --project
 * demo-classmate-bridge-test-endpoint`).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { mintEmulatorIdToken } from './emulatorAuthHelpers.js';
import { handleGetClassroomRosterForLearnerRequest } from '../../functions/src/getClassroomRosterForLearnerEndpoint.js';

const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const PROJECT_ID = 'demo-classmate-bridge-test-endpoint';

let app;
let db;
let validBearerToken;
const REAL_LEARNING_HUB_UID = 'roster-test-lh-uid';

const CLASSROOM_A = 'roster-classroom-a';
const CLASSROOM_B = 'roster-classroom-b';
const STUDENT_JOIN_CODE_A = 'ROSTERA1';
const LEGACY_INVITATION_CODE_A = 'ROSTLEG1';

before(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = PROJECT_ID;
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'classroom-roster-endpoint-tests');
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

beforeEach(async () => {
  await Promise.all([wipe('classrooms'), wipe('studentJoinCodes'), wipe('classroomInvitationCodes')]);
  await db.doc(`classrooms/${CLASSROOM_A}`).set({
    id: CLASSROOM_A,
    classroomName: 'Roster Test Classroom',
    memberUids: ['roster-teacher'],
    teams: [
      { id: 't1', name: 'Team Falcons', students: [{ id: 'roster-student-1', name: 'Aarav', score: 42, bucket: 'green' }] },
      { id: 't2', name: 'Team Hawks', students: [{ id: 'roster-student-2', name: 'Priya', score: 99, bucket: 'red' }] },
    ],
  });
  await db.doc(`classrooms/${CLASSROOM_B}`).set({ id: CLASSROOM_B, classroomName: 'Other Classroom', memberUids: [], teams: [] });
  await db.doc(`studentJoinCodes/${STUDENT_JOIN_CODE_A}`).set({ classroomId: CLASSROOM_A });
});

function callRoster(body, authorizationHeader = validBearerToken) {
  return handleGetClassroomRosterForLearnerRequest({ authorizationHeader, body, deps: { adminDb: db } });
}

test('UNAUTHENTICATED: missing Authorization header -> 401', async () => {
  const { httpStatus, body } = await handleGetClassroomRosterForLearnerRequest({
    authorizationHeader: null,
    body: { invitationCode: STUDENT_JOIN_CODE_A },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 401);
  assert.equal(body.error, 'unauthenticated');
});

test('UNAUTHENTICATED: malformed bearer token -> 401', async () => {
  const { httpStatus, body } = await callRoster({ invitationCode: STUDENT_JOIN_CODE_A }, 'Bearer garbage-not-a-real-token');
  assert.equal(httpStatus, 401);
  assert.equal(body.error, 'unauthenticated');
});

test('INVALID REQUEST: missing invitationCode -> 400', async () => {
  const { httpStatus, body } = await callRoster({});
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'invalid_request');
});

test('INVALID REQUEST: non-string invitationCode -> 400', async () => {
  const { httpStatus, body } = await callRoster({ invitationCode: 12345 });
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'invalid_request');
});

test('INVALID REQUEST: no body at all -> 400', async () => {
  const { httpStatus, body } = await callRoster(null);
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'invalid_request');
});

test('UNKNOWN CODE: a code resolving to nothing fails generically, the identical anti-oracle shape a bad invitation-redemption code uses', async () => {
  const { httpStatus, body } = await callRoster({ invitationCode: 'NOPE0000' });
  assert.equal(httpStatus, 200);
  assert.deepEqual(body, { ok: false, error: 'verification_failed' });
});

test('SUCCESS (canonical code): resolves the classroom via studentJoinCodes and returns only id/name/teamName per student, nothing else', async () => {
  const { httpStatus, body } = await callRoster({ invitationCode: STUDENT_JOIN_CODE_A });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, true);
  assert.equal(body.classroomId, CLASSROOM_A);
  assert.equal(body.classroomName, 'Roster Test Classroom');
  assert.deepEqual(
    body.students.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'roster-student-1', name: 'Aarav', teamName: 'Team Falcons' },
      { id: 'roster-student-2', name: 'Priya', teamName: 'Team Hawks' },
    ]
  );
  // Field-minimization proof: no score/bucket/or any other roster field ever leaks through.
  body.students.forEach((student) => {
    assert.deepEqual(Object.keys(student).sort(), ['id', 'name', 'teamName']);
  });
});

test('SUCCESS (legacy fallback): a classroom with ONLY a legacy classroomInvitationCodes entry (no studentJoinCodes at all) still resolves its roster', async () => {
  await db.doc(`classroomInvitationCodes/${LEGACY_INVITATION_CODE_A}`).set({ classroomId: CLASSROOM_A, status: 'active', invitationId: 'x', createdAt: 'now' });
  const { httpStatus, body } = await callRoster({ invitationCode: LEGACY_INVITATION_CODE_A });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, true);
  assert.equal(body.classroomId, CLASSROOM_A);
  assert.equal(body.students.length, 2);
});

test('ISOLATION: a code for classroom A never returns classroom B\'s roster, or vice versa', async () => {
  await db.doc('studentJoinCodes/ROSTERB1').set({ classroomId: CLASSROOM_B });
  const { body: bodyA } = await callRoster({ invitationCode: STUDENT_JOIN_CODE_A });
  const { body: bodyB } = await callRoster({ invitationCode: 'ROSTERB1' });
  assert.equal(bodyA.classroomId, CLASSROOM_A);
  assert.equal(bodyB.classroomId, CLASSROOM_B);
  assert.equal(bodyB.students.length, 0, 'classroom B genuinely has no students in this fixture');
});

test('NEVER LOGS SENSITIVE VALUES: a successful call\'s own console output never includes the bearer token, invitation code, or any roster name', async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const logged = [];
  console.log = (...args) => logged.push(args.join(' '));
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await callRoster({ invitationCode: STUDENT_JOIN_CODE_A });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const combined = logged.join('\n');
  assert.ok(!combined.includes(STUDENT_JOIN_CODE_A));
  assert.ok(!combined.includes('Aarav'));
  assert.ok(!combined.includes('Priya'));
});
