/**
 * services/chapterPlanReviewService.js
 *
 * The ChapterPlan review lifecycle:
 *
 *   DRAFT --submitChapterPlan--> SUBMITTED --requestChapterPlanChanges--> CHANGES_REQUESTED --submitChapterPlan (resubmit)--> SUBMITTED --approveChapterPlan--> APPROVED
 *                                     \--approveChapterPlan--> APPROVED
 *
 * A direct, field-renamed port of services/lessonPlanReviewService.js's
 * own transition table and reasoning — "resubmit" is deliberately not a
 * separate function, every transition appends one APPEND-ONLY round to
 * `reviewHistory[]` (see models/ChapterPlan.js's own header comment for
 * why this deliberately does NOT follow models/WeeklyPlanSubmission.js's
 * lighter, history-less shape), and a reviewer's comments are frozen
 * into that round's own `comments[]` at the exact moment the round
 * closes, never retroactively re-homed by a later round closing.
 *
 * `byUid` is always the ACTING person, passed in explicitly by the
 * caller — never inferred from `chapterPlan.teacherUid`/`createdByUid`,
 * for the same reason lessonPlanReviewService.js's own header comment
 * gives (a co-teacher other than the plan's own Fellow can submit/
 * resubmit it; a reviewer is necessarily someone else entirely).
 *
 * Authorization: V1 has no separate "reviewer" role and no School/
 * Programme hierarchy to scope a cross-classroom reviewer against — so
 * scope here is simply "a member of THIS classroom," exactly like
 * lessonPlanReviewService.js/weeklyPlanSubmissionService.js's own
 * identically-shaped checks. canReviewChapterPlan()/canApproveChapterPlan()
 * below compose that existing, already-scoped
 * services/permissionService.js check with the one extra business rule
 * every sibling review service enforces: a reviewer is necessarily
 * someone else, never the plan's own `teacherUid`. Uses
 * PERMISSIONS.REVIEW_CHAPTER_PLAN/APPROVE_CHAPTER_PLAN
 * (config/memberRoles.js) — deliberately never
 * REVIEW_LESSON_PLAN/REVIEW_WEEKLY_PLAN, so this planning tier's review
 * authority stays independently trackable, per that config file's own
 * header comment.
 *
 * Pure and Firestore-free, same convention as lessonPlanReviewService.js/
 * weeklyPlanSubmissionService.js themselves — the actual Firestore write
 * happens wherever a future caller (Phase 3+ UI) invokes these against
 * a plan already fetched via repositories/chapterPlanRepository.js, then
 * saves the mutated result back via that same repository. This file
 * only ever mutates the plain `chapterPlan` object it's given.
 */

import { CHAPTER_PLAN_STATUS, createChapterPlanReviewRound, createChapterPlanComment } from '../models/ChapterPlan.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { canPerformAsUid } from './permissionService.js';
import { PERMISSIONS } from '../config/memberRoles.js';

function assertStatus(chapterPlan, allowed, actionLabel) {
  if (!allowed.includes(chapterPlan.status)) {
    throw new Error(`Cannot ${actionLabel} a ChapterPlan currently in status "${chapterPlan.status}".`);
  }
}

/** DRAFT or CHANGES_REQUESTED — the only statuses in which this plan's own content mutators (see services/chapterPlanService.js) should ever run. SUBMITTED/APPROVED are locked to the author too, not just to a reviewer, so a review in progress (or an already-approved plan) is never silently edited out from under it. Same shape as lessonPlanReviewService.js's own isLessonPlanEditable(). */
export function isChapterPlanEditable(chapterPlan) {
  return chapterPlan.status === CHAPTER_PLAN_STATUS.DRAFT || chapterPlan.status === CHAPTER_PLAN_STATUS.CHANGES_REQUESTED;
}

/** A reviewer is necessarily someone else, never the plan's own `teacherUid` — regardless of what permissions their role otherwise grants. Composed into both capability checks below, so "can this uid review THIS plan" always means the same thing everywhere it's asked. */
function isEligibleReviewer(chapterPlan, uid) {
  return Boolean(uid) && uid !== chapterPlan.teacherUid;
}

/** Same-classroom-scoped: true only if `uid` is a member of THIS classroom (canPerformAsUid's own scope check) AND isn't this plan's own Fellow. Used to gate the Request Changes action. */
export function canReviewChapterPlan(classroom, chapterPlan, uid) {
  return isEligibleReviewer(chapterPlan, uid) && canPerformAsUid(classroom, uid, PERMISSIONS.REVIEW_CHAPTER_PLAN);
}

/** Same shape as canReviewChapterPlan(), for the Approve action specifically — kept as its own function (not an alias) so a future role split needs no call-site changes. */
export function canApproveChapterPlan(classroom, chapterPlan, uid) {
  return isEligibleReviewer(chapterPlan, uid) && canPerformAsUid(classroom, uid, PERMISSIONS.APPROVE_CHAPTER_PLAN);
}

