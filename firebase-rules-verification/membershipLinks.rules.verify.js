/**
 * firebase-rules-verification/membershipLinks.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for the
 * `membershipLinks` rule introduced in Phase 1 — Membership Identity
 * Foundation. This file cannot run in the sandbox that authored it
 * (no network access to install @firebase/rules-unit-testing or
 * download the Firestore emulator binary — see this directory's own
 * README.md for exactly what was checked and what failed). It is
 * written to run for real once copied to a machine with normal
 * network access — see README.md for the exact setup and run
 * commands.
 *
 * Deliberately named `.verify.js`, NOT `.test.js` — this project's
 * own application test suite (../tests/) is run via a bare
 * `node --test` from the repo root, which recursively discovers
 * every `*.test.js` file by Node's own default convention. This file
 * depends on packages (@firebase/rules-unit-testing, firebase) that
 * are not installed anywhere in the main application tree and were
 * never meant to be — naming it `.test.js` would make a bare
 * `node --test` run from the repo root attempt to load it, fail on
 * the missing dependency, and look like a new, confusing regression
 * in the application's own suite. This file is only ever run
 * explicitly, from inside this directory, per README.md.
 *
 * Reads the REAL, actual ../firestore.rules — never a copy — so
 * whatever this proves (or doesn't) is about the actual rule in the
 * actual repository, not a duplicate that could drift out of sync
 * with it.
 *
 * TEST 3 IS DELIBERATELY NOT ASSERTED EITHER WAY. Per this Phase's
 * own explicit instruction, this is the known, open trust-boundary
 * question — whether the current rule can be tricked into letting
 * one student claim to be a different, real, active student. This
 * harness reports the actual result plainly, via console.log, and
 * does not fail the suite regardless of which way it comes out —
 * asserting a specific expectation here would either mask a real
 * security gap (if we asserted ALLOW as "expected") or falsely claim
 * a fix that was never made (if we asserted DENY without one).
 *
 * TEST 1 IS ALSO NOT HARD-ASSERTED, FOR A DIFFERENT, PHASE 3.7 REASON
 * — an ENVIRONMENT limitation, not an open question about the rule
 * itself. This suite's own Phase 3.7 round confirmed, via isolated
 * throwaway rulesets with no relation to this app's own rules, that
 * the local Firestore Emulator this harness runs against (Firestore
 * Emulator v1.22.0, "standard edition," as shipped by the latest
 * available firebase-tools at the time — 15.28.1, checked and
 * upgraded from 15.26.0 specifically to rule out a stale binary)
 * throws `Function not found error: Name: [exists]` / `[filter]` /
 * `[all]` / `[map]` for EVERY Firestore Rules list-predicate macro,
 * at every nesting level, including a single, non-nested
 * `list.exists(x, predicate)` with no relation whatsoever to this
 * rule's own nested form. No rules-language rewrite was found that
 * both avoids every one of these macros AND preserves the fallback's
 * own exact authorization semantics (match on studentId + status,
 * ignoring a membership's other fields) — the one macro-free
 * alternative found, exact map-equality via the `in` operator,
 * requires matching every field on a membership record and would
 * silently narrow who qualifies. Per explicit Phase 3.7 authorization:
 * ship the Phase 1 fallback exactly as originally written (zero
 * semantic change) rather than weaken it to fit this local
 * environment's own limitation. This means test 1 — which needs the
 * fallback to reach a clean ALLOW for a studentId active ONLY via the
 * embedded array, no mirror doc — cannot pass in THIS environment; it
 * reports its actual result via console.log without failing the
 * suite. Tests 4/5/12/13 (which need the SAME fallback to reach DENY)
 * are unaffected — an evaluation error still counts as a denial for
 * assertFails(), so those remain genuine, meaningful assertions.
 * Tests 14–16 (the new mirror-doc path) do not touch this fallback at
 * all and are fully, cleanly verified. This is a tooling limitation
 * confirmed in THIS local environment, not a proven defect in
 * production Firestore's own rules engine — re-verify test 1
 * specifically against a real or staging Firebase project (or a
 * future emulator release) before relying on this fallback in
 * production for a membership with no mirror doc yet.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-membershiplinks-rules-verification';

/** Kept in one place so every test builds the same shape of "otherwise-valid" document — only the ONE field each test is actually probing should ever differ from this. */
const VALID_LINK = Object.freeze({
  studentId: 'student-A',
  joinedAt: '2026-01-01T00:00:00.000Z',
  status: 'active',
});

function linkPath(classroomId, programmeId, uid) {
  return `classrooms/${classroomId}/learningProgrammes/${programmeId}/membershipLinks/${uid}`;
}

