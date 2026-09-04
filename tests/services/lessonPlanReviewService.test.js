import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, LESSON_PLAN_STATUS } from '../../js/models/LessonPlan.js';
import * as lessonPlanReviewService from '../../js/services/lessonPlanReviewService.js';

// A minimal, real-shaped classroom fixture — same `members`/`memberUids`
// shape services/memberService.js/permissionService.js already read
// elsewhere in this app, not a special test-only shape.
function makeClassroom({ members = {} } = {}) {
  return {
    id: 'c1',
    members,
    memberUids: Object.keys(members),
  };
}

const TWO_TEACHER_CLASSROOM = makeClassroom({
  members: {
    'teacher-1': { role: 'teacher', displayName: 'Teacher One' },
    'pm-1': { role: 'teacher', displayName: 'Reviewer PM' },
  },
});

test('submitForReview: DRAFT -> SUBMITTED, appends one review-history round', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1', reviewerUid: 'pm-1' });
  assert.equal(plan.status, LESSON_PLAN_STATUS.SUBMITTED);
  assert.equal(plan.reviewerUid, 'pm-1');
  assert.equal(plan.reviewHistory.length, 1);
  assert.equal(plan.reviewHistory[0].status, LESSON_PLAN_STATUS.SUBMITTED);
  assert.equal(plan.reviewHistory[0].byUid, 'teacher-1');
});

test('submitForReview: throws on an invalid transition (e.g. already APPROVED) rather than silently doing something ambiguous', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  plan.status = LESSON_PLAN_STATUS.APPROVED;
  assert.throws(() => lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' }));
});

test('requestChanges: SUBMITTED -> CHANGES_REQUESTED, comments become BOTH open (activeComments) and frozen into this round\'s own history', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });

  lessonPlanReviewService.requestChanges(TWO_TEACHER_CLASSROOM, plan, {
    byUid: 'pm-1',
    comments: [{ sectionKey: 'spark', text: 'Make the Student Action more observable.' }],
  });

  assert.equal(plan.status, LESSON_PLAN_STATUS.CHANGES_REQUESTED);
  assert.equal(plan.reviewerUid, 'pm-1');
  assert.equal(plan.activeComments.length, 1);
  assert.equal(plan.activeComments[0].text, 'Make the Student Action more observable.');
  assert.equal(plan.reviewHistory.length, 2);
  assert.equal(plan.reviewHistory[1].status, LESSON_PLAN_STATUS.CHANGES_REQUESTED);
  assert.equal(plan.reviewHistory[1].comments.length, 1);
  assert.equal(plan.reviewHistory[1].comments[0].text, 'Make the Student Action more observable.');
});

test('requestChanges: throws when called with zero comments — a bare status flip leaves the teacher nothing to act on', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.throws(() => lessonPlanReviewService.requestChanges(TWO_TEACHER_CLASSROOM, plan, { byUid: 'pm-1', comments: [] }));
});

test('resubmit (submitForReview from CHANGES_REQUESTED): clears activeComments for the fresh round, but the PRIOR round\'s comments stay exactly as they were in reviewHistory — never silently overwritten', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  lessonPlanReviewService.requestChanges(TWO_TEACHER_CLASSROOM, plan, { byUid: 'pm-1', comments: [{ sectionKey: 'finalQuestion', text: 'Strengthen the reasoning required.' }] });

  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' }); // resubmit

  assert.equal(plan.status, LESSON_PLAN_STATUS.SUBMITTED);
  assert.equal(plan.activeComments.length, 0);
  assert.equal(plan.reviewHistory.length, 3);
  // The changes_requested round (index 1) is untouched by the resubmit.
  assert.equal(plan.reviewHistory[1].status, LESSON_PLAN_STATUS.CHANGES_REQUESTED);
  assert.equal(plan.reviewHistory[1].comments[0].text, 'Strengthen the reasoning required.');
  assert.equal(plan.reviewHistory[2].status, LESSON_PLAN_STATUS.SUBMITTED);
});

