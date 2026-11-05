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
 *   - Readiness Champion, automatic revocation on submission withdrawal:
 *     when a submission is walked back from 'submitted' to
 *     'not_submitted' (checkpointService.setSubmission()'s own
 *     'not_submitted' branch), any ACTIVE Readiness Champion award tied
 *     to that submission — automatic or override, source doesn't matter
 *     — is no longer honest, since the thing it certified ("submitted
 *     on or before the due date") no longer happened. See
 *     revokeReadinessChampionOnWithdrawal() below. Organization/
 *     Punctuation Champion are NEVER touched by a withdrawal — they
 *     certify something about the notebook content a teacher already
 *     reviewed, which withdrawing the submission record doesn't retract.
 *
 * Every mutating function here takes the real StudentCheckpointRecord
 * (found via checkpointService.getRecordForStudent() — always expected
 * to already exist for every path this file's own callers reach it
 * from; see each function's own comment for why) and mutates it plus
 * the given Student in place; the caller persists afterward, mirroring
 * checkpointService.js's own established convention exactly.
 *
 * SUBMISSION ATTEMPT IDENTITY — checkpointService.js reuses exactly ONE
 * StudentCheckpointRecord per (checkpoint, studentId) pair for the
 * record's entire lifetime; `submittedDate` is directly overwritten on
 * every resubmission, never append-only (see that model's own header
 * comment: "independently, directly editable facts, not derived from
 * history or any append-only log"). There is no separate "submission
 * attempt" identity anywhere in this app's data model — a withdrawal
 * followed by a resubmission is, structurally, the exact same record,
 * not a new one. This file's own duplicate-prevention key (student +
 * badge type + this one record's own badgeAwards array) already matches
 * that reality: hasActiveBadgeAward() only ever looks at the CURRENT
 * record's non-revoked entries, so revoking on withdrawal and then
 * re-evaluating on resubmission is sufficient — no migration to a
 * per-attempt data model is needed for this feature. See
 * revokeReadinessChampionOnWithdrawal()'s own comment for exactly how
 * this plays out across a withdraw/resubmit cycle.
 *
 * PERMISSIONS — enforced here, at the application/service layer ONLY,
 * via services/permissionService.js's own canPerformAsUid() against the
 * new PERMISSIONS.AWARD_NOTEBOOK_BADGE (config/memberRoles.js), granted
 * to OWNER/TEACHER only. THIS IS NOT FIRESTORE-ENFORCED AUTHORIZATION —
 * explicit product decision, not an oversight: the classroom document's
 * one blanket `allow update` rule (firestore.rules) already grants any
 * authenticated member write access to the ENTIRE document (no
 * per-field/per-role narrowing exists anywhere in this app today, for
 * ANY permission — AWARD_POINTS, EDIT_STUDENTS, etc. are all exactly
 * this same shape), so a client that writes to Firestore directly,
 * bypassing this service's own canPerformAsUid() checks, CAN currently
 * award/override/revoke a Notebook Tracker badge regardless of role.
 * Retrofitting true rule-layer enforcement would mean restructuring
 * that single, shared, every-feature-depends-on-it rule — a
 * disproportionate, high-blast-radius change explicitly ruled out of
 * scope for this feature. Do not treat this file's own permission
 * checks as satisfying a "data/security-layer" authorization
 * requirement — they satisfy the APPLICATION layer only. See the
 * tracked follow-up: investigate targeted Firestore rule enforcement
 * (or routing badge-award writes through a trusted backend/Cloud
 * Function) before this feature is considered for production
 * deployment.
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
    revokedReason: null,
  };
  record.badgeAwards.push(entry);
  return entry;
}

/**
 * Shared revocation mechanics for Readiness Champion — finds whichever
 * entry is currently active (regardless of source: automatic or
 * override) and marks it revoked IN PLACE, decrementing the displayed
 * count. Returns the revoked entry, or null if nothing was active
 * (idempotent — safe to call repeatedly with no further effect past the
 * first real revocation). Callers decide what "nothing active" means
 * for their own case: revokeReadinessChampion() (explicit teacher
 * action) throws on it; revokeReadinessChampionOnWithdrawal() (an
 * automatic side effect) treats it as the normal, already-handled case.
 */
function revokeActiveReadinessAward(classroom, checkpoint, student, actingUid, reason) {
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const activeEntry = listBadgeAwardsForRecord(record, READINESS_CHAMPION_BADGE_ID).find((entry) => !entry.revoked);
  if (!activeEntry) return null;

  activeEntry.revoked = true;
  activeEntry.revokedBy = actingUid;
  activeEntry.revokedAt = getCurrentIsoDate();
  activeEntry.revokedReason = reason;
  notebookBadgeService.revokeNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
  return activeEntry;
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

  const revoked = revokeActiveReadinessAward(classroom, checkpoint, student, actingUid, 'teacher_revoked');
  if (!revoked) {
    throw new Error('No active Readiness Champion award to revoke for this student on this checkpoint.');
  }
  return student.notebookBadgeCounts?.[READINESS_CHAMPION_BADGE_ID] ?? 0;
}

/**
 * Automatic counterpart to revokeReadinessChampion() — called whenever
 * a submission is walked back from 'submitted' to 'not_submitted' (see
 * checkpointService.setSubmission()'s own 'not_submitted' branch),
 * never a primary teacher command. Revokes whichever Readiness Champion
 * award is currently active on this exact record, AUTOMATIC or
 * OVERRIDE alike — an override is a teacher's own belief that "this
 * submission counts as on time," and that belief no longer has a real
 * submission underneath it once withdrawn, so it is revoked exactly the
 * same way (this is what satisfies "an override associated with a
 * withdrawn submission cannot leave a stale award active").
 *
 * IDEMPOTENT and NEVER THROWS: if there is nothing active to revoke
 * (nothing was ever awarded, or a prior call/undo already revoked it —
 * e.g. the teacher toggles Submitted -> Not Submitted -> Submitted ->
 * Not Submitted again before saving), this is simply a no-op, matching
 * evaluateReadinessChampion()'s own "a side effect of an
 * already-permitted action must never abort or surface as an error"
 * contract. Organization/Punctuation Champion are never touched here —
 * see this file's own header comment on why.
 *
 * Because checkpointService.js reuses the SAME record across a
 * withdraw/resubmit cycle (see this file's own "SUBMISSION ATTEMPT
 * IDENTITY" header comment), this revocation plus
 * evaluateReadinessChampion()'s own existing duplicate guard together
 * are sufficient to prevent a stale or duplicate award surviving a
 * resubmission: withdrawing revokes whatever was active; a later
 * resubmission calls evaluateReadinessChampion() fresh, which only ever
 * sees the CURRENT submittedDate (not the withdrawn one) and the
 * CURRENT badgeAwards state (the earlier entry now revoked, so it no
 * longer blocks a new award) — a late resubmission correctly does NOT
 * retain an earlier on-time award, and an on-time resubmission
 * correctly CAN earn a fresh one.
 *
 * Deliberately UNGATED by canAwardNotebookBadge(), unlike every other
 * mutating function in this file — this is not a discretionary "award"
 * decision an unprivileged uid could abuse, it is a deterministic
 * data-integrity correction tied 1:1 to a submission fact that the
 * caller (already performing the withdrawal itself) has already
 * changed. Gating this the same way as a grant would risk exactly the
 * outcome this function exists to prevent: a stale, factually-wrong
 * "submitted on time" badge surviving a withdrawal because the acting
 * uid happened to lack the narrower badge permission. `actingUid` is
 * still recorded as `revokedBy` on the audit entry either way — this
 * only skips the AUTHORIZATION check, never the audit trail.
 */
export function revokeReadinessChampionOnWithdrawal(classroom, checkpoint, student, actingUid) {
  const revoked = revokeActiveReadinessAward(classroom, checkpoint, student, actingUid, 'submission_withdrawn');
  return revoked ? student.notebookBadgeCounts?.[READINESS_CHAMPION_BADGE_ID] ?? 0 : null;
}
