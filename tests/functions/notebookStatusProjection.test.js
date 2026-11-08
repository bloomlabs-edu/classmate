/**
 * tests/functions/notebookStatusProjection.test.js
 *
 * Pure-logic parity test — no Firestore, no emulator, no network.
 * Proves functions/src/notebookStatusProjection.js's
 * getNotebookStatusForStudent() stays behaviorally identical to the
 * real js/services/notebookStatusService.js it was deliberately
 * duplicated from (deploy-boundary duplicate — see that file's own
 * header comment, same established pattern as
 * notebookObligationsProjection.test.js).
 *
 * If a PARITY test below ever fails unexpectedly, js/services/
 * notebookStatusService.js (and its own checkpointService.js /
 * notebookConfigService.js / workRequestService.js dependencies) is
 * the source of truth — fix functions/src/notebookStatusProjection.js
 * to match it, never the other way around.
 *
 * Covers, per this migration's own approved test plan: checkpoint-only,
 * legacy-only, mixed (no collision), identity collision (checkpoint
 * must win, legacy obligation dropped, never double-counted),
 * zero-notebook classroom, and malformed WorkRequest data (reusing the
 * already-proven notebookObligationsProjection.js guard).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNotebookStatusForStudent as realProjection } from '../../js/services/notebookStatusService.js';
import { getNotebookStatusForStudent as duplicatedProjection } from '../../functions/src/notebookStatusProjection.js';

function emptySummary(overrides = {}) {
  return { awaitingSubmission: 0, awaitingReview: 0, needsCorrection: 0, reviewed: 0, absent: 0, ...overrides };
}

function checkpoint({ id, subjectId, notebookTypeId, title, dueDate = null, order = 0, records = [] }) {
  return { id, subjectId, notebookTypeId, title, dueDate, order, records };
}

function notebookConfig(subjects, notebookTypes) {
  return { subjects, notebookTypes };
}

// --------------------------------------------------------------------
// Checkpoint-only classroom (e.g. Bloom Force 19's own tracking mode)
// --------------------------------------------------------------------

test('checkpoint-only: a mix of not-submitted/submitted/complete/incomplete checkpoints classify and match the real projection exactly', () => {
  const classroom = {
    notebookConfig: notebookConfig(
      [{ id: 'subj-science', name: 'Science' }, { id: 'subj-social', name: 'Social Science' }],
      [
        { id: 'nbtype-main', subjectId: 'subj-science', name: 'Notebook' },
        { id: 'nbtype-main2', subjectId: 'subj-social', name: 'Notebook' },
      ]
    ),
    checkpoints: [
      checkpoint({ id: 'cp1', subjectId: 'subj-science', notebookTypeId: 'nbtype-main', title: 'Week 1', order: 0, dueDate: '2026-11-01', records: [{ studentId: 'student-1', submissionStatus: 'not_submitted' }] }),
      checkpoint({ id: 'cp2', subjectId: 'subj-science', notebookTypeId: 'nbtype-main', title: 'Week 2', order: 1, dueDate: '2026-11-08', records: [{ studentId: 'student-1', submissionStatus: 'submitted', reviewStatus: 'not_reviewed', updatedAt: '2026-11-08T00:00:00.000Z' }] }),
      checkpoint({ id: 'cp3', subjectId: 'subj-social', notebookTypeId: 'nbtype-main2', title: 'Week 1', order: 0, dueDate: '2026-11-01', records: [{ studentId: 'student-1', submissionStatus: 'submitted', reviewStatus: 'complete', updatedAt: '2026-11-02T00:00:00.000Z' }] }),
      checkpoint({ id: 'cp4', subjectId: 'subj-social', notebookTypeId: 'nbtype-main2', title: 'Week 2', order: 1, dueDate: '2026-11-08', records: [{ studentId: 'student-1', submissionStatus: 'submitted', reviewStatus: 'incomplete', updatedAt: '2026-11-09T00:00:00.000Z' }] }),
    ],
  };
  const duplicated = duplicatedProjection(classroom, 'student-1');
  const real = realProjection(classroom, 'student-1');
  assert.deepEqual(duplicated, real);
  assert.deepEqual(duplicated.summary, emptySummary({ awaitingSubmission: 1, awaitingReview: 1, needsCorrection: 1, reviewed: 1 }));
  assert.equal(duplicated.items.awaitingSubmission[0].source, 'checkpoint');
  assert.equal(duplicated.items.awaitingSubmission[0].checkpointId, 'cp1');
});

test('checkpoint-only: a student with NO record at all for an existing checkpoint is classified awaitingSubmission, matching the real projection', () => {
  const classroom = {
    notebookConfig: notebookConfig([{ id: 's1', name: 'Science' }], [{ id: 't1', subjectId: 's1', name: 'Notebook' }]),
    checkpoints: [checkpoint({ id: 'cp1', subjectId: 's1', notebookTypeId: 't1', title: 'Week 1', records: [] })],
  };
  assert.deepEqual(duplicatedProjection(classroom, 'student-no-record'), realProjection(classroom, 'student-no-record'));
  assert.equal(duplicatedProjection(classroom, 'student-no-record').summary.awaitingSubmission, 1);
});

// --------------------------------------------------------------------
// Legacy-only classroom (pure WorkRequest, no checkpoints at all)
// --------------------------------------------------------------------

test('legacy-only: a classroom with only WorkRequest obligations (no notebookConfig field at all) classifies correctly across all 5 statuses -- and documents the one deliberate divergence from the real projection (see notebookStatusProjection.js\'s own header comment: the real service throws here, this duplicate does not)', () => {
  const classroom = {
    workRequests: [
      { id: 'wr1', type: 'notebook', title: 'Assigned Check', subjectId: 's1', notebookTypeId: 't1', dueDate: '2026-11-01', status: 'open', entries: [{ id: 'e1', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: '2026-10-20T00:00:00.000Z' }] },
      { id: 'wr2', type: 'notebook', title: 'Submitted Check', subjectId: 's2', notebookTypeId: 't2', dueDate: '2026-11-01', status: 'open', entries: [{ id: 'e2', studentId: 'student-1', status: 'submitted', reviewOutcome: null, updatedAt: '2026-10-21T00:00:00.000Z' }] },
      { id: 'wr3', type: 'notebook', title: 'Needs Correction Check', subjectId: 's3', notebookTypeId: 't3', dueDate: '2026-11-01', status: 'open', entries: [{ id: 'e3', studentId: 'student-1', status: 'needs_correction', reviewOutcome: null, updatedAt: '2026-10-22T00:00:00.000Z' }] },
      { id: 'wr4', type: 'notebook', title: 'Reviewed Check', subjectId: 's4', notebookTypeId: 't4', dueDate: '2026-10-01', status: 'closed', entries: [{ id: 'e4', studentId: 'student-1', status: 'reviewed', reviewOutcome: 'complete', updatedAt: '2026-09-30T00:00:00.000Z' }] },
      { id: 'wr5', type: 'notebook', title: 'Absent Check', subjectId: 's5', notebookTypeId: 't5', dueDate: '2026-10-01', status: 'closed', entries: [{ id: 'e5', studentId: 'student-1', status: 'absent', reviewOutcome: null, updatedAt: '2026-09-30T00:00:00.000Z' }] },
    ],
  };
  // No notebookConfig field at all -- the real projection throws (see header comment); the duplicate must not.
  assert.throws(() => realProjection(classroom, 'student-1'), TypeError);
  const duplicated = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(duplicated.summary, emptySummary({ awaitingSubmission: 1, awaitingReview: 1, needsCorrection: 1, reviewed: 1, absent: 1 }));
  assert.ok(duplicated.items.awaitingSubmission.every((i) => i.source === 'workRequest'));

  // Re-run WITH an (empty) notebookConfig present -- real parity holds once the real service's own precondition is met.
  const classroomWithConfig = { ...classroom, notebookConfig: { subjects: [], notebookTypes: [] } };
  assert.deepEqual(duplicatedProjection(classroomWithConfig, 'student-1'), realProjection(classroomWithConfig, 'student-1'));
});

test('legacy-only: subject/notebookType names are resolved and joined for the title, falling back to the obligation\'s own title when unresolvable, identically to the real projection', () => {
  const classroom = {
    notebookConfig: notebookConfig([{ id: 's1', name: 'Science' }], [{ id: 't1', subjectId: 's1', name: 'Notebook' }]),
    workRequests: [
      { id: 'wr1', type: 'notebook', title: 'Fallback Title', subjectId: 's1', notebookTypeId: 't1', dueDate: null, status: 'open', entries: [{ id: 'e1', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: null }] },
      { id: 'wr2', type: 'notebook', title: 'Deleted NotebookType Title', subjectId: 'deleted-subject', notebookTypeId: 'deleted-type', dueDate: null, status: 'open', entries: [{ id: 'e2', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: null }] },
    ],
  };
  const duplicated = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(duplicated, realProjection(classroom, 'student-1'));
  const titles = duplicated.items.awaitingSubmission.map((i) => i.title).sort();
  assert.deepEqual(titles, ['Deleted NotebookType Title', 'Science — Notebook'].sort());
});

// --------------------------------------------------------------------
// Mixed classroom: checkpoints + legacy obligations for DIFFERENT
// notebook identities — both must appear, neither drops the other.
// --------------------------------------------------------------------

test('mixed, no collision: a checkpoint-tracked notebook and a legacy-tracked notebook for DIFFERENT identities both appear, matching the real projection', () => {
  const classroom = {
    notebookConfig: notebookConfig([{ id: 'subj-science', name: 'Science' }], [{ id: 'nbtype-main', subjectId: 'subj-science', name: 'Notebook' }]),
    checkpoints: [checkpoint({ id: 'cp1', subjectId: 'subj-science', notebookTypeId: 'nbtype-main', title: 'Week 1', records: [{ studentId: 'student-1', submissionStatus: 'not_submitted' }] })],
    workRequests: [
      { id: 'wr1', type: 'notebook', title: 'Math Check', subjectId: 'subj-math', notebookTypeId: 'nbtype-math', dueDate: '2026-11-01', status: 'open', entries: [{ id: 'e1', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: '2026-10-20T00:00:00.000Z' }] },
    ],
  };
  const duplicated = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(duplicated, realProjection(classroom, 'student-1'));
  assert.deepEqual(duplicated.summary, emptySummary({ awaitingSubmission: 2 }));
  const sources = duplicated.items.awaitingSubmission.map((i) => i.source).sort();
  assert.deepEqual(sources, ['checkpoint', 'workRequest']);
});

// --------------------------------------------------------------------
// Identity collision: checkpoint MUST win, legacy obligation dropped,
// never double-counted. This is the single most important property
// of this module — see its own header comment.
// --------------------------------------------------------------------

test('COLLISION: same (subjectId, notebookTypeId) tracked by BOTH systems -- checkpoint wins, the legacy obligation is dropped entirely, no double-count, matching the real projection exactly', () => {
  const classroom = {
    notebookConfig: notebookConfig([{ id: 'subj-science', name: 'Science' }], [{ id: 'nbtype-main', subjectId: 'subj-science', name: 'Notebook' }]),
    checkpoints: [checkpoint({ id: 'cp1', subjectId: 'subj-science', notebookTypeId: 'nbtype-main', title: 'Week 1', records: [{ studentId: 'student-1', submissionStatus: 'submitted', reviewStatus: 'complete', updatedAt: '2026-11-05T00:00:00.000Z' }] })],
    // A stale/mid-migration legacy obligation for the EXACT SAME identity -- must be dropped, not merged.
    workRequests: [
      { id: 'wr-stale', type: 'notebook', title: 'Science Notebook Check', subjectId: 'subj-science', notebookTypeId: 'nbtype-main', dueDate: '2026-10-01', status: 'open', entries: [{ id: 'e1', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: '2026-09-01T00:00:00.000Z' }] },
    ],
  };
  const duplicated = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(duplicated, realProjection(classroom, 'student-1'));
  // Exactly ONE item total, in `reviewed` (the checkpoint's own status) -- never 2, never also in awaitingSubmission.
  const totalItems = Object.values(duplicated.items).reduce((sum, arr) => sum + arr.length, 0);
  assert.equal(totalItems, 1);
  assert.deepEqual(duplicated.summary, emptySummary({ reviewed: 1 }));
  assert.equal(duplicated.items.reviewed[0].source, 'checkpoint');
  assert.equal(duplicated.items.awaitingSubmission.length, 0, 'the stale legacy obligation for the same identity must be dropped, not left visible as a second, contradictory item');
});

test('COLLISION with a missing identity on either side never falsely matches (null key never equals null key)', () => {
  const classroom = {
    notebookConfig: { subjects: [], notebookTypes: [] },
    // A checkpoint with no notebookConfig entry resolving it is impossible to construct via the normal
    // getCheckpointsForStudentAcrossNotebooks() path (it iterates notebookConfig itself), so this instead
    // proves the symmetric case: a legacy obligation with a missing subjectId/notebookTypeId must never be
    // treated as colliding with anything, including another identity-less item.
    workRequests: [
      { id: 'wr-no-identity-1', type: 'notebook', title: 'No Identity 1', subjectId: null, notebookTypeId: null, dueDate: null, status: 'open', entries: [{ id: 'e1', studentId: 'student-1', status: 'assigned', reviewOutcome: null, updatedAt: null }] },
      { id: 'wr-no-identity-2', type: 'notebook', title: 'No Identity 2', subjectId: null, notebookTypeId: null, dueDate: null, status: 'open', entries: [{ id: 'e2', studentId: 'student-1', status: 'submitted', reviewOutcome: null, updatedAt: null }] },
    ],
  };
  const duplicated = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(duplicated, realProjection(classroom, 'student-1'));
  assert.equal(duplicated.items.awaitingSubmission.length, 1);
  assert.equal(duplicated.items.awaitingReview.length, 1);
});

// --------------------------------------------------------------------
// Zero-notebook classroom
// --------------------------------------------------------------------

test('zero-notebook classroom (no checkpoints, no workRequests, no notebookConfig at all) returns all-zero summary and empty items from the duplicate -- the real projection throws on this exact shape (documented divergence, see notebookStatusProjection.js\'s own header comment)', () => {
  const classroom = {};
  assert.throws(() => realProjection(classroom, 'student-1'), TypeError);
  const duplicated = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(duplicated.summary, emptySummary());
  assert.deepEqual(duplicated.items, { awaitingSubmission: [], awaitingReview: [], needsCorrection: [], reviewed: [], absent: [] });

  // Parity holds once the real service's own precondition (a notebookConfig object) is met.
  const classroomWithConfig = { notebookConfig: { subjects: [], notebookTypes: [] } };
  assert.deepEqual(duplicatedProjection(classroomWithConfig, 'student-1'), realProjection(classroomWithConfig, 'student-1'));
});

test('a classroom with notebookConfig subjects/types defined but zero checkpoints anywhere contributes nothing from the checkpoint side, matching the real projection', () => {
  const classroom = {
    notebookConfig: notebookConfig([{ id: 's1', name: 'Science' }], [{ id: 't1', subjectId: 's1', name: 'Notebook' }]),
    checkpoints: [],
  };
  const duplicated = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(duplicated, realProjection(classroom, 'student-1'));
  assert.deepEqual(duplicated.summary, emptySummary());
});

// --------------------------------------------------------------------
// Malformed legacy data — reuses the already-proven
// notebookObligationsProjection.js guard; this module must not
// reintroduce the crash by wrapping it differently.
// --------------------------------------------------------------------

test('MALFORMED: a legacy WorkRequest with missing `entries` is safely excluded (via the already-duplicated projection), not thrown, matching the real projection\'s own duplicate-aware behavior', () => {
  const classroom = {
    workRequests: [
      { id: 'wr-malformed', type: 'notebook', title: 'Legacy Check', subjectId: 's1', notebookTypeId: 't1', dueDate: null, status: 'open' },
    ],
  };
  // NOTE: the REAL notebookStatusService.js calls the REAL (non-duplicated)
  // workRequestService.getNotebookObligationsForStudent(), which throws on
  // this exact malformed input (see notebookObligationsProjection.test.js's
  // own "KNOWN, DOCUMENTED, STILL-OPEN LIMITATION" test) -- so true parity
  // here means the DUPLICATE is safe where the real one is not, which is
  // the single documented, deliberate exception already established for
  // notebookObligationsProjection.js. This is proven directly, not assumed.
  assert.doesNotThrow(() => duplicatedProjection(classroom, 'student-1'));
  assert.throws(() => realProjection(classroom, 'student-1'), TypeError);
  const result = duplicatedProjection(classroom, 'student-1');
  assert.deepEqual(result.summary, emptySummary());
});

test('a checkpoint-tracked notebook alongside a DIFFERENT, malformed legacy WorkRequest: the checkpoint item still resolves correctly and the malformed sibling is excluded, not a crash', () => {
  const classroom = {
    notebookConfig: notebookConfig([{ id: 'subj-science', name: 'Science' }], [{ id: 'nbtype-main', subjectId: 'subj-science', name: 'Notebook' }]),
    checkpoints: [checkpoint({ id: 'cp1', subjectId: 'subj-science', notebookTypeId: 'nbtype-main', title: 'Week 1', records: [{ studentId: 'student-1', submissionStatus: 'not_submitted' }] })],
    workRequests: [{ id: 'wr-malformed', type: 'notebook', title: 'Legacy Check', subjectId: 's-other', notebookTypeId: 't-other', dueDate: null, status: 'open' }],
  };
  const duplicated = duplicatedProjection(classroom, 'student-1');
  assert.doesNotThrow(() => duplicatedProjection(classroom, 'student-1'));
  assert.equal(duplicated.summary.awaitingSubmission, 1);
  assert.equal(duplicated.items.awaitingSubmission[0].source, 'checkpoint');
});