test('approve: SUBMITTED -> APPROVED, appends a round, records the reviewer, clears any lingering activeComments', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  lessonPlanReviewService.approve(TWO_TEACHER_CLASSROOM, plan, { byUid: 'pm-1' });
  assert.equal(plan.status, LESSON_PLAN_STATUS.APPROVED);
  assert.equal(plan.reviewerUid, 'pm-1');
  assert.equal(plan.reviewHistory.length, 2);
  assert.equal(plan.reviewHistory[1].status, LESSON_PLAN_STATUS.APPROVED);
  assert.equal(plan.reviewHistory[1].byUid, 'pm-1');
  assert.deepEqual(plan.activeComments, []);
});

test('approve: an optional `comments` array (e.g. praise left while reading) freezes into the APPROVED round instead of being discarded', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  lessonPlanReviewService.approve(TWO_TEACHER_CLASSROOM, plan, {
    byUid: 'pm-1',
    comments: [{ sectionKey: 'finalQuestion', text: 'Good question — keep this.' }],
  });
  assert.equal(plan.reviewHistory[1].comments.length, 1);
  assert.equal(plan.reviewHistory[1].comments[0].text, 'Good question — keep this.');
  assert.deepEqual(plan.activeComments, []); // still frozen/closed, not left open on an approved plan
});

test('approve: throws when called on a DRAFT plan — must be SUBMITTED first', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  assert.throws(() => lessonPlanReviewService.approve(TWO_TEACHER_CLASSROOM, plan, { byUid: 'pm-1' }));
});

// ---------------------------------------------------------------------
// Phase 3 — authorization (PERSON + ROLE + SCOPE = PERMISSIONS)
// ---------------------------------------------------------------------

test('canReviewLessonPlan/canApproveLessonPlan: a same-classroom co-teacher, not the author, is authorized', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  assert.equal(lessonPlanReviewService.canReviewLessonPlan(TWO_TEACHER_CLASSROOM, plan, 'pm-1'), true);
  assert.equal(lessonPlanReviewService.canApproveLessonPlan(TWO_TEACHER_CLASSROOM, plan, 'pm-1'), true);
});

test('canReviewLessonPlan: the plan\'s own author is never authorized to review it, even though TEACHER has REVIEW_LESSON_PLAN', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  assert.equal(lessonPlanReviewService.canReviewLessonPlan(TWO_TEACHER_CLASSROOM, plan, 'teacher-1'), false);
  assert.equal(lessonPlanReviewService.canApproveLessonPlan(TWO_TEACHER_CLASSROOM, plan, 'teacher-1'), false);
});

test('canReviewLessonPlan: a person with no membership on this classroom at all is never authorized, regardless of role elsewhere', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  assert.equal(lessonPlanReviewService.canReviewLessonPlan(TWO_TEACHER_CLASSROOM, plan, 'stranger-uid'), false);
});

test('canReviewLessonPlan: a VIEWER-role classroom member (no REVIEW_LESSON_PLAN permission) is not authorized', () => {
  const classroom = makeClassroom({
    members: {
      'teacher-1': { role: 'teacher', displayName: 'Teacher One' },
      'viewer-1': { role: 'viewer', displayName: 'Viewer One' },
    },
  });
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  assert.equal(lessonPlanReviewService.canReviewLessonPlan(classroom, plan, 'viewer-1'), false);
});

test('requestChanges: throws for a cross-classroom "reviewer" (not a member of this classroom) even with valid comments', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.throws(() =>
    lessonPlanReviewService.requestChanges(TWO_TEACHER_CLASSROOM, plan, {
      byUid: 'outsider-uid',
      comments: [{ sectionKey: 'spark', text: 'Trying to review from outside the classroom.' }],
    })
  );
});

