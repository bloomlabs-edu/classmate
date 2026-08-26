/**
 * firebase-rules-verification/classroomRefs.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for the fix to
 * users/{uid}/classroomRefs/{classroomId}'s `allow delete` rule —
 * added so a classroom's real owner can remove OTHER members'
 * classroomRefs entries too, not just their own. This was needed
 * because firestoreClassroomRepository.deleteClassroom() deletes the
 * classroom document AND every member's classroomRefs entry in ONE
 * atomic batch; since a batch is all-or-nothing, the previous rule
 * (owner-of-the-ref-only) failed the ENTIRE deletion with
 * PERMISSION_DENIED for any classroom with more than one member —
 * confirmed as the real, reproduced cause via temporary diagnostic
 * logging (see workspaceService.js/firestoreClassroomRepository.js
 * history) before this fix was written.
 *
 * Same conventions as membershipLinks.rules.verify.js /
 * studentEntries.rules.verify.js in this same directory: `.verify.js`
 * (not `.test.js`, so the app's own `node --test` never picks this
 * up), reads the REAL ../firestore.rules directly, synthetic-only
 * fixture data (no real classroom/user IDs), seeded fresh per test
 * via withSecurityRulesDisabled().
 *
 * Run with the Firestore emulator up (see README.md / run-
 * verification.sh in this directory): `node --test
 * classroomRefs.rules.verify.js`.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-classroomrefs-rules-verification';

function refPath(uid, classroomId) {
  return `users/${uid}/classroomRefs/${classroomId}`;
}

const VALID_REF = Object.freeze({ role: 'teacher', joinedAt: '2026-01-01T00:00:00.000Z' });

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

/**
 * Three classrooms:
 *   - 'single-member-classroom': owner-uid only.
 *   - 'multi-member-classroom': owner-uid + coteacher-uid — the
 *     shared/co-taught shape that actually triggered the original bug.
 *   - 'other-classroom': a completely separate owner/member pair, used
 *     to prove the owner-exception can't reach across classrooms it
 *     doesn't own.
 * classroomRefs are seeded to match memberUids exactly, plus one
 * deliberately-orphaned ref (no matching classroom document at all)
 * and one deliberately-mismatched ref (a uid with a ref document
 * under multi-member-classroom's ID who was never actually added to
 * that classroom's own memberUids) for the negative-scoping tests.
 */
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'classrooms', 'single-member-classroom'), {
      ownerUid: 'owner-uid',
      memberUids: ['owner-uid'],
    });
    await setDoc(doc(db, 'classrooms', 'multi-member-classroom'), {
      ownerUid: 'owner-uid',
      memberUids: ['owner-uid', 'coteacher-uid'],
    });
    await setDoc(doc(db, 'classrooms', 'other-classroom'), {
      ownerUid: 'other-owner-uid',
      memberUids: ['other-owner-uid', 'other-member-uid'],
    });

    await setDoc(doc(db, refPath('owner-uid', 'single-member-classroom')), VALID_REF);
    await setDoc(doc(db, refPath('owner-uid', 'multi-member-classroom')), VALID_REF);
    await setDoc(doc(db, refPath('coteacher-uid', 'multi-member-classroom')), VALID_REF);
    await setDoc(doc(db, refPath('other-owner-uid', 'other-classroom')), VALID_REF);
    await setDoc(doc(db, refPath('other-member-uid', 'other-classroom')), VALID_REF);

    // Orphaned ref — no classrooms/orphan-classroom document exists at all.
    await setDoc(doc(db, refPath('orphan-uid', 'orphan-classroom')), VALID_REF);

    // Mismatched ref — real classroom exists, but random-uid was never
    // added to its memberUids. Its OWN ref document still lives under
    // multi-member-classroom's ID purely so test 9 has something
    // concrete to attempt deleting.
    await setDoc(doc(db, refPath('random-uid', 'multi-member-classroom')), VALID_REF);
  });
});

// ---------------------------------------------------------------------
// 1–2 — single-member classroom, unaffected baseline behavior
// ---------------------------------------------------------------------

test('1. single-member classroom: owner deletes the classroom document -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertSucceeds(deleteDoc(doc(db, 'classrooms', 'single-member-classroom')));
});

