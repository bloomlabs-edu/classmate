/**
 * services/legacyReadinessChampionMigrationService.js
 *
 * MIGRATION STRATEGY for pre-existing, OLD per-checkpoint Readiness
 * Champion data left behind by the notebook-level redesign
 * (services/notebookReadinessChampionService.js) — explicitly prepared,
 * per product decision, 2026-11-06, as PREPARATION ONLY: nothing in this
 * file is invoked anywhere else in the app, in any test outside this
 * file's own, or against any real classroom. Applying this migration
 * against production data is a separate, later, explicitly-authorized
 * step — not performed by, or as a side effect of, this file existing.
 *
 * THE PROBLEM THIS FILE ADDRESSES — two schemas, currently disconnected:
 *   OLD (per-checkpoint): one entry per (checkpoint, student) pair, in
 *     `StudentCheckpointRecord.badgeAwards[]`:
 *     `{ id, badgeTypeId: 'readiness-champion', source: 'automatic'|'override',
 *        awardedBy, awardedAt (full ISO timestamp, NOT a date-key --
 *        see models/StudentCheckpointRecord.js's own getCurrentIsoDate()
 *        usage), revoked, revokedBy, revokedAt, revokedReason }`, PLUS a
 *     shared, flat `student.notebookBadgeCounts['readiness-champion']`
 *     aggregate the old automatic/override/revoke functions incremented
 *     and decremented directly.
 *   NEW (notebook-level): one entry per (notebook, student) pair, on
 *     `student.history[]`, `kind: 'readiness-champion'`, `workItemRef:
 *     {type:'notebook_readiness', subjectId, notebookTypeId}`, `source:
 *     'automatic'|'override'|'retroactive_backfill'`, `delta` +1/-1 —
 *     see notebookReadinessChampionService.js's own header comment.
 * Nothing in the new system ever reads the old `badgeAwards` shape for
 * this badge type again, and nothing decrements the old flat counter —
 * a classroom that already had old-style awards before this redesign
 * shipped would show a stale, disconnected count forever unless this
 * migration (or something like it) is deliberately run.
 *
 * STRUCTURAL LIMITATION THIS INHERITS — legacy awards live on a
 * checkpoint's own StudentCheckpointRecord, so a legacy award whose
 * checkpoint was since hard-deleted (checkpointService.deleteCheckpoint(),
 * see checkpointService.CHECKPOINT_DELETION_STRUCTURAL_LIMITATION) is
 * already permanently invisible to this file too, exactly as it is to
 * notebookReadinessChampionAuditService.js's own historical backfill
 * audit — disclosed report-wide (see buildLegacyMigrationReport()'s own
 * `limitations` field), never attached per-entry, and never, on its
 * own, grounds to classify a group as demonstrably invalid.
 *
 * REFERENCE-DATE RECONSTRUCTION — a legacy award's own `awardedAt` is
 * the one piece of concrete historical evidence this file has for "what
 * the notebook's own required-checkpoint set looked like at the time."
 * computeNotebookCompleteness()'s own `referenceDate` option (filtering
 * required checkpoints to ones whose `createdAt` predates it) exists
 * for exactly this use — this file passes the LATEST (max) date-key
 * among a group's own legacy awards, the most generous honest reference
 * point available, never inventing a different one and never defaulting
 * to "now" (which would incorrectly require checkpoints added long
 * after the student's own historical activity).
 *
 * CLASSIFICATION (per explicit product decision) — every (student,
 * notebook) group with at least one legacy award is classified into
 * exactly one of:
 *   validUnderNewRule — as of the group's own referenceDate,
 *     computeNotebookCompleteness() reports isCompleteAndOnTime.
 *     `alreadyPresentInNewLedger` (true/false) additionally marks
 *     whether the NEW ledger already carries any Readiness Champion
 *     history (any source, active or revoked) for this exact notebook —
 *     if so, `proposedNewEntry` is null (never propose a duplicate;
 *     an already-decided new-system fact is never silently
 *     re-litigated), otherwise `proposedNewEntry` shows exactly what
 *     applyLegacyReadinessChampionMigration() would append.
 *   demonstrablyInvalid — a required-as-of-referenceDate checkpoint was
 *     either never submitted (pendingCount > 0) or genuinely late
 *     (lateCount > 0): concrete, current evidence the notebook was not
 *     actually complete-and-on-time, regardless of what the old
 *     per-checkpoint rule once believed.
 *   insufficientEvidence — neither of the above, but
 *     hasInsufficientEvidence is true (a malformed/missing-but-set date
 *     on some required checkpoint) — inability to establish eligibility
 *     is NOT proof of ineligibility (same policy
 *     evaluateReadinessChampionForNotebook() itself now applies, see its
 *     own header comment) and is NEVER treated as demonstrablyInvalid.
 *   unmappable — the checkpoint's own subjectId/notebookTypeId is
 *     missing or empty, so notebook identity cannot be reconstructed at
 *     all. Expected to be empty in practice (Checkpoint.js requires both
 *     fields at creation) but checked defensively rather than assumed
 *     impossible.
 * Every group, regardless of bucket, also carries `legacySourceAwards`
 * (every contributing old per-checkpoint award entry) — a group with
 * more than one is additionally cross-referenced (never re-bucketed; a
 * single group is already the "collapsed to one notebook-level award"
 * unit) in the report's own `duplicateCheckpointLevelAwards` list, so a
 * human reviewer can see exactly which notebooks had multiple old
 * per-checkpoint awards collapsing into one proposed new entry.
 *
 * This file NEVER automatically awards or revokes anything merely
 * because a legacy record exists — only `validUnderNewRule` groups
 * (which require CURRENT, concrete, re-derived evidence of
 * completeness, not merely "an old award used to exist") are ever
 * applied, and applying only ever ADDS a new, clearly-provenanced
 * `retroactive_backfill` entry — it never touches, edits, or deletes
 * any old `badgeAwards` entry, never fabricates a notebook reference,
 * and never revokes anything.
 */