test('requestChanges: throws when the plan\'s own author tries to request changes on their own submission (self-review is never authorized)', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.throws(() =>
    lessonPlanReviewService.requestChanges(TWO_TEACHER_CLASSROOM, plan, {
      byUid: 'teacher-1',
      comments: [{ sectionKey: 'spark', text: 'Self-review attempt.' }],
    })
  );
});

test('approve: throws when the plan\'s own author tries to self-approve, even though TEACHER has APPROVE_LESSON_PLAN', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.throws(() => lessonPlanReviewService.approve(TWO_TEACHER_CLASSROOM, plan, { byUid: 'teacher-1' }));
});

test('approve: throws for a non-member trying to approve', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.throws(() => lessonPlanReviewService.approve(TWO_TEACHER_CLASSROOM, plan, { byUid: 'outsider-uid' }));
});

// ---------------------------------------------------------------------
// Section-key addressing (Phase 3: activity sub-fields, id extraction)
// ---------------------------------------------------------------------

test('buildActivitySectionKey: a stable, single string format for addressing one Activity\'s own comments', () => {
  assert.equal(lessonPlanReviewService.buildActivitySectionKey('abc123'), 'activity:abc123');
});

test('buildActivitySectionKey: an optional field targets a named sub-part of the activity (e.g. "Activity 2 / Green Bucket")', () => {
  assert.equal(lessonPlanReviewService.buildActivitySectionKey('abc123', 'studentAction'), 'activity:abc123:studentAction');
  assert.equal(lessonPlanReviewService.buildActivitySectionKey('abc123', 'differentiation.greenBucket'), 'activity:abc123:differentiation.greenBucket');
});

test('getActivityIdFromSectionKey: recovers the activityId from a whole-activity or sub-field key, and returns null for a named section key', () => {
  assert.equal(lessonPlanReviewService.getActivityIdFromSectionKey('activity:abc123'), 'abc123');
  assert.equal(lessonPlanReviewService.getActivityIdFromSectionKey('activity:abc123:studentAction'), 'abc123');
  assert.equal(lessonPlanReviewService.getActivityIdFromSectionKey('why'), null);
});

// ---------------------------------------------------------------------
// Editability + submission-vs-resubmission labeling
// ---------------------------------------------------------------------

test('isLessonPlanEditable: true only for DRAFT and CHANGES_REQUESTED, never SUBMITTED or APPROVED', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  assert.equal(lessonPlanReviewService.isLessonPlanEditable(plan), true);
  plan.status = LESSON_PLAN_STATUS.SUBMITTED;
  assert.equal(lessonPlanReviewService.isLessonPlanEditable(plan), false);
  plan.status = LESSON_PLAN_STATUS.CHANGES_REQUESTED;
  assert.equal(lessonPlanReviewService.isLessonPlanEditable(plan), true);
  plan.status = LESSON_PLAN_STATUS.APPROVED;
  assert.equal(lessonPlanReviewService.isLessonPlanEditable(plan), false);
});

// ---------------------------------------------------------------------
// Phase 3 hardening — every comment's round membership is decided at
// CREATION time and never retroactively reassigned when a later round
// closes (the exact bug: a resubmit's own closeCurrentRound() used to
// re-freeze whatever was still open into ITS OWN round's history, even
// though those comments were created — and already correctly recorded
// — during the PRIOR round).
// ---------------------------------------------------------------------

