import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobalsStub.mjs';
import * as workspaceService from '../../js/services/workspaceService.js';
import { firestoreClassroomRepository as repository } from '../../js/repositories/firestoreClassroomRepository.js';
import { __triggerSnapshot, __resetSnapshotListeners } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/**
 * Regression coverage for the portal-wide refresh/redirect bug: a
 * classroom-scoped deep link (or a plain browser refresh landing back
 * on one) used to get bounced to /teacher any time it rendered before
 * that ONE classroom's own document snapshot had arrived — even though
 * the teacher's classroomRefs list (which arrives first, independently
 * of any individual classroom doc) already confirmed they have a real,
 * current reference to it. See main.js's CLASSROOM_ROUTE_NAMES guard
 * and programManagerWeeklyPlanReview branch, both of which now check
 * hasClassroomSubscription() before treating a still-loading classroom
 * as "not found".
 */

function refsSnapshot(refs) {
  return { docs: refs.map((ref) => ({ id: ref.classroomId, data: () => ({ role: ref.role }) })) };
}

function docSnapshot(data) {
  return { exists: () => data !== null, data: () => data };
}

beforeEach(() => {
  __resetSnapshotListeners();
});

afterEach(() => {
  workspaceService.stopListening();
  __resetSnapshotListeners();
});

test('hasClassroomSubscription is false before initForUser has ever run', () => {
  assert.equal(workspaceService.hasClassroomSubscription('classroom-never-seen'), false);
});

test('a classroomRef becomes a known subscription before that classroom\'s own document snapshot arrives', async () => {
  await workspaceService.initForUser('uid-1', 'Teacher One', () => {});

  const refsPath = repository._classroomRefsCollection('uid-1').path;
  __triggerSnapshot(refsPath, refsSnapshot([{ classroomId: 'classroom-a', role: 'teacher' }]));

  // The exact race this fix closes: the ref list has arrived (a listener
  // is open for classroom-a), but classroom-a's own document snapshot
  // has not fired yet — getClassroomById() is still null, which is
  // legitimately "not loaded yet", not "doesn't exist".
  assert.equal(workspaceService.hasClassroomSubscription('classroom-a'), true);
  assert.ok(!workspaceService.getClassroomById('classroom-a'));

  const classroomPath = repository._classroomDoc('classroom-a').path;
  __triggerSnapshot(classroomPath, docSnapshot({ id: 'classroom-a', teams: [] }));

  assert.equal(workspaceService.hasClassroomSubscription('classroom-a'), true);
  assert.ok(workspaceService.getClassroomById('classroom-a'));
});

test('hasClassroomSubscription is false for a classroom id that was never one of this teacher\'s refs', async () => {
  await workspaceService.initForUser('uid-2', 'Teacher Two', () => {});

  const refsPath = repository._classroomRefsCollection('uid-2').path;
  __triggerSnapshot(refsPath, refsSnapshot([{ classroomId: 'classroom-b', role: 'teacher' }]));

  // Genuinely not accessible/nonexistent — no listener was ever opened
  // for this id, unlike classroom-b above. This is the one case main.js
  // should still redirect away for.
  assert.equal(workspaceService.hasClassroomSubscription('classroom-does-not-exist'), false);
});

test('onChange fires both when the ref list arrives and again once the classroom document itself loads', async () => {
  let callCount = 0;
  await workspaceService.initForUser('uid-3', 'Teacher Three', () => {
    callCount += 1;
  });

  const refsPath = repository._classroomRefsCollection('uid-3').path;
  __triggerSnapshot(refsPath, refsSnapshot([{ classroomId: 'classroom-c', role: 'teacher' }]));
  assert.equal(callCount, 1);

  const classroomPath = repository._classroomDoc('classroom-c').path;
  __triggerSnapshot(classroomPath, docSnapshot({ id: 'classroom-c', teams: [] }));
  assert.equal(callCount, 2);
});

test('a classroom whose ref disappears is no longer reported as a known subscription', async () => {
  await workspaceService.initForUser('uid-4', 'Teacher Four', () => {});

  const refsPath = repository._classroomRefsCollection('uid-4').path;
  __triggerSnapshot(refsPath, refsSnapshot([{ classroomId: 'classroom-d', role: 'teacher' }]));
  assert.equal(workspaceService.hasClassroomSubscription('classroom-d'), true);

  __triggerSnapshot(refsPath, refsSnapshot([]));
  assert.equal(workspaceService.hasClassroomSubscription('classroom-d'), false);
});
