/**
 * firebase-rules-verification/teachingIdeas.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for the new, TOP-LEVEL
 * `teachingIdeas/{lessonPlanId}` collection (Phase 4 — see
 * repositories/teachingIdeasRepository.js and firestore.rules' own
 * header comment for that collection). Same conventions as
 * lessonPlans.rules.verify.js: reads the REAL ../firestore.rules,
 * synthetic-only fixture data, seeded fresh per test via
 * withSecurityRulesDisabled().
 *
 * Exercises exactly what the Phase 4 security requirements ask for:
 * global read, approved-only + same-classroom-scoped create, no
 * update/delete ever, and that provenance/identity can't be forged.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-teachingideas-rules-verification';

function ideaPath(lessonPlanId) {
  return `teachingIdeas/${lessonPlanId}`;
}
function planPath(classroomId, lessonPlanId) {
  return `classrooms/${classroomId}/lessonPlans/${lessonPlanId}`;
}

// The REAL source LessonPlan's own content fields — shared verbatim by
// the seeded source plan and the default valid projection below, so a
// legitimate publish (content copied faithfully) passes by
// construction, and any test that wants to simulate forgery does so by
// overriding exactly one field on ONLY ONE side (see the "forgery"
// tests further down) rather than the two fixtures drifting apart by
// accident.
const SOURCE_PLAN_CONTENT = Object.freeze({
  conceptIds: ['concept-fractions'],
  gradeLabel: 'Grade 6',
  subjectId: 'subject-math',
  topic: 'Comparing Fractions',
  lessonObjective: 'Students will compare two fractions.',
  bigQuestion: 'How can you prove that 3/4 is greater than 2/3?',
  swbatObjectives: ['Compare two fractions using a model.'],
  selfOthersIndia: { self: 'Confidence reasoning with numbers.', others: 'Explaining reasoning to peers.', india: 'Fair division examples.' },
  assessments: [{ id: 'assessment-1', description: 'Exit ticket: order three fractions.' }],
  spark: { title: 'Which fraction is hiding?', teacherAction: 'Cover part of a shape.', studentAction: 'Guess the fraction.' },
  activities: [{ id: 'activity-1', title: 'Human Number Line', teacherAction: 'Mark a line on the floor.', studentAction: 'Stand at your fraction’s position.', differentiation: { redBucket: '', greenBucket: '', others: '' } }],
  pairExplanation: 'Explain your position to a partner.',
  finalQuestion: 'Which method was fastest?',
  teacherLookFors: 'Listen for correct fraction language.',
});

function seedSourcePlanData({ status = 'approved' } = {}) {
  return {
    id: 'plan-1',
    classroomId: 'classroom-1',
    createdByUid: 'teacher-1',
    status,
    ...SOURCE_PLAN_CONTENT,
  };
}

function validProjection(overrides = {}) {
  return {
    sourceLessonPlanId: 'plan-1',
    sourceClassroomId: 'classroom-1',
    teacherDisplayName: 'Anu',
    publishedAt: '2026-09-04T00:00:00.000Z',
    ...SOURCE_PLAN_CONTENT,
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

async function seedClassroomAndPlan({ status = 'approved', withIdea = false } = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    // `context.firestore()` called ONCE and reused for every setDoc
    // below — calling it again per-document within the same callback
    // triggers a spurious "Firestore has already been started" client
    // error on this SDK version, unrelated to the rules themselves.
    const db = context.firestore();
    await setDoc(doc(db, 'classrooms', 'classroom-1'), {
      ownerUid: 'teacher-1',
      memberUids: ['teacher-1', 'pm-1'],
      members: {
        'teacher-1': { role: 'teacher', displayName: 'Anu' },
        'pm-1': { role: 'teacher', displayName: 'Reviewer PM' },
      },
    });
    await setDoc(doc(db, planPath('classroom-1', 'plan-1')), seedSourcePlanData({ status }));
    await setDoc(doc(db, 'classrooms', 'other-classroom'), {
      ownerUid: 'outsider-uid',
      memberUids: ['outsider-uid'],
      members: { 'outsider-uid': { role: 'teacher', displayName: 'Outsider' } },
    });
    if (withIdea) {
      await setDoc(doc(db, ideaPath('plan-1')), validProjection());
    }
  });
}

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ---------------------------------------------------------------------
// Read — global, authentication required
// ---------------------------------------------------------------------

test('1. unauthenticated read -> DENY', async () => {
  await seedClassroomAndPlan({ withIdea: true });
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, ideaPath('plan-1'))));
});

test('2. any authenticated ClassMate user reads a Teaching Idea, even one from a classroom they have never been a member of -> ALLOW (the explicit "globally discoverable" requirement)', async () => {
  await seedClassroomAndPlan({ withIdea: true });
  const outsiderDb = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertSucceeds(getDoc(doc(outsiderDb, ideaPath('plan-1'))));

  const totalStrangerDb = testEnv.authenticatedContext('total-stranger-uid').firestore();
  await assertSucceeds(getDoc(doc(totalStrangerDb, ideaPath('plan-1'))));
});

// ---------------------------------------------------------------------
// Create — only approved content, only by a same-classroom member, id/identity can't be forged
// ---------------------------------------------------------------------

test('3. a member of the source classroom publishes a Teaching Idea for a plan that IS actually approved -> ALLOW', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertSucceeds(setDoc(doc(db, ideaPath('plan-1')), validProjection()));
});

test('4. publishing is refused when the REAL source LessonPlan is NOT actually approved (submitted/draft/changes_requested), regardless of what the write claims', async () => {
  for (const status of ['draft', 'submitted', 'changes_requested']) {
    await seedClassroomAndPlan({ status });
    const db = testEnv.authenticatedContext('teacher-1').firestore();
    await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection()));
  }
});

test('5. an unauthenticated or non-member user cannot publish anything, even attributing it to a real approved plan -> DENY', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const unauthedDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthedDb, ideaPath('plan-1')), validProjection()));

  const outsiderDb = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(setDoc(doc(outsiderDb, ideaPath('plan-1')), validProjection()));

  const strangerDb = testEnv.authenticatedContext('total-stranger-uid').firestore();
  await assertFails(setDoc(doc(strangerDb, ideaPath('plan-1')), validProjection()));
});

test('6. a member of a DIFFERENT classroom cannot publish an entry claiming to be from classroom-1, even if they try to attribute it to a real approved plan there -> DENY (classroom scope on the publisher)', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('outsider-uid').firestore(); // member of other-classroom, not classroom-1
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection()));
});

test('7. the document id must match its own claimed sourceLessonPlanId -> DENY otherwise (cannot publish plan A\'s content under plan B\'s id)', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  // Real doc id is "plan-1" but the payload claims a different sourceLessonPlanId.
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ sourceLessonPlanId: 'plan-999' })));
});

test('8. forged sourceClassroomId (claiming a DIFFERENT real classroom the writer belongs to, for a plan that does not exist there) -> DENY', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  // outsider-uid is a real member of "other-classroom" — but plan-1 does not exist under other-classroom's own lessonPlans subcollection.
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ sourceClassroomId: 'other-classroom' })));
});

test('9. a co-teacher of the SAME classroom (not just the plan\'s own author) may also publish -> ALLOW (publishing isn\'t restricted to the exact reviewer/author, only to classroom membership + the plan actually being approved)', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('pm-1').firestore(); // co-teacher, not the plan's own createdByUid
  await assertSucceeds(setDoc(doc(db, ideaPath('plan-1')), validProjection()));
});

// ---------------------------------------------------------------------
// Content fidelity — a legitimate publisher (real member, real approved
// plan, correct id/classroom) still cannot make the PUBLISHED CONTENT
// diverge from what the real source LessonPlan actually says. Closes
// the gap where identity/status checks passed but content was never
// verified against the real source document.
// ---------------------------------------------------------------------

test('13. a real member publishing for a real approved plan cannot forge the topic -> DENY', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ topic: 'A Totally Different, Forged Topic' })));
});

test('14. a real member publishing for a real approved plan cannot forge the activities content -> DENY', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({
    activities: [{ id: 'activity-1', title: 'Fabricated Activity Nobody Reviewed', teacherAction: '', studentAction: '', differentiation: null }],
  })));
});

test('15. a real member publishing for a real approved plan cannot forge the spark, assessments, bigQuestion, or lessonObjective -> DENY', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ spark: { title: 'Forged Spark', teacherAction: 'x', studentAction: 'x' } })));
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ assessments: [{ id: 'forged', description: 'Forged assessment' }] })));
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ bigQuestion: 'Forged big question' })));
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ lessonObjective: 'Forged objective' })));
});

test('16. a real member cannot forge attribution by claiming to be a different real classroom member (teacherDisplayName mismatch with createdByUid) -> DENY', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  // plan-1's createdByUid is teacher-1 ("Anu"); claiming the co-teacher's name instead is a forged attribution.
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ teacherDisplayName: 'Reviewer PM' })));
});

test('17. a real member cannot forge conceptIds, gradeLabel, or subjectId away from the real source plan -> DENY', async () => {
  await seedClassroomAndPlan({ status: 'approved' });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ conceptIds: ['concept-unrelated'] })));
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ gradeLabel: 'Grade 9' })));
  await assertFails(setDoc(doc(db, ideaPath('plan-1')), validProjection({ subjectId: 'subject-science' })));
});

// ---------------------------------------------------------------------
// Immutability — no update, no delete, ever, by anyone
// ---------------------------------------------------------------------

test('10. update is always denied, even by the original publisher, even to fields that look harmless -> DENY (permanently immutable once published)', async () => {
  await seedClassroomAndPlan({ status: 'approved', withIdea: true });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(updateDoc(doc(db, ideaPath('plan-1')), { topic: 'Edited after publishing' }));
});

test('11. delete is always denied, for anyone, including the original publisher -> DENY', async () => {
  await seedClassroomAndPlan({ status: 'approved', withIdea: true });
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(deleteDoc(doc(db, ideaPath('plan-1'))));
});

test('12. an arbitrary authenticated user (not a classroom member anywhere relevant) cannot create, update, or delete -> DENY across the board', async () => {
  await seedClassroomAndPlan({ status: 'approved', withIdea: true });
  const db = testEnv.authenticatedContext('total-stranger-uid').firestore();
  await assertFails(setDoc(doc(db, ideaPath('plan-2')), validProjection({ sourceLessonPlanId: 'plan-2' })));
  await assertFails(updateDoc(doc(db, ideaPath('plan-1')), { topic: 'Hacked' }));
  await assertFails(deleteDoc(doc(db, ideaPath('plan-1'))));
});
