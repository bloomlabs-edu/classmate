/**
 * tests/functions/notebookObligationsProjection.test.js
 *
 * Pure-logic parity test — no Firestore, no emulator, no network.
 * Proves functions/src/notebookObligationsProjection.js's
 * getNotebookObligationsForStudent() stays behaviorally identical to
 * the real js/services/workRequestService.js it was deliberately
 * duplicated from (deploy-boundary duplicate — see that file's own
 * header comment), the same way tests/models/learnerConnection.test.js
 * already proves functions/src/learnerVerification/learnerConnectionShared.js
 * stays in parity with js/models/LearnerConnection.js.
 *
 * If a PARITY test below ever fails unexpectedly, js/services/workRequestService.js
 * is the source of truth — fix functions/src/notebookObligationsProjection.js
 * to match it, never the other way around.
 *
 * One EXPECTED, documented exception to parity: the "malformed entries"
 * tests near the bottom of this file prove the functions/src copy
 * safely tolerates a WorkRequest with missing/null/non-array `entries`
 * (see that file's own header comment for why), while the original
 * js/services/workRequestService.js is proven, deliberately, to still
 * throw for the exact same input — documenting a known, still-open
 * limitation in the shared client-side file, not a parity bug in the
 * duplicate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNotebookObligationsForStudent as realProjection } from '../../js/services/workRequestService.js';
import { getNotebookObligationsForStudent as duplicatedProjection } from '../../functions/src/notebookObligationsProjection.js';

function buildFixtureClassroom() {
  return {
    workRequests: [
      {
        id: 'wr-open-pending',
        type: 'notebook',
        title: 'Science Notebook Check',
        subjectId: 'subject-science',
        notebookTypeId: 'notebook-type-main',
        dueDate: '2026-11-01',
        status: 'open',
        entries: [
          { id: 'e1', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: '2026-10-20T00:00:00.000Z' },
          { id: 'e2', studentId: 'student-2', status: 'submitted', reviewOutcome: null, updatedAt: '2026-10-21T00:00:00.000Z' },
        ],
      },
      {
        id: 'wr-closed-reviewed',
        type: 'notebook',
        title: 'Math Notebook Check',
        subjectId: 'subject-math',
        notebookTypeId: 'notebook-type-main',
        dueDate: '2026-09-01',
        status: 'closed',
        entries: [
          { id: 'e3', studentId: 'student-1', status: 'reviewed', reviewOutcome: 'complete', updatedAt: '2026-09-15T00:00:00.000Z' },
        ],
      },
      {
        // Deliberately a non-notebook type — must be filtered out entirely.
        id: 'wr-worksheet',
        type: 'worksheet',
        title: 'Worksheet 3',
        subjectId: 'subject-math',
        notebookTypeId: null,
        dueDate: '2026-10-10',
        status: 'open',
        entries: [{ id: 'e4', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: '2026-10-01T00:00:00.000Z' }],
      },
    ],
  };
}

test('duplicated projection matches the real workRequestService.js projection for a student with multiple obligations', () => {
  const classroom = buildFixtureClassroom();
  assert.deepEqual(duplicatedProjection(classroom, 'student-1'), realProjection(classroom, 'student-1'));
});

test('duplicated projection matches the real projection for a student with a single obligation', () => {
  const classroom = buildFixtureClassroom();
  assert.deepEqual(duplicatedProjection(classroom, 'student-2'), realProjection(classroom, 'student-2'));
});

test('duplicated projection matches the real projection for a student with no obligations at all (empty result)', () => {
  const classroom = buildFixtureClassroom();
  assert.deepEqual(duplicatedProjection(classroom, 'student-nonexistent'), realProjection(classroom, 'student-nonexistent'));
  assert.deepEqual(duplicatedProjection(classroom, 'student-nonexistent'), []);
});

test('duplicated projection matches the real projection when classroom.workRequests is entirely absent', () => {
  const classroom = {};
  assert.deepEqual(duplicatedProjection(classroom, 'student-1'), realProjection(classroom, 'student-1'));
  assert.deepEqual(duplicatedProjection(classroom, 'student-1'), []);
});

test('duplicated projection excludes non-notebook work types, identically to the real projection', () => {
  const classroom = buildFixtureClassroom();
  const result = duplicatedProjection(classroom, 'student-1');
  assert.ok(!result.some((o) => o.requestId === 'wr-worksheet'));
  assert.deepEqual(result, realProjection(classroom, 'student-1'));
});

test('duplicated projection sorts pending-before-resolved identically to the real projection', () => {
  const classroom = buildFixtureClassroom();
  const result = duplicatedProjection(classroom, 'student-1');
  assert.equal(result[0].requestId, 'wr-open-pending', 'the still-open, not-yet-reviewed obligation should sort first');
  assert.equal(result[1].requestId, 'wr-closed-reviewed');
});

// --------------------------------------------------------------------
// Missing/malformed `entries` — regression fixtures for the security
// review's "handle missing notebook entries safely" requirement.
// Distinguishes the INTENDED case (a genuinely empty entries array)
// from MALFORMED records (entries absent, null, or not an array).
// --------------------------------------------------------------------

test('INTENDED: a notebook WorkRequest with a genuinely empty entries array (entries: []) is handled identically and safely by both — no entry for anyone, not an error', () => {
  const classroom = {
    workRequests: [
      { id: 'wr-empty-entries', type: 'notebook', title: 'Brand New Check', subjectId: 's1', notebookTypeId: 't1', dueDate: null, status: 'open', entries: [] },
    ],
  };
  assert.deepEqual(duplicatedProjection(classroom, 'student-1'), []);
  assert.deepEqual(duplicatedProjection(classroom, 'student-1'), realProjection(classroom, 'student-1'));
});

test('MALFORMED: a notebook WorkRequest with `entries` entirely absent is safely excluded by the duplicated projection, not thrown', () => {
  const classroom = {
    workRequests: [
      { id: 'wr-no-entries-field', type: 'notebook', title: 'Legacy Check', subjectId: 's1', notebookTypeId: 't1', dueDate: null, status: 'open' },
      { id: 'wr-ok', type: 'notebook', title: 'Normal Check', subjectId: 's1', notebookTypeId: 't1', dueDate: null, status: 'open', entries: [{ id: 'e1', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: '2026-10-01T00:00:00.000Z' }] },
    ],
  };
  const result = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(result.map((o) => o.requestId), ['wr-ok'], 'the malformed request is silently excluded, not thrown; the valid sibling request still resolves correctly');
});

test('MALFORMED: `entries: null` is safely excluded by the duplicated projection, not thrown', () => {
  const classroom = {
    workRequests: [{ id: 'wr-null-entries', type: 'notebook', title: 'Legacy Check', subjectId: 's1', notebookTypeId: 't1', dueDate: null, status: 'open', entries: null }],
  };
  assert.deepEqual(duplicatedProjection(classroom, 'student-1'), []);
});

test('MALFORMED: `entries` as a non-array (e.g. a stray object) is safely excluded by the duplicated projection, not thrown', () => {
  const classroom = {
    workRequests: [{ id: 'wr-object-entries', type: 'notebook', title: 'Corrupted Check', subjectId: 's1', notebookTypeId: 't1', dueDate: null, status: 'open', entries: { oops: true } }],
  };
  assert.deepEqual(duplicatedProjection(classroom, 'student-1'), []);
});

test('KNOWN, DOCUMENTED, STILL-OPEN LIMITATION: the original js/services/workRequestService.js still throws on the exact same malformed-entries input — this is the shared client-side gap this endpoint patch deliberately did not fix there (see notebookObligationsProjection.js\'s own header comment)', () => {
  const classroom = {
    workRequests: [{ id: 'wr-no-entries-field', type: 'notebook', title: 'Legacy Check', subjectId: 's1', notebookTypeId: 't1', dueDate: null, status: 'open' }],
  };
  assert.throws(() => realProjection(classroom, 'student-1'), TypeError);
});
