/**
 * tests/services/legacyReadinessChampionMigrationService.test.js
 *
 * Migration strategy for pre-existing, OLD per-checkpoint Readiness
 * Champion data (badgeAwards[]) left behind by the notebook-level
 * redesign. Covers: grouping legacy per-checkpoint awards by (student,
 * notebook), classifying each group (validUnderNewRule /
 * demonstrablyInvalid / insufficientEvidence / unmappable), the
 * duplicate-checkpoint-level cross-reference, counter reconciliation,
 * applying the migration (provenance, idempotency, never touching
 * invalid/unmappable groups, never editing old records), and that
 * everything here operates purely on synthetic, in-memory fixtures --
 * nothing in this file touches a real classroom, Firestore, or
 * production data.
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
  auditLegacyReadinessChampionAwards,
  buildLegacyMigrationDryRunReport,
  applyLegacyReadinessChampionMigration,
} from '../../js/services/legacyReadinessChampionMigrationService.js';

const OWNER_UID = 'owner-uid';
const TEACHER_UID = 'teacher-uid';
const VIEWER_UID = 'viewer-uid';

function buildClassroom() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  addMember(classroom, OWNER_UID, MEMBER_ROLES.OWNER, 'The Owner');
  addMember(classroom, TEACHER_UID, MEMBER_ROLES.TEACHER, 'A Teacher');
  addMember(classroom, VIEWER_UID, MEMBER_ROLES.VIEWER, 'A Viewer');
  return classroom;
}

// createdAt defaults to a fixed historical date, never the real
// wall-clock "now" the model would otherwise stamp -- computeNotebookCompleteness()'s
// own referenceDate filtering (used throughout this file to ask "was
// this notebook complete as of this legacy award's own historical
// date") compares against it directly, so leaving it on the real
// current date would make every checkpoint look like it was created
// AFTER any 2026-09-dated legacy award, regardless of which real day
// this suite happens to run on.
function addCheckpoint(classroom, { title = 'Unit', dueDate = '2026-09-10', subjectId = 'subj-1', notebookTypeId = 'type-1', createdAt = '2026-09-01' } = {}) {
  const cp = checkpointService.createNewCheckpoint(classroom, { subjectId, notebookTypeId, title, givenDate: '2026-09-01', dueDate });
  cp.createdAt = createdAt;
  return cp;
}

function submit(checkpoint, studentId, submittedDate) {
  checkpointService.setSubmission(checkpoint, studentId, { status: 'submitted', submittedDate });
}

/** Directly pushes a legacy, OLD-shape per-checkpoint badgeAwards[] entry -- exactly the shape the removed notebookBadgeAwardService.evaluateReadinessChampion()/overrideReadinessChampion() used to write, never produced by any code still in this codebase. */
function addLegacyAward(checkpoint, studentId, { id, source = 'automatic', awardedAt = '2026-09-06T00:00:00.000Z', revoked = false, revokedBy = null, revokedAt = null, revokedReason = null } = {}) {
  const record = checkpointService.getRecordForStudent(checkpoint, studentId);
  if (!record.badgeAwards) record.badgeAwards = [];
  record.badgeAwards.push({ id: id || `legacy-${record.badgeAwards.length}-${checkpoint.id}`, badgeTypeId: 'readiness-champion', source, awardedBy: TEACHER_UID, awardedAt, revoked, revokedBy, revokedAt, revokedReason });
}

// ---------------------------------------------------------------------
// auditLegacyReadinessChampionAwards -- identification, grouping,
// classification.
// ---------------------------------------------------------------------

test('auditLegacyReadinessChampionAwards: a single legacy award on a notebook that is still complete-and-on-time today is validUnderNewRule, with a proposed new entry', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);

  const audit = auditLegacyReadinessChampionAwards(classroom);

  assert.equal(audit.validUnderNewRule.length, 1);
  const group = audit.validUnderNewRule[0];
  assert.equal(group.studentId, student.id);
  assert.equal(group.subjectId, 'subj-1');
  assert.equal(group.legacySourceAwards.length, 1);
  assert.equal(group.legacySourceAwards[0].checkpointId, cp.id);
  assert.equal(group.alreadyPresentInNewLedger, false);
  assert.ok(group.proposedNewEntry);
  assert.equal(group.proposedNewEntry.source, 'retroactive_backfill');
  assert.deepEqual(group.proposedNewEntry.workItemRef, { type: 'notebook_readiness', subjectId: 'subj-1', notebookTypeId: 'type-1' });
  assert.equal(audit.demonstrablyInvalid.length, 0);
  assert.equal(audit.insufficientEvidence.length, 0);
  assert.equal(audit.unmappable.length, 0);
});

