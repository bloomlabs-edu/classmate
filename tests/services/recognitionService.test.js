/**
 * tests/services/recognitionService.test.js
 *
 * services/recognitionService.js — automatic completion-star
 * idempotency/reversal, manual star award + correction, multi-worksheet
 * isolation, and badge-award-with-work-item association.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as recognitionService from '../../js/services/recognitionService.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import { createStudent } from '../../js/models/Student.js';
import { createTeam } from '../../js/models/Team.js';
import { createClassroom } from '../../js/models/Classroom.js';
import { addMember } from '../../js/services/memberService.js';
import { MEMBER_ROLES } from '../../js/config/memberRoles.js';

const OWNER_UID = 'owner-uid';
const TEACHER_UID = 'teacher-uid';
const VIEWER_UID = 'viewer-uid';
const NON_MEMBER_UID = 'stranger-uid';

function freshClassroom() {
  const student = createStudent({ id: 'stu1', name: 'Ann' });
  const team = createTeam({ id: 'team1', name: 'Team A', students: [student] });
  return { id: 'c1', teams: [team], notebooks: {}, assignmentCheckpoints: [] };
}

const NOTEBOOK_WORK_ITEM = { subjectId: 'subj-eng', notebookTypeId: 'type-hw', dateKey: '2026-08-24' };

/**
 * A full, permission-aware classroom fixture (OWNER/TEACHER/VIEWER
 * members, matching canManageCompletionStar()'s own PERMISSIONS.AWARD_POINTS
 * gate) with one student actually inside classroom.teams[] — required
 * because, unlike notebookBadgeAwardService.js's functions, recognitionService.js's
 * wrappers resolve the real Student object themselves via
 * findStudentById(classroom, studentId), never take it as a direct param.
 */
function buildPermissionedClassroom() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  addMember(classroom, OWNER_UID, MEMBER_ROLES.OWNER, 'The Owner');
  addMember(classroom, TEACHER_UID, MEMBER_ROLES.TEACHER, 'A Teacher');
  addMember(classroom, VIEWER_UID, MEMBER_ROLES.VIEWER, 'A Viewer');
  const student = createStudent({ id: 'stu1', name: 'Ann' });
  const team = createTeam({ id: 'team1', name: 'Team A', students: [student] });
  classroom.teams = [team];
  return { classroom, student };
}

/** A real Notebook Checkpoint (services/checkpointService.js), via the same fixture shape notebookBadgeAwardService.test.js already established. */
function buildNotebookCheckpointFixture() {
  const { classroom, student } = buildPermissionedClassroom();
  const checkpoint = checkpointService.createNewCheckpoint(classroom, {
    subjectId: 'subj-1',
    notebookTypeId: 'type-1',
    title: 'Unit 2',
    givenDate: '2026-09-01',
    dueDate: '2026-09-10',
  });
  return { classroom, checkpoint, student };
}

/** An Assignment Checkpoint — a bare object matching assignmentCheckpointService.js's own record shape exactly, same minimal convention this test file already used before this correction. */
function buildAssignmentCheckpointFixture() {
  const { classroom, student } = buildPermissionedClassroom();
  const checkpoint = { id: 'cp-a', assignmentId: 'assign-1', dueDate: '2026-09-10', records: [] };
  return { classroom, checkpoint, student };
}

test('awardAutomaticCompletionStar: a fresh award adds exactly one +1 points entry', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  const entry = recognitionService.awardAutomaticCompletionStar(student, ref);

  assert.ok(entry);
  assert.equal(student.history.length, 1);
  assert.equal(student.history[0].kind, 'points');
  assert.equal(student.history[0].delta, 1);
  assert.equal(student.history[0].source, 'auto');
  assert.equal(student.score, 1);
});

test('awardAutomaticCompletionStar: calling it twice for the SAME work item is idempotent — no duplicate star', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  recognitionService.awardAutomaticCompletionStar(student, ref);
  const secondCall = recognitionService.awardAutomaticCompletionStar(student, ref);

  assert.equal(secondCall, null);
  assert.equal(student.history.length, 1);
  assert.equal(student.score, 1);
});

