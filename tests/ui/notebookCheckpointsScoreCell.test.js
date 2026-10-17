/**
 * tests/ui/notebookCheckpointsScoreCell.test.js
 *
 * Covers the Notebook Checkpoints Score column's own display logic
 * (js/ui/views/NotebookCheckpointsScoreCell.js) directly — no DOM
 * needed, since that module is pure. Imported alone, not through
 * ui/views/NotebookCheckpointsView.js itself, which transitively pulls
 * in Firestore/browser-only imports that don't resolve under plain
 * `node --test`.
 *
 * The remaining "score changes after a checkpoint completes/reverses"
 * guarantee is proven by composing this pure display function with
 * the real services/checkpointService.js scoring integration
 * (already exhaustively covered on its own in
 * tests/services/checkpointService.test.js) — i.e. this suite proves
 * the Score column would show the right thing GIVEN a real
 * student.score, not just a hand-picked one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudent } from '../../js/models/Student.js';
import { createCheckpoint } from '../../js/models/Checkpoint.js';
import { getScoreCellDisplay } from '../../js/ui/views/NotebookCheckpointsScoreCell.js';
import * as checkpointService from '../../js/services/checkpointService.js';

// 1. Displayed from student.score
test('1: displays the student\'s current student.score', () => {
  const student = createStudent({ id: 's1', name: 'Dhiyasri', score: 14 });
  const display = getScoreCellDisplay(student);
  assert.equal(display.number, '14');
  assert.equal(display.ariaLabel, 'Dhiyasri score: 14');
});

// 2. Zero
test('2: a score of 0 displays correctly', () => {
  const student = createStudent({ id: 's1', name: 'Zero', score: 0 });
  const display = getScoreCellDisplay(student);
  assert.equal(display.number, '0');
  assert.equal(display.ariaLabel, 'Zero score: 0');
});

// 3. Negative
test('3: a negative score displays correctly', () => {
  const student = createStudent({ id: 's1', name: 'Negative', score: -3 });
  const display = getScoreCellDisplay(student);
  assert.equal(display.number, '-3');
  assert.equal(display.ariaLabel, 'Negative score: -3');
});

// 4 & 5. Reflects real score changes from checkpoint completion/reversal
test('4/5: the display reflects student.score before, during, and after a real checkpoint completion + reversal', () => {
  const student = createStudent({ id: 's1', name: 'Dhiyasri', score: 14 });
  const checkpoint = createCheckpoint({ id: 'cp-1', subjectId: 'subj', notebookTypeId: 'nt', title: 'HIS U03' });

  assert.equal(getScoreCellDisplay(student).number, '14');

  checkpointService.setSubmission(checkpoint, student, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-02' });
  assert.equal(getScoreCellDisplay(student).number, '15');

  checkpointService.setReview(checkpoint, student, { status: 'incomplete', reviewedDate: '2026-09-03' });
  assert.equal(getScoreCellDisplay(student).number, '14');

  checkpointService.setReview(checkpoint, student, { status: 'complete', reviewedDate: '2026-09-04' });
  assert.equal(getScoreCellDisplay(student).number, '15');
});

// 6. Never derived from counting green checkpoints
test('6: the display never counts green checkpoints — it is blind to checkpoint.records entirely', () => {
  const student = createStudent({ id: 's1', name: 'Blind', score: 5 });
  // Three checkpoints, all Complete for this student (would be 3 if
  // this were counting green cells) — the display must still say 5,
  // proving it reads only student.score.
  ['cp-a', 'cp-b', 'cp-c'].forEach((id) => {
    const checkpoint = createCheckpoint({ id, subjectId: 'subj', notebookTypeId: 'nt', title: id, records: [
      { id: 'r', studentId: student.id, submissionStatus: 'submitted', submittedDate: '2026-09-01', reviewStatus: 'complete', reviewedDate: '2026-09-02', teacherNote: '' },
    ] });
    assert.ok(checkpoint); // constructed only to prove getScoreCellDisplay never looks at it
  });
  assert.equal(getScoreCellDisplay(student).number, '5');
});