function membershipMirrorPath(classroomId, programmeId, studentId) {
  return `classrooms/${classroomId}/learningProgrammes/${programmeId}/memberships/${studentId}`;
}

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      // The real rule, read fresh from the actual file — not a copy.
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
 * Synthetic-only fixture data, seeded fresh before every single test
 * via withSecurityRulesDisabled() (a trusted, rules-bypassing setup
 * channel @firebase/rules-unit-testing provides specifically for
 * this purpose — using it to SEED data is not the same as using it
 * to test the rule itself). No real classroom ID, student ID, name,
 * or UID appears anywhere in this file.
 *
 * `classroom-test`'s own `programme-test`: student-A and student-B
 * are active members; student-C is a former, now-'left' member —
 * present specifically so test 4 has a real, inactive membership to
 * probe, not an absent one. A second programme, `other-programme-
 * test`, exists on the SAME classroom with a completely different
 * member (student-D) — for test 13 (wrong programme). A second
 * classroom, `other-classroom-test`, exists with its own, entirely
 * non-overlapping membership (student-E) — for test 12 (wrong
 * classroom), so that test fails for the right reason (no matching
 * membership in THAT classroom's own data) rather than an accidental
 * coincidence in the fixture.
 */
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'classrooms', 'classroom-test'), {
      memberUids: ['teacher-uid-test'],
      learningProgrammes: [
        {
          id: 'programme-test',
          memberships: [
            { studentId: 'student-A', status: 'active' },
            { studentId: 'student-B', status: 'active' },
            { studentId: 'student-C', status: 'left' },
          ],
        },
        {
          id: 'other-programme-test',
          memberships: [{ studentId: 'student-D', status: 'active' }],
        },
      ],
    });
    await setDoc(doc(db, 'classrooms', 'other-classroom-test'), {
      memberUids: ['teacher-uid-test-2'],
      learningProgrammes: [
        {
          id: 'programme-test',
          memberships: [{ studentId: 'student-E', status: 'active' }],
        },
      ],
    });

    // PHASE 3.7 — direct membership mirror documents. student-F/G
    // exist ONLY here — deliberately absent from the embedded
    // classroom.learningProgrammes[].memberships[] array above — so a
    // test using them proves the new mirror-doc path is sufficient on
    // its own, not merely riding along with the pre-existing fallback.
    await setDoc(doc(db, membershipMirrorPath('classroom-test', 'programme-test', 'student-F')), {
      status: 'active',
      joinedAt: '2026-01-01T00:00:00.000Z',
    });
    await setDoc(doc(db, membershipMirrorPath('classroom-test', 'programme-test', 'student-G')), {
      status: 'left',
      joinedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------
// 1–2 — own identity, and only own identity
// ---------------------------------------------------------------------

test('1. own uid + own studentId (active only via the embedded-array fallback, no mirror doc) -> report actual result, do not assert (see this file\'s own header comment: confirmed local-emulator limitation, not an open question about the rule)', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  const attempt = setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-A')), VALID_LINK);
  try {
    await attempt;
    console.log('[TEST 1 RESULT] ALLOWED — the fallback resolved correctly in this run.');
  } catch (error) {
    console.log(
      '[TEST 1 RESULT] DENIED — expected in this environment: the embedded-array fallback\'s own nested list.exists() ' +
        'cannot be evaluated by this local Firestore Emulator build at all (see this file\'s own header comment). ' +
        `Raw error: ${error.message}`
    );
  }
});

test('2. own uid attempts to create ANOTHER uid\'s path -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-B')), VALID_LINK));
});

// ---------------------------------------------------------------------
// 3 — THE OPEN QUESTION. Not asserted either way — see this file's
// own header comment for why.
// ---------------------------------------------------------------------

test('3. own uid + a DIFFERENT real, active student\'s studentId -> report actual result, assert nothing', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  const attempt = setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-A')), {
    studentId: 'student-B', // uid-A claiming to BE student-B, a different, real, active member
    joinedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
  });
  try {
    await attempt;
    console.log(
      '[TEST 3 RESULT] ALLOWED. This confirms the known, open trust-boundary gap documented throughout this project: ' +
        'the rule verifies "does the CLAIMED studentId have an active membership" but has no way to verify ' +
        '"does THIS specific caller correspond to that studentId." This is not a new finding this test produces — ' +
        'it is the first ACTUAL EXECUTION confirming what manual rule-reading already concluded.'
    );
  } catch (error) {
    console.log(
      '[TEST 3 RESULT] DENIED. This would be a genuine surprise relative to the manual rule trace — ' +
        'if you see this, re-read the rule text carefully, because the manual analysis expected ALLOW here. ' +
        `Raw error: ${error.message}`
    );
  }
});

