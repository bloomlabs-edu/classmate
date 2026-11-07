/**
 * services/notebookReadinessChampionService.js
 *
 * Readiness Champion, redesigned to recognize completion of an ENTIRE
 * subject notebook — every one of its currently-configured checkpoints
 * submitted on or before its own due date — replacing the previous
 * per-checkpoint model that used to live in notebookBadgeAwardService.js
 * (evaluateReadinessChampion()/overrideReadinessChampion()/
 * revokeReadinessChampion()/revokeReadinessChampionOnWithdrawal(), and
 * the per-checkpoint `badgeAwards[]` array they drove, have all been
 * removed from that file — see its own header comment). This file owns
 * Readiness Champion exclusively from here on; Organization/Punctuation
 * Champion (REVIEW_COMPLETION_BADGE_IDS) remain in
 * notebookBadgeAwardService.js, untouched — a genuinely separate
 * manual-award mechanism this redesign has no bearing on.
 *
 * WHY THE PREVIOUS MODEL WAS WRONG: the old evaluateReadinessChampion()
 * awarded on ANY single on-time checkpoint submission, with its own
 * duplicate guard scoped to that ONE checkpoint's own record — a
 * 5-checkpoint notebook with 5 on-time submissions produced 5 separate
 * awards, not 1. Readiness Champion is meant to recognize a student
 * being ready across an entire notebook, not any one unit — submitting
 * one on-time checkpoint must never award a badge while other required
 * checkpoints in the same notebook remain pending.
 *
 * DATA MODEL — moved OFF the old `badgeAwards[]` array (which lived on
 * one checkpoint's own StudentCheckpointRecord — the wrong place to
 * track a notebook-wide fact) and ONTO `student.history`, the same
 * append-only ledger services/recognitionService.js already uses for
 * Completion Star. Every entry has `kind: 'readiness-champion'`, a
 * `workItemRef` of a NEW type, `'notebook_readiness'` (bare
 * `{ subjectId, notebookTypeId }`, no checkpointId/dateKey —
 * recognitionService.js's own three existing workItemRef types
 * (`'notebook'`, `'assignment_checkpoint'`, `'notebook_checkpoint'`)
 * all key to one checkpoint or one dated entry; the closest existing
 * precedent for a whole-notebook identity is actually
 * services/workRequestService.js's own WorkRequest keying, which is
 * exactly this same bare `{subjectId, notebookTypeId}` shape), a
 * `source` (`'automatic'` | `'override'` | `'retroactive_backfill'`),
 * and `delta` (+1 award / -1 reversal) used PURELY for net-sum
 * duplicate-prevention — this never touches `student.score`
 * (timelineService.logEntry() only increments score for
 * `kind: 'points'`). Nothing here is ever mutated in place once
 * written; a correction is always a new, appended, labeled entry.
 *
 * THREE INDEPENDENT NET-SUM POOLS, one per `source`, mirror
 * recognitionService.getAutomaticStarNetForWorkItem()'s own "sum of
 * deltas for this exact ref, never a boolean flag" idiom exactly, but
 * three parallel pools instead of one — so the automatic re-evaluator
 * below can tell "this notebook's active state came from an automatic
 * award" (safe to auto-revoke if the notebook later becomes
 * incomplete/late) apart from "...from a teacher override or a
 * retroactive backfill" (NEVER auto-revoked; only an explicit teacher
 * revoke action touches those). At most one pool is ever net-positive
 * at a time in practice (evaluateReadinessChampionForNotebook() below
 * never auto-awards on top of an already-active override/backfill),
 * but revokeReadinessChampionForNotebook() (an explicit teacher action)
 * zeroes out whichever pool(s) are positive, robustly, regardless.
 *
 * HISTORICAL-CONFIGURATION LIMITATION — read
 * computeNotebookCompleteness()'s own comment below before touching
 * anything here: checkpointService.deleteCheckpoint() is a hard
 * removal with zero trace anywhere in this codebase (confirmed by an
 * exhaustive search for any audit-log/history mechanism — there is
 * none), so a deleted checkpoint can never be detected. This is a
 * structural limitation of the data itself, explicitly accepted as a
 * disclosed caveat (see notebookReadinessChampionAuditService.js's own
 * header) rather than grounds to refuse every historical
 * classification.
 */