test('review-round comment association: a Round 1 comment stays Round 1 even after a Round 2 resubmission, and a new Round 2 comment is correctly its own', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });

  // Round 1: first submission.
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.equal(plan.reviewHistory.length, 1);
  assert.deepEqual(plan.reviewHistory[0].comments, []); // a submission never carries comments of its own

  // Round 2: reviewer requests changes with one comment.
  lessonPlanReviewService.requestChanges(TWO_TEACHER_CLASSROOM, plan, {
    byUid: 'pm-1',
    comments: [{ sectionKey: 'spark', text: 'Round 1 feedback: make the Spark punchier.' }],
  });
  assert.equal(plan.reviewHistory.length, 2);
  const round2 = plan.reviewHistory[1];
  assert.equal(round2.comments.length, 1);
  assert.equal(round2.comments[0].roundNumber, 2);
  const round2CommentId = round2.comments[0].id;

  // Teacher resubmits (Round 3) — the still-open Round 2 comment must be
  // resolved/cleared from activeComments, but Round 3's OWN history entry
  // must carry NO comments (it never created any) — this is the exact
  // fix: it must not re-freeze Round 2's comment as if Round 3 owned it.
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.equal(plan.reviewHistory.length, 3);
  const round3 = plan.reviewHistory[2];
  assert.equal(round3.status, LESSON_PLAN_STATUS.SUBMITTED);
  assert.deepEqual(round3.comments, []); // <-- the actual regression: this used to contain Round 2's comment

  // Round 2's own history entry is untouched — same comment, same round number, unchanged.
  assert.equal(plan.reviewHistory[1].comments.length, 1);
  assert.equal(plan.reviewHistory[1].comments[0].id, round2CommentId);
  assert.equal(plan.reviewHistory[1].comments[0].roundNumber, 2);
  assert.equal(plan.reviewHistory[1].comments[0].text, 'Round 1 feedback: make the Spark punchier.');

  // Round 4: reviewer requests changes AGAIN, with a NEW comment — this one must be tagged Round 4, never merged with Round 2's.
  lessonPlanReviewService.requestChanges(TWO_TEACHER_CLASSROOM, plan, {
    byUid: 'pm-1',
    comments: [{ sectionKey: 'finalQuestion', text: 'Round 2 feedback: sharpen the final question.' }],
  });
  assert.equal(plan.reviewHistory.length, 4);
  const round4 = plan.reviewHistory[3];
  assert.equal(round4.comments.length, 1);
  assert.equal(round4.comments[0].roundNumber, 4);
  assert.notEqual(round4.comments[0].id, round2CommentId);

  // Round 2's history is STILL untouched after this second round of feedback.
  assert.equal(plan.reviewHistory[1].comments.length, 1);
  assert.equal(plan.reviewHistory[1].comments[0].id, round2CommentId);

  // Teacher resubmits again (Round 5), then reviewer approves (Round 6) — approval preserves BOTH prior comment histories untouched.
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.deepEqual(plan.reviewHistory[4].comments, []);
  lessonPlanReviewService.approve(TWO_TEACHER_CLASSROOM, plan, { byUid: 'pm-1' });

  assert.equal(plan.reviewHistory.length, 6);
  assert.equal(plan.reviewHistory[5].status, LESSON_PLAN_STATUS.APPROVED);
  assert.deepEqual(plan.reviewHistory[5].comments, []); // approval itself added no comments here
  // Round 2 (index 1) and Round 4 (index 3) both survive, fully intact, after approval.
  assert.equal(plan.reviewHistory[1].comments[0].text, 'Round 1 feedback: make the Spark punchier.');
  assert.equal(plan.reviewHistory[1].comments[0].roundNumber, 2);
  assert.equal(plan.reviewHistory[3].comments[0].text, 'Round 2 feedback: sharpen the final question.');
  assert.equal(plan.reviewHistory[3].comments[0].roundNumber, 4);
  // And nothing is left dangling as "still open."
  assert.deepEqual(plan.activeComments, []);
});

test('getSubmissionLabel: "Submitted" for a first-time submission, "Resubmitted" once any round has requested changes', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'teacher-1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.equal(lessonPlanReviewService.getSubmissionLabel(plan), 'Submitted');

  lessonPlanReviewService.requestChanges(TWO_TEACHER_CLASSROOM, plan, { byUid: 'pm-1', comments: [{ sectionKey: 'spark', text: 'Needs work.' }] });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.equal(lessonPlanReviewService.getSubmissionLabel(plan), 'Resubmitted');
});
