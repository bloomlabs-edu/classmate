/**
 * tests/server/verifyLearnerConnection.test.js
 *
 * Real Firestore emulator + firebase-admin tests for the trusted
 * server module (server/learnerVerification/verifyLearnerConnection.js)
 * — the actual redemption/activation transaction, run exactly as it
 * would run inside the future Cloud Function (Admin SDK, bypassing
 * rules, since rules cannot compute the SHA-256 hash this step depends
 * on — see that module's own header comment).
 *
 * Covers every "Verification" case in
 * docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md item 12:
 * valid, wrong classroom, wrong student, wrong learner, ambiguous
 * identity, already-active, revoked, reused credential, cross-account
 * isolation, cross-classroom isolation — plus concurrent redemption.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { sha256Hex } from '../../server/learnerVerification/hashUtils.js';
import { createConnectionRequest, verifyStudentCode } from '../../server/learnerVerification/verifyLearnerConnection.js';
import { RELATIONSHIP_STATUS } from '../../js/models/LearnerConnection.js';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

// Deliberately the SAME emulator project id as
// tests/rules/learnerConnection.rules.test.js's 'demo-classmate-bridge-test'.
// This emulator instance was started once via `firebase emulators:start
// --only firestore --project demo-classmate-bridge-test`, which loads
// firestore.rules from disk ONCE at CLI-startup time. Only the project id
// that @firebase/rules-unit-testing's initializeTestEnvironment() targets
// gets its ruleset refreshed dynamically (via the emulator's rules
// management API) on every run of that suite — any OTHER project id
// silently falls back to whatever firestore.rules looked like at that
// original CLI startup, which by now is stale. Using the same project id
// here means this suite's Admin SDK calls are evaluated against the
// live-refreshed ruleset, not a stale snapshot. See beforeEach() below for
// how this suite's own data is kept isolated from the rules suite's data
// within that one shared project.
const PROJECT_ID = 'demo-classmate-bridge-test';

let app;
let db;

const CLASSROOM_A = 'classroom-a-server';
const CLASSROOM_B = 'classroom-b-server';
const STUDENT_A1 = 'student-a1-server';
const STUDENT_A2 = 'student-a2-server';
const STUDENT_B1 = 'student-b1-server';
const LEARNER_1 = 'learner-1-server';
const LEARNER_2 = 'learner-2-server';
const INVITATION_CODE_A = 'INVCODEA';

before(() => {
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'verify-learner-connection-tests');
  db = getFirestore(app);
});

after(async () => {
  await app.delete();
});

async function wipeCollection(name) {
  const snap = await db.collection(name).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function seedClassroom(classroomId, students) {
  await db.doc(`classrooms/${classroomId}`).set({
    ownerUid: 'teacher-server',
    memberUids: ['teacher-server'],
    teams: [{ id: 't1', name: 'Team', students: students.map((id) => ({ id, name: id })) }],
  });
}

async function seedInvitationCode(code, classroomId) {
  await db.doc(`classroomInvitationCodes/${code}`).set({ classroomId, invitationId: 'inv-server', status: 'active', createdAt: 'now' });
}

/**
 * `learnerProfileId` is REQUIRED (not optional/defaulted) — per the
 * CRITICAL FIRST STEP security review, a real verification code is
 * always bound to the exact learnerProfileId it was generated for (see
 * models/LearnerConnection.js's own createStudentVerificationCode()
 * header comment). Every call site below passes it explicitly so it's
 * always obvious, reading any one test, exactly which learner a given
 * code is supposed to work for.
 */
async function seedVerificationCode(classroomId, studentId, learnerProfileId, rawCode, overrides = {}) {
  const codeHash = sha256Hex(rawCode);
  await db.doc(`classrooms/${classroomId}/studentVerificationCodes/${codeHash}`).set({
    codeHash,
    classroomId,
    studentId,
    learnerProfileId,
    status: 'active',
    createdByUid: 'teacher-server',
    createdAt: 'now',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  });
  return codeHash;
}

beforeEach(async () => {
  await Promise.all([
    wipeCollection('classrooms'),
    wipeCollection('classroomInvitationCodes'),
    wipeCollection('learnerClassroomRelationships'),
  ]);
  // studentVerificationCodes is a subcollection — wiped implicitly by
  // deleting the parent classroom docs above is NOT how Firestore works
  // (subcollections survive parent deletion) — clean explicitly.
  for (const classroomId of [CLASSROOM_A, CLASSROOM_B]) {
    const snap = await db.collection(`classrooms/${classroomId}/studentVerificationCodes`).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await seedClassroom(CLASSROOM_A, [STUDENT_A1, STUDENT_A2]);
  await seedClassroom(CLASSROOM_B, [STUDENT_B1]);
  await seedInvitationCode(INVITATION_CODE_A, CLASSROOM_A);
});

// --------------------------------------------------------------------
// createConnectionRequest — step one, PENDING, no automatic match
// --------------------------------------------------------------------

test('createConnectionRequest creates a PENDING relationship with no studentId — automatic match never runs today (ambiguous identity is the default state)', async () => {
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, invitationCode: INVITATION_CODE_A });
  assert.equal(result.ok, true);
  assert.equal(result.status, RELATIONSHIP_STATUS.PENDING);

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.exists, true);
  assert.equal(snap.data().status, RELATIONSHIP_STATUS.PENDING);
  assert.equal(snap.data().studentId, null);
});