test('reverseAutomaticCompletionStar: reverses an active automatic star, net goes back to 0, history entry preserved (append-only)', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  recognitionService.awardAutomaticCompletionStar(student, ref);
  const reversal = recognitionService.reverseAutomaticCompletionStar(student, ref);

  assert.ok(reversal);
  assert.equal(student.history.length, 2); // award entry + reversal entry, nothing deleted
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, ref), 0);
  assert.equal(student.score, 0);
});

test('reverseAutomaticCompletionStar: reversing twice (or reversing something never awarded) is a no-op', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  const neverAwarded = recognitionService.reverseAutomaticCompletionStar(student, ref);
  assert.equal(neverAwarded, null);

  recognitionService.awardAutomaticCompletionStar(student, ref);
  recognitionService.reverseAutomaticCompletionStar(student, ref);
  const secondReversal = recognitionService.reverseAutomaticCompletionStar(student, ref);
  assert.equal(secondReversal, null);
  assert.equal(student.history.length, 2);
});

test('re-marking done after an undo awards a NEW automatic star (net resets to active)', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  recognitionService.awardAutomaticCompletionStar(student, ref);
  recognitionService.reverseAutomaticCompletionStar(student, ref);
  const reAwarded = recognitionService.awardAutomaticCompletionStar(student, ref);

  assert.ok(reAwarded);
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, ref), 1);
  assert.equal(student.history.length, 3);
});

test('two different worksheets (different dateKey) never conflate automatic stars', () => {
  const student = createStudent({ id: 's1' });
  const refDay1 = recognitionService.buildNotebookWorkItemRef({ ...NOTEBOOK_WORK_ITEM, dateKey: '2026-08-24' });
  const refDay2 = recognitionService.buildNotebookWorkItemRef({ ...NOTEBOOK_WORK_ITEM, dateKey: '2026-08-25' });

  recognitionService.awardAutomaticCompletionStar(student, refDay1);
  recognitionService.awardAutomaticCompletionStar(student, refDay2);

  assert.equal(student.score, 2);
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, refDay1), 1);
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, refDay2), 1);

  // Reversing ONE worksheet's star never touches the other's.
  recognitionService.reverseAutomaticCompletionStar(student, refDay1);
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, refDay1), 0);
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, refDay2), 1);
  assert.equal(student.score, 1);
});

test('two different notebook TYPES on the same date never conflate automatic stars', () => {
  const student = createStudent({ id: 's1' });
  const refMath = recognitionService.buildNotebookWorkItemRef({ subjectId: 'subj-math', notebookTypeId: 'type-hw', dateKey: '2026-08-24' });
  const refEnglish = recognitionService.buildNotebookWorkItemRef({ subjectId: 'subj-eng', notebookTypeId: 'type-hw', dateKey: '2026-08-24' });

  recognitionService.awardAutomaticCompletionStar(student, refMath);
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, refEnglish), 0);
  assert.equal(student.score, 1);
});

test('an assignment checkpoint work item is never conflated with a notebook work item, even with overlapping field values', () => {
  const student = createStudent({ id: 's1' });
  const notebookRef = recognitionService.buildNotebookWorkItemRef({ subjectId: 'x', notebookTypeId: 'y', dateKey: 'z' });
  const checkpointRef = recognitionService.buildAssignmentCheckpointWorkItemRef({ assignmentId: 'x', checkpointId: 'y' });

  recognitionService.awardAutomaticCompletionStar(student, notebookRef);
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, checkpointRef), 0);
});

test('manual star award is never idempotency-guarded — a teacher may award several for the same work item', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  recognitionService.awardManualStar(student, { label: 'Great effort', workItemRef: ref });
  recognitionService.awardManualStar(student, { label: 'Great effort again', workItemRef: ref });

  assert.equal(student.history.filter((e) => e.source === 'manual').length, 2);
  assert.equal(student.score, 2);
});

test('undoManualStarAward: reverses exactly the targeted manual entry, preserving every other manual AND automatic star untouched', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  recognitionService.awardAutomaticCompletionStar(student, ref); // +1 auto
  const manual1 = recognitionService.awardManualStar(student, { label: 'Manual A', workItemRef: ref }); // +1 manual
  recognitionService.awardManualStar(student, { label: 'Manual B', workItemRef: ref }); // +1 manual

  assert.equal(student.score, 3);

  recognitionService.undoManualStarAward(student, manual1.id);

  assert.equal(student.score, 2); // only Manual A reversed
  assert.equal(recognitionService.getAutomaticStarNetForWorkItem(student, ref), 1); // automatic star untouched
  assert.ok(student.history.some((e) => e.label === 'Manual B')); // the other manual award untouched
});