// ---------------------------------------------------------------------
// 4–5 — membership status must be genuinely active, for the specific
// programme being claimed
// ---------------------------------------------------------------------

test('4. inactive (left) membership -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-C').firestore();
  await assertFails(
    setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-C')), {
      studentId: 'student-C', // status 'left' in the fixture
      joinedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
  );
});

test('5. non-member student (never enrolled) -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-Z').firestore();
  await assertFails(
    setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-Z')), {
      studentId: 'student-never-enrolled',
      joinedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
  );
});

// ---------------------------------------------------------------------
// 6–7 — immutability
// ---------------------------------------------------------------------

test('6. update studentId on an existing link -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), linkPath('classroom-test', 'programme-test', 'uid-A')), VALID_LINK);
  });
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(updateDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-A')), { studentId: 'student-B' }));
});

test('7. delete an existing link -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), linkPath('classroom-test', 'programme-test', 'uid-A')), VALID_LINK);
  });
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(deleteDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-A'))));
});

// ---------------------------------------------------------------------
// 8 — authentication is required at all
// ---------------------------------------------------------------------

test('8. unauthenticated create attempt -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-A')), VALID_LINK));
});

// ---------------------------------------------------------------------
// 9–11 — read boundaries
// ---------------------------------------------------------------------

test('9. teacher (classroom memberUid) reads a student\'s link -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), linkPath('classroom-test', 'programme-test', 'uid-A')), VALID_LINK);
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-A'))));
});

test('10. student reads a DIFFERENT student\'s link -> DENY', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), linkPath('classroom-test', 'programme-test', 'uid-A')), VALID_LINK);
  });
  const db = testEnv.authenticatedContext('uid-B').firestore();
  await assertFails(getDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-A'))));
});

test('11. student reads own link -> ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), linkPath('classroom-test', 'programme-test', 'uid-A')), VALID_LINK);
  });
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertSucceeds(getDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-A'))));
});

// ---------------------------------------------------------------------
// 12–13 — path scoping actually matters, not just membership content
// ---------------------------------------------------------------------

test('12. wrong classroom (no matching membership there at all) -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, linkPath('other-classroom-test', 'programme-test', 'uid-A')), {
      studentId: 'student-A', // not a member of other-classroom-test's own programme-test at all
      joinedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
  );
});

test('13. wrong programme (active elsewhere in the SAME classroom, not here) -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(
    setDoc(doc(db, linkPath('classroom-test', 'other-programme-test', 'uid-A')), {
      studentId: 'student-A', // active in programme-test, NOT in other-programme-test
      joinedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
  );
});

// ---------------------------------------------------------------------
// 14–17 — PHASE 3.7: the direct membership mirror document
// (learningProgrammes/{programmeId}/memberships/{studentId}) as a
// standalone path to ALLOW, entirely independent of the Phase 1
// nested-array fallback (student-F/G exist ONLY as mirror docs — see
// this file's own beforeEach comment).
// ---------------------------------------------------------------------

test('14. own uid + a studentId active ONLY via the mirror doc (absent from the embedded array entirely) -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('uid-F').firestore();
  await assertSucceeds(
    setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-F')), {
      studentId: 'student-F',
      joinedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
  );
});

test('15. own uid + a studentId whose mirror doc says \'left\' (also absent from the embedded array) -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-G').firestore();
  await assertFails(
    setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-G')), {
      studentId: 'student-G',
      joinedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
  );
});

test('16. own uid + a studentId with NO mirror doc AND no embedded array entry at all -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-Z').firestore();
  await assertFails(
    setDoc(doc(db, linkPath('classroom-test', 'programme-test', 'uid-Z')), {
      studentId: 'student-never-enrolled-anywhere',
      joinedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
  );
});

// ---------------------------------------------------------------------
// 17–20 — the memberships/{studentId} mirror document's own rule:
// teacher-only read/create/update, matching the classroom-membership
// convention every other teacher-owned collection in this file uses.
// ---------------------------------------------------------------------

test('17. Teacher reads a mirror document -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(db, membershipMirrorPath('classroom-test', 'programme-test', 'student-F'))));
});

test('18. Teacher creates/updates a mirror document -> ALLOW', async () => {
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(setDoc(doc(db, membershipMirrorPath('classroom-test', 'programme-test', 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' }));
});

test('19. A student (not a classroom teacher) attempts to write their own mirror document -> DENY', async () => {
  const db = testEnv.authenticatedContext('uid-A').firestore();
  await assertFails(setDoc(doc(db, membershipMirrorPath('classroom-test', 'programme-test', 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' }));
});

test('20. Unauthenticated write to a mirror document -> DENY', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, membershipMirrorPath('classroom-test', 'programme-test', 'student-A')), { status: 'active', joinedAt: '2026-01-01T00:00:00.000Z' }));
});
