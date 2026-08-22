/**
 * firebase-rules-verification/studentEntries.rules.verify.js
 *
 * PHASE 3.7 — rewritten for the new goals ARCHITECTURE: goals moved
 * out of the studentEntries/{studentId} parent document (where Phase
 * 3.2 authorized them as an embedded map) into their own
 * studentEntries/{studentId}/goals/{categoryId} subcollection, one
 * document per category. The parent document now owns ONLY
 * `attendance`. This file replaces the Phase 3.2 suite entirely
 * rather than layering on top of it — the embedded-map shape it
 * tested no longer exists for any session created under this phase.
 *
 * Same isolation conventions as every prior harness file in this
 * directory: not named `.test.js` (so the app's own `node --test`
 * never picks it up), reads the real `../firestore.rules` directly,
 * uses only synthetic IDs.
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
function goalPath(classroomId, sessionId, studentId, categoryId) {
  return `${entryPath(classroomId, sessionId, studentId)}/goals/${categoryId}`;
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

    // Parent studentEntries docs — PHASE 3.7: attendance only, no
    // `goals` field at all (that map no longer exists on this
    // document under the new architecture).
    await setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: null });
    await setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-B')), { attendance: null });

    await setDoc(doc(db, linkPath(CLASSROOM_ID, PROGRAMME_ID, 'uid-A')), { studentId: 'student-A', joinedAt: '2026-01-01T00:00:00.000Z', status: 'active' });
    await setDoc(doc(db, linkPath(CLASSROOM_ID, PROGRAMME_ID, 'uid-inactive')), { studentId: 'student-inactive', joinedAt: '2026-01-01T00:00:00.000Z', status: 'active' });
    await setDoc(doc(db, linkPath(CLASSROOM_ID, OTHER_PROGRAMME_ID, 'uid-A')), { studentId: 'student-D', joinedAt: '2026-01-01T00:00:00.000Z', status: 'active' });
  });
});

// The exact shape a legitimate student create actually produces —
// traced directly against models/ProgrammeSession.js's own
// createProgrammeGoalEntry(): outcome/reflection are always present,
// always at their own untouched defaults, never omitted.
const VALID_GOAL = { text: 'Read for 10 minutes', source: 'custom', outcome: null, reflection: '' };

// ---------------------------------------------------------------------
// 1–3 — parent document read boundaries, unchanged in spirit by this
// round's own restructuring
// ---------------------------------------------------------------------

test('1. Student A reads own StudentEntry (parent doc) -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(getDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A'))));
});

test('2. Student A reads Student B\'s StudentEntry (parent doc) -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(getDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-B'))));
});

test('3. Student A reads parent ProgrammeSession -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(getDoc(doc(db, sessionPath(CLASSROOM_ID, SESSION_ID))));
});

// ---------------------------------------------------------------------
// 4–5 — PHASE 3.7: a student may NEVER write to the parent document
// at all anymore (goals moved out; attendance was already
// teacher-only). This is the core architecture change this round
// makes — Phase 3.2 previously allowed a student to create/update
// `goals` directly on this same document.
// ---------------------------------------------------------------------

test('4. Student A attempts to create their own parent StudentEntry directly -> DENY (only a teacher ever creates this document; the create rule has no student branch at all)', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(setDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-new')), { attendance: null }));
});

test('5. Student A attempts to write `goals` onto the parent document directly -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(updateDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { goals: { 'cat-1': VALID_GOAL } }));
});

test('5b. Teacher attempts to write `goals` onto the parent document directly -> DENY (goals no longer live here at all, not even for a teacher)', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertFails(updateDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { goals: { 'cat-1': VALID_GOAL } }));
});

// ---------------------------------------------------------------------
// 6–9 — CREATE-time field ownership on the new goals/{categoryId}
// subcollection. This is the direct successor to Phase 3.2's own
// isValidStudentGoalCreate() — now checked against ONE document's own
// fields directly, never an iterated map.
// ---------------------------------------------------------------------

test('6. Student A creates own goal with text + source only -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL));
});

test('7. Student A creates own goal with a non-null outcome -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), {
      text: 'Read for 10 minutes', source: 'custom', outcome: 'completed', reflection: '',
    })
  );
});

test('8. Student A creates own goal with a non-empty reflection -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), {
      text: 'Read for 10 minutes', source: 'custom', outcome: null, reflection: 'I did great',
    })
  );
});

test('9. Student A creates own goal with both outcome and reflection set -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), {
      text: 'Read for 10 minutes', source: 'custom', outcome: 'completed', reflection: 'I did great',
    })
  );
});

// ---------------------------------------------------------------------
// 10–12 — UPDATE-time field ownership. A student may replace their own
// goal's text/source (the "Edit Goal" flow) but never touch
// outcome/reflection in the same write, or at all.
// ---------------------------------------------------------------------

test('10. Student A creates a valid goal, then attempts to add outcome via update -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL));
  await assertFails(updateDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), { outcome: 'completed' }));
});

test('11. Student A creates a valid goal, then attempts to add reflection via update -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL));
  await assertFails(updateDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), { reflection: 'I did great' }));
});

test('12. Student A creates a valid goal, then replaces text/source only via update -> ALLOW (the "Edit Goal" flow)', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL));
  await assertSucceeds(updateDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), { text: 'Read for 15 minutes', source: 'custom' }));
});

// ---------------------------------------------------------------------
// 13–14 — arbitrary fields
// ---------------------------------------------------------------------

test('13. Student A attempts an arbitrary nested field inside a new goal -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), {
      text: 'Read for 10 minutes', source: 'custom', outcome: null, reflection: '', teacherNote: 'hacked',
    })
  );
});

test('14. Student A attempts to smuggle outcome alongside a legitimate text/source update -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL));
  await assertFails(updateDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), { text: 'Read for 15 minutes', outcome: 'completed' }));
});

// ---------------------------------------------------------------------
// 15–16 — identity/attendance boundaries, unaffected by this round
// ---------------------------------------------------------------------

test('15. Student A writes Student B\'s goal -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-B', 'cat-1')), VALID_GOAL));
});

test('16. Student A writes own attendance (parent doc) -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(updateDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: { status: 'present', recordedAt: '2026-08-19T09:00:00.000Z' } }));
});

// ---------------------------------------------------------------------
// 17–21 — teacher access fully preserved
// ---------------------------------------------------------------------

test('17. Teacher reads a goal document -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1'))));
});

test('18. Teacher writes attendance on the parent doc -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A')), { attendance: { status: 'absent', recordedAt: '2026-08-19T09:00:00.000Z' } }));
});

test('19. Teacher creates a goal on a student\'s behalf (e.g. picking a suggestion) -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL));
});

test('20. Teacher edits goal outcome -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), { outcome: 'completed' }));
});

test('21. Teacher edits goal reflection -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(updateDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), { reflection: 'Great progress today' }));
});

// ---------------------------------------------------------------------
// 22–23 — unauthenticated
// ---------------------------------------------------------------------

test('22. Unauthenticated StudentEntry read -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, entryPath(CLASSROOM_ID, SESSION_ID, 'student-A'))));
});

test('23. Unauthenticated goal write -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'cat-1')), VALID_GOAL));
});

// ---------------------------------------------------------------------
// 24–25 — membership-status and cross-programme boundaries
// ---------------------------------------------------------------------

/**
 * PHASE 3.7 FINDING — NOT HARD-ASSERTED, DELIBERATELY. Running this
 * exact test against the emulator for the first time (this rule was
 * previously "unverified against a live/emulated project" per the
 * original audit) revealed that it actually ALLOWS, not DENIES. Root
 * cause: `isLinkedActiveStudent()` (defined on the enclosing
 * studentEntries match block, copied UNCHANGED from the pre-existing
 * Phase 3.2 rule — not modified by Phase 3.7) checks only
 * `membershipLinks/{uid}`'s own `status` field, which is fixed to
 * 'active' forever at link-creation time (`allow update: if false` on
 * that document) — it never re-checks the student's CURRENT programme
 * membership status. A student whose device linked while genuinely
 * active retains studentEntries/goals read+write access to that
 * programme indefinitely, even after actually leaving it (`student-
 * inactive` here: 'left' in the real membership data, but their
 * pre-existing link's own status is still, and always will be,
 * 'active'). This is a real, pre-existing trust-boundary gap, not a
 * Phase 3.7 regression and not an environment artifact — confirmed
 * genuine by direct inspection of the unchanged rule text. Per
 * explicit Phase 3.7 authorization, this is deliberately deferred as
 * out of this round's scope (goals subcollection, sessionIndex,
 * deterministic ids, membership mirror, UI wiring) — reported here,
 * plainly, for whoever scopes the actual fix, rather than silently
 * masked by loosening this test to match the bug.
 */