test('undoManualStarAward: undoing the same award twice is a no-op', () => {
  const student = createStudent({ id: 's1' });
  const manual = recognitionService.awardManualStar(student, { label: 'Manual A' });

  const firstUndo = recognitionService.undoManualStarAward(student, manual.id);
  const secondUndo = recognitionService.undoManualStarAward(student, manual.id);

  assert.ok(firstUndo);
  assert.equal(secondUndo, null);
  assert.equal(student.score, 0);
});

test('undoManualStarAward: an unknown entry id, or an automatic entry\'s own id, is a no-op (never reverses the wrong kind of award)', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);
  const autoEntry = recognitionService.awardAutomaticCompletionStar(student, ref);

  assert.equal(recognitionService.undoManualStarAward(student, 'does-not-exist'), null);
  assert.equal(recognitionService.undoManualStarAward(student, autoEntry.id), null);
  assert.equal(student.score, 1);
});

test('awardBadgeForWorkItem: preserves the association between the award, the student, and the work item (via the timeline entry)', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  const awarded = recognitionService.awardBadgeForWorkItem(student, 'Helpful', { workItemRef: ref, commentId: 'comment-1' });

  assert.equal(awarded, true);
  assert.ok(student.badges.includes('Helpful'));
  const badgeEntry = student.history.find((e) => e.kind === 'badge');
  assert.deepEqual(badgeEntry.workItemRef, ref);
  assert.equal(badgeEntry.commentId, 'comment-1');
});

test('awardBadgeForWorkItem: still refuses a duplicate badge, exactly like badgeService.awardBadge()', () => {
  const student = createStudent({ id: 's1' });
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  recognitionService.awardBadgeForWorkItem(student, 'Helpful', { workItemRef: ref });
  const secondAward = recognitionService.awardBadgeForWorkItem(student, 'Helpful', { workItemRef: ref });

  assert.equal(secondAward, false);
  assert.equal(student.badges.filter((b) => b === 'Helpful').length, 1);
});

// ---------------------------------------------------------------------
// CORRECTED (WORK-0038): Completion Star is no longer earned on
// submission alone, for any system — see this file's own "COMPLETION
// STAR ELIGIBILITY" header comment.
// ---------------------------------------------------------------------

test('recordNotebookSubmission (legacy, retired route): marking submitted never awards a star — this entry model has no review concept to gate on', () => {
  const classroom = freshClassroom();

  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'submitted' }, 'teacher-1');

  const student = classroom.teams[0].students[0];
  assert.equal(student.score, 0);
  assert.equal(student.history.length, 0);
});

test('recordNotebookSubmission (legacy, retired route): still correctly writes the submission entry itself, unaffected by the star correction', () => {
  const classroom = freshClassroom();

  const entry = recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'submitted' }, 'teacher-1');

  assert.equal(entry.submission, 'submitted');
});

// ---------------------------------------------------------------------
// recordNotebookCheckpointSubmission / recordNotebookCheckpointReview —
// the REAL Notebook Checkpoints system (services/checkpointService.js),
// the one ui/views/NotebookCheckpointsView.js actually uses. Full
// requirement matrix per WORK-0038.
// ---------------------------------------------------------------------

test('Notebook Checkpoints: submission alone (no review at all) never awards a star', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });

  assert.equal(student.score, 0);
  assert.equal(student.history.length, 0);
});

test('Notebook Checkpoints: REGRESSION (the original screenshot scenario) — Submitted + Incomplete never awards a star', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-06' }, TEACHER_UID);

  assert.equal(student.score, 0);
  assert.equal(student.history.length, 0);
});

test('Notebook Checkpoints: Submitted + Complete awards exactly one star', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);

  assert.equal(student.score, 1);
  assert.equal(student.history.filter((e) => e.source === 'auto').length, 1);
});

test('Notebook Checkpoints: a LATE submission still earns the star once marked Complete — Completion Star has no due-date rule', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture(); // dueDate: 2026-09-10

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-20' }); // late
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-21' }, TEACHER_UID);

  assert.equal(student.score, 1);
});

test('Notebook Checkpoints: editing an already-Complete record (re-saving Complete) is idempotent — never a double award', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID); // re-saved, unchanged

  assert.equal(student.score, 1);
  assert.equal(student.history.filter((e) => e.source === 'auto').length, 1);
});