import { CHECKPOINT_DELETION_STRUCTURAL_LIMITATION } from './checkpointService.js';
import * as notebookBadgeService from './notebookBadgeService.js';
import {
  computeNotebookCompleteness,
  buildNotebookReadinessWorkItemRef,
  listReadinessChampionNotebookRefsForStudent,
  READINESS_CHAMPION_BADGE_ID,
} from './notebookReadinessChampionService.js';
import { canAwardNotebookBadge } from './notebookBadgeAwardService.js';
import { logEntry } from './timelineService.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { generateId } from '../utils/idGenerator.js';

/** Every legacy badgeAwards[] entry of this badge type, across every surviving checkpoint/record in the classroom, each tagged with exactly where it came from — the raw material every classification below groups and reasons about. */
function collectLegacyAwardEntries(classroom) {
  const entries = [];
  for (const checkpoint of classroom.checkpoints || []) {
    for (const record of checkpoint.records || []) {
      for (const award of record.badgeAwards || []) {
        if (award.badgeTypeId !== READINESS_CHAMPION_BADGE_ID) continue;
        entries.push({
          studentId: record.studentId,
          subjectId: checkpoint.subjectId,
          notebookTypeId: checkpoint.notebookTypeId,
          checkpointId: checkpoint.id,
          entryId: award.id,
          source: award.source,
          awardedBy: award.awardedBy ?? null,
          awardedAt: award.awardedAt ?? null,
          revoked: !!award.revoked,
          revokedBy: award.revokedBy ?? null,
          revokedAt: award.revokedAt ?? null,
          revokedReason: award.revokedReason ?? null,
        });
      }
    }
  }
  return entries;
}

/** Group key — deliberately string-concatenated rather than a Map of objects, so it survives being used as a plain object key below. */
function groupKey(studentId, subjectId, notebookTypeId) {
  return `${studentId}::${subjectId}::${notebookTypeId}`;
}

/** The latest (max) date-key among a group's own legacy awards' `awardedAt` (a full ISO timestamp -- sliced to its date portion) -- the most generous honest historical reference point this file has. Entries with no parseable `awardedAt` at all are excluded rather than corrupting the max with `undefined`. */
function latestReferenceDate(legacySourceAwards) {
  const dateKeys = legacySourceAwards.map((a) => (typeof a.awardedAt === 'string' ? a.awardedAt.slice(0, 10) : null)).filter(Boolean);
  if (dateKeys.length === 0) return null;
  return dateKeys.reduce((latest, current) => (current > latest ? current : latest));
}

