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
 *
 * ---------------------------------------------------------------------
 * Phase 3 addition — authorization (PERSON + ROLE + SCOPE = PERMISSIONS)
 * ---------------------------------------------------------------------
 *
 * V1 has no separate "reviewer" role and no School/Programme hierarchy
 * to scope a cross-classroom reviewer against (see config/memberRoles.js's
 * own REVIEW_LESSON_PLAN/APPROVE_LESSON_PLAN comment) — so scope here is
 * simply "a member of THIS classroom", exactly like every other
 * permission check in this app (services/permissionService.js's
 * canPerformAsUid() already resolves a role from classroom.members[uid],
 * which is undefined/null for a non-member — that IS the scope check,
 * not a separate mechanism). canReviewLessonPlan()/canApproveLessonPlan()
 * below only ever compose that existing, already-scoped check with one
 * extra business rule this file's own header already promised but never
 * actually enforced in code: a reviewer is necessarily someone else,
 * never the plan's own author. Nothing here hardcodes "isProgramManager"
 * or similar — when a real PM/HM scope exists later, it plugs into
 * canPerformAsUid() the same way OWNER/TEACHER already do, with zero
 * change to requestChanges()/approve() below.
 */

import { LESSON_PLAN_STATUS, createLessonPlanReviewRound, createLessonPlanComment } from '../models/LessonPlan.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { canPerformAsUid } from './permissionService.js';
import { PERMISSIONS } from '../config/memberRoles.js';

function assertStatus(lessonPlan, allowed, actionLabel) {
  if (!allowed.includes(lessonPlan.status)) {
    throw new Error(`Cannot ${actionLabel} a LessonPlan currently in status "${lessonPlan.status}".`);
  }
}

/** A reviewer is necessarily someone else, never the plan's own author — regardless of what permissions their role otherwise grants. Composed into both capability checks below, so "can this uid review THIS plan" always means the same thing everywhere it's asked. */
function isEligibleReviewer(lessonPlan, uid) {
  return Boolean(uid) && uid !== lessonPlan.createdByUid;
}

/** Same-classroom-scoped: true only if `uid` is a member of THIS classroom (canPerformAsUid's own scope check) AND isn't this plan's own author. Used to gate the Request Changes action/UI. */
export function canReviewLessonPlan(classroom, lessonPlan, uid) {
  return isEligibleReviewer(lessonPlan, uid) && canPerformAsUid(classroom, uid, PERMISSIONS.REVIEW_LESSON_PLAN);
}

/** Same shape as canReviewLessonPlan(), for the Approve action specifically — kept as its own function (not an alias) so a future V2 where REVIEW_LESSON_PLAN and APPROVE_LESSON_PLAN diverge to different roles needs no call-site changes. */
export function canApproveLessonPlan(classroom, lessonPlan, uid) {
  return isEligibleReviewer(lessonPlan, uid) && canPerformAsUid(classroom, uid, PERMISSIONS.APPROVE_LESSON_PLAN);
}

function assertCanReview(classroom, lessonPlan, uid, actionLabel) {
  if (!canReviewLessonPlan(classroom, lessonPlan, uid)) {
    throw new Error(`Not authorized to ${actionLabel} this LessonPlan — must be a co-teacher of this classroom other than the plan's own author.`);
  }
}

function assertCanApprove(classroom, lessonPlan, uid) {
  if (!canApproveLessonPlan(classroom, lessonPlan, uid)) {
    throw new Error("Not authorized to approve this LessonPlan — must be a co-teacher of this classroom other than the plan's own author.");
  }
}

/** DRAFT or CHANGES_REQUESTED — the only statuses in which the builder's own content mutators should ever run. SUBMITTED/APPROVED are locked to the author too, not just to a reviewer, so a review in progress (or an already-approved plan) is never silently edited out from under it. */
export function isLessonPlanEditable(lessonPlan) {
  return lessonPlan.status === LESSON_PLAN_STATUS.DRAFT || lessonPlan.status === LESSON_PLAN_STATUS.CHANGES_REQUESTED;
}

/**
 * The round number a comment created RIGHT NOW would belong to — the
 * round about to be appended to `reviewHistory[]` (1-indexed, matching
 * how humans already talk about "Round 1"/"Round 2" in this feature's
 * own product brief). Called at comment-CREATION time only (inside
 * requestChanges()/approve() below) — a comment's round is decided
 * once, at birth, and never recomputed or reassigned afterward.
 */
