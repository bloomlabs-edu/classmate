/**
 * firebase-rules-verification/programmeMemberships.rules.verify.js
 *
 * PHASE 3.7 — new suite for the direct membership security document's
 * own rule (learningProgrammes/{programmeId}/memberships/{studentId}):
 * teacher-only read/create/update, immutable-by-delete, matching the
 * classroom-membership convention every other teacher-owned
 * collection in this file already uses. This file tests the rule on
 * its own terms; membershipLinks.rules.verify.js separately tests
 * that membershipLinks' own create rule correctly RESOLVES this
 * document via get() as its preferred, OR-combined path. Same
 * isolation conventions as every other harness file in this
 * directory: not named `.test.js`, reads the real `../firestore.rules`
 * directly, uses only synthetic IDs.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-programmememberships-rules-verification';

const CLASSROOM_ID = 'classroom-test';
const PROGRAMME_ID = 'programme-test';

function membershipMirrorPath(classroomId, programmeId, studentId) {
  return `classrooms/${classroomId}/learningProgrammes/${programmeId}/memberships/${studentId}`;
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
    await setDoc(doc(context.firestore(), 'classrooms', CLASSROOM_ID), { memberUids: ['teacher-uid-test'] });
  });
});

test('1. Teacher creates a membership mirror document -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(setDoc(doc(db, membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' }));
});

test('2. Teacher reads a membership mirror document -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' });
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(db, membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A'))));
});

test('3. Teacher updates a membership mirror document (e.g. marking a student left) -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' });
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'left' }));
});

test('4. A non-teacher (not in classroom.memberUids) attempts to create a membership mirror document -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-not-a-teacher').firestore();
  await assertFails(setDoc(doc(db, membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' }));
});

test('5. A non-teacher attempts to read a membership mirror document -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' });
  });
  const db = testEnv.authenticatedContext('uid-not-a-teacher').firestore();
  await assertFails(getDoc(doc(db, membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A'))));
});

test('6. Delete a membership mirror document -> DENY (immutable-record convention, even for a teacher)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' });
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertFails(deleteDoc(doc(db, membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A'))));
});

test('7. Unauthenticated write -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' }));
});

test('8. Unauthenticated read -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' });
  });
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, membershipMirrorPath(CLASSROOM_ID, PROGRAMME_ID, 'student-A'))));
});
