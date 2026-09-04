/**
 * firebase-rules-verification/lessonPlans.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for
 * classrooms/{classroomId}/lessonPlans/{lessonPlanId} (Phase 3 —
 * Lesson Plan Review). Same conventions as resources.rules.verify.js
 * and the other *.rules.verify.js files in this directory: reads the
 * REAL ../firestore.rules, synthetic-only fixture data, seeded fresh
 * per test via withSecurityRulesDisabled().
 *
 * Exercises the exact three holes the Phase 3 hardening pass closed
 * (see firestore.rules' own lessonPlans match block header comment):
 *   1. create can't start pre-approved / with fabricated history.
 *   2. the author is locked out entirely once SUBMITTED/APPROVED.
 *   3. a reviewer's write can never touch lesson CONTENT fields.
 * Plus the full set of scenarios explicitly requested for this
 * checkpoint: auth required, membership required, cross-classroom
 * denial, self-review/self-approval denial, spoofed review-history
 * denial, and approved-state immutability.
 */

import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-lessonplans-rules-verification';

function planPath(classroomId, lessonPlanId) {
  return `classrooms/${classroomId}/lessonPlans/${lessonPlanId}`;
}

// Matches models/LessonPlan.js's own createLessonPlan() shape closely
// enough for the rule to evaluate every field it actually reads.
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
    lessonObjective: 'Original objective',
    swbatObjectives: [],
    bigQuestion: 'Original question',
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

function submittedRound(byUid, comments = []) {
  return { id: 'round-1', status: 'submitted', byUid, at: '2026-09-01T00:00:00.000Z', comments };
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

async function seedClassroom(members) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', 'classroom-test'), {
      ownerUid: 'teacher-1',
      memberUids: Object.keys(members),
      members,
    });
  });
}

async function seedPlan(data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), planPath('classroom-test', 'plan-1')), data);
  });
}

const TWO_TEACHERS = {
  'teacher-1': { role: 'teacher', displayName: 'Teacher One' },
  'pm-1': { role: 'teacher', displayName: 'Reviewer PM' },
};

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ---------------------------------------------------------------------
// Authentication + membership
// ---------------------------------------------------------------------

test('1. unauthenticated read/write -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan());
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, planPath('classroom-test', 'plan-1'))));
  await assertFails(setDoc(doc(db, planPath('classroom-test', 'plan-2')), draftPlan({ id: 'plan-2' })));
});

test('2. authenticated but NOT a member of this classroom -> DENY read/create/update', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan());
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(getDoc(doc(db, planPath('classroom-test', 'plan-1'))));
  await assertFails(setDoc(doc(db, planPath('classroom-test', 'plan-2')), draftPlan({ id: 'plan-2', createdByUid: 'outsider-uid' })));
  await assertFails(updateDoc(doc(db, planPath('classroom-test', 'plan-1')), { topic: 'Hacked' }));
});

test('3. a member of a DIFFERENT classroom entirely -> DENY (cross-classroom access, even though they are a real classroom member somewhere)', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan());
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', 'other-classroom'), {
      ownerUid: 'other-teacher',
      memberUids: ['other-teacher'],
      members: { 'other-teacher': { role: 'teacher', displayName: 'Other Teacher' } },
    });
  });
  const db = testEnv.authenticatedContext('other-teacher').firestore();
  await assertFails(getDoc(doc(db, planPath('classroom-test', 'plan-1'))));
  await assertFails(updateDoc(doc(db, planPath('classroom-test', 'plan-1')), { topic: 'Hacked from another classroom' }));
});

test('4. classroom member reads a plan (including one authored by a co-teacher) -> ALLOW', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan());
  const db = testEnv.authenticatedContext('pm-1').firestore();
  await assertSucceeds(getDoc(doc(db, planPath('classroom-test', 'plan-1'))));
});

// ---------------------------------------------------------------------
// Create — must start clean (hole #1)
// ---------------------------------------------------------------------

