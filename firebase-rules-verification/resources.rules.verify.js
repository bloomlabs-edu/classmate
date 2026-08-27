/**
 * firebase-rules-verification/resources.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for the new
 * classrooms/{classroomId}/resources/{resourceId} rule — fixes the
 * pre-existing gap flagged in this project's own firestore.rules
 * history (no rule existed at all; fell through to deny-by-default,
 * making resource create/read/update/delete non-functional in
 * production). Same conventions as lessons.rules.verify.js and the
 * other *.rules.verify.js files in this directory: reads the REAL
 * ../firestore.rules, synthetic-only fixture data, seeded fresh per
 * test.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-resources-rules-verification';

function resourcePath(classroomId, resourceId) {
  return `classrooms/${classroomId}/resources/${resourceId}`;
}

// Matches models/Resource.js's own createResource() shape.
const VALID_RESOURCE = Object.freeze({
  title: 'NCERT Measurement chapter',
  type: 'external_link',
  status: 'draft',
  content: { url: 'https://ncert.nic.in/measurement', description: 'Chapter PDF' },
  audience: 'teacher',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
});

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
    await setDoc(doc(context.firestore(), 'classrooms', 'classroom-test'), {
      ownerUid: 'teacher-uid-test',
      memberUids: ['teacher-uid-test'],
    });
  });
});

test('1. classroom member creates a Resource -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(setDoc(doc(db, resourcePath('classroom-test', 'resource-1')), VALID_RESOURCE));
});

test('2. any authenticated user (not just a classroom member) reads a Resource -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), resourcePath('classroom-test', 'resource-1')), VALID_RESOURCE);
  });
  const memberDb = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(memberDb, resourcePath('classroom-test', 'resource-1'))));

  const outsiderDb = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertSucceeds(getDoc(doc(outsiderDb, resourcePath('classroom-test', 'resource-1'))));
});

test('3. classroom member updates a Resource (e.g. renaming, changing status) -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), resourcePath('classroom-test', 'resource-1')), VALID_RESOURCE);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, resourcePath('classroom-test', 'resource-1')), { status: 'published' }));
});

test('4. classroom member deletes a Resource -> ALLOW (unlike lessons, resourceService.deleteResource() is a real, existing teacher-facing action)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), resourcePath('classroom-test', 'resource-1')), VALID_RESOURCE);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(deleteDoc(doc(db, resourcePath('classroom-test', 'resource-1'))));
});

test('5. non-member cannot create, update, or delete a Resource -> DENY (unbroadened by the read rule above)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), resourcePath('classroom-test', 'resource-1')), VALID_RESOURCE);
  });
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(setDoc(doc(db, resourcePath('classroom-test', 'resource-2')), VALID_RESOURCE));
  await assertFails(updateDoc(doc(db, resourcePath('classroom-test', 'resource-1')), { status: 'published' }));
  await assertFails(deleteDoc(doc(db, resourcePath('classroom-test', 'resource-1'))));
});

test('6. unauthenticated read/write -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, resourcePath('classroom-test', 'resource-1'))));
  await assertFails(setDoc(doc(db, resourcePath('classroom-test', 'resource-1')), VALID_RESOURCE));
});
