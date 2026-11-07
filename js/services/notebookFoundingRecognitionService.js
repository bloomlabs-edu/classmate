/**
 * services/notebookFoundingRecognitionService.js
 *
 * FOUNDING RECOGNITION — a separate, permanent, one-time historical
 * achievement category (2026-11-07 product decision), created to
 * recognize students who were already consistently completing their
 * notebook work BEFORE the permanent-per-inspection Readiness Champion
 * redesign existed to recognize it live. This is explicitly NOT a
 * third way of earning a "Readiness Champion" badge — it is its own
 * `kind` (`'founding-recognition'`), its own `workItemRef.type`
 * (`'founding_recognition'`), and its own counting/display functions,
 * so it can never be merged into, or mistaken for, either:
 *   - the NEW per-inspection Readiness Champion ledger
 *     (notebookReadinessChampionService.js's own
 *     'notebook_readiness_inspection' entries), or
 *   - the OLD, pre-redesign legacy Readiness Champion ledger (that
 *     same file's own 'notebook_readiness' entries).
 * A counting function that filters on `kind` alone already excludes
 * both of those by construction, with the `workItemRef.type` check as
 * a second, belt-and-suspenders layer — the same defense-in-depth
 * reasoning recognitionService.workItemRefsEqual() already uses
 * (comparing type AND every key AND key count) to keep the two
 * Readiness Champion ledgers from colliding.
 *
 * ELIGIBILITY RULE (per student, per notebook) — approved policy:
 *   1. At least 5 checkpoints exist in this notebook that were created
 *      BEFORE the fixed production cutoff below (checkpoints created
 *      on/after the cutoff are simply not part of this historical set
 *      at all — never helping, never hurting; they belong entirely to
 *      the live per-inspection model instead).
 *   2. Every one of those checkpoints has been submitted.
 *   3. Lateness is irrelevant — a late-but-submitted checkpoint still
 *      counts (recorded for transparency only, never a disqualifier).
 *   4. A checkpoint awaiting teacher review (`reviewStatus:
 *      'not_reviewed'`) counts — nothing has been returned or rejected,
 *      it simply hasn't been looked at yet.
 *   5. A checkpoint explicitly reviewed and found wanting
 *      (`reviewStatus: 'incomplete'` — the only review OUTCOME this
 *      data model has besides 'complete'; there is no separate
 *      'returned'/'rejected' state) does NOT count, UNLESS it has
 *      since been corrected — which this data model represents purely
 *      as a later state change, not a logged event, so reading the
 *      CURRENT reviewStatus is both necessary and sufficient: once a
 *      teacher updates an 'incomplete' review to 'complete', nothing
 *      distinguishes "was always fine" from "was returned and
 *      corrected" — current state IS the answer to "has this been
 *      corrected," by construction of this data model.
 *   See models/StudentCheckpointRecord.js's own header comment for the
 *   full submissionStatus/reviewStatus enum this rule is built on —
 *   confirmed there is no 'returned', 'rejected', 'withdrawn', or
 *   'resubmitted' status anywhere in this codebase; 'withdrawn' is
 *   simply submissionStatus reverting to 'not_submitted' (caught by
 *   rule 2 the same as never having submitted at all).
 *
 * A checkpoint whose own `createdAt` is missing or unparseable can't be
 * reliably classified as before/after the cutoff at all — such a
 * notebook is INSUFFICIENT EVIDENCE, never guessed into either the
 * required set or excluded from it, the same "never guess, always
 * flag" policy the live model already applies to malformed dates.
 *
 * CUTOFF — fixed, not derived from any stored/mutable field, and never
 * recomputed: the exact timestamp the Firebase Hosting deploy for this
 * redesign's own merge commit (3dda3774) reported success in
 * production (confirmed via the GitHub Actions run that merge
 * triggered), NOT the git merge-commit timestamp itself (33s earlier).
 * Because the required set is always "checkpoints created before this
 * fixed point in time," it can never grow — a checkpoint created next
 * month is automatically, permanently outside this feature's scope,
 * with no code change needed to keep it that way. This is what
 * guarantees applyFoundingRecognition() below can never "reopen" to
 * recognize later work; only the live per-inspection trigger can ever
 * do that, and it does so through a completely separate code path.
 *
 * TEST/SANDBOX CLASSROOMS — this data model has NO structural
 * isTest/archived/sandbox field anywhere on Classroom (confirmed by
 * reading the full model). The only available signal is naming
 * convention, which isLikelyTestOrSandboxClassroom() below applies —
 * this is a heuristic, not a guarantee, and is deliberately exposed as
 * its own named, overridable predicate rather than buried silently
 * inside the apply step, so a human can review exactly which
 * classrooms it flagged before a real production run.
 *
 * CROSS-CLASSROOM IDENTITY — this data model has no concept of one
 * real person existing across two classroom documents; a (classroomId,
 * studentId) pair is the only identity this app ever recognizes
 * anywhere. Two different classroom documents that happen to share
 * student names (confirmed to occur in production — see the org-wide
 * audit this feature was built from) are NEVER merged by this file;
 * each is evaluated and, if eligible, recognized completely
 * independently. Resolving whether two such records are actually the
 * same real student is a human/program-staff judgment call this
 * service cannot and does not attempt to make.
 */

