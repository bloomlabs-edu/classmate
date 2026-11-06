/**
 * tests/services/notebookReadinessChampionService.test.js
 *
 * Full coverage for the notebook-level Readiness Champion redesign
 * (2026-11-06): a student earns this badge once per entire subject
 * notebook (every checkpoint currently configured under one
 * subjectId/notebookTypeId pair), only once EVERY required checkpoint
 * has been submitted on or before its own due date — never per
 * individual checkpoint. See services/notebookReadinessChampionService.js's
 * own header comment for the full design rationale (why the old
 * per-checkpoint model was wrong, the three-source-pool ledger, and the
 * disclosed checkpoint-deletion structural limitation this shares with
 * the historical audit in notebookReadinessChampionAuditService.js).
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

const OWNER_UID = 'owner-uid';
const TEACHER_UID = 'teacher-uid';
const VIEWER_UID = 'viewer-uid';
const SUBJECT_ID = 'subj-1';
const NOTEBOOK_TYPE_ID = 'type-1';

function buildClassroomWithStudent({ withTeam = false } = {}) {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  addMember(classroom, OWNER_UID, MEMBER_ROLES.OWNER, 'The Owner');
  addMember(classroom, TEACHER_UID, MEMBER_ROLES.TEACHER, 'A Teacher');
  addMember(classroom, VIEWER_UID, MEMBER_ROLES.VIEWER, 'A Viewer');
  const student = createStudent({ id: 's1', name: 'Anjali' });
  if (withTeam) classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  return { classroom, student };
}

function addCheckpoint(classroom, { title = 'Unit', dueDate = '2026-09-10', subjectId = SUBJECT_ID, notebookTypeId = NOTEBOOK_TYPE_ID } = {}) {
  return checkpointService.createNewCheckpoint(classroom, { subjectId, notebookTypeId, title, givenDate: '2026-09-01', dueDate });
}

function submit(checkpoint, studentId, submittedDate) {
  checkpointService.setSubmission(checkpoint, studentId, { status: 'submitted', submittedDate });
}

// ---------------------------------------------------------------------
// computeNotebookCompleteness — the shared ground truth
// ---------------------------------------------------------------------

test('computeNotebookCompleteness: a notebook with zero checkpoints is never complete (vacuous-truth guard)', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.totalRequired, 0);
  assert.equal(result.isComplete, false);
  assert.equal(result.isCompleteAndOnTime, false);
});

test('computeNotebookCompleteness: one of several checkpoints submitted on time, the rest pending — incomplete, never complete-and-on-time', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  addCheckpoint(classroom, { title: 'Unit 2' });
  addCheckpoint(classroom, { title: 'Unit 3' });
  submit(cp1, student.id, '2026-09-08');

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.totalRequired, 3);
  assert.equal(result.onTimeCount, 1);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.isComplete, false);
  assert.equal(result.isCompleteAndOnTime, false);
});

test('computeNotebookCompleteness: every checkpoint submitted on time — complete and on time', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const checkpoints = [addCheckpoint(classroom, { title: 'Unit 1' }), addCheckpoint(classroom, { title: 'Unit 2' }), addCheckpoint(classroom, { title: 'Unit 3' })];
  checkpoints.forEach((cp) => submit(cp, student.id, '2026-09-08'));

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.totalRequired, 3);
  assert.equal(result.onTimeCount, 3);
  assert.equal(result.isComplete, true);
  assert.equal(result.isCompleteAndOnTime, true);
});

test('computeNotebookCompleteness: one late checkpoint among otherwise-on-time ones — complete, but NOT on time', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const onTime = addCheckpoint(classroom, { title: 'Unit 1' });
  const late = addCheckpoint(classroom, { title: 'Unit 2' });
  submit(onTime, student.id, '2026-09-08');
  submit(late, student.id, '2026-09-20'); // after the 2026-09-10 due date

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.isComplete, true, 'everything was submitted, so the notebook IS complete');
  assert.equal(result.lateCount, 1);
  assert.equal(result.isCompleteAndOnTime, false, 'but one late submission means it is not complete-AND-on-time');
});

test('computeNotebookCompleteness: submitted exactly on the due date counts as on time (inclusive boundary)', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '2026-09-10' });
  submit(cp, student.id, '2026-09-10');

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.isCompleteAndOnTime, true);
});

test('computeNotebookCompleteness: a checkpoint with no due date at all is never late, by the same construction as checkpointService.isLate()', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '' });
  submit(cp, student.id, '2026-12-31'); // arbitrarily "late" by any normal reading, but there is no due date to compare against

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.lateCount, 0);
  assert.equal(result.isCompleteAndOnTime, true);
});

test('computeNotebookCompleteness: a malformed (non-empty) due date is insufficient evidence, never guessed as on-time or late', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '2026-13-40' }); // malformed
  submit(cp, student.id, '2026-09-08');

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.insufficientEvidenceCount, 1);
  assert.equal(result.hasInsufficientEvidence, true);
  assert.equal(result.isCompleteAndOnTime, false);
  assert.equal(result.lateCount, 0, 'never classified as late when it cannot actually be established');
});

test('computeNotebookCompleteness: a malformed submittedDate is insufficient evidence, never guessed', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '2026-09-10' });
  submit(cp, student.id, 'not-a-real-date');

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.insufficientEvidenceCount, 1);
  assert.equal(result.isCompleteAndOnTime, false);
});

test('computeNotebookCompleteness: two different notebooks (different subjectId/notebookTypeId) for the same student never cross-contaminate', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const mathCp = addCheckpoint(classroom, { subjectId: 'math', notebookTypeId: 'class-work' });
  const scienceCp = addCheckpoint(classroom, { subjectId: 'science', notebookTypeId: 'class-work' });
  submit(mathCp, student.id, '2026-09-08'); // on time
  submit(scienceCp, student.id, '2026-09-20'); // late

  const math = notebookReadinessChampionService.computeNotebookCompleteness(classroom, 'math', 'class-work', student.id);
  const science = notebookReadinessChampionService.computeNotebookCompleteness(classroom, 'science', 'class-work', student.id);
  assert.equal(math.isCompleteAndOnTime, true);
  assert.equal(science.isCompleteAndOnTime, false);
});

// ---------------------------------------------------------------------
// evaluateReadinessChampionForNotebook — the live automatic award/revoke
// lifecycle.
// ---------------------------------------------------------------------

test('evaluateReadinessChampionForNotebook: one on-time checkpoint out of several still-pending ones — no badge', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  addCheckpoint(classroom, { title: 'Unit 2' });
  submit(cp1, student.id, '2026-09-08');

  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0);
});

test('evaluateReadinessChampionForNotebook: the FINAL required checkpoint being submitted on time completes the notebook and awards exactly once', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  const cp2 = addCheckpoint(classroom, { title: 'Unit 2' });
  submit(cp1, student.id, '2026-09-08');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0, 'sanity: still incomplete after the first checkpoint alone');

  submit(cp2, student.id, '2026-09-09'); // the final required checkpoint, also on time
  const count = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(count, 1);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('evaluateReadinessChampionForNotebook: all required checkpoints on time from the start — exactly one badge, not one per checkpoint', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const checkpoints = [addCheckpoint(classroom, { title: 'Unit 1' }), addCheckpoint(classroom, { title: 'Unit 2' }), addCheckpoint(classroom, { title: 'Unit 3' })];
  checkpoints.forEach((cp) => submit(cp, student.id, '2026-09-08'));

  // Re-evaluating once per checkpoint submission, exactly as the real UI
  // does (one call per onQuickMarkSubmitted) — must still land on exactly
  // ONE active award, never three.
  checkpoints.forEach(() => notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID));

  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'one on-time, all-complete notebook is exactly ONE badge, regardless of checkpoint count');
});

test('evaluateReadinessChampionForNotebook: one late required checkpoint among otherwise-complete ones — no badge', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const onTime = addCheckpoint(classroom, { title: 'Unit 1' });
  const late = addCheckpoint(classroom, { title: 'Unit 2' });
  submit(onTime, student.id, '2026-09-08');
  submit(late, student.id, '2026-09-20');

  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0);
});

test('evaluateReadinessChampionForNotebook: one pending (never submitted) required checkpoint among otherwise-complete, on-time ones — no badge', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const onTime = addCheckpoint(classroom, { title: 'Unit 1' });
  addCheckpoint(classroom, { title: 'Unit 2' }); // never touched -- pending
  submit(onTime, student.id, '2026-09-08');

  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0);
});

test('evaluateReadinessChampionForNotebook: calling it repeatedly once already complete-and-on-time never stacks a second award', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-08');

  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  const second = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  const third = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(second, null);
  assert.equal(third, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('evaluateReadinessChampionForNotebook: WITHDRAWAL -- walking a submission back to not_submitted after the badge was earned auto-revokes it', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  const cp2 = addCheckpoint(classroom, { title: 'Unit 2' });
  submit(cp1, student.id, '2026-09-08');
  submit(cp2, student.id, '2026-09-08');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'sanity check: awarded first');

  checkpointService.setSubmission(cp1, student.id, { status: 'not_submitted' }); // withdrawal of ONE of the two checkpoints
  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0, 'the notebook is no longer complete, so the automatic award must not survive');
});

test('evaluateReadinessChampionForNotebook: a resubmission that turns a previously on-time checkpoint late auto-revokes an already-active award, with no explicit withdrawal step', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);

  submit(cp, student.id, '2026-09-20'); // corrected to late, status stays 'submitted' throughout
  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
});

test('evaluateReadinessChampionForNotebook: resubmitting after a withdrawal, still on time, earns a fresh award -- the earlier revoked entry never blocks it', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  checkpointService.setSubmission(cp, student.id, { status: 'not_submitted' });
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);

  submit(cp, student.id, '2026-09-08'); // resubmitted, still on time
  const count = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(count, 1);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('evaluateReadinessChampionForNotebook: a teacher OVERRIDE is never auto-revoked by re-evaluation, even when the notebook later becomes incomplete or late', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  addCheckpoint(classroom, { title: 'Unit 2' }); // left pending on purpose
  submit(cp1, student.id, '2026-09-20'); // late

  notebookReadinessChampionService.overrideReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);

  // Re-evaluating (e.g. the same submission event firing again) must never
  // touch an override -- only an explicit revoke can undo it.
  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'the override must survive automatic re-evaluation');
});

// ---------------------------------------------------------------------
// REVOCATION EVIDENCE POLICY (post-review hardening, 2026-11-06): an
// active automatic award may only be auto-revoked on CONFIRMED evidence
// (a pending or genuinely late required checkpoint) -- never merely
// because eligibility can no longer be ESTABLISHED (a missing or
// malformed due date). Inability to establish eligibility is not proof
// of ineligibility.
// ---------------------------------------------------------------------

test('evaluateReadinessChampionForNotebook: a VALID due date becoming MALFORMED afterward never revokes an already-active automatic award', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '2026-09-10' });
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'sanity check: awarded first');

  cp.dueDate = '2026-13-40'; // corrupted after the fact -- non-empty, malformed
  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(result, null, 'no new award, but also no revocation -- insufficient evidence alone is never revocation grounds');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'the award must survive a due date becoming unreadable');
  const reversal = student.history.find((e) => e.kind === 'readiness-champion' && e.delta === -1);
  assert.equal(reversal, undefined, 'no reversal entry should ever be appended for insufficient evidence alone');
});

test('evaluateReadinessChampionForNotebook: a MISSING (cleared, not malformed) due date never revokes -- an empty due date can never be late, by construction', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '2026-09-10' });
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  cp.dueDate = ''; // cleared, not malformed
  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'untouched');
});

test('evaluateReadinessChampionForNotebook: a CONFIRMED late required checkpoint still correctly revokes an active automatic award (concrete violation, not mere insufficient evidence)', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '2026-09-10' });
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  submit(cp, student.id, '2026-09-20'); // confirmed late -- both dates well-formed
  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0, 'a confirmed violation still correctly revokes');
  const reversal = student.history.find((e) => e.kind === 'readiness-champion' && e.delta === -1);
  assert.equal(reversal.reason, 'notebook_late');
});

test('evaluateReadinessChampionForNotebook: a CONFIRMED incomplete notebook (withdrawn required checkpoint) still correctly revokes an active automatic award', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  checkpointService.setSubmission(cp, student.id, { status: 'not_submitted' }); // confirmed pending again
  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  const reversal = student.history.find((e) => e.kind === 'readiness-champion' && e.delta === -1);
  assert.equal(reversal.reason, 'notebook_incomplete');
});

test('evaluateReadinessChampionForNotebook: MIXED CASE -- a confirmed pending checkpoint still correctly revokes even while a SEPARATE required checkpoint in the same notebook has insufficient evidence (malformed due date)', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const confirmedPendingCp = addCheckpoint(classroom, { title: 'Unit 1' }); // never submitted -- confirmed violation
  const insufficientEvidenceCp = addCheckpoint(classroom, { title: 'Unit 2', dueDate: '2026-13-40' }); // malformed, unrelated to the pending one
  submit(insufficientEvidenceCp, student.id, '2026-09-05');

  // Can never actually reach an active award with the pending checkpoint
  // present (isCompleteAndOnTime requires pendingCount === 0), so
  // construct the "was already awarded, then this state arose" scenario
  // directly -- exactly the way a real resubmission-to-not-submitted
  // event would leave things, without relying on a prior evaluate() call
  // that could never have fired here.
  const workItemRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: SUBJECT_ID, notebookTypeId: NOTEBOOK_TYPE_ID });
  student.history = [{ id: 'h1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef, recordedAt: '2026-09-01T00:00:00.000Z' }];
  student.notebookBadgeCounts = { 'readiness-champion': 1 };

  const completenessBefore = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(completenessBefore.pendingCount, 1, 'sanity check: the confirmed violation is genuinely present');
  assert.equal(completenessBefore.hasInsufficientEvidence, true, 'sanity check: insufficient evidence is ALSO genuinely present on a different checkpoint');

  const result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0, 'the confirmed pending violation revokes the award regardless of the co-occurring insufficient evidence elsewhere in the same notebook');
  const reversal = student.history.find((e) => e.kind === 'readiness-champion' && e.delta === -1);
  assert.equal(reversal.reason, 'notebook_incomplete', 'the confirmed violation, never the insufficient evidence, is reported as the reason');
  assert.equal(checkpointService.getRecordForStudent(confirmedPendingCp, student.id), null, 'sanity check: this checkpoint was genuinely never submitted at all');
});

test('evaluateReadinessChampionForNotebook: RESTORATION -- correcting a malformed due date back to a valid one, with the notebook genuinely complete-and-on-time, awards it on the very next re-evaluation', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '2026-09-10' });
  submit(cp, student.id, '2026-09-05');

  cp.dueDate = '2026-13-40'; // malformed BEFORE the first evaluation ever runs
  const firstAttempt = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(firstAttempt, null, 'insufficient evidence never auto-awards either -- never guessed as eligible');
  assert.equal(student.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0);

  cp.dueDate = '2026-09-10'; // corrected back to a real, well-formed due date
  const afterRestoration = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(afterRestoration, 1, 'no separate "restore" action needed -- the very next re-evaluation awards it correctly once the evidence is re-establishable');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('evaluateReadinessChampionForNotebook: REPEATED RE-EVALUATION while evidence remains insufficient never produces a duplicate award or a spurious reversal', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { dueDate: '2026-13-40' }); // malformed from the start
  submit(cp, student.id, '2026-09-05');

  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(student.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0);
  assert.equal(student.history.filter((e) => e.kind === 'readiness-champion').length, 0, 'repeated re-evaluation in an unresolvable state is a pure no-op every time, never appending anything');
});

test('evaluateReadinessChampionForNotebook: an unauthorized acting uid silently skips the award -- never throws, never disrupts the submission it reacted to', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');

  let threw = false;
  let result;
  try {
    result = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, VIEWER_UID);
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0);
});

test('evaluateReadinessChampionForNotebook: MULTIPLE SUBJECT NOTEBOOKS -- completing one never awards or blocks the other; each tracks its own independent badge instance', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const mathCp = addCheckpoint(classroom, { subjectId: 'math', notebookTypeId: 'class-work' });
  const scienceCp1 = addCheckpoint(classroom, { subjectId: 'science', notebookTypeId: 'class-work' });
  addCheckpoint(classroom, { subjectId: 'science', notebookTypeId: 'class-work', title: 'Unit 2' }); // left pending

  submit(mathCp, student.id, '2026-09-08');
  submit(scienceCp1, student.id, '2026-09-08');

  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, 'math', 'class-work', student, TEACHER_UID);
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, 'science', 'class-work', student, TEACHER_UID);

  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'math alone is complete and on time -- science is still pending one checkpoint');

  // Now complete science too -- the count must become 2, a genuinely
  // SECOND, independent award, not a no-op blocked by math's own active
  // entry.
  const secondScienceCheckpoint = checkpointService.listCheckpointsForNotebook(classroom, 'science', 'class-work')[1];
  submit(secondScienceCheckpoint, student.id, '2026-09-09');
  const count = notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, 'science', 'class-work', student, TEACHER_UID);

  assert.equal(count, 2, 'awardNotebookBadge() returns the NEW total aggregate count (already 1 from math, now incremented to 2 for science)');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 2, 'both notebooks are now independently active -- math\'s own award is untouched by science completing separately');
});

test('evaluateReadinessChampionForNotebook: performs zero writes when nothing applies -- an untouched notebook leaves the classroom byte-for-byte unchanged', () => {
  const { classroom, student } = buildClassroomWithStudent();
  addCheckpoint(classroom);
  const before = JSON.stringify(classroom);

  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(JSON.stringify(classroom), before);
});

// ---------------------------------------------------------------------
// overrideReadinessChampionForNotebook / revokeReadinessChampionForNotebook
// -- explicit teacher actions.
// ---------------------------------------------------------------------

test('overrideReadinessChampionForNotebook: throws for an unauthorized uid', () => {
  const { classroom, student } = buildClassroomWithStudent();
  addCheckpoint(classroom);
  assert.throws(
    () => notebookReadinessChampionService.overrideReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, VIEWER_UID),
    /Not authorized/
  );
});

test('overrideReadinessChampionForNotebook: throws if an award is already active (from any source) -- never stacks a second one', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.throws(
    () => notebookReadinessChampionService.overrideReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID),
    /already been awarded/
  );
});

test('overrideReadinessChampionForNotebook: awards despite a pending/late notebook the automatic rule would never grant', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  addCheckpoint(classroom, { title: 'Unit 2' }); // pending
  submit(cp1, student.id, '2026-09-20'); // late

  assert.equal(notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID), null);

  const count = notebookReadinessChampionService.overrideReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(count, 1);
  assert.ok(notebookReadinessChampionService.getActiveReadinessSourcesForNotebook(student, notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: SUBJECT_ID, notebookTypeId: NOTEBOOK_TYPE_ID })).includes('override'));
});

test('revokeReadinessChampionForNotebook: throws for an unauthorized uid', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.throws(
    () => notebookReadinessChampionService.revokeReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, VIEWER_UID),
    /Not authorized/
  );
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'untouched');
});

test('revokeReadinessChampionForNotebook: throws when nothing is active to revoke', () => {
  const { classroom, student } = buildClassroomWithStudent();
  addCheckpoint(classroom);
  assert.throws(
    () => notebookReadinessChampionService.revokeReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID),
    /No active Readiness Champion award/
  );
});

test('revokeReadinessChampionForNotebook: revoking an automatic award decrements the count exactly once and preserves append-only history', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  const historyLengthBefore = student.history.length;

  const count = notebookReadinessChampionService.revokeReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, OWNER_UID);

  assert.equal(count, 0);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  // Two entries are appended, never fewer: the readiness-champion
  // ledger's own reversal entry (appendReadinessEntry(), what this
  // file's duplicate-prevention net-sum actually reads) PLUS
  // notebookBadgeService.revokeNotebookBadge()'s own generic
  // 'notebook-badge-revoked' Participation History entry (the same
  // audit trail every notebook badge revocation leaves) -- never fewer
  // than that, and the original award entry is never removed or edited.
  assert.equal(student.history.length, historyLengthBefore + 2, 'both the readiness-champion ledger entry and notebookBadgeService\'s own generic audit entry are appended; nothing is removed');
  const reversal = student.history.find((e) => e.kind === 'readiness-champion' && e.delta === -1);
  assert.ok(reversal, 'the readiness-champion ledger must carry its own -1 reversal entry');
  assert.equal(reversal.reason, 'teacher_revoked');
  assert.equal(reversal.revokedBy, OWNER_UID);
  const original = student.history.find((e) => e.kind === 'readiness-champion' && e.delta === 1);
  assert.ok(original, 'the original +1 award entry is preserved, never removed');
});

test('revokeReadinessChampionForNotebook: after revoking, overriding the SAME notebook is not blocked by the earlier revoked entry', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom);
  submit(cp, student.id, '2026-09-05');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  notebookReadinessChampionService.revokeReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  const count = notebookReadinessChampionService.overrideReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(count, 1);
});

// ---------------------------------------------------------------------
// COUNTER INTEGRITY under MULTIPLE simultaneously-active pools
// (post-review hardening, 2026-11-06). Today's reachable application
// code paths never actually produce more than one net-positive pool at
// once (every award function checks isReadinessChampionActiveForNotebook()
// -- any pool -- before awarding), so this state is deliberately
// constructed directly on `student.history`/`notebookBadgeCounts` below,
// exactly as a future backfill-applying migration step could one day
// produce it, rather than waiting for a real code path to exist first.
// ---------------------------------------------------------------------

test('revokeReadinessChampionForNotebook: with TWO simultaneously-active pools (automatic + override), one call revokes BOTH and decrements the counter by exactly two, never one', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const workItemRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: SUBJECT_ID, notebookTypeId: NOTEBOOK_TYPE_ID });
  // Two independent award entries, as if two separate earlier calls each
  // incremented the aggregate counter once -- deliberately bypassing the
  // normal single-award guard to exercise the multi-pool case directly.
  student.history = [
    { id: 'h1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef, recordedAt: '2026-09-05T00:00:00.000Z' },
    { id: 'h2', kind: 'readiness-champion', label: 'Readiness Champion (override)', delta: 1, source: 'override', workItemRef, recordedAt: '2026-09-06T00:00:00.000Z' },
  ];
  student.notebookBadgeCounts = { 'readiness-champion': 2 }; // each of the two awards above had incremented this once
  assert.deepEqual(
    notebookReadinessChampionService.getActiveReadinessSourcesForNotebook(student, workItemRef).sort(),
    ['automatic', 'override'],
    'sanity check: both pools are genuinely active before revoking'
  );

  const count = notebookReadinessChampionService.revokeReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(count, 0, 'the counter must be decremented once PER active pool (two), landing at 0, never left at 1');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  assert.deepEqual(notebookReadinessChampionService.getActiveReadinessSourcesForNotebook(student, workItemRef), [], 'both pools are now net-zero');

  const reversals = student.history.filter((e) => e.kind === 'readiness-champion' && e.delta === -1);
  assert.equal(reversals.length, 2, 'each pool gets its own, individually-labeled, append-only reversal entry -- never collapsed into one');
  assert.deepEqual(reversals.map((r) => r.source).sort(), ['automatic', 'override']);
  reversals.forEach((r) => assert.equal(r.reason, 'teacher_revoked'));

  // The two original +1 award entries are still there, untouched --
  // append-only, never deleted or edited.
  const originals = student.history.filter((e) => e.kind === 'readiness-champion' && e.delta === 1);
  assert.equal(originals.length, 2);
});

test('revokeReadinessChampionForNotebook: with two active pools, calling it a SECOND time throws (idempotent-safe, never double-decrements below zero)', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const workItemRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: SUBJECT_ID, notebookTypeId: NOTEBOOK_TYPE_ID });
  student.history = [
    { id: 'h1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef, recordedAt: '2026-09-05T00:00:00.000Z' },
    { id: 'h2', kind: 'readiness-champion', label: 'Readiness Champion (override)', delta: 1, source: 'override', workItemRef, recordedAt: '2026-09-06T00:00:00.000Z' },
  ];
  student.notebookBadgeCounts = { 'readiness-champion': 2 };

  notebookReadinessChampionService.revokeReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);

  assert.throws(
    () => notebookReadinessChampionService.revokeReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID),
    /No active Readiness Champion award/,
    'nothing left active the second time -- throws rather than silently no-opping or decrementing again'
  );
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0, 'never driven negative or decremented a second time');
});

test('evaluateReadinessChampionForNotebook: automatic re-evaluation with two active pools (automatic + override) only ever auto-revokes the AUTOMATIC one, never the override, even via the multi-pool path', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  addCheckpoint(classroom, { title: 'Unit 2' }); // left pending -- notebook is incomplete
  submit(cp1, student.id, '2026-09-05');
  const workItemRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: SUBJECT_ID, notebookTypeId: NOTEBOOK_TYPE_ID });
  student.history = [
    { id: 'h1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef, recordedAt: '2026-09-05T00:00:00.000Z' },
    { id: 'h2', kind: 'readiness-champion', label: 'Readiness Champion (override)', delta: 1, source: 'override', workItemRef, recordedAt: '2026-09-06T00:00:00.000Z' },
  ];
  student.notebookBadgeCounts = { 'readiness-champion': 2 };

  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);

  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'only the automatic pool is revoked (counter 2 -> 1); the override pool is untouched');
  assert.deepEqual(
    notebookReadinessChampionService.getActiveReadinessSourcesForNotebook(student, workItemRef),
    ['override'],
    'override survives automatic re-evaluation even in the multi-pool case'
  );
});

// ---------------------------------------------------------------------
// reevaluateReadinessChampionForAllStudents -- structural changes to the
// notebook itself (checkpoint added/removed/due-date edited).
// ---------------------------------------------------------------------

test('reevaluateReadinessChampionForAllStudents: re-checks every student on the roster against one notebook', () => {
  const { classroom } = buildClassroomWithStudent();
  const studentA = createStudent({ id: 'a', name: 'Anjali' });
  const studentB = createStudent({ id: 'b', name: 'Bhavesh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [studentA, studentB] })];

  const cp = addCheckpoint(classroom);
  submit(cp, studentA.id, '2026-09-08'); // on time
  submit(cp, studentB.id, '2026-09-20'); // late

  notebookReadinessChampionService.reevaluateReadinessChampionForAllStudents(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, TEACHER_UID);

  assert.equal(studentA.notebookBadgeCounts['readiness-champion'], 1);
  assert.equal(studentB.notebookBadgeCounts?.['readiness-champion'] ?? 0, 0);
});

test('reevaluateReadinessChampionForAllStudents: a newly-added required checkpoint can turn an already-awarded notebook incomplete again for every affected student', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(cp1, student.id, '2026-09-08');
  notebookReadinessChampionService.evaluateReadinessChampionForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);

  addCheckpoint(classroom, { title: 'Unit 2' }); // a teacher adds a new required checkpoint -- nobody has submitted it yet
  notebookReadinessChampionService.reevaluateReadinessChampionForAllStudents(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, TEACHER_UID);

  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0, 'the notebook is no longer complete now that a second required checkpoint exists');
});

test('reevaluateReadinessChampionForAllStudents: deleting the one remaining pending checkpoint can newly complete the notebook', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  const cp2 = addCheckpoint(classroom, { title: 'Unit 2' });
  submit(cp1, student.id, '2026-09-08');
  // cp2 left pending

  checkpointService.deleteCheckpoint(classroom, cp2.id);
  notebookReadinessChampionService.reevaluateReadinessChampionForAllStudents(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, TEACHER_UID);

  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'with the pending checkpoint gone, the one submitted on time is now the whole notebook');
});
