/**
 * services/notebookReadinessChampionAuditService.js
 *
 * Read-only, classroom-wide historical BACKFILL audit for the
 * notebook-level Readiness Champion redesign (2026-11-06) — finds
 * every (student, subject notebook) pair whose SURVIVING historical
 * records already satisfy the complete-and-on-time rule but were never
 * evaluated for it (e.g. the submission happened before this
 * notebook-level workflow existed at all), without awarding anything.
 * Purely a report: a human decides what, if anything, to backfill.
 *
 * SHARES ITS GROUND TRUTH WITH THE LIVE PATH, ON PURPOSE —
 * notebookReadinessChampionService.computeNotebookCompleteness() is the
 * one and only place "is this notebook complete, and was every
 * required checkpoint on time" is decided; this file never
 * re-implements that logic, so the live award path and this historical
 * audit can never silently diverge on what "complete and on time"
 * means for the exact same classroom data (explicit product decision,
 * 2026-11-06 notebook-level redesign: "the backfill audit must use the
 * same complete-notebook eligibility logic as the live award path").
 *
 * HISTORICAL EVIDENCE POLICY (reuses the same structural-caveat
 * decision the Completion Star recognition-integrity audit already
 * established): checkpointService.deleteCheckpoint() leaves no trace
 * (see checkpointService.CHECKPOINT_DELETION_STRUCTURAL_LIMITATION), so
 * this audit can never fully rule out a deleted checkpoint affecting a
 * notebook's own historical completeness. That fact is disclosed
 * EXACTLY ONCE, REPORT-WIDE ONLY — see
 * buildNotebookReadinessBackfillReport()'s own `limitations` field —
 * and is NEVER treated as per-case evidence: it is never repeated on
 * any individual entry below (deliberately corrected, 2026-11-06,
 * post-review hardening: an earlier draft of this file attached the
 * same caveat text to every `eligibleForBackfill` entry too, which
 * read as a per-case doubt rather than the audit-wide limitation it
 * actually is), it never downgrades any individual result, and it is
 * never, on its own, grounds to revoke an existing award (this file
 * never revokes anything regardless; it is read-only end to end).
 * Every individual (student, notebook) pair is still classified
 * strictly from concrete, surviving evidence into five
 * mutually-exclusive buckets:
 *
 *   eligibleForBackfill — computeNotebookCompleteness() reports
 *     isCompleteAndOnTime, and NO Readiness Champion history entry
 *     (active OR revoked, any source) exists yet for this exact
 *     notebook on this student's own `history`. The clean, unambiguous
 *     case: this student should already have this badge for this
 *     notebook. These are backfill CANDIDATES for a human to
 *     approve — this function never awards anything itself. The
 *     report-wide structural limitation above still applies to every
 *     entry here just as much as to any other bucket; it is simply
 *     stated once, not attached per entry.
 *
 *   incomplete — at least one required checkpoint is still pending
 *     (never submitted) for this student. Takes priority over the
 *     other checks below: a notebook that isn't even complete yet has
 *     nothing further to evaluate.
 *
 *   containsLateSubmissions — every required checkpoint was submitted,
 *     but at least one was after its own due date (both dates
 *     well-formed). The notebook IS complete, just not on time.
 *
 *   cannotEstablishEligibility ("invalid or insufficient date
 *     evidence") — every required checkpoint was submitted, but at
 *     least one checkpoint's own `dueDate` or that submission's own
 *     `submittedDate` is missing-but-set or malformed, so timeliness
 *     cannot be established for it. Never guessed either way.
 *
 *   hasPriorAwardHistory ("previously awarded or revoked") — the
 *     notebook is complete-and-on-time, but at least one Readiness
 *     Champion history entry (active OR, notably, REVOKED, any source)
 *     already exists for this exact notebook on this student. Excluded
 *     from `eligibleForBackfill` even when every existing entry is
 *     revoked: a teacher's own past revocation (or an already-active
 *     award from any source) is an informed fact this read-only audit
 *     must never silently override by re-recommending the same award.
 *
 * A student with zero required checkpoints for a given notebook (the
 * notebook exists in config but nothing has been created under it yet)
 * is never a candidate and is not reported in any bucket — there is
 * nothing to be "ready" for yet. Safe to call repeatedly; performs zero
 * writes of any kind.
 */

import { listCheckpointsForNotebook, CHECKPOINT_DELETION_STRUCTURAL_LIMITATION } from './checkpointService.js';
import {
  computeNotebookCompleteness,
  buildNotebookReadinessWorkItemRef,
  getActiveReadinessSourcesForNotebook,
} from './notebookReadinessChampionService.js';