import * as checkpointService from './checkpointService.js';
import { canAwardNotebookBadge } from './notebookBadgeAwardService.js';
import { workItemRefsEqual } from './recognitionService.js';
import { logEntry } from './timelineService.js';

export const FOUNDING_RECOGNITION_KIND = 'founding-recognition';
export const FOUNDING_RECOGNITION_WORK_ITEM_TYPE = 'founding_recognition';
export const MINIMUM_REQUIRED_CHECKPOINTS = 5;

/** The exact timestamp the production Firebase Hosting deploy for the permanent per-inspection redesign's own merge commit reported success — fixed, never recomputed, never stored as a mutable field. */
export const FOUNDING_RECOGNITION_CUTOFF_ISO = '2026-11-07T11:48:47Z';

export function buildFoundingRecognitionWorkItemRef({ subjectId, notebookTypeId }) {
  return { type: FOUNDING_RECOGNITION_WORK_ITEM_TYPE, subjectId, notebookTypeId };
}

/**
 * A best-effort, name-pattern-based heuristic for excluding test/
 * sandbox classrooms from a real production application run — the
 * only signal this data model offers (see this file's own header
 * comment). Matches "test," "trial," "sandbox," or "demo" as a whole
 * word (never a substring of an unrelated real word) in schoolName,
 * classroomName, or gradeSection, case-insensitively, plus the
 * literal "[TEST]" bracket convention already seen in production data.
 * Never used to silently exclude anything from an AUDIT/dry-run (the
 * audit functions below report on every classroom they're given,
 * tagging this flag for visibility) — only applyFoundingRecognition()
 * itself treats a true result as a hard skip.
 */
export function isLikelyTestOrSandboxClassroom(classroom) {
  const haystack = [classroom.schoolName, classroom.classroomName, classroom.gradeSection].filter(Boolean).join(' ');
  return /\b(test|trial|sandbox|demo)\b/i.test(haystack) || /\[test\]/i.test(haystack);
}

function getRequiredCheckpointsBeforeCutoff(classroom, subjectId, notebookTypeId, cutoffIso) {
  const all = checkpointService.listCheckpointsForNotebook(classroom, subjectId, notebookTypeId);
  const cutoffTime = new Date(cutoffIso).getTime();
  const required = [];
  const excludedPostCutoff = [];
  const insufficientEvidence = [];
  for (const cp of all) {
    const createdTime = cp.createdAt ? new Date(cp.createdAt).getTime() : NaN;
    if (Number.isNaN(createdTime)) {
      insufficientEvidence.push(cp);
    } else if (createdTime < cutoffTime) {
      required.push(cp);
    } else {
      excludedPostCutoff.push(cp);
    }
  }
  return { required, excludedPostCutoff, insufficientEvidence };
}

/**
 * The single source of truth for "was this notebook already, verifiably,
 * historically complete for this student as of the fixed cutoff" — see
 * this file's own header comment for the full rule. Shared by the audit
 * and apply functions below so they can never diverge on what
 * "historically complete" means for the same classroom data.
 */
export function computeHistoricalCompletenessForNotebook(classroom, subjectId, notebookTypeId, studentId, cutoffIso = FOUNDING_RECOGNITION_CUTOFF_ISO) {
  const { required, excludedPostCutoff, insufficientEvidence } = getRequiredCheckpointsBeforeCutoff(classroom, subjectId, notebookTypeId, cutoffIso);

  const results = required.map((checkpoint) => {
    const record = checkpointService.getRecordForStudent(checkpoint, studentId);
    if (!record || record.submissionStatus !== 'submitted') return { checkpointId: checkpoint.id, status: 'not_submitted' };
    if (record.reviewStatus === 'incomplete') return { checkpointId: checkpoint.id, status: 'returned_or_rejected' };
    const hasDueDate = !!checkpoint.dueDate;
    const late = hasDueDate && record.submittedDate && record.submittedDate > checkpoint.dueDate;
    return { checkpointId: checkpoint.id, status: late ? 'counts_late' : 'counts_on_time' };
  });

  const totalRequired = required.length;
  const notCountingCount = results.filter((r) => r.status === 'not_submitted' || r.status === 'returned_or_rejected').length;
  const onTimeCount = results.filter((r) => r.status === 'counts_on_time').length;
  const lateCount = results.filter((r) => r.status === 'counts_late').length;
  const insufficientEvidenceCount = insufficientEvidence.length;

  const hasInsufficientEvidence = insufficientEvidenceCount > 0;
  const meetsMinimumCheckpoints = totalRequired >= MINIMUM_REQUIRED_CHECKPOINTS;
  const isHistoricallyComplete = meetsMinimumCheckpoints && notCountingCount === 0 && !hasInsufficientEvidence;

  return {
    subjectId,
    notebookTypeId,
    studentId,
    totalRequired,
    notCountingCount,
    onTimeCount,
    lateCount,
    excludedPostCutoffCount: excludedPostCutoff.length,
    insufficientEvidenceCount,
    hasInsufficientEvidence,
    meetsMinimumCheckpoints,
    isHistoricallyComplete,
    checkpointResults: results,
  };
}