/** Any Readiness Champion history (any source, active OR revoked) already on the NEW ledger for this exact notebook -- "already decided by the new system," never silently re-litigated. */
function hasAnyNewLedgerHistory(student, workItemRef) {
  return (student.history || []).some(
    (e) => e.kind === 'readiness-champion' && e.workItemRef?.subjectId === workItemRef.subjectId && e.workItemRef?.notebookTypeId === workItemRef.notebookTypeId
  );
}

function findStudentById(classroom, studentId) {
  for (const team of classroom.teams || []) {
    const found = (team.students || []).find((s) => s.id === studentId);
    if (found) return found;
  }
  return null;
}

/**
 * The read-only dry-run audit — groups every legacy per-checkpoint
 * award by (student, notebook), classifies each group per this file's
 * own header comment, and returns the full, flat, classified list plus
 * the convenience filtered views and counter-reconciliation preview
 * described there. Performs zero writes; safe to call repeatedly
 * against a read-only snapshot, including production data (it only
 * reads `classroom.checkpoints`/`classroom.teams`, never mutates
 * either) -- it is `applyLegacyReadinessChampionMigration()` below,
 * never this function, that writes anything.
 */
export function auditLegacyReadinessChampionAwards(classroom) {
  const legacyEntries = collectLegacyAwardEntries(classroom);
  const groupedByKey = new Map();

  for (const entry of legacyEntries) {
    const key = groupKey(entry.studentId, entry.subjectId, entry.notebookTypeId);
    if (!groupedByKey.has(key)) {
      groupedByKey.set(key, { studentId: entry.studentId, subjectId: entry.subjectId, notebookTypeId: entry.notebookTypeId, legacySourceAwards: [] });
    }
    groupedByKey.get(key).legacySourceAwards.push(entry);
  }

  const groups = [];
  const validUnderNewRule = [];
  const demonstrablyInvalid = [];
  const insufficientEvidence = [];
  const unmappable = [];

  for (const base of groupedByKey.values()) {
    const { studentId, subjectId, notebookTypeId, legacySourceAwards } = base;

    if (!subjectId || !notebookTypeId) {
      const entry = { studentId, subjectId: subjectId || null, notebookTypeId: notebookTypeId || null, legacySourceAwards, classification: 'unmappable' };
      groups.push(entry);
      unmappable.push(entry);
      continue;
    }

    const student = findStudentById(classroom, studentId);
    const referenceDate = latestReferenceDate(legacySourceAwards);
    const completeness = student && referenceDate ? computeNotebookCompleteness(classroom, subjectId, notebookTypeId, studentId, { referenceDate }) : null;

    let classification;
    let alreadyPresentInNewLedger = false;
    let proposedNewEntry = null;

    if (!student || !completeness || completeness.totalRequired === 0) {
      // No student record found, no usable reference date, or the
      // reference date excludes every checkpoint that ever existed --
      // genuinely cannot establish anything concrete either way.
      classification = 'insufficientEvidence';
    } else if (completeness.pendingCount > 0 || completeness.lateCount > 0) {
      classification = 'demonstrablyInvalid';
    } else if (completeness.hasInsufficientEvidence) {
      classification = 'insufficientEvidence';
    } else {
      classification = 'validUnderNewRule';
      const workItemRef = buildNotebookReadinessWorkItemRef({ subjectId, notebookTypeId });
      alreadyPresentInNewLedger = hasAnyNewLedgerHistory(student, workItemRef);
      if (!alreadyPresentInNewLedger) {
        proposedNewEntry = {
          kind: 'readiness-champion',
          label: 'Readiness Champion (migrated from legacy per-checkpoint awards)',
          delta: 1,
          source: 'retroactive_backfill',
          workItemRef,
          migratedFrom: legacySourceAwards.map((a) => ({ checkpointId: a.checkpointId, entryId: a.entryId, source: a.source, awardedAt: a.awardedAt })),
        };
      }
    }

    const entry = { studentId, subjectId, notebookTypeId, legacySourceAwards, referenceDate, completeness, classification, alreadyPresentInNewLedger, proposedNewEntry };
    groups.push(entry);
    if (classification === 'validUnderNewRule') validUnderNewRule.push(entry);
    else if (classification === 'demonstrablyInvalid') demonstrablyInvalid.push(entry);
    else insufficientEvidence.push(entry);
  }

  const duplicateCheckpointLevelAwards = groups.filter((g) => g.legacySourceAwards.length > 1);

  const studentIds = [...new Set(groups.map((g) => g.studentId).filter(Boolean))];
  const counterReconciliationPreview = studentIds.map((studentId) => {
    const student = findStudentById(classroom, studentId);
    const oldDisplayedCount = student?.notebookBadgeCounts?.[READINESS_CHAMPION_BADGE_ID] ?? 0;
    const trueLedgerCount = student ? listReadinessChampionNotebookRefsForStudent(student).filter((r) => r.active).length : 0;
    const pendingValidApplications = validUnderNewRule.filter((g) => g.studentId === studentId && !g.alreadyPresentInNewLedger).length;
    return {
      studentId,
      oldDisplayedCount,
      trueLedgerCountToday: trueLedgerCount,
      pendingValidApplications,
      projectedCountAfterApply: trueLedgerCount + pendingValidApplications,
      note:
        oldDisplayedCount === trueLedgerCount
          ? 'already consistent -- no reconciliation needed'
          : 'disconnected: the old per-checkpoint counter was never reduced when this redesign shipped; applying the migration will reconcile it to the ledger\'s own truth, not reset it to zero',
    };
  });

  return {
    groups,
    validUnderNewRule,
    demonstrablyInvalid,
    insufficientEvidence,
    unmappable,
    duplicateCheckpointLevelAwards,
    counterReconciliationPreview,
  };
}

