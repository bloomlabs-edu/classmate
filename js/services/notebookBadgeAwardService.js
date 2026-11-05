/**
 * services/notebookBadgeAwardService.js
 *
 * The actual Notebook Tracker badge-AWARDING workflow — sibling to
 * services/notebookBadgeService.js (which only owns the classroom's own
 * badge-type catalog and the aggregate per-student count/display), the
 * same "service owns mutation, caller persists" split every other
 * service in this app already uses (see services/checkpointService.js's
 * own header comment).
 *
 * Three distinct trigger shapes, per explicit product decision — never
 * conflated with one another:
 *   - Organization / Punctuation Champion (REVIEW_COMPLETION_BADGE_IDS):
 *     always a TEACHER'S OWN manual decision, but only ever offered once
 *     a review has genuinely been marked 'complete' (see
 *     checkpointService.setReview()) — marking a submission 'submitted'
 *     alone is never enough, by explicit instruction. See
 *     awardReviewCompletionBadge() below.
 *   - Readiness Champion (READINESS_CHAMPION_BADGE_ID), automatic path:
 *     evaluated as a direct consequence of a submission being recorded
 *     (checkpointService.setSubmission()), entirely independent of
 *     whether that submission has been reviewed yet at all. See
 *     evaluateReadinessChampion() below.
 *   - Readiness Champion, teacher override/revocation: the two actions
 *     that let a teacher correct what the automatic rule alone
 *     produced (award it despite the date rule not applying, or take
 *     back an award that was wrong). See overrideReadinessChampion()/
 *     revokeReadinessChampion() below.
 *
 * Every mutating function here takes the real StudentCheckpointRecord
 * (found via checkpointService.getRecordForStudent() — always expected
 * to already exist for every path this file's own callers reach it
 * from; see each function's own comment for why) and mutates it plus
 * the given Student in place; the caller persists afterward, mirroring
 * checkpointService.js's own established convention exactly.
 *
 * PERMISSIONS — enforced here, at the application/service layer, via
 * services/permissionService.js's own canPerformAsUid() against the new
 * PERMISSIONS.AWARD_NOTEBOOK_BADGE (config/memberRoles.js), granted to
 * OWNER/TEACHER only. This is the SAME enforcement shape every
 * comparable existing permission in this app already uses (AWARD_POINTS,
 * EDIT_STUDENTS, REVIEW_LESSON_PLAN, etc.) — none of them are backed by
 * a role-aware Firestore rule either; the classroom document's one
 * `allow update` rule (firestore.rules) grants any authenticated member
 * write access to the whole document, with no per-field/per-role
 * narrowing anywhere in this app today. Retrofitting true rule-layer
 * role enforcement for just this one feature's fields would require
 * restructuring that single, shared, every-feature-depends-on-it rule —
 * a disproportionate, high-blast-radius change out of scope here, and
 * flagged separately rather than assumed.
 */

import * as checkpointService from './checkpointService.js';
import * as notebookBadgeService from './notebookBadgeService.js';
import { canPerformAsUid } from './permissionService.js';
import { PERMISSIONS } from '../config/memberRoles.js';
import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export const REVIEW_COMPLETION_BADGE_IDS = Object.freeze(['organization', 'punctuation-champion']);
export const READINESS_CHAMPION_BADGE_ID = 'readiness-champion';

/** Real, OWNER/TEACHER-only gate for every badge-awarding action in this file. */
export function canAwardNotebookBadge(classroom, uid) {
  return canPerformAsUid(classroom, uid, PERMISSIONS.AWARD_NOTEBOOK_BADGE);
}

function assertCanAward(classroom, uid, actionLabel) {
  if (!canAwardNotebookBadge(classroom, uid)) {
    throw new Error(`Not authorized to ${actionLabel} — must be this classroom's owner or a co-teacher.`);
  }
}

/** Every award entry on this record for one badge type, oldest first — read-only, never mutates. */
export function listBadgeAwardsForRecord(record, badgeTypeId) {
  return (record?.badgeAwards || []).filter((entry) => entry.badgeTypeId === badgeTypeId);
}

/**
 * True only if this record already carries a non-revoked award for
 * this exact badge type — the one check every awarding path below
 * consults before ever pushing a new entry, per explicit "prevent
 * duplicate awards for the same student, badge type, and submission"
 * requirement. A previously-REVOKED award does not count — revoking a
 * mistaken award and then correctly awarding it again is allowed, by
 * design (see revokeReadinessChampion()'s own comment).
 */
export function hasActiveBadgeAward(record, badgeTypeId) {
  return listBadgeAwardsForRecord(record, badgeTypeId).some((entry) => !entry.revoked);
}

function pushAwardEntry(record, { badgeTypeId, source, awardedBy }) {
  if (!record.badgeAwards) record.badgeAwards = [];
  const entry = {
    id: generateId(),
    badgeTypeId,
    source,
    awardedBy,
    awardedAt: getCurrentIsoDate(),
    revoked: false,
    revokedBy: null,
    revokedAt: null,
  };
  record.badgeAwards.push(entry);
  return entry;
}

/**
 * Organization / Punctuation Champion — a teacher's own manual award,
 * offered only once this exact checkpoint/student's review has
 * genuinely been marked 'complete' (never merely 'submitted' — see
 * this file's own header comment). Throws, rather than silently
 * no-op-ing, on every real misuse: unauthorized uid, wrong badge type,
 * review not actually complete, or an already-active award for this
 * exact student/badge/submission — matching checkpointService.
 * setReview()'s own "surface genuine misuse" convention exactly.
 *
 * `checkpoint`/`student` are the real objects (not just ids) — mirrors
 * notebookBadgeService.awardNotebookBadge()'s own (classroom, student,
 * badgeTypeId) shape, since this function calls straight through to it
 * once the submission-scoped checks above pass.
 */