test('5. classroom member creates their own DRAFT plan -> ALLOW', async () => {
  await seedClassroom(TWO_TEACHERS);
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertSucceeds(setDoc(doc(db, planPath('classroom-test', 'plan-1')), draftPlan()));
});

test('6. creating a plan already marked "submitted"/"approved" -> DENY (cannot skip the review workflow via create)', async () => {
  await seedClassroom(TWO_TEACHERS);
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, planPath('classroom-test', 'plan-1')), draftPlan({ status: 'submitted' })));
  await assertFails(setDoc(doc(db, planPath('classroom-test', 'plan-1')), draftPlan({ status: 'approved' })));
});

test('7. creating a plan with a pre-populated (fabricated) reviewHistory -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(
    setDoc(doc(db, planPath('classroom-test', 'plan-1')), draftPlan({ reviewHistory: [submittedRound('teacher-1')] }))
  );
});

test('8. creating a plan on behalf of someone else (createdByUid != the writer) -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(db, planPath('classroom-test', 'plan-1')), draftPlan({ createdByUid: 'pm-1' })));
});

// ---------------------------------------------------------------------
// Author edits — locked out once SUBMITTED/APPROVED (hole #2)
// ---------------------------------------------------------------------

test('9. author edits their own DRAFT content -> ALLOW', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan());
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertSucceeds(updateDoc(doc(db, planPath('classroom-test', 'plan-1')), { topic: 'Updated Topic' }));
});

test('10. author submits their own DRAFT for review (well-formed round) -> ALLOW', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan());
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertSucceeds(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'submitted',
      reviewHistory: [submittedRound('teacher-1')],
      updatedAt: '2026-09-02T00:00:00.000Z',
    })
  );
});

test('11. author tries to edit CONTENT while the plan is SUBMITTED -> DENY (the actual hole #2 this hardening pass closes)', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(updateDoc(doc(db, planPath('classroom-test', 'plan-1')), { topic: 'Sneaky edit while under review' }));
});

test('12. author tries to edit an APPROVED plan at all -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(
    draftPlan({
      status: 'approved',
      reviewerUid: 'pm-1',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'approved', byUid: 'pm-1', at: '2026-09-02T00:00:00.000Z', comments: [] }],
    })
  );
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(updateDoc(doc(db, planPath('classroom-test', 'plan-1')), { topic: 'Trying to edit after approval' }));
});

test('13. author tries to self-approve directly (bypassing review entirely) -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'approved',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'approved', byUid: 'teacher-1', at: '2026-09-02T00:00:00.000Z', comments: [] }],
    })
  );
});

test('14. author tries to move their own plan to "changes_requested" (pretending to be a reviewer) -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'changes_requested',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'changes_requested', byUid: 'teacher-1', at: '2026-09-02T00:00:00.000Z', comments: [{ id: 'c1', sectionKey: 'spark', text: 'fake', byUid: 'teacher-1', createdAt: '2026-09-02T00:00:00.000Z', resolvedAt: null, roundNumber: 2 }] }],
    })
  );
});

// ---------------------------------------------------------------------
// Reviewer actions — scope + content-immutability (hole #3)
// ---------------------------------------------------------------------

test('15. authorized same-classroom reviewer requests changes on a SUBMITTED plan (well-formed, >=1 comment) -> ALLOW', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('pm-1').firestore();
  await assertSucceeds(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'changes_requested',
      reviewerUid: 'pm-1',
      activeComments: [{ id: 'c1', sectionKey: 'spark', text: 'Make it punchier.', byUid: 'pm-1', createdAt: '2026-09-02T00:00:00.000Z', resolvedAt: null, roundNumber: 2 }],
      reviewHistory: [
        submittedRound('teacher-1'),
        { id: 'r2', status: 'changes_requested', byUid: 'pm-1', at: '2026-09-02T00:00:00.000Z', comments: [{ id: 'c1', sectionKey: 'spark', text: 'Make it punchier.', byUid: 'pm-1', createdAt: '2026-09-02T00:00:00.000Z', resolvedAt: null, roundNumber: 2 }] }
      ],
      updatedAt: '2026-09-02T00:00:00.000Z',
    })
  );
});