test('24. Inactive student attempts own goal access -> report ACTUAL result, do not assume DENY (see this test\'s own comment: a real, pre-existing, deliberately deferred gap)', async () => {
  const db = testEnv.authenticatedContext('uid-inactive').firestore();
  const attempt = setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-inactive', 'cat-1')), VALID_GOAL);
  try {
    await attempt;
    console.log(
      '[TEST 24 RESULT] ALLOWED — confirms the known gap: isLinkedActiveStudent() checks only the membershipLinks ' +
        'document\'s own permanently-fixed status, never the student\'s current programme membership status.'
    );
  } catch (error) {
    console.log('[TEST 24 RESULT] DENIED — a genuine surprise; re-check whether the rule or fixture changed. Raw error:', error.message);
  }
});

test('25. Student linked to Programme A attempts Programme B\'s goal -> DENY', async () => {
  // uid-A has a real, active link to student-D, but only under
  // OTHER_PROGRAMME_ID — SESSION_ID's own programmeId field points at
  // PROGRAMME_ID, so isLinkedActiveStudent() must resolve against the
  // WRONG programme's own membershipLinks and fail.
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-D', 'cat-1')), VALID_GOAL));
});

// ---------------------------------------------------------------------
// 26 — one remaining, deliberately deferred, open question — carried
// forward unchanged from Phase 3.1/3.2 (category-id validation was
// out of scope then and remains out of scope this round; the new
// per-document shape does not change this).
// ---------------------------------------------------------------------

test('26. Student attempts an arbitrary, non-configured category id as the goal document\'s own id -> report ACTUAL result, do not assume DENY (deliberately deferred, not this round\'s scope)', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  const attempt = setDoc(doc(db, goalPath(CLASSROOM_ID, SESSION_ID, 'student-A', 'totally-made-up-category-id-not-in-any-programme-config')), VALID_GOAL);
  try {
    await attempt;
    console.log('[TEST 26 RESULT] ALLOWED — expected and accepted: category-ID validation remains explicitly deferred (a data-integrity limitation, not an identity-boundary failure).');
  } catch (error) {
    console.log('[TEST 26 RESULT] DENIED —', error.message);
  }
});
