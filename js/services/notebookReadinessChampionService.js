/**
 * services/notebookReadinessChampionService.js
 *
 * Readiness Champion, redesigned a second time (2026-11-07 product
 * decision) into a PERMANENT, PER-INSPECTION award: creating a fresh
 * checkpoint (a new unit) in a subject notebook is an inspection event.
 * At that moment, every student whose PREVIOUSLY assigned required
 * checkpoints (every checkpoint that existed before the new one) are
 * all complete earns one badge for that exact event. Historical
 * lateness is irrelevant. Once earned, a badge is never revoked —
 * not automatically, and no correction workflow is authorized by this
 * change. A student can earn multiple badges for the same notebook,
 * one per qualifying checkpoint-creation event over time.
 *
 * THIS SUPERSEDES THE PRIOR NOTEBOOK-LEVEL MODEL (2026-11-06), which
 * tracked a single "currently active or not" boolean per (student,
 * notebook) via net-summed `delta: +1/-1` entries, auto-revoked on any
 * later incomplete/late checkpoint, and re-evaluated on every
 * submission, review, withdrawal, checkpoint edit, and checkpoint
 * deletion. That entire live lifecycle
 * (evaluateReadinessChampionForNotebook() / overrideReadinessChampionForNotebook() /
 * revokeReadinessChampionForNotebook() / reevaluateReadinessChampionForAllStudents(),
 * see their own "LEGACY (old model) live lifecycle" section below) has
 * been removed from every live call site in
 * ui/views/NotebookCheckpointsView.js — it is UNREACHABLE from any UI
 * as of this redesign, and its auto-revoke behavior is exactly what the
 * new product rule forbids ("never automatically revoke," "no
 * submission/review/withdrawal/edit/deletion event may award or
 * revoke"). The functions themselves remain in this file, unexported-
 * in-spirit (kept only for the archived audit/migration services' own
 * test fixtures — see that section's own header for exactly why), so
 * no live or new code path writes `delta:-1` for this `kind` ever
 * again.
 *
 * LEGACY DATA — PRESERVED, NEVER REINTERPRETED: entries already
 * written under the OLD model (`workItemRef.type === 'notebook_readiness'`,
 * no `checkpointId` — bare `{subjectId, notebookTypeId}`) remain
 * exactly as they are on `student.history`, forever. This includes any
 * `delta: -1` reversal entries the old automatic-revoke branch already
 * wrote in production before this redesign. Nothing here edits,
 * deletes, or migrates them. The helpers below that read this OLD
 * shape (computeNotebookCompleteness's legacy-compatible core,
 * buildNotebookReadinessWorkItemRef, the net-sum getters,
 * isReadinessChampionActiveForNotebook, listReadinessChampionNotebookRefsForStudent,
 * countActiveReadinessChampionNotebooksForStudent, getActiveReadinessSourcesForNotebook)
 * are retained ONLY so (a) services/notebookReadinessChampionAuditService.js
 * and services/legacyReadinessChampionMigrationService.js — both kept
 * as archived, unused-by-the-app code per explicit product decision —
 * still import successfully, and (b) the UI can display an honest,
 * clearly-labeled "Previous system — historical awards" count for
 * these old entries using the OLD model's own terms, WITHOUT asserting
 * whether they would have qualified under the new per-inspection rule
 * (no inspection-event checkpoint reference exists on old entries to
 * check that against — any such claim would be unsupported). Nothing
 * in this file ever merges an old-shape count into the new
 * countReadinessChampionAchievementsForStudent() total below; the two
 * are deliberately kept separate end to end, from the ledger up
 * through the UI.
 *
 * NEW DATA MODEL — one ledger entry per (student, qualifying inspection
 * event), `kind: 'readiness-champion'`, `delta: 1` always (no reversal
 * shape exists for this entry type), `source: 'automatic'`, and a
 * `workItemRef` of type `'notebook_readiness_inspection'`:
 * `{ type, subjectId, notebookTypeId, checkpointId }` — `checkpointId`
 * is the id of the NEWLY CREATED checkpoint whose introduction
 * triggered this exact inspection, making each entry's own identity
 * unique per event (two qualifying checkpoint-creation events for the
 * same notebook produce two independent, permanent entries — this is
 * the intended "multiple badges per notebook" behavior, not a bug).
 * recognitionService.workItemRefsEqual() compares type AND every key,
 * including key count, so an old-shape ref (3 keys, type
 * 'notebook_readiness') can never accidentally match a new-shape ref
 * (4 keys, type 'notebook_readiness_inspection') — the two ledgers
 * coexist on the same `student.history` array without risk of
 * cross-contamination.
 */

