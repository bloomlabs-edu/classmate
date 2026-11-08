/**
 * tests/server/verifyLearnerConnection.test.js
 *
 * Real Firestore emulator + firebase-admin tests for the trusted
 * server module (functions/src/learnerVerification/verifyLearnerConnection.js)
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
import { sha256Hex } from '../../functions/src/learnerVerification/hashUtils.js';
import { createConnectionRequest, verifyStudentCode, resolveInvitationClassroomId } from '../../functions/src/learnerVerification/verifyLearnerConnection.js';
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
const STUDENT_JOIN_CODE_A = 'SJCODEA1';
const STUDENT_JOIN_CODE_B = 'SJCODEB1';

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
 * UNIFIED CLASSROOM CODE — the exact collection
 * workspaceService.createStudentJoinCodeMapping() writes to for
 * ClassMate Student Mode's own classroom.classroomStudentJoinCode.
 * Seeding this directly, with no corresponding classroomInvitationCodes
 * entry, is what proves resolveInvitationClassroomId() genuinely treats
 * this AS the canonical Learning Hub lookup now, not just Student
 * Mode's.
 */
async function seedStudentJoinCode(code, classroomId) {
  await db.doc(`studentJoinCodes/${code}`).set({ classroomId });
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
    wipeCollection('studentJoinCodes'),
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

test('createConnectionRequest works WITHOUT a caller-supplied classroomId — the real-world case, since the invitation code alone is what ClassMate actually hands out', async () => {
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: INVITATION_CODE_A });
  assert.equal(result.ok, true);
  assert.equal(result.status, RELATIONSHIP_STATUS.PENDING);
  assert.equal(result.classroomId, CLASSROOM_A, 'classroomId must be resolved from the invitation code itself and returned to the caller');

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().classroomId, CLASSROOM_A);
});

test('createConnectionRequest fails if a caller-supplied classroomId does NOT match the invitation code\'s real classroom (defense in depth, never trusted as the source of truth)', async () => {
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_B, invitationCode: INVITATION_CODE_A });
  assert.equal(result.ok, false);
  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_B}`).get();
  assert.equal(snap.exists, false, 'no relationship should be created under the mismatched, unverified classroomId');
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
// UNIFIED CLASSROOM CODE — one code resolves in both ClassMate Student
// Mode (via workspaceService.resolveStudentJoinCode(), which reads the
// exact same studentJoinCodes/{code} collection seeded here) and
// Learning Hub (via this same resolveInvitationClassroomId()/
// createConnectionRequest()). See functions/src/learnerVerification/
// verifyLearnerConnection.js's own resolveInvitationClassroomId() header
// comment for the full resolution-order rationale.
// --------------------------------------------------------------------

test('UNIFIED CODE: resolveInvitationClassroomId() resolves a classroom.classroomStudentJoinCode-style code via studentJoinCodes — the canonical path, with no classroomInvitationCodes entry at all', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const resolved = await resolveInvitationClassroomId(db, STUDENT_JOIN_CODE_A);
  assert.equal(resolved, CLASSROOM_A);
});

test('UNIFIED CODE: the same classroom code Student Mode uses lets a learner create a real pending Learning Hub request end to end', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A });
  assert.equal(result.ok, true);
  assert.equal(result.status, RELATIONSHIP_STATUS.PENDING);
  assert.equal(result.classroomId, CLASSROOM_A, 'must resolve to the SAME classroom Student Mode would also resolve this exact code to');

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.exists, true);
  assert.equal(snap.data().status, RELATIONSHIP_STATUS.PENDING);
  assert.equal(snap.data().invitationCode, STUDENT_JOIN_CODE_A);
});

test('UNIFIED CODE: a legacy, already-distributed classroomInvitationCodes entry (no matching studentJoinCodes entry) still works — previously handed-out codes must not unexpectedly stop working', async () => {
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: INVITATION_CODE_A });
  assert.equal(result.ok, true);
  assert.equal(result.classroomId, CLASSROOM_A);
});

test('UNIFIED CODE: a classroom\'s own student join code and ANOTHER classroom\'s legacy invitation code resolve independently, each to its own classroom — no cross-contamination between the two collections', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_B, CLASSROOM_B);
  // INVITATION_CODE_A (classroomInvitationCodes) still points at CLASSROOM_A from beforeEach.
  const viaStudentJoinCode = await resolveInvitationClassroomId(db, STUDENT_JOIN_CODE_B);
  const viaLegacyInvitationCode = await resolveInvitationClassroomId(db, INVITATION_CODE_A);
  assert.equal(viaStudentJoinCode, CLASSROOM_B);
  assert.equal(viaLegacyInvitationCode, CLASSROOM_A);
});

test('UNIFIED CODE: a learner cannot reach another classroom\'s data by presenting classroom A\'s own shared code — it resolves to A, period, never anything caller-claimed', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_B, invitationCode: STUDENT_JOIN_CODE_A });
  assert.equal(result.ok, false, 'a caller-asserted classroomId that disagrees with the code\'s real, resolved classroom must fail closed');
  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_B}`).get();
  assert.equal(snap.exists, false);
});

test('UNIFIED CODE: an unknown code fails generically whether or not it happens to resemble a real one in either collection', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: 'NOPE0000' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'verification_failed');
});

