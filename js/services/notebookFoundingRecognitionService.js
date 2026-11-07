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
 * TEST/SANDBOX CLASSROOMS — CLASSIFICATION REGISTRY (2026-11, Option
 * B) IS NOW THE AUTHORITATIVE GATE. This data model has NO structural
 * isTest/archived/sandbox field anywhere on Classroom (confirmed by
 * reading the full model), and the original name-pattern heuristic
 * (isLikelyTestOrSandboxClassroom() below) has known, confirmed false
 * positives ("Trial Bay Public School") and false negatives ("QA
 * Classroom", "staging", "dummy", "test_classroom") — real gaps found
 * during independent review, not theoretical. Per explicit product
 * decision, a human-reviewed classification registry (loaded and
 * owned entirely OUTSIDE this file — see scripts/
 * foundingRecognitionClassroomRegistry.js and its own header comment
 * for exactly why this file never imports it directly: that registry
 * contains per-classroom reviewer identities, which must never ship to
 * a browser bundle, so it is deliberately passed INTO
 * applyFoundingRecognition()/auditFoundingRecognitionEligibility() as
 * a plain `classification` string + optional `classificationDetail`
 * object — dependency injection, not a static import, keeping this
 * service itself free of any registry-loading concern or sensitive
 * data) now DECIDES whether applyFoundingRecognition() may act at all:
 *   - `'confirmed_real'` — an administrator has explicitly reviewed
 *     this classroom and confirmed it is real. Only this value lets
 *     applyFoundingRecognition() proceed.
 *   - `'confirmed_test'` — an administrator has explicitly reviewed
 *     and confirmed this classroom is test/sandbox data. Hard-excluded
 *     from applyFoundingRecognition(), exactly as before.
 *   - `'needs_review'` (the default, and what ANY unknown classroom id
 *     or missing/malformed registry entry resolves to — never guessed
 *     into either confirmed state) — ALSO hard-excluded. An
 *     unreviewed classroom is treated exactly like a confirmed test
 *     one for gating purposes: no award without an explicit human
 *     "real" confirmation on file.
 * isLikelyTestOrSandboxClassroom() below is NOT removed and NOT
 * weakened for genuinely confirmed-test classrooms (registry
 * classification alone already excludes those) — it is DOWNGRADED
 * from its own prior role as an independent hard gate to a pure,
 * non-blocking WARNING: both audit and apply functions still compute
 * and report it (`isLikelyTestOrSandboxClassroom` stays on every
 * result shape below), so a reviewer always sees the heuristic's own
 * opinion alongside the registry's authoritative one, even for a
 * classroom already confirmed real.
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
import { generateId } from '../utils/idGenerator.js';

export const FOUNDING_RECOGNITION_KIND = 'founding-recognition';
export const FOUNDING_RECOGNITION_WORK_ITEM_TYPE = 'founding_recognition';
export const MINIMUM_REQUIRED_CHECKPOINTS = 5;

/** The exact timestamp the production Firebase Hosting deploy for the permanent per-inspection redesign's own merge commit reported success — fixed, never recomputed, never stored as a mutable field. */
export const FOUNDING_RECOGNITION_CUTOFF_ISO = '2026-11-07T11:48:47Z';

/**
 * The three valid classroom-classification states the Option B
 * registry (scripts/foundingRecognitionClassroomRegistry.js) assigns —
 * defined HERE, the service, as the single source of truth for the
 * valid string values, so the registry module imports these rather
 * than duplicating the literals. `NEEDS_REVIEW` is both the default
 * for any classroom absent from the registry AND the safe fallback for
 * a present-but-malformed entry (an unrecognized classification string
 * value) — never guessed into either confirmed state.
 */
export const FOUNDING_RECOGNITION_CLASSIFICATIONS = Object.freeze({
  CONFIRMED_REAL: 'confirmed_real',
  CONFIRMED_TEST: 'confirmed_test',
  NEEDS_REVIEW: 'needs_review',
});

export function buildFoundingRecognitionWorkItemRef({ subjectId, notebookTypeId }) {
  return { type: FOUNDING_RECOGNITION_WORK_ITEM_TYPE, subjectId, notebookTypeId };
}

/**
 * A best-effort, name-pattern-based heuristic — NO LONGER the gate
 * applyFoundingRecognition() enforces (see this file's own header
 * comment on the Option B classification registry, which replaced it
 * as the authoritative decision); retained purely as a non-blocking
 * WARNING signal reported alongside the registry's own classification,
 * on both the audit and apply result shapes, so a reviewer always sees
 * it — including for a classroom the registry has already confirmed
 * real, where it might still be worth a second look. Matches "test,"
 * "trial," "sandbox," or "demo" as a whole word (never a substring of
 * an unrelated real word) in schoolName, classroomName, or
 * gradeSection, case-insensitively, plus the literal "[TEST]" bracket
 * convention already seen in production data. Confirmed, real gaps in
 * both directions (false positives on names like "Trial Bay Public
 * School"; false negatives on "QA", "staging", "dummy" naming
 * conventions) are exactly why this is a warning now, never a gate.
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
 * Reports on EVERY classroom given to it regardless of classification
 * or the name heuristic's own opinion — visibility here, never silent
 * exclusion; only applyFoundingRecognition() itself refuses to act on
 * a classroom that isn't `confirmed_real`. The eligibility buckets
 * below (`eligible`/`incomplete`/etc.) are computed purely from the
 * approved eligibility RULE and never change based on `classification`
 * — classification is reported as a separate, parallel field so a
 * reviewer can see "what would this classroom be eligible for" and
 * "has this classroom actually been cleared to receive it" as the two
 * genuinely distinct questions they are.
 *
 * `classification` (one of FOUNDING_RECOGNITION_CLASSIFICATIONS,
 * default `NEEDS_REVIEW`) and `classificationDetail` (the registry
 * entry's own `{reason, reviewedBy, reviewedAt}`, or null) are supplied
 * BY THE CALLER — this file never loads the registry itself (see this
 * file's own header comment on why that lives outside `js/` entirely).
 * A caller that doesn't know or care about classification (e.g. an
 * existing test asserting purely on eligibility) may omit both and get
 * the safe default.
 */
export function auditFoundingRecognitionEligibility(
  classroom,
  { cutoffIso = FOUNDING_RECOGNITION_CUTOFF_ISO, classification = FOUNDING_RECOGNITION_CLASSIFICATIONS.NEEDS_REVIEW, classificationDetail = null } = {}
) {
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
    classification,
    classificationDetail,
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
 * CLASSIFICATION GATE (Option B, 2026-11) — the one hard exclusion
 * this function enforces: `classification` must be EXACTLY
 * `FOUNDING_RECOGNITION_CLASSIFICATIONS.CONFIRMED_REAL`, supplied by
 * the caller (never loaded by this file — see the registry's own
 * header comment). Both `NEEDS_REVIEW` (the default, and what any
 * classroom absent from or malformed in the registry resolves to) and
 * `CONFIRMED_TEST` refuse outright, with 0 applied and an explicit
 * `skippedReason` naming the classification that caused it — an
 * unreviewed classroom gets exactly the same hard refusal as a
 * positively confirmed test one, never a softer treatment. The name
 * heuristic (`isLikelyTestOrSandboxClassroom`) no longer gates
 * anything on its own; it is still computed and returned on every
 * result shape below as a non-blocking warning, even for a
 * `confirmed_real` classroom.
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
 *
 * MIGRATION ID — when the caller doesn't supply one, the fallback is
 * `founding-recognition-${cutoffIso}-${generateId()}`, matching
 * services/legacyReadinessChampionMigrationService.js's own
 * `` `legacy-readiness-migration-${generateId()}` `` convention
 * exactly: a UNIQUE id per call, never a fixed, collision-prone string.
 * `cutoffIso` is a fixed constant in practice, so a fallback built from
 * it ALONE would be identical across every separate invocation that
 * omits `migrationId` — making it useless for telling two real runs
 * apart after the fact purely by this field. An explicitly supplied
 * `migrationId` is always preserved exactly as given, never altered or
 * suffixed — this generated form only ever applies to the omitted
 * case. This has no bearing on idempotency or achievement identity:
 * duplicate prevention is, and has always been, based solely on
 * `hasFoundingRecognitionEntry()`'s own workItemRef equality check
 * below, never on `migrationId` — `migrationId` is audit/attribution
 * metadata only.
 */
export function applyFoundingRecognition(
  classroom,
  actingUid,
  { migrationId, cutoffIso = FOUNDING_RECOGNITION_CUTOFF_ISO, classification = FOUNDING_RECOGNITION_CLASSIFICATIONS.NEEDS_REVIEW, classificationDetail = null } = {}
) {
  if (!canAwardNotebookBadge(classroom, actingUid)) {
    throw new Error("Not authorized to apply Founding Recognition — must be this classroom's owner or a co-teacher.");
  }

  const heuristicWarning = isLikelyTestOrSandboxClassroom(classroom);

  if (classification !== FOUNDING_RECOGNITION_CLASSIFICATIONS.CONFIRMED_REAL) {
    return {
      migrationId: migrationId || null,
      appliedCount: 0,
      skippedAlreadyRecognized: 0,
      skippedReason: `classroom registry classification is '${classification}' -- only an explicitly '${FOUNDING_RECOGNITION_CLASSIFICATIONS.CONFIRMED_REAL}' classification may receive Founding Recognition`,
      classification,
      heuristicWarning,
      appliedEntries: [],
    };
  }

  const resolvedMigrationId = migrationId || `founding-recognition-${cutoffIso}-${generateId()}`;
  const audit = auditFoundingRecognitionEligibility(classroom, { cutoffIso, classification, classificationDetail });

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

  return { migrationId: resolvedMigrationId, appliedCount, skippedAlreadyRecognized: audit.alreadyRecognized.length, skippedReason: null, classification, heuristicWarning, appliedEntries };
}
