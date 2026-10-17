import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudent } from '../../js/models/Student.js';
import { createCheckpoint } from '../../js/models/Checkpoint.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import * as timelineService from '../../js/services/timelineService.js';

function buildCheckpoint(overrides = {}) {
  return createCheckpoint({ id: 'cp-1', subjectId: 'subj-1', notebookTypeId: 'nt-1', title: 'Unit 1', ...overrides });
}

function buildClassroomWithCheckpoint(checkpoint, students) {
  return { id: 'classroom-1', checkpoints: [checkpoint], teams: [{ id: 'team-1', students }] };
}

// A. Not Submitted -> Submitted
test('A: Not Submitted -> Submitted leaves score unchanged', () => {
  const student = createStudent({ id: 's1', name: 'A' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  assert.equal(student.score, 0);
});

// B. Submitted -> Complete
test('B: Submitted -> Complete awards +1', () => {
  const student = createStudent({ id: 's1', name: 'B' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 1);
});

// C. Complete -> Complete
test('C: re-saving Complete while already Complete does not award again', () => {
  const student = createStudent({ id: 's1', name: 'C' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-03' }); // e.g. a corrected date, still Complete
  assert.equal(student.score, 1);
  assert.equal(student.history.filter((e) => e.source === 'notebook_checkpoint').length, 1);
});

// D. Complete -> Incomplete
test('D: Complete -> Incomplete reverses the point', () => {
  const student = createStudent({ id: 's1', name: 'D' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 1);
  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  assert.equal(student.score, 0);
});

// E. Incomplete -> Complete
test('E: Incomplete -> Complete awards the point', () => {
  const student = createStudent({ id: 's1', name: 'E' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 0);
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-03' });
  assert.equal(student.score, 1);
});

// F. Complete -> Not Submitted
test('F: Complete -> Not Submitted reverses the point and resets review', () => {
  const student = createStudent({ id: 's1', name: 'F' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 1);
  checkpointService.setSubmission(checkpoint, student, { status: 'not_submitted' });
  assert.equal(student.score, 0);
  assert.equal(checkpointService.getRecordForStudent(checkpoint, student.id).reviewStatus, 'not_reviewed');
});

// G. Complete -> Complete after a "reload" (fresh objects rehydrated from the same persisted JSON)
test('G: Complete -> Complete after a reload does not duplicate', () => {
  const student = createStudent({ id: 's1', name: 'G' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 1);

  const reloadedStudent = JSON.parse(JSON.stringify(student));
  const reloadedCheckpoint = JSON.parse(JSON.stringify(checkpoint));

  checkpointService.setReview(reloadedCheckpoint, reloadedStudent, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(reloadedStudent.score, 1);
  assert.equal(reloadedStudent.history.filter((e) => e.source === 'notebook_checkpoint').length, 1);
});

// H. Save Complete repeatedly
test('H: saving Complete repeatedly awards exactly once', () => {
  const student = createStudent({ id: 's1', name: 'H' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  for (let i = 0; i < 5; i += 1) {
    checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  }
  assert.equal(student.score, 1);
});

// I. Complete -> Incomplete -> Complete
test('I: Complete -> Incomplete -> Complete nets to exactly +1', () => {
  const student = createStudent({ id: 's1', name: 'I' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-04' });
  assert.equal(student.score, 1);
});

// J. Two different checkpoints, same student
test('J: two different checkpoints completed by the same student score +2', () => {
  const student = createStudent({ id: 's1', name: 'J' });
  const cp1 = buildCheckpoint({ id: 'cp-1', title: 'Unit 1' });
  const cp2 = buildCheckpoint({ id: 'cp-2', title: 'Unit 2' });
  checkpointService.setSubmission(cp1, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(cp1, student, { status: 'complete', reviewedDate: '2026-09-02' });
  checkpointService.setSubmission(cp2, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(cp2, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 2);
});

// K. Same checkpoint, two different students
test('K: the same checkpoint completed for two different students each awards +1', () => {
  const studentA = createStudent({ id: 'sA', name: 'A' });
  const studentB = createStudent({ id: 'sB', name: 'B' });
  const checkpoint = buildCheckpoint();
  [studentA, studentB].forEach((student) => {
    checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
    checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  });
  assert.equal(studentA.score, 1);
  assert.equal(studentB.score, 1);
});

// L. Undo checkpoint completion
test('L: undoing a checkpoint completion removes the associated history entry entirely', () => {
  const student = createStudent({ id: 's1', name: 'L' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  const entryId = checkpointService.getCheckpointCompletionEntryId(checkpoint.id, student.id);
  assert.ok(timelineService.findEntryById(student, entryId));

  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  assert.equal(timelineService.findEntryById(student, entryId), null);
});

// M. Redo/re-complete after undo
test('M: redoing (re-completing) after an undo returns the point exactly once', () => {
  const student = createStudent({ id: 's1', name: 'M' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-04' });
  assert.equal(student.score, 1);
  const entryId = checkpointService.getCheckpointCompletionEntryId(checkpoint.id, student.id);
  assert.equal(student.history.filter((e) => e.id === entryId).length, 1);
});

// N. Existing unrelated points untouched
test('N: unrelated existing points are untouched by checkpoint scoring', () => {
  const student = createStudent({ id: 's1', name: 'N' });
  timelineService.logPoints(student, 3, 'Star Awarded');
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 4);
  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  assert.equal(student.score, 3);
  assert.equal(student.history.filter((e) => e.label === 'Star Awarded').length, 1);
});

// O. Existing negative points untouched
test('O: existing negative points remain untouched', () => {
  const student = createStudent({ id: 's1', name: 'O' });
  timelineService.logPoints(student, -2, 'Negative Point');
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, -1);
  assert.equal(student.history.find((e) => e.label === 'Negative Point').delta, -2);
});

// P. Existing badges/history untouched
test('P: existing badges/history entries remain untouched', () => {
  const student = createStudent({ id: 's1', name: 'P' });
  student.badges.push('Great Effort');
  timelineService.logEntry(student, { kind: 'badge', label: 'Great Effort', delta: 0 });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  assert.deepEqual(student.badges, ['Great Effort']);
  assert.equal(student.history.filter((e) => e.kind === 'badge').length, 1);
});

// Q. Scoreboard (live, period-scoped) reflects award/reversal
test('Q: the live scoreboard function (getNetPointsInCurrentPeriod) reflects the award and its reversal', () => {
  const classroom = { currentScoringPeriodStartedAt: null };
  const student = createStudent({ id: 's1', name: 'Q' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(timelineService.getNetPointsInCurrentPeriod(classroom, student), 1);
  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  assert.equal(timelineService.getNetPointsInCurrentPeriod(classroom, student), 0);
});

// R. Current scoring period behaviour
test('R: an award recorded before a scoring-period reset is excluded from the new period but still counted all-time', () => {
  const student = createStudent({ id: 's1', name: 'R' });
  const checkpoint = buildCheckpoint();
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 1);

  const classroom = { currentScoringPeriodStartedAt: '2099-01-01T00:00:00.000Z' };
  assert.equal(timelineService.getNetPointsInCurrentPeriod(classroom, student), 0);
  assert.equal(timelineService.getNetPoints(student), 1);
  assert.equal(student.score, 1);
});

// Data-integrity: deleting a Complete checkpoint must not leave an orphaned point
test('deleting a Complete checkpoint reverses its outstanding point rather than leaving it orphaned', () => {
  const student = createStudent({ id: 's1', name: 'Del' });
  const checkpoint = buildCheckpoint({ id: 'cp-del' });
  const classroom = buildClassroomWithCheckpoint(checkpoint, [student]);
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 1);

  checkpointService.deleteCheckpoint(classroom, 'cp-del');
  assert.equal(student.score, 0);
  const entryId = checkpointService.getCheckpointCompletionEntryId('cp-del', student.id);
  assert.equal(timelineService.findEntryById(student, entryId), null);
});

test('deleting a checkpoint that is not Complete for anyone does not touch score', () => {
  const student = createStudent({ id: 's1', name: 'DelNotComplete' });
  const checkpoint = buildCheckpoint({ id: 'cp-del-2' });
  const classroom = buildClassroomWithCheckpoint(checkpoint, [student]);
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.deleteCheckpoint(classroom, 'cp-del-2');
  assert.equal(student.score, 0);
});

// Data-integrity: identity is by id, never by label
test('two checkpoints with an identical title do not collide (identity is by id, never by label)', () => {
  const student = createStudent({ id: 's1', name: 'Same Title' });
  const cp1 = buildCheckpoint({ id: 'cp-a', title: 'Unit 1' });
  const cp2 = buildCheckpoint({ id: 'cp-b', title: 'Unit 1' });
  checkpointService.setSubmission(cp1, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(cp1, student, { status: 'complete', reviewedDate: '2026-09-02' });
  checkpointService.setSubmission(cp2, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(cp2, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(student.score, 2);

  checkpointService.setReview(cp1, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  assert.equal(student.score, 1);
  const cp2EntryId = checkpointService.getCheckpointCompletionEntryId('cp-b', student.id);
  assert.ok(timelineService.findEntryById(student, cp2EntryId));
});

test('the checkpoint-completion history entry carries stable identifying metadata, not just a label', () => {
  const student = createStudent({ id: 's1', name: 'Meta' });
  const checkpoint = buildCheckpoint({ id: 'cp-meta', title: 'Unit 1' });
  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });

  const entryId = checkpointService.getCheckpointCompletionEntryId(checkpoint.id, student.id);
  const entry = timelineService.findEntryById(student, entryId);
  assert.equal(entry.kind, 'points');
  assert.equal(entry.delta, 1);
  assert.equal(entry.source, 'notebook_checkpoint');
  assert.equal(entry.sourceId, checkpoint.id);
  assert.equal(entry.studentId, student.id);
  assert.equal(entry.label, 'Checkpoint Complete: Unit 1');
  assert.ok(entry.recordedAt);
});
