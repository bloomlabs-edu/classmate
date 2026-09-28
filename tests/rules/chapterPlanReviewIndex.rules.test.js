/**
 * tests/rules/chapterPlanReviewIndex.rules.test.js
 *
 * Real Firestore Rules Emulator tests for the new top-level
 * `chapterPlanReviewIndex/{chapterPlanId}` collection (see
 * repositories/chapterPlanReviewIndexRepository.js). Mirrors the intent
 * of firebase-rules-verification/weeklyPlanReviewIndex.rules.verify.js:
 * the central property this file exists to prove is that the index is
 * a discovery aid, NEVER a security boundary of its own — every test
 * here either confirms it grants no MORE access than the real
 * `classrooms/{classroomId}/chapterPlans/{chapterPlanId}` document
 * already would for the same uid, or confirms a write can't
 * misrepresent that real document's current status/authorship.
 *
 * Requires the Firestore emulator running locally:
 *   firebase emulators:exec --only firestore "node --test tests/rules/chapterPlanReviewIndex.rules.test.js"
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

let testEnv;

const CLASSROOM_A = 'classroom-a';
const FELLOW_A = 'fellow-a-uid';
const PM_A = 'pm-a-uid';
const OUTSIDER = 'outsider-uid';

const CHAPTER_PLAN_ID = 'chapter-plan-1';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-classmate-chapter-plan-review-index-test',
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

async function seedSourceChapterPlan(overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', CLASSROOM_A, 'chapterPlans', CHAPTER_PLAN_ID), {
      classroomId: CLASSROOM_A,
      teacherUid: FELLOW_A,
      createdByUid: FELLOW_A,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      chapterName: 'Plant Kingdom',
      subjectId: 'science',
      status: 'submitted',
      reviewerUid: null,
      reviewHistory: [],
      activeComments: [],
      purpose: {}, mastery: {}, methods: {}, subjectSpecific: {}, resourceLinks: [], conceptIds: [],
      ...overrides,
    });
  });
}

function baseEntry(overrides = {}) {
  return {
    chapterPlanId: CHAPTER_PLAN_ID,
    classroomId: CLASSROOM_A,
    createdByUid: FELLOW_A,
    teacherDisplayName: 'Fellow A',
    subjectId: 'science',
    chapterName: 'Plant Kingdom',
    status: 'submitted',
    updatedAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

test('a classroom member can write a faithful index entry matching the real source ChapterPlan\'s status/createdByUid', async () => {
  await seedSourceChapterPlan();
  await assertSucceeds(setDoc(doc(asFellowA(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID), baseEntry()));
});

test('an entry claiming a status that disagrees with the real source ChapterPlan is rejected', async () => {
  await seedSourceChapterPlan({ status: 'submitted' });
  await assertFails(setDoc(doc(asFellowA(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID), baseEntry({ status: 'approved' })));
});

test('an entry claiming a createdByUid that disagrees with the real source ChapterPlan is rejected', async () => {
  await seedSourceChapterPlan();
  await assertFails(setDoc(doc(asFellowA(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID), baseEntry({ createdByUid: PM_A })));
});

test('an entry document id must match its own claimed chapterPlanId', async () => {
  await seedSourceChapterPlan();
  await assertFails(setDoc(doc(asFellowA(), 'chapterPlanReviewIndex', 'a-different-id'), baseEntry()));
});

test('a non-member of the source classroom cannot write an index entry for it', async () => {
  await seedSourceChapterPlan();
  await assertFails(setDoc(doc(asOutsider(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID), baseEntry()));
});

test('a classroom member (PM) can read an index entry for their own classroom', async () => {
  await seedSourceChapterPlan();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID), baseEntry());
  });
  await assertSucceeds(getDoc(doc(asPmA(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID)));
});

test('a non-member cannot read an index entry — the index grants no more read access than the real ChapterPlan already would', async () => {
  await seedSourceChapterPlan();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID), baseEntry());
  });
  await assertFails(getDoc(doc(asOutsider(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID)));
});

test('an index entry can never be deleted', async () => {
  await seedSourceChapterPlan();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID), baseEntry());
  });
  await assertFails(deleteDoc(doc(asFellowA(), 'chapterPlanReviewIndex', CHAPTER_PLAN_ID)));
});
