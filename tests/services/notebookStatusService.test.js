/**
 * tests/services/notebookStatusService.test.js
 *
 * Regression coverage for the "Raban M" production bug: a student's
 * checkpoint-tracked notebook correctly showed several checkpoints as
 * "Not Submitted" in the teacher's own Notebook Tracker
 * (ui/views/NotebookCheckpointsView.js), while every other read of
 * that same student's notebook status (ui/views/StudentProfileView.js's
 * Notebooks tab, the student portal's own alerts) reported zero
 * outstanding work — because those reads only ever looked at
 * services/workRequestService.js, a completely separate array with no
 * entries for a notebook that has never had a WorkRequest opened for
 * it. These tests exercise services/notebookStatusService.js's own
 * merge of both systems directly, with plain in-memory fixtures (pure
 * logic over classroom.checkpoints/classroom.workRequests — no
 * Firestore/emulator needed, same convention as
 * tests/services/guidanceEngine.test.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNotebookStatusForStudent } from '../../js/services/notebookStatusService.js';
import { createNotebookSubject } from '../../js/models/NotebookSubject.js';
import { createNotebookType } from '../../js/models/NotebookType.js';
import { createCheckpoint } from '../../js/models/Checkpoint.js';
import { createStudentCheckpointRecord } from '../../js/models/StudentCheckpointRecord.js';
import { createWorkRequest } from '../../js/models/WorkRequest.js';
import { createWorkRequestEntry } from '../../js/models/WorkRequestEntry.js';

const STUDENT_ID = 'student-raban-m';

function baseClassroom() {
  const subject = createNotebookSubject({ id: 'subj-science', name: 'Science' });
  const notebookType = createNotebookType({ id: 'type-classwork', subjectId: subject.id, name: 'Classwork' });
  return {
    notebookConfig: { subjects: [subject], notebookTypes: [notebookType] },
    checkpoints: [],
    workRequests: [],
  };
}

test('THE RABAN M BUG: a checkpoint with no record at all is counted as Awaiting Submission, even with zero WorkRequests in the classroom', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({ id: 'cp-1', subjectId: 'subj-science', notebookTypeId: 'type-classwork', title: 'Unit 1', order: 0 })
  );
  // No StudentCheckpointRecord for STUDENT_ID at all -- sparse-record
  // "never happened" state -- and classroom.workRequests is empty, the
  // exact condition that made the old workRequestService-only reads
  // report zero.
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);

  assert.equal(result.summary.awaitingSubmission, 1, 'the old bug: this used to be 0 because nothing exists in workRequests');
  assert.equal(result.items.awaitingSubmission.length, 1);
  assert.match(result.items.awaitingSubmission[0].title, /Science.*Classwork.*Unit 1/);
  assert.equal(result.items.awaitingSubmission[0].actionable, true, 'a checkpoint never closes, so it is always actionable');
});

test('several not-submitted checkpoints all count, matching what the teacher Notebook Tracker would show', () => {
  const classroom = baseClassroom();
  ['Unit 1', 'Unit 2', 'Unit 3'].forEach((title, i) => {
    classroom.checkpoints.push(
      createCheckpoint({ id: `cp-${i}`, subjectId: 'subj-science', notebookTypeId: 'type-classwork', title, order: i })
    );
  });
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.awaitingSubmission, 3);
});

test('a submitted-but-not-reviewed checkpoint is Awaiting Review', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({
      id: 'cp-1',
      subjectId: 'subj-science',
      notebookTypeId: 'type-classwork',
      title: 'Unit 1',
      order: 0,
      records: [createStudentCheckpointRecord({ studentId: STUDENT_ID, submissionStatus: 'submitted', submittedDate: '2026-10-01' })],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.awaitingReview, 1);
  assert.equal(result.summary.awaitingSubmission, 0);
});

test('a reviewStatus of "incomplete" is Needs Correction', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({
      id: 'cp-1',
      subjectId: 'subj-science',
      notebookTypeId: 'type-classwork',
      title: 'Unit 1',
      order: 0,
      records: [
        createStudentCheckpointRecord({
          studentId: STUDENT_ID,
          submissionStatus: 'submitted',
          submittedDate: '2026-10-01',
          reviewStatus: 'incomplete',
          reviewedDate: '2026-10-02',
        }),
      ],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.needsCorrection, 1);
});

test('a reviewStatus of "complete" is Reviewed', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({
      id: 'cp-1',
      subjectId: 'subj-science',
      notebookTypeId: 'type-classwork',
      title: 'Unit 1',
      order: 0,
      records: [
        createStudentCheckpointRecord({
          studentId: STUDENT_ID,
          submissionStatus: 'submitted',
          submittedDate: '2026-10-01',
          reviewStatus: 'complete',
          reviewedDate: '2026-10-02',
        }),
      ],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.reviewed, 1);
});

test('WorkRequest obligations are merged in alongside checkpoints, each mapped to the same four statuses', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({ id: 'cp-1', subjectId: 'subj-science', notebookTypeId: 'type-classwork', title: 'Unit 1', order: 0 })
  );
  classroom.workRequests.push(
    createWorkRequest({
      id: 'wr-1',
      title: 'English Homework',
      subjectId: 'subj-english',
      notebookTypeId: 'type-handwriting',
      status: 'open',
      entries: [createWorkRequestEntry({ studentId: STUDENT_ID, status: 'needs_correction' })],
    })
  );

  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.awaitingSubmission, 1, 'the checkpoint contribution');
  assert.equal(result.summary.needsCorrection, 1, 'the WorkRequest contribution');
  assert.equal(result.items.needsCorrection[0].source, 'workRequest');
});

test('"absent" is tracked separately and never folded into one of the four canonical counts', () => {
  const classroom = baseClassroom();
  classroom.workRequests.push(
    createWorkRequest({
      id: 'wr-1',
      title: 'English Homework',
      subjectId: 'subj-english',
      notebookTypeId: 'type-handwriting',
      status: 'open',
      entries: [createWorkRequestEntry({ studentId: STUDENT_ID, status: 'absent' })],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.absent, 1);
  assert.equal(result.summary.awaitingSubmission, 0);
  assert.equal(result.summary.awaitingReview, 0);
  assert.equal(result.summary.needsCorrection, 0);
  assert.equal(result.summary.reviewed, 0);
});

test('a WorkRequest that closed while the student was still "assigned" is counted but marked not actionable (closed window)', () => {
  const classroom = baseClassroom();
  classroom.workRequests.push(
    createWorkRequest({
      id: 'wr-1',
      title: 'English Homework',
      subjectId: 'subj-english',
      notebookTypeId: 'type-handwriting',
      status: 'closed',
      entries: [createWorkRequestEntry({ studentId: STUDENT_ID, status: 'assigned' })],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.awaitingSubmission, 1, 'still counted -- the student genuinely never submitted it');
  assert.equal(result.items.awaitingSubmission[0].actionable, false, 'but the window is closed, so this should not re-prompt the student');
});

test('a student with zero checkpoints and zero WorkRequests gets an all-zero summary, not an error', () => {
  const classroom = baseClassroom();
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.deepEqual(result.summary, { awaitingSubmission: 0, awaitingReview: 0, needsCorrection: 0, reviewed: 0, absent: 0 });
});

test('DOUBLE-COUNT FIX: the same notebook (same subjectId + notebookTypeId) tracked by BOTH checkpoints and an open WorkRequest is counted exactly once, with the checkpoint status authoritative', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({ id: 'cp-1', subjectId: 'subj-science', notebookTypeId: 'type-classwork', title: 'Unit 1', order: 0 })
    // No record for STUDENT_ID -> classifies as 'awaitingSubmission'.
  );
  classroom.workRequests.push(
    createWorkRequest({
      id: 'wr-1',
      title: 'Classwork Check',
      subjectId: 'subj-science', // SAME identity as the checkpoint above
      notebookTypeId: 'type-classwork',
      status: 'open',
      // Deliberately a DIFFERENT status than the checkpoint would
      // produce, so this test can tell whether the WorkRequest is
      // being dropped (checkpoint's own 'awaitingSubmission' is the
      // only contribution) rather than merely not double-counted
      // within the same bucket by coincidence.
      entries: [createWorkRequestEntry({ studentId: STUDENT_ID, status: 'needs_correction' })],
    })
  );

  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);

  assert.equal(result.summary.awaitingSubmission, 1, 'exactly one notebook, not two');
  assert.equal(result.summary.needsCorrection, 0, 'the WorkRequest side must be dropped entirely, not counted under its own status');
  assert.equal(result.items.awaitingSubmission.length, 1);
  assert.equal(result.items.awaitingSubmission[0].source, 'checkpoint', 'checkpoint tracking is authoritative for this notebook identity');
});

test('DOUBLE-COUNT FIX: a different notebook TYPE within the SAME subject is never deduplicated against it', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({ id: 'cp-1', subjectId: 'subj-science', notebookTypeId: 'type-classwork', title: 'Unit 1', order: 0 })
  );
  classroom.workRequests.push(
    createWorkRequest({
      id: 'wr-1',
      title: 'Science Homework',
      subjectId: 'subj-science', // same subject...
      notebookTypeId: 'type-homework', // ...but a genuinely different notebook type
      status: 'open',
      entries: [createWorkRequestEntry({ studentId: STUDENT_ID, status: 'assigned' })],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.awaitingSubmission, 2, 'two genuinely distinct notebooks, both counted');
  assert.deepEqual(
    result.items.awaitingSubmission.map((item) => item.source).sort(),
    ['checkpoint', 'workRequest']
  );
});

test('DOUBLE-COUNT FIX: the same notebook TYPE id across DIFFERENT subjects is never deduplicated against it', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({ id: 'cp-1', subjectId: 'subj-science', notebookTypeId: 'type-classwork', title: 'Unit 1', order: 0 })
  );
  classroom.workRequests.push(
    createWorkRequest({
      id: 'wr-1',
      title: 'Maths Classwork',
      subjectId: 'subj-maths', // a different subject...
      notebookTypeId: 'type-classwork', // ...sharing the same notebookTypeId coincidentally
      status: 'open',
      entries: [createWorkRequestEntry({ studentId: STUDENT_ID, status: 'assigned' })],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.awaitingSubmission, 2, 'two genuinely distinct notebooks (different subjects), both counted');
});

test('DOUBLE-COUNT FIX: a WorkRequest with a missing/legacy subjectId or notebookTypeId is never falsely deduplicated against a checkpoint, or against another missing-identity item', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({ id: 'cp-1', subjectId: 'subj-science', notebookTypeId: 'type-classwork', title: 'Unit 1', order: 0 })
  );
  classroom.workRequests.push(
    createWorkRequest({
      id: 'wr-1',
      title: 'Legacy request with no subject on file',
      subjectId: null,
      notebookTypeId: null,
      status: 'open',
      entries: [createWorkRequestEntry({ studentId: STUDENT_ID, status: 'assigned' })],
    }),
    createWorkRequest({
      id: 'wr-2',
      title: 'Another legacy request with no subject on file',
      subjectId: null,
      notebookTypeId: null,
      status: 'open',
      entries: [createWorkRequestEntry({ studentId: STUDENT_ID, status: 'assigned' })],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(
    result.summary.awaitingSubmission,
    3,
    'the checkpoint, plus BOTH legacy no-identity WorkRequests — two items both lacking an identity must never be treated as matching each other'
  );
});

test('DOUBLE-COUNT FIX: a checkpoint-tracked notebook never suppresses a DIFFERENT student’s WorkRequest for the same identity', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({ id: 'cp-1', subjectId: 'subj-science', notebookTypeId: 'type-classwork', title: 'Unit 1', order: 0 })
  );
  classroom.workRequests.push(
    createWorkRequest({
      id: 'wr-1',
      title: 'Classwork Check',
      subjectId: 'subj-science',
      notebookTypeId: 'type-classwork',
      status: 'open',
      entries: [createWorkRequestEntry({ studentId: 'some-other-student', status: 'needs_correction' })],
    })
  );
  // STUDENT_ID has no WorkRequest entry at all here -- only the checkpoint contributes for them.
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.awaitingSubmission, 1);
  assert.equal(result.summary.needsCorrection, 0, 'the other student’s own WorkRequest entry must never appear in STUDENT_ID’s own counts');
});

test('a different student’s records never leak into this student’s counts', () => {
  const classroom = baseClassroom();
  classroom.checkpoints.push(
    createCheckpoint({
      id: 'cp-1',
      subjectId: 'subj-science',
      notebookTypeId: 'type-classwork',
      title: 'Unit 1',
      order: 0,
      records: [
        createStudentCheckpointRecord({ studentId: 'some-other-student', submissionStatus: 'submitted', reviewStatus: 'complete' }),
      ],
    })
  );
  const result = getNotebookStatusForStudent(classroom, STUDENT_ID);
  assert.equal(result.summary.awaitingSubmission, 1, 'STUDENT_ID has no record of their own on this checkpoint -- still not_submitted for them');
  assert.equal(result.summary.reviewed, 0, 'the other student’s own "complete" review must not count toward STUDENT_ID');
});
