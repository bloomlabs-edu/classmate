/**
 * firebase-rules-verification/activities.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for
 * classrooms/{classroomId}/activities/{activityId} — this collection
 * (repositories/activityRepository.js) shipped with NO rule of its
 * own, the exact same class of gap this project's own firestore.rules
 * history already hit once for Resources: it fell through to
 * deny-by-default, which broke ui/views/ConceptWorkspaceView.js's
 * entire render (not just its Activities tab), since rerender() always
 * awaits learningIntegrationService.getActivitiesForConcept() up
 * front regardless of which tab is active. Same conventions as
 * resources.rules.verify.js: reads the REAL ../firestore.rules,
 * synthetic-only fixture data, seeded fresh per test.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-activities-rules-verification';

function activityPath(classroomId, activityId) {
  return `classrooms/${classroomId}/activities/${activityId}`;
}

// Matches models/Activity.js's own createActivity() shape.
const VALID_ACTIVITY = Object.freeze({
  conceptId: 'concept-fractions',
  title: 'Human Number Line',
  description: 'Stand at your fraction’s position.',
  activityType: 'native',
  externalProvider: null,
  destination: null,
  scoreMax: null,
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
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

test('1. classroom member creates an Activity -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(setDoc(doc(db, activityPath('classroom-test', 'activity-1')), VALID_ACTIVITY));
});

test('2. any authenticated user (not just a classroom member) reads an Activity -> ALLOW (matches how ConceptWorkspaceView loads every classroom member\'s own Concept data)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), activityPath('classroom-test', 'activity-1')), VALID_ACTIVITY);
  });
  const memberDb = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(memberDb, activityPath('classroom-test', 'activity-1'))));

  const outsiderDb = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertSucceeds(getDoc(doc(outsiderDb, activityPath('classroom-test', 'activity-1'))));
});

test('3. classroom member updates an Activity -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), activityPath('classroom-test', 'activity-1')), VALID_ACTIVITY);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, activityPath('classroom-test', 'activity-1')), { title: 'Renamed Activity' }));
});

test('4. classroom member deletes an Activity -> ALLOW (activityRepository.deleteActivityDoc() is a real, existing action)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), activityPath('classroom-test', 'activity-1')), VALID_ACTIVITY);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(deleteDoc(doc(db, activityPath('classroom-test', 'activity-1'))));
});

test('5. non-member cannot create, update, or delete an Activity -> DENY (unbroadened by the read rule above)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), activityPath('classroom-test', 'activity-1')), VALID_ACTIVITY);
  });
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(setDoc(doc(db, activityPath('classroom-test', 'activity-2')), VALID_ACTIVITY));
  await assertFails(updateDoc(doc(db, activityPath('classroom-test', 'activity-1')), { title: 'Hacked' }));
  await assertFails(deleteDoc(doc(db, activityPath('classroom-test', 'activity-1'))));
});

test('6. unauthenticated read/write -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, activityPath('classroom-test', 'activity-1'))));
  await assertFails(setDoc(doc(db, activityPath('classroom-test', 'activity-1')), VALID_ACTIVITY));
});