/**
 * The same audit, wrapped as a dry-run REPORT (never applies anything)
 * with the report-wide structural-limitation disclosure, mirroring
 * notebookReadinessChampionAuditService.js's own
 * buildNotebookReadinessBackfillReport() convention exactly -- disclosed
 * ONCE here, never attached to any individual group (the same mistake
 * corrected there, 2026-11-06, deliberately not repeated here).
 */
export function buildLegacyMigrationDryRunReport(classroom) {
  const audit = auditLegacyReadinessChampionAwards(classroom);
  return {
    classroomId: classroom.id,
    generatedAt: new Date().toISOString(),
    migrationNote:
      'READ-ONLY DRY RUN. Nothing in this report has been applied. applyLegacyReadinessChampionMigration() is a separate function, requiring its own explicit authorization and acting uid, never invoked as a side effect of generating this report.',
    limitations: {
      checkpointDeletionUndetectable: CHECKPOINT_DELETION_STRUCTURAL_LIMITATION,
    },
    ...audit,
  };
}

/**
 * EXECUTION -- the only function in this file that writes anything, and
 * only ever to the SAME in-memory `classroom` object it's given (this
 * codebase's own universal "service mutates, caller persists"
 * convention -- see checkpointService.js's own header comment); it
 * never touches Firestore, a network, or any real classroom on its own.
 * Not invoked anywhere in this app or in any test outside this file's
 * own -- applying this against a real classroom is a deliberate, later,
 * separately-authorized step. scripts/legacyReadinessChampionMigration.js
 * (mirroring scripts/auditStudentConceptRecords.js's own established
 * "read real data, run the pure function, print the result, never run
 * automatically" pattern) wraps buildLegacyMigrationDryRunReport() for
 * exactly this reason, but deliberately has NO "apply" mode at all --
 * see that script's own header comment for why writing one is itself
 * the kind of separately-authorized step this task asked to prepare
 * FOR, not take.
 *
 * ALWAYS re-runs the audit fresh internally -- never trusts a
 * previously-computed report that might be stale relative to the
 * `classroom` object actually passed in.
 *
 * IDEMPOTENT: a group already `alreadyPresentInNewLedger` (true on this
 * fresh re-audit, which includes anything THIS function itself already
 * applied in an earlier call) is always skipped, never re-applied --
 * calling this twice in a row against the same classroom applies
 * nothing the second time and reconciles nothing further, since the
 * counter will already match the ledger's own truth by then.
 *
 * COUNTER RECONCILIATION happens FIRST, before any new entries are
 * added, by setting each affected student's displayed count to exactly
 * what the ledger's own net-sum truth says RIGHT NOW (never reset to
 * zero, never left silently wrong) -- logged as its own
 * `notebook-badge-counter-reconciled` history entry carrying the
 * before/after values and this migration's own id, so the correction
 * itself is visible and attributable, never silent. Only THEN are new
 * `retroactive_backfill` entries appended for each pending
 * `validUnderNewRule` group, each via
 * notebookBadgeService.awardNotebookBadge() (the same increment path
 * every other award in this app uses -- never a raw counter write), so
 * the final displayed count is mathematically exactly the reconciled
 * baseline plus however many valid notebooks were just newly
 * recognized.
 *
 * NEVER touches `demonstrablyInvalid`, `insufficientEvidence`, or
 * `unmappable` groups, and NEVER edits, revokes, or deletes any old
 * `badgeAwards[]` entry -- old historical entries are preserved exactly
 * as found, permanently, per explicit instruction.
 */
