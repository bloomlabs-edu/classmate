import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, LESSON_PLAN_STATUS } from '../../js/models/LessonPlan.js';
import * as lessonPlanReviewService from '../../js/services/lessonPlanReviewService.js';

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
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });

  lessonPlanReviewService.requestChanges(plan, {
    byUid: 'pm-1',
    comments: [{ sectionKey: 'spark', text: 'Make the Student Action more observable.' }],
  });

  assert.equal(plan.status, LESSON_PLAN_STATUS.CHANGES_REQUESTED);
  assert.equal(plan.activeComments.length, 1);
  assert.equal(plan.activeComments[0].text, 'Make the Student Action more observable.');
  assert.equal(plan.reviewHistory.length, 2);
  assert.equal(plan.reviewHistory[1].status, LESSON_PLAN_STATUS.CHANGES_REQUESTED);
  assert.equal(plan.reviewHistory[1].comments.length, 1);
  assert.equal(plan.reviewHistory[1].comments[0].text, 'Make the Student Action more observable.');
});

test('requestChanges: throws when called with zero comments — a bare status flip leaves the teacher nothing to act on', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  assert.throws(() => lessonPlanReviewService.requestChanges(plan, { byUid: 'pm-1', comments: [] }));
});

test('resubmit (submitForReview from CHANGES_REQUESTED): clears activeComments for the fresh round, but the PRIOR round\'s comments stay exactly as they were in reviewHistory — never silently overwritten', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  lessonPlanReviewService.requestChanges(plan, { byUid: 'pm-1', comments: [{ sectionKey: 'finalQuestion', text: 'Strengthen the reasoning required.' }] });

  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' }); // resubmit

  assert.equal(plan.status, LESSON_PLAN_STATUS.SUBMITTED);
  assert.equal(plan.activeComments.length, 0);
  assert.equal(plan.reviewHistory.length, 3);
  // The changes_requested round (index 1) is untouched by the resubmit.
  assert.equal(plan.reviewHistory[1].status, LESSON_PLAN_STATUS.CHANGES_REQUESTED);
  assert.equal(plan.reviewHistory[1].comments[0].text, 'Strengthen the reasoning required.');
  assert.equal(plan.reviewHistory[2].status, LESSON_PLAN_STATUS.SUBMITTED);
});

test('approve: SUBMITTED -> APPROVED, appends a round, clears any lingering activeComments', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanReviewService.submitForReview(plan, { byUid: 'teacher-1' });
  lessonPlanReviewService.approve(plan, { byUid: 'pm-1' });
  assert.equal(plan.status, LESSON_PLAN_STATUS.APPROVED);
  assert.equal(plan.reviewHistory.length, 2);
  assert.equal(plan.reviewHistory[1].status, LESSON_PLAN_STATUS.APPROVED);
  assert.deepEqual(plan.activeComments, []);
});

test('approve: throws when called on a DRAFT plan — must be SUBMITTED first', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  assert.throws(() => lessonPlanReviewService.approve(plan, { byUid: 'pm-1' }));
});

test('buildActivitySectionKey: a stable, single string format for addressing one Activity\'s own comments', () => {
  assert.equal(lessonPlanReviewService.buildActivitySectionKey('abc123'), 'activity:abc123');
});