export function awardReviewCompletionBadge(classroom, checkpoint, student, badgeTypeId, actingUid) {
  assertCanAward(classroom, actingUid, 'award a Notebook Tracker badge');

  if (!REVIEW_COMPLETION_BADGE_IDS.includes(badgeTypeId)) {
    throw new Error(`"${badgeTypeId}" is not awarded through the review-completion flow.`);
  }

  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  if (!record || record.reviewStatus !== 'complete') {
    throw new Error('Can only award this badge once the review has been marked Complete for this student.');
  }

  if (hasActiveBadgeAward(record, badgeTypeId)) {
    throw new Error('This badge has already been awarded for this submission.');
  }

  pushAwardEntry(record, { badgeTypeId, source: 'manual', awardedBy: actingUid });
  return notebookBadgeService.awardNotebookBadge(classroom, student, badgeTypeId);
}

/**
 * Readiness Champion — fully automatic, evaluated as a direct
 * consequence of a submission being recorded (never of a review being
 * completed; see this file's own header comment on why those two
 * triggers are never conflated). Intended to be called by the same
 * handler that just called checkpointService.setSubmission(..., {
 * status: 'submitted' }) for this exact student/checkpoint — a no-op,
 * never a throw, for every case where automatic award genuinely
 * doesn't apply (nothing submitted, no due date to compare against,
 * late, already awarded) or where `actingUid` isn't actually permitted
 * to award (see below) — this must never abort or roll back the
 * submission it's reacting to.
 *
 * `actingUid` lacking AWARD_NOTEBOOK_BADGE silently skips the award
 * rather than throwing, deliberately different from every other
 * function in this file: this is a SIDE EFFECT of an already-permitted
 * action (recording a submission), not a primary teacher command, and
 * must never surface as an error that could be mistaken for the
 * submission itself having failed to save. A later Review-Complete
 * manual award, or a later Override, both remain available to recover
 * from a skipped automatic grant.
 */
export function evaluateReadinessChampion(classroom, checkpoint, student, actingUid) {
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  if (!record || record.submissionStatus !== 'submitted' || !record.submittedDate) return null;
  if (!checkpoint.dueDate) return null;
  if (record.submittedDate > checkpoint.dueDate) return null; // late — the automatic rule never applies; see overrideReadinessChampion() for that case
  if (hasActiveBadgeAward(record, READINESS_CHAMPION_BADGE_ID)) return null;
  if (!canAwardNotebookBadge(classroom, actingUid)) return null;

  pushAwardEntry(record, { badgeTypeId: READINESS_CHAMPION_BADGE_ID, source: 'automatic', awardedBy: actingUid });
  return notebookBadgeService.awardNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
}

/**
 * Teacher override — awards Readiness Champion even though the
 * automatic rule above did not (or will not) apply, e.g. a late
 * submission the teacher has an independent reason to treat as on
 * time. Still requires a real submission to exist (cannot be "ready"
 * having submitted nothing at all) and still enforces the same
 * duplicate guard as the automatic path — an override never stacks a
 * second award on top of one already active, whichever source granted
 * it.
 */
export function overrideReadinessChampion(classroom, checkpoint, student, actingUid) {
  assertCanAward(classroom, actingUid, 'award Readiness Champion');

  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  if (!record || record.submissionStatus !== 'submitted') {
    throw new Error('Cannot award Readiness Champion to a student who has not submitted this checkpoint.');
  }
  if (hasActiveBadgeAward(record, READINESS_CHAMPION_BADGE_ID)) {
    throw new Error('Readiness Champion has already been awarded for this submission.');
  }

  pushAwardEntry(record, { badgeTypeId: READINESS_CHAMPION_BADGE_ID, source: 'override', awardedBy: actingUid });
  return notebookBadgeService.awardNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
}

/**
 * Revokes whichever award (automatic or override — the source doesn't
 * matter) is currently active for Readiness Champion on this exact
 * submission. Marks that one entry `revoked` IN PLACE (never deletes
 * it — see models/StudentCheckpointRecord.js's own comment on why) and
 * decrements the displayed count via notebookBadgeService.
 * revokeNotebookBadge(). Throws if there is nothing active to revoke,
 * matching this file's own "surface genuine misuse" convention —
 * silently no-op-ing here would hide a teacher's own mistaken belief
 * that an award existed.
 *
 * Revoking does NOT block a later, correct award for the same
 * submission — hasActiveBadgeAward() only ever looks at non-revoked
 * entries, so overrideReadinessChampion() (or a later automatic
 * evaluation, e.g. after correcting a mis-entered due date) can grant
 * a fresh one afterward.
 */
export function revokeReadinessChampion(classroom, checkpoint, student, actingUid) {
  assertCanAward(classroom, actingUid, 'revoke Readiness Champion');

  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const activeEntry = listBadgeAwardsForRecord(record, READINESS_CHAMPION_BADGE_ID).find((entry) => !entry.revoked);
  if (!activeEntry) {
    throw new Error('No active Readiness Champion award to revoke for this student on this checkpoint.');
  }

  activeEntry.revoked = true;
  activeEntry.revokedBy = actingUid;
  activeEntry.revokedAt = getCurrentIsoDate();
  return notebookBadgeService.revokeNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
}
