/**
 * tests/services/studentProgressService.notebookTimeline.test.js
 *
 * Real, executed unit tests for the Student Growth Dashboard's own
 * getNotebookSubmissionTimelineForStudent() — the flattened,
 * chronological, cross-notebook Checkpoint submission list. No DOM,
 * no Firebase; fixtures built directly against models/Classroom.js
 * and the real notebookConfigService/checkpointService functions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as notebookConfigService from '../../js/services/notebookConfigService.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import { getNotebookSubmissionTimelineForStudent } from '../../js/services/studentProgressService.js';

function buildClassroom() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'G1' });
  classroom.teams = [{ id: 't1', name: 'Team 1', students: [{ id: 's1', name: 'Asha' }] }];
  return classroom;
}

test('zero checkpoints anywhere in the classroom returns []', () => {
  const classroom = buildClassroom();
  assert.deepEqual(getNotebookSubmissionTimelineForStudent(classroom, 's1'), []);
});

test('MULTIPLE NOTEBOOKS FLATTENED AND SORTED: checkpoints from two different notebooks come back as one list, oldest due date first', () => {
  const classroom = buildClassroom();
  const science = notebookConfigService.addSubject(classroom, 'Science');
  const maths = notebookConfigService.addSubject(classroom, 'Maths');
  const scienceNotebook = notebookConfigService.addNotebookType(classroom, science.id, 'Classwork');
  const mathsNotebook = notebookConfigService.addNotebookType(classroom, maths.id, 'Classwork');

  const laterCheckpoint = checkpointService.createNewCheckpoint(classroom, {
    subjectId: science.id,
    notebookTypeId: scienceNotebook.id,
    title: 'Chapter 3',
    dueDate: '2026-09-15',
  });
  const earlierCheckpoint = checkpointService.createNewCheckpoint(classroom, {
    subjectId: maths.id,
    notebookTypeId: mathsNotebook.id,
    title: 'Chapter 1',
    dueDate: '2026-08-01',
  });

  const timeline = getNotebookSubmissionTimelineForStudent(classroom, 's1');

  assert.equal(timeline.length, 2);
  assert.deepEqual(
    timeline.map((item) => item.checkpointId),
    [earlierCheckpoint.id, laterCheckpoint.id],
    'oldest due date first, across different notebooks'
  );
  assert.equal(timeline[0].subjectName, 'Maths');
  assert.equal(timeline[1].subjectName, 'Science');
});

test('A CHECKPOINT WITH NO RECORD FOR THIS STUDENT reflects the sparse-record defaults, never a fabricated status', () => {
  const classroom = buildClassroom();
  const science = notebookConfigService.addSubject(classroom, 'Science');
  const notebookType = notebookConfigService.addNotebookType(classroom, science.id, 'Classwork');
  checkpointService.createNewCheckpoint(classroom, { subjectId: science.id, notebookTypeId: notebookType.id, title: 'Chapter 1', dueDate: '2026-09-01' });

  const [item] = getNotebookSubmissionTimelineForStudent(classroom, 's1');

  assert.equal(item.submissionStatus, 'not_submitted');
  assert.equal(item.reviewStatus, 'not_reviewed');
  assert.equal(item.submittedDate, null);
  assert.equal(item.late, false, 'reuses checkpointService.isLate()\'s own contract — no record means never late');
});

test('A CHECKPOINT WITH NO dueDate AT ALL is never flagged late, by checkpointService.isLate()\'s own contract, never a second calculation here', () => {
  const classroom = buildClassroom();
  const science = notebookConfigService.addSubject(classroom, 'Science');
  const notebookType = notebookConfigService.addNotebookType(classroom, science.id, 'Classwork');
  const checkpoint = checkpointService.createNewCheckpoint(classroom, { subjectId: science.id, notebookTypeId: notebookType.id, title: 'Chapter 1' });
  checkpointService.setSubmission(checkpoint, 's1', { status: 'submitted', submittedDate: '2026-12-01' });

  const [item] = getNotebookSubmissionTimelineForStudent(classroom, 's1');

  assert.equal(item.dueDate, null);
  assert.equal(item.late, false);
});

test('LATE AND ON-TIME ARE DISTINGUISHED CORRECTLY, reusing checkpointService.isLate()', () => {
  const classroom = buildClassroom();
  const science = notebookConfigService.addSubject(classroom, 'Science');
  const notebookType = notebookConfigService.addNotebookType(classroom, science.id, 'Classwork');

  const onTime = checkpointService.createNewCheckpoint(classroom, { subjectId: science.id, notebookTypeId: notebookType.id, title: 'On Time', dueDate: '2026-09-10' });
  checkpointService.setSubmission(onTime, 's1', { status: 'submitted', submittedDate: '2026-09-09' });

  const late = checkpointService.createNewCheckpoint(classroom, { subjectId: science.id, notebookTypeId: notebookType.id, title: 'Late', dueDate: '2026-09-01' });
  checkpointService.setSubmission(late, 's1', { status: 'submitted', submittedDate: '2026-09-05' });

  const timeline = getNotebookSubmissionTimelineForStudent(classroom, 's1');
  const onTimeItem = timeline.find((item) => item.checkpointId === onTime.id);
  const lateItem = timeline.find((item) => item.checkpointId === late.id);

  assert.equal(onTimeItem.late, false);
  assert.equal(lateItem.late, true);
});

test('AN EMPTY NOTEBOOK (no checkpoints yet) contributes nothing — matches checkpointService.getCheckpointsForStudentAcrossNotebooks()\'s own "empty notebook contributes nothing" contract', () => {
  const classroom = buildClassroom();
  notebookConfigService.addSubject(classroom, 'Science'); // configured, but never given any checkpoints
  assert.deepEqual(getNotebookSubmissionTimelineForStudent(classroom, 's1'), []);
});
