/**
 * services/academicProgressService.js
 *
 * The deterministic academic-progress computation layer — see
 * docs/architecture/ACADEMIC_PROGRESS_METRIC_SPEC.md for the full
 * specification this file implements section-by-section. Every
 * function here is read-only (no Firestore writes, no mutation of the
 * `classroom`/`student` objects passed in) and every number is computed
 * fresh on every call — nothing here is persisted, matching the
 * existing convention of services/scorecardService.js.
 *
 * DELIBERATELY SEPARATE from services/studentProgressService.js, which
 * already owns "Student Progress" for the behavioral/participation
 * domain (stars, streaks, Biggest Climber). This file must never import
 * from, or be imported by, that one for any computation — the only
 * legitimate overlap is both independently reading
 * `classroom.teams[].students[]` for roster iteration, the same way
 * services/assessmentService.js's getClassroomStudents() already does.
 *
 * SCOPE: only Assessment/AssessmentSubject/StudentResult (exam marks)
 * drive `percent`/`growth`/`trend`/`consistency`/subject bands below.
 * Concept understanding, Checkpoint submission/review, and Learning
 * Activity scores are real evidence (see the *Evidence getters below)
 * but contribute ONLY to their own named, independent attention flags —
 * never to the numeric exam-based metrics. This is a explicit, locked
 * product decision, not an oversight.
 *
 * ELIGIBILITY: every metric reads ONLY `Assessment.status === 'Published'`
 * records. 'Draft' never influences any metric here, for either a
 * teacher-facing or student-facing caller — there is no parameter to
 * opt back into Draft visibility. 'Locked' is also excluded (treated
 * the same as 'Draft') — only 'Published' is a real, finished exam for
 * this file's purposes, per explicit product decision; 'Locked' is not
 * yet a functional status anywhere else in this codebase either.
 *
 * SCHEMA PREREQUISITE (identified before this file was implemented):
 * models/Assessment.js now carries an `examinationCycleId` field (null
 * on every existing Assessment — no migration needed, matching this
 * app's own established "additive field, lazily populated" convention).
 * No UI sets it yet; resolveCycleKey() below is written so every
 * Assessment in production today resolves through the compatibility
 * fallback (title + academicYear) until a future milestone adds the
 * cycle-creation/selection UI this field is for.
 */

import * as assessmentService from './assessmentService.js';
import * as learningRecordService from './learningRecordService.js';
import * as checkpointService from './checkpointService.js';
import * as studentService from './studentService.js';
import { PASS_MARK_PERCENT, GREEN_THRESHOLD_PERCENT } from '../config/assessmentMarksColorConfig.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

// ---------------------------------------------------------------------
// Tunable constants — named here, never inlined as magic numbers at a
// call site, per the metric spec's own explicit instruction. Each is a
// proposed default; product sign-off can change any of these without
// touching the formulas that use them.
// ---------------------------------------------------------------------

/** §2.3 — a cycle-to-cycle delta smaller than this (in percentage points) is noise, not real movement. */
export const TREND_FLAT_DEADZONE_PP = 2.0;

/** §2.3 — trend looks at (up to) this many of the most recent consecutive available-cycle deltas. */
export const TREND_WINDOW_DELTAS = 3;

/** §2.4 — spread at or below this many percentage points across available cycles is 'stable', above is 'variable'. */
export const CONSISTENCY_SPREAD_THRESHOLD_PERCENT_POINTS = 15.0;

/** §2.6 — high_incomplete_checkpoint_rate: (incomplete + not-submitted) / past-due >= this fires the flag. */
export const CHECKPOINT_INCOMPLETE_RATE_THRESHOLD = 0.3;

/** §2.6 — high_incomplete_checkpoint_rate: not-submitted / past-due >= this fires the flag independently. */
export const CHECKPOINT_NOT_SUBMITTED_RATE_THRESHOLD = 0.4;

/** §2.6 — high_incomplete_checkpoint_rate requires at least this many past-due checkpoints in one notebook before it can fire at all (minimum-evidence floor). */
export const CHECKPOINT_MIN_PAST_DUE = 3;

/** §2.6 — repeated_help_requests fires at this many simultaneously-flagged concepts. */
export const HELP_REQUEST_FLAG_THRESHOLD = 2;

/** §0 — only these Assessment.status values are ever read by this file. */
const ELIGIBLE_STATUSES = Object.freeze(['Published']);

// ---------------------------------------------------------------------
// §0 — prerequisite resolution rules
// ---------------------------------------------------------------------

/** §0.3 — one decimal place, half-up. The one rounding rule every percentage in this file goes through. */
function round1(x) {
  return Math.round(x * 10) / 10;
}