import * as checkpointService from './checkpointService.js';
import * as notebookBadgeService from './notebookBadgeService.js';
import { canAwardNotebookBadge, READINESS_CHAMPION_BADGE_ID } from './notebookBadgeAwardService.js';
import { workItemRefsEqual } from './recognitionService.js';
import { logEntry } from './timelineService.js';
import { isValidDateKey } from '../utils/dateHelpers.js';

export { READINESS_CHAMPION_BADGE_ID };

export function buildNotebookReadinessWorkItemRef({ subjectId, notebookTypeId }) {
  return { type: 'notebook_readiness', subjectId, notebookTypeId };
}

/**
 * The single source of truth for "is this notebook complete, and was
 * every required checkpoint submitted on or before its own due date" —
 * reused identically by the live lifecycle below AND by
 * notebookReadinessChampionAuditService.js's historical audit, so the
 * two can never silently diverge on what "complete and on time" means.
 *
 * `referenceDate` (optional, a date-key string) restricts the required
 * set to checkpoints whose own `createdAt` is on or before that date —
 * exposed for callers that have a meaningful historical reference point
 * of their own; the live lifecycle below never passes this (the current
 * full checkpoint list IS the reference point when asking "is this
 * notebook complete right now"), and the audit in
 * notebookReadinessChampionAuditService.js also does not pass one by
 * default (see that file's own header for why no automatic choice of
 * reference date is reliable enough to pick on a caller's behalf).
 *
 * A checkpoint with NO due date (`''`, unset) is treated as compatible
 * with "on time" — never late, by the exact same construction as
 * checkpointService.isLate() itself ("a submission cannot be classified
 * as late if there is no due date"); this function stays consistent
 * with that existing rule rather than inventing a stricter one. A
 * checkpoint whose due date IS set but is not a well-formed date key
 * (malformed data), or a submitted record whose own submittedDate is
 * not a well-formed date key, makes that one checkpoint's own
 * timeliness UNRESOLVABLE — contributes to `insufficientEvidenceCount`,
 * never guessed either way.
 *
 * A notebook with zero required checkpoints is never "complete" —
 * nothing to be champion of — guarding the vacuous-truth case
 * explicitly rather than leaving an empty-array edge case undefined.
 */
export function computeNotebookCompleteness(classroom, subjectId, notebookTypeId, studentId, { referenceDate = null } = {}) {
  const allCheckpoints = checkpointService.listCheckpointsForNotebook(classroom, subjectId, notebookTypeId);
  const requiredCheckpoints = referenceDate
    ? allCheckpoints.filter((cp) => !cp.createdAt || cp.createdAt.slice(0, 10) <= referenceDate)
    : allCheckpoints;

  const checkpointResults = requiredCheckpoints.map((checkpoint) => {
    const record = checkpointService.getRecordForStudent(checkpoint, studentId);
    if (!record || record.submissionStatus !== 'submitted') {
      return { checkpointId: checkpoint.id, status: 'pending' };
    }
    const hasDueDate = !!checkpoint.dueDate;
    const dueDateValid = !hasDueDate || isValidDateKey(checkpoint.dueDate);
    const submittedDateValid = isValidDateKey(record.submittedDate);
    if (!submittedDateValid || !dueDateValid) {
      return { checkpointId: checkpoint.id, status: 'insufficient_evidence' };
    }
    const late = hasDueDate && record.submittedDate > checkpoint.dueDate;
    return { checkpointId: checkpoint.id, status: late ? 'late' : 'on_time' };
  });

  const totalRequired = requiredCheckpoints.length;
  const pendingCount = checkpointResults.filter((r) => r.status === 'pending').length;
  const onTimeCount = checkpointResults.filter((r) => r.status === 'on_time').length;
  const lateCount = checkpointResults.filter((r) => r.status === 'late').length;
  const insufficientEvidenceCount = checkpointResults.filter((r) => r.status === 'insufficient_evidence').length;
  const submittedCount = onTimeCount + lateCount + insufficientEvidenceCount;

  const isComplete = totalRequired > 0 && pendingCount === 0;
  const hasInsufficientEvidence = insufficientEvidenceCount > 0;
  const isCompleteAndOnTime = isComplete && lateCount === 0 && !hasInsufficientEvidence;

  return {
    subjectId,
    notebookTypeId,
    studentId,
    totalRequired,
    submittedCount,
    pendingCount,
    onTimeCount,
    lateCount,
    insufficientEvidenceCount,
    isComplete,
    isCompleteAndOnTime,
    hasInsufficientEvidence,
    checkpointResults,
  };
}

