/**
 * tests/services/notebookCategoryEditability.test.js
 *
 * Proves the actual fix for "Notebook categories cannot be safely
 * edited": renaming a Subject/Notebook Type must preserve every
 * existing checkpoint/daily-check record untouched (already true
 * before this change — these tests pin that down explicitly), and
 * deleting one must never silently orphan checkpoints or daily checks
 * (the actual bug — see services/checkpointService.js's own
 * countCheckpointImpactForNotebook()/deleteAllCheckpointsForNotebook()
 * and services/dailyCheckService.js's own
 * countDailyCheckImpactForNotebook()/deleteAllDailyChecksForNotebook(),
 * both new).
 *
 * Deliberately scoped to editability/safe-delete only — a separate,
 * unshipped "Checkpoint completion awards a scoreboard point" feature
 * was found entangled with this fix in the same working tree and has
 * been excluded from this release pending explicit product approval;
 * these tests assert only what this release actually ships.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudent } from '../../js/models/Student.js';
import * as notebookConfigService from '../../js/services/notebookConfigService.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import * as dailyCheckService from '../../js/services/dailyCheckService.js';

function buildClassroom(students = []) {
  return {
    notebookConfig: { subjects: [], notebookTypes: [] },
    checkpoints: [],
    dailyChecks: [],
    teams: [{ id: 'team-1', students }],
  };
}

test('renaming a Subject preserves every checkpoint and record tied to it unchanged', () => {
  const student = createStudent({ id: 's1', name: 'A' });
  const classroom = buildClassroom([student]);
  const subject = notebookConfigService.addSubject(classroom, 'English');
  const type = notebookConfigService.addNotebookType(classroom, subject.id, 'Classwork');
  const checkpoint = checkpointService.createNewCheckpoint(classroom, { subjectId: subject.id, notebookTypeId: type.id, title: 'Unit 1' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-02' });

  notebookConfigService.renameSubject(classroom, subject.id, 'English Language Arts');

  const stillThere = checkpointService.getCheckpointById(classroom, checkpoint.id);
  assert.equal(stillThere.title, 'Unit 1');
  assert.equal(checkpointService.getRecordForStudent(stillThere, student.id).submissionStatus, 'submitted');
  assert.equal(checkpointService.getRecordForStudent(stillThere, student.id).reviewStatus, 'complete');
  assert.equal(notebookConfigService.getSubjectById(classroom, subject.id).name, 'English Language Arts');
});

test('renaming a Notebook Type preserves every checkpoint and record tied to it unchanged', () => {
  const classroom = buildClassroom();
  const subject = notebookConfigService.addSubject(classroom, 'English');
  const type = notebookConfigService.addNotebookType(classroom, subject.id, 'Classwork');
  const checkpoint = checkpointService.createNewCheckpoint(classroom, { subjectId: subject.id, notebookTypeId: type.id, title: 'Unit 1' });

  notebookConfigService.renameNotebookType(classroom, type.id, 'Daily Classwork');

  assert.equal(checkpointService.getCheckpointById(classroom, checkpoint.id).title, 'Unit 1');
  assert.equal(notebookConfigService.getNotebookTypeById(classroom, type.id).name, 'Daily Classwork');
  assert.equal(checkpointService.listCheckpointsForNotebook(classroom, subject.id, type.id).length, 1);
});

test('THE BUG: before the fix, removing a Notebook Type with existing checkpoints left them silently orphaned — countCheckpointImpactForNotebook() now reports the real impact before deletion', () => {
  const student1 = createStudent({ id: 's1', name: 'A' });
  const student2 = createStudent({ id: 's2', name: 'B' });
  const classroom = buildClassroom([student1, student2]);
  const subject = notebookConfigService.addSubject(classroom, 'English');
  const type = notebookConfigService.addNotebookType(classroom, subject.id, 'Classwork');
  const cp1 = checkpointService.createNewCheckpoint(classroom, { subjectId: subject.id, notebookTypeId: type.id, title: 'Unit 1' });
  const cp2 = checkpointService.createNewCheckpoint(classroom, { subjectId: subject.id, notebookTypeId: type.id, title: 'Unit 2' });
  checkpointService.setSubmission(cp1, student1.id, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setSubmission(cp2, student1.id, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setSubmission(cp2, student2.id, { status: 'submitted', submittedDate: '2026-09-01' });

  const impact = checkpointService.countCheckpointImpactForNotebook(classroom, subject.id, type.id);
  assert.deepEqual(impact, { checkpointCount: 2, recordCount: 3 });
});

test('THE FIX: cascade-deleting a Notebook Type removes all its checkpoints, never leaving them reachable under a stale subjectId/notebookTypeId', () => {
  const student = createStudent({ id: 's1', name: 'A' });
  const classroom = buildClassroom([student]);
  const subject = notebookConfigService.addSubject(classroom, 'English');
  const type = notebookConfigService.addNotebookType(classroom, subject.id, 'Classwork');
  const checkpoint = checkpointService.createNewCheckpoint(classroom, { subjectId: subject.id, notebookTypeId: type.id, title: 'Unit 1' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-01' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-02' });

  // Mirrors SettingsView.js's own removeNotebookTypeSafely(): cascade
  // BEFORE removing the config entry.
  checkpointService.deleteAllCheckpointsForNotebook(classroom, subject.id, type.id);
  dailyCheckService.deleteAllDailyChecksForNotebook(classroom, subject.id, type.id);
  notebookConfigService.removeNotebookType(classroom, type.id);

  assert.equal(checkpointService.listCheckpointsForNotebook(classroom, subject.id, type.id).length, 0);
  assert.equal(notebookConfigService.getNotebookTypeById(classroom, type.id), null);
  assert.equal(checkpointService.getCheckpointById(classroom, checkpoint.id), null, 'the checkpoint itself must be gone, not orphaned under a config entry that no longer exists');
});

test('THE FIX: cascade-deleting a Subject removes checkpoints/daily-checks for EVERY Notebook Type it owns, and nothing belonging to a different Subject', () => {
  const student = createStudent({ id: 's1', name: 'A' });
  const classroom = buildClassroom([student]);
  const english = notebookConfigService.addSubject(classroom, 'English');
  const classwork = notebookConfigService.addNotebookType(classroom, english.id, 'Classwork');
  const homework = notebookConfigService.addNotebookType(classroom, english.id, 'Homework');
  checkpointService.createNewCheckpoint(classroom, { subjectId: english.id, notebookTypeId: classwork.id, title: 'CW Unit 1' });
  checkpointService.createNewCheckpoint(classroom, { subjectId: english.id, notebookTypeId: homework.id, title: 'HW Unit 1' });

  const math = notebookConfigService.addSubject(classroom, 'Math');
  const mathType = notebookConfigService.addNotebookType(classroom, math.id, 'Practice');
  const mathCheckpoint = checkpointService.createNewCheckpoint(classroom, { subjectId: math.id, notebookTypeId: mathType.id, title: 'Math Unit 1' });

  // Mirrors SettingsView.js's own Subject-delete cascade: every owned
  // Notebook Type is safely removed first, THEN the Subject itself.
  notebookConfigService.listNotebookTypes(classroom, english.id).forEach((type) => {
    checkpointService.deleteAllCheckpointsForNotebook(classroom, english.id, type.id);
    dailyCheckService.deleteAllDailyChecksForNotebook(classroom, english.id, type.id);
  });
  notebookConfigService.removeSubject(classroom, english.id);

  assert.equal(classroom.checkpoints.length, 1, 'only the surviving Math checkpoint remains');
  assert.equal(classroom.checkpoints[0].id, mathCheckpoint.id);
  assert.equal(notebookConfigService.listNotebookTypes(classroom, english.id).length, 0);
  assert.equal(notebookConfigService.getSubjectById(classroom, english.id), null);
  assert.ok(notebookConfigService.getSubjectById(classroom, math.id), 'an unrelated Subject must be completely untouched');
});

test('daily-check records are included in the delete-safety cascade for a Notebook Type with trackingMode "daily"', () => {
  const classroom = buildClassroom();
  const subject = notebookConfigService.addSubject(classroom, 'English');
  const type = notebookConfigService.addNotebookType(classroom, subject.id, 'Handwriting');
  notebookConfigService.setTrackingMode(classroom, type.id, 'daily');
  dailyCheckService.setDailyCheck(classroom, { subjectId: subject.id, notebookTypeId: type.id, studentId: 's1', date: '2026-09-01', status: 'checked' });
  dailyCheckService.setDailyCheck(classroom, { subjectId: subject.id, notebookTypeId: type.id, studentId: 's1', date: '2026-09-02', status: 'checked' });

  const impactBefore = dailyCheckService.countDailyCheckImpactForNotebook(classroom, subject.id, type.id);
  assert.equal(impactBefore, 2);

  dailyCheckService.deleteAllDailyChecksForNotebook(classroom, subject.id, type.id);
  assert.equal(dailyCheckService.listDailyChecksForNotebook(classroom, subject.id, type.id).length, 0);
});

test('a Notebook Type/Subject with no checkpoints or daily checks deletes cleanly with zero impact reported', () => {
  const classroom = buildClassroom();
  const subject = notebookConfigService.addSubject(classroom, 'English');
  const type = notebookConfigService.addNotebookType(classroom, subject.id, 'Classwork');

  const checkpointImpact = checkpointService.countCheckpointImpactForNotebook(classroom, subject.id, type.id);
  const dailyImpact = dailyCheckService.countDailyCheckImpactForNotebook(classroom, subject.id, type.id);
  assert.deepEqual(checkpointImpact, { checkpointCount: 0, recordCount: 0 });
  assert.equal(dailyImpact, 0);
});
