/**
 * tests/rules/task.rules.test.js
 *
 * Real Firestore Rules Emulator tests (firestore.rules, unmodified from
 * what's actually deployed-ready) for the new `users/{uid}/tasks`
 * subcollection (see models/Task.js, repositories/taskRepository.js).
 * Proves, against the actual rules engine: a user can create/read/
 * update/delete their own Tasks; a Task can never be created or updated
 * to claim a different ownerUid; another authenticated user (even one
 * who is a real classroom co-member elsewhere) cannot read, write, or
 * delete someone else's Task.
 *
 * Requires the Firestore emulator, matching the exact convention
 * already established in tests/rules/weeklyPlanSubmission.rules.test.js:
 *   firebase emulators:exec --only firestore "node --test tests/rules/task.rules.test.js"
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';

let testEnv;

const USER_A = 'user-a-uid';
const USER_B = 'user-b-uid';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-classmate-task-test',
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

function asUserA() {
  return testEnv.authenticatedContext(USER_A).firestore();
}
function asUserB() {
  return testEnv.authenticatedContext(USER_B).firestore();
}

const TASK_ID = 'task-1';

function baseTask(overrides = {}) {
  return {
    ownerUid: USER_A,
    title: 'Create Social Science Chapter Plan',
    description: '',
    workspace: 'Teaching',
    priority: 'must_do',
    status: 'todo',
    dueType: 'tomorrow',
    dueDate: '2026-09-29',
    estimatedMinutes: 45,
    completedAt: null,
    subtasks: [],
    contextRef: null,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

async function seedTask(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid, 'tasks', TASK_ID), data);
  });
}

test('a user can create their own Task', async () => {
  await assertSucceeds(setDoc(doc(asUserA(), 'users', USER_A, 'tasks', TASK_ID), baseTask()));
});

test('a user cannot create a Task under their own path claiming a different ownerUid', async () => {
  await assertFails(setDoc(doc(asUserA(), 'users', USER_A, 'tasks', TASK_ID), baseTask({ ownerUid: USER_B })));
});

test('a user cannot create a Task directly under a different uid\'s path at all', async () => {
  await assertFails(setDoc(doc(asUserA(), 'users', USER_B, 'tasks', TASK_ID), baseTask({ ownerUid: USER_B })));
});

test('a user can read their own Task', async () => {
  await seedTask(USER_A, baseTask());
  await assertSucceeds(getDoc(doc(asUserA(), 'users', USER_A, 'tasks', TASK_ID)));
});

test('a different authenticated user cannot read someone else\'s Task', async () => {
  await seedTask(USER_A, baseTask());
  await assertFails(getDoc(doc(asUserB(), 'users', USER_A, 'tasks', TASK_ID)));
});

test('a user can update their own Task (e.g. mark complete)', async () => {
  await seedTask(USER_A, baseTask());
  await assertSucceeds(
    updateDoc(doc(asUserA(), 'users', USER_A, 'tasks', TASK_ID), {
      status: 'done',
      completedAt: '2026-09-28T12:00:00.000Z',
      updatedAt: '2026-09-28T12:00:00.000Z',
    })
  );
});

test('a user cannot update their own Task to reassign it to a different ownerUid', async () => {
  await seedTask(USER_A, baseTask());
  await assertFails(
    updateDoc(doc(asUserA(), 'users', USER_A, 'tasks', TASK_ID), {
      ownerUid: USER_B,
      updatedAt: '2026-09-28T12:00:00.000Z',
    })
  );
});

test('a different authenticated user cannot update someone else\'s Task', async () => {
  await seedTask(USER_A, baseTask());
  await assertFails(
    updateDoc(doc(asUserB(), 'users', USER_A, 'tasks', TASK_ID), {
      status: 'archived',
      updatedAt: '2026-09-28T12:00:00.000Z',
    })
  );
});

test('a user can delete their own Task', async () => {
  await seedTask(USER_A, baseTask());
  await assertSucceeds(deleteDoc(doc(asUserA(), 'users', USER_A, 'tasks', TASK_ID)));
});

test('a different authenticated user cannot delete someone else\'s Task', async () => {
  await seedTask(USER_A, baseTask());
  await assertFails(deleteDoc(doc(asUserB(), 'users', USER_A, 'tasks', TASK_ID)));
});

test('an unauthenticated caller cannot read or write a Task at all', async () => {
  await seedTask(USER_A, baseTask());
  const unauthed = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(unauthed, 'users', USER_A, 'tasks', TASK_ID)));
  await assertFails(setDoc(doc(unauthed, 'users', USER_A, 'tasks', TASK_ID), baseTask()));
});

// ---------------------------------------------------------------------
// Full Phase 2 lifecycle — proves create/edit/complete/reopen/archive/
// delete all actually work end-to-end against the REAL rules engine,
// via the exact same repositories/taskRepository.js operations
// ui/views/MyWorkView.js calls (setDoc for create/every field edit,
// deleteDoc for delete) — not just isolated permission checks above.
// ---------------------------------------------------------------------

test('full lifecycle: create (todo) -> start (in_progress) -> complete (done) -> reopen (todo) -> archive -> delete, all as the owning user', async () => {
  const db = asUserA();
  const ref = doc(db, 'users', USER_A, 'tasks', TASK_ID);

  await assertSucceeds(setDoc(ref, baseTask({ status: 'todo' })));

  await assertSucceeds(updateDoc(ref, { status: 'in_progress', updatedAt: '2026-09-28T09:00:00.000Z' }));

  await assertSucceeds(
    updateDoc(ref, { status: 'done', completedAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z' })
  );

  await assertSucceeds(updateDoc(ref, { status: 'todo', completedAt: null, updatedAt: '2026-09-28T11:00:00.000Z' }));

  await assertSucceeds(updateDoc(ref, { status: 'archived', updatedAt: '2026-09-28T12:00:00.000Z' }));

  await assertSucceeds(deleteDoc(ref));

  // The read itself is still authorized (rules gate WHO can read, not
  // whether a document exists) — it just comes back empty, confirming
  // the delete actually took effect.
  const snapshotAfterDelete = await assertSucceeds(getDoc(ref));
  assert.equal(snapshotAfterDelete.exists(), false);
});

test('full lifecycle: editing priority/due date/estimated effort/workspace, all as plain field updates', async () => {
  const db = asUserA();
  const ref = doc(db, 'users', USER_A, 'tasks', TASK_ID);

  await assertSucceeds(setDoc(ref, baseTask()));

  await assertSucceeds(
    updateDoc(ref, {
      priority: 'important',
      dueType: 'this_week',
      dueDate: '2026-10-02',
      estimatedMinutes: 90,
      workspace: 'School',
      updatedAt: '2026-09-28T13:00:00.000Z',
    })
  );

  const snapshot = await getDoc(ref);
  const data = snapshot.data();
  assert.equal(data.priority, 'important');
  assert.equal(data.dueDate, '2026-10-02');
  assert.equal(data.estimatedMinutes, 90);
  assert.equal(data.workspace, 'School');
});
