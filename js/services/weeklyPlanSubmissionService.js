/**
 * services/weeklyPlanSubmissionService.js
 *
 * The WeeklyPlanSubmission review lifecycle — deliberately the SAME
 * shape as services/lessonPlanReviewService.js's own DRAFT->SUBMITTED->
 * CHANGES_REQUESTED->SUBMITTED(resubmit)->APPROVED transitions, but a
 * separate implementation over a separate, lighter model
 * (models/WeeklyPlanSubmission.js) — no reviewHistory, no comments (see
 * that model's own header comment for why). Authorization uses its OWN
 * permission constants, PERMISSIONS.REVIEW_WEEKLY_PLAN/APPROVE_WEEKLY_PLAN
 * (config/memberRoles.js) — never REVIEW_LESSON_PLAN/APPROVE_LESSON_PLAN,
 * per explicit product direction that the two planning tiers' review
 * authority stay independently trackable even though every role today
 * happens to grant both together.
 *
 * Pure and Firestore-free, same convention as lessonPlanReviewService.js
 * itself — the actual Firestore write happens in whatever UI/service
 * calls these functions, via
 * repositories/weeklyPlanSubmissionRepository.js.
 */

import { WEEKLY_PLAN_SUBMISSION_STATUS, createWeeklyPlanSubmission } from '../models/WeeklyPlanSubmission.js';
import { hasMeaningfulWeeklyPlanContent } from './weeklyPlanValidationService.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { canPerformAsUid } from './permissionService.js';
import { PERMISSIONS } from '../config/memberRoles.js';

function assertStatus(submission, allowed, actionLabel) {
  if (!allowed.includes(submission.status)) {
    throw new Error(`Cannot ${actionLabel} a WeeklyPlanSubmission currently in status "${submission.status}".`);
  }
}

/** A reviewer is necessarily someone else, never the Fellow whose own week it is — same rule lessonPlanReviewService.js's isEligibleReviewer() enforces, applied to this separate model. */
function isEligibleReviewer(submission, uid) {
  return Boolean(uid) && uid !== submission.teacherUid;
}

/** Same-classroom-scoped: true only if `uid` is a member of THIS classroom AND isn't the Fellow this Weekly Plan belongs to. Uses REVIEW_WEEKLY_PLAN, never REVIEW_LESSON_PLAN. */
export function canReviewWeeklyPlanSubmission(classroom, submission, uid) {
  return isEligibleReviewer(submission, uid) && canPerformAsUid(classroom, uid, PERMISSIONS.REVIEW_WEEKLY_PLAN);
}

/** Same shape as canReviewWeeklyPlanSubmission(), for Approve — its own function (not an alias) so a future divergence needs no call-site changes, mirroring canApproveLessonPlan()'s own reasoning. */
export function canApproveWeeklyPlanSubmission(classroom, submission, uid) {
  return isEligibleReviewer(submission, uid) && canPerformAsUid(classroom, uid, PERMISSIONS.APPROVE_WEEKLY_PLAN);
}

function assertCanReview(classroom, submission, uid, actionLabel) {
  if (!canReviewWeeklyPlanSubmission(classroom, submission, uid)) {
    throw new Error(`Not authorized to ${actionLabel} this Weekly Plan — must be a co-teacher of this classroom other than the Fellow it belongs to.`);
  }
}

function assertCanApprove(classroom, submission, uid) {
  if (!canApproveWeeklyPlanSubmission(classroom, submission, uid)) {
    throw new Error("Not authorized to approve this Weekly Plan — must be a co-teacher of this classroom other than the Fellow it belongs to.");
  }
}

/**
 * DRAFT -> SUBMITTED, or CHANGES_REQUESTED -> SUBMITTED (a resubmit) —
 * or, if `submission` is null (no document exists yet), a brand-new
 * one created directly in SUBMITTED. Deliberately does NOT check
 * hasMeaningfulWeeklyPlanContent() against any Lesson, and does NOT
 * require a detailed LessonPlan to exist for any period — per explicit
 * product direction, submission is never gated on completeness; any
 * such warning belongs in the UI as advisory text, never a hidden
 * block here.
 */