function assertCanReview(classroom, chapterPlan, uid, actionLabel) {
  if (!canReviewChapterPlan(classroom, chapterPlan, uid)) {
    throw new Error(`Not authorized to ${actionLabel} this ChapterPlan — must be a co-teacher of this classroom other than the Fellow it belongs to.`);
  }
}

function assertCanApprove(classroom, chapterPlan, uid) {
  if (!canApproveChapterPlan(classroom, chapterPlan, uid)) {
    throw new Error("Not authorized to approve this ChapterPlan — must be a co-teacher of this classroom other than the Fellow it belongs to.");
  }
}

/**
 * The round number a comment created RIGHT NOW would belong to — same
 * "decided once, at birth, never recomputed" convention
 * lessonPlanReviewService.js's own nextRoundNumber() establishes.
 */
function nextRoundNumber(chapterPlan) {
  return chapterPlan.reviewHistory.length + 1;
}

/** Resolves and clears whatever's left in `activeComments` — same "this round is now closed" bookkeeping as lessonPlanReviewService.js's own closeCurrentRound(), for the identical reason: a comment's home in `reviewHistory[roundIndex].comments[]` is decided once, at creation, never retroactively reassigned by a later round closing. */
function closeCurrentRound(chapterPlan) {
  const resolvedAt = getCurrentIsoDate();
  chapterPlan.activeComments.forEach((comment) => {
    if (!comment.resolvedAt) comment.resolvedAt = resolvedAt;
  });
  chapterPlan.activeComments = [];
}

/**
 * DRAFT -> SUBMITTED, or CHANGES_REQUESTED -> SUBMITTED (a resubmit).
 * `reviewerUid` is optional — assigning a specific reviewer is a
 * separate, changeable decision, not required just to submit.
 *
 * Deliberately does NOT gate on any content-completeness check — per
 * explicit product direction ("do NOT make submission depend on every
 * optional template field being filled"), the same "submission is never
 * gated on completeness; any such warning belongs in the UI as advisory
 * text, never a hidden block here" principle
 * services/weeklyPlanSubmissionService.js's own submitWeeklyPlan()
 * doc comment establishes, and the same one lessonPlanReviewService.js's
 * own submitForReview() already follows (it checks status only, never
 * services/lessonPlanValidationService.js's own getLessonPlanReadiness()).
 * `chapterName`/`subjectId`/`curriculumUnitId` are already required at
 * CREATION time (see services/chapterPlanService.js's own
 * createChapterPlanDraft()) — there is no separate, additional
 * structural gate the way LessonPlan's "at least one Activity" is,
 * since ChapterPlan has no analogous required dynamic list; re-checking
 * identity fields here would only be re-validating an invariant
 * creation already owns.
 */
export function submitChapterPlan(chapterPlan, { byUid, reviewerUid } = {}) {
  assertStatus(chapterPlan, [CHAPTER_PLAN_STATUS.DRAFT, CHAPTER_PLAN_STATUS.CHANGES_REQUESTED], 'submit for review');

  closeCurrentRound(chapterPlan);
  chapterPlan.status = CHAPTER_PLAN_STATUS.SUBMITTED;
  if (reviewerUid !== undefined) chapterPlan.reviewerUid = reviewerUid;
  chapterPlan.reviewHistory.push(createChapterPlanReviewRound({ status: CHAPTER_PLAN_STATUS.SUBMITTED, byUid, comments: [] }));
  chapterPlan.updatedAt = getCurrentIsoDate();
  return chapterPlan;
}

/**
 * SUBMITTED -> CHANGES_REQUESTED. `comments` is a plain array of
 * `{ sectionKey, text }` — turned into full, addressable
 * ChapterPlanComment objects here, each tagged with the round number
 * being formed right now, pushed onto `activeComments` AND frozen into
 * this round's own history entry — same shape as
 * lessonPlanReviewService.js's own requestChanges().
 *
 * `classroom` is required purely for the authorization check below —
 * this function itself only ever reads/writes `chapterPlan`.
 */
export function requestChapterPlanChanges(classroom, chapterPlan, { byUid, comments = [] } = {}) {
  assertStatus(chapterPlan, [CHAPTER_PLAN_STATUS.SUBMITTED], 'request changes on');
  assertCanReview(classroom, chapterPlan, byUid, 'request changes on');
  if (comments.length === 0) {
    throw new Error('Requesting changes requires at least one comment — a bare status flip with no explanation leaves the Fellow nothing to act on.');
  }

  const roundNumber = nextRoundNumber(chapterPlan);
  const newComments = comments.map(({ sectionKey, text }) => createChapterPlanComment({ sectionKey, text, byUid, roundNumber }));
  chapterPlan.activeComments.push(...newComments);

  chapterPlan.status = CHAPTER_PLAN_STATUS.CHANGES_REQUESTED;
  chapterPlan.reviewerUid = byUid;
  chapterPlan.reviewHistory.push(
    createChapterPlanReviewRound({ status: CHAPTER_PLAN_STATUS.CHANGES_REQUESTED, byUid, comments: newComments.map((comment) => ({ ...comment })) })
  );
  chapterPlan.updatedAt = getCurrentIsoDate();
  return chapterPlan;
}