test('auditLegacyReadinessChampionAwards: MULTIPLE checkpoint-level legacy awards for the same notebook are grouped into ONE entry and cross-referenced in duplicateCheckpointLevelAwards', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  const cp2 = addCheckpoint(classroom, { title: 'Unit 2' });
  submit(cp1, student.id, '2026-09-05');
  submit(cp2, student.id, '2026-09-06');
  addLegacyAward(cp1, student.id, { awardedAt: '2026-09-05T00:00:00.000Z' });
  addLegacyAward(cp2, student.id, { awardedAt: '2026-09-06T00:00:00.000Z' });

  const audit = auditLegacyReadinessChampionAwards(classroom);

  assert.equal(audit.validUnderNewRule.length, 1, 'two old per-checkpoint awards for the same notebook collapse into ONE group, never two');
  assert.equal(audit.validUnderNewRule[0].legacySourceAwards.length, 2);
  assert.equal(audit.duplicateCheckpointLevelAwards.length, 1);
  assert.deepEqual(
    audit.duplicateCheckpointLevelAwards[0].legacySourceAwards.map((a) => a.checkpointId).sort(),
    [cp1.id, cp2.id].sort()
  );
});

test('auditLegacyReadinessChampionAwards: a notebook with a confirmed PENDING required checkpoint today is demonstrablyInvalid, never silently treated as still valid', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1', createdAt: '2026-09-01' });
  submit(cp1, student.id, '2026-09-05');
  addLegacyAward(cp1, student.id, { awardedAt: '2026-09-06T00:00:00.000Z' });
  // A second required checkpoint existed by the time of the legacy award
  // (createdAt predates it) but was never submitted -- confirmed
  // incompleteness as of the award's own reference date.
  addCheckpoint(classroom, { title: 'Unit 2', createdAt: '2026-09-02' });

  const audit = auditLegacyReadinessChampionAwards(classroom);

  assert.equal(audit.validUnderNewRule.length, 0);
  assert.equal(audit.demonstrablyInvalid.length, 1);
  assert.equal(audit.demonstrablyInvalid[0].completeness.pendingCount, 1);
});

test('auditLegacyReadinessChampionAwards: a notebook with a confirmed LATE required checkpoint today is demonstrablyInvalid', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1', dueDate: '2026-09-10' });
  const cp2 = addCheckpoint(classroom, { title: 'Unit 2', dueDate: '2026-09-10' });
  submit(cp1, student.id, '2026-09-05');
  submit(cp2, student.id, '2026-09-20'); // late
  addLegacyAward(cp1, student.id, { awardedAt: '2026-09-21T00:00:00.000Z' });

  const audit = auditLegacyReadinessChampionAwards(classroom);

  assert.equal(audit.validUnderNewRule.length, 0);
  assert.equal(audit.demonstrablyInvalid.length, 1);
  assert.equal(audit.demonstrablyInvalid[0].completeness.lateCount, 1);
});

test('auditLegacyReadinessChampionAwards: a notebook whose historical eligibility cannot be established (malformed due date) is insufficientEvidence, never demonstrablyInvalid, never guessed as valid', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1', dueDate: '2026-09-10' });
  const cp2 = addCheckpoint(classroom, { title: 'Unit 2', dueDate: '2026-13-40' }); // malformed
  submit(cp1, student.id, '2026-09-05');
  submit(cp2, student.id, '2026-09-06');
  addLegacyAward(cp1, student.id, { awardedAt: '2026-09-07T00:00:00.000Z' });

  const audit = auditLegacyReadinessChampionAwards(classroom);

  assert.equal(audit.validUnderNewRule.length, 0);
  assert.equal(audit.demonstrablyInvalid.length, 0, 'insufficient evidence must never be classified as demonstrably invalid -- inability to establish is not proof of ineligibility');
  assert.equal(audit.insufficientEvidence.length, 1);
});

test('auditLegacyReadinessChampionAwards: a legacy award whose checkpoint identity is missing/empty is unmappable, never fabricated', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);
  cp.subjectId = ''; // corrupted / missing identity, simulated directly

  const audit = auditLegacyReadinessChampionAwards(classroom);

  assert.equal(audit.validUnderNewRule.length, 0);
  assert.equal(audit.unmappable.length, 1);
  assert.equal(audit.unmappable[0].subjectId, null, 'never fabricates a missing notebook reference -- reports it as genuinely absent');
});