test('Notebook Checkpoints: Complete -> Incomplete reverses the star', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-07' }, TEACHER_UID);

  assert.equal(student.score, 0);
  assert.equal(student.history.filter((e) => e.source === 'auto').length, 2); // award + reversal, both preserved
});

test('Notebook Checkpoints: re-completion (Complete -> Incomplete -> Complete again) correctly awards a fresh star', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-07' }, TEACHER_UID);
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-08' }, TEACHER_UID);

  assert.equal(student.score, 1);
  assert.equal(student.history.filter((e) => e.source === 'auto').length, 3); // award, reversal, fresh award
});

test('Notebook Checkpoints: withdrawing a submission that was already Complete reverses the star, even though withdrawal never calls setReview() directly', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  assert.equal(student.score, 1);

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'not_submitted' }); // withdrawal

  assert.equal(student.score, 0);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(record.reviewStatus, 'not_reviewed'); // confirms setSubmission() really did silently reset it
  const reversal = student.history.find((e) => e.reason === 'submission_withdrawn');
  assert.ok(reversal);
  assert.equal(reversal.delta, -1);
});

test('Notebook Checkpoints: withdrawing a submission that was NOT Complete (e.g. never reviewed) never fabricates a reversal', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'not_submitted' });

  assert.equal(student.score, 0);
  assert.equal(student.history.length, 0);
});

test('Notebook Checkpoints: duplicate-award prevention across repeated Review-Complete calls without any Incomplete in between', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  for (let i = 0; i < 3; i += 1) {
    recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  }

  assert.equal(student.score, 1);
  assert.equal(student.history.filter((e) => e.delta > 0).length, 1);
});

test('Notebook Checkpoints: duplicate-reversal prevention — repeated Incomplete calls never drive score negative', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  for (let i = 0; i < 3; i += 1) {
    recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-07' }, TEACHER_UID);
  }

  assert.equal(student.score, 0);
  assert.equal(student.history.filter((e) => e.delta < 0).length, 1);
});

test('Notebook Checkpoints: two different checkpoints on the same notebook never conflate their own Completion Stars', () => {
  const { classroom, student } = buildPermissionedClassroom();
  const checkpointA = checkpointService.createNewCheckpoint(classroom, { subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'Unit 1', dueDate: '2026-09-10' });
  const checkpointB = checkpointService.createNewCheckpoint(classroom, { subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'Unit 2', dueDate: '2026-09-17' });

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpointA, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpointA, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  assert.equal(student.score, 1);

  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpointB, student.id, { status: 'submitted', submittedDate: '2026-09-12' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpointB, student.id, { status: 'incomplete', reviewedDate: '2026-09-13' }, TEACHER_UID);
  assert.equal(student.score, 1); // Unit 2's incomplete never touches Unit 1's active star
});

test('Notebook Checkpoints: an unauthorized (VIEWER) acting uid silently skips the AUTOMATIC award — never throws, the review write itself must never be blocked', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });

  let threw = false;
  try {
    recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, VIEWER_UID);
  } catch {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(student.score, 0); // no star awarded
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(record.reviewStatus, 'complete'); // the review write itself still succeeded
});

test('Notebook Checkpoints: an unauthorized acting uid never blocks an automatic REVERSAL — reversals are data-integrity corrections, never gated', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  assert.equal(student.score, 1);

  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-07' }, VIEWER_UID);

  assert.equal(student.score, 0); // reversed despite the unauthorized uid
});

// ---------------------------------------------------------------------
// removeCompletionStar — explicit teacher removal (WORK-0038)
// ---------------------------------------------------------------------

test('removeCompletionStar: throws for an unauthorized (VIEWER) uid, star stays active', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });

  assert.throws(() => recognitionService.removeCompletionStar(classroom, student, ref, VIEWER_UID), /Not authorized/);
  assert.equal(student.score, 1);
});

test('removeCompletionStar: throws for a non-member uid', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });

  assert.throws(() => recognitionService.removeCompletionStar(classroom, student, ref, NON_MEMBER_UID), /Not authorized/);
});

test('removeCompletionStar: throws when there is no active star to remove', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });

  assert.throws(() => recognitionService.removeCompletionStar(classroom, student, ref, TEACHER_UID), /No active Completion Star/);
});

