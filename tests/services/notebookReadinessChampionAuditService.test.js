/**
 * tests/services/notebookReadinessChampionAuditService.test.js
 *
 * Read-only, classroom-wide historical backfill audit for the
 * notebook-level Readiness Champion redesign — proves the audit
 * classifies strictly from concrete evidence (never guesses), shares
 * its ground truth with the live award path (computeNotebookCompleteness()),
 * discloses the checkpoint-deletion structural limitation exactly once
 * report-wide (DEC-0008's own policy, reused here), and never writes
 * anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createStudent } from '../../js/models/Student.js';
import { createTeam } from '../../js/models/Team.js';
import { addMember } from '../../js/services/memberService.js';
import { MEMBER_ROLES } from '../../js/config/memberRoles.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import * as notebookReadinessChampionService from '../../js/services/notebookReadinessChampionService.js';
import {
  auditNotebookReadinessChampionBackfillEligibility,
  buildNotebookReadinessBackfillReport,
} from '../../js/services/notebookReadinessChampionAuditService.js';

const OWNER_UID = 'owner-uid';
const TEACHER_UID = 'teacher-uid';

function buildClassroom() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  addMember(classroom, OWNER_UID, MEMBER_ROLES.OWNER, 'The Owner');
  addMember(classroom, TEACHER_UID, MEMBER_ROLES.TEACHER, 'A Teacher');
  return classroom;
}

function addCheckpoint(classroom, { title = 'Unit', dueDate = '2026-09-10', subjectId = 'subj-1', notebookTypeId = 'type-1' } = {}) {
  return checkpointService.createNewCheckpoint(classroom, { subjectId, notebookTypeId, title, givenDate: '2026-09-01', dueDate });
}

function submit(checkpoint, studentId, submittedDate) {
  checkpointService.setSubmission(checkpoint, studentId, { status: 'submitted', submittedDate });
}

test('auditNotebookReadinessChampionBackfillEligibility: a strong on-time record across every required checkpoint, no badge yet, is eligibleForBackfill', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'R. Varalaxmi' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const checkpoints = [addCheckpoint(classroom, { title: 'Unit 1' }), addCheckpoint(classroom, { title: 'Unit 2' }), addCheckpoint(classroom, { title: 'Unit 3' })];
  checkpoints.forEach((cp) => submit(cp, student.id, '2026-09-08'));

  const result = auditNotebookReadinessChampionBackfillEligibility(classroom);

  assert.equal(result.eligibleForBackfill.length, 1);
  assert.equal(result.eligibleForBackfill[0].studentId, student.id);
  assert.equal(result.eligibleForBackfill[0].subjectId, 'subj-1');
  assert.equal(result.eligibleForBackfill[0].structuralLimitation, undefined, 'the structural limitation is disclosed once, report-wide, via buildNotebookReadinessBackfillReport() -- never repeated on this flat-audit function\'s own individual entries');
  assert.equal(result.incomplete.length, 0);
  assert.equal(result.containsLateSubmissions.length, 0);
  assert.equal(result.cannotEstablishEligibility.length, 0);
  assert.equal(result.hasPriorAwardHistory.length, 0);
});

test('auditNotebookReadinessChampionBackfillEligibility: one pending required checkpoint -- reported as incomplete, never eligible', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  addCheckpoint(classroom, { title: 'Unit 2' }); // never touched
  submit(cp1, student.id, '2026-09-08');

  const result = auditNotebookReadinessChampionBackfillEligibility(classroom);

  assert.equal(result.eligibleForBackfill.length, 0);
  assert.equal(result.incomplete.length, 1);
  assert.equal(result.incomplete[0].completeness.pendingCount, 1);
});

test('auditNotebookReadinessChampionBackfillEligibility: a complete notebook with one late required checkpoint -- reported as containsLateSubmissions', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const onTime = addCheckpoint(classroom, { title: 'Unit 1' });
  const late = addCheckpoint(classroom, { title: 'Unit 2' });
  submit(onTime, student.id, '2026-09-08');
  submit(late, student.id, '2026-09-20');

  const result = auditNotebookReadinessChampionBackfillEligibility(classroom);

  assert.equal(result.eligibleForBackfill.length, 0);
  assert.equal(result.incomplete.length, 0);
  assert.equal(result.containsLateSubmissions.length, 1);
  assert.equal(result.containsLateSubmissions[0].completeness.lateCount, 1);
});

test('auditNotebookReadinessChampionBackfillEligibility: a complete notebook with one unresolvable date -- reported as cannotEstablishEligibility, never guessed as on-time or late', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const good = addCheckpoint(classroom, { title: 'Unit 1' });
  const malformed = addCheckpoint(classroom, { title: 'Unit 2', dueDate: '2026-13-40' });
  submit(good, student.id, '2026-09-08');
  submit(malformed, student.id, '2026-09-08');

  const result = auditNotebookReadinessChampionBackfillEligibility(classroom);

  assert.equal(result.eligibleForBackfill.length, 0);
  assert.equal(result.containsLateSubmissions.length, 0, 'never guessed as late -- the evidence is insufficient, not negative');
  assert.equal(result.cannotEstablishEligibility.length, 1);
});

test('auditNotebookReadinessChampionBackfillEligibility: an already-awarded notebook (active automatic award) is reported as hasPriorAwardHistory, never re-recommended', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-08');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, 'subj-1', 'type-1', student, TEACHER_UID);

  const result = auditNotebookReadinessChampionBackfillEligibility(classroom);

  assert.equal(result.eligibleForBackfill.length, 0, 'an already-awarded notebook is never re-recommended for backfill');
  assert.equal(result.hasPriorAwardHistory.length, 1);
  assert.deepEqual(result.hasPriorAwardHistory[0].activeSources, ['automatic']);
});

test('auditNotebookReadinessChampionBackfillEligibility: a notebook whose only award was later revoked by a teacher is reported as hasPriorAwardHistory, never silently re-recommended', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-08');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, 'subj-1', 'type-1', student, TEACHER_UID);
  notebookReadinessChampionService.revokeReadinessChampionForNotebook(classroom, 'subj-1', 'type-1', student, TEACHER_UID);

  const result = auditNotebookReadinessChampionBackfillEligibility(classroom);

  assert.equal(result.eligibleForBackfill.length, 0, 'a teacher\'s own past revocation must never be silently overridden by an automated backfill recommendation');
  assert.equal(result.hasPriorAwardHistory.length, 1);
  assert.deepEqual(result.hasPriorAwardHistory[0].activeSources, [], 'nothing is currently active, but the history still counts as prior history');
  assert.equal(result.hasPriorAwardHistory[0].priorHistory.length, 2, 'both the original award and its revocation are preserved and reported');
});

test('auditNotebookReadinessChampionBackfillEligibility: a notebook with zero checkpoints configured is not reported in any bucket', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Nobody' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  // No checkpoints created at all.

  const result = auditNotebookReadinessChampionBackfillEligibility(classroom);
  assert.equal(result.eligibleForBackfill.length, 0);
  assert.equal(result.incomplete.length, 0);
  assert.equal(result.containsLateSubmissions.length, 0);
  assert.equal(result.cannotEstablishEligibility.length, 0);
  assert.equal(result.hasPriorAwardHistory.length, 0);
});

test('auditNotebookReadinessChampionBackfillEligibility: MULTIPLE SUBJECT NOTEBOOKS for the same student produce independent, separate entries', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const mathCp = addCheckpoint(classroom, { subjectId: 'math', notebookTypeId: 'class-work' });
  const scienceCp = addCheckpoint(classroom, { subjectId: 'science', notebookTypeId: 'class-work' });
  submit(mathCp, student.id, '2026-09-08'); // on time
  submit(scienceCp, student.id, '2026-09-20'); // late

  const result = auditNotebookReadinessChampionBackfillEligibility(classroom);

  assert.equal(result.eligibleForBackfill.length, 1);
  assert.equal(result.eligibleForBackfill[0].subjectId, 'math');
  assert.equal(result.containsLateSubmissions.length, 1);
  assert.equal(result.containsLateSubmissions[0].subjectId, 'science');
});

test('auditNotebookReadinessChampionBackfillEligibility: LIVE/HISTORICAL CONSISTENCY -- every eligibleForBackfill candidate is exactly what the live award path would independently award right now', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Varalaxmi' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const checkpoints = [addCheckpoint(classroom, { title: 'Unit 1' }), addCheckpoint(classroom, { title: 'Unit 2' })];
  checkpoints.forEach((cp) => submit(cp, student.id, '2026-09-08'));

  const audit = auditNotebookReadinessChampionBackfillEligibility(classroom);
  assert.equal(audit.eligibleForBackfill.length, 1);

  // The audit never awards -- confirm the student genuinely has no badge
  // yet, then confirm the LIVE path, given the exact same data, reaches
  // the identical conclusion (awards it) -- both paths share
  // computeNotebookCompleteness(), so they can never disagree.
  assert.equal(student.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0);
  const liveResult = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, 'subj-1', 'type-1', student, TEACHER_UID);
  assert.equal(liveResult, 1, 'the live path independently reaches the same eligible conclusion the audit already found');
});

test('auditNotebookReadinessChampionBackfillEligibility: performs zero writes -- the classroom is byte-for-byte unchanged after the call', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Anjali' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-08');
  const before = JSON.stringify(classroom);

  auditNotebookReadinessChampionBackfillEligibility(classroom);

  assert.equal(JSON.stringify(classroom), before);
});

// ---------------------------------------------------------------------
// buildNotebookReadinessBackfillReport — the per-student report shape,
// with the report-wide structural-limitation disclosure.
// ---------------------------------------------------------------------

test('buildNotebookReadinessBackfillReport: discloses the checkpoint-deletion structural limitation exactly once, report-wide -- never per student, never downgrading an individual classification', () => {
  const classroom = buildClassroom();
  const studentA = createStudent({ id: 'a', name: 'Varalaxmi' });
  const studentB = createStudent({ id: 'b', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [studentA, studentB] })];
  const checkpoints = [addCheckpoint(classroom, { title: 'Unit 1' }), addCheckpoint(classroom, { title: 'Unit 2' })];
  checkpoints.forEach((cp) => submit(cp, studentA.id, '2026-09-08')); // eligible
  submit(checkpoints[0], studentB.id, '2026-09-08'); // incomplete (one pending)

  const report = buildNotebookReadinessBackfillReport(classroom);

  assert.ok(report.limitations, 'the report must disclose its structural limitations at the top level');
  assert.ok(report.limitations.checkpointDeletionUndetectable.toLowerCase().includes('checkpoint'));
  assert.equal(report.students.length, 2);

  const entryA = report.students.find((s) => s.studentId === 'a');
  const entryB = report.students.find((s) => s.studentId === 'b');
  assert.equal(entryA.eligibleForBackfill.length, 1, 'student A\'s own classification is still strictly evidence-based, not hedged by the report-wide caveat');
  assert.equal(entryB.incomplete.length, 1);
  assert.equal(entryB.eligibleForBackfill.length, 0, 'the caveat never upgrades an incomplete notebook into an eligible one, or vice versa');

  // "Exactly once, report-wide" means literally that -- confirm the field
  // does NOT reappear on the individual entry nested inside the full
  // report shape (post-review hardening, 2026-11-06: an earlier draft
  // attached this same text to every eligibleForBackfill entry too).
  assert.equal(
    'structuralLimitation' in entryA.eligibleForBackfill[0],
    false,
    'the structural limitation must not be duplicated onto any individual entry anywhere in the returned report'
  );
});

test('buildNotebookReadinessBackfillReport: a student with a mix of eligible, incomplete, late, and prior-history notebooks is split correctly across all five buckets', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Varalaxmi' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];

  const eligibleCp = addCheckpoint(classroom, { subjectId: 'eligible-subj', notebookTypeId: 'type-1' });
  submit(eligibleCp, student.id, '2026-09-08');

  const incompleteCp = addCheckpoint(classroom, { subjectId: 'incomplete-subj', notebookTypeId: 'type-1' });
  addCheckpoint(classroom, { subjectId: 'incomplete-subj', notebookTypeId: 'type-1', title: 'Unit 2' });
  submit(incompleteCp, student.id, '2026-09-08');

  const lateCp = addCheckpoint(classroom, { subjectId: 'late-subj', notebookTypeId: 'type-1' });
  submit(lateCp, student.id, '2026-09-20');

  const priorCp = addCheckpoint(classroom, { subjectId: 'prior-subj', notebookTypeId: 'type-1' });
  submit(priorCp, student.id, '2026-09-08');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, 'prior-subj', 'type-1', student, TEACHER_UID);

  const report = buildNotebookReadinessBackfillReport(classroom);
  const entry = report.students.find((s) => s.studentId === 's1');

  assert.equal(entry.eligibleForBackfill.length, 1);
  assert.equal(entry.eligibleForBackfill[0].subjectId, 'eligible-subj');
  assert.equal(entry.incomplete.length, 1);
  assert.equal(entry.incomplete[0].subjectId, 'incomplete-subj');
  assert.equal(entry.containsLateSubmissions.length, 1);
  assert.equal(entry.containsLateSubmissions[0].subjectId, 'late-subj');
  assert.equal(entry.hasPriorAwardHistory.length, 1);
  assert.equal(entry.hasPriorAwardHistory[0].subjectId, 'prior-subj');
  assert.equal(entry.cannotEstablishEligibility.length, 0);
});

test('buildNotebookReadinessBackfillReport: performs zero writes', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Anjali' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-08');
  const before = JSON.stringify(classroom);

  buildNotebookReadinessBackfillReport(classroom);

  assert.equal(JSON.stringify(classroom), before);
});