test('createConnectionRequest fails generically for an invalid invitation code', async () => {
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, invitationCode: 'NOT-REAL' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'verification_failed');
});

test('createConnectionRequest fails if the invitation code has been revoked', async () => {
  await db.doc(`classroomInvitationCodes/${INVITATION_CODE_A}`).update({ status: 'revoked' });
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, invitationCode: INVITATION_CODE_A });
  assert.equal(result.ok, false);
});

test('createConnectionRequest does not disturb an already-ACTIVE relationship', async () => {
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
  });
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, invitationCode: INVITATION_CODE_A });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ACTIVE');
  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().studentId, STUDENT_A1); // untouched
});

// --------------------------------------------------------------------
// verifyStudentCode — step two, the actual security-critical operation
// --------------------------------------------------------------------

test('VALID: a real, active, unexpired code for a real roster student activates the relationship', async () => {
  const rawCode = 'REALCODE1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(result.ok, true);
  assert.equal(result.classroomId, CLASSROOM_A);
  assert.equal(result.studentId, STUDENT_A1);

  const relSnap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(relSnap.data().status, 'ACTIVE');
  assert.equal(relSnap.data().studentId, STUDENT_A1);

  const codeSnap = await db.doc(`classrooms/${CLASSROOM_A}/studentVerificationCodes/${sha256Hex(rawCode)}`).get();
  assert.equal(codeSnap.data().status, 'redeemed');
});

test('WRONG CLASSROOM: a code created for classroom A cannot be redeemed by presenting classroom B\'s id', async () => {
  const rawCode = 'WRONGCLASSROOM1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_B, rawCode });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'verification_failed');
});

test('WRONG STUDENT: a code whose recorded studentId no longer exists in the live roster fails, even though the code itself is genuine and unexpired', async () => {
  const rawCode = 'GHOSTSTUDENT1';
  await seedVerificationCode(CLASSROOM_A, 'a-student-id-that-does-not-exist', LEARNER_1, rawCode);
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(result.ok, false);
  // Proves the rules-layer gap (firestore.rules cannot check this at
  // creation — see that file's own comment) is fully closed here.
});

test('WRONG STUDENT (cross-classroom roster): a code naming a student who only exists in a DIFFERENT classroom\'s roster fails', async () => {
  const rawCode = 'CROSSCLASSROOMSTUDENT1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_B1, LEARNER_1, rawCode); // studentId real, but not in CLASSROOM_A's own roster
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(result.ok, false);
});

test('WRONG LEARNER (hijack attempt): a genuinely valid code cannot be used to overwrite an ALREADY-ACTIVE relationship for a different student', async () => {
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
  });
  const rawCode = 'HIJACKATTEMPT1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A2, LEARNER_1, rawCode); // a real, valid code for a DIFFERENT real student, correctly bound to LEARNER_1
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(result.ok, false, 'a valid code for student A2 must not be allowed to overwrite an existing ACTIVE relationship already bound to student A1');

  const relSnap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(relSnap.data().studentId, STUDENT_A1, 'the original relationship must remain untouched');
});

test('AMBIGUOUS IDENTITY: two different learnerProfileIds each independently redeeming their OWN valid code both succeed, and end up correctly distinguished (no automatic match ever conflates them)', async () => {
  const rawCode1 = 'LEARNERONECODE';
  const rawCode2 = 'LEARNERTWOCODE';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode1);
  await seedVerificationCode(CLASSROOM_A, STUDENT_A2, LEARNER_2, rawCode2);

  const result1 = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode: rawCode1 });
  const result2 = await verifyStudentCode(db, { learnerProfileId: LEARNER_2, classroomId: CLASSROOM_A, rawCode: rawCode2 });

  assert.equal(result1.ok, true);
  assert.equal(result1.studentId, STUDENT_A1);
  assert.equal(result2.ok, true);
  assert.equal(result2.studentId, STUDENT_A2);
});

test('ALREADY-ACTIVE: verifying again for a relationship that is already ACTIVE (even with a fresh, otherwise-valid code for the SAME student) does not require re-verification and does not double-consume', async () => {
  const rawCode = 'ALREADYACTIVE1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);
  const first = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(first.ok, true);

  const rawCode2 = 'ALREADYACTIVE2';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode2);
  const second = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode: rawCode2 });
  assert.equal(second.ok, false, 'a second code must not be usable against an already-ACTIVE relationship at all');
});

