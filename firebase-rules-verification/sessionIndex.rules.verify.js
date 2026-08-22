/**
 * firebase-rules-verification/sessionIndex.rules.verify.js
 *
 * PHASE 3.7 — new suite for the sessionIndex rule
 * (learningProgrammes/{programmeId}/sessionIndex/{sessionId}): the
 * lightweight, non-sensitive per-session pointer (date only) that
 * lets a linked, active student discover which sessions exist for a
 * programme without ever reading the shared, teacher-facing
 * programmeSessions document. Same isolation conventions as every
 * other harness file in this directory: not named `.test.js`, reads
 * the real `../firestore.rules` directly, uses only synthetic IDs.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-sessionindex-rules-verification';

const CLASSROOM_ID = 'classroom-test';
const PROGRAMME_ID = 'programme-test';
const SESSION_ID = 'programme-test__2026-08-19';

function sessionIndexPath(classroomId, programmeId, sessionId) {
  return `classrooms/${classroomId}/learningProgrammes/${programmeId}/sessionIndex/${sessionId}`;
}
function linkPath(classroomId, programmeId, uid) {
  return `classrooms/${classroomId}/learningProgrammes/${programmeId}/membershipLinks/${uid}`;
}

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('../firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'classrooms', CLASSROOM_ID), { memberUids: ['teacher-uid-test'] });
    await setDoc(doc(db, linkPath(CLASSROOM_ID, PROGRAMME_ID, 'uid-active')), {
      studentId: 'student-A', joinedAt: '2026-01-01T00:00:00.000Z', status: 'active',
    });
  });
});

test('1. Teacher (classroom memberUid) reads a sessionIndex entry -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID)), { date: '2026-08-19' });
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID))));
});

test('2. Teacher creates a sessionIndex entry -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(setDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID)), { date: '2026-08-19' }));
});

test('3. A student with an active membershipLinks entry for this programme reads a sessionIndex entry -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID)), { date: '2026-08-19' });
  });
  const db = testEnv.authenticatedContext('uid-active').firestore();
  await assertSucceeds(getDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID))));
});

test('4. A caller with no membershipLinks entry at all for this programme reads a sessionIndex entry -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID)), { date: '2026-08-19' });
  });
  const db = testEnv.authenticatedContext('uid-stranger').firestore();
  await assertFails(getDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID))));
});

test('5. A caller whose membershipLinks entry is not \'active\' reads a sessionIndex entry -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID)), { date: '2026-08-19' });
    await setDoc(doc(db, linkPath(CLASSROOM_ID, PROGRAMME_ID, 'uid-inactive')), {
      studentId: 'student-C', joinedAt: '2026-01-01T00:00:00.000Z', status: 'left',
    });
  });
  const db = testEnv.authenticatedContext('uid-inactive').firestore();
  await assertFails(getDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID))));
});

test('6. A student attempts to CREATE a sessionIndex entry -> DENY (teacher-only write)', async () => {
  const db = testEnv.authenticatedContext('uid-active').firestore();
  await assertFails(setDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID)), { date: '2026-08-19' }));
});

test('7. Unauthenticated read -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID)), { date: '2026-08-19' });
  });
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID))));
});

test('8. Unauthenticated write -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, sessionIndexPath(CLASSROOM_ID, PROGRAMME_ID, SESSION_ID)), { date: '2026-08-19' }));
});