test('removeCompletionStar: OWNER/TEACHER can remove an active star, reversing the exact associated +1 point and preserving audit history', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });

  const entry = recognitionService.removeCompletionStar(classroom, student, ref, TEACHER_UID);

  assert.equal(student.score, 0);
  assert.equal(entry.delta, -1);
  assert.equal(entry.reason, 'teacher_removed');
  assert.equal(entry.removedBy, TEACHER_UID);
  assert.equal(entry.label, 'Completion Star Removed');
  // Both the original award and the removal are preserved — append-only, never deleted.
  assert.equal(student.history.length, 2);
  assert.equal(student.history[0].delta, 1);
  assert.equal(student.history[1].delta, -1);
});

test('removeCompletionStar: OWNER can also remove (not just TEACHER)', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });

  recognitionService.removeCompletionStar(classroom, student, ref, OWNER_UID);
  assert.equal(student.score, 0);
});

test('removeCompletionStar: after removal, a genuine re-completion can still earn a fresh star — removal never permanently blocks this work item', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });
  recognitionService.removeCompletionStar(classroom, student, ref, TEACHER_UID);

  // Teacher reconsiders / re-marks complete (e.g. toggled incomplete-then-complete, or directly re-saved).
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-07' }, TEACHER_UID);
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-08' }, TEACHER_UID);

  assert.equal(student.score, 1);
});

// ---------------------------------------------------------------------
// Assignment Checkpoints — exact mirror of the Notebook Checkpoints
// matrix above (recordAssignmentCheckpointSubmission/Review), same
// reasoning, same fixture shape as this file's own pre-existing
// convention.
// ---------------------------------------------------------------------

test('Assignment Checkpoints: submission alone never awards a star', () => {
  const { classroom, checkpoint, student } = buildAssignmentCheckpointFixture();

  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });

  assert.equal(student.score, 0);
});

test('Assignment Checkpoints: Submitted + Incomplete never awards a star', () => {
  const { classroom, checkpoint, student } = buildAssignmentCheckpointFixture();

  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-06' }, TEACHER_UID);

  assert.equal(student.score, 0);
});

test('Assignment Checkpoints: Submitted + Complete awards exactly one star, including when the submission was late', () => {
  const { classroom, checkpoint, student } = buildAssignmentCheckpointFixture(); // dueDate: 2026-09-10

  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-20' }); // late
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-21' }, TEACHER_UID);

  assert.equal(student.score, 1);
});

test('Assignment Checkpoints: Complete -> Incomplete reverses; re-completion awards a fresh star', () => {
  const { classroom, checkpoint, student } = buildAssignmentCheckpointFixture();

  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-07' }, TEACHER_UID);
  assert.equal(student.score, 0);
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-08' }, TEACHER_UID);
  assert.equal(student.score, 1);
});

test('Assignment Checkpoints: withdrawing a Complete submission reverses the star via the submission wrapper, independent per checkpoint', () => {
  const { classroom, student } = buildPermissionedClassroom();
  const checkpointA = { id: 'cp-a', assignmentId: 'assign-1', records: [] };
  const checkpointB = { id: 'cp-b', assignmentId: 'assign-1', records: [] };

  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpointA, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpointA, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpointB, student.id, { status: 'submitted', submittedDate: '2026-09-07' });
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpointB, student.id, { status: 'complete', reviewedDate: '2026-09-08' }, TEACHER_UID);
  assert.equal(student.score, 2);

  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpointA, student.id, { status: 'not_submitted' });
  assert.equal(student.score, 1); // only checkpoint A's star reversed
});

test('Assignment Checkpoints: removeCompletionStar enforces the same OWNER/TEACHER permission and ledger mechanics as Notebook Checkpoints', () => {
  const { classroom, checkpoint, student } = buildAssignmentCheckpointFixture();
  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  const ref = recognitionService.buildAssignmentCheckpointWorkItemRef({ assignmentId: checkpoint.assignmentId, checkpointId: checkpoint.id });

  assert.throws(() => recognitionService.removeCompletionStar(classroom, student, ref, VIEWER_UID), /Not authorized/);

  const entry = recognitionService.removeCompletionStar(classroom, student, ref, TEACHER_UID);
  assert.equal(student.score, 0);
  assert.equal(entry.reason, 'teacher_removed');
});