test('2. single-member classroom: owner deletes their OWN classroomRef -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertSucceeds(deleteDoc(doc(db, refPath('owner-uid', 'single-member-classroom'))));
});

// ---------------------------------------------------------------------
// 3–5 — multi-member classroom: THE FIX. This is the exact scenario
// that previously made deleteClassroom()'s atomic batch fail whole.
// ---------------------------------------------------------------------

test('3. multi-member classroom: owner deletes the classroom document -> ALLOW (unchanged)', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertSucceeds(deleteDoc(doc(db, 'classrooms', 'multi-member-classroom')));
});

test('4. multi-member classroom: owner deletes their OWN classroomRef -> ALLOW (unchanged)', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertSucceeds(deleteDoc(doc(db, refPath('owner-uid', 'multi-member-classroom'))));
});

test('5. multi-member classroom: owner deletes the CO-TEACHER\'s classroomRef -> ALLOW (this is the fix)', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertSucceeds(deleteDoc(doc(db, refPath('coteacher-uid', 'multi-member-classroom'))));
});

// ---------------------------------------------------------------------
// 6–7 — a non-owner member gains NOTHING from this change
// ---------------------------------------------------------------------

test('6. multi-member classroom: co-teacher (non-owner) deletes the OWNER\'s classroomRef -> DENY', async () => {
  const db = testEnv.authenticatedContext('coteacher-uid').firestore();
  await assertFails(deleteDoc(doc(db, refPath('owner-uid', 'multi-member-classroom'))));
});

test('7. multi-member classroom: co-teacher deletes their OWN classroomRef -> ALLOW (unchanged self-delete)', async () => {
  const db = testEnv.authenticatedContext('coteacher-uid').firestore();
  await assertSucceeds(deleteDoc(doc(db, refPath('coteacher-uid', 'multi-member-classroom'))));
});

// ---------------------------------------------------------------------
// 8–10 — the owner-exception is scoped tightly: real ownership of
// THAT classroom, AND the ref's own uid must actually be a member of
// it. Neither condition alone is enough.
// ---------------------------------------------------------------------

test('8. owner of multi-member-classroom cannot delete a ref under a DIFFERENT classroom they don\'t own -> DENY', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertFails(deleteDoc(doc(db, refPath('other-member-uid', 'other-classroom'))));
});

test('9. real owner, but target uid was never actually a member of that classroom -> DENY', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertFails(deleteDoc(doc(db, refPath('random-uid', 'multi-member-classroom'))));
});

test('10. non-owner cannot delete an unrelated orphaned ref belonging to someone else -> DENY', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertFails(deleteDoc(doc(db, refPath('orphan-uid', 'orphan-classroom'))));
});

// ---------------------------------------------------------------------
// 11 — the plain self-delete branch never needed a classroom document
// to exist before this change, and still doesn't.
// ---------------------------------------------------------------------

test('11. orphaned ref: its own uid can still delete it even with no classroom document at all -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('orphan-uid').firestore();
  await assertSucceeds(deleteDoc(doc(db, refPath('orphan-uid', 'orphan-classroom'))));
});

// ---------------------------------------------------------------------
// 12–14 — read/create/update are completely untouched by this change
// ---------------------------------------------------------------------

test('12. read: own classroomRef -> ALLOW, another user\'s -> DENY (unchanged)', async () => {
  const db = testEnv.authenticatedContext('coteacher-uid').firestore();
  await assertSucceeds(getDoc(doc(db, refPath('coteacher-uid', 'multi-member-classroom'))));
  await assertFails(getDoc(doc(db, refPath('owner-uid', 'multi-member-classroom'))));
});

test('13. create/update: own classroomRef -> ALLOW, another user\'s -> DENY, even for the real classroom owner (unchanged)', async () => {
  const db = testEnv.authenticatedContext('owner-uid').firestore();
  await assertSucceeds(setDoc(doc(db, refPath('owner-uid', 'multi-member-classroom')), VALID_REF));
  await assertFails(setDoc(doc(db, refPath('coteacher-uid', 'multi-member-classroom')), VALID_REF));
  await assertFails(updateDoc(doc(db, refPath('coteacher-uid', 'multi-member-classroom')), { role: 'viewer' }));
});

test('14. unauthenticated delete attempt -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(deleteDoc(doc(db, refPath('owner-uid', 'multi-member-classroom'))));
});
