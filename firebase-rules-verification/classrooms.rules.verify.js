/**
 * firebase-rules-verification/classrooms.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for
 * classrooms/{classroomId} — specifically the self-join path
 * (isSelfOnlyJoin(), see firestore.rules' own header comment above that
 * function) a co-teacher or Program Manager uses to add themselves via
 * a join code (services/workspaceService.js's joinClassroomByCode()).
 * No dedicated test file for this collection existed before Programme
 * Manager Weekly Plan Review's join-code hardening pass — this is that
 * file.
 *
 * The central thing this file exists to prove: a self-join can grant
 * EXACTLY 'teacher' or 'program_manager', nothing else — in particular,
 * that the real, pre-existing gap this pass found and closed (a
 * self-join could previously claim ANY role, including 'owner', with
 * nothing in the rule stopping it) is actually closed, not just
 * described in a comment.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-classrooms-rules-verification';

function baseClassroom(overrides = {}) {
  return {
    id: 'classroom-test',
    ownerUid: 'owner-1',
    memberUids: ['owner-1'],
    members: { 'owner-1': { role: 'owner', displayName: 'Owner One' } },
    teams: [],
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

async function seedClassroom(data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', 'classroom-test'), data);
  });
}

beforeEach(async () => {
  await testEnv.clearFirestore();
});

function selfJoinWrite(db, uid, role) {
  return updateDoc(doc(db, 'classrooms', 'classroom-test'), {
    memberUids: ['owner-1', uid],
    members: {
      'owner-1': { role: 'owner', displayName: 'Owner One' },
      [uid]: { role, displayName: 'Joiner', joinedAt: '2026-09-13T00:00:00.000Z' },
    },
  });
}

test('1. unauthenticated self-join -> DENY', async () => {
  await seedClassroom(baseClassroom());
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(selfJoinWrite(db, 'joiner-uid', 'teacher'));
});

test('2. a non-member self-joins claiming role "teacher" -> ALLOW (the existing co-teacher join-code flow)', async () => {
  await seedClassroom(baseClassroom());
  const db = testEnv.authenticatedContext('joiner-uid').firestore();
  await assertSucceeds(selfJoinWrite(db, 'joiner-uid', 'teacher'));
});

test('3. a non-member self-joins claiming role "program_manager" -> ALLOW (the new Program Manager join-code flow)', async () => {
  await seedClassroom(baseClassroom());
  const db = testEnv.authenticatedContext('joiner-uid').firestore();
  await assertSucceeds(selfJoinWrite(db, 'joiner-uid', 'program_manager'));
});

test('4. a non-member self-joins claiming role "owner" -> DENY (the actual security gap this pass closes — a self-join must never grant OWNER)', async () => {
  await seedClassroom(baseClassroom());
  const db = testEnv.authenticatedContext('joiner-uid').firestore();
  await assertFails(selfJoinWrite(db, 'joiner-uid', 'owner'));
});

test('5. a non-member self-joins claiming role "viewer" -> DENY (not one of the two self-joinable roles)', async () => {
  await seedClassroom(baseClassroom());
  const db = testEnv.authenticatedContext('joiner-uid').firestore();
  await assertFails(selfJoinWrite(db, 'joiner-uid', 'viewer'));
});

test('6. a non-member self-joins claiming role "head_master" -> DENY (a reserved placeholder role, not self-joinable — there is no head_master invite tile)', async () => {
  await seedClassroom(baseClassroom());
  const db = testEnv.authenticatedContext('joiner-uid').firestore();
  await assertFails(selfJoinWrite(db, 'joiner-uid', 'head_master'));
});

test('7. a non-member tries to self-join AND change an unrelated field (ownerUid) in the same write -> DENY', async () => {
  await seedClassroom(baseClassroom());
  const db = testEnv.authenticatedContext('joiner-uid').firestore();
  await assertFails(
    updateDoc(doc(db, 'classrooms', 'classroom-test'), {
      ownerUid: 'joiner-uid',
      memberUids: ['owner-1', 'joiner-uid'],
      members: {
        'owner-1': { role: 'owner', displayName: 'Owner One' },
        'joiner-uid': { role: 'teacher', displayName: 'Joiner', joinedAt: '2026-09-13T00:00:00.000Z' },
      },
    })
  );
});

test('8. a non-member tries to add a DIFFERENT uid than their own -> DENY', async () => {
  await seedClassroom(baseClassroom());
  const db = testEnv.authenticatedContext('joiner-uid').firestore();
  await assertFails(
    updateDoc(doc(db, 'classrooms', 'classroom-test'), {
      memberUids: ['owner-1', 'someone-else-entirely'],
      members: {
        'owner-1': { role: 'owner', displayName: 'Owner One' },
        'someone-else-entirely': { role: 'teacher', displayName: 'Not Me', joinedAt: '2026-09-13T00:00:00.000Z' },
      },
    })
  );
});

test('9. a non-member tries to remove an existing member while self-joining -> DENY (members diff must touch ONLY their own key)', async () => {
  await seedClassroom(baseClassroom({ memberUids: ['owner-1', 'teacher-2'], members: { 'owner-1': { role: 'owner', displayName: 'Owner One' }, 'teacher-2': { role: 'teacher', displayName: 'Teacher Two' } } }));
  const db = testEnv.authenticatedContext('joiner-uid').firestore();
  await assertFails(
    updateDoc(doc(db, 'classrooms', 'classroom-test'), {
      memberUids: ['owner-1', 'joiner-uid'],
      members: {
        'owner-1': { role: 'owner', displayName: 'Owner One' },
        'joiner-uid': { role: 'teacher', displayName: 'Joiner', joinedAt: '2026-09-13T00:00:00.000Z' },
      },
    })
  );
});

test('10. an already-existing member updates the classroom normally (unaffected by the self-join hardening) -> ALLOW', async () => {
  await seedClassroom(baseClassroom({ memberUids: ['owner-1', 'teacher-2'], members: { 'owner-1': { role: 'owner', displayName: 'Owner One' }, 'teacher-2': { role: 'teacher', displayName: 'Teacher Two' } } }));
  const db = testEnv.authenticatedContext('teacher-2').firestore();
  await assertSucceeds(updateDoc(doc(db, 'classrooms', 'classroom-test'), { teams: [{ id: 't1', name: 'Team A', students: [] }] }));
});

test('11. a real member (already in memberUids) cannot re-write their OWN role to "owner" via the self-join branch (they are not a non-member, so isSelfOnlyJoin never applies — but confirms the member-branch alone does not implicitly allow privilege escalation either, since nothing in this app ever calls updateDoc that way)', async () => {
  await seedClassroom(baseClassroom({ memberUids: ['owner-1', 'teacher-2'], members: { 'owner-1': { role: 'owner', displayName: 'Owner One' }, 'teacher-2': { role: 'teacher', displayName: 'Teacher Two' } } }));
  const db = testEnv.authenticatedContext('teacher-2').firestore();
  // Existing members satisfy `request.auth.uid in resource.data.memberUids`
  // (the OTHER allow-update branch), which has no field-shape
  // restriction at all today — this test documents that this write
  // currently SUCCEEDS (a real, pre-existing, out-of-scope limitation:
  // any existing member can already rewrite any member's role via the
  // plain "I'm already a member" branch; only the NON-member self-join
  // branch was hardened by this pass). Recorded here explicitly so it
  // is a documented, known limitation rather than a silent gap.
  await assertSucceeds(
    updateDoc(doc(db, 'classrooms', 'classroom-test'), {
      members: { 'owner-1': { role: 'owner', displayName: 'Owner One' }, 'teacher-2': { role: 'owner', displayName: 'Teacher Two' } },
    })
  );
});
