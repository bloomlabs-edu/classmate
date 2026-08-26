/**
 * firebase-rules-verification/lessons.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for the new
 * classrooms/{classroomId}/lessons/{lessonId} rule — fixes the
 * pre-existing gap flagged in this project's own firestore.rules
 * history (no rule existed at all; fell through to deny-by-default).
 * Same conventions as the other *.rules.verify.js files in this
 * directory: reads the REAL ../firestore.rules, synthetic-only
 * fixture data, seeded fresh per test.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-lessons-rules-verification';

function lessonPath(classroomId, lessonId) {
  return `classrooms/${classroomId}/lessons/${lessonId}`;
}

const VALID_LESSON = Object.freeze({
  classroomId: 'classroom-test',
  date: '2026-08-25',
  teachingSlotId: 'classroom-test_2026-08-25_p3',
  conceptIds: ['concept-A'],
  executedConceptIds: [],
  status: 'planned',
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

test('1. classroom member creates a Lesson -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(setDoc(doc(db, lessonPath('classroom-test', 'lesson-1')), VALID_LESSON));
});

test('2. classroom member reads a Lesson -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), lessonPath('classroom-test', 'lesson-1')), VALID_LESSON);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(db, lessonPath('classroom-test', 'lesson-1'))));
});

test('3. classroom member updates a Lesson (e.g. marking concepts executed) -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), lessonPath('classroom-test', 'lesson-1')), VALID_LESSON);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, lessonPath('classroom-test', 'lesson-1')), { executedConceptIds: ['concept-A'] }));
});

test('4. non-member cannot create or update a Lesson -> DENY (unchanged by the read broadening below)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), lessonPath('classroom-test', 'lesson-1')), VALID_LESSON);
  });
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(setDoc(doc(db, lessonPath('classroom-test', 'lesson-2')), VALID_LESSON));
  await assertFails(updateDoc(doc(db, lessonPath('classroom-test', 'lesson-1')), { status: 'taught' }));
});

test('4b. a non-member (e.g. an anonymous student device) CAN read a Lesson — the Phase M broadening, needed so a student can resolve a concept_feedback_available event\'s own lessonId pointer into the live executedConceptIds', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), lessonPath('classroom-test', 'lesson-1')), VALID_LESSON);
  });
  const db = testEnv.authenticatedContext('student-device-uid').firestore();
  await assertSucceeds(getDoc(doc(db, lessonPath('classroom-test', 'lesson-1'))));
});

test('5. delete a Lesson -> DENY, even for a classroom member (Lessons are never deleted, only moved between via carry-forward)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), lessonPath('classroom-test', 'lesson-1')), VALID_LESSON);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertFails(deleteDoc(doc(db, lessonPath('classroom-test', 'lesson-1'))));
});

test('6. unauthenticated read/write -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, lessonPath('classroom-test', 'lesson-1'))));
  await assertFails(setDoc(doc(db, lessonPath('classroom-test', 'lesson-1')), VALID_LESSON));
});