test('REVOKED: a revoked relationship does not reactivate merely by presenting a fresh, valid code — it requires going through createConnectionRequest again first', async () => {
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'REVOKED', createdAt: 'now',
  });
  const rawCode = 'POSTREVOKE1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  // A REVOKED relationship is not ACTIVE, so verifyStudentCode's own
  // "already ACTIVE" guard does not block it — it legitimately
  // re-activates on a fresh, valid code, which is the intended,
  // documented "re-verification goes through the process again" path
  // (architecture doc §5) — but MUST require this real function call,
  // never happen merely from a stale client retry with no real code.
  assert.equal(result.ok, true);
  const relSnap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(relSnap.data().status, 'ACTIVE');
});

test('a REVOKED relationship canNOT be reactivated by a stale/replayed request that presents no real code (the client-side rules path, proven separately in tests/rules/, is the actual guarantee for this — this test proves the server module also never does it implicitly)', async () => {
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'REVOKED', createdAt: 'now',
  });
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode: 'no-such-code-exists' });
  assert.equal(result.ok, false);
  const relSnap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(relSnap.data().status, 'REVOKED', 'must remain REVOKED');
});

test('REUSED CREDENTIAL: the same code cannot be redeemed twice, even for the same learner', async () => {
  const rawCode = 'ONETIMEONLY1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);
  const first = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(first.ok, true);
  const second = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(second.ok, false);
});

test('REUSED CREDENTIAL (different learner): the same code cannot be redeemed by a SECOND, different learnerProfileId after the first redemption', async () => {
  const rawCode = 'ONETIMEONLY2';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);
  const first = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(first.ok, true);
  const second = await verifyStudentCode(db, { learnerProfileId: LEARNER_2, classroomId: CLASSROOM_A, rawCode });
  assert.equal(second.ok, false, 'cross-account isolation: a second account cannot piggyback on a code someone else already consumed (doubly true here: LEARNER_2 is also not who this code was bound to)');
});

test('CODE BOUND TO WRONG LEARNER (mis-binding attempt): a fully valid, never-redeemed code generated for one learner\'s pending request cannot be redeemed by a DIFFERENT learnerProfileId, even when that other learner also has their own distinct PENDING relationship in the very same classroom', async () => {
  // Two independent, genuinely real Learning Hub learners both have a
  // distinct PENDING relationship in the same classroom at once — the
  // exact "multiple pending requests, never merged" scenario the
  // architecture doc requires ClassMate to support.
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
  });
  await db.doc(`learnerClassroomRelationships/${LEARNER_2}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_2, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
  });

  // The teacher reviewed LEARNER_1's own pending row and generated a
  // code naming a real roster student, correctly bound to LEARNER_1.
  const rawCode = 'BOUNDTOLEARNERONE1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);

  // LEARNER_2 — a genuinely different, also-pending learner, NOT the
  // one this code was generated for — attempts to redeem this exact
  // code text (e.g. it was misdirected, overheard, or simply guessed
  // which of several pending rows the teacher meant).
  const mismatchedAttempt = await verifyStudentCode(db, { learnerProfileId: LEARNER_2, classroomId: CLASSROOM_A, rawCode });
  assert.equal(mismatchedAttempt.ok, false, 'a code bound to LEARNER_1 must never be redeemable by LEARNER_2, even with an otherwise perfectly valid classroom/student/code');

  // Neither relationship may have been disturbed by the attempt.
  const rel1 = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(rel1.data().status, 'PENDING', 'the rightful learner\'s own relationship must remain untouched');
  const rel2 = await db.doc(`learnerClassroomRelationships/${LEARNER_2}_${CLASSROOM_A}`).get();
  assert.equal(rel2.data().status, 'PENDING', 'the mismatched learner\'s own relationship must remain untouched — no partial/incorrect activation');

  // And the code itself must not have been consumed by the failed,
  // mismatched attempt — the rightful learner can still redeem it.
  const correctRedemption = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(correctRedemption.ok, true);
  assert.equal(correctRedemption.studentId, STUDENT_A1);
});

test('EXPIRED: a code past its expiresAt fails even if otherwise perfectly valid', async () => {
  const rawCode = 'EXPIREDCODE1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode, { expiresAt: '2020-01-01T00:00:00.000Z' });
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode });
  assert.equal(result.ok, false);
});

test('CROSS-CLASSROOM ISOLATION: a code issued for classroom A cannot be redeemed at all under classroom B, even for a real classroom-B student id coincidentally', async () => {
  const rawCode = 'CROSSCLASSROOMCODE1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);
  const result = await verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_B, rawCode });
  assert.equal(result.ok, false);
  // The code document doesn't even exist at classrooms/{CLASSROOM_B}/studentVerificationCodes/{hash} —
  // proven implicitly: verifyStudentCode looks it up by that exact path.
});

test('CONCURRENT REDEMPTION: two simultaneous verification attempts for the same code (same rightful learner, e.g. a double-submit from two tabs) resolve to exactly one success', async () => {
  const rawCode = 'CONCURRENT1';
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, rawCode);
  const [resultA, resultB] = await Promise.all([
    verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode }),
    verifyStudentCode(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, rawCode }),
  ]);
  const successes = [resultA, resultB].filter((r) => r.ok);
  assert.equal(successes.length, 1, 'exactly one of the two concurrent redemption attempts must succeed');
});