function getNetForSource(student, workItemRef, source) {
  return (student.history || [])
    .filter((e) => e.kind === 'readiness-champion' && e.source === source && workItemRefsEqual(e.workItemRef, workItemRef))
    .reduce((sum, e) => sum + e.delta, 0);
}

export function getAutomaticReadinessNetForNotebook(student, workItemRef) {
  return getNetForSource(student, workItemRef, 'automatic');
}
export function getOverrideReadinessNetForNotebook(student, workItemRef) {
  return getNetForSource(student, workItemRef, 'override');
}
export function getBackfillReadinessNetForNotebook(student, workItemRef) {
  return getNetForSource(student, workItemRef, 'retroactive_backfill');
}

/** True if ANY of the three source-pools is currently net-active for this exact notebook — the one check every awarding path below consults before pushing a new entry. */
export function isReadinessChampionActiveForNotebook(student, workItemRef) {
  return (
    getAutomaticReadinessNetForNotebook(student, workItemRef) >= 1 ||
    getOverrideReadinessNetForNotebook(student, workItemRef) >= 1 ||
    getBackfillReadinessNetForNotebook(student, workItemRef) >= 1
  );
}

/**
 * Every distinct notebook this student has ANY Readiness Champion
 * history for at all (not just currently-active ones), each tagged with
 * `active` (same `isReadinessChampionActiveForNotebook()` check above).
 * Exported specifically so services/legacyReadinessChampionMigrationService.js's
 * own counter-reconciliation step can derive "how many notebooks are
 * genuinely active for this student, across every notebook, right now"
 * directly from this file's own net-sum ledger truth, rather than
 * re-deriving or guessing at it independently.
 */
export function listReadinessChampionNotebookRefsForStudent(student) {
  const seen = new Map();
  for (const entry of student.history || []) {
    if (entry.kind !== 'readiness-champion' || !entry.workItemRef) continue;
    const key = `${entry.workItemRef.subjectId}::${entry.workItemRef.notebookTypeId}`;
    if (!seen.has(key)) seen.set(key, { subjectId: entry.workItemRef.subjectId, notebookTypeId: entry.workItemRef.notebookTypeId });
  }
  return [...seen.values()].map((ref) => ({ ...ref, active: isReadinessChampionActiveForNotebook(student, buildNotebookReadinessWorkItemRef(ref)) }));
}

/**
 * Count of distinct subject notebooks CURRENTLY carrying an active
 * Readiness Champion award for this student, from ANY of the three
 * source pools — one notebook with both an active override AND stray
 * history from a different, already-net-zero source still counts once,
 * never per history entry and never per pool. This is the single
 * source of truth ui/views/NotebookCheckpointsView.js's own row-level
 * badge chip must read for this badge type, instead of the legacy,
 * disconnected `student.notebookBadgeCounts['readiness-champion']`
 * aggregate (found during the 2026-11-07 production display-
 * discrepancy investigation: that legacy counter is only ever written
 * by the old, now-deleted per-checkpoint award functions and by this
 * file's own live award/revoke calls into notebookBadgeService.js —
 * never by anything that reads it back out, so a student whose
 * notebook was never re-evaluated after this redesign shipped, or
 * whose legacy count has no corresponding entry in this file's own
 * ledger, shows a stale or entirely disconnected number). Reuses
 * listReadinessChampionNotebookRefsForStudent() above rather than
 * re-deriving the same net-sum logic a second time.
 */
export function countActiveReadinessChampionNotebooksForStudent(student) {
  return listReadinessChampionNotebookRefsForStudent(student).filter((ref) => ref.active).length;
}

/** Returns, for this student+notebook, which of the three source labels currently has a net-active pool (there is normally at most one) — used by the cell editor UI to describe how an active award was granted. */
export function getActiveReadinessSourcesForNotebook(student, workItemRef) {
  return ['automatic', 'override', 'retroactive_backfill'].filter((source) => getNetForSource(student, workItemRef, source) >= 1);
}

