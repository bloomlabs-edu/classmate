/**
 * tests/functions/verifyLearnerConnectionEndpoint.test.js
 *
 * Real emulator tests (Firestore + Auth) for
 * functions/src/verifyLearnerConnectionEndpoint.js — the trusted
 * endpoint's own core logic: authentication, identity binding, request
 * validation, and delegation to the already-tested
 * functions/src/learnerVerification/verifyLearnerConnection.js module.
 *
 * This suite deliberately does NOT re-prove every transaction-level
 * property already covered exhaustively by
 * tests/server/verifyLearnerConnection.test.js (concurrent redemption,
 * every isolation combination, etc.) — that would be redundant. It
 * proves the NEW layer this endpoint adds: that a caller must be a
 * real, authenticated Learning Hub identity; that their claimed
 * learnerProfileId must be bound to that identity (not merely
 * asserted); that studentId can never be injected as an input; and
 * that, once those gates pass, the endpoint faithfully delegates
 * without weakening anything underneath. A few representative
 * pass-through tests (concurrency, reuse, revocation, cross-classroom)
 * confirm the endpoint layer doesn't accidentally break those existing
 * guarantees — not a full re-proof of them.
 *
 * `verifyLearnerProfileOwnership` is exercised in TWO modes:
 *   - the REAL production default (functions/src/learnerProfileOwnership.js),
 *     which always returns false today — proving the strongest
 *     possible current guarantee: literally no caller, honest or not,
 *     can reach an ACTIVE relationship through this endpoint until a
 *     real cross-project identity contract exists (see that module's
 *     own header comment).
 *   - an INJECTED test-only resolver (via deps), used to prove the
 *     REST of the pipeline (validation, delegation, Firestore
 *     transaction behavior) is wired correctly once that resolver is
 *     eventually real — clearly separated so nobody mistakes the
 *     injected override for production behavior.
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
import { handleVerifyLearnerConnectionRequest } from '../../functions/src/verifyLearnerConnectionEndpoint.js';

const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const PROJECT_ID = 'demo-classmate-bridge-test-endpoint';

let app;
let db;
let validBearerToken;
const REAL_LEARNING_HUB_UID = 'endpoint-test-lh-uid';

const CLASSROOM_A = 'endpoint-classroom-a';
const CLASSROOM_B = 'endpoint-classroom-b';
const STUDENT_A1 = 'endpoint-student-a1';
const LEARNER_1 = 'endpoint-learner-1';
const LEARNER_2 = 'endpoint-learner-2';

before(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.LEARNING_HUB_FIREBASE_PROJECT_ID = PROJECT_ID;
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'verify-endpoint-tests');
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

async function seedClassroom(classroomId, students) {
  await db.doc(`classrooms/${classroomId}`).set({
    ownerUid: 'endpoint-teacher',
    memberUids: ['endpoint-teacher'],
    teams: [{ id: 't1', name: 'Team', students: students.map((id) => ({ id, name: id })) }],
  });
}

async function seedInvitationCode(code, classroomId) {
  await db.doc(`classroomInvitationCodes/${code}`).set({ classroomId, invitationId: 'inv-endpoint', status: 'active', createdAt: 'now' });
}

async function seedVerificationCode(classroomId, studentId, learnerProfileId, rawCode) {
  const { sha256Hex } = await import('../../functions/src/learnerVerification/hashUtils.js');
  const codeHash = sha256Hex(rawCode);
  await db.doc(`classrooms/${classroomId}/studentVerificationCodes/${codeHash}`).set({
    codeHash, classroomId, studentId, learnerProfileId, status: 'active', createdByUid: 'endpoint-teacher', createdAt: 'now', expiresAt: '2099-01-01T00:00:00.000Z',
  });
}

beforeEach(async () => {
  await Promise.all([wipe('classrooms'), wipe('classroomInvitationCodes'), wipe('learnerClassroomRelationships')]);
  for (const classroomId of [CLASSROOM_A, CLASSROOM_B]) {
    const snap = await db.collection(`classrooms/${classroomId}/studentVerificationCodes`).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await seedClassroom(CLASSROOM_A, [STUDENT_A1]);
  await seedClassroom(CLASSROOM_B, []);
  await seedInvitationCode('ENDPOINTINV', CLASSROOM_A);
});

// A resolver that only ever "trusts" one specific (uid, learnerProfileId)
// pair — the test-only stand-in for a future real cross-project check.
function ownershipResolverFor(trustedUid, trustedLearnerProfileId) {
  return async (uid, learnerProfileId) => uid === trustedUid && learnerProfileId === trustedLearnerProfileId;
}

// --------------------------------------------------------------------
// Authentication
// --------------------------------------------------------------------

test('missing Authorization header -> 401 unauthenticated', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: undefined,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'unauthenticated');
});

test('malformed Authorization header (no "Bearer " prefix) -> 401', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: 'Basic sometoken',
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 401);
});

test('invalid/garbage token -> 401', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: 'Bearer garbage-not-a-real-token',
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 401);
  assert.equal(body.error, 'unauthenticated');
});

test('a real Learning Hub token from the wrong project -> 401', async () => {
  const otherProjectToken = await mintEmulatorIdToken({ authEmulatorHost: AUTH_EMULATOR_HOST, projectId: PROJECT_ID, uid: REAL_LEARNING_HUB_UID });
  const { httpStatus } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: `Bearer ${otherProjectToken}`,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: {
      adminDb: db,
      verifyLearningHubIdToken: async () => null, // simulates learningHubAuth.js rejecting a wrong-project token (proven directly in learningHubAuth.test.js)
    },
  });
  assert.equal(httpStatus, 401);
});

test('a valid token authenticates successfully (proven by reaching past the 401 gate into request validation)', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { classroomId: CLASSROOM_A }, // deliberately incomplete, to prove we got PAST auth into validation, not that the whole request succeeds
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400); // invalid_request, not 401 — proves auth passed
  assert.equal(body.error, 'invalid_request');
});

// --------------------------------------------------------------------
// Request validation
// --------------------------------------------------------------------

test('missing classroomId is VALID for credentialType "invitation" — ClassMate\'s own invitation-sharing UI never hands it out, so the request must pass shape validation all the way through to a real success, not just avoid a 400', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, true, 'expected a real successful redemption, not merely "not a 400": ' + JSON.stringify(body));
  assert.equal(body.status, 'PENDING');
  assert.equal(body.classroomId, CLASSROOM_A, 'classroomId must be resolved from the invitation code itself');
});

test('missing classroomId -> 400 invalid_request for credentialType "verification" (structurally required to locate the nested studentVerificationCodes document)', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, credentialType: 'verification', credential: 'SOMECODE123' },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'invalid_request');
});

test('a mismatched classroomId for credentialType "invitation" fails generically, never trusted over the invitation code\'s own real classroom', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_B, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'verification_failed');
});

test('missing learnerProfileId -> 400 invalid_request', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
});

test('invalid credentialType -> 400 invalid_request', async () => {
  const { httpStatus } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'something-else', credential: 'ENDPOINTINV' },
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
});

test('malformed body (array instead of object) -> 400 invalid_request', async () => {
  const { httpStatus } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: ['not', 'an', 'object'],
    deps: { adminDb: db },
  });
  assert.equal(httpStatus, 400);
});

test('a request that includes a studentId field is rejected outright, even if every other field is valid (studentId injection attempt)', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV', studentId: STUDENT_A1 },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'invalid_request');
});

// --------------------------------------------------------------------
// Identity binding — the core trust-boundary property
// --------------------------------------------------------------------

test('PRODUCTION DEFAULT: even a fully authenticated, well-formed request cannot reach ACTIVE today — the real ownership resolver always fails closed', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db }, // no override — exercises the REAL functions/src/learnerProfileOwnership.js
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'verification_failed');
  const relSnap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(relSnap.exists, false, 'no relationship document of any kind should have been created');
});

test('SECURITY PROOF: Caller A (authenticated as REAL_LEARNING_HUB_UID) cannot submit Caller B\'s learnerProfileId and obtain an ACTIVE relationship, even with an injected resolver that only trusts a DIFFERENT uid for that profile', async () => {
  const resolverThatOnlyTrustsSomeoneElse = ownershipResolverFor('a-completely-different-uid', LEARNER_2);
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken, // authenticated as REAL_LEARNING_HUB_UID
    body: { learnerProfileId: LEARNER_2, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db, verifyLearnerProfileOwnership: resolverThatOnlyTrustsSomeoneElse },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, false);
  const relSnap = await db.doc(`learnerClassroomRelationships/${LEARNER_2}_${CLASSROOM_A}`).get();
  assert.equal(relSnap.exists, false);
});

test('with a resolver that legitimately trusts (uid, learnerProfileId), a valid invitation code produces a real PENDING relationship via the underlying module', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'PENDING');
  const relSnap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(relSnap.data().status, 'PENDING');
});

test('an ownership resolver throwing an error is treated as "not owned", not as an unhandled crash', async () => {
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps: {
      adminDb: db,
      verifyLearnerProfileOwnership: async () => { throw new Error('simulated cross-project lookup failure'); },
    },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, false);
});

// --------------------------------------------------------------------
// Delegation / pass-through — confirms the endpoint doesn't weaken
// what the underlying, already-tested module already guarantees
// --------------------------------------------------------------------

test('with a trusting resolver, a real verification code activates the relationship end-to-end through the endpoint', async () => {
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, 'ENDPOINTCODE1');
  const { httpStatus, body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'verification', credential: 'ENDPOINTCODE1' },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.ok, true);
  assert.equal(body.studentId, STUDENT_A1);
});

test('the same verification code cannot be redeemed twice through the endpoint (reuse still blocked underneath)', async () => {
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, 'ENDPOINTCODE2');
  const deps = { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) };
  const req = { authorizationHeader: validBearerToken, body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'verification', credential: 'ENDPOINTCODE2' }, deps };
  const first = await handleVerifyLearnerConnectionRequest(req);
  assert.equal(first.body.ok, true);
  const second = await handleVerifyLearnerConnectionRequest(req);
  assert.equal(second.body.ok, false);
});

test('a verification code from a DIFFERENT classroom cannot be redeemed through the endpoint (cross-classroom isolation still holds)', async () => {
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, 'ENDPOINTCODE3');
  const { body } = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_B, credentialType: 'verification', credential: 'ENDPOINTCODE3' },
    deps: { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) },
  });
  assert.equal(body.ok, false);
});

test('a REVOKED relationship is never resurrected straight to ACTIVE by an invitation replay through the endpoint — at most it restarts at PENDING, with studentId cleared, and still requires a fresh verification code to ever reach ACTIVE again', async () => {
  await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).set({
    learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'REVOKED', createdAt: 'now',
  });
  const deps = { adminDb: db, verifyLearnerProfileOwnership: ownershipResolverFor(REAL_LEARNING_HUB_UID, LEARNER_1) };
  const invitationReplay = await handleVerifyLearnerConnectionRequest({
    authorizationHeader: validBearerToken,
    body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
    deps,
  });
  assert.equal(invitationReplay.body.ok, true);
  assert.equal(invitationReplay.body.status, 'PENDING', 'the underlying module restarts a REVOKED relationship at PENDING — never straight to ACTIVE — matching the documented "re-verify from scratch" lifecycle');
  const relSnap = await db.doc(`learnerClassroomRelationships/${LEARNER_1}_${CLASSROOM_A}`).get();
  assert.equal(relSnap.data().status, 'PENDING');
  assert.equal(relSnap.data().studentId, null, 'the old studentId is cleared, not carried over from the revoked relationship');
});

test('concurrent redemption of the same code through the endpoint still resolves to exactly one success (the endpoint adds no non-atomic step of its own)', async () => {
  // Same rightful learner racing itself (e.g. a double-submit from two
  // tabs) — matching tests/server/verifyLearnerConnection.test.js's own
  // concurrency test. A code is bound to exactly one learnerProfileId
  // (see verifyLearnerConnection.js's own mis-binding check), so a
  // second, DIFFERENT learner racing for the same code would fail on
  // that binding check regardless of timing, which would no longer be
  // proving the atomicity property this test exists for.
  await seedVerificationCode(CLASSROOM_A, STUDENT_A1, LEARNER_1, 'ENDPOINTCONCURRENT1');
  const deps = { adminDb: db, verifyLearnerProfileOwnership: async () => true };
  const [a, b] = await Promise.all([
    handleVerifyLearnerConnectionRequest({ authorizationHeader: validBearerToken, body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'verification', credential: 'ENDPOINTCONCURRENT1' }, deps }),
    handleVerifyLearnerConnectionRequest({ authorizationHeader: validBearerToken, body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'verification', credential: 'ENDPOINTCONCURRENT1' }, deps }),
  ]);
  const successes = [a, b].filter((r) => r.body.ok);
  assert.equal(successes.length, 1);
});

test('adminDb is a required dependency — the endpoint refuses to guess/default a Firestore instance', async () => {
  await assert.rejects(() =>
    handleVerifyLearnerConnectionRequest({
      authorizationHeader: validBearerToken,
      body: { learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, credentialType: 'invitation', credential: 'ENDPOINTINV' },
      deps: {},
    })
  );
});
