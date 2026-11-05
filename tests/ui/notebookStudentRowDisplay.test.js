import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpoint } from '../../js/models/Checkpoint.js';
import { createStudentCheckpointRecord } from '../../js/models/StudentCheckpointRecord.js';
import { getScoreDisplay, getProgressSummary } from '../../js/ui/views/NotebookStudentRowDisplay.js';

test('getScoreDisplay: reads student.score directly, icon-then-number, with a "pts" suffix', () => {
  const display = getScoreDisplay({ name: 'Anjali', score: 24 });
  assert.equal(display.icon, '⭐');
  assert.equal(display.number, '24');
  assert.equal(display.suffix, 'pts');
  assert.match(display.ariaLabel, /Anjali/);
  assert.match(display.ariaLabel, /24/);
});

function checkpointWithRecord(record) {
  const checkpoint = createCheckpoint({ subjectId: 's1', notebookTypeId: 'nt1', title: 'Unit' });
  if (record) checkpoint.records.push(createStudentCheckpointRecord({ studentId: 'student-1', ...record }));
  return checkpoint;
}

test('getProgressSummary: completedCount only counts reviewStatus === "complete"; every other real state is pending', () => {
  const checkpoints = [
    checkpointWithRecord({ submissionStatus: 'submitted', reviewStatus: 'complete' }),
    checkpointWithRecord({ submissionStatus: 'submitted', reviewStatus: 'complete' }),
    checkpointWithRecord({ submissionStatus: 'submitted', reviewStatus: 'incomplete' }),
    checkpointWithRecord({ submissionStatus: 'submitted', reviewStatus: 'not_reviewed' }),
    checkpointWithRecord(null), // not_submitted at all — no record exists yet
  ];

  const summary = getProgressSummary(checkpoints, 'student-1');
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.totalCount, 5);
  assert.equal(summary.pendingCount, 3);
  assert.equal(summary.percentComplete, 40);
});

test('getProgressSummary: no checkpoints in this Notebook yet returns all zeros, never NaN or a division error', () => {
  assert.deepEqual(getProgressSummary([], 'student-1'), {
    completedCount: 0,
    totalCount: 0,
    pendingCount: 0,
    percentComplete: 0,
  });
});

test('getProgressSummary: every checkpoint complete means zero pending', () => {
  const checkpoints = [
    checkpointWithRecord({ submissionStatus: 'submitted', reviewStatus: 'complete' }),
    checkpointWithRecord({ submissionStatus: 'submitted', reviewStatus: 'complete' }),
  ];
  const summary = getProgressSummary(checkpoints, 'student-1');
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.percentComplete, 100);
});

test('getProgressSummary: only reads records belonging to the requested studentId, never another student\'s own record on the same checkpoint', () => {
  const checkpoint = createCheckpoint({ subjectId: 's1', notebookTypeId: 'nt1', title: 'Unit' });
  checkpoint.records.push(
    createStudentCheckpointRecord({ studentId: 'other-student', submissionStatus: 'submitted', reviewStatus: 'complete' })
  );
  const summary = getProgressSummary([checkpoint], 'student-1');
  assert.equal(summary.completedCount, 0);
  assert.equal(summary.pendingCount, 1);
});