function appendReadinessEntry(student, { label, delta, source, workItemRef, ...meta }) {
  return logEntry(student, { kind: 'readiness-champion', label, delta, source, workItemRef, ...meta });
}

/**
 * Automatic — intended to be re-evaluated after every submission,
 * withdrawal, due-date change, or checkpoint add/delete event touching
 * this notebook (see ui/views/NotebookCheckpointsView.js's own call
 * sites). Never gated on "is this the final required checkpoint" —
 * re-checking full completeness on every event is simpler and exactly
 * as correct, since an award only actually fires once
 * computeNotebookCompleteness() genuinely reports complete-and-on-time.
 * Never throws; every non-applicable case is a silent no-op, matching
 * the old evaluateReadinessChampion()'s own "never abort/roll back the
 * event it's reacting to" contract.
 *
 * REVOCATION EVIDENCE POLICY (post-review hardening, 2026-11-06): an
 * active AUTOMATIC award is only ever auto-revoked here on CONFIRMED
 * evidence the notebook violates the rule — a required checkpoint still
 * pending (never submitted), or a required checkpoint genuinely late
 * (both its own `submittedDate` and the checkpoint's `dueDate`
 * well-formed and `submittedDate` after `dueDate`). `hasInsufficientEvidence`
 * ALONE (some OTHER required checkpoint's `dueDate`/`submittedDate`
 * missing-but-set or malformed, with nothing else confirmed wrong) is
 * explicitly NEVER, on its own, grounds to revoke — inability to
 * establish eligibility is not proof of ineligibility, the same
 * principle the old per-checkpoint evaluateReadinessChampion() already
 * applied to a malformed `dueDate` ("an existing award is never revoked
 * just because a due date was cleared or is malformed — there is no way
 * to tell whether the award was earned honestly"). An earlier draft of
 * this function treated `hasInsufficientEvidence` as revocation grounds
 * just like a confirmed violation, silently narrowing that old
 * protection to cover only a malformed `submittedDate`, not a malformed
 * `dueDate` — corrected here. If the evidence later becomes
 * re-establishable (a due date is corrected back to something
 * well-formed) and the notebook genuinely is complete-and-on-time, the
 * very next re-evaluation (this same function, called again) awards it
 * exactly as if nothing had ever gone wrong — no separate "restore"
 * action is needed.
 */
export function evaluateReadinessChampionForNotebook(classroom, subjectId, notebookTypeId, student, actingUid) {
  const workItemRef = buildNotebookReadinessWorkItemRef({ subjectId, notebookTypeId });
  const completeness = computeNotebookCompleteness(classroom, subjectId, notebookTypeId, student.id);
  const automaticNet = getAutomaticReadinessNetForNotebook(student, workItemRef);
  const overrideActive = getOverrideReadinessNetForNotebook(student, workItemRef) >= 1;
  const backfillActive = getBackfillReadinessNetForNotebook(student, workItemRef) >= 1;

  if (completeness.isCompleteAndOnTime) {
    if (automaticNet >= 1 || overrideActive || backfillActive) return null; // already active from some source
    if (!canAwardNotebookBadge(classroom, actingUid)) return null;
    appendReadinessEntry(student, { label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef });
    return notebookBadgeService.awardNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
  }

  // Not currently complete-and-on-time. A CONFIRMED violation (pending or
  // late) revokes an active AUTOMATIC award, deterministically and
  // ungated — the same shape as the old evaluateReadinessChampion()'s own
  // re-validation-on-every-call behavior. Insufficient evidence alone
  // (see this function's own header comment) never reaches this branch.
  // A teacher OVERRIDE or a retroactive BACKFILL is never touched by this
  // automatic re-check regardless; only an explicit teacher revoke action
  // can undo those.
  const hasConfirmedViolation = completeness.pendingCount > 0 || completeness.lateCount > 0;
  if (automaticNet >= 1 && hasConfirmedViolation) {
    const reason = completeness.pendingCount > 0 ? 'notebook_incomplete' : 'notebook_late';
    appendReadinessEntry(student, { label: 'Readiness Champion Reversed', delta: -1, source: 'automatic', workItemRef, reason });
    notebookBadgeService.revokeNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
  }
  return null;
}

