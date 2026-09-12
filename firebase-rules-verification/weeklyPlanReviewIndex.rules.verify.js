/**
 * firebase-rules-verification/weeklyPlanReviewIndex.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for the top-level
 * `weeklyPlanReviewIndex/{lessonPlanId}` collection (Programme Manager
 * Weekly Plan Review). Same conventions as lessonPlans.rules.verify.js
 * and the other *.rules.verify.js files in this directory: reads the
 * REAL ../firestore.rules, synthetic-only fixture data, seeded fresh per
 * test via withSecurityRulesDisabled().
 *
 * The central property this file exists to prove: the index is a
 * discovery aid, NEVER a security boundary of its own. Every test here
 * either confirms it grants no MORE access than the real
 * `classrooms/{classroomId}/lessonPlans/{lessonPlanId}` document already
 * would for the same uid, or confirms a write can't misrepresent that
 * real document's current status.
 */

import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-weeklyplanreviewindex-rules-verification';

function planPath(classroomId, lessonPlanId) {
  return `classrooms/${classroomId}/lessonPlans/${lessonPlanId}`;
}

function indexPath(lessonPlanId) {
  return `weeklyPlanReviewIndex/${lessonPlanId}`;
}

function draftPlan(overrides = {}) {
  return {
    id: 'plan-1',
    classroomId: 'classroom-test',
    createdByUid: 'teacher-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    subjectId: null,
    curriculumUnitId: null,
    conceptIds: [],
    gradeLabel: 'Grade 8',
    topic: 'Original Topic',
    lessonObjective: '',
    swbatObjectives: [],
    bigQuestion: '',
    selfOthersIndia: { self: '', others: '', india: '' },
    assessments: [],
    spark: { title: '', teacherAction: '', studentAction: '' },
    activities: [],
    pairExplanation: '',
    finalQuestion: '',
    teacherLookFors: '',
    status: 'draft',
    reviewerUid: null,
    reviewHistory: [],
    activeComments: [],
    sourceElementRefs: [],
    ...overrides,
  };
}

function indexEntry(overrides = {}) {
  return {
    lessonPlanId: 'plan-1',
    classroomId: 'classroom-test',
    createdByUid: 'teacher-1',
    teacherDisplayName: 'Teacher One',
    subjectId: null,
    scheduledDate: '2026-09-08',
    status: 'submitted',
    submissionLabel: 'Submitted',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
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

async function seedClassroom(classroomId, members) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', classroomId), {
      ownerUid: Object.keys(members)[0],
      memberUids: Object.keys(members),
      members,
    });
  });
}

async function seedPlan(classroomId, lessonPlanId, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), planPath(classroomId, lessonPlanId)), data);
  });
}

async function seedIndexEntry(lessonPlanId, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), indexPath(lessonPlanId)), data);
  });
}

const TWO_TEACHERS = {
  'teacher-1': { role: 'teacher', displayName: 'Teacher One' },
  'pm-1': { role: 'program_manager', displayName: 'A Programme Manager' },
};

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ---------------------------------------------------------------------
// Read — same membership scope as the canonical lessonPlans collection
// ---------------------------------------------------------------------

test('1. unauthenticated read -> DENY', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedIndexEntry('plan-1', indexEntry());
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, indexPath('plan-1'))));
});

test('2. a real member of the classroom this entry belongs to can read it -> ALLOW', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedIndexEntry('plan-1', indexEntry());
  const db = testEnv.authenticatedContext('pm-1').firestore();
  await assertSucceeds(getDoc(doc(db, indexPath('plan-1'))));
});

test('3. an authenticated user who is NOT a member of the classroom this entry claims -> DENY (an index entry existing is never enough on its own)', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedIndexEntry('plan-1', indexEntry());
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(getDoc(doc(db, indexPath('plan-1'))));
});

