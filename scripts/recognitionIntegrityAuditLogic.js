/**
 * scripts/recognitionIntegrityAuditLogic.js
 *
 * Pure, in-memory logic for the combined recognition-integrity audit —
 * one per-student report covering BOTH recognition mechanisms this app
 * awards automatically:
 *   - Completion Star (services/recognitionService.js's own
 *     auditCompletionStarsForClassroom()) — per-checkpoint, split into
 *     incorrectActiveStars (concrete rule violations) and
 *     unverifiableActiveStars (checkpoint since deleted — structurally
 *     unverifiable, never a concrete violation).
 *   - Readiness Champion (services/notebookReadinessChampionAuditService.js's
 *     own auditNotebookReadinessChampionBackfillEligibility()) —
 *     NOTEBOOK-level, per the canonical architecture decision
 *     (2026-11-06): Readiness Champion is awarded per fully completed,
 *     on-time subject notebook, never per individual checkpoint. This
 *     file never re-implements either audit's own logic — it only
 *     combines their already-correct, already-tested outputs into one
 *     per-student view, exactly as each audit's own module already
 *     groups by studentId.
 *
 * Deliberately never connects to Firestore, never writes, never
 * bulk-modifies — a pure function over an already-loaded Classroom
 * object. See scripts/recognitionIntegrityAudit.js for the thin,
 * never-run orchestration wrapper that actually loads real data.
 */

import { auditCompletionStarsForClassroom } from '../js/services/recognitionService.js';
import { auditNotebookReadinessChampionBackfillEligibility } from '../js/services/notebookReadinessChampionAuditService.js';
import { CHECKPOINT_DELETION_STRUCTURAL_LIMITATION } from '../js/services/checkpointService.js';

/**
 * Classifies every reversed (delta < 0, source: 'auto') Completion Star
 * entry on this student's own history by WHY it was reversed — never
 * re-derives eligibility itself, purely reads the reason/removedBy
 * metadata every reversal path in recognitionService.js already
 * attaches to its own ledger entry.
 */
export function classifyCompletionStarReversals(student) {
  const AUTOMATIC_REASONS = new Set(['review_uncompleted', 'late_submission_ineligible', 'submission_withdrawn']);
  const reversals = (student.history || []).filter((e) => e.kind === 'points' && e.source === 'auto' && e.delta < 0);
  return reversals.map((entry) => {
    let classification;
    if (entry.reason === 'teacher_removed') classification = 'manual';
    else if (AUTOMATIC_REASONS.has(entry.reason)) classification = 'automatic';
    else classification = 'unrecognized_reason';
    return { entryId: entry.id, workItemRef: entry.workItemRef, reason: entry.reason ?? null, removedBy: entry.removedBy ?? null, recordedAt: entry.recordedAt, classification };
  });
}

/** Confirms a student's own cached `score` still matches the net of every `kind: 'points'` history entry — a basic ledger-integrity sanity check, independent of either audit above. */
export function verifyPointsLedgerConsistency(student) {
  const expectedScore = (student.history || []).filter((e) => e.kind === 'points').reduce((sum, e) => sum + e.delta, 0);
  return { consistent: expectedScore === student.score, expectedScore, actualScore: student.score };
}

/**
 * The combined, per-student recognition-integrity report. The
 * checkpoint-deletion structural limitation is disclosed exactly once,
 * report-level only (never per-entry — see both underlying audits' own
 * header comments for why), and is never grounds to downgrade or revoke
 * any individual result.
 */
export function buildRecognitionIntegrityReport(classroom) {
  const completionStarAudit = auditCompletionStarsForClassroom(classroom);
  const readinessAudit = auditNotebookReadinessChampionBackfillEligibility(classroom);

  const students = [];
  for (const team of classroom.teams || []) {
    for (const student of team.students || []) {
      students.push({
        studentId: student.id,
        studentName: student.name,
        completionStar: {
          incorrectActiveStars: completionStarAudit.incorrectActiveStars.filter((f) => f.studentId === student.id),
          unverifiableActiveStars: completionStarAudit.unverifiableActiveStars.filter((f) => f.studentId === student.id),
          reversalHistory: classifyCompletionStarReversals(student),
          ledger: verifyPointsLedgerConsistency(student),
        },
        readinessChampion: {
          eligibleForBackfill: readinessAudit.eligibleForBackfill.filter((e) => e.studentId === student.id),
          incomplete: readinessAudit.incomplete.filter((e) => e.studentId === student.id),
          containsLateSubmissions: readinessAudit.containsLateSubmissions.filter((e) => e.studentId === student.id),
          hasPriorAwardHistory: readinessAudit.hasPriorAwardHistory.filter((e) => e.studentId === student.id),
          cannotEstablishEligibility: readinessAudit.cannotEstablishEligibility.filter((e) => e.studentId === student.id),
        },
      });
    }
  }

  return {
    classroomId: classroom.id,
    generatedAt: new Date().toISOString(),
    limitations: { checkpointDeletionUndetectable: CHECKPOINT_DELETION_STRUCTURAL_LIMITATION },
    students,
  };
}