/**
 * Teacher override — awards despite the automatic rule not applying
 * (e.g. the teacher has an independent reason to treat an incomplete or
 * late notebook as earning this). Throws on misuse, matching every
 * other explicit teacher-commanded award/revoke in this app.
 */
export function overrideReadinessChampionForNotebook(classroom, subjectId, notebookTypeId, student, actingUid) {
  if (!canAwardNotebookBadge(classroom, actingUid)) {
    throw new Error("Not authorized to award Readiness Champion — must be this classroom's owner or a co-teacher.");
  }
  const workItemRef = buildNotebookReadinessWorkItemRef({ subjectId, notebookTypeId });
  if (isReadinessChampionActiveForNotebook(student, workItemRef)) {
    throw new Error('Readiness Champion has already been awarded for this notebook.');
  }
  appendReadinessEntry(student, { label: 'Readiness Champion (override)', delta: 1, source: 'override', workItemRef });
  return notebookBadgeService.awardNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
}

/**
 * Explicit teacher revoke — revokes whichever pool(s) (automatic/
 * override/retroactive backfill) are currently active for this
 * notebook. Throws if nothing is active, matching this app's "never
 * silently no-op an explicit command" convention.
 *
 * COUNTER INTEGRITY (post-review hardening, 2026-11-06): decrements the
 * displayed count ONCE PER ACTIVE POOL being revoked here, never a flat
 * single decrement — each pool's own earlier award call
 * (evaluateReadinessChampionForNotebook()'s automatic branch,
 * overrideReadinessChampionForNotebook(), or a future backfill-applying
 * function) independently incremented the counter exactly once via
 * notebookBadgeService.awardNotebookBadge(), so reversing N currently-
 * active pools must call notebookBadgeService.revokeNotebookBadge()
 * exactly N times to stay consistent. An earlier draft of this function
 * called revokeNotebookBadge() only once per invocation regardless,
 * relying on the (today still accurate, but not permanently guaranteed)
 * assumption that this codebase's own reachable API surface never
 * produces more than one simultaneously-active pool — corrected here so
 * the invariant holds structurally rather than by the absence of a
 * counter-example, and so it keeps holding if a future backfill-applying
 * function (see the migration work this redesign anticipates) ever adds
 * a `retroactive_backfill` entry alongside an active `automatic` or
 * `override` one. Every pool still gets its own, individually-labeled
 * reversal history entry (append-only, never collapsed into one).
 * Idempotent in the same way every other explicit command in this file
 * is: a second call once nothing is left active throws (`activePools.length
 * === 0` below), it never silently no-ops and never double-decrements.
 */
export function revokeReadinessChampionForNotebook(classroom, subjectId, notebookTypeId, student, actingUid) {
  if (!canAwardNotebookBadge(classroom, actingUid)) {
    throw new Error("Not authorized to revoke Readiness Champion — must be this classroom's owner or a co-teacher.");
  }
  const workItemRef = buildNotebookReadinessWorkItemRef({ subjectId, notebookTypeId });
  const activePools = getActiveReadinessSourcesForNotebook(student, workItemRef);
  if (activePools.length === 0) {
    throw new Error('No active Readiness Champion award to revoke for this notebook.');
  }
  let count;
  activePools.forEach((source) => {
    appendReadinessEntry(student, {
      label: 'Readiness Champion Revoked',
      delta: -1,
      source,
      workItemRef,
      reason: 'teacher_revoked',
      revokedBy: actingUid,
    });
    count = notebookBadgeService.revokeNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
  });
  return count;
}

/**
 * Re-evaluates every student in the classroom against this one notebook
 * — used after a structural change to the notebook itself (a checkpoint
 * added, deleted, or its due date edited) rather than a single
 * student's own submission event, since any of those can change
 * completeness for every student at once, not just one.
 */
export function reevaluateReadinessChampionForAllStudents(classroom, subjectId, notebookTypeId, actingUid) {
  for (const team of classroom.teams || []) {
    for (const student of team.students || []) {
      evaluateReadinessChampionForNotebook(classroom, subjectId, notebookTypeId, student, actingUid);
    }
  }
}
