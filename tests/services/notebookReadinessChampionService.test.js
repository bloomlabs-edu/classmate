/**
 * tests/services/notebookReadinessChampionService.test.js
 *
 * Full coverage for the PERMANENT, PER-INSPECTION Readiness Champion
 * redesign (2026-11-07): creating a fresh checkpoint (a new unit) in a
 * subject notebook is the one and only inspection event. At that
 * moment, every student whose previously-assigned required checkpoints
 * (the brand-new one excluded) are all complete earns one permanent
 * badge for that exact event — timeliness is irrelevant, and the badge
 * is never revoked by anything that happens afterward. See
 * services/notebookReadinessChampionService.js's own header comment for
 * the full design rationale, including why the prior notebook-level
 * model (2026-11-06, net-summed, auto-revoking) was superseded and how
 * its own legacy data is preserved untouched.
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
// computeNotebookCompleteness — the shared ground truth. Unchanged by
// the 2026-11-07 redesign except for the additive `excludeCheckpointIds`
// option (its own section further down) — every test here still holds.
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
// computeNotebookCompleteness — excludeCheckpointIds (new, 2026-11-07):
// used by the live inspection path to evaluate "every PREVIOUSLY
// assigned required checkpoint," excluding the brand-new one by its own
// id rather than by date (same-day siblings would be ambiguous by date).
// ---------------------------------------------------------------------

test('computeNotebookCompleteness: excludeCheckpointIds drops the excluded checkpoint from totalRequired entirely', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  const cp2 = addCheckpoint(classroom, { title: 'Unit 2' }); // left pending
  submit(cp1, student.id, '2026-09-08');

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id, {
    excludeCheckpointIds: [cp2.id],
  });
  assert.equal(result.totalRequired, 1, 'the excluded, still-pending checkpoint never counts toward the required set');
  assert.equal(result.isComplete, true);
});

test('computeNotebookCompleteness: excluding a same-day sibling checkpoint by id is exact, where date-based filtering would be ambiguous', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp1 = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(cp1, student.id, '2026-09-08');
  const sameDaySibling = addCheckpoint(classroom, { title: 'Unit 2 (same day)' }); // same createdAt date-key as any checkpoint created "today" in this test run

  const result = notebookReadinessChampionService.computeNotebookCompleteness(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id, {
    excludeCheckpointIds: [sameDaySibling.id],
  });
  assert.equal(result.totalRequired, 1, 'only the sibling is excluded, by its own id -- cp1 is still required and already satisfied');
  assert.equal(result.isComplete, true);
});

// ---------------------------------------------------------------------
// inspectReadinessChampionOnNewCheckpoint — THE one live award trigger.
// ---------------------------------------------------------------------

test('inspectReadinessChampionOnNewCheckpoint: a student with all previously-assigned checkpoints complete earns a permanent badge at the new checkpoint\'s own creation', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const prior = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(prior, student.id, '2026-09-08');
  const freshUnit = addCheckpoint(classroom, { title: 'Unit 2' });

  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('inspectReadinessChampionOnNewCheckpoint: an incomplete prior checkpoint prevents the new award', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  addCheckpoint(classroom, { title: 'Unit 1' }); // never submitted
  const freshUnit = addCheckpoint(classroom, { title: 'Unit 2' });

  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0);
});

test('inspectReadinessChampionOnNewCheckpoint: historical lateness is irrelevant -- a late-but-completed prior checkpoint still qualifies', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const prior = addCheckpoint(classroom, { title: 'Unit 1', dueDate: '2026-09-10' });
  submit(prior, student.id, '2026-09-25'); // submitted, but well after the due date
  const freshUnit = addCheckpoint(classroom, { title: 'Unit 2' });

  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1, 'submitted late is still submitted -- lateness never blocks the new-model award');
});

test('inspectReadinessChampionOnNewCheckpoint: a student who was absent/late but has since caught up on every prior checkpoint qualifies at the next inspection', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const unit1 = addCheckpoint(classroom, { title: 'Unit 1' }); // nothing submitted yet
  const unit2 = addCheckpoint(classroom, { title: 'Unit 2' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, unit2, TEACHER_UID);
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0, 'unit1 was still pending at unit2\'s own inspection -- no badge yet');

  submit(unit1, student.id, '2026-10-01'); // catches up late, well after unit2 already existed
  submit(unit2, student.id, '2026-10-01');
  const unit3 = addCheckpoint(classroom, { title: 'Unit 3' }); // the NEXT inspection

  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, unit3, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1, 'now caught up on both prior units, the student qualifies at the next inspection');
});

test('inspectReadinessChampionOnNewCheckpoint: two distinct qualifying checkpoint-creation events produce two independent, permanent badges for the same notebook', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const unit1 = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(unit1, student.id, '2026-09-08');
  const unit2 = addCheckpoint(classroom, { title: 'Unit 2' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, unit2, TEACHER_UID); // qualifies: unit1 complete

  submit(unit2, student.id, '2026-09-15');
  const unit3 = addCheckpoint(classroom, { title: 'Unit 3' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, unit3, TEACHER_UID); // qualifies again: unit1 + unit2 both complete

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 2, 'two qualifying inspections -- two permanent badges, never capped at one per notebook');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 2);
});

test('inspectReadinessChampionOnNewCheckpoint: duplicate handling of the SAME creation event (e.g. a retried save) never double-awards', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const prior = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(prior, student.id, '2026-09-08');
  const freshUnit = addCheckpoint(classroom, { title: 'Unit 2' });

  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID);
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID); // same checkpoint object, called again
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1, 'one inspection event, exactly one permanent entry, regardless of how many times it is (re)handled');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('inspectReadinessChampionOnNewCheckpoint: new, still-incomplete work never reduces a previously earned badge', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const unit1 = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(unit1, student.id, '2026-09-08');
  const unit2 = addCheckpoint(classroom, { title: 'Unit 2' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, unit2, TEACHER_UID);
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1);

  // unit2 is left pending (never submitted) -- a THIRD inspection must
  // never retroactively touch the badge already earned at unit2's own
  // creation, even though the notebook is now incomplete again.
  const unit3 = addCheckpoint(classroom, { title: 'Unit 3' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, unit3, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1, 'no NEW badge (unit2 still pending), but the one already earned is untouched');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'the legacy flat counter is never decremented by this path either');
});

test('inspectReadinessChampionOnNewCheckpoint: a notebook with no prior checkpoints at all (the very first checkpoint ever created) never awards on its own creation', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const firstEver = addCheckpoint(classroom, { title: 'Unit 1' });

  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, firstEver, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0, 'nothing was "previously assigned" yet -- nothing to be ready for');
});

test('inspectReadinessChampionOnNewCheckpoint: an unauthorized acting uid awards nothing, for any student, and never throws', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const prior = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(prior, student.id, '2026-09-08');
  const freshUnit = addCheckpoint(classroom, { title: 'Unit 2' });

  assert.doesNotThrow(() => notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, VIEWER_UID));
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0);
});

test('inspectReadinessChampionOnNewCheckpoint: multiple students on the roster are each evaluated independently against the same inspection event', () => {
  const { classroom } = buildClassroomWithStudent();
  const caughtUp = createStudent({ id: 'a', name: 'Anjali' });
  const stillPending = createStudent({ id: 'b', name: 'Bhavesh' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [caughtUp, stillPending] })];

  const prior = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(prior, caughtUp.id, '2026-09-08');
  // stillPending never submits unit 1
  const freshUnit = addCheckpoint(classroom, { title: 'Unit 2' });

  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(caughtUp), 1);
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(stillPending), 0);
});

test('inspectReadinessChampionOnNewCheckpoint: no submission, review, withdrawal, edit, or deletion event in this service awards or revokes anything -- only this function does', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const prior = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(prior, student.id, '2026-09-08');
  const freshUnit = addCheckpoint(classroom, { title: 'Unit 2' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID);
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1);

  // Withdraw the already-submitted prior checkpoint, submit/resubmit
  // freshUnit, and delete freshUnit entirely -- none of this is routed
  // through any readiness function at all (this service exposes no
  // "on submission" or "on delete" hook for the new model), so the
  // permanent badge is structurally untouched by construction.
  checkpointService.setSubmission(prior, student.id, { status: 'not_submitted', submittedDate: '' });
  submit(freshUnit, student.id, '2026-09-09');
  checkpointService.deleteCheckpoint(classroom, freshUnit.id);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1, 'still exactly 1 -- nothing in this file reacts to any of the above');
});

// ---------------------------------------------------------------------
// countReadinessChampionAchievementsForStudent / listReadinessChampionAchievementsForNotebook
// ---------------------------------------------------------------------

test('countReadinessChampionAchievementsForStudent: a student with no history at all counts 0, even with a disconnected legacy counter', () => {
  const { student } = buildClassroomWithStudent();
  student.notebookBadgeCounts = { 'readiness-champion': 3 }; // simulates a stale, unrelated legacy count
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0);
});

test('countReadinessChampionAchievementsForStudent: never counts OLD-shape legacy entries, only new per-inspection entries', () => {
  const { student } = buildClassroomWithStudent();
  const legacyRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: SUBJECT_ID, notebookTypeId: NOTEBOOK_TYPE_ID });
  student.history = [{ id: 'legacy-1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef: legacyRef, recordedAt: '2026-10-01T00:00:00.000Z' }];

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0, 'a legacy, old-shape entry is never counted as a new achievement');
});

test('countReadinessChampionAchievementsForStudent: can be scoped to one notebook', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const priorA = addCheckpoint(classroom, { title: 'A1', subjectId: 'subj-A', notebookTypeId: 'type-A' });
  submit(priorA, student.id, '2026-09-08');
  const freshA = addCheckpoint(classroom, { title: 'A2', subjectId: 'subj-A', notebookTypeId: 'type-A' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshA, TEACHER_UID);

  const priorB = addCheckpoint(classroom, { title: 'B1', subjectId: 'subj-B', notebookTypeId: 'type-B' });
  submit(priorB, student.id, '2026-09-08');
  const freshB = addCheckpoint(classroom, { title: 'B2', subjectId: 'subj-B', notebookTypeId: 'type-B' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshB, TEACHER_UID);

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 2, 'unscoped -- both notebooks');
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student, { subjectId: 'subj-A', notebookTypeId: 'type-A' }), 1);
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student, { subjectId: 'subj-B', notebookTypeId: 'type-B' }), 1);
});

test('listReadinessChampionAchievementsForNotebook: lists every inspection-event entry for one notebook, each carrying its own triggering checkpointId', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const unit1 = addCheckpoint(classroom, { title: 'Unit 1' });
  submit(unit1, student.id, '2026-09-08');
  const unit2 = addCheckpoint(classroom, { title: 'Unit 2' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, unit2, TEACHER_UID);
  submit(unit2, student.id, '2026-09-15');
  const unit3 = addCheckpoint(classroom, { title: 'Unit 3' });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, unit3, TEACHER_UID);

  const achievements = notebookReadinessChampionService.listReadinessChampionAchievementsForNotebook(student, SUBJECT_ID, NOTEBOOK_TYPE_ID);
  assert.equal(achievements.length, 2);
  assert.deepEqual(
    achievements.map((a) => a.workItemRef.checkpointId).sort(),
    [unit2.id, unit3.id].sort()
  );
});

// ---------------------------------------------------------------------
// wouldQualifyAtNextInspection — read-only preview, awards nothing.
// ---------------------------------------------------------------------

test('wouldQualifyAtNextInspection: true once every currently-required checkpoint is complete, false otherwise, and never writes anything', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const cp = addCheckpoint(classroom, { title: 'Unit 1' });
  assert.equal(notebookReadinessChampionService.wouldQualifyAtNextInspection(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id), false);

  submit(cp, student.id, '2026-09-25'); // late, but lateness is irrelevant
  assert.equal(notebookReadinessChampionService.wouldQualifyAtNextInspection(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id), true);
  assert.equal(student.history.length, 0, 'a read-only preview -- never appends anything');
});

// ---------------------------------------------------------------------
// Legacy (old-model) read helpers — exercised here directly against
// OLD-shape history entries (never via the new inspection path), to
// confirm the "Previous system" display helpers still read pre-
// redesign data correctly and in complete isolation from the new
// per-inspection ledger. These entries are never produced by any live
// code path any more; they simulate data written before this redesign.
// ---------------------------------------------------------------------

test('countActiveReadinessChampionNotebooksForStudent / listLegacyReadinessChampionEntriesForNotebook: read OLD-shape history faithfully, never touching the new achievement count', () => {
  const { student } = buildClassroomWithStudent();
  const legacyRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: SUBJECT_ID, notebookTypeId: NOTEBOOK_TYPE_ID });
  student.history = [
    { id: 'legacy-1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef: legacyRef, recordedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'legacy-2', kind: 'readiness-champion', label: 'Readiness Champion Reversed', delta: -1, source: 'automatic', workItemRef: legacyRef, recordedAt: '2026-09-15T00:00:00.000Z', reason: 'notebook_incomplete' },
  ];

  assert.equal(notebookReadinessChampionService.countActiveReadinessChampionNotebooksForStudent(student), 0, 'net-zero under the old model -- the award and its own reversal cancel out');
  assert.equal(notebookReadinessChampionService.listLegacyReadinessChampionEntriesForNotebook(student, SUBJECT_ID, NOTEBOOK_TYPE_ID).length, 2, 'both historical records remain visible, undeduplicated, exactly as written');
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0, 'never merged into the new per-inspection total');
});

test('countActiveReadinessChampionNotebooksForStudent: a still-net-active legacy award (never reversed) counts 1 under the old model\'s own terms', () => {
  const { student } = buildClassroomWithStudent();
  const legacyRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: SUBJECT_ID, notebookTypeId: NOTEBOOK_TYPE_ID });
  student.history = [{ id: 'legacy-1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef: legacyRef, recordedAt: '2026-09-01T00:00:00.000Z' }];

  assert.equal(notebookReadinessChampionService.countActiveReadinessChampionNotebooksForStudent(student), 1);
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0, 'still never merged into the new total, even though it is net-active under the old model');
});

// ---------------------------------------------------------------------
// Legacy live lifecycle (evaluateReadinessChampionForNotebook / override
// / revoke / reevaluateReadinessChampionForAllStudents) — retained in
// services/notebookReadinessChampionService.js ONLY so the archived
// services/notebookReadinessChampionAuditService.js and
// services/legacyReadinessChampionMigrationService.js, and their own
// test fixtures, keep working unmodified; see that file's own "LEGACY
// (old model) live lifecycle" section header. No longer reachable from
// any UI (ui/views/NotebookCheckpointsView.js's own call sites are
// gone) and out of scope for this redesign's own coverage -- their
// behavior is unchanged from before and remains exercised indirectly by
// tests/services/notebookReadinessChampionAuditService.test.js and
// tests/services/legacyReadinessChampionMigrationService.test.js.
// ---------------------------------------------------------------------