test('16. authorized same-classroom reviewer approves a SUBMITTED plan -> ALLOW', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('pm-1').firestore();
  await assertSucceeds(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'approved',
      reviewerUid: 'pm-1',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'approved', byUid: 'pm-1', at: '2026-09-02T00:00:00.000Z', comments: [] }],
      updatedAt: '2026-09-02T00:00:00.000Z',
    })
  );
});

test('17. the plan\'s OWN author cannot review/approve it even acting through the reviewer branch (self-review blocked at the data layer) -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'approved',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'approved', byUid: 'teacher-1', at: '2026-09-02T00:00:00.000Z', comments: [] }],
    })
  );
});

test('18. a VIEWER-role classroom member cannot review or approve (lacks REVIEW_LESSON_PLAN/APPROVE_LESSON_PLAN) -> DENY', async () => {
  await seedClassroom({
    'teacher-1': { role: 'teacher', displayName: 'Teacher One' },
    'viewer-1': { role: 'viewer', displayName: 'Viewer One' },
  });
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('viewer-1').firestore();
  await assertFails(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'approved',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'approved', byUid: 'viewer-1', at: '2026-09-02T00:00:00.000Z', comments: [] }],
    })
  );
});

test('19. a co-teacher from a DIFFERENT classroom cannot review this plan even though they hold a reviewer-capable role somewhere -> DENY (reviewer scope is same-classroom only)', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', 'other-classroom'), {
      ownerUid: 'other-teacher',
      memberUids: ['other-teacher'],
      members: { 'other-teacher': { role: 'teacher', displayName: 'Other Teacher' } },
    });
  });
  const db = testEnv.authenticatedContext('other-teacher').firestore();
  await assertFails(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'approved',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'approved', byUid: 'other-teacher', at: '2026-09-02T00:00:00.000Z', comments: [] }],
    })
  );
});

test('20. reviewer cannot overwrite lesson CONTENT while legitimately requesting changes (hole #3) -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('pm-1').firestore();
  await assertFails(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'changes_requested',
      topic: 'Reviewer rewrote the whole lesson', // <-- the actual attack this closes
      reviewHistory: [
        submittedRound('teacher-1'),
        { id: 'r2', status: 'changes_requested', byUid: 'pm-1', at: '2026-09-02T00:00:00.000Z', comments: [{ id: 'c1', sectionKey: 'spark', text: 'x', byUid: 'pm-1', createdAt: '2026-09-02T00:00:00.000Z', resolvedAt: null, roundNumber: 2 }] }
      ],
    })
  );
});

test('21. reviewer requesting changes with ZERO comments in the appended round -> DENY (spoofed/empty review write rejected at the data layer too)', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('pm-1').firestore();
  await assertFails(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'changes_requested',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'changes_requested', byUid: 'pm-1', at: '2026-09-02T00:00:00.000Z', comments: [] }],
    })
  );
});

test('22. reviewer tries to attribute the new review round to someone else (byUid spoofing) -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('pm-1').firestore();
  await assertFails(
    updateDoc(doc(db, planPath('classroom-test', 'plan-1')), {
      status: 'approved',
      reviewHistory: [submittedRound('teacher-1'), { id: 'r2', status: 'approved', byUid: 'someone-else-entirely', at: '2026-09-02T00:00:00.000Z', comments: [] }],
    })
  );
});

test('23. reviewer tries to skip straight from SUBMITTED to APPROVED without appending a round at all -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan({ status: 'submitted', reviewHistory: [submittedRound('teacher-1')] }));
  const db = testEnv.authenticatedContext('pm-1').firestore();
  await assertFails(updateDoc(doc(db, planPath('classroom-test', 'plan-1')), { status: 'approved' }));
});

test('24. delete is always denied (no one, including the author, can delete a lesson plan)', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedPlan(draftPlan());
  const { deleteDoc } = await import('firebase/firestore');
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertFails(deleteDoc(doc(db, planPath('classroom-test', 'plan-1'))));
});