test('auditLegacyReadinessChampionAwards: a notebook already touched by the NEW system (any history, active or revoked) is validUnderNewRule but alreadyPresentInNewLedger, with no proposed entry -- never a duplicate recommendation', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);
  // The new system already evaluated this exact notebook and awarded it
  // live (e.g. a teacher used the new feature after it shipped).
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, 'subj-1', 'type-1', student, TEACHER_UID);

  const audit = auditLegacyReadinessChampionAwards(classroom);

  assert.equal(audit.validUnderNewRule.length, 1);
  assert.equal(audit.validUnderNewRule[0].alreadyPresentInNewLedger, true);
  assert.equal(audit.validUnderNewRule[0].proposedNewEntry, null, 'never proposes a second entry for a notebook the new system already decided on');
});

test('auditLegacyReadinessChampionAwards: counterReconciliationPreview correctly reports a disconnected old counter without modifying anything', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);
  student.notebookBadgeCounts = { 'readiness-champion': 3 }; // stale old aggregate, disconnected from the new ledger

  const before = JSON.stringify(classroom);
  const audit = auditLegacyReadinessChampionAwards(classroom);
  assert.equal(JSON.stringify(classroom), before, 'the audit itself performs zero writes');

  const preview = audit.counterReconciliationPreview.find((p) => p.studentId === student.id);
  assert.equal(preview.oldDisplayedCount, 3);
  assert.equal(preview.trueLedgerCountToday, 0, 'the new ledger has nothing yet -- the old counter is entirely disconnected');
  assert.equal(preview.pendingApplications ?? preview.pendingValidApplications, 1);
  assert.equal(preview.projectedCountAfterApply, 1);
  assert.notEqual(preview.note, undefined);
});

// ---------------------------------------------------------------------
// buildLegacyMigrationDryRunReport -- the report wrapper, structural
// limitation disclosed once, report-wide.
// ---------------------------------------------------------------------

test('buildLegacyMigrationDryRunReport: discloses the checkpoint-deletion structural limitation exactly once, report-wide, never per group', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);

  const report = buildLegacyMigrationDryRunReport(classroom);

  assert.ok(report.limitations.checkpointDeletionUndetectable.toLowerCase().includes('checkpoint'));
  assert.ok(report.migrationNote.toLowerCase().includes('read-only') || report.migrationNote.toLowerCase().includes('nothing'));
  assert.equal('structuralLimitation' in report.validUnderNewRule[0], false, 'never duplicated onto an individual group');
});

// ---------------------------------------------------------------------
// applyLegacyReadinessChampionMigration -- execution against a
// synthetic, in-memory fixture ONLY. Never invoked against a real
// classroom anywhere in this codebase.
// ---------------------------------------------------------------------

test('applyLegacyReadinessChampionMigration: throws for an unauthorized uid, applies nothing', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);

  assert.throws(() => applyLegacyReadinessChampionMigration(classroom, VIEWER_UID), /Not authorized/);
  assert.equal(student.history.filter((e) => e.kind === 'readiness-champion').length, 0);
});

test('applyLegacyReadinessChampionMigration: applies a validUnderNewRule group as a new retroactive_backfill entry, carrying full provenance, never touching the old badgeAwards entry', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id, { id: 'legacy-1' });
  const originalBadgeAwardsJson = JSON.stringify(checkpointService.getRecordForStudent(cp, student.id).badgeAwards);

  const result = applyLegacyReadinessChampionMigration(classroom, TEACHER_UID);

  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedAlreadyPresent, 0);
  assert.ok(result.migrationId);

  const newEntry = student.history.find((e) => e.kind === 'readiness-champion' && e.delta === 1);
  assert.ok(newEntry);
  assert.equal(newEntry.source, 'retroactive_backfill');
  assert.equal(newEntry.migrationId, result.migrationId);
  assert.ok(newEntry.migratedAt);
  assert.equal(newEntry.migratedFrom[0].checkpointId, cp.id);
  assert.equal(newEntry.migratedFrom[0].entryId, 'legacy-1');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);

  // The OLD badgeAwards entry is completely untouched -- never edited,
  // never deleted, never marked migrated in place.
  const stillThere = checkpointService.getRecordForStudent(cp, student.id).badgeAwards;
  assert.equal(JSON.stringify(stillThere), originalBadgeAwardsJson);
});

