import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeeklyPlanSubmission, WEEKLY_PLAN_SUBMISSION_STATUS } from '../../js/models/WeeklyPlanSubmission.js';
import { createLesson } from '../../js/models/Lesson.js';
import { MEMBER_ROLES } from '../../js/config/memberRoles.js';
import {
  submitWeeklyPlan,
  requestWeeklyPlanChanges,
  approveWeeklyPlan,
  canReviewWeeklyPlanSubmission,
  canApproveWeeklyPlanSubmission,
  getWeeklyPlanSubmissionLabel,
  getWeekPlanDisplayStatus,
  WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED,
} from '../../js/services/weeklyPlanSubmissionService.js';

const FELLOW = 'fellow-uid';
const PM = 'pm-uid';
const OTHER_TEACHER = 'other-teacher-uid';

function buildClassroom() {
  return {
    id: 'classroom-1',
    memberUids: [FELLOW, PM, OTHER_TEACHER],
    members: {
      [FELLOW]: { role: MEMBER_ROLES.TEACHER },
      [PM]: { role: MEMBER_ROLES.PROGRAM_MANAGER },
      [OTHER_TEACHER]: { role: MEMBER_ROLES.TEACHER },
    },
  };
}

test('submitWeeklyPlan: no existing submission -> creates a new one directly in SUBMITTED', () => {
  const submission = submitWeeklyPlan(null, { classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', byUid: FELLOW });
  assert.equal(submission.status, WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED);
  assert.ok(submission.submittedAt);
});

test('submitWeeklyPlan: DRAFT -> SUBMITTED', () => {
  const draft = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT });
  const submitted = submitWeeklyPlan(draft, { classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', byUid: FELLOW });
  assert.equal(submitted.status, WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED);
});

test('submitWeeklyPlan: CHANGES_REQUESTED -> SUBMITTED (resubmit)', () => {
  const changesRequested = createWeeklyPlanSubmission({
    classroomId: 'classroom-1',
    teacherUid: FELLOW,
    weekStartDate: '2026-09-28',
    status: WEEKLY_PLAN_SUBMISSION_STATUS.CHANGES_REQUESTED,
    hadChangesRequested: true,
  });
  const resubmitted = submitWeeklyPlan(changesRequested, { classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', byUid: FELLOW });
  assert.equal(resubmitted.status, WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED);
  assert.equal(getWeeklyPlanSubmissionLabel(resubmitted), 'Resubmitted');
});

test('submitWeeklyPlan: cannot submit an already-SUBMITTED or APPROVED plan', () => {
  const submitted = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  assert.throws(() => submitWeeklyPlan(submitted, { classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', byUid: FELLOW }));

  const approved = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.APPROVED });
  assert.throws(() => submitWeeklyPlan(approved, { classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', byUid: FELLOW }));
});

test('requestWeeklyPlanChanges: a co-teacher (not the author) can request changes on a SUBMITTED plan', () => {
  const classroom = buildClassroom();
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  const updated = requestWeeklyPlanChanges(classroom, submission, { byUid: OTHER_TEACHER });
  assert.equal(updated.status, WEEKLY_PLAN_SUBMISSION_STATUS.CHANGES_REQUESTED);
  assert.equal(updated.hadChangesRequested, true);
  assert.equal(updated.reviewerUid, OTHER_TEACHER);
});

test('requestWeeklyPlanChanges: a Program Manager can request changes too', () => {
  const classroom = buildClassroom();
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  const updated = requestWeeklyPlanChanges(classroom, submission, { byUid: PM });
  assert.equal(updated.status, WEEKLY_PLAN_SUBMISSION_STATUS.CHANGES_REQUESTED);
});

test('reviewer cannot be the author — the Fellow cannot request changes on their own plan', () => {
  const classroom = buildClassroom();
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  assert.equal(canReviewWeeklyPlanSubmission(classroom, submission, FELLOW), false);
  assert.throws(() => requestWeeklyPlanChanges(classroom, submission, { byUid: FELLOW }));
});

test('teacher cannot approve — a co-teacher without APPROVE_WEEKLY_PLAN scope is rejected (VIEWER has no permission at all)', () => {
  const classroom = buildClassroom();
  classroom.members['viewer-uid'] = { role: MEMBER_ROLES.VIEWER };
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  assert.equal(canApproveWeeklyPlanSubmission(classroom, submission, 'viewer-uid'), false);
  assert.throws(() => approveWeeklyPlan(classroom, submission, { byUid: 'viewer-uid' }));
});

test('the Fellow can never approve their own submission', () => {
  const classroom = buildClassroom();
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  assert.equal(canApproveWeeklyPlanSubmission(classroom, submission, FELLOW), false);
  assert.throws(() => approveWeeklyPlan(classroom, submission, { byUid: FELLOW }));
});

test('approveWeeklyPlan: a Program Manager can approve a SUBMITTED plan', () => {
  const classroom = buildClassroom();
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  const updated = approveWeeklyPlan(classroom, submission, { byUid: PM });
  assert.equal(updated.status, WEEKLY_PLAN_SUBMISSION_STATUS.APPROVED);
  assert.equal(updated.reviewerUid, PM);
});

test('an unauthorized outsider cannot review or approve', () => {
  const classroom = buildClassroom();
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  assert.equal(canReviewWeeklyPlanSubmission(classroom, submission, 'outsider-uid'), false);
  assert.equal(canApproveWeeklyPlanSubmission(classroom, submission, 'outsider-uid'), false);
});

// ---------------------------------------------------------------------
// getWeekPlanDisplayStatus — Not started / Draft derivation
// ---------------------------------------------------------------------

test('getWeekPlanDisplayStatus: no submission, no lesson content anywhere -> NOT_STARTED', () => {
  const lessons = [createLesson({ classroomId: 'classroom-1' }), createLesson({ classroomId: 'classroom-1' })];
  assert.equal(getWeekPlanDisplayStatus(null, lessons), WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED);
});

test('getWeekPlanDisplayStatus: no submission, but one lesson has content -> DRAFT', () => {
  const lessons = [createLesson({ classroomId: 'classroom-1' }), createLesson({ classroomId: 'classroom-1', bigQuestion: 'Why?' })];
  assert.equal(getWeekPlanDisplayStatus(null, lessons), WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT);
});

test('getWeekPlanDisplayStatus: a real submission document always wins, verbatim, regardless of lesson content', () => {
  const submitted = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  assert.equal(getWeekPlanDisplayStatus(submitted, []), WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED);

  const approved = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.APPROVED });
  assert.equal(getWeekPlanDisplayStatus(approved, []), WEEKLY_PLAN_SUBMISSION_STATUS.APPROVED);
});

// ---------------------------------------------------------------------
// Weekly Plan submission is independent of the detailed LessonPlan
// ---------------------------------------------------------------------

test('a Weekly Plan can be submitted even when no period that week has a detailed LessonPlan (lessonPlanId is null everywhere)', () => {
  const lessons = [
    createLesson({ classroomId: 'classroom-1', bigQuestion: 'Why?', lessonPlanId: null }),
    createLesson({ classroomId: 'classroom-1', planSummary: 'Group work.', lessonPlanId: null }),
  ];
  assert.equal(getWeekPlanDisplayStatus(null, lessons), WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT);
  const submission = submitWeeklyPlan(null, { classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', byUid: FELLOW });
  assert.equal(submission.status, WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED);
});

test('adding or removing a detailed LessonPlan reference on a Lesson does not change the WeeklyPlanSubmission status', () => {
  const submission = createWeeklyPlanSubmission({ classroomId: 'classroom-1', teacherUid: FELLOW, weekStartDate: '2026-09-28', status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED });
  const lessonsWithoutPlan = [createLesson({ classroomId: 'classroom-1', bigQuestion: 'Why?', lessonPlanId: null })];
  const lessonsWithPlan = [createLesson({ classroomId: 'classroom-1', bigQuestion: 'Why?', lessonPlanId: 'lp-1' })];
  assert.equal(getWeekPlanDisplayStatus(submission, lessonsWithoutPlan), WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED);
  assert.equal(getWeekPlanDisplayStatus(submission, lessonsWithPlan), WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED);
});
