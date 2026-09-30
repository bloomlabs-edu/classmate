/**
 * tests/rules/weeklyPlanSubmission.rules.test.js
 *
 * Real Firestore Rules Emulator tests (firestore.rules, unmodified from
 * what's actually deployed-ready) for the new top-level
 * `weeklyPlanSubmissions` collection (see models/WeeklyPlanSubmission.js,
 * services/weeklyPlanSubmissionService.js). Proves, against the actual
 * rules engine: a Fellow can create/submit/resubmit their own Weekly
 * Plan; a reviewer (holding REVIEW_WEEKLY_PLAN/APPROVE_WEEKLY_PLAN, not
 * REVIEW_LESSON_PLAN/APPROVE_LESSON_PLAN) other than the Fellow can
 * request changes or approve; the Fellow can never approve their own
 * submission; a non-member cannot read or write at all.
 *
 * Requires the Firestore emulator running locally, matching the exact
 * convention already established in tests/rules/learnerConnection.rules.test.js:
 *   firebase emulators:exec --only firestore "node --test tests/rules/weeklyPlanSubmission.rules.test.js"
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
    projectId: 'demo-classmate-weekly-plan-test',
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

const SUBMISSION_ID = `${CLASSROOM_A}_${FELLOW_A}_2026-09-28`;

function baseSubmission(overrides = {}) {
  return {
    classroomId: CLASSROOM_A,
    teacherUid: FELLOW_A,
    weekStartDate: '2026-09-28',
    status: 'draft',
    createdByUid: FELLOW_A,
    submittedAt: null,
    hadChangesRequested: false,
    reviewerUid: null,
    reviewedAt: null,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

async function seedSubmission(data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'weeklyPlanSubmissions', SUBMISSION_ID), data);
  });
}

test('a Fellow can create their own Weekly Plan submission in draft', async () => {
  await assertSucceeds(setDoc(doc(asFellowA(), 'weeklyPlanSubmissions', SUBMISSION_ID), baseSubmission()));
});

test('a Fellow can create their own Weekly Plan submission straight to submitted', async () => {
  await assertSucceeds(
    setDoc(doc(asFellowA(), 'weeklyPlanSubmissions', SUBMISSION_ID), baseSubmission({ status: 'submitted', submittedAt: '2026-09-22T00:00:00.000Z' }))
  );
});

test('a Fellow cannot create a submission claiming a different teacherUid', async () => {
  await assertFails(setDoc(doc(asFellowA(), 'weeklyPlanSubmissions', SUBMISSION_ID), baseSubmission({ teacherUid: PM_A, createdByUid: PM_A })));
});

test('a non-member cannot create a submission for a classroom they do not belong to', async () => {
  await assertFails(setDoc(doc(asOutsider(), 'weeklyPlanSubmissions', SUBMISSION_ID), baseSubmission()));
});

test('a non-member cannot read an existing submission', async () => {
  await seedSubmission(baseSubmission());
  await assertFails(getDoc(doc(asOutsider(), 'weeklyPlanSubmissions', SUBMISSION_ID)));
});

test('a classroom member can read a submission for that classroom', async () => {
  await seedSubmission(baseSubmission());
  await assertSucceeds(getDoc(doc(asPmA(), 'weeklyPlanSubmissions', SUBMISSION_ID)));
});

test('the Fellow can submit their own draft (DRAFT -> SUBMITTED)', async () => {
  await seedSubmission(baseSubmission({ status: 'draft' }));
  await assertSucceeds(
    updateDoc(doc(asFellowA(), 'weeklyPlanSubmissions', SUBMISSION_ID), {
      status: 'submitted',
      submittedAt: '2026-09-23T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
  );
});

test('a reviewer (PM) can request changes on a SUBMITTED plan', async () => {
  await seedSubmission(baseSubmission({ status: 'submitted', submittedAt: '2026-09-23T00:00:00.000Z' }));
  await assertSucceeds(
    updateDoc(doc(asPmA(), 'weeklyPlanSubmissions', SUBMISSION_ID), {
      status: 'changes_requested',
      reviewerUid: PM_A,
      reviewedAt: '2026-09-24T00:00:00.000Z',
      hadChangesRequested: true,
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('the Fellow can resubmit after changes requested (CHANGES_REQUESTED -> SUBMITTED)', async () => {
  await seedSubmission(baseSubmission({ status: 'changes_requested', hadChangesRequested: true, reviewerUid: PM_A }));
  await assertSucceeds(
    updateDoc(doc(asFellowA(), 'weeklyPlanSubmissions', SUBMISSION_ID), {
      status: 'submitted',
      submittedAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
    })
  );
});

test('a reviewer (PM) can approve a SUBMITTED plan', async () => {
  await seedSubmission(baseSubmission({ status: 'submitted', submittedAt: '2026-09-23T00:00:00.000Z' }));
  await assertSucceeds(
    updateDoc(doc(asPmA(), 'weeklyPlanSubmissions', SUBMISSION_ID), {
      status: 'approved',
      reviewerUid: PM_A,
      reviewedAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('a Fellow can never approve their own submission', async () => {
  await seedSubmission(baseSubmission({ status: 'submitted', submittedAt: '2026-09-23T00:00:00.000Z' }));
  await assertFails(
    updateDoc(doc(asFellowA(), 'weeklyPlanSubmissions', SUBMISSION_ID), {
      status: 'approved',
      reviewerUid: FELLOW_A,
      reviewedAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('a Fellow can never request changes on their own submission', async () => {
  await seedSubmission(baseSubmission({ status: 'submitted', submittedAt: '2026-09-23T00:00:00.000Z' }));
  await assertFails(
    updateDoc(doc(asFellowA(), 'weeklyPlanSubmissions', SUBMISSION_ID), {
      status: 'changes_requested',
      reviewerUid: FELLOW_A,
      reviewedAt: '2026-09-24T00:00:00.000Z',
      hadChangesRequested: true,
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('an outsider cannot request changes or approve, even a well-formed write', async () => {
  await seedSubmission(baseSubmission({ status: 'submitted', submittedAt: '2026-09-23T00:00:00.000Z' }));
  await assertFails(
    updateDoc(doc(asOutsider(), 'weeklyPlanSubmissions', SUBMISSION_ID), {
      status: 'approved',
      reviewerUid: OUTSIDER,
      reviewedAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    })
  );
});

test('a submission can never be deleted, even by its own Fellow', async () => {
  await seedSubmission(baseSubmission());
  await assertFails(deleteDoc(doc(asFellowA(), 'weeklyPlanSubmissions', SUBMISSION_ID)));
});