function nextRoundNumber(lessonPlan) {
  return lessonPlan.reviewHistory.length + 1;
}

/**
 * Resolves (marks `resolvedAt`) and clears whatever's left in
 * `activeComments` — pure bookkeeping for "this round is now closed,
 * so nothing in it is still open," nothing more. Deliberately does
 * NOT return the resolved comments for a caller to attach to its own
 * round: that was the exact bug this Phase 3 hardening pass fixes —
 * see this function's own git history / PR description. A comment's
 * home in `reviewHistory[roundIndex].comments[]` is decided once, at
 * creation (see requestChanges()/approve() below, which build their
 * own round's comment list from ONLY the comments they just created,
 * tagged with their own `roundNumber`) — closing a later round must
 * never retroactively reassign a comment born in an earlier one.
 * Still safe to call unconditionally on every transition (submit,
 * requestChanges, approve): if a comment is somehow still open past
 * the round that created it (there's no legitimate path that leaves
 * one open, but this stays defensive rather than assuming), it's
 * resolved and removed from `activeComments` here either way — it
 * just never gets a *second*, wrongly-attributed home.
 */
function closeCurrentRound(lessonPlan) {
  const resolvedAt = getCurrentIsoDate();
  lessonPlan.activeComments.forEach((comment) => {
    if (!comment.resolvedAt) comment.resolvedAt = resolvedAt;
  });
  lessonPlan.activeComments = [];
}

/**
 * DRAFT -> SUBMITTED, or CHANGES_REQUESTED -> SUBMITTED (a resubmit).
 * `reviewerUid` is optional — assigning a specific reviewer is a
 * separate, changeable decision (same-classroom scope, per this
 * feature's own V1 limitation), not required just to submit.
 *
 * A (re)submission never creates comments of its own — only a
 * reviewer's requestChanges()/approve() do — so this round's own
 * `comments` is always `[]`. Whatever was still open from the PRIOR
 * (CHANGES_REQUESTED) round is resolved/cleared by closeCurrentRound()
 * as plain bookkeeping; it's already correctly recorded in that prior
 * round's own history entry from when it was created, and does not
 * get a second, duplicate home here.
 */
export function submitForReview(lessonPlan, { byUid, reviewerUid } = {}) {
  assertStatus(lessonPlan, [LESSON_PLAN_STATUS.DRAFT, LESSON_PLAN_STATUS.CHANGES_REQUESTED], 'submit for review');

  closeCurrentRound(lessonPlan);
  lessonPlan.status = LESSON_PLAN_STATUS.SUBMITTED;
  if (reviewerUid !== undefined) lessonPlan.reviewerUid = reviewerUid;
  lessonPlan.reviewHistory.push(createLessonPlanReviewRound({ status: LESSON_PLAN_STATUS.SUBMITTED, byUid, comments: [] }));
  lessonPlan.updatedAt = getCurrentIsoDate();
}

/**
 * SUBMITTED -> CHANGES_REQUESTED. `comments` is a plain array of
 * `{ sectionKey, text }` — turned into full, addressable
 * LessonPlanComment objects here, each tagged with the round number
 * being formed right now (see nextRoundNumber()), pushed onto
 * `activeComments` (open, shown inline against the relevant section in
 * the builder) AND frozen into this round's own history entry, so the
 * same comments are visible both as "what's currently open" and "what
 * was said in round N" even after the teacher eventually resolves
 * them — and stay THIS round's own, never re-homed by a later close.
 *
 * `classroom` is required (Phase 3) purely for the authorization check
 * below — requestChanges() itself still only ever reads/writes
 * `lessonPlan`, never the classroom document.
 */