export function applyLegacyReadinessChampionMigration(classroom, actingUid, { migrationId } = {}) {
  if (!canAwardNotebookBadge(classroom, actingUid)) {
    throw new Error("Not authorized to apply the Readiness Champion legacy migration — must be this classroom's owner or a co-teacher.");
  }
  const resolvedMigrationId = migrationId || `legacy-readiness-migration-${generateId()}`;
  const audit = auditLegacyReadinessChampionAwards(classroom);

  const counterCorrections = [];
  const affectedStudentIds = [...new Set(audit.groups.map((g) => g.studentId).filter(Boolean))];
  for (const studentId of affectedStudentIds) {
    const student = findStudentById(classroom, studentId);
    if (!student) continue;
    const trueLedgerCount = listReadinessChampionNotebookRefsForStudent(student).filter((r) => r.active).length;
    const displayedCount = student.notebookBadgeCounts?.[READINESS_CHAMPION_BADGE_ID] ?? 0;
    if (displayedCount === trueLedgerCount) continue;
    if (!student.notebookBadgeCounts) student.notebookBadgeCounts = {};
    student.notebookBadgeCounts[READINESS_CHAMPION_BADGE_ID] = trueLedgerCount;
    logEntry(student, {
      kind: 'notebook-badge-counter-reconciled',
      label: 'Readiness Champion',
      delta: 0,
      badgeTypeId: READINESS_CHAMPION_BADGE_ID,
      before: displayedCount,
      after: trueLedgerCount,
      migrationId: resolvedMigrationId,
      reconciledBy: actingUid,
      reason: 'legacy_per_checkpoint_counter_disconnected',
    });
    counterCorrections.push({ studentId, before: displayedCount, after: trueLedgerCount });
  }

  let appliedCount = 0;
  let skippedAlreadyPresent = 0;
  for (const group of audit.validUnderNewRule) {
    if (group.alreadyPresentInNewLedger) {
      skippedAlreadyPresent += 1;
      continue;
    }
    const student = findStudentById(classroom, group.studentId);
    if (!student) continue;
    const workItemRef = buildNotebookReadinessWorkItemRef({ subjectId: group.subjectId, notebookTypeId: group.notebookTypeId });
    logEntry(student, {
      kind: 'readiness-champion',
      label: 'Readiness Champion (migrated from legacy per-checkpoint awards)',
      delta: 1,
      source: 'retroactive_backfill',
      workItemRef,
      migratedFrom: group.legacySourceAwards.map((a) => ({ checkpointId: a.checkpointId, entryId: a.entryId, source: a.source, awardedAt: a.awardedAt })),
      migrationId: resolvedMigrationId,
      migratedAt: getCurrentIsoDate(),
    });
    notebookBadgeService.awardNotebookBadge(classroom, student, READINESS_CHAMPION_BADGE_ID);
    appliedCount += 1;
  }

  return { migrationId: resolvedMigrationId, appliedCount, skippedAlreadyPresent, counterCorrections };
}