import * as checkpointService from './checkpointService.js';
import * as notebookBadgeService from './notebookBadgeService.js';
import { canAwardNotebookBadge, READINESS_CHAMPION_BADGE_ID } from './notebookBadgeAwardService.js';
import { workItemRefsEqual } from './recognitionService.js';
import { logEntry } from './timelineService.js';
import { isValidDateKey } from '../utils/dateHelpers.js';

export { READINESS_CHAMPION_BADGE_ID };

/** LEGACY (old model) ref shape — retained only for reading pre-redesign history and for services/notebookReadinessChampionAuditService.js + services/legacyReadinessChampionMigrationService.js, both archived and unused by the live app. Never written to again by any live code path. */
export function buildNotebookReadinessWorkItemRef({ subjectId, notebookTypeId }) {
  return { type: 'notebook_readiness', subjectId, notebookTypeId };
}

/** The new per-inspection-event ref shape — one distinct identity per (subjectId, notebookTypeId, checkpointId), where checkpointId is the newly-created checkpoint that triggered this exact inspection. */
export function buildNotebookReadinessInspectionWorkItemRef({ subjectId, notebookTypeId, checkpointId }) {
  return { type: 'notebook_readiness_inspection', subjectId, notebookTypeId, checkpointId };
}

/**
 * The single source of truth for "is this notebook's required work
 * complete, and was it on time" — shared by the live award path below,
 * the archived legacy audit service, and the archived legacy migration
 * service, so none of them can silently diverge on what "complete"
 * means for the same classroom data.
 *
 * `excludeCheckpointIds` (new, 2026-11-07) drops specific checkpoints
 * from the required set BY ID — used by the live inspection path below
 * to evaluate "every PREVIOUSLY assigned required checkpoint" by
 * excluding the brand-new checkpoint that triggered this exact
 * inspection. Deliberately an id-based exclusion rather than a
 * date-based one: `referenceDate` (below) only has day granularity, so
 * two checkpoints created on the same calendar day would be
 * indistinguishable by date alone — excluding by id is exact regardless
 * of how many checkpoints were created on the same day.
 *
 * `referenceDate` (optional, a date-key string, pre-existing) restricts
 * the required set to checkpoints whose own `createdAt` is on or before
 * that date — used only by the archived legacy migration service's own
 * historical reference-date reconstruction. The live inspection path
 * below never passes this; it uses `excludeCheckpointIds` instead, for
 * the exact-id reason above.
 *
 * A checkpoint with NO due date (`''`, unset) is treated as compatible
 * with "on time" — never late, by the exact same construction as
 * checkpointService.isLate() itself. A checkpoint whose due date IS set
 * but malformed, or a submitted record whose own submittedDate is
 * malformed, makes that one checkpoint's own timeliness UNRESOLVABLE —
 * contributes to `insufficientEvidenceCount`, never guessed either way
 * (this still matters for `isCompleteAndOnTime`, kept for any caller —
 * such as the archived legacy audit/migration services — that still
 * needs it; the new live inspection path itself uses `isComplete`
 * only, since lateness is explicitly irrelevant to the new rule).
 *
 * A notebook with zero required checkpoints is never "complete" —
 * nothing to be champion of — guarding the vacuous-truth case
 * explicitly rather than leaving an empty-array edge case undefined.
 */
