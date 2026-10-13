/**
 * tests/services/assignmentCheckpointService.test.js
 *
 * Mirrors tests/services/checkpointService.js's own CRUD/state-machine
 * test matrix (NOT its scoring-side-effect tests — this app's current,
 * committed checkpointService.js has no scoreboard integration, and
 * assignmentCheckpointService.js deliberately has none either, per
 * assignmentService.js's own explicit "no scoreboard-point integration"
 * statement; see this file's own header comment on why checkpoint
 * completion must never be conflated with scoring, concept mastery, or
 * exam marks).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as assignmentCheckpointService from '../../js/services/assignmentCheckpointService.js';

function buildClassroom() {
  return createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
}

test('createNewCheckpoint: assigns incrementing order within one Assignment, independent of other Assignments', () => {
  const classroom = buildClassroom();
  const a = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'Draft', givenDate: '2026-09-01' });
  const b = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'Final', givenDate: '2026-09-05' });
  const c = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-2', title: 'Unrelated', givenDate: '2026-09-01' });

  assert.equal(a.order, 0);
  assert.equal(b.order, 1);
  assert.equal(c.order, 0); // separate Assignment, separate ordering sequence
  assert.deepEqual(
    assignmentCheckpointService.listCheckpointsForAssignment(classroom, 'assign-1').map((cp) => cp.id),
    [a.id, b.id]
  );
});

test('updateCheckpoint: only touches metadata fields, never id/order/records', () => {
  const classroom = buildClassroom();
  const cp = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'Draft', givenDate: '2026-09-01' });
  assignmentCheckpointService.setSubmission(cp, 's1', { status: 'submitted', submittedDate: '2026-09-02' });

  assignmentCheckpointService.updateCheckpoint(cp, { title: 'Draft v2', dueDate: '2026-09-10' });

  assert.equal(cp.title, 'Draft v2');
  assert.equal(cp.dueDate, '2026-09-10');
  assert.equal(cp.order, 0);
  assert.equal(cp.records.length, 1);
});

test('deleteCheckpoint: removes exactly the targeted checkpoint, leaves siblings untouched', () => {
  const classroom = buildClassroom();
  const a = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  const b = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'B', givenDate: '2026-09-01' });

  assignmentCheckpointService.deleteCheckpoint(classroom, a.id);

  const remaining = assignmentCheckpointService.listCheckpointsForAssignment(classroom, 'assign-1');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, b.id);
});

test('reorderCheckpoints: reassigns order to match the given sequence; an omitted id keeps its own existing order (mirrors checkpointService.js exactly, including its own accepted tie behavior when an omission collides)', () => {
  const classroom = buildClassroom();
  const a = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  const b = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'B', givenDate: '2026-09-01' });
  const c = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'C', givenDate: '2026-09-01' });

  assignmentCheckpointService.reorderCheckpoints(classroom, 'assign-1', [c.id, a.id]);

  assert.equal(c.order, 0);
  assert.equal(a.order, 1);
  assert.equal(b.order, 1); // omitted -> keeps its own original order (1), same as checkpointService.js's own reorderCheckpoints()
});

test('setSubmission/setReview state machine: not_submitted+not_reviewed is the only valid default state', () => {
  const classroom = buildClassroom();
  const cp = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  assert.equal(assignmentCheckpointService.getRecordForStudent(cp, 's1'), null);
});

test('setReview throws when attempting to review a student who has not submitted', () => {
  const classroom = buildClassroom();
  const cp = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  assert.throws(() => assignmentCheckpointService.setReview(cp, 's1', { status: 'complete', reviewedDate: '2026-09-02' }));
});

test('setSubmission walking back to not_submitted resets reviewStatus/reviewedDate — the one disallowed state can never be reached', () => {
  const classroom = buildClassroom();
  const cp = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  assignmentCheckpointService.setSubmission(cp, 's1', { status: 'submitted', submittedDate: '2026-09-02' });
  assignmentCheckpointService.setReview(cp, 's1', { status: 'complete', reviewedDate: '2026-09-03' });

  assignmentCheckpointService.setSubmission(cp, 's1', { status: 'not_submitted' });

  const record = assignmentCheckpointService.getRecordForStudent(cp, 's1');
  assert.equal(record.reviewStatus, 'not_reviewed');
  assert.equal(record.reviewedDate, null);
  assert.equal(record.submittedDate, null);
});

test('isLate: true only when submitted after a real dueDate; never late with no dueDate at all', () => {
  const classroom = buildClassroom();
  const withDueDate = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01', dueDate: '2026-09-05' });
  assignmentCheckpointService.setSubmission(withDueDate, 's1', { status: 'submitted', submittedDate: '2026-09-10' });
  assert.equal(assignmentCheckpointService.isLate(withDueDate, assignmentCheckpointService.getRecordForStudent(withDueDate, 's1')), true);

  const noDueDate = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'B', givenDate: '2026-09-01' });
  assignmentCheckpointService.setSubmission(noDueDate, 's1', { status: 'submitted', submittedDate: '2026-09-10' });
  assert.equal(assignmentCheckpointService.isLate(noDueDate, assignmentCheckpointService.getRecordForStudent(noDueDate, 's1')), false);
});

test('getCheckpointSummary: counts submitted/complete/incomplete/late correctly, and derives notSubmittedCount from a given roster', () => {
  const classroom = buildClassroom();
  const cp = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  assignmentCheckpointService.setSubmission(cp, 's1', { status: 'submitted', submittedDate: '2026-09-02' });
  assignmentCheckpointService.setReview(cp, 's1', { status: 'complete', reviewedDate: '2026-09-03' });
  assignmentCheckpointService.setSubmission(cp, 's2', { status: 'submitted', submittedDate: '2026-09-02' });

  const summary = assignmentCheckpointService.getCheckpointSummary(cp, [{ id: 's1' }, { id: 's2' }, { id: 's3' }]);
  assert.equal(summary.submittedCount, 2);
  assert.equal(summary.completeCount, 1);
  assert.equal(summary.notSubmittedCount, 1);
  assert.equal(summary.needsReviewCount, 1); // s2: submitted, not yet reviewed
});

test('countCheckpointImpactForAssignment: reports exact checkpoint and record counts, pure read', () => {
  const classroom = buildClassroom();
  const cp1 = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  const cp2 = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'B', givenDate: '2026-09-01' });
  assignmentCheckpointService.setSubmission(cp1, 's1', { status: 'submitted', submittedDate: '2026-09-02' });
  assignmentCheckpointService.setSubmission(cp2, 's1', { status: 'submitted', submittedDate: '2026-09-02' });
  assignmentCheckpointService.setSubmission(cp2, 's2', { status: 'submitted', submittedDate: '2026-09-02' });

  const impact = assignmentCheckpointService.countCheckpointImpactForAssignment(classroom, 'assign-1');
  assert.equal(impact.checkpointCount, 2);
  assert.equal(impact.recordCount, 3);
});

test('deleteAllCheckpointsForAssignment: cascade-deletes every checkpoint for one Assignment, leaves other Assignments untouched', () => {
  const classroom = buildClassroom();
  assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'B', givenDate: '2026-09-01' });
  assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-2', title: 'C', givenDate: '2026-09-01' });

  assignmentCheckpointService.deleteAllCheckpointsForAssignment(classroom, 'assign-1');

  assert.equal(assignmentCheckpointService.listCheckpointsForAssignment(classroom, 'assign-1').length, 0);
  assert.equal(assignmentCheckpointService.listCheckpointsForAssignment(classroom, 'assign-2').length, 1);
});

test('getStudentCheckpointProgress: returns null fields (never a fabricated 0/0) when the Assignment has no checkpoints yet', () => {
  const classroom = buildClassroom();
  const progress = assignmentCheckpointService.getStudentCheckpointProgress(classroom, 'assign-1', 's1');
  assert.deepEqual(progress, { totalCount: 0, submittedCount: null, completeCount: null });
});

test('getStudentCheckpointProgress: counts submitted/complete across every checkpoint on one Assignment for one student', () => {
  const classroom = buildClassroom();
  const cp1 = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'A', givenDate: '2026-09-01' });
  const cp2 = assignmentCheckpointService.createNewCheckpoint(classroom, { assignmentId: 'assign-1', title: 'B', givenDate: '2026-09-01' });
  assignmentCheckpointService.setSubmission(cp1, 's1', { status: 'submitted', submittedDate: '2026-09-02' });
  assignmentCheckpointService.setReview(cp1, 's1', { status: 'complete', reviewedDate: '2026-09-03' });
  // cp2 left entirely untouched for s1 -> not_submitted by default

  const progress = assignmentCheckpointService.getStudentCheckpointProgress(classroom, 'assign-1', 's1');
  assert.deepEqual(progress, { totalCount: 2, submittedCount: 1, completeCount: 1 });
});