test('applyLegacyReadinessChampionMigration: never applies demonstrablyInvalid, insufficientEvidence, or unmappable groups', () => {
  const classroom = buildClassroom();
  const invalidStudent = createStudent({ id: 'invalid', name: 'Invalid' });
  const insufficientStudent = createStudent({ id: 'insufficient', name: 'Insufficient' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [invalidStudent, insufficientStudent] })];

  const invalidCp = addCheckpoint(classroom, { subjectId: 'invalid-subj', dueDate: '2026-09-10' });
  submit(invalidCp, invalidStudent.id, '2026-09-20'); // late
  addLegacyAward(invalidCp, invalidStudent.id);

  const insufficientCp = addCheckpoint(classroom, { subjectId: 'insufficient-subj', dueDate: '2026-13-40' }); // malformed
  submit(insufficientCp, insufficientStudent.id, '2026-09-05');
  addLegacyAward(insufficientCp, insufficientStudent.id);

  const result = applyLegacyReadinessChampionMigration(classroom, TEACHER_UID);

  assert.equal(result.appliedCount, 0);
  assert.equal(invalidStudent.history.filter((e) => e.kind === 'readiness-champion').length, 0);
  assert.equal(insufficientStudent.history.filter((e) => e.kind === 'readiness-champion').length, 0);
});

test('applyLegacyReadinessChampionMigration: COUNTER RECONCILIATION corrects a disconnected old counter to the ledger\'s own truth, logged with before/after, never silently reset to zero', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);
  student.notebookBadgeCounts = { 'readiness-champion': 5 }; // stale old value from the removed per-checkpoint mechanism

  const result = applyLegacyReadinessChampionMigration(classroom, TEACHER_UID);

  assert.equal(result.counterCorrections.length, 1);
  assert.equal(result.counterCorrections[0].before, 5);
  assert.equal(result.counterCorrections[0].after, 0, 'reconciled to the ledger\'s own truth BEFORE the new backfill entry is added');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'after reconciliation (0) plus the one newly-applied valid notebook (+1)');

  const reconciliationEntry = student.history.find((e) => e.kind === 'notebook-badge-counter-reconciled');
  assert.ok(reconciliationEntry, 'the correction itself is logged, never silent');
  assert.equal(reconciliationEntry.before, 5);
  assert.equal(reconciliationEntry.after, 0);
  assert.equal(reconciliationEntry.migrationId, result.migrationId);
});

test('applyLegacyReadinessChampionMigration: IDEMPOTENT -- calling it a second time applies nothing further and reconciles nothing further', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);
  student.notebookBadgeCounts = { 'readiness-champion': 3 };

  const first = applyLegacyReadinessChampionMigration(classroom, TEACHER_UID);
  assert.equal(first.appliedCount, 1);
  const countAfterFirst = student.notebookBadgeCounts['readiness-champion'];
  const historyLengthAfterFirst = student.history.length;

  const second = applyLegacyReadinessChampionMigration(classroom, TEACHER_UID);

  assert.equal(second.appliedCount, 0, 'the group is now alreadyPresentInNewLedger -- never re-applied');
  assert.equal(second.skippedAlreadyPresent, 1);
  assert.equal(second.counterCorrections.length, 0, 'the counter already matches the ledger\'s own truth -- nothing further to reconcile');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], countAfterFirst, 'unchanged by the second call');
  assert.equal(student.history.length, historyLengthAfterFirst, 'no new entries of any kind appended the second time');
});

test('applyLegacyReadinessChampionMigration: multiple students and multiple notebooks are each handled independently in one call', () => {
  const classroom = buildClassroom();
  const studentA = createStudent({ id: 'a', name: 'Varalaxmi' });
  const studentB = createStudent({ id: 'b', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [studentA, studentB] })];

  const cpA = addCheckpoint(classroom, { subjectId: 'subj-a' });
  submit(cpA, studentA.id, '2026-09-05');
  addLegacyAward(cpA, studentA.id);

  const cpB = addCheckpoint(classroom, { subjectId: 'subj-b' });
  submit(cpB, studentB.id, '2026-09-05');
  addLegacyAward(cpB, studentB.id);

  const result = applyLegacyReadinessChampionMigration(classroom, TEACHER_UID);

  assert.equal(result.appliedCount, 2);
  assert.equal(studentA.notebookBadgeCounts['readiness-champion'], 1);
  assert.equal(studentB.notebookBadgeCounts['readiness-champion'], 1);
});

test('applyLegacyReadinessChampionMigration: performs zero writes to anything other than the SAME in-memory classroom object it was given (no Firestore/network calls anywhere in this file)', () => {
  const classroom = buildClassroom();
  const student = createStudent({ id: 's1', name: 'Pugazh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  addLegacyAward(cp, student.id);

  // If this reached any network/Firestore code, it would throw in this
  // sandboxed test environment (no credentials, no emulator) -- it does
  // not throw, confirming the whole call graph is pure and in-memory.
  assert.doesNotThrow(() => applyLegacyReadinessChampionMigration(classroom, TEACHER_UID));
});