test('4. a member of a DIFFERENT classroom entirely cannot read this entry -> DENY (cross-classroom denial, same as the canonical lessonPlans rule)', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedIndexEntry('plan-1', indexEntry());
  await seedClassroom('other-classroom', { 'other-teacher': { role: 'teacher', displayName: 'Other Teacher' } });
  const db = testEnv.authenticatedContext('other-teacher').firestore();
  await assertFails(getDoc(doc(db, indexPath('plan-1'))));
});

// ---------------------------------------------------------------------
// Create/update — must reflect the REAL canonical LessonPlan
// ---------------------------------------------------------------------

test('5. a classroom member creates an index entry whose status/createdByUid match the real, currently-SUBMITTED LessonPlan -> ALLOW', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedPlan('classroom-test', 'plan-1', draftPlan({ status: 'submitted', reviewHistory: [{ id: 'r1', status: 'submitted', byUid: 'teacher-1', at: '2026-09-01T00:00:00.000Z', comments: [] }] }));
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertSucceeds(setDoc(doc(db, indexPath('plan-1')), indexEntry({ status: 'submitted' })));
});

test('6. the SAME entry can later be overwritten (not a second document) once the real plan moves to APPROVED -> ALLOW', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedPlan('classroom-test', 'plan-1', draftPlan({ status: 'approved', reviewerUid: 'pm-1' }));
  await seedIndexEntry('plan-1', indexEntry({ status: 'submitted' }));

  const db = testEnv.authenticatedContext('pm-1').firestore();

  // A full setDoc, matching exactly how the real app writes this
  // collection (repositories/weeklyPlanReviewIndexRepository.js's own
  // upsertReviewIndexEntry() always setDoc()s the complete, freshly-built
  // entry — never a partial updateDoc()).
  await assertSucceeds(setDoc(doc(db, indexPath('plan-1')), indexEntry({ status: 'approved', submissionLabel: 'Submitted', updatedAt: '2026-09-03T00:00:00.000Z' })));

  // Read back through the SAME already-authorized pm-1 context (this
  // installed @firebase/rules-unit-testing version's own
  // withSecurityRulesDisabled() does not propagate a callback's return
  // value, so an ordinary authorized read is used instead — pm-1 has
  // real read access here per this collection's own `allow read`,
  // already proven by test 2 above).
  const afterSnapshot = await getDoc(doc(db, indexPath('plan-1')));
  assert.equal(afterSnapshot.data().status, 'approved');
});

test('7. a write claiming a status the REAL LessonPlan is not actually in -> DENY (the index can never misrepresent the canonical document)', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedPlan('classroom-test', 'plan-1', draftPlan({ status: 'draft' }));
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, indexPath('plan-1')), indexEntry({ status: 'submitted' })));
});

test('8. a write claiming a different createdByUid than the real LessonPlan -> DENY (attribution can\'t be forged either)', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedPlan('classroom-test', 'plan-1', draftPlan({ status: 'submitted', createdByUid: 'teacher-1' }));
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, indexPath('plan-1')), indexEntry({ status: 'submitted', createdByUid: 'someone-else' })));
});

test('9. a non-member of the classroom cannot create an index entry for it, even with byte-for-byte correct status/createdByUid -> DENY', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedPlan('classroom-test', 'plan-1', draftPlan({ status: 'submitted' }));
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(setDoc(doc(db, indexPath('plan-1')), indexEntry({ status: 'submitted' })));
});

test('10. the document id must match its own claimed lessonPlanId -> DENY (prevents an entry for one plan being written under another\'s id)', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedPlan('classroom-test', 'plan-1', draftPlan({ status: 'submitted' }));
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, indexPath('plan-1')), indexEntry({ lessonPlanId: 'a-different-plan-id', status: 'submitted' })));
});

test('11. delete is always denied', async () => {
  await seedClassroom('classroom-test', TWO_TEACHERS);
  await seedIndexEntry('plan-1', indexEntry());
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(deleteDoc(doc(db, indexPath('plan-1'))));
});
