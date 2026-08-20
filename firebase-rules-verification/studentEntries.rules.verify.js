/**
 * firebase-rules-verification/studentEntries.rules.verify.js
 *
 * PHASE 3.2 — rewritten to match the exact 21-test security matrix
 * this round specified, closing the goal-field-ownership gap Phase
 * 3.1's own review found (a student's write was previously scoped
 * only at the top level — `hasOnly(['goals'])` — never restricting
 * what's INSIDE `goals.<categoryId>`, so a direct, non-UI write could
 * set `outcome`/`reflection`, fields the product intends as
 * teacher-only). Same isolation conventions as every prior harness
 * file in this directory: not named `.test.js` (so the app's own
 * `node --test` never picks it up), not executable in the sandbox
 * that authored it (no network access — confirmed again this round),
 * reads the real `../firestore.rules` directly, uses only synthetic
 * IDs.
 *
 * Tests 5–9 (create) and 15–17-equivalent update variants are the
 * ones this round's own fix is actually FOR — per §16's own explicit
 * "update tests are essential" instruction, this file tests both the
 * initial create AND a subsequent update attempting to add
 * outcome/reflection to an already-existing, legitimately-created
 * goal — the exact scenario a rule that only checked create-time
 * shape would miss entirely.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-studententries-rules-verification';

const CLASSROOM_ID = 'classroom-test';
const PROGRAMME_ID = 'programme-test';
const OTHER_PROGRAMME_ID = 'other-programme-test';
const SESSION_ID = 'session-test';

function sessionPath(classroomId, sessionId) {
  return `classrooms/${classroomId}/programmeSessions/${sessionId}`;
}
function entryPath(classroomId, sessionId, studentId) {
  return `${sessionPath(classroomId, sessionId)}/studentEntries/${studentId}`;
}
function linkPath(classroomId, programmeId, uid) {
  return `classrooms/${classroomId}/learningProgrammes/${programmeId}/membershipLinks/${uid}`;
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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'classrooms', CLASSROOM_ID), {
      memberUids: ['teacher-uid-test'],
      learningProgrammes: [
        {
          id: PROGRAMME_ID,
          memberships: [
            { studentId: 'student-A', status: 'active' },
            { studentId: 'student-B', status: 'active' },
            { studentId: 'student-inactive', status: 'left' },
          ],
        },
        { id: OTHER_PROGRAMME_ID, memberships: [{ studentId: 'student-D', status: 'active' }] },
      ],
    });

    await setDoc(doc(db, sessionPath(CLASSROOM_ID, SESSION_ID)), {
      programmeId: PROGRAMME_ID,
      date: '2026-08-19',
      attendance: {},
      goals: {},
      activities: [],
      teacherObservations: {},
      usesStudentEntries: true,
    });

    await setDoc(doc(db, linkPath(CLASSROOM_ID, PROGRAMME_ID, 'uid-A')), { studentId: 'student-A', joinedAt: '2026-01-01T00:00:00.000Z', status: 'active' });
    await setDoc(doc(db, linkPath(CLASSROOM_ID, PROGRAMME_ID, 'uid-inactive')), { studentId: 'student-inactive', joinedAt: '2026-01-01T00:00:00.000Z', status: 'active' });
    await setDoc(doc(db, linkPath(CLASSROOM_ID, OTHER_PROGRAMME_ID, 'uid-A')), { studentId: 'student-D', joinedAt: '2026-01-01T00:00:00.000Z', status: 'active' });
  });
});

// The exact shape a legitimate student write actually produces —
// traced directly against models/ProgrammeSession.js's own
// createProgrammeGoalEntry(): outcome/reflection are always present,
// always at their own untouched defaults, never omitted.
const VALID_GOAL = { text: 'Read for 10 minutes', source: 'custom', outcome: null, reflection: '' };

// ---------------------------------------------------------------------
// 1–3 — read boundaries, unchanged by this round's own fix
// ---------------------------------------------------------------------

test('1. Student A reads own StudentEntry -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: null, goals: {} });
  });
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(getDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A'))));
});

test('2. Student A reads Student B\'s StudentEntry -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), entryPath(CLASSROOM_ID, SESSION_ID, 'student-B')), { attendance: null, goals: {} });
  });
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(getDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-B'))));
});

test('3. Student A reads parent ProgrammeSession -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(getDoc(doc(db, sessionPath(CLASSROOM_ID, SESSION_ID))));
});

// ---------------------------------------------------------------------
// 4–7 — CREATE-time field ownership. This is the core of this
// round's own fix: 5/6/7 are exactly the scenarios that were
// previously allowed and are the actual security gap being closed.
// ---------------------------------------------------------------------

test('4. Student A creates own goal with text + source only -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { goals: { 'cat-1': VALID_GOAL } }));
});

test('5. Student A creates own goal with a non-null outcome -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), {
      goals: { 'cat-1': { text: 'Read for 10 minutes', source: 'custom', outcome: 'completed', reflection: '' } },
    })
  );
});

test('6. Student A creates own goal with a non-empty reflection -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), {
      goals: { 'cat-1': { text: 'Read for 10 minutes', source: 'custom', outcome: null, reflection: 'I did great' } },
    })
  );
});

test('7. Student A creates own goal with both outcome and reflection set -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), {
      goals: { 'cat-1': { text: 'Read for 10 minutes', source: 'custom', outcome: 'completed', reflection: 'I did great' } },
    })
  );
});

// ---------------------------------------------------------------------
// 8–9 — UPDATE-time field ownership. Per this round's own §16, these
// are essential: a rule that only checked create-time shape would
// miss a student legitimately creating a valid goal, then attempting
// a SEPARATE, later update adding outcome/reflection.
// ---------------------------------------------------------------------

test('8. Student A creates a valid goal, then attempts to add outcome via update -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { goals: { 'cat-1': VALID_GOAL } }));
  await assertFails(updateDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { 'goals.cat-1.outcome': 'completed' }));
});

test('9. Student A creates a valid goal, then attempts to add reflection via update -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { goals: { 'cat-1': VALID_GOAL } }));
  await assertFails(updateDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { 'goals.cat-1.reflection': 'I did great' }));
});

// ---------------------------------------------------------------------
// 9b — PHASE 3.3 addition, per its own explicit §11: the exact edge
// case isValidStudentGoalUpdate()'s own resource.data.get('goals', {})
// was specifically written to handle, tested precisely rather than
// assumed. The document is first created by the TEACHER with only
// `attendance` — no `goals` field at all — then the STUDENT adds
// their own first-ever goal via updateDoc(), not setDoc(). If
// resource.data.goals were accessed directly instead of through the
// safe .get() accessor, this exact scenario would throw on a missing
// field and incorrectly deny a fully legitimate write.
// ---------------------------------------------------------------------

test('9b. Student A\'s first-ever goal, added via update, after the teacher already created the entry with only attendance (no prior goals field at all) -> ALLOW', async () => {
  const teacherDb = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(
    setDoc(doc(teacherDb, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: { status: 'present', recordedAt: '2026-08-19T09:00:00.000Z' } })
  );
  const studentDb = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(updateDoc(doc(studentDb, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { goals: { 'cat-1': VALID_GOAL } }));
});

// ---------------------------------------------------------------------
// 10–11 — arbitrary fields
// ---------------------------------------------------------------------

test('10. Student A attempts an arbitrary nested field inside a goal -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), {
      goals: { 'cat-1': { text: 'Read for 10 minutes', source: 'custom', outcome: null, reflection: '', teacherNote: 'hacked' } },
    })
  );
});

test('11. Student A attempts an arbitrary top-level field -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), {
      goals: { 'cat-1': VALID_GOAL },
      arbitraryTopLevelField: 'hacked',
    })
  );
});

// ---------------------------------------------------------------------
// 12–13 — identity/attendance boundaries, unaffected by this round
// ---------------------------------------------------------------------

test('12. Student A writes Student B\'s entry -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-B')), { goals: { 'cat-1': VALID_GOAL } }));
});

test('13. Student A writes own attendance -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: { status: 'present', recordedAt: '2026-08-19T09:00:00.000Z' } }));
});

// ---------------------------------------------------------------------
// 14–17 — teacher access fully preserved
// ---------------------------------------------------------------------

test('14. Teacher reads a StudentEntry -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: null, goals: {} });
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A'))));
});

test('15. Teacher writes attendance -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: { status: 'absent', recordedAt: '2026-08-19T09:00:00.000Z' } }));
});

test('16. Teacher edits goal outcome -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: null, goals: { 'cat-1': VALID_GOAL } });
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { 'goals.cat-1.outcome': 'completed' }));
});

test('17. Teacher edits goal reflection -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: null, goals: { 'cat-1': VALID_GOAL } });
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { 'goals.cat-1.reflection': 'Great progress today' }));
});

// ---------------------------------------------------------------------
// 18–19 — unauthenticated
// ---------------------------------------------------------------------

test('18. Unauthenticated StudentEntry read -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: null, goals: {} });
  });
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A'))));
});

test('19. Unauthenticated StudentEntry write -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { goals: { 'cat-1': VALID_GOAL } }));
});

// ---------------------------------------------------------------------
// 20–21 — membership-status and cross-programme boundaries
// ---------------------------------------------------------------------

test('20. Inactive student attempts own StudentEntry access -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-inactive').firestore();
  await assertFails(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-inactive')), { goals: { 'cat-1': VALID_GOAL } }));
});

test('21. Student linked to Programme A attempts Programme B\'s StudentEntry -> DENY', async () => {
  // uid-A has a real, active link to student-D, but only under
  // OTHER_PROGRAMME_ID — SESSION_ID's own programmeId field points at
  // PROGRAMME_ID, so isLinkedActiveStudent() must resolve against the
  // WRONG programme's own membershipLinks and fail.
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-D')), { goals: { 'cat-1': VALID_GOAL } }));
});

// ---------------------------------------------------------------------
// One remaining, deliberately deferred, open question — carried
// forward from Phase 3.1, unchanged by this round's own fix (which
// was scoped narrowly to outcome/reflection, not category-id
// validation, per this round's own explicit §8/§19 instruction).
// ---------------------------------------------------------------------

test('22. Student attempts an arbitrary, non-configured category id inside goals -> report ACTUAL result, do not assume DENY (deliberately deferred, not this round\'s scope)', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  const attempt = setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), {
    goals: { 'totally-made-up-category-id-not-in-any-programme-config': VALID_GOAL },
  });
  try {
    await attempt;
    console.log('[TEST 22 RESULT] ALLOWED — expected and accepted: category-ID validation was explicitly deferred this round (a data-integrity limitation, not an identity-boundary failure).');
  } catch (error) {
    console.log('[TEST 22 RESULT] DENIED —', error.message);
  }
});
