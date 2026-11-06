/**
 * services/notebookBadgeAwardService.js
 *
 * The Notebook Tracker's Organization / Punctuation Champion
 * badge-AWARDING workflow — sibling to services/notebookBadgeService.js
 * (which only owns the classroom's own badge-type catalog and the
 * aggregate per-student count/display), the same "service owns
 * mutation, caller persists" split every other service in this app
 * already uses (see services/checkpointService.js's own header
 * comment).
 *
 * READINESS CHAMPION MOVED OUT (notebook-level rework): this file used
 * to also own Readiness Champion's automatic/override/revoke logic,
 * evaluated per individual checkpoint submission — a bug (one
 * on-time checkpoint could award a badge even while other required
 * checkpoints in the same notebook were still pending). That entire
 * mechanism (evaluateReadinessChampion(), overrideReadinessChampion(),
 * revokeReadinessChampion(), revokeReadinessChampionOnWithdrawal(), and
 * the per-checkpoint `badgeAwards[]` array they drove) has been removed
 * from this file — see services/notebookReadinessChampionService.js,
 * which now owns Readiness Champion exclusively, evaluated against an
 * entire subject notebook's completeness rather than any one
 * checkpoint. `READINESS_CHAMPION_BADGE_ID` stays defined here (several
 * existing call sites already import it from this file) and is
 * re-exported, unchanged, from the new file too.
 *
 * The one remaining trigger shape in this file:
 *   - Organization / Punctuation Champion (REVIEW_COMPLETION_BADGE_IDS):
 *     always a TEACHER'S OWN manual decision, but only ever offered once
 *     a review has genuinely been marked 'complete' (see
 *     checkpointService.setReview()) — marking a submission 'submitted'
 *     alone is never enough, by explicit instruction. See
 *     awardReviewCompletionBadge() below.
 *
 * Every mutating function here takes the real StudentCheckpointRecord
 * (found via checkpointService.getRecordForStudent() — always expected
 * to already exist for every path this file's own callers reach it
 * from) and mutates it plus the given Student in place; the caller
 * persists afterward, mirroring checkpointService.js's own established
 * convention exactly. `hasActiveBadgeAward()`/`listBadgeAwardsForRecord()`/
 * `pushAwardEntry()` below are the duplicate-prevention/audit-trail
 * primitives awardReviewCompletionBadge() itself uses — they are no
 * longer Readiness-Champion-specific (notebookReadinessChampionService.js
 * uses its own, separate append-only `student.history` ledger instead,
 * not this file's per-checkpoint `badgeAwards[]` array).
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
 * design (the same principle services/notebookReadinessChampionService.js's
 * own revokeReadinessChampionForNotebook() documents for its own,
 * separate ledger).
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

// Readiness Champion's automatic/override/revoke logic used to live
// here — see this file's own header comment for why it moved to
// services/notebookReadinessChampionService.js (notebook-level
// evaluation, not per-checkpoint).