/** Every distinct (subjectId, notebookTypeId) pair with at least one checkpoint currently configured in this classroom — the authoritative, SURVIVING notebook list this audit (and the live path) can ever see. */
function listNotebookIdentities(classroom) {
  const seen = new Map();
  for (const checkpoint of classroom.checkpoints || []) {
    const key = `${checkpoint.subjectId}::${checkpoint.notebookTypeId}`;
    if (!seen.has(key)) seen.set(key, { subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId });
  }
  return [...seen.values()];
}

/** Every Readiness Champion history entry (any source, active or revoked) for this exact student+notebook — read-only, never classifies by guessing. */
function listReadinessHistoryForNotebook(student, workItemRef) {
  return (student.history || []).filter(
    (e) => e.kind === 'readiness-champion' && e.workItemRef?.subjectId === workItemRef.subjectId && e.workItemRef?.notebookTypeId === workItemRef.notebookTypeId
  );
}

/**
 * The combined, per-(subjectId, notebookTypeId, student) backfill audit
 * across a classroom, for use directly or via
 * buildNotebookReadinessBackfillReport() below. Returns the five flat
 * buckets described in this file's own header comment.
 */
export function auditNotebookReadinessChampionBackfillEligibility(classroom) {
  const eligibleForBackfill = [];
  const incomplete = [];
  const containsLateSubmissions = [];
  const cannotEstablishEligibility = [];
  const hasPriorAwardHistory = [];

  const notebooks = listNotebookIdentities(classroom);

  for (const team of classroom.teams || []) {
    for (const student of team.students || []) {
      for (const { subjectId, notebookTypeId } of notebooks) {
        const completeness = computeNotebookCompleteness(classroom, subjectId, notebookTypeId, student.id);
        if (completeness.totalRequired === 0) continue; // nothing to be ready for

        const entry = { studentId: student.id, subjectId, notebookTypeId, completeness };

        if (completeness.pendingCount > 0) {
          incomplete.push(entry);
          continue;
        }
        if (completeness.hasInsufficientEvidence) {
          cannotEstablishEligibility.push(entry);
          continue;
        }
        if (completeness.lateCount > 0) {
          containsLateSubmissions.push(entry);
          continue;
        }

        // isCompleteAndOnTime is necessarily true past this point.
        const workItemRef = buildNotebookReadinessWorkItemRef({ subjectId, notebookTypeId });
        const priorHistory = listReadinessHistoryForNotebook(student, workItemRef);
        if (priorHistory.length > 0) {
          hasPriorAwardHistory.push({
            ...entry,
            priorHistory: priorHistory.map((h) => ({ id: h.id, source: h.source, delta: h.delta, recordedAt: h.recordedAt })),
            activeSources: getActiveReadinessSourcesForNotebook(student, workItemRef),
          });
          continue;
        }

        eligibleForBackfill.push(entry);
      }
    }
  }

  return { eligibleForBackfill, incomplete, containsLateSubmissions, cannotEstablishEligibility, hasPriorAwardHistory };
}

/**
 * The same audit, reshaped into one per-student report (mirrors
 * scripts/recognitionIntegrityAuditLogic.js's own
 * buildRecognitionIntegrityReport() convention exactly, for the same
 * reason: one disclosed, report-wide `limitations` field, never
 * repeated or implied per student, alongside every student's own
 * strictly evidence-based classification). Never awards, never
 * revokes, never writes — purely a report, safe to run repeatedly
 * against a read-only snapshot.
 */
export function buildNotebookReadinessBackfillReport(classroom) {
  const audit = auditNotebookReadinessChampionBackfillEligibility(classroom);

  const students = [];
  for (const team of classroom.teams || []) {
    for (const student of team.students || []) {
      students.push({
        studentId: student.id,
        studentName: student.name,
        eligibleForBackfill: audit.eligibleForBackfill.filter((e) => e.studentId === student.id),
        incomplete: audit.incomplete.filter((e) => e.studentId === student.id),
        containsLateSubmissions: audit.containsLateSubmissions.filter((e) => e.studentId === student.id),
        cannotEstablishEligibility: audit.cannotEstablishEligibility.filter((e) => e.studentId === student.id),
        hasPriorAwardHistory: audit.hasPriorAwardHistory.filter((e) => e.studentId === student.id),
      });
    }
  }

  return {
    classroomId: classroom.id,
    generatedAt: new Date().toISOString(),
    limitations: {
      checkpointDeletionUndetectable: CHECKPOINT_DELETION_STRUCTURAL_LIMITATION,
    },
    students,
  };
}