export function submitWeeklyPlan(submission, { classroomId, teacherUid, weekStartDate, byUid }) {
  if (!submission) {
    return createWeeklyPlanSubmission({
      classroomId,
      teacherUid,
      weekStartDate,
      createdByUid: teacherUid,
      status: WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED,
      submittedAt: getCurrentIsoDate(),
    });
  }

  assertStatus(submission, [WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT, WEEKLY_PLAN_SUBMISSION_STATUS.CHANGES_REQUESTED], 'submit');
  submission.status = WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED;
  submission.submittedAt = getCurrentIsoDate();
  submission.updatedAt = submission.submittedAt;
  return submission;
}

/** SUBMITTED -> CHANGES_REQUESTED. `hadChangesRequested` is set once and never reset — see models/WeeklyPlanSubmission.js's own header comment on why it replaces a reviewHistory scan. `classroom` is required for the authorization check only. */
export function requestWeeklyPlanChanges(classroom, submission, { byUid }) {
  assertStatus(submission, [WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED], 'request changes on');
  assertCanReview(classroom, submission, byUid, 'request changes on');

  submission.status = WEEKLY_PLAN_SUBMISSION_STATUS.CHANGES_REQUESTED;
  submission.reviewerUid = byUid;
  submission.reviewedAt = getCurrentIsoDate();
  submission.hadChangesRequested = true;
  submission.updatedAt = submission.reviewedAt;
  return submission;
}

/** SUBMITTED -> APPROVED. `classroom` is required for the authorization check only. */
export function approveWeeklyPlan(classroom, submission, { byUid }) {
  assertStatus(submission, [WEEKLY_PLAN_SUBMISSION_STATUS.SUBMITTED], 'approve');
  assertCanApprove(classroom, submission, byUid);

  submission.status = WEEKLY_PLAN_SUBMISSION_STATUS.APPROVED;
  submission.reviewerUid = byUid;
  submission.reviewedAt = getCurrentIsoDate();
  submission.updatedAt = submission.reviewedAt;
  return submission;
}

/** 'Submitted' for a first-ever submission, 'Resubmitted' once at least one prior CHANGES_REQUESTED round happened — same distinction lessonPlanReviewService.js's getSubmissionLabel() makes, derived here from the plain `hadChangesRequested` flag instead of a reviewHistory scan (this model has no history array — see models/WeeklyPlanSubmission.js). */
export function getWeeklyPlanSubmissionLabel(submission) {
  return submission.hadChangesRequested ? 'Resubmitted' : 'Submitted';
}

/** The one derived (never stored) display value — see getWeekPlanDisplayStatus() below. */
export const WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED = 'not_started';

/**
 * The one place "Not started" vs "Draft" (neither ever stored — see
 * models/WeeklyPlanSubmission.js's own header comment) is decided:
 *
 *   no submission document AND no Lesson this week has meaningful
 *   content (weeklyPlanValidationService.hasMeaningfulWeeklyPlanContent,
 *   an ANY check across ALL of that week's Lessons, not a per-lesson
 *   gate)                                       -> WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED
 *   no submission document BUT at least one Lesson does -> WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT
 *   submission document exists                   -> its own stored status, verbatim
 *
 * Return value is always one of the five strings a caller can treat
 * uniformly: 'not_started' | 'draft' | 'submitted' | 'changes_requested'
 * | 'approved'.
 *
 * `weekLessons` is the plain array of that Fellow's Lesson documents
 * for the week's effective teaching periods (resolved by the caller via
 * schoolCalendarService/timetableService — this function takes plain
 * data, no Firestore access of its own).
 */
export function getWeekPlanDisplayStatus(submission, weekLessons = []) {
  if (submission) return submission.status;
  const started = weekLessons.some((lesson) => hasMeaningfulWeeklyPlanContent(lesson));
  return started ? WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT : WEEKLY_PLAN_DISPLAY_STATUS_NOT_STARTED;
}
