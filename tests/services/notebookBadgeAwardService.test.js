/**
 * tests/services/notebookBadgeAwardService.test.js
 *
 * Full coverage for what remains of the Notebook Tracker badge-AWARDING
 * workflow in this file after the notebook-level Readiness Champion
 * redesign (2026-11-06) moved that badge out entirely:
 *   - Organization/Punctuation Champion only ever awardable once a
 *     review is genuinely 'complete' — never merely 'submitted'.
 *   - Duplicate-prevention per (student, badge type, submission).
 *   - OWNER/TEACHER-only permission enforcement.
 *   - The generic hasActiveBadgeAward()/listBadgeAwardsForRecord()
 *     read helpers, now used by Organization/Punctuation Champion only.
 *
 * Readiness Champion's own tests (automatic on/before-due-date rule,
 * teacher override/revocation, withdrawal reevaluation, duplicate
 * prevention) now live in
 * tests/services/notebookReadinessChampionService.test.js, rewritten
 * against the notebook-level API — see that file and
 * services/notebookReadinessChampionService.js's own header comment for
 * why this moved.
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

test('REGRESSION: awardReviewCompletionBadge (manual Organization/Punctuation) still works, unaffected by the Readiness Champion notebook-level redesign', () => {
  const { classroom, checkpoint, student } = buildFixture();
  checkpointService.setSubmission(checkpoint, student.id, { status: 'submitted', submittedDate: '2026-09-05' });
  checkpointService.setReview(checkpoint, student.id, { status: 'complete', reviewedDate: '2026-09-06' });

  const count = notebookBadgeAwardService.awardReviewCompletionBadge(classroom, checkpoint, student, 'organization', TEACHER_UID);
  assert.equal(count, 1);
});

// ---------------------------------------------------------------------
// hasActiveBadgeAward / listBadgeAwardsForRecord — pure read helpers,
// generic (not Readiness-Champion-specific); exercised here with
// Organization/Punctuation-shaped fixtures since that is the only real
// badge family left that uses this record-scoped `badgeAwards` array.
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
  assert.equal(notebookBadgeAwardService.hasActiveBadgeAward(record, 'some-other-badge'), false);
});

test('listBadgeAwardsForRecord: returns only entries matching the given badge type, in insertion order', () => {
  const record = {
    badgeAwards: [
      { badgeTypeId: 'punctuation-champion', source: 'manual', revoked: true },
      { badgeTypeId: 'organization', source: 'manual', revoked: false },
      { badgeTypeId: 'punctuation-champion', source: 'manual', revoked: false },
    ],
  };
  const punctuation = notebookBadgeAwardService.listBadgeAwardsForRecord(record, 'punctuation-champion');
  assert.equal(punctuation.length, 2);
  assert.equal(punctuation[0].revoked, true);
  assert.equal(punctuation[1].revoked, false);
});