function appendFoundingRecognitionEntry(student, { workItemRef, migrationId, cutoffIso, requiredCheckpointCount, onTimeCount, lateCount, appliedBy }) {
  return logEntry(student, {
    kind: FOUNDING_RECOGNITION_KIND,
    label: 'Founding Recognition',
    delta: 1,
    source: 'historical_transition',
    workItemRef,
    migrationId,
    cutoffIso,
    requiredCheckpointCount,
    onTimeCount,
    lateCount,
    appliedBy,
  });
}

function hasFoundingRecognitionEntry(student, workItemRef) {
  return (student.history || []).some((e) => e.kind === FOUNDING_RECOGNITION_KIND && workItemRefsEqual(e.workItemRef, workItemRef));
}

/** Every permanent Founding Recognition entry this student holds, optionally scoped to one notebook — a plain count, never net-summed, never merged with either Readiness Champion ledger. */
export function countFoundingRecognitionsForStudent(student, { subjectId, notebookTypeId } = {}) {
  return (student.history || []).filter(
    (e) =>
      e.kind === FOUNDING_RECOGNITION_KIND &&
      e.workItemRef?.type === FOUNDING_RECOGNITION_WORK_ITEM_TYPE &&
      (!subjectId || e.workItemRef.subjectId === subjectId) &&
      (!notebookTypeId || e.workItemRef.notebookTypeId === notebookTypeId)
  ).length;
}

/** Every Founding Recognition entry for one notebook — for a notebook-detail display analogous to listReadinessChampionAchievementsForNotebook(). */
export function listFoundingRecognitionsForNotebook(student, subjectId, notebookTypeId) {
  return (student.history || []).filter(
    (e) => e.kind === FOUNDING_RECOGNITION_KIND && e.workItemRef?.type === FOUNDING_RECOGNITION_WORK_ITEM_TYPE && e.workItemRef.subjectId === subjectId && e.workItemRef.notebookTypeId === notebookTypeId
  );
}

/**
 * Every distinct (subjectId, notebookTypeId) pair with at least one
 * checkpoint created before the cutoff, across this classroom — the
 * only notebooks this feature can ever have an opinion about.
 */
function listHistoricalNotebookIdentities(classroom, cutoffIso) {
  const seen = new Map();
  for (const checkpoint of classroom.checkpoints || []) {
    const createdTime = checkpoint.createdAt ? new Date(checkpoint.createdAt).getTime() : NaN;
    if (Number.isNaN(createdTime) || createdTime < new Date(cutoffIso).getTime()) {
      const key = `${checkpoint.subjectId}::${checkpoint.notebookTypeId}`;
      if (!seen.has(key)) seen.set(key, { subjectId: checkpoint.subjectId, notebookTypeId: checkpoint.notebookTypeId });
    }
  }
  return [...seen.values()];
}

/**
 * Read-only dry-run audit across one classroom — never writes
 * anything, safe to call repeatedly, including against production
 * data (it only reads `classroom.checkpoints`/`classroom.teams`).
 * Reports on EVERY classroom given to it, including a likely test/
 * sandbox one (`isLikelyTestOrSandboxClassroom`) — visibility here,
 * never silent exclusion; only applyFoundingRecognition() itself
 * refuses to act on a flagged classroom.
 */