/**
 * SUBMITTED -> APPROVED. `comments` (optional, same `{ sectionKey,
 * text }` shape as requestChapterPlanChanges()) lets a reviewer's
 * remarks made while reading survive even when the plan ends up
 * approved rather than sent back — same shape as
 * lessonPlanReviewService.js's own approve().
 *
 * IMPORTANT: approving a Chapter Plan says nothing about the status of
 * any Resource referenced via `resourceLinks[]` — per explicit product
 * direction ("plan review and resource repository status stay
 * conceptually separate"), this function never reads, writes, or
 * otherwise touches any Resource document.
 */
export function approveChapterPlan(classroom, chapterPlan, { byUid, comments = [] } = {}) {
  assertStatus(chapterPlan, [CHAPTER_PLAN_STATUS.SUBMITTED], 'approve');
  assertCanApprove(classroom, chapterPlan, byUid);

  const roundNumber = nextRoundNumber(chapterPlan);
  const resolvedAt = getCurrentIsoDate();
  const newComments = comments.map(({ sectionKey, text }) => createChapterPlanComment({ sectionKey, text, byUid, roundNumber, resolvedAt }));
  chapterPlan.activeComments.push(...newComments);

  closeCurrentRound(chapterPlan);
  chapterPlan.status = CHAPTER_PLAN_STATUS.APPROVED;
  chapterPlan.reviewerUid = byUid;
  chapterPlan.reviewHistory.push(
    createChapterPlanReviewRound({ status: CHAPTER_PLAN_STATUS.APPROVED, byUid, comments: newComments.map((comment) => ({ ...comment })) })
  );
  chapterPlan.updatedAt = getCurrentIsoDate();
  return chapterPlan;
}

/** 'Submitted' for a plan's first-ever submission, 'Resubmitted' once at least one earlier round already asked for changes — same derivation as lessonPlanReviewService.js's own getSubmissionLabel(), from `reviewHistory` itself rather than a separate stored flag. */
export function getSubmissionLabel(chapterPlan) {
  const hasPriorChangesRequested = chapterPlan.reviewHistory.some((round) => round.status === CHAPTER_PLAN_STATUS.CHANGES_REQUESTED);
  return hasPriorChangesRequested ? 'Resubmitted' : 'Submitted';
}

// ---------------------------------------------------------------------
// Queue / detail retrieval — pure filters over an already-fetched list,
// same "stays directly unit-testable, no Firestore import" convention
// every function above already follows. The actual fetch (one
// classroom's full chapterPlans list, or one plan by id) is
// repositories/chapterPlanRepository.js's own job
// (getChapterPlansForClassroom()/getChapterPlanById(), both already
// built in Phase 1) — deliberately not re-wrapped here, so there is
// never a second, parallel way to fetch the same data.
// ---------------------------------------------------------------------

/**
 * Which of an already-fetched list of ChapterPlans currently need
 * REVIEWER attention — status SUBMITTED only (CHANGES_REQUESTED is the
 * Fellow's own turn to act, not a reviewer's; DRAFT/APPROVED aren't
 * awaiting anyone), excluding any plan `currentUid` is themselves the
 * Fellow of (a reviewer never needs their own plan surfaced in their
 * own "needs my review" list) — same two-part filter
 * services/weeklyPlanReviewIndexService.js's own
 * filterEntriesNeedingReview() plus this file's own isEligibleReviewer()
 * already establish separately, composed here for a caller that already
 * has full ChapterPlan objects in hand (e.g. a same-classroom queue),
 * not just thin index entries (see services/chapterPlanReviewIndexService.js
 * for the cross-classroom, index-entry-shaped equivalent).
 */
export function getReviewableChapterPlans(chapterPlans, currentUid) {
  return chapterPlans.filter((chapterPlan) => chapterPlan.status === CHAPTER_PLAN_STATUS.SUBMITTED && isEligibleReviewer(chapterPlan, currentUid));
}

/**
 * One ChapterPlan by id out of an already-fetched list, or null — a
 * thin, pure lookup for a caller composing a review queue click-through
 * without a second Firestore round-trip when the full list is already
 * in hand. A caller that does NOT already have the list should call
 * repositories/chapterPlanRepository.js's own getChapterPlanById()
 * directly instead — this function is not a Firestore-touching
 * replacement for that, only a convenience over data already fetched.
 */
export function getChapterPlanForReview(chapterPlans, chapterPlanId) {
  return chapterPlans.find((chapterPlan) => chapterPlan.id === chapterPlanId) || null;
}
