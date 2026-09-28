/**
 * tests/rules/chapterPlan.rules.test.js
 *
 * Real Firestore Rules Emulator tests (firestore.rules, unmodified from
 * what's actually deployed-ready) for the new
 * `classrooms/{classroomId}/chapterPlans/{chapterPlanId}` subcollection
 * (see models/ChapterPlan.js). Mirrors
 * tests/rules/weeklyPlanSubmission.rules.test.js's own conventions,
 * re-scoped to ChapterPlan's own review lifecycle (draft/submitted/
 * changes_requested/approved with append-only reviewHistory, the same
 * shape lessonPlans uses).
 *
 * Proves, against the actual rules engine: a Fellow can create/submit/
 * resubmit their own Chapter Plan; a co-teacher/PM other than that
 * Fellow can request changes or approve a SUBMITTED plan but can never
 * touch its content; the Fellow can never review/approve their own
 * plan; a non-member cannot read or write at all; a reviewer's write
 * is rejected if it touches anything beyond the allowed review fields.
 *
 * Requires the Firestore emulator running locally:
 *   firebase emulators:exec --only firestore "node --test tests/rules/chapterPlan.rules.test.js"
 * or against an already-running emulator directly with `node --test`.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';

let testEnv;

const CLASSROOM_A = 'classroom-a';
const CLASSROOM_B = 'classroom-b';
const FELLOW_A = 'fellow-a-uid';
const PM_A = 'pm-a-uid';
const OUTSIDER = 'outsider-uid';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-classmate-chapter-plan-test',
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
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'classrooms', CLASSROOM_A), {
      memberUids: [FELLOW_A, PM_A],
      members: {
        [FELLOW_A]: { role: 'teacher', displayName: 'Fellow A' },
        [PM_A]: { role: 'program_manager', displayName: 'PM A' },
      },
    });
    await setDoc(doc(db, 'classrooms', CLASSROOM_B), {
      memberUids: [],
      members: {},
    });
  });
});

function asFellowA() {
  return testEnv.authenticatedContext(FELLOW_A).firestore();
}
function asPmA() {
  return testEnv.authenticatedContext(PM_A).firestore();
}
function asOutsider() {
  return testEnv.authenticatedContext(OUTSIDER).firestore();
}

const PLAN_ID = 'chapter-plan-1';

function planPath(db) {
  return doc(db, 'classrooms', CLASSROOM_A, 'chapterPlans', PLAN_ID);
}

function baseChapterPlan(overrides = {}) {
  return {
    classroomId: CLASSROOM_A,
    teacherUid: FELLOW_A,
    createdByUid: FELLOW_A,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    gradeLabel: 'Grade 8A',
    subjectId: 'science',
    termId: null,
    curriculumUnitId: 'unit-local-17',
    linkedCurriculumUnitId: 'curriculum-index-unit-17',
    conceptIds: [],
    chapterName: 'Plant Kingdom',
    numberOfLessonsDays: 12,
    purpose: { whatsWorthLearning: '', whyDoesLearningMatter: '', importantConcepts: '', supplementaryResources: '', essentialQuestions: [], objectives: [] },
    mastery: { endOfChapterShowcase: '', bookBackQuestionTypes: '', lsrwScope: '', vocabularyAndAnchorCharts: '' },
    methods: { keyMethods: '', simplifiedText: '', revisionIdeas: '', resources: '' },
    subjectSpecific: {},
    resourceLinks: [],
    templateVersion: 1,
    status: 'draft',
    reviewerUid: null,
    reviewHistory: [],
    activeComments: [],
    ...overrides,
  };
}

async function seedChapterPlan(data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', CLASSROOM_A, 'chapterPlans', PLAN_ID), data);
  });
}

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------

test('a Fellow can create their own Chapter Plan draft', async () => {
  await assertSucceeds(setDoc(planPath(asFellowA()), baseChapterPlan()));
});

test('a Fellow cannot create a Chapter Plan claiming a different teacherUid', async () => {
  await assertFails(setDoc(planPath(asFellowA()), baseChapterPlan({ teacherUid: PM_A, createdByUid: PM_A })));
});

test('a Fellow cannot create a Chapter Plan with createdByUid different from teacherUid', async () => {
  await assertFails(setDoc(planPath(asFellowA()), baseChapterPlan({ createdByUid: PM_A })));
});

test('a Fellow cannot create a Chapter Plan that starts pre-approved or with existing review history', async () => {
  await assertFails(setDoc(planPath(asFellowA()), baseChapterPlan({ status: 'approved' })));
  await assertFails(setDoc(planPath(asFellowA()), baseChapterPlan({ reviewHistory: [{ id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-22T00:00:00.000Z', comments: [] }] })));
});

test('a non-member cannot create a Chapter Plan for a classroom they do not belong to', async () => {
  await assertFails(setDoc(planPath(asOutsider()), baseChapterPlan()));
});

// ---------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------

test('a non-member cannot read an existing Chapter Plan', async () => {
  await seedChapterPlan(baseChapterPlan());
  await assertFails(getDoc(planPath(asOutsider())));
});

test('a classroom member (PM) can read a Chapter Plan for that classroom', async () => {
  await seedChapterPlan(baseChapterPlan());
  await assertSucceeds(getDoc(planPath(asPmA())));
});

// ---------------------------------------------------------------------
// Author edit / submit
// ---------------------------------------------------------------------

test('the Fellow can edit their own draft content in place (still draft)', async () => {
  await seedChapterPlan(baseChapterPlan());
  await assertSucceeds(
    updateDoc(planPath(asFellowA()), {
      chapterName: 'Plant Kingdom (revised)',
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});

test('the Fellow can submit their own draft (DRAFT -> SUBMITTED)', async () => {
  await seedChapterPlan(baseChapterPlan());
  await assertSucceeds(
    updateDoc(planPath(asFellowA()), {
      status: 'submitted',
      reviewHistory: [{ id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] }],
      activeComments: [],
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});

test('a non-author, non-reviewing classroom edit attempt to the plan\'s own content is rejected for anyone else', async () => {
  await seedChapterPlan(baseChapterPlan());
  await assertFails(
    updateDoc(planPath(asPmA()), {
      chapterName: 'Hijacked content',
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});

// ---------------------------------------------------------------------
// Reviewer actions
// ---------------------------------------------------------------------

test('a reviewer (PM) can request changes on a SUBMITTED plan, with at least one comment', async () => {
  await seedChapterPlan(baseChapterPlan({ status: 'submitted', reviewHistory: [{ id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] }] }));
  await assertSucceeds(
    updateDoc(planPath(asPmA()), {
      status: 'changes_requested',
      reviewerUid: PM_A,
      reviewHistory: [
        { id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] },
        { id: 'r2', status: 'changes_requested', byUid: PM_A, at: '2026-09-24T00:00:00.000Z', comments: [{ id: 'c1', sectionKey: 'purpose', text: 'Add essential questions.', byUid: PM_A, createdAt: '2026-09-24T00:00:00.000Z', resolvedAt: null, roundNumber: 2 }] },
      ],
      activeComments: [{ id: 'c1', sectionKey: 'purpose', text: 'Add essential questions.', byUid: PM_A, createdAt: '2026-09-24T00:00:00.000Z', resolvedAt: null, roundNumber: 2 }],
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('a reviewer requesting changes with zero comments is rejected — a bare status flip leaves the Fellow nothing to act on', async () => {
  await seedChapterPlan(baseChapterPlan({ status: 'submitted', reviewHistory: [{ id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] }] }));
  await assertFails(
    updateDoc(planPath(asPmA()), {
      status: 'changes_requested',
      reviewerUid: PM_A,
      reviewHistory: [
        { id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] },
        { id: 'r2', status: 'changes_requested', byUid: PM_A, at: '2026-09-24T00:00:00.000Z', comments: [] },
      ],
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('a reviewer (PM) can approve a SUBMITTED plan', async () => {
  await seedChapterPlan(baseChapterPlan({ status: 'submitted', reviewHistory: [{ id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] }] }));
  await assertSucceeds(
    updateDoc(planPath(asPmA()), {
      status: 'approved',
      reviewerUid: PM_A,
      reviewHistory: [
        { id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] },
        { id: 'r2', status: 'approved', byUid: PM_A, at: '2026-09-24T00:00:00.000Z', comments: [] },
      ],
      activeComments: [],
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('the Fellow can never approve their own Chapter Plan (self-review blocked at the rules layer, not just the service layer)', async () => {
  await seedChapterPlan(baseChapterPlan({ status: 'submitted', reviewHistory: [{ id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] }] }));
  await assertFails(
    updateDoc(planPath(asFellowA()), {
      status: 'approved',
      reviewerUid: FELLOW_A,
      reviewHistory: [
        { id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] },
        { id: 'r2', status: 'approved', byUid: FELLOW_A, at: '2026-09-24T00:00:00.000Z', comments: [] },
      ],
      activeComments: [],
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('a reviewer cannot mutate plan content (e.g. chapterName) while also making a valid-looking review transition', async () => {
  await seedChapterPlan(baseChapterPlan({ status: 'submitted', reviewHistory: [{ id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] }] }));
  await assertFails(
    updateDoc(planPath(asPmA()), {
      chapterName: 'Reviewer-rewritten chapter name',
      status: 'approved',
      reviewerUid: PM_A,
      reviewHistory: [
        { id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] },
        { id: 'r2', status: 'approved', byUid: PM_A, at: '2026-09-24T00:00:00.000Z', comments: [] },
      ],
      activeComments: [],
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('an outsider cannot request changes or approve, even a well-formed write', async () => {
  await seedChapterPlan(baseChapterPlan({ status: 'submitted', reviewHistory: [{ id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] }] }));
  await assertFails(
    updateDoc(planPath(asOutsider()), {
      status: 'approved',
      reviewerUid: OUTSIDER,
      reviewHistory: [
        { id: 'r1', status: 'submitted', byUid: FELLOW_A, at: '2026-09-23T00:00:00.000Z', comments: [] },
        { id: 'r2', status: 'approved', byUid: OUTSIDER, at: '2026-09-24T00:00:00.000Z', comments: [] },
      ],
      activeComments: [],
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('a Chapter Plan can never be deleted, even by its own Fellow', async () => {
  await seedChapterPlan(baseChapterPlan());
  await assertFails(deleteDoc(planPath(asFellowA())));
});

// ---------------------------------------------------------------------
// Resource links (see models/ChapterPlanResourceLink.js) — plain
// content, editable by the author while draft/changes_requested, like
// any other content field. Referencing another classroom's Resource
// here grants no write access to that Resource — see
// tests/rules/chapterPlanResourceCrossClassroom.rules.test.js for that
// explicit boundary check.
// ---------------------------------------------------------------------

test('the Fellow can add a resourceLink referencing a Resource that belongs to a DIFFERENT classroom, as part of their own draft edit', async () => {
  await seedChapterPlan(baseChapterPlan());
  await assertSucceeds(
    updateDoc(planPath(asFellowA()), {
      resourceLinks: [{ id: 'link-1', classroomId: CLASSROOM_B, resourceId: 'resource-owned-by-classroom-b', resourceType: 'external_link', addedAt: '2026-09-23T00:00:00.000Z', addedBy: FELLOW_A }],
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});
