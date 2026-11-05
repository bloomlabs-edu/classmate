/**
 * tests/services/notebookBadgeAwardService.test.js
 *
 * Full coverage for the Notebook Tracker badge-AWARDING workflow:
 *   - Organization/Punctuation Champion only ever awardable once a
 *     review is genuinely 'complete' — never merely 'submitted'.
 *   - Readiness Champion's automatic on/before-due-date rule, including
 *     the exact boundary (submittedDate === dueDate counts as on time).
 *   - Teacher override and revocation for Readiness Champion.
 *   - Duplicate-prevention per (student, badge type, submission).
 *   - OWNER/TEACHER-only permission enforcement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createStudent } from '../../js/models/Student.js';
import { addMember } from '../../js/services/memberService.js';
import { MEMBER_ROLES } from '../../js/config/memberRoles.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import * as notebookBadgeAwardService from '../../js/services/notebookBadgeAwardService.js';

const OWNER_UID = 'owner-uid';
const TEACHER_UID = 'teacher-uid';
const VIEWER_UID = 'viewer-uid';
const NON_MEMBER_UID = 'stranger-uid';

function buildFixture({ dueDate = '2026-09-10' } = {}) {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  addMember(classroom, OWNER_UID, MEMBER_ROLES.OWNER, 'The Owner');
  addMember(classroom, TEACHER_UID, MEMBER_ROLES.TEACHER, 'A Teacher');
  addMember(classroom, VIEWER_UID, MEMBER_ROLES.VIEWER, 'A Viewer');

  const checkpoint = checkpointService.createNewCheckpoint(classroom, {
    subjectId: 'subj-1',
    notebookTypeId: 'type-1',
    title: 'Unit 2',
    givenDate: '2026-09-01',
    dueDate,
  });
  const student = createStudent({ id: 's1', name: 'Anjali' });

  return { classroom, checkpoint, student };
}

// ---------------------------------------------------------------------
// Permission enforcement
// ---------------------------------------------------------------------

test('canAwardNotebookBadge: true for OWNER/TEACHER, false for VIEWER and non-members', () => {
  const { classroom } = buildFixture();
  assert.equal(notebookBadgeAwardService.canAwardNotebookBadge(classroom, OWNER_UID), true);
  assert.equal(notebookBadgeAwardService.canAwardNotebookBadge(classroom, TEACHER_UID), true);
  assert.equal(notebookBadgeAwardService.canAwardNotebookBadge(classroom, VIEWER_UID), false);
  assert.equal(notebookBadgeAwardService.canAwardNotebookBadge(classroom, NON_MEMBER_UID), false);
});

// ---------------------------------------------------------------------
// awardReviewCompletionBadge — Organization / Punctuation Champion
// ---------------------------------------------------------------------

test('awardReviewCompletionBadge: throws for a VIEWER — not authorized', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });

  assert.throws(() => notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', VIEWER_UID), /Not authorized/);
});

test('awardReviewCompletionBadge: throws for a non-member uid', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });

  assert.throws(() => notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', NON_MEMBER_UID), /Not authorized/);
});

test('awardReviewCompletionBadge: throws when the review has not been marked Complete (not_reviewed)', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  // reviewStatus stays 'not_reviewed'

  assert.throws(
    () => notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID),
    /review has been marked Complete/
  );
});

test('awardReviewCompletionBadge: throws when the review was marked Incomplete, not Complete — submission alone, or an incomplete review, is never enough', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'incomplete', reviewedDate: '2026-09-06' });

  assert.throws(
    () => notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID),
    /review has been marked Complete/
  );
});

test('awardReviewCompletionBadge: throws when there is no record at all for this student (nothing submitted or reviewed yet)', () => {
  const { classroom, checkpoint, student } = buildFixture();
  assert.throws(
    () => notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID),
    /review has been marked Complete/
  );
});

test('awardReviewCompletionBadge: throws for a badge type outside the review-completion family (e.g. readiness-champion)', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });

  assert.throws(
    () => notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'readiness-champion', TEACHER_UID),
    /not awarded through the review-completion flow/
  );
});

test('awardReviewCompletionBadge: succeeds once review is Complete — increments the displayed count and records a submission-scoped audit entry', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });

  const count = notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID);

  assert.equal(count, 1);
  assert.equal(student.notebookBadgeCounts.organization, 1);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(record.badgeAwards.length, 1);
  assert.equal(record.badgeAwards[0].badgeTypeId, 'organization');
  assert.equal(record.badgeAwards[0].source, 'manual');
  assert.equal(record.badgeAwards[0].awardedBy, TEACHER_UID);
  assert.ok(record.badgeAwards[0].awardedAt);
  assert.equal(record.badgeAwards[0].revoked, false);
});

test('awardReviewCompletionBadge: Organization and Punctuation Champion are independent — awarding one never awards or blocks the other', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });

  notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID);
  notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'punctuation-champion', TEACHER_UID);

  assert.equal(student.notebookBadgeCounts.organization, 1);
  assert.equal(student.notebookBadgeCounts['punctuation-champion'], 1);
});

test('awardReviewCompletionBadge: a second award of the SAME badge type for the SAME submission throws — duplicate prevention', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });
  notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID);

  assert.throws(
    () => notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID),
    /already been awarded/
  );
  assert.equal(student.notebookBadgeCounts.organization, 1); // unchanged
});

test('awardReviewCompletionBadge: duplicate prevention is per-student — a second student on the same checkpoint can still be awarded independently', () => {
  const { classroom, checkpoint } = buildFixture();
  const studentA = createStudent({ id: 's1', name: 'Anjali' });
  const studentB = createStudent({ id: 's2', name: 'Bhavesh' });
  [studentA, studentB].forEach((student) => {
    checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
    checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });
  });

  notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, studentA, 'organization', TEACHER_UID);
  const countB = notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, studentB, 'organization', TEACHER_UID);

  assert.equal(countB, 1);
  assert.equal(studentA.notebookBadgeCounts.organization, 1);
  assert.equal(studentB.notebookBadgeCounts.organization, 1);
});

// ---------------------------------------------------------------------
// evaluateReadinessChampion — automatic, submission-triggered
// ---------------------------------------------------------------------

test('evaluateReadinessChampion: nothing submitted yet — no-op, returns null, no count change', () => {
  const { classroom, checkpoint, student } = buildFixture();
  const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], undefined);
});

test('evaluateReadinessChampion: a checkpoint with no due date never auto-awards, regardless of submission date', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });

  const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], undefined);
});

test('evaluateReadinessChampion: submitted strictly BEFORE the due date — awarded', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });

  const count = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(count, 1);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('evaluateReadinessChampion: DATE BOUNDARY — submitted EXACTLY ON the due date — still awarded ("on or before")', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-10' });

  const count = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(count, 1);
});

test('evaluateReadinessChampion: DATE BOUNDARY — submitted one day AFTER the due date — never auto-awarded', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-11' });

  const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], undefined);
});

test('evaluateReadinessChampion: a review being marked Complete is NOT a trigger — this function only reacts to the submission, never to review state', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  // Submission walked back to not_submitted after being reviewed is not
  // representable (setSubmission resets review) — instead, confirm the
  // function itself never consults reviewStatus at all: a submitted-but-
  // unreviewed, on-time record is awarded exactly the same as a
  // submitted-and-reviewed one.
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(record.reviewStatus, 'not_reviewed');

  const count = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(count, 1);
});

test('evaluateReadinessChampion: calling it twice for the same on-time submission only ever awards once — duplicate prevention', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });

  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  const second = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(second, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('evaluateReadinessChampion: an unauthorized acting uid (VIEWER) silently skips the award — never throws, the submission itself must never be disrupted', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });

  let threw = false;
  let result;
  try {
    result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, VIEWER_UID);
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], undefined);
});

// ---------------------------------------------------------------------
// overrideReadinessChampion — teacher override
// ---------------------------------------------------------------------

test('overrideReadinessChampion: throws for an unauthorized uid', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-15' });
  assert.throws(() => notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, VIEWER_UID), /Not authorized/);
});

test('overrideReadinessChampion: throws when the student has not submitted at all', () => {
  const { classroom, checkpoint, student } = buildFixture();
  assert.throws(
    () => notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID),
    /has not submitted/
  );
});

test('overrideReadinessChampion: awards a LATE submission that the automatic rule would never grant', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-15' }); // late

  // Confirm the automatic path really does refuse this one first.
  assert.equal(notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID), null);

  const count = notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(count, 1);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const award = record.badgeAwards.find((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(award.source, 'override');
  assert.equal(award.awardedBy, TEACHER_UID);
});

test('overrideReadinessChampion: throws if an active award already exists (from either source) — never stacks a second one', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' }); // on time
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID); // auto-awarded

  assert.throws(
    () => notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID),
    /already been awarded/
  );
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

// ---------------------------------------------------------------------
// revokeReadinessChampion — teacher revocation
// ---------------------------------------------------------------------

test('revokeReadinessChampion: throws for an unauthorized uid', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.throws(() => notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, VIEWER_UID), /Not authorized/);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1); // untouched
});

test('revokeReadinessChampion: throws when there is no active award to revoke', () => {
  const { classroom, checkpoint, student } = buildFixture();
  assert.throws(
    () => notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, TEACHER_UID),
    /No active Readiness Champion award/
  );
});

test('revokeReadinessChampion: revokes an automatic award — marks the audit entry revoked in place and decrements the count', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  const count = notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, OWNER_UID);

  assert.equal(count, 0);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const entry = record.badgeAwards.find((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(entry.revoked, true);
  assert.equal(entry.revokedBy, OWNER_UID);
  assert.ok(entry.revokedAt);
  assert.equal(entry.revokedReason, 'teacher_revoked');
  // The original entry is preserved, not deleted.
  assert.equal(record.badgeAwards.length, 1);
});

test('revokeReadinessChampion: revokes an override award exactly the same way as an automatic one', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-15' }); // late
  notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
});

test('revokeReadinessChampion: calling it twice in a row throws the second time — nothing active left to revoke', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.throws(
    () => notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, TEACHER_UID),
    /No active Readiness Champion award/
  );
});

test('revokeReadinessChampion: after a revocation, the SAME submission can be correctly re-awarded via override — a revoked entry never blocks a later, correct award', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID); // mistakenly awarded
  notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, TEACHER_UID); // corrected

  const count = notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(count, 1);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const readinessEntries = record.badgeAwards.filter((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(readinessEntries.length, 2); // the original revoked entry, plus the new one
  assert.equal(readinessEntries[0].revoked, true);
  assert.equal(readinessEntries[1].revoked, false);
});

// ---------------------------------------------------------------------
// hasActiveBadgeAward / listBadgeAwardsForRecord — pure read helpers
// ---------------------------------------------------------------------

test('hasActiveBadgeAward: false for a record with no badgeAwards at all, or a null record', () => {
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(null, 'organization'), false);
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward({ badgeAwards: [] }, 'organization'), false);
});

test('hasActiveBadgeAward: true only when a non-revoked entry of that exact badge type exists', () => {
  const record = {
    badgeAwards: [
      { badgeTypeId: 'organization', revoked: false },
      { badgeTypeId: 'punctuation-champion', revoked: true },
    ],
  };
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'organization'), true);
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'punctuation-champion'), false);
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'readiness-champion'), false);
});

test('listBadgeAwardsForRecord: returns only entries matching the given badge type, in insertion order', () => {
  const record = {
    badgeAwards: [
      { badgeTypeId: 'readiness-champion', source: 'automatic', revoked: true },
      { badgeTypeId: 'organization', source: 'manual', revoked: false },
      { badgeTypeId: 'readiness-champion', source: 'override', revoked: false },
    ],
  };
  const readiness = notebookBadgeAwardService.listBadgeAwardsForRecord(record, 'readiness-champion');
  assert.equal(readiness.length, 2);
  assert.equal(readiness[0].source, 'automatic');
  assert.equal(readiness[1].source, 'override');
});

// ---------------------------------------------------------------------
// revokeReadinessChampionOnWithdrawal — automatic revocation when a
// submission is walked back from 'submitted' to 'not_submitted'.
// ---------------------------------------------------------------------

test('revokeReadinessChampionOnWithdrawal: revokes an active AUTOMATIC award, preserving the entry and recording the withdrawal reason', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  // The withdrawal itself — matches ui/views/NotebookCheckpointsView.js's
  // own onSaveCell handler: setSubmission() back to not_submitted, then
  // the revocation side effect.
  checkpointService.setSubmission(checkpoint, student.id, { status: 'not_submitted' });
  const count = notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(count, 0);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(record.badgeAwards.length, 1); // preserved, not deleted
  const entry = record.badgeAwards[0];
  assert.equal(entry.revoked, true);
  assert.equal(entry.revokedBy, TEACHER_UID);
  assert.ok(entry.revokedAt);
  assert.equal(entry.revokedReason, 'submission_withdrawn');
  assert.equal(entry.source, 'automatic'); // the original award's own source is untouched
});

test('revokeReadinessChampionOnWithdrawal: revokes an active OVERRIDE award exactly the same way — "cannot leave a stale award active" applies to overrides too', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-15' }); // late
  notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  checkpointService.setSubmission(checkpoint, student.id, { status: 'not_submitted' });
  notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const entry = record.badgeAwards.find((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(entry.revoked, true);
  assert.equal(entry.revokedReason, 'submission_withdrawn');
  assert.equal(entry.source, 'override');
});

test('revokeReadinessChampionOnWithdrawal: never touches Organization or Punctuation Champion', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });
  notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID);
  notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'punctuation-champion', TEACHER_UID);
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  checkpointService.setSubmission(checkpoint, student.id, { status: 'not_submitted' }); // this also resets reviewStatus — see checkpointService.setSubmission()
  notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(student.notebookBadgeCounts.organization, 1, 'Organization must survive a submission withdrawal untouched');
  assert.equal(student.notebookBadgeCounts['punctuation-champion'], 1, 'Punctuation Champion must survive a submission withdrawal untouched');
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'organization'), true);
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'punctuation-champion'), true);
});

test('revokeReadinessChampionOnWithdrawal: idempotent — calling it with nothing active is a safe no-op, never throws', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  // Never submitted at all.
  let threw = false;
  let result;
  try {
    result = notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result, null);
});

test('revokeReadinessChampionOnWithdrawal: calling it twice in a row (e.g. Submitted -> Not Submitted -> Submitted -> Not Submitted before the first ever persisted) never creates a second revocation entry', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);
  const second = notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(second, null); // idempotent: nothing active left the second time
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(record.badgeAwards.length, 1); // still only the one original entry, not a second revocation record
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0); // never decremented twice
});

test('revokeReadinessChampionOnWithdrawal: even an unauthorized/non-member acting uid still revokes — this is a data-integrity correction, never a discretionary award decision', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  checkpointService.setSubmission(checkpoint, student.id, { status: 'not_submitted' });
  const count = notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, VIEWER_UID);

  assert.equal(count, 0);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
});

// ---------------------------------------------------------------------
// Full withdraw -> resubmit cycles — the "no separate attempt identity"
// consequence this file's own header comment describes, confirmed
// end-to-end here.
// ---------------------------------------------------------------------

test('withdraw -> resubmit ON TIME again: the earlier (now-revoked) entry never blocks a fresh award, and exactly one active entry exists afterward', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  checkpointService.setSubmission(checkpoint, student.id, { status: 'not_submitted' });
  notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-08' }); // resubmitted, still on time
  const count = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(count, 1);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const readinessEntries = record.badgeAwards.filter((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(readinessEntries.length, 2); // the withdrawn one, plus the new one
  assert.equal(readinessEntries[0].revoked, true);
  assert.equal(readinessEntries[1].revoked, false);
});

test('withdraw -> resubmit LATE: a late resubmission does NOT retain the earlier on-time award — the automatic rule correctly refuses it', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' }); // on time
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  checkpointService.setSubmission(checkpoint, student.id, { status: 'not_submitted' });
  notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-20' }); // resubmitted LATE
  const count = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(count, null); // the automatic rule correctly refuses a late resubmission
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0); // not left at 1 from the withdrawn award
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'readiness-champion'), false);
});

test('withdraw -> resubmit LATE, but the teacher overrides anyway: override still works after a withdrawal, is not blocked by the earlier revoked entry', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  checkpointService.setSubmission(checkpoint, student.id, { status: 'not_submitted' });
  notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-20' }); // late resubmission
  const count = notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(count, 1);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('override -> withdraw -> override again: the second override is not blocked by the first (now-revoked-on-withdrawal) one', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-15' }); // late
  notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  checkpointService.setSubmission(checkpoint, student.id, { status: 'not_submitted' });
  notebookBadgeAwardService.revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, TEACHER_UID);

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-16' }); // late again
  const count = notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(count, 1);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const readinessEntries = record.badgeAwards.filter((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(readinessEntries.length, 2);
  assert.equal(readinessEntries.filter((e) => !e.revoked).length, 1); // exactly one active entry, never two
});

// ---------------------------------------------------------------------
// Existing manual award / override / explicit revocation workflows
// still work unchanged after this feature's own refactor
// (revokeActiveReadinessAward() shared internal helper).
// ---------------------------------------------------------------------

test('REGRESSION: explicit teacher revokeReadinessChampion() still works exactly as before, and sets revokedReason to teacher_revoked (not submission_withdrawn)', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  const count = notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(count, 0);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const entry = record.badgeAwards.find((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(entry.revokedReason, 'teacher_revoked');
});

test('REGRESSION: explicit revokeReadinessChampion() still throws for an unauthorized uid — unlike the automatic withdrawal path, this one IS gated', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.throws(() => notebookBadgeAwardService.revokeReadinessChampion(classroom, checkpoint, student, VIEWER_UID), /Not authorized/);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1); // untouched
});

test('REGRESSION: awardReviewCompletionBadge (manual Organization/Punctuation) still works, unaffected by the withdrawal feature', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });

  const count = notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID);
  assert.equal(count, 1);
});

test('REGRESSION: overrideReadinessChampion still throws if an active award already exists, unaffected by the shared revocation helper refactor', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.throws(
    () => notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID),
    /already been awarded/
  );
});

// ---------------------------------------------------------------------
// BUG FIX — a late resubmission/date-correction that never passes back
// through 'not_submitted' must not retain an earlier on-time automatic
// award. Root cause: checkpointService.setSubmission() overwrites
// submittedDate in place (no separate attempt identity), and
// evaluateReadinessChampion() previously short-circuited on
// hasActiveBadgeAward() alone on every re-evaluation, never
// re-validating whether the CURRENT submission still supports an
// already-active AUTOMATIC award. revokeReadinessChampionOnWithdrawal()
// alone cannot catch this because no withdrawal ever happens in this
// sequence — the record stays 'submitted' throughout, exactly what a
// teacher editing a submitted date (quick-mark-submitted run twice, or
// the detailed cell editor's date field changed without touching the
// status dropdown) produces in the real UI
// (ui/views/NotebookCheckpointsView.js's own onQuickMarkSubmitted/
// onSaveCell handlers).
// ---------------------------------------------------------------------

test('BUG REPRO / FIX: resubmitting LATE while remaining "submitted" throughout (no withdrawal step) revokes the earlier on-time AUTOMATIC award', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' }); // on time
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'sanity check: on-time submission was awarded');

  // Resubmission/correction — status never leaves 'submitted', so
  // revokeReadinessChampionOnWithdrawal() is never called by the real
  // UI here. This is the exact sequence that produced the deployed bug.
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-20' }); // now late
  const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0, 'the stale award must no longer be reflected in the displayed count');
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'readiness-champion'), false);
  const entry = record.badgeAwards.find((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(entry.revoked, true);
  assert.equal(entry.revokedReason, 'resubmitted_late');
  assert.equal(entry.source, 'automatic'); // the original award's own source is preserved, unchanged
  assert.equal(record.badgeAwards.length, 1, 'the original entry is mutated in place, never deleted or duplicated');
});

test('BUG FIX, boundary check: resubmitting to exactly the due date (still on time) keeps the automatic award active — never revokes a genuinely still-eligible submission', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-10' }); // corrected, still on time (boundary)
  const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(result, null); // no NEW award (one is already active) — but also not revoked
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'readiness-champion'), true);
});

test('BUG FIX: a teacher OVERRIDE award is never auto-revoked by re-evaluation, even when the current submittedDate is late — override is a deliberate, date-independent decision', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-15' }); // late
  notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);

  // Submission edited again, still late (a different late date) — the
  // override must survive re-evaluation.
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-18' });
  const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1, 'the override must NOT be revoked by automatic re-evaluation');
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const entry = record.badgeAwards.find((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(entry.revoked, false);
  assert.equal(entry.source, 'override');
});

test('BUG FIX: resubmitting with a missing submittedDate while remaining "submitted" revokes an active AUTOMATIC award — missing submission date is never eligible', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  // Simulate a corrupted/incomplete record directly (defends against any
  // caller that ever records 'submitted' without a real date, bypassing
  // the real UI's own <input type="date"> requirement).
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  record.submittedDate = null;

  const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  const entry = record.badgeAwards.find((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(entry.revoked, true);
  assert.equal(entry.revokedReason, 'submission_date_invalid');
});

test('BUG FIX: an INVALID (malformed, non-empty) submittedDate is treated identically to a missing one — never eligible, revokes a stale automatic award', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });

  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  record.submittedDate = '2026-09-05T10:00:00.000Z'; // a full ISO timestamp snuck in, not a date key

  const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  assert.equal(result, null);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 0);
  const entry = record.badgeAwards.find((e) => e.badgeTypeId === 'readiness-champion');
  assert.equal(entry.revoked, true);
  assert.equal(entry.revokedReason, 'submission_date_invalid');
});

test('BUG FIX: an INVALID (malformed, non-empty) checkpoint.dueDate never auto-awards and logs a diagnostic, but leaves an existing active award untouched', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);

  checkpoint.dueDate = '2026-13-40'; // corrupted after the fact
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const result = notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
    assert.equal(result, null);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warned, true, 'a malformed due date must surface a diagnostic, not fail silently');
  // Conservative: an existing award earned under what may have been a
  // genuine due date at the time is not blindly revoked just because the
  // due date is now unreadable.
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1);
});

test('BUG FIX: a MISSING checkpoint.dueDate (cleared, not malformed) never auto-awards and never logs a diagnostic — this is the routine, already-covered "no due date" case, not a data-corruption case', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);

  checkpoint.dueDate = '';
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warned, false);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], 1); // untouched
});

test('BUG FIX: an alternate award path (overrideReadinessChampion) is never reachable automatically — it always requires an explicit call with a real submission, and remains gated by canAwardNotebookBadge', () => {
  const { classroom, checkpoint, student } = buildFixture({ dueDate: '2026-09-10' });
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-20' }); // late

  // evaluateReadinessChampion() alone, however many times, never awards
  // or reaches the override path on its own.
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  notebookBadgeAwardService.evaluateReadinessChampion(classroom, checkpoint, student, TEACHER_UID);
  assert.equal(student.notebookBadgeCounts['readiness-champion'], undefined);

  assert.throws(
    () => notebookBadgeAwardService.overrideReadinessChampion(classroom, checkpoint, student, VIEWER_UID),
    /Not authorized/
  );
  assert.equal(student.notebookBadgeCounts['readiness-champion'], undefined);
});