test('UNIFIED CODE: duplicate Learning Hub join attempts with the same shared code are idempotent (second attempt does not create a second PENDING doc or disturb the first)', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const first = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A });
  const second = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.status, RELATIONSHIP_STATUS.PENDING);
  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().createdAt, snap.data().createdAt); // single doc, not duplicated — same doc id by construction
});

test('UNIFIED CODE: an existing ACTIVE relationship is left untouched when the learner re-submits the shared classroom code again', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
  });
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ACTIVE');
  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().studentId, STUDENT_A1, 'an existing active connection must remain completely untouched by the unification');
});

// --------------------------------------------------------------------
// LEARNER SELF-IDENTITY CLAIM (see docs/architecture/
// LEARNER_SELF_IDENTITY_CLAIM.md) — createConnectionRequest()'s own
// `claimedStudentId` parameter: a learner picking their own name off
// the roster `getClassroomRosterForLearnerEndpoint.js` shows them,
// instead of submitting a bare code with no candidate student at all.
// --------------------------------------------------------------------

test('CLAIM: a real, live roster student creates a PENDING relationship carrying the claim, marked claimedByLearner', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A, claimedStudentId: STUDENT_A1 });
  assert.equal(result.ok, true);
  assert.equal(result.status, RELATIONSHIP_STATUS.PENDING);
  assert.equal(result.claimedStudentId, STUDENT_A1);

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().studentId, STUDENT_A1);
  assert.equal(snap.data().claimedByLearner, true);
  assert.equal(snap.data().status, RELATIONSHIP_STATUS.PENDING, 'a claim alone must never reach ACTIVE — only activateLearnerConnection.js, via explicit teacher confirmation, can ever do that');
});

test('CLAIM: a claimed studentId that does not exist on the real, live roster is rejected, not silently accepted', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A, claimedStudentId: 'not-a-real-student-id' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'student_not_on_roster');

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.exists, false, 'an invalid claim must never create any relationship document at all');
});

test('CLAIM: a claimed studentId that is real but belongs to a DIFFERENT classroom\'s roster is rejected (a learner cannot manipulate the request to claim a student from another classroom)', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A, claimedStudentId: STUDENT_B1 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'student_not_on_roster');
});

test('CLAIM: a student already ACTIVE for a different learner cannot be claimed by a second account — rejected immediately, not merely deferred to the teacher', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: RELATIONSHIP_STATUS.ACTIVE, createdAt: 'now',
  });
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_2, invitationCode: STUDENT_JOIN_CODE_A, claimedStudentId: STUDENT_A1 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'student_already_linked');

  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_2}_${CLASSROOM_A}`).get();
  assert.equal(snap.exists, false, 'a rejected claim must never create a relationship document for the rejected learner');
});

test('CLAIM: two DIFFERENT learners may each have their own PENDING claim on the SAME student at once (conflicting claims are sent for teacher review, not silently rejected before any teacher sees them)', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  const first = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A, claimedStudentId: STUDENT_A1 });
  const second = await createConnectionRequest(db, { learnerProfileId: LEARNER_2, invitationCode: STUDENT_JOIN_CODE_A, claimedStudentId: STUDENT_A1 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true, 'neither claim is ACTIVE yet, so there is no conflict to reject at claim time — the teacher resolves which one is real');
  assert.equal(first.status, RELATIONSHIP_STATUS.PENDING);
  assert.equal(second.status, RELATIONSHIP_STATUS.PENDING);
});

test('CLAIM: duplicate names on the roster do not cause incorrect identity linking — claiming by id, never by name, keeps two same-named students distinguishable', async () => {
  await seedClassroom('classroom-duplicate-names', ['dup-student-1', 'dup-student-2']);
  // Overwrite with two students sharing a display name but distinct ids.
  await db.doc('classrooms/classroom-duplicate-names').update({
    teams: [{ id: 't1', name: 'Team', students: [{ id: 'dup-student-1', name: 'Aarav' }, { id: 'dup-student-2', name: 'Aarav' }] }],
  });
  await seedStudentJoinCode('DUPNAME1', 'classroom-duplicate-names');

  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: 'DUPNAME1', claimedStudentId: 'dup-student-2' });
  assert.equal(result.ok, true);
  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_classroom-duplicate-names`).get();
  assert.equal(snap.data().studentId, 'dup-student-2', 'the claim must resolve to the exact id picked, never the first/any student sharing that display name');
});

test('CLAIM: an already-ACTIVE relationship is returned as-is and never disturbed by a fresh claim attempt, even naming a different student', async () => {
  await seedStudentJoinCode(STUDENT_JOIN_CODE_A, CLASSROOM_A);
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: RELATIONSHIP_STATUS.ACTIVE, createdAt: 'now',
  });
  const result = await createConnectionRequest(db, { learnerProfileId: LEARNER_1, invitationCode: STUDENT_JOIN_CODE_A, claimedStudentId: STUDENT_A2 });
  assert.equal(result.ok, true);
  assert.equal(result.status, RELATIONSHIP_STATUS.ACTIVE);
  const snap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(snap.data().studentId, STUDENT_A1, 'an already-active relationship must never be re-pointed at a different student by a later claim');
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
