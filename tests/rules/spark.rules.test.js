/**
 * tests/rules/spark.rules.test.js
 *
 * Real Firestore Rules Emulator tests for the new top-level
 * `sparks/{sparkId}` collection (see models/Spark.js). Proves: any
 * authenticated user can read (shared discovery); a Fellow can create
 * a Spark only under their own createdByUid; nobody but the creator can
 * update or delete it; and — the explicit security requirement this
 * collection exists to satisfy — a Spark's provenance (createdByUid,
 * createdAt) can never be reassigned, even by its own creator.
 *
 * Requires the Firestore emulator running locally:
 *   firebase emulators:exec --only firestore "node --test tests/rules/spark.rules.test.js"
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';

let testEnv;

const FELLOW_A = 'fellow-a-uid';
const FELLOW_B = 'fellow-b-uid';
const OUTSIDER = 'outsider-uid';

const SPARK_ID = 'spark-1';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-classmate-spark-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

function asFellowA() {
  return testEnv.authenticatedContext(FELLOW_A).firestore();
}
function asFellowB() {
  return testEnv.authenticatedContext(FELLOW_B).firestore();
}
function asOutsider() {
  return testEnv.authenticatedContext(OUTSIDER).firestore();
}

function baseSpark(overrides = {}) {
  return {
    title: 'Plant Kingdom Ladder',
    description: 'A visual ladder sorting plants by structure.',
    sparkType: 'activity',
    instructions: 'Give each pair a set of plant cards to sort onto the ladder.',
    createdByUid: FELLOW_A,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    subjectIds: ['science'],
    gradeLevels: ['Grade 8'],
    conceptIds: [],
    curriculumUnitIds: [],
    linkedCurriculumUnitId: 'curriculum-index-unit-17',
    estimatedTime: '15 mins',
    resourceRefs: [],
    visibility: 'shared',
    tags: ['plant-kingdom'],
    ...overrides,
  };
}

async function seedSpark(data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'sparks', SPARK_ID), data);
  });
}

// ---------------------------------------------------------------------
// Read — shared discovery
// ---------------------------------------------------------------------

test('any authenticated user (not just the creator, not just a co-teacher) can read a Spark', async () => {
  await seedSpark(baseSpark());
  await assertSucceeds(getDoc(doc(asOutsider(), 'sparks', SPARK_ID)));
  await assertSucceeds(getDoc(doc(asFellowB(), 'sparks', SPARK_ID)));
});

// ---------------------------------------------------------------------
// Create — provenance cannot be forged
// ---------------------------------------------------------------------

test('a Fellow can create a Spark under their own createdByUid', async () => {
  await assertSucceeds(setDoc(doc(asFellowA(), 'sparks', SPARK_ID), baseSpark()));
});

test('a Fellow cannot create a Spark claiming a different createdByUid — provenance cannot be spoofed at creation', async () => {
  await assertFails(setDoc(doc(asFellowA(), 'sparks', SPARK_ID), baseSpark({ createdByUid: FELLOW_B })));
});

// ---------------------------------------------------------------------
// Update — only the creator, ever; provenance immutable even to them
// ---------------------------------------------------------------------

test('the creator can edit their own Spark\'s content', async () => {
  await seedSpark(baseSpark());
  await assertSucceeds(
    updateDoc(doc(asFellowA(), 'sparks', SPARK_ID), {
      description: 'A revised description.',
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});

test('another Fellow cannot silently modify another Fellow\'s Spark — no shared/co-edit permission exists in this phase', async () => {
  await seedSpark(baseSpark());
  await assertFails(
    updateDoc(doc(asFellowB(), 'sparks', SPARK_ID), {
      description: 'Anu\'s own edit to Rejeesh\'s Spark.',
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});

test('an outsider cannot modify a Spark either', async () => {
  await seedSpark(baseSpark());
  await assertFails(updateDoc(doc(asOutsider(), 'sparks', SPARK_ID), { title: 'Hijacked' }));
});

test('even the creator cannot reassign their Spark\'s own createdByUid to someone else', async () => {
  await seedSpark(baseSpark());
  await assertFails(updateDoc(doc(asFellowA(), 'sparks', SPARK_ID), { createdByUid: FELLOW_B }));
});

test('even the creator cannot backdate/forge their Spark\'s own createdAt', async () => {
  await seedSpark(baseSpark());
  await assertFails(updateDoc(doc(asFellowA(), 'sparks', SPARK_ID), { createdAt: '2020-01-01T00:00:00.000Z' }));
});

test('the creator CAN add a resourceRef pointing at a Resource in a different classroom — a plain content edit, no different from any other field', async () => {
  await seedSpark(baseSpark());
  await assertSucceeds(
    updateDoc(doc(asFellowA(), 'sparks', SPARK_ID), {
      resourceRefs: [{ classroomId: 'some-other-classroom', resourceId: 'some-resource-id' }],
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});

// ---------------------------------------------------------------------
// Delete — only the creator
// ---------------------------------------------------------------------

test('the creator can delete their own Spark', async () => {
  await seedSpark(baseSpark());
  await assertSucceeds(deleteDoc(doc(asFellowA(), 'sparks', SPARK_ID)));
});

test('another Fellow cannot delete a Spark they did not create', async () => {
  await seedSpark(baseSpark());
  await assertFails(deleteDoc(doc(asFellowB(), 'sparks', SPARK_ID)));
});