export function computeNotebookCompleteness(classroom, subjectId, notebookTypeId, studentId, { referenceDate = null, excludeCheckpointIds = [] } = {}) {
  const excludeSet = new Set(excludeCheckpointIds);
  const allCheckpoints = checkpointService.listCheckpointsForNotebook(classroom, subjectId, notebookTypeId).filter((cp) => !excludeSet.has(cp.id));
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

// ---------------------------------------------------------------------
// LEGACY (old model) read helpers — retained for the archived audit and
// migration services and for an honest, separately-labeled "Previous
// system" display only. Never written to by any live code path below.
// ---------------------------------------------------------------------

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

/** LEGACY. True if any OLD-model source-pool is currently net-active for this exact notebook. */
export function isReadinessChampionActiveForNotebook(student, workItemRef) {
  return (
    getAutomaticReadinessNetForNotebook(student, workItemRef) >= 1 ||
    getOverrideReadinessNetForNotebook(student, workItemRef) >= 1 ||
    getBackfillReadinessNetForNotebook(student, workItemRef) >= 1
  );
}

/** LEGACY. Every distinct notebook this student has any OLD-model Readiness Champion history for, each tagged with `active`. Used by the archived legacy migration service's own counter-reconciliation preview, and by countActiveReadinessChampionNotebooksForStudent() below for the UI's "Previous system" display. */
export function listReadinessChampionNotebookRefsForStudent(student) {
  const seen = new Map();
  for (const entry of student.history || []) {
    if (entry.kind !== 'readiness-champion' || entry.workItemRef?.type !== 'notebook_readiness') continue;
    const key = `${entry.workItemRef.subjectId}::${entry.workItemRef.notebookTypeId}`;
    if (!seen.has(key)) seen.set(key, { subjectId: entry.workItemRef.subjectId, notebookTypeId: entry.workItemRef.notebookTypeId });
  }
  return [...seen.values()].map((ref) => ({ ...ref, active: isReadinessChampionActiveForNotebook(student, buildNotebookReadinessWorkItemRef(ref)) }));
}

/**
 * LEGACY. Count of distinct subject notebooks still net-active under
 * the OLD model's own terms, for this student — the one, faithful,
 * never-reinterpreted number the UI may show under a clearly separate
 * "Previous system — historical awards" label (see
 * ui/views/NotebookCheckpointsView.js's own badge-chip code). This is
 * never added to countReadinessChampionAchievementsForStudent()'s own
 * total below, and never used to infer whether any individual old
 * entry would qualify under the new per-inspection rule.
 */
export function countActiveReadinessChampionNotebooksForStudent(student) {
  return listReadinessChampionNotebookRefsForStudent(student).filter((ref) => ref.active).length;
}

/** LEGACY. Which OLD-model source label(s) are currently net-active for this student+notebook — used by the archived legacy audit service's hasPriorAwardHistory bucket. */
export function getActiveReadinessSourcesForNotebook(student, workItemRef) {
  return ['automatic', 'override', 'retroactive_backfill'].filter((source) => getNetForSource(student, workItemRef, source) >= 1);
}

/** LEGACY. Every OLD-model Readiness Champion history entry (award OR reversal, any source) for this exact notebook, undeduplicated — for an honest, separate "Previous system" display only. Never used to infer anything about the new per-inspection rule. */
export function listLegacyReadinessChampionEntriesForNotebook(student, subjectId, notebookTypeId) {
  return (student.history || []).filter(
    (e) => e.kind === 'readiness-champion' && e.workItemRef?.type === 'notebook_readiness' && e.workItemRef.subjectId === subjectId && e.workItemRef.notebookTypeId === notebookTypeId
  );
}

// ---------------------------------------------------------------------
// LEGACY (old model) live lifecycle — UNREACHABLE FROM ANY LIVE UI as of
// the 2026-11-07 permanent per-inspection redesign. Every call site in
// ui/views/NotebookCheckpointsView.js has been removed (checkpoint
// create/edit/delete, submission, review, withdrawal, and save-cell all
// trigger nothing here any more). Retained ONLY because
// services/notebookReadinessChampionAuditService.js and
// services/legacyReadinessChampionMigrationService.js — both themselves
// archived and unused by the live app, per explicit 2026-11-07 product
// decision — and their own test fixtures still construct OLD-shape
// ledger entries by calling these functions directly. Not exported for
// any new use; do not wire these into any UI. In particular,
// evaluateReadinessChampionForNotebook()'s own auto-revoke branch is
// exactly the automatic-revocation behavior the new rule forbids
// ("never automatically revoke a Readiness Champion award") — it is
// safe only because nothing live calls it any more.
// ---------------------------------------------------------------------

export function evaluateReadinessChampionForNotebook(classroom, subjectId, notebookTypeId, student, actingUid) {
  const workItemRef = buildNotebookReadinessWorkItemRef({ subjectId, notebookTypeId });
  const completeness = computeNotebookCompleteness(classroom, subjectId, notebookTypeId, student.id);
  const automaticNet = getAutomaticReadinessNetForNotebook(student, workItemRef);
  const overrideActive = getOverrideReadinessNetForNotebook(student, workItemRef) >= 1;
  const backfillActive = getBackfillReadinessNetForNotebook(student, workItemRef) >= 1;

  if (completeness.isCompleteAndOnTime) {
    if (automaticNet >= 1 || overrideActive || backfillActive) return null;
    if (!canAwardNotebookBadge(classroom, actingUid)) return null;
    appendReadinessEntry(student, { label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef });
    return notebookBadgeService.awardNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
  }

  const hasConfirmedViolation = completeness.pendingCount > 0 || completeness.lateCount > 0;
  if (automaticNet >= 1 && hasConfirmedViolation) {
    const reason = completeness.pendingCount > 0 ? 'notebook_incomplete' : 'notebook_late';
    appendReadinessEntry(student, { label: 'Readiness Champion Reversed', delta: -1, source: 'automatic', workItemRef, reason });
    notebookBadgeService.revokeNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
  }
  return null;
}

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

export function reevaluateReadinessChampionForAllStudents(classroom, subjectId, notebookTypeId, actingUid) {
  for (const team of classroom.teams || []) {
    for (const student of team.students || []) {
      evaluateReadinessChampionForNotebook(classroom, subjectId, notebookTypeId, student, actingUid);
    }
  }
}

// ---------------------------------------------------------------------
// NEW (permanent, per-inspection) live award path
// ---------------------------------------------------------------------

function appendReadinessEntry(student, { label, delta, source, workItemRef, ...meta }) {
  return logEntry(student, { kind: 'readiness-champion', label, delta, source, workItemRef, ...meta });
}

/** True if this exact inspection event has already produced an entry for this student — the sole duplicate-prevention check for the new model (an existence check, not a net-sum, since this entry shape is never reversed). */
function hasReadinessInspectionEntry(student, workItemRef) {
  return (student.history || []).some((e) => e.kind === 'readiness-champion' && workItemRefsEqual(e.workItemRef, workItemRef));
}

/**
 * Every permanent Readiness Champion badge this student has earned,
 * optionally scoped to one subject notebook. A plain count of `+1`
 * inspection-event entries — never net-summed, never capped at one per
 * notebook, and never reduced by anything (no entry of this shape is
 * ever reversed). This is the one number the new UI must show as the
 * student's Readiness Champion achievement count, entirely separate
 * from the LEGACY count above.
 */
export function countReadinessChampionAchievementsForStudent(student, { subjectId, notebookTypeId } = {}) {
  return (student.history || []).filter(
    (e) =>
      e.kind === 'readiness-champion' &&
      e.workItemRef?.type === 'notebook_readiness_inspection' &&
      (!subjectId || e.workItemRef.subjectId === subjectId) &&
      (!notebookTypeId || e.workItemRef.notebookTypeId === notebookTypeId)
  ).length;
}

/** Every permanent inspection-event entry for one notebook, oldest first by insertion order — for the checkpoint editor's own history display (which checkpoint's introduction earned each badge, and when). */
export function listReadinessChampionAchievementsForNotebook(student, subjectId, notebookTypeId) {
  return (student.history || []).filter(
    (e) =>
      e.kind === 'readiness-champion' &&
      e.workItemRef?.type === 'notebook_readiness_inspection' &&
      e.workItemRef.subjectId === subjectId &&
      e.workItemRef.notebookTypeId === notebookTypeId
  );
}

/** Read-only preview: would this student qualify for a badge if a fresh unit were introduced right now. Awards nothing — never appends, never called by the live inspection path itself. */
export function wouldQualifyAtNextInspection(classroom, subjectId, notebookTypeId, studentId) {
  return computeNotebookCompleteness(classroom, subjectId, notebookTypeId, studentId).isComplete;
}

/**
 * THE one live award trigger in the new model — called exactly once,
 * for the one newly-created checkpoint, immediately after it is added
 * to the classroom (see ui/views/NotebookCheckpointsView.js's own
 * onSaveCheckpoint create branch; never called from any edit, delete,
 * submission, review, or withdrawal path). For every student in the
 * classroom, checks whether every OTHER currently-required checkpoint
 * in this exact notebook (the new one excluded by its own id) is
 * complete — lateness is irrelevant — and if so appends exactly one
 * permanent entry and awards the badge. A student already holding an
 * entry for this exact checkpointId (duplicate handling of the same
 * creation event, e.g. a retried save) is skipped — never double-
 * awarded. Never reverses anything, never throws for a student who
 * doesn't qualify (silent no-op for that student only), and never
 * awards when `canAwardNotebookBadge` denies the acting user.
 */
export function inspectReadinessChampionOnNewCheckpoint(classroom, newCheckpoint, actingUid) {
  const { subjectId, notebookTypeId, id: checkpointId } = newCheckpoint;
  const workItemRef = buildNotebookReadinessInspectionWorkItemRef({ subjectId, notebookTypeId, checkpointId });

  if (!canAwardNotebookBadge(classroom, actingUid)) return;

  for (const team of classroom.teams || []) {
    for (const student of team.students || []) {
      if (hasReadinessInspectionEntry(student, workItemRef)) continue;
      const completeness = computeNotebookCompleteness(classroom, subjectId, notebookTypeId, student.id, {
        excludeCheckpointIds: [checkpointId],
      });
      if (completeness.totalRequired === 0 || !completeness.isComplete) continue;
      appendReadinessEntry(student, { label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef });
      notebookBadgeService.awardNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
    }
  }
}
