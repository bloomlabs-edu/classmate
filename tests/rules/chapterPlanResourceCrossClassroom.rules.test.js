/**
 * tests/rules/chapterPlanResourceCrossClassroom.rules.test.js
 *
 * The one explicitly-required security test for Chapter Plan Phase 1:
 * a Fellow referencing another classroom's Resource from their own
 * Chapter Plan must NOT gain any write access to that Resource.
 *
 * Scenario:
 *   1. Fellow A (classroom A) creates a Chapter Plan.
 *   2. Fellow A adds a resourceLink (models/ChapterPlanResourceLink.js)
 *      pointing at a real Resource that lives in classroom B, owned by
 *      Fellow B — Fellow A is not a member of classroom B at all.
 *   3. Fellow A can freely read that Resource (Resources are readable
 *      by any authenticated user — see firestore.rules' own `resources`
 *      block) and can freely store the reference inside their OWN
 *      Chapter Plan document (that's just editing their own document's
 *      own content — see the `chapterPlans` block's author-edit rule).
 *   4. Fellow A must NOT be able to update or delete the real Resource
 *      document itself at `classrooms/classroom-b/resources/{resourceId}`
 *      — that still requires membership of classroom B specifically,
 *      completely unaffected by Fellow A's own Chapter Plan referencing
 *      it. This is what "referencing another classroom's Resource must
 *      NOT grant write access to that Resource" actually means at the
 *      rules layer, proven against the real Resource rule, not
 *      reasoned about.
 *
 * Requires the Firestore emulator running locally:
 *   firebase emulators:exec --only firestore "node --test tests/rules/chapterPlanResourceCrossClassroom.rules.test.js"
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
const FELLOW_B = 'fellow-b-uid';
const PM_A = 'pm-a-uid'; // Phase 4 — reviews Chapter Plans in classroom A only; not a member of classroom B at all

const CHAPTER_PLAN_ID = 'chapter-plan-1';
const RESOURCE_ID = 'resource-owned-by-fellow-b';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-classmate-chapter-plan-resource-cross-classroom-test',
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
      members: { [FELLOW_A]: { role: 'teacher', displayName: 'Fellow A' }, [PM_A]: { role: 'program_manager', displayName: 'PM A' } },
    });
    await setDoc(doc(db, 'classrooms', CLASSROOM_B), {
      memberUids: [FELLOW_B],
      members: { [FELLOW_B]: { role: 'teacher', displayName: 'Fellow B' } },
    });
    // The real Resource, owned by classroom B / Fellow B.
    await setDoc(doc(db, 'classrooms', CLASSROOM_B, 'resources', RESOURCE_ID), {
      title: 'Plant Kingdom Worksheet',
      type: 'external_link',
      status: 'draft',
      content: { url: 'https://example.com/plant-kingdom-worksheet', description: null },
      audience: 'teacher',
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    // Fellow A's own Chapter Plan, in classroom A, with no resourceLinks yet.
    await setDoc(doc(db, 'classrooms', CLASSROOM_A, 'chapterPlans', CHAPTER_PLAN_ID), {
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
    });
  });
});

function asFellowA() {
  return testEnv.authenticatedContext(FELLOW_A).firestore();
}
function asPmA() {
  return testEnv.authenticatedContext(PM_A).firestore();
}

test('Fellow A can read the real Resource owned by classroom B — Resources are readable by any authenticated user', async () => {
  await assertSucceeds(getDoc(doc(asFellowA(), 'classrooms', CLASSROOM_B, 'resources', RESOURCE_ID)));
});

test('Fellow A CAN add a resourceLink to their own Chapter Plan pointing at the classroom-B Resource — this is editing their own document, not the Resource', async () => {
  await assertSucceeds(
    updateDoc(doc(asFellowA(), 'classrooms', CLASSROOM_A, 'chapterPlans', CHAPTER_PLAN_ID), {
      resourceLinks: [
        {
          id: 'link-1',
          classroomId: CLASSROOM_B,
          resourceId: RESOURCE_ID,
          resourceType: 'external_link',
          addedAt: '2026-09-23T00:00:00.000Z',
          addedBy: FELLOW_A,
        },
      ],
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});

test('Fellow A CANNOT update the real classroom-B Resource document itself, even after referencing it from their own Chapter Plan', async () => {
  // Referencing it first (as the previous test proves is allowed) —
  // this must not have changed anything about the Resource's own rule.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'classrooms', CLASSROOM_A, 'chapterPlans', CHAPTER_PLAN_ID), {
      resourceLinks: [{ id: 'link-1', classroomId: CLASSROOM_B, resourceId: RESOURCE_ID, resourceType: 'external_link', addedAt: '2026-09-23T00:00:00.000Z', addedBy: FELLOW_A }],
    });
  });

  await assertFails(
    updateDoc(doc(asFellowA(), 'classrooms', CLASSROOM_B, 'resources', RESOURCE_ID), {
      title: 'Hijacked title',
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('Fellow A CANNOT delete the real classroom-B Resource document either', async () => {
  await assertFails(deleteDoc(doc(asFellowA(), 'classrooms', CLASSROOM_B, 'resources', RESOURCE_ID)));
});

test('Fellow A CANNOT create a NEW Resource document under classroom B (not a member there), even one shaped like a legitimate contribution', async () => {
  await assertFails(
    setDoc(doc(asFellowA(), 'classrooms', CLASSROOM_B, 'resources', 'a-new-resource-id'), {
      title: 'A resource Fellow A tries to plant in classroom B',
      type: 'external_link',
      status: 'draft',
      content: null,
      audience: 'teacher',
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

// ---------------------------------------------------------------------
// Phase 4 — the Program Manager reviewing Fellow A's Chapter Plan (a
// classroom-A-only member) sees the same referenced classroom-B
// Resource for CONTEXT during review, but gains no more access to it
// than Fellow A themselves did — no special "PM" case exists anywhere
// in the `resources` rule at all (it only ever checks classroom
// membership, never a role), so this is really the same boundary
// proven twice, once per person who might plausibly be confused about
// having special access to it.
// ---------------------------------------------------------------------

test('the reviewing PM can read the classroom-B Resource too (same open-read rule as anyone authenticated)', async () => {
  await assertSucceeds(getDoc(doc(asPmA(), 'classrooms', CLASSROOM_B, 'resources', RESOURCE_ID)));
});

test('the reviewing PM CANNOT update the classroom-B Resource — reviewing a Chapter Plan that references it grants no edit rights over it', async () => {
  await assertFails(
    updateDoc(doc(asPmA(), 'classrooms', CLASSROOM_B, 'resources', RESOURCE_ID), {
      title: 'Hijacked by reviewing PM',
      updatedAt: '2026-09-25T00:00:00.000Z',
    })
  );
});

test('the reviewing PM CANNOT delete the classroom-B Resource either', async () => {
  await assertFails(deleteDoc(doc(asPmA(), 'classrooms', CLASSROOM_B, 'resources', RESOURCE_ID)));
});