export function auditFoundingRecognitionEligibility(classroom, { cutoffIso = FOUNDING_RECOGNITION_CUTOFF_ISO } = {}) {
  const eligible = [];
  const incomplete = [];
  const belowMinimumCheckpoints = [];
  const insufficientEvidence = [];
  const alreadyRecognized = [];

  const notebooks = listHistoricalNotebookIdentities(classroom, cutoffIso);

  for (const team of classroom.teams || []) {
    for (const student of team.students || []) {
      for (const { subjectId, notebookTypeId } of notebooks) {
        const completeness = computeHistoricalCompletenessForNotebook(classroom, subjectId, notebookTypeId, student.id, cutoffIso);
        if (completeness.totalRequired === 0) continue; // nothing created before the cutoff for this notebook at all

        const entry = { studentId: student.id, studentName: student.name, subjectId, notebookTypeId, completeness };

        if (completeness.hasInsufficientEvidence) {
          insufficientEvidence.push(entry);
          continue;
        }
        if (!completeness.meetsMinimumCheckpoints) {
          belowMinimumCheckpoints.push(entry);
          continue;
        }
        if (completeness.notCountingCount > 0) {
          incomplete.push(entry);
          continue;
        }

        // isHistoricallyComplete is necessarily true past this point.
        const workItemRef = buildFoundingRecognitionWorkItemRef({ subjectId, notebookTypeId });
        if (hasFoundingRecognitionEntry(student, workItemRef)) {
          alreadyRecognized.push(entry);
          continue;
        }
        eligible.push(entry);
      }
    }
  }

  return {
    cutoffIso,
    isLikelyTestOrSandboxClassroom: isLikelyTestOrSandboxClassroom(classroom),
    eligible,
    incomplete,
    belowMinimumCheckpoints,
    insufficientEvidence,
    alreadyRecognized,
  };
}

/**
 * EXECUTION — the only function in this file that writes anything, and
 * only ever to the SAME in-memory `classroom` object it's given (this
 * codebase's own "service mutates, caller persists" convention). Never
 * touches Firestore, a network, or any real classroom on its own.
 *
 * Refuses outright (0 applied, explicit reason) for a classroom
 * isLikelyTestOrSandboxClassroom() flags — the one hard exclusion this
 * file enforces rather than merely reporting.
 *
 * IDEMPOTENT: always re-runs the audit fresh internally, so a group
 * already `alreadyRecognized` (true on this fresh re-audit, which
 * includes anything THIS function itself already applied in an
 * earlier call) is always skipped, never re-applied — calling this
 * twice in a row against the same classroom applies nothing the second
 * time. Every applied entry is independently keyed by
 * (studentId, subjectId, notebookTypeId) via its own workItemRef, so
 * two different classroom documents that happen to share student names
 * are never conflated into one award or blocked by each other — see
 * this file's own header comment on cross-classroom identity.
 *
 * Never touches `incomplete`, `belowMinimumCheckpoints`, or
 * `insufficientEvidence` groups, and never edits, revokes, or deletes
 * anything — this feature has no revoke action at all, matching the
 * live per-inspection model's own "once earned, never revoked" rule.
 */
export function applyFoundingRecognition(classroom, actingUid, { migrationId, cutoffIso = FOUNDING_RECOGNITION_CUTOFF_ISO } = {}) {
  if (!canAwardNotebookBadge(classroom, actingUid)) {
    throw new Error("Not authorized to apply Founding Recognition — must be this classroom's owner or a co-teacher.");
  }
  if (isLikelyTestOrSandboxClassroom(classroom)) {
    return { migrationId: migrationId || null, appliedCount: 0, skippedAlreadyRecognized: 0, skippedReason: 'classroom flagged as likely test/sandbox by isLikelyTestOrSandboxClassroom()', appliedEntries: [] };
  }

  const resolvedMigrationId = migrationId || `founding-recognition-${cutoffIso}`;
  const audit = auditFoundingRecognitionEligibility(classroom, { cutoffIso });

  let appliedCount = 0;
  const appliedEntries = [];
  for (const group of audit.eligible) {
    const student = (classroom.teams || []).flatMap((t) => t.students || []).find((s) => s.id === group.studentId);
    if (!student) continue;
    const workItemRef = buildFoundingRecognitionWorkItemRef({ subjectId: group.subjectId, notebookTypeId: group.notebookTypeId });
    if (hasFoundingRecognitionEntry(student, workItemRef)) continue; // re-checked at write time, not just audit time -- belt and suspenders against any caller re-using a stale audit snapshot
    appendFoundingRecognitionEntry(student, {
      workItemRef,
      migrationId: resolvedMigrationId,
      cutoffIso,
      requiredCheckpointCount: group.completeness.totalRequired,
      onTimeCount: group.completeness.onTimeCount,
      lateCount: group.completeness.lateCount,
      appliedBy: actingUid,
    });
    appliedCount += 1;
    appliedEntries.push({ studentId: group.studentId, subjectId: group.subjectId, notebookTypeId: group.notebookTypeId });
  }

  return { migrationId: resolvedMigrationId, appliedCount, skippedAlreadyRecognized: audit.alreadyRecognized.length, skippedReason: null, appliedEntries };
}
