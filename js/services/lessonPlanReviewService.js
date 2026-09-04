/**
 * services/lessonPlanReviewService.js
 *
 * The LessonPlan review lifecycle:
 *
 *   DRAFT --submitForReview--> SUBMITTED --requestChanges--> CHANGES_REQUESTED --submitForReview (resubmit)--> SUBMITTED --approve--> APPROVED
 *                                  \--approve--> APPROVED
 *
 * "Resubmit" is deliberately not a separate function — it's the exact
 * same submitForReview() call, just from CHANGES_REQUESTED instead of
 * DRAFT; the transition table below is the one place that distinction
 * (and every other valid/invalid transition) is actually enforced,
 * mirroring models/Lesson.js's own carryForwardConcept() convention of
 * throwing a clear error on an invalid precondition rather than
 * silently doing something ambiguous.
 *
 * Every transition appends one round to `reviewHistory[]` — APPEND-
 * ONLY, never overwritten (see models/LessonPlan.js's own header
 * comment on why this deliberately deviates from
 * services/studentGoalsService.js's own setDoc()-based resubmission,
 * which silently loses the prior round's feedback). A reviewer's
 * comments are frozen into that round's own `comments[]` at the exact
 * moment the round closes (requestChanges/approve) — a later
 * resubmission's fresh, empty `activeComments[]` can never retroactively
 * rewrite what a past round actually said.
 *
 * `byUid` is always the ACTING person, passed in explicitly by the
 * caller (the current signed-in teacher or reviewer) — never inferred
 * from `lessonPlan.createdByUid`, since a co-teacher other than the
 * plan's own creator can submit/resubmit it, and a reviewer is
 * necessarily someone else entirely.
 */

import { LESSON_PLAN_STATUS, createLessonPlanReviewRound, createLessonPlanComment } from '../models/LessonPlan.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

function assertStatus(lessonPlan, allowed, actionLabel) {
  if (!allowed.includes(lessonPlan.status)) {
    throw new Error(`Cannot ${actionLabel} a LessonPlan currently in status "${lessonPlan.status}".`);
  }
}

/** Closes the current review round: freezes whatever's in `activeComments` (marking each resolved) into the round about to be appended, then clears `activeComments` for the next round. Returns the frozen comments array for the caller to attach to its own round. */
function closeCurrentRound() {
  return (lessonPlan) => {
    const resolvedAt = getCurrentIsoDate();
    const frozenComments = lessonPlan.activeComments.map((comment) => ({ ...comment, resolvedAt: comment.resolvedAt || resolvedAt }));
    lessonPlan.activeComments = [];
    return frozenComments;
  };
}

/**
 * DRAFT -> SUBMITTED, or CHANGES_REQUESTED -> SUBMITTED (a resubmit).
 * `reviewerUid` is optional — assigning a specific reviewer is a
 * separate, changeable decision (same-classroom scope, per this
 * feature's own V1 limitation), not required just to submit.
 */
export function submitForReview(lessonPlan, { byUid, reviewerUid } = {}) {
  assertStatus(lessonPlan, [LESSON_PLAN_STATUS.DRAFT, LESSON_PLAN_STATUS.CHANGES_REQUESTED], 'submit for review');

  const frozenComments = closeCurrentRound()(lessonPlan);
  lessonPlan.status = LESSON_PLAN_STATUS.SUBMITTED;
  if (reviewerUid !== undefined) lessonPlan.reviewerUid = reviewerUid;
  lessonPlan.reviewHistory.push(
    createLessonPlanReviewRound({ status: LESSON_PLAN_STATUS.SUBMITTED, byUid, comments: frozenComments })
  );
  lessonPlan.updatedAt = getCurrentIsoDate();
}

/**
 * SUBMITTED -> CHANGES_REQUESTED. `comments` is a plain array of
 * `{ sectionKey, text }` — turned into full, addressable
 * LessonPlanComment objects here, pushed onto `activeComments` (open,
 * shown inline against the relevant section in the builder) AND
 * frozen into this round's own history entry, so the same comments
 * are visible both as "what's currently open" and "what was said in
 * round N" even after the teacher eventually resolves them.
 */
export function requestChanges(lessonPlan, { byUid, comments = [] } = {}) {
  assertStatus(lessonPlan, [LESSON_PLAN_STATUS.SUBMITTED], 'request changes on');
  if (comments.length === 0) {
    throw new Error('Requesting changes requires at least one comment — a bare status flip with no explanation leaves the teacher nothing to act on.');
  }

  const newComments = comments.map(({ sectionKey, text }) => createLessonPlanComment({ sectionKey, text, byUid }));
  lessonPlan.activeComments.push(...newComments);

  lessonPlan.status = LESSON_PLAN_STATUS.CHANGES_REQUESTED;
  lessonPlan.reviewHistory.push(
    createLessonPlanReviewRound({ status: LESSON_PLAN_STATUS.CHANGES_REQUESTED, byUid, comments: newComments.map((comment) => ({ ...comment })) })
  );
  lessonPlan.updatedAt = getCurrentIsoDate();
}

/** SUBMITTED -> APPROVED. Any comments still open at approval time are marked resolved (nothing left to act on) and archived into this round rather than left dangling in `activeComments`. */
export function approve(lessonPlan, { byUid } = {}) {
  assertStatus(lessonPlan, [LESSON_PLAN_STATUS.SUBMITTED], 'approve');

  const frozenComments = closeCurrentRound()(lessonPlan);
  lessonPlan.status = LESSON_PLAN_STATUS.APPROVED;
  lessonPlan.reviewHistory.push(createLessonPlanReviewRound({ status: LESSON_PLAN_STATUS.APPROVED, byUid, comments: frozenComments }));
  lessonPlan.updatedAt = getCurrentIsoDate();
}

/** `activity:{activityId}` — the one section key not listed in LESSON_PLAN_SECTION_KEYS (an activity's id doesn't exist until the activity does). Kept here, not hardcoded at every call site, so there's exactly one string format to change if it ever needs to. */
export function buildActivitySectionKey(activityId) {
  return `activity:${activityId}`;
}