// ---------------------------------------------------------------------
// auditCompletionStarsForClassroom — read-only investigation of
// already-existing stars that are incorrect under the corrected rule.
// Never modifies anything it's given; every test here also asserts
// student.score/history are byte-for-byte unchanged after auditing.
// ---------------------------------------------------------------------

test('auditCompletionStarsForClassroom: a genuinely eligible, active Notebook Checkpoint star is never flagged', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  const historyBefore = JSON.stringify(student.history);

  const findings = recognitionService.auditCompletionStarsForClassroom(classroom);

  assert.equal(findings.length, 0);
  assert.equal(JSON.stringify(student.history), historyBefore); // untouched
  assert.equal(student.score, 1); // untouched
});

test('auditCompletionStarsForClassroom: flags an active star whose underlying review is no longer Complete (e.g. a pre-correction award produced under the old submission-triggered rule)', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  // Simulates exactly the OLD, now-corrected bug: a star exists in
  // history, but the real record's own reviewStatus was never actually
  // 'complete' — i.e. the submission-alone rule awarded it.
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });
  recognitionService.awardAutomaticCompletionStar(student, ref); // direct, bypassing the now-corrected wrapper on purpose

  const findings = recognitionService.auditCompletionStarsForClassroom(classroom);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].studentId, student.id);
  assert.deepEqual(findings[0].workItemRef, ref);
  assert.equal(student.score, 1); // audit never modifies — the incorrect star is still there, only reported
});

test('auditCompletionStarsForClassroom: a reversed (no longer active) star is never flagged, regardless of eligibility', () => {
  const { classroom, checkpoint, student } = buildNotebookCheckpointFixture();
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-07' }, TEACHER_UID);

  const findings = recognitionService.auditCompletionStarsForClassroom(classroom);
  assert.equal(findings.length, 0);
});

test('auditCompletionStarsForClassroom: every active legacy (retired) Notebook Register star is flagged — that system has no review concept to ever be eligible under', () => {
  const classroom = freshClassroom();
  const student = classroom.teams[0].students[0];
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);
  recognitionService.awardAutomaticCompletionStar(student, ref); // simulates a pre-correction award via the old recordNotebookSubmission()

  const findings = recognitionService.auditCompletionStarsForClassroom(classroom);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].studentId, 'stu1');
});

test('auditCompletionStarsForClassroom: a MANUAL star is never flagged — the audit only ever looks at source: "auto" entries', () => {
  const classroom = freshClassroom();
  const student = classroom.teams[0].students[0];
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);
  recognitionService.awardManualStar(student, { label: 'Great effort', workItemRef: ref });

  const findings = recognitionService.auditCompletionStarsForClassroom(classroom);
  assert.equal(findings.length, 0);
});

test('auditCompletionStarsForClassroom: an Assignment Checkpoint star whose checkpoint was since deleted is conservatively flagged, never assumed fine', () => {
  const { classroom, checkpoint, student } = buildAssignmentCheckpointFixture();
  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordAssignmentCheckpointReview(classroom, checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);
  classroom.assignmentCheckpoints = []; // the checkpoint itself is gone

  const findings = recognitionService.auditCompletionStarsForClassroom(classroom);
  assert.equal(findings.length, 1);
});

test('auditCompletionStarsForClassroom: scans every student across every team, not just the first', () => {
  const { classroom, checkpoint, student: studentA } = buildNotebookCheckpointFixture();
  const studentB = createStudent({ id: 'stu2', name: 'Bhavesh' });
  classroom.teams[0].students.push(studentB);

  checkpointService.setSubmission(checkpoint, studentA.id, { status: 'submitted', submittedDate: '2026-09-05' }); // never reviewed -> stays not_reviewed
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId, checkpointId: checkpoint.id });
  recognitionService.awardAutomaticCompletionStar(studentA, ref);
  recognitionService.recordNotebookCheckpointSubmission(classroom, checkpoint, studentB.id, { status: 'submitted', submittedDate: '2026-09-05' });
  recognitionService.recordNotebookCheckpointReview(classroom, checkpoint, studentB.id, { status: 'complete', reviewedDate: '2026-09-06' }, TEACHER_UID);

  const findings = recognitionService.auditCompletionStarsForClassroom(classroom);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].studentId, studentA.id); // only the incorrect one, studentB's genuine star is untouched
});
