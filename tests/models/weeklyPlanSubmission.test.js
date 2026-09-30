import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeeklyPlanSubmission, buildWeeklyPlanSubmissionId, WEEKLY_PLAN_SUBMISSION_STATUS } from '../../js/models/WeeklyPlanSubmission.js';
import { LESSON_PLAN_STATUS } from '../../js/models/LessonPlan.js';

test('buildWeeklyPlanSubmissionId is deterministic — same inputs always produce the same id', () => {
  const id1 = buildWeeklyPlanSubmissionId('classroom-1', 'teacher-1', '2026-09-28');
  const id2 = buildWeeklyPlanSubmissionId('classroom-1', 'teacher-1', '2026-09-28');
  assert.equal(id1, id2);
  assert.equal(id1, 'classroom-1_teacher-1_2026-09-28');
});

test('buildWeeklyPlanSubmissionId differs for a different classroom, teacher, or week', () => {
  const base = buildWeeklyPlanSubmissionId('classroom-1', 'teacher-1', '2026-09-28');
  assert.notEqual(buildWeeklyPlanSubmissionId('classroom-2', 'teacher-1', '2026-09-28'), base);
  assert.notEqual(buildWeeklyPlanSubmissionId('classroom-1', 'teacher-2', '2026-09-28'), base);
  assert.notEqual(buildWeeklyPlanSubmissionId('classroom-1', 'teacher-1', '2026-10-05'), base);
});

test('createWeeklyPlanSubmission defaults to draft, no reviewer, no review comments/history fields at all', () => {
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: 'teacher-1', weekStartDate: '2026-09-28' });
  assert.equal(submission.status, WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT);
  assert.equal(submission.createdByUid, 'teacher-1');
  assert.equal(submission.hadChangesRequested, false);
  assert.equal(submission.reviewerUid, null);
  assert.equal(submission.reviewedAt, null);
  assert.equal(submission.id, 'classroom-1_teacher-1_2026-09-28');
  assert.ok(!('activities' in submission));
  assert.ok(!('objectives' in submission));
  assert.ok(!('bigQuestion' in submission));
});

test('WEEKLY_PLAN_SUBMISSION_STATUS is a genuinely separate enum object from LESSON_PLAN_STATUS', () => {
  assert.notEqual(WEEKLY_PLAN_SUBMISSION_STATUS, LESSON_PLAN_STATUS);
  // Values happen to read the same today — that's a coincidence of vocabulary, not a shared object.
  assert.equal(WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT, LESSON_PLAN_STATUS.DRAFT);
});