/** §0.3 — null-safe percentage normalization; never divides by a non-positive maximum. */
function toPercent(marksObtained, maximumMarks) {
  if (marksObtained === null || marksObtained === undefined) return null;
  if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) return null;
  return round1((marksObtained / maximumMarks) * 100);
}

/** §0.1 — compatibility-fallback title normalization: trim, collapse internal whitespace, case-fold. */
function normalizeTitle(title) {
  return String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * §0.1 — THE stable cycle-identity resolution. Prefers the long-term
 * `examinationCycleId` field (not yet populated by any UI — see this
 * file's own header comment); falls back to a title+academicYear key
 * ONLY for compatibility. This is the one place that fallback exists —
 * never re-derive cycle identity anywhere else in this file.
 */
export function resolveCycleKey(assessment) {
  if (assessment.examinationCycleId) return assessment.examinationCycleId;
  return `${assessment.academicYear || ''}::${normalizeTitle(assessment.title)}`;
}

/**
 * §0.2 — resolves the known `AssessmentSubject.subjectId` ambiguity
 * (a `LearningSubject.id` in the common case, or an already-canonical
 * subjectId when the subject isn't in this classroom's Learning
 * Activities at all) into one stable key, safe to compare across two
 * different Assessments. Reuses the exact same two-case logic
 * assessmentService.getSubjectTitle() already performs for display —
 * this is the identity counterpart of that function, never a second,
 * competing resolution.
 */
function resolveSubjectKey(classroom, rawSubjectId) {
  const subject = learningRecordService.getSubjects(classroom).find((s) => s.id === rawSubjectId);
  return subject ? subject.subjectId : rawSubjectId;
}

/** §0.5 */
function getEffectivePassMarkPercent(assessment) {
  return assessment.passMarkPercent ?? PASS_MARK_PERCENT;
}

/** §0.5 — inclusive boundaries on the pass side at both thresholds, matching assessmentMarksColorConfig.getMarksColorClass() exactly. */
function bandOf(percent, passMarkPercent) {
  if (percent === null || percent === undefined) return 'not_assessed';
  if (percent >= GREEN_THRESHOLD_PERCENT) return 'green';
  if (percent >= passMarkPercent) return 'yellow';
  return 'red';
}

function getStudentOrThrow(classroom, studentId) {
  const found = studentService.findStudentInClassroom(classroom, studentId);
  if (!found) throw new Error(`academicProgressService: no student with id "${studentId}" in this classroom`);
  return found.student;
}

function getEligibleAssessments(classroom) {
  return (classroom.assessments || []).filter((assessment) => ELIGIBLE_STATUSES.includes(assessment.status));
}

/**
 * §0.1 — every eligible (Published) examination cycle in this
 * classroom, chronological by representative date (the earliest
 * `Assessment.date` among the cycle's own eligible Assessments — see
 * this file's own header comment on why live ScheduledEvent
 * re-resolution is out of scope here), ties broken by ascending
 * `cycleKey` string. A cycle whose every Assessment is Draft never
 * appears here at all, by construction (getEligibleAssessments() above
 * already excludes Draft before cycles are even grouped).
 */
export function listExaminationCycles(classroom) {
  const groups = new Map();

  getEligibleAssessments(classroom).forEach((assessment) => {
    const cycleKey = resolveCycleKey(assessment);
    if (!groups.has(cycleKey)) {
      groups.set(cycleKey, {
        cycleKey,
        title: assessment.title,
        academicYear: assessment.academicYear || '',
        assessmentIds: [],
        representativeDate: null,
      });
    }
    const group = groups.get(cycleKey);
    group.assessmentIds.push(assessment.id);
    const date = assessment.date || null;
    if (date && (!group.representativeDate || date < group.representativeDate)) {
      group.representativeDate = date;
    }
  });

  return [...groups.values()].sort((a, b) => {
    if (a.representativeDate !== b.representativeDate) {
      if (!a.representativeDate) return 1;
      if (!b.representativeDate) return -1;
      return a.representativeDate < b.representativeDate ? -1 : 1;
    }
    return a.cycleKey < b.cycleKey ? -1 : a.cycleKey > b.cycleKey ? 1 : 0;
  });
}

// ---------------------------------------------------------------------
// §1 — Evidence layer
// ---------------------------------------------------------------------

/** §0.6 — sums marksObtained/maximumMarks across duplicate (cycle, subject) rows rather than picking one; flags every contributing row so a caller can surface the data-quality note. */
function markDuplicates(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = `${row.cycleKey}::${row.subjectKey}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return rows.map((row) => ({ ...row, duplicateSubjectInCycle: counts.get(`${row.cycleKey}::${row.subjectKey}`) > 1 }));
}

/**
 * §1 — one ExamEvidenceRow per (eligible AssessmentSubject, this
 * student), an uninterpreted mirror of the source records. `entered`
 * is false ONLY when no StudentResult row exists at all — absence and
 * "no row" are deliberately kept distinguishable (see §0.4) even though
 * both yield `percent: null`.
 */
export function getStudentExamEvidence(classroom, studentId) {
  const rows = [];

  getEligibleAssessments(classroom).forEach((assessment) => {
    const cycleKey = resolveCycleKey(assessment);
    const passMarkPercent = getEffectivePassMarkPercent(assessment);

    assessment.assessmentSubjects.forEach((assessmentSubject) => {
      const subjectKey = resolveSubjectKey(classroom, assessmentSubject.subjectId);
      const subjectTitle = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId);
      const maximumMarks = assessmentService.getMaximumMarks(assessmentSubject);
      const result = assessmentService.getStudentResult(assessmentSubject, studentId);

      const entered = Boolean(result);
      const absent = Boolean(result?.absent);
      const marksObtained = result && !result.absent ? result.marks ?? null : null;
      const percent = toPercent(marksObtained, maximumMarks);
      const outcome = percent === null ? 'not_assessed' : percent >= passMarkPercent ? 'passed' : 'failed';

      rows.push({
        assessmentId: assessment.id,
        assessmentSubjectId: assessmentSubject.id,
        cycleKey,
        cycleTitle: assessment.title,
        academicYear: assessment.academicYear || '',
        subjectKey,
        subjectTitle,
        date: assessment.date || '',
        type: assessment.type,
        status: assessment.status,
        marksObtained,
        maximumMarks,
        absent,
        entered,
        percent,
        passMarkPercent,
        outcome,
        remarks: result ? result.remarks || '' : '',
      });
    });
  });

  return markDuplicates(rows);
}

/** Concept evidence — self-report/teacher-status, never numeric; see this file's own header comment on scope. */
export function getStudentConceptEvidence(classroom, studentId) {
  const student = getStudentOrThrow(classroom, studentId);
  return learningRecordService.getAllConcepts(classroom).map(({ subject, unit, concept }) => {
    const record = learningRecordService.getStudentConceptRecord(student, concept.id);
    return {
      conceptId: concept.id,
      subjectId: subject.id,
      unitId: unit.id,
      taughtStatus: concept.status,
      understanding: record.understanding,
      notebookStatus: record.notebook,
      helpRequested: record.helpRequested,
      updatedAt: record.updatedAt,
    };
  });
}

/** Activity evidence — `source: 'classmate'` is the only reliably-populated case today (see docs/CLASSMATE_ARCHITECTURE_CURRENT_STATE.md §8/§13); other sources are passed through as-is, unfiltered, for the caller to judge. */
export function getStudentActivityEvidence(classroom, studentId) {
  const student = getStudentOrThrow(classroom, studentId);
  return (classroom.learningActivities || [])
    .map((activity) => {
      const submission = student.submissions ? student.submissions[activity.id] : null;
      if (!submission) return null;
      return {
        activityId: activity.id,
        conceptId: activity.conceptId || submission.conceptId || null,
        subjectId: null,
        score: submission.score ?? null,
        scoreMax: submission.scoreMax ?? null,
        percent: toPercent(submission.score ?? null, submission.scoreMax ?? null),
        completedAt: submission.completedAt || null,
        source: submission.source || 'classmate',
      };
    })
    .filter(Boolean);
}

/** Checkpoint evidence — submission/review workflow state per notebook, never a mark. */
export function getStudentCheckpointEvidence(classroom, studentId) {
  const rows = [];
  checkpointService.getCheckpointsForStudentAcrossNotebooks(classroom, studentId).forEach(({ subject, notebookType, checkpoints }) => {
    checkpoints.forEach(({ checkpoint, record, late }) => {
      rows.push({
        checkpointId: checkpoint.id,
        subjectId: subject.id,
        notebookTypeId: notebookType.id,
        submissionStatus: record ? record.submissionStatus : 'not_submitted',
        reviewStatus: record ? record.reviewStatus : 'not_reviewed',
        late,
        dueDate: checkpoint.dueDate || null,
        submittedDate: record ? record.submittedDate : null,
      });
    });
  });
  return rows;
}

/** The full bundled evidence layer — `StudentAcademicEvidence` per the spec. */
export function getStudentAcademicEvidence(classroom, studentId) {
  return {
    examRecords: getStudentExamEvidence(classroom, studentId),
    conceptEvidence: getStudentConceptEvidence(classroom, studentId),
    activityEvidence: getStudentActivityEvidence(classroom, studentId),
    checkpointEvidence: getStudentCheckpointEvidence(classroom, studentId),
  };
}

// ---------------------------------------------------------------------
// Shared internal math — one cycle's percent (overall, or one subject),
// and the "available cycle sequence" trend/consistency both build on so
// they can never silently disagree about which cycles count.
// ---------------------------------------------------------------------

/** Sum-based (never average-of-percentages) — identical rule to scorecardService.buildScorecardForCycle()'s own Overall % calculation, extended to also scope to a single subjectKey when provided. Returns null if nothing usable, never a fabricated 0. */
function computeCyclePercent(evidenceRows, cycleKey, subjectKey = null) {
  const rows = evidenceRows.filter(
    (row) => row.cycleKey === cycleKey && row.percent !== null && (subjectKey === null || row.subjectKey === subjectKey)
  );
  if (rows.length === 0) return null;
  const obtained = rows.reduce((sum, row) => sum + row.marksObtained, 0);
  const maximum = rows.reduce((sum, row) => sum + row.maximumMarks, 0);
  if (maximum <= 0) return null;
  return { percent: round1((obtained / maximum) * 100), evidenceRefs: rows.map((row) => row.assessmentSubjectId) };
}

function overallCyclePercent(evidenceRows, cycleKey) {
  return computeCyclePercent(evidenceRows, cycleKey, null)?.percent ?? null;
}

function subjectCyclePercent(evidenceRows, cycleKey, subjectKey) {
  return computeCyclePercent(evidenceRows, cycleKey, subjectKey)?.percent ?? null;
}

/** §2.3/§2.4 — cycles with no usable percent for this scope are skipped entirely, never inserted as a gap/zero. Shared by trend and consistency. */
function getAvailableCycleSequence(evidenceRows, cycles, subjectKey = null) {
  return cycles
    .map((cycle) => {
      const result = computeCyclePercent(evidenceRows, cycle.cycleKey, subjectKey);
      return result ? { cycleKey: cycle.cycleKey, percent: result.percent, evidenceRefs: result.evidenceRefs } : null;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------
// §2.1 — Current Performance
// ---------------------------------------------------------------------

export function getCurrentPerformance(classroom, studentId) {
  const evidenceRows = getStudentExamEvidence(classroom, studentId);
  const cycles = listExaminationCycles(classroom);

  // Most recent cycle (by representativeDate desc, ties broken by the
  // LATER cycleKey string — §2.1 P4) for which this student has >=1
  // usable mark. listExaminationCycles() is already ascending with
  // ties broken by ascending cycleKey, so walking it in reverse and
  // taking the first usable match gives exactly that rule for free.
  const cyclesLatestFirst = [...cycles].reverse();
  const asOfCycle = cyclesLatestFirst.find((cycle) => evidenceRows.some((row) => row.cycleKey === cycle.cycleKey && row.percent !== null));

  if (!asOfCycle) {
    return { asOfCycleKey: null, overallPercent: null, bySubject: [], evidenceRefs: [], reason: 'no_published_results' };
  }

  const cycleRows = evidenceRows.filter((row) => row.cycleKey === asOfCycle.cycleKey);
  const subjectKeys = [...new Set(cycleRows.map((row) => row.subjectKey))];

  const bySubject = subjectKeys.map((subjectKey) => {
    const rowsForSubject = cycleRows.filter((row) => row.subjectKey === subjectKey);
    const percent = subjectCyclePercent(evidenceRows, asOfCycle.cycleKey, subjectKey);
    const passMarkPercent = rowsForSubject[0].passMarkPercent;
    const band = bandOf(percent, passMarkPercent);
    const outcome = percent === null ? 'not_assessed' : percent >= passMarkPercent ? 'passed' : 'failed';
    return {
      subjectKey,
      subjectTitle: rowsForSubject[0].subjectTitle,
      percent,
      passMarkPercent,
      band,
      outcome,
      evidenceRefs: rowsForSubject.filter((row) => row.percent !== null).map((row) => row.assessmentSubjectId),
    };
  });

  const overall = computeCyclePercent(evidenceRows, asOfCycle.cycleKey, null);

  return {
    asOfCycleKey: asOfCycle.cycleKey,
    overallPercent: overall ? overall.percent : null,
    bySubject,
    evidenceRefs: overall ? overall.evidenceRefs : [],
    reason: null,
  };
}

// ---------------------------------------------------------------------
// §2.2 — Growth Between Examinations
// ---------------------------------------------------------------------

function growthBetween(evidenceRows, fromCycleKey, toCycleKey, subjectKey = null) {
  const from = computeCyclePercent(evidenceRows, fromCycleKey, subjectKey);
  const to = computeCyclePercent(evidenceRows, toCycleKey, subjectKey);

  if (!from || !to) {
    return {
      fromCycleKey,
      toCycleKey,
      subjectKey,
      deltaPercentPoints: null,
      reason: 'insufficient_data',
      missingSide: !from ? 'from' : 'to',
      evidenceRefs: [...(from?.evidenceRefs || []), ...(to?.evidenceRefs || [])],
    };
  }

  return {
    fromCycleKey,
    toCycleKey,
    subjectKey,
    deltaPercentPoints: round1(to.percent - from.percent),
    reason: null,
    missingSide: null,
    evidenceRefs: [...from.evidenceRefs, ...to.evidenceRefs],
  };
}

/** §2.2 — an arbitrary, explicitly-chosen pair of eligible cycles (not necessarily adjacent). */
export function getGrowthBetweenCycles(classroom, studentId, fromCycleKey, toCycleKey) {
  const evidenceRows = getStudentExamEvidence(classroom, studentId);
  const subjectKeys = [
    ...new Set(evidenceRows.filter((row) => row.cycleKey === fromCycleKey || row.cycleKey === toCycleKey).map((row) => row.subjectKey)),
  ];

  return {
    ...growthBetween(evidenceRows, fromCycleKey, toCycleKey, null),
    bySubject: subjectKeys.map((subjectKey) => growthBetween(evidenceRows, fromCycleKey, toCycleKey, subjectKey)),
  };
}

/** §2.2 — the consecutive-eligible-cycle-pair series a growth/trend line would plot. Each pair's own growth() call reports its own insufficient_data independently — a cycle with no usable mark for this student doesn't remove the pair from the series, it just makes that one pair's delta null. */
export function getGrowthSeries(classroom, studentId) {
  const evidenceRows = getStudentExamEvidence(classroom, studentId);
  const cycles = listExaminationCycles(classroom);
  const subjectKeys = [...new Set(evidenceRows.map((row) => row.subjectKey))];

  const series = [];
  for (let i = 0; i < cycles.length - 1; i++) {
    const fromCycleKey = cycles[i].cycleKey;
    const toCycleKey = cycles[i + 1].cycleKey;
    series.push({
      ...growthBetween(evidenceRows, fromCycleKey, toCycleKey, null),
      bySubject: subjectKeys.map((subjectKey) => growthBetween(evidenceRows, fromCycleKey, toCycleKey, subjectKey)),
    });
  }
  return series;
}

// ---------------------------------------------------------------------
// §2.3 — Ongoing Trend
// ---------------------------------------------------------------------

function classifyDelta(delta) {
  if (delta > TREND_FLAT_DEADZONE_PP) return 'up';
  if (delta < -TREND_FLAT_DEADZONE_PP) return 'down';
  return 'flat';
}

/**
 * A single Mid-Term -> Quarterly comparison is GROWTH (§2.2), never a
 * trend — this function requires >=2 available cycles (>=1 delta)
 * before it will return anything other than 'insufficient_data', per
 * explicit product guardrail #6.
 */
function computeTrendFromSequence(sequence) {
  if (sequence.length < 2) {
    return { trend: 'insufficient_data', evidenceRefs: sequence.flatMap((entry) => entry.evidenceRefs) };
  }

  const numDeltas = Math.min(TREND_WINDOW_DELTAS, sequence.length - 1);
  const windowSequence = sequence.slice(sequence.length - 1 - numDeltas);

  const classified = [];
  for (let i = 0; i < windowSequence.length - 1; i++) {
    classified.push(classifyDelta(round1(windowSequence[i + 1].percent - windowSequence[i].percent)));
  }

  const upCount = classified.filter((c) => c === 'up').length;
  const downCount = classified.filter((c) => c === 'down').length;

  let trend;
  if (classified.length === 1) {
    trend = classified[0] === 'up' ? 'improving' : classified[0] === 'down' ? 'declining' : 'stable';
  } else if (upCount > downCount) {
    trend = 'improving';
  } else if (downCount > upCount) {
    trend = 'declining';
  } else {
    trend = 'stable';
  }

  return { trend, evidenceRefs: windowSequence.flatMap((entry) => entry.evidenceRefs) };
}

export function getTrend(classroom, studentId) {
  const evidenceRows = getStudentExamEvidence(classroom, studentId);
  const cycles = listExaminationCycles(classroom);

  const overallSequence = getAvailableCycleSequence(evidenceRows, cycles, null);
  const overall = computeTrendFromSequence(overallSequence);

  const subjectKeys = [...new Set(evidenceRows.map((row) => row.subjectKey))];
  const bySubject = subjectKeys.map((subjectKey) => {
    const sequence = getAvailableCycleSequence(evidenceRows, cycles, subjectKey);
    const result = computeTrendFromSequence(sequence);
    return { subjectKey, trend: result.trend, evidenceRefs: result.evidenceRefs };
  });

  return { overall: overall.trend, overallEvidenceRefs: overall.evidenceRefs, bySubject };
}

// ---------------------------------------------------------------------
// §2.4 — Consistency
// ---------------------------------------------------------------------

function computeConsistencyFromSequence(sequence) {
  if (sequence.length < 2) {
    return { spreadPercentPoints: null, label: 'insufficient_data', evidenceRefs: sequence.flatMap((entry) => entry.evidenceRefs) };
  }

  const maxEntry = sequence.reduce((a, b) => (b.percent > a.percent ? b : a));
  const minEntry = sequence.reduce((a, b) => (b.percent < a.percent ? b : a));
  const spreadPercentPoints = round1(maxEntry.percent - minEntry.percent);
  const label = spreadPercentPoints <= CONSISTENCY_SPREAD_THRESHOLD_PERCENT_POINTS ? 'stable' : 'variable';
  const evidenceRefs = [...new Set([...maxEntry.evidenceRefs, ...minEntry.evidenceRefs])];

  return { spreadPercentPoints, label, evidenceRefs };
}

export function getConsistency(classroom, studentId) {
  const evidenceRows = getStudentExamEvidence(classroom, studentId);
  const cycles = listExaminationCycles(classroom);

  const overallSequence = getAvailableCycleSequence(evidenceRows, cycles, null);
  const overall = computeConsistencyFromSequence(overallSequence);

  const subjectKeys = [...new Set(evidenceRows.map((row) => row.subjectKey))];
  const bySubject = subjectKeys.map((subjectKey) => {
    const sequence = getAvailableCycleSequence(evidenceRows, cycles, subjectKey);
    const result = computeConsistencyFromSequence(sequence);
    return { subjectKey, spreadPercentPoints: result.spreadPercentPoints, label: result.label, evidenceRefs: result.evidenceRefs };
  });

  return { overall, bySubject };
}

// ---------------------------------------------------------------------
// §2.5 — Subject Strengths / Developing / Needs Improvement / Not Yet Assessed
// ---------------------------------------------------------------------

/** Absolute banding only — reuses the current-performance snapshot's own band exactly, no "top N" ranking, no ties to break. */
export function getSubjectBands(classroom, studentId) {
  const performance = getCurrentPerformance(classroom, studentId);
  if (!performance.asOfCycleKey) {
    return { strengths: [], developing: [], areasNeedingImprovement: [], notYetAssessed: [], reason: 'no_published_results' };
  }

  const buckets = { strengths: [], developing: [], areasNeedingImprovement: [], notYetAssessed: [] };
  performance.bySubject.forEach((entry) => {
    const item = { subjectKey: entry.subjectKey, subjectTitle: entry.subjectTitle, percent: entry.percent, evidenceRefs: entry.evidenceRefs };
    if (entry.band === 'green') buckets.strengths.push(item);
    else if (entry.band === 'yellow') buckets.developing.push(item);
    else if (entry.band === 'red') buckets.areasNeedingImprovement.push(item);
    else buckets.notYetAssessed.push(item);
  });

  return { ...buckets, reason: null };
}

// ---------------------------------------------------------------------
// §2.6 — Attention Flags (each independent, never collapsed into a
// composite score — see this file's own header comment / guardrail #7)
// ---------------------------------------------------------------------

/** Cycle-scoped flags (failed_subject_latest_cycle, not_assessed_latest_cycle) — evaluated against ONE SPECIFIC cycle, which may differ from this student's own "current" cycle when called from the class rollup (§3.3 R3). */
function getCycleScopedFlags(classroom, studentId, cycleKey) {
  if (!cycleKey) return [];

  const evidenceRows = getStudentExamEvidence(classroom, studentId);
  const cycleRows = evidenceRows.filter((row) => row.cycleKey === cycleKey);
  if (cycleRows.length === 0) return [];

  const subjectKeys = [...new Set(cycleRows.map((row) => row.subjectKey))];
  const flags = [];

  subjectKeys.forEach((subjectKey) => {
    const rowsForSubject = cycleRows.filter((row) => row.subjectKey === subjectKey);
    const percent = subjectCyclePercent(evidenceRows, cycleKey, subjectKey);
    const passMarkPercent = rowsForSubject[0].passMarkPercent;
    const band = bandOf(percent, passMarkPercent);
    const evidenceRefs = rowsForSubject.filter((row) => row.percent !== null).map((row) => row.assessmentSubjectId);

    if (band === 'red') {
      flags.push({ flag: 'failed_subject_latest_cycle', subjectId: subjectKey, evidenceRefs, detail: { percent, passMarkPercent, cycleKey } });
    }
    if (band === 'not_assessed') {
      flags.push({ flag: 'not_assessed_latest_cycle', subjectId: subjectKey, evidenceRefs: [], detail: { cycleKey } });
    }
  });

  return flags;
}

function getTrendAttentionFlags(classroom, studentId) {
  const trend = getTrend(classroom, studentId);
  const flags = [];

  if (trend.overall === 'declining') {
    flags.push({ flag: 'declining_trend_overall', subjectId: null, evidenceRefs: trend.overallEvidenceRefs, detail: {} });
  }
  trend.bySubject.forEach((entry) => {
    if (entry.trend === 'declining') {
      flags.push({ flag: 'declining_trend_subject', subjectId: entry.subjectKey, evidenceRefs: entry.evidenceRefs, detail: {} });
    }
  });

  return flags;
}

function getCheckpointAttentionFlags(classroom, studentId) {
  const today = getCurrentIsoDate().slice(0, 10);
  const rows = getStudentCheckpointEvidence(classroom, studentId);

  const groups = new Map();
  rows.forEach((row) => {
    if (!row.dueDate || row.dueDate >= today) return; // only genuinely past-due checkpoints count
    const key = `${row.subjectId}::${row.notebookTypeId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const flags = [];
  groups.forEach((groupRows, key) => {
    if (groupRows.length < CHECKPOINT_MIN_PAST_DUE) return; // minimum-evidence floor — never fires on a thin sample, regardless of rate

    const [subjectId, notebookTypeId] = key.split('::');
    const incompleteCount = groupRows.filter((row) => row.submissionStatus === 'submitted' && row.reviewStatus === 'incomplete').length;
    const notSubmittedCount = groupRows.filter((row) => row.submissionStatus === 'not_submitted').length;
    const combinedRate = (incompleteCount + notSubmittedCount) / groupRows.length;
    const notSubmittedRate = notSubmittedCount / groupRows.length;

    if (combinedRate >= CHECKPOINT_INCOMPLETE_RATE_THRESHOLD || notSubmittedRate >= CHECKPOINT_NOT_SUBMITTED_RATE_THRESHOLD) {
      flags.push({
        flag: 'high_incomplete_checkpoint_rate',
        subjectId,
        evidenceRefs: groupRows.map((row) => row.checkpointId),
        detail: {
          notebookTypeId,
          pastDueCount: groupRows.length,
          incompleteCount,
          notSubmittedCount,
          combinedRatePercent: round1(combinedRate * 100),
          notSubmittedRatePercent: round1(notSubmittedRate * 100),
        },
      });
    }
  });

  return flags;
}

/** repeated_help_requests reads a CURRENT boolean state that is always fully known — zero flagged concepts is a real, directly-observed "false," never `insufficient_data` (see spec §2.6's own rationale). */
function getHelpRequestAttentionFlags(classroom, studentId) {
  const student = getStudentOrThrow(classroom, studentId);
  const flaggedConcepts = learningRecordService
    .getAllConcepts(classroom)
    .filter(({ concept }) => learningRecordService.getStudentConceptRecord(student, concept.id).helpRequested);

  if (flaggedConcepts.length < HELP_REQUEST_FLAG_THRESHOLD) return [];

  return [
    {
      flag: 'repeated_help_requests',
      subjectId: null,
      evidenceRefs: flaggedConcepts.map(({ concept }) => concept.id),
      detail: { count: flaggedConcepts.length },
    },
  ];
}

/** Non-cycle-scoped flags — always evaluated against live/current state, regardless of which cycle a caller is asking about (see §3.3 R3). */
function getLiveStateFlags(classroom, studentId) {
  return [
    ...getTrendAttentionFlags(classroom, studentId),
    ...getCheckpointAttentionFlags(classroom, studentId),
    ...getHelpRequestAttentionFlags(classroom, studentId),
  ];
}

/** This student's own attention flags, as of their own most recent assessable cycle. */
export function getAttentionFlags(classroom, studentId) {
  const performance = getCurrentPerformance(classroom, studentId);
  return [...getCycleScopedFlags(classroom, studentId, performance.asOfCycleKey), ...getLiveStateFlags(classroom, studentId)];
}

/** The class-rollup variant (§3.3) — cycle-scoped flags pinned to the REQUESTED cycle, not necessarily this student's own current one. */
function getAttentionFlagsForCycle(classroom, studentId, cycleKey) {
  return [...getCycleScopedFlags(classroom, studentId, cycleKey), ...getLiveStateFlags(classroom, studentId)];
}

// ---------------------------------------------------------------------
// Single per-student entry point
// ---------------------------------------------------------------------

export function getStudentAcademicProgress(classroom, studentId) {
  return {
    studentId,
    currentPerformance: getCurrentPerformance(classroom, studentId),
    growthSeries: getGrowthSeries(classroom, studentId),
    trend: getTrend(classroom, studentId),
    consistency: getConsistency(classroom, studentId),
    subjectBands: getSubjectBands(classroom, studentId),
    attentionFlags: getAttentionFlags(classroom, studentId),
  };
}

// ---------------------------------------------------------------------
// §3 — Class-level rollups
// ---------------------------------------------------------------------

/** §3.1 — plain mean of each student's own subjectCyclePercent (apples-to-apples: the SAME subject's percent across different students, not different subjects' percentages within one student — see spec §3.1 for why this differs from the sum-based per-student Overall % rule above). */
export function getClassSubjectAverages(classroom, cycleKey) {
  const students = assessmentService.getClassroomStudents(classroom);
  const subjectKeys = [
    ...new Set(
      getEligibleAssessments(classroom)
        .filter((assessment) => resolveCycleKey(assessment) === cycleKey)
        .flatMap((assessment) => assessment.assessmentSubjects.map((as) => resolveSubjectKey(classroom, as.subjectId)))
    ),
  ];

  return subjectKeys.map((subjectKey) => {
    const percents = students
      .map((student) => subjectCyclePercent(getStudentExamEvidence(classroom, student.id), cycleKey, subjectKey))
      .filter((percent) => percent !== null);
    return {
      subjectKey,
      averagePercent: percents.length > 0 ? round1(percents.reduce((sum, p) => sum + p, 0) / percents.length) : null,
      assessedCount: percents.length,
      totalCount: students.length,
    };
  });
}

/**
 * §3.2 — every roster student counted in exactly one of
 * {green, yellow, red, not_assessed}; counts always sum to totalCount.
 * `subjectKey: null` (the default) computes the 'overall' pseudo-row;
 * since a blended overall score has no single natural pass mark across
 * subjects, this uses the system-wide default PASS_MARK_PERCENT as the
 * red/yellow boundary for that one row — an explicit, documented
 * interpretation choice (see docs/architecture/ACADEMIC_PROGRESS_METRIC_SPEC.md
 * for the per-subject rule, which always uses that subject's own
 * Assessment-specific pass mark instead).
 */
export function getClassDistribution(classroom, cycleKey, subjectKey = null) {
  const students = assessmentService.getClassroomStudents(classroom);
  const counts = { green: 0, yellow: 0, red: 0, not_assessed: 0 };

  students.forEach((student) => {
    const evidenceRows = getStudentExamEvidence(classroom, student.id);
    let percent;
    let passMarkPercent;

    if (subjectKey) {
      percent = subjectCyclePercent(evidenceRows, cycleKey, subjectKey);
      const row = evidenceRows.find((r) => r.cycleKey === cycleKey && r.subjectKey === subjectKey);
      passMarkPercent = row ? row.passMarkPercent : PASS_MARK_PERCENT;
    } else {
      percent = overallCyclePercent(evidenceRows, cycleKey);
      passMarkPercent = PASS_MARK_PERCENT;
    }

    counts[bandOf(percent, passMarkPercent)] += 1;
  });

  return counts;
}

/** §3.3 */
export function getStudentsNeedingAttention(classroom, cycleKey) {
  return assessmentService
    .getClassroomStudents(classroom)
    .map((student) => ({
      studentId: student.id,
      studentName: student.name,
      flags: getAttentionFlagsForCycle(classroom, student.id, cycleKey),
    }))
    .filter((entry) => entry.flags.length > 0);
}

/** §3.4 */
export function getClassGrowth(classroom, fromCycleKey, toCycleKey) {
  const students = assessmentService.getClassroomStudents(classroom);
  const deltas = students
    .map((student) => growthBetween(getStudentExamEvidence(classroom, student.id), fromCycleKey, toCycleKey, null))
    .filter((growth) => growth.deltaPercentPoints !== null);

  if (deltas.length === 0) {
    return { meanDeltaPercentPoints: null, reason: 'insufficient_data', studentCount: 0 };
  }

  return {
    meanDeltaPercentPoints: round1(deltas.reduce((sum, g) => sum + g.deltaPercentPoints, 0) / deltas.length),
    reason: null,
    studentCount: deltas.length,
  };
}

export function getClassAcademicProgressInsights(classroom, cycleKey) {
  return {
    cycleKey,
    subjectAverages: getClassSubjectAverages(classroom, cycleKey),
    distribution: getClassDistribution(classroom, cycleKey),
    studentsNeedingAttention: getStudentsNeedingAttention(classroom, cycleKey),
  };
}