export function requestChanges(classroom, lessonPlan, { byUid, comments = [] } = {}) {
  assertStatus(lessonPlan, [LESSON_PLAN_STATUS.SUBMITTED], 'request changes on');
  assertCanReview(classroom, lessonPlan, byUid, 'request changes on');
  if (comments.length === 0) {
    throw new Error('Requesting changes requires at least one comment — a bare status flip with no explanation leaves the teacher nothing to act on.');
  }

  const roundNumber = nextRoundNumber(lessonPlan);
  const newComments = comments.map(({ sectionKey, text }) => createLessonPlanComment({ sectionKey, text, byUid, roundNumber }));
  lessonPlan.activeComments.push(...newComments);

  lessonPlan.status = LESSON_PLAN_STATUS.CHANGES_REQUESTED;
  lessonPlan.reviewerUid = byUid;
  lessonPlan.reviewHistory.push(
    createLessonPlanReviewRound({ status: LESSON_PLAN_STATUS.CHANGES_REQUESTED, byUid, comments: newComments.map((comment) => ({ ...comment })) })
  );
  lessonPlan.updatedAt = getCurrentIsoDate();
}

/**
 * SUBMITTED -> APPROVED. `comments` (optional, same `{ sectionKey, text }`
 * shape as requestChanges()) lets a reviewer's remarks made while reading
 * — praise, "keep this," minor notes that don't rise to blocking — survive
 * even when the plan ends up approved rather than sent back. Tagged with
 * THIS round's own number at creation, same as requestChanges() — an
 * approval's comments (if any) belong to the APPROVED round, never
 * conflated with whatever an earlier CHANGES_REQUESTED round already
 * recorded.
 *
 * `classroom` is required (Phase 3) for the same authorization reason as
 * requestChanges() above.
 */
export function approve(classroom, lessonPlan, { byUid, comments = [] } = {}) {
  assertStatus(lessonPlan, [LESSON_PLAN_STATUS.SUBMITTED], 'approve');
  assertCanApprove(classroom, lessonPlan, byUid);

  const roundNumber = nextRoundNumber(lessonPlan);
  const resolvedAt = getCurrentIsoDate();
  const newComments = comments.map(({ sectionKey, text }) => createLessonPlanComment({ sectionKey, text, byUid, roundNumber, resolvedAt }));
  lessonPlan.activeComments.push(...newComments);

  closeCurrentRound(lessonPlan);
  lessonPlan.status = LESSON_PLAN_STATUS.APPROVED;
  lessonPlan.reviewerUid = byUid;
  lessonPlan.reviewHistory.push(
    createLessonPlanReviewRound({ status: LESSON_PLAN_STATUS.APPROVED, byUid, comments: newComments.map((comment) => ({ ...comment })) })
  );
  lessonPlan.updatedAt = getCurrentIsoDate();
}

/**
 * `activity:{activityId}`, or `activity:{activityId}:{field}` for a
 * named sub-part of that activity (e.g. `studentAction`,
 * `differentiation.greenBucket`) — Phase 3's own addition, for
 * comments like "Activity 2 / Green Bucket" that need to point at more
 * than "this whole activity." Still one addressing scheme (a single
 * sectionKey string), never a second targetType/targetId shape — see
 * services/lessonPlanValidationService.js's own header comment on why
 * that matters. `field` is optional so every existing call site
 * (whole-activity comments) is unaffected. Kept here, not hardcoded at
 * every call site, so there's exactly one string format to change if
 * it ever needs to.
 */
export function buildActivitySectionKey(activityId, field) {
  return field ? `activity:${activityId}:${field}` : `activity:${activityId}`;
}

/** The activityId out of an `activity:{id}` or `activity:{id}:{field}` sectionKey, or null for a named-section key (e.g. `'why'`) that isn't about an activity at all. The one place this parsing happens, so a comment's activity association is never re-derived ad hoc at a render call site. */
export function getActivityIdFromSectionKey(sectionKey) {
  if (typeof sectionKey !== 'string' || !sectionKey.startsWith('activity:')) return null;
  return sectionKey.split(':')[1] || null;
}

/**
 * 'Submitted' for a plan's first-ever submission, 'Resubmitted' once at
 * least one earlier round already asked for changes — the same
 * distinction the Review Queue's own mockup calls out ("Anu · Fractions
 * · Submitted" vs "Rahul · Kattabomman · Resubmitted"). Derived from
 * reviewHistory itself (append-only, see this file's own header) rather
 * than a separate stored flag, so it can never drift out of sync with
 * the actual history.
 */
export function getSubmissionLabel(lessonPlan) {
  const hasPriorChangesRequested = lessonPlan.reviewHistory.some(
    (round) => round.status === LESSON_PLAN_STATUS.CHANGES_REQUESTED
  );
  return hasPriorChangesRequested ? 'Resubmitted' : 'Submitted';
}
