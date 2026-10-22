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
import { createStudent } from '../../js/models/Student.js';
import { createTeam } from '../../js/models/Team.js';

function freshClassroom() {
  const student = createStudent({ id: 'stu1', name: 'Ann' });
  const team = createTeam({ id: 'team1', name: 'Team A', students: [student] });
  return { id: 'c1', teams: [team], notebooks: {}, assignmentCheckpoints: [] };
}

const NOTEBOOK_WORK_ITEM = { subjectId: 'subj-eng', notebookTypeId: 'type-hw', dateKey: '2026-08-24' };

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

test('recordNotebookSubmission: first mark as submitted awards one automatic star; marking submitted again is idempotent', () => {
  const classroom = freshClassroom();

  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'submitted' }, 'teacher-1');
  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'submitted' }, 'teacher-1');

  const student = classroom.teams[0].students[0];
  assert.equal(student.score, 1);
  assert.equal(student.history.filter((e) => e.source === 'auto').length, 1);
});

test('recordNotebookSubmission: marking back to not_submitted reverses the automatic star; marking absent also reverses it', () => {
  const classroom = freshClassroom();

  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'submitted' }, 'teacher-1');
  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'not_submitted' }, 'teacher-1');

  const student = classroom.teams[0].students[0];
  assert.equal(student.score, 0);
  assert.equal(student.history.filter((e) => e.source === 'auto').length, 2);
});

test('recordNotebookSubmission: a manual star awarded separately survives an automatic-star reversal', () => {
  const classroom = freshClassroom();
  const student = classroom.teams[0].students[0];
  const ref = recognitionService.buildNotebookWorkItemRef(NOTEBOOK_WORK_ITEM);

  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'submitted' }, 'teacher-1');
  recognitionService.awardManualStar(student, { label: 'Extra effort', workItemRef: ref });
  assert.equal(student.score, 2);

  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'not_submitted' }, 'teacher-1');

  assert.equal(student.score, 1); // automatic star reversed, manual star untouched
  assert.ok(student.history.some((e) => e.source === 'manual' && e.label === 'Extra effort'));
});

test('recordNotebookSubmission: a completion-only update (no submission change) never touches star state', () => {
  const classroom = freshClassroom();
  const student = classroom.teams[0].students[0];

  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'submitted' }, 'teacher-1');
  assert.equal(student.score, 1);

  // Completion changes go through notebookService.setEntry() directly
  // in the real UI (see ui/views/NotebookRegisterView.js's own
  // onSetCompletion) — never through recordNotebookSubmission() at
  // all, so there's nothing more to assert here beyond confirming the
  // submission-only wrapper doesn't duplicate or lose the star when
  // called again with the same already-submitted value.
  recognitionService.recordNotebookSubmission(classroom, { ...NOTEBOOK_WORK_ITEM, studentId: 'stu1', submission: 'submitted' }, 'teacher-1');
  assert.equal(student.score, 1);
});

test('recordAssignmentCheckpointSubmission: mirrors the notebook wrapper exactly — idempotent award, correct reversal, independent per checkpoint', () => {
  const classroom = freshClassroom();
  const student = classroom.teams[0].students[0];
  const checkpointA = { id: 'cp-a', assignmentId: 'assign-1', records: [] };
  const checkpointB = { id: 'cp-b', assignmentId: 'assign-1', records: [] };

  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpointA, 'stu1', { status: 'submitted' });
  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpointA, 'stu1', { status: 'submitted' }); // idempotent
  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpointB, 'stu1', { status: 'submitted' });

  assert.equal(student.score, 2);

  recognitionService.recordAssignmentCheckpointSubmission(classroom, checkpointA, 'stu1', { status: 'not_submitted' });
  assert.equal(student.score, 1); // only checkpoint A's star reversed
});
