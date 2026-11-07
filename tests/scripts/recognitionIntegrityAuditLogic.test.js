/**
 * tests/scripts/recognitionIntegrityAuditLogic.test.js
 *
 * scripts/recognitionIntegrityAuditLogic.js — the COMBINED per-student
 * recognition-integrity report. Both underlying audits
 * (recognitionService.auditCompletionStarsForClassroom() and
 * notebookReadinessChampionAuditService.auditNotebookReadinessChampionBackfillEligibility())
 * already have their own exhaustive, dedicated test coverage — this
 * file only proves the COMBINING itself is correct: the right findings
 * land under the right student, the report-level structural-limitation
 * disclosure appears exactly once (never duplicated per entry on the
 * Readiness Champion side — the exact anti-pattern a prior hardening
 * round already found and fixed), and the reversal-classification /
 * ledger-consistency helpers behave correctly in isolation.
 *
 * Per the canonical architecture decision (2026-11-06): Readiness
 * Champion is awarded per fully completed, on-time subject NOTEBOOK,
 * never per individual checkpoint — so every readinessChampion-side
 * assertion below groups by (subjectId, notebookTypeId), never
 * checkpointId.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createStudent } from '../../js/models/Student.js';
import { createTeam } from '../../js/models/Team.js';
import { addMember } from '../../js/services/memberService.js';
import { MEMBER_ROLES } from '../../js/config/memberRoles.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import * as recognitionService from '../../js/services/recognitionService.js';
import {
  buildRecognitionIntegrityReport,
  classifyCompletionStarReversals,
  verifyPointsLedgerConsistency,
} from '../../scripts/recognitionIntegrityAuditLogic.js';

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

test('buildRecognitionIntegrityReport: a notebook-level Readiness Champion backfill candidate is reported under the correct student, keyed by subjectId/notebookTypeId, never a checkpointId', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'R. Varalaxmi' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const checkpoints = [addCheckpoint(classroom, { title: 'Unit 1' }), addCheckpoint(classroom, { title: 'Unit 2' })];
  checkpoints.forEach((cp) => checkpointService.setSubmission(cp, student.id, { status: 'submitted', submittedDate: '2026-09-08' }));

  const report = buildRecognitionIntegrityReport(classroom);
  const entry = report.students.find((s) => s.studentId === student.id);

  assert.equal(entry.readinessChampion.eligibleForBackfill.length, 1);
  assert.equal(entry.readinessChampion.eligibleForBackfill[0].subjectId, 'subj-1');
  assert.equal(entry.readinessChampion.eligibleForBackfill[0].notebookTypeId, 'type-1');
  assert.equal(entry.readinessChampion.eligibleForBackfill[0].checkpointId, undefined, 'notebook-level grouping -- never a per-checkpoint identity');
  assert.equal(entry.readinessChampion.incomplete.length, 0);
});

test('buildRecognitionIntegrityReport: the checkpoint-deletion structural limitation is disclosed exactly once, report-wide -- never duplicated on the eligibleForBackfill entry itself', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const checkpoint = addCheckpoint(classroom);
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-08' });

  const report = buildRecognitionIntegrityReport(classroom);
  const entry = report.students.find((s) => s.studentId === student.id);

  assert.ok(report.limitations.checkpointDeletionUndetectable, 'the report-level disclosure must exist exactly once');
  assert.equal(
    entry.readinessChampion.eligibleForBackfill[0].structuralLimitation,
    undefined,
    'must never re-attach the same caveat per entry -- that is the exact per-case-doubt anti-pattern a prior hardening round already fixed'
  );
});

test('buildRecognitionIntegrityReport: an incorrect, active Completion Star (concrete violation) is reported under completionStar.incorrectActiveStars for the right student', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Ann' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const checkpoint = addCheckpoint(classroom);
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-08' }); // never reviewed
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });
  recognitionService.awardAutomaticCompletionStar(student, ref); // bypasses the real wrapper on purpose, simulating a pre-correction award

  const report = buildRecognitionIntegrityReport(classroom);
  const entry = report.students.find((s) => s.studentId === student.id);

  assert.equal(entry.completionStar.incorrectActiveStars.length, 1);
  assert.equal(entry.completionStar.incorrectActiveStars[0].reason, 'review_not_complete');
  assert.equal(entry.completionStar.unverifiableActiveStars.length, 0);
});

test('buildRecognitionIntegrityReport: a Completion Star whose checkpoint was since deleted is reported under unverifiableActiveStars, carrying its own structuralLimitation (recognitionService\'s own per-entry field, distinct from the report-level Readiness Champion disclosure)', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Bhavesh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const checkpoint = addCheckpoint(classroom);
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });
  recognitionService.awardAutomaticCompletionStar(student, ref);
  classroom.checkpoints = []; // the checkpoint itself is gone -- deletion leaves no trace

  const report = buildRecognitionIntegrityReport(classroom);
  const entry = report.students.find((s) => s.studentId === student.id);

  assert.equal(entry.completionStar.incorrectActiveStars.length, 0, 'a missing checkpoint is never a concrete violation');
  assert.equal(entry.completionStar.unverifiableActiveStars.length, 1);
  assert.ok(entry.completionStar.unverifiableActiveStars[0].structuralLimitation);
});

test('classifyCompletionStarReversals: distinguishes manual (teacher_removed), automatic, and unrecognized reversal reasons', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp-1' });
  recognitionService.awardAutomaticCompletionStar(student, ref);
  recognitionService.reverseAutomaticCompletionStar(student, ref, { reason: 'late_submission_ineligible' });
  recognitionService.awardAutomaticCompletionStar(student, ref);
  recognitionService.reverseAutomaticCompletionStar(student, ref, { reason: 'teacher_removed', removedBy: TEACHER_UID });
  recognitionService.awardAutomaticCompletionStar(student, ref);
  recognitionService.reverseAutomaticCompletionStar(student, ref, { reason: 'some_future_reason_this_code_has_never_seen' });

  const classifications = classifyCompletionStarReversals(student).map((r) => r.classification);

  assert.deepEqual(classifications, ['automatic', 'manual', 'unrecognized_reason']);
});

test('verifyPointsLedgerConsistency: flags a student whose cached score has drifted from the sum of their own points history', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp-1' });
  recognitionService.awardAutomaticCompletionStar(student, ref);
  student.score = 99; // simulate drift

  const result = verifyPointsLedgerConsistency(student);

  assert.equal(result.consistent, false);
  assert.equal(result.expectedScore, 1);
  assert.equal(result.actualScore, 99);
});

test('verifyPointsLedgerConsistency: a healthy student is reported consistent', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp-1' });
  recognitionService.awardAutomaticCompletionStar(student, ref);

  const result = verifyPointsLedgerConsistency(student);

  assert.equal(result.consistent, true);
});

test('buildRecognitionIntegrityReport: multiple students are each scoped their own findings only, never cross-contaminated', () => {
  const classroom = buildClassroom();
  const studentA = createStudent({ id: 's1', name: 'Varalaxmi' });
  const studentB = createStudent({ id: 's2', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [studentA, studentB] })];
  const checkpointA = addCheckpoint(classroom, { title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1' });
  checkpointService.setSubmission(checkpointA, studentA.id, { status: 'submitted', submittedDate: '2026-09-08' });
  // studentB has no activity at all on this notebook.

  const report = buildRecognitionIntegrityReport(classroom);
  const entryA = report.students.find((s) => s.studentId === studentA.id);
  const entryB = report.students.find((s) => s.studentId === studentB.id);

  assert.equal(entryA.readinessChampion.eligibleForBackfill.length, 1);
  assert.equal(entryB.readinessChampion.eligibleForBackfill.length, 0);
  assert.equal(entryB.readinessChampion.incomplete.length, 1, 'studentB never submitted the one checkpoint required for this notebook, so it is pending -- never silently omitted');
});

test('buildRecognitionIntegrityReport: performs zero writes -- the classroom is byte-for-byte unchanged after generating the report', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Ann' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const checkpoint = addCheckpoint(classroom);
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-08' });
  const before = JSON.stringify(classroom);

  buildRecognitionIntegrityReport(classroom);

  assert.equal(JSON.stringify(classroom), before);
});
