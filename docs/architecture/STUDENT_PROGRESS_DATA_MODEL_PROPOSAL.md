# Student Progress / Progress Insights — Evidence Audit & Proposed Data Model

**Status:** Design proposal only. No code, Firestore schema, or UI has been
changed to produce this document. It audits what evidence already exists in
`classroom-tracker` today (traced to specific files), then proposes a
deterministic, non-AI computation layer on top of it. Nothing here invents a
new stored collection unless explicitly marked "NEW STORAGE" — the default
assumption, matching every derived-metrics file already in this codebase
(`scorecardService.js`, `studentProgressService.js`), is that progress is
**computed fresh from existing records, never persisted as its own fact.**

**Explicitly out of scope for this pass:** any AI-generated narrative,
summary sentence, or recommendation text. Everything below is numbers,
categories, and flags a teacher or student could verify by hand against the
underlying records. A narrative layer can be built later **on top of** this
model's output fields — it should never need to re-derive a number itself.

---

## Part 1 — Audit: what reliable student-level evidence exists today

### 1.1 Examination marks (the one genuinely numeric, teacher-entered signal)

| Model | File | Fields |
|---|---|---|
| `Assessment` | `js/models/Assessment.js` | `id, classroomId, title, type, academicYear, date, status ('Draft'\|'Published'\|'Locked'), assessmentSubjects[], scheduledEventId, passMarkPercent` |
| `AssessmentSubject` | `js/models/AssessmentSubject.js` | `id, subjectId, maximumMarks (default 100), studentResults[], lastSavedAt` |
| `StudentResult` | `js/models/StudentResult.js` | `id, studentId, marks (nullable), absent, remarks` |

Facts directly observed, per student, per subject, per exam:
- **Marks obtained** and **maximum marks** (`StudentResult.marks` / `AssessmentSubject.maximumMarks`) — the only place a raw numeric score exists anywhere in this codebase.
- **Absence** (`absent: true`) — explicitly distinct from "no mark entered yet." Both must be excluded from numeric aggregation, never treated as 0 (already the convention in `assessmentService.getStudentOutcome()` and `scorecardService.buildScorecardForCycle()`).
- **Date** — either `Assessment.date` (manually created) or resolved live from the linked `ScheduledEvent` (`scheduledEventId`) if Timetable-linked.
- **Type** (`Mid Term | Unit Test | Quarterly | Half Yearly | Annual | Custom` — `js/config/assessmentTypesConfig.js`) and **title** (free text, with a predefined-name picker — `js/config/examNameConfig.js`: `1st/2nd/3rd Mid Term Examinations, Quarterly, Half Yearly, Final`).
- **Subject** — `AssessmentSubject.subjectId`, resolved live (never copied) via `assessmentService.getSubjectTitle()`.
- **Pass/fail outcome** — `assessmentService.getStudentOutcome()`: `'passed' | 'failed' | 'not_assessed'`, "weakest link" across every subject in that one Assessment, relative to that Assessment's own `passMarkPercent` (default 36%, `config/assessmentMarksColorConfig.js`).
- **Publish state** — only `status === 'Published'` assessments are visible to students (`StudentAssessmentResultsView.js` convention); `Draft` is real teacher-side data but not yet real to a student. `Locked` is a modeled-but-unimplemented future state.

**Cross-exam aggregation already exists** — `js/services/scorecardService.js` — but narrowly scoped:
- A "cycle" (e.g. "Quarterly Examinations" across all subjects) is either (a) a set of `ScheduledEvent`s sharing an exact `title` string (`scheduledEventService.groupEventsByTitle()`), or (b) a fallback match of any Assessment whose `title` string-equals the cycle's title.
- `buildScorecardForCycle()` computes **Overall % = sum(obtained) / sum(maximum)** across every subject where the student has a usable mark — never a per-subject average of percentages, never a fabricated 0 for an ungraded subject. This is the one existing precedent for "cross-subject aggregate" math and should be reused, not reinvented.

### 1.2 Concept-level evidence (formative, non-numeric)

```
Classroom.learningRecord.subjects[] (LearningSubject)
  └── units[] (LearningUnit)
        └── concepts[] (LearningConcept: id, title, status 'taught'|'not_taught')
Student.learningRecord[conceptId] → StudentConceptRecord: { understanding, notebook, helpRequested, updatedAt }
```
- `LearningConcept.status` is **classroom-wide**, binary, teacher-set — "has this been taught to the class," not a per-student mastery signal.
- `StudentConceptRecord.understanding` is **student self-reported** (`UNDERSTANDING_KEYS`), not teacher-verified — a real signal, but categorically different in reliability from a graded mark.
- `StudentConceptRecord.notebook` is teacher-set, per concept — a different (coarser) notebook signal than §1.3's Checkpoints.
- `helpRequested` — a boolean the student can raise/withdraw.

**This is real evidence, but it is self-report/status, not a score.** It should never be blended numerically with exam percentages; it can inform "areas needing improvement" only as a separate, clearly-labeled qualitative layer.

### 1.3 Notebook Checkpoints (formative, submission/review workflow)

`js/models/Checkpoint.js` + `StudentCheckpointRecord` (`js/services/checkpointService.js`): per teacher-defined checkpoint within a Notebook (Subject × Notebook Type) — `submissionStatus ('not_submitted'|'submitted')`, `reviewStatus ('not_reviewed'|'complete'|'incomplete')`, `late` (derived: submitted after `dueDate`), optional `teacherNote`. One point is awarded on transition into `submitted`+`complete` (`syncCheckpointCompletionPoint()`), feeding the behavioral score (§1.5) — **not** an academic mark.

Usable for: completion rate, lateness rate, "incomplete" rate per subject/notebook — consistency/habit signals, not subject mastery.

### 1.4 Learning Activities / submissions (partially built, inconsistent coverage)

`Student.submissions[learningActivityId] = { status, feedback, score, scoreMax, completedAt, source ('classmate'|'learning_hub'|'external'), conceptId, updatedAt }` (`js/models/Student.js`, extended per `docs/LEARNING_HUB_INTEGRATION_CONTRACT.md`). Per the current-state architecture audit (`docs/CLASSMATE_ARCHITECTURE_CURRENT_STATE.md` §8, §13): the `learning_hub`/`external` launch-and-result path is **modeled but has no real network path today** — nothing external actually writes a result yet. Only `source: 'classmate'` (teacher-graded) entries should be treated as reliable evidence right now; `score`/`scoreMax` is additive and not guaranteed populated on every entry.

### 1.5 Behavioral score / stars (exists, already has its own "progress" service — explicitly NOT academic)

`student.history` (`js/services/timelineService.js`) + `js/services/studentProgressService.js` (stars-in-range, streaks, rank, "Biggest Climber"). **Naming collision risk:** `studentProgressService.js` already owns the term "Student Progress" for this behavioral/participation layer. Any new academic-progress module must be named distinctly (see Part 3) to avoid confusion with this existing, shipped file.

### 1.6 Signals confirmed absent

- **No general daily classroom attendance model.** `ProgrammeAttendanceControls`/`ProgrammeAttendanceView` are scoped to Learning Programme *sessions*, a separate, narrower feature — not whole-classroom daily attendance. Attendance is **not** available as a cross-subject signal today.
- **No stored grade/GPA anywhere** — `StudentResult.js`'s own header comment is explicit: "no grade is computed or stored here."
- **No cross-classroom student identity** (`CLASSMATE_ARCHITECTURE_CURRENT_STATE.md` §11/§12) — a student's evidence trail is bounded to one classroom; moving classrooms loses history structurally, not just as a display gap.

### 1.7 Data-quality caveats that must shape the design, not be papered over

1. **Cycle identity is a title-string match, nothing more.** Two independently-created "Mid Term" Assessments are only the same cycle if they share the *exact* title AND (for the primary path) are linked to `ScheduledEvent`s sharing that title. A rename breaks the chain silently. `scorecardService.js`'s own header comment states manually-created, unlinked Assessments with a one-off title are "out of scope" for cycle grouping — but Progress needs *some* notion of "which exam came before which," including manual ones. This is a real gap (see Part 3, Decision A).
2. **`maximumMarks` varies per Assessment per Subject and can legitimately differ exam to exam** — comparisons across exams must always use **percentage**, never raw marks.
3. **`passMarkPercent` is per-Assessment, not a fixed constant** — pass/fail is assessment-relative. `GREEN_THRESHOLD_PERCENT` (70%) is the one fixed, pass-mark-independent boundary (`assessmentMarksColorConfig.js`).
4. **Absent ≠ zero ≠ not-yet-entered.** All three are "no usable mark" for aggregation purposes, but are semantically different and must stay distinguishable in the evidence layer (a teacher needs to know *which*).
5. **`subjectId` ambiguity** (`CLASSMATE_ARCHITECTURE_CURRENT_STATE.md` §16.7): the same field name means two different things in two different places (a `LearningSubject` record id vs. a canonical registry id). Subject identity across exams in this proposal is always resolved through `assessmentService.getSubjectTitle()` (the existing, single fallback chain) — never compared as raw ids across Assessments.
6. **Draft assessments are real teacher data but not real to a student.** Any student-facing computation must filter to `status === 'Published'` (teacher-facing views may optionally include Drafts, clearly labeled as such).

---

## Part 2 — Proposed data model

Everything below is **computed on demand**, never a new persisted collection, per this codebase's established convention (`scorecardService.js`'s own header: "nothing here writes anything... every number shown is computed fresh"). The one exception called out explicitly is NEW STORAGE in Decision A.

### 2.1 Evidence layer (directly observed — one hop from the raw records, zero interpretation)

```
StudentAcademicEvidence {
  examRecords: [{
    assessmentId, cycleKey, title, type, date,       // cycleKey: see Decision A
    subjectId, subjectTitle,
    marksObtained: number | null,                     // null = absent or not entered
    maximumMarks: number,
    percent: number | null,                            // round(marksObtained/maximumMarks * 100, 1)
    absent: boolean,
    passMarkPercent: number,
    outcome: 'passed' | 'failed' | 'not_assessed',      // per-subject, same rule as assessmentService.getStudentOutcome but single-subject
    status: 'Draft' | 'Published' | 'Locked',
    remarks: string
  }],

  conceptEvidence: [{
    conceptId, subjectId, unitId, taughtStatus,
    understanding, notebookStatus, helpRequested, updatedAt
  }],                                                  // explicitly labeled self-report/teacher-status, not a score

  activityEvidence: [{
    activityId, conceptId, subjectId,
    score, scoreMax, percent, completedAt, source
  }],                                                  // source: 'classmate' only is "reliable" today; others flagged low-confidence

  checkpointEvidence: [{
    checkpointId, subjectId, notebookTypeId,
    submissionStatus, reviewStatus, late, dueDate, submittedDate
  }]
}
```

Every field here is traceable 1:1 to an existing stored record. No computation beyond unit conversion (percent) and null-safety happens at this layer.

### 2.2 Derived academic metrics (deterministic formulas only)

```
StudentAcademicProgress {
  studentId, classroomId,
  asOfCycleKey,                                        // most recent cycle with ≥1 usable mark

  currentPerformance: {
    overallPercent: number | null,                      // scorecardService's own sum(obtained)/sum(max) rule, reused verbatim
    bySubject: [{ subjectId, subjectTitle, percent, bucket: 'green'|'yellow'|'red'|null, outcome }]
  },

  growth: [{                                            // one entry per consecutive cycle PAIR, chronological
    fromCycleKey, toCycleKey,
    overallDeltaPercentPoints: number | null,            // null if either cycle has no usable overall mark
    bySubject: [{ subjectId, deltaPercentPoints: number | null }]
  }],

  trend: {
    overall: 'improving' | 'declining' | 'stable' | 'insufficient_data',
    bySubject: [{ subjectId, trend }]
  },                                                     // rule: see 2.3

  consistency: {
    overall: { spreadPercentPoints: number | null, label: 'stable'|'variable'|'insufficient_data' },
    bySubject: [{ subjectId, spreadPercentPoints, label }]
  },                                                     // rule: see 2.3

  strengths: [{ subjectId, subjectTitle, percent, basis: 'latest_cycle' }],       // top band, see 2.3
  areasNeedingImprovement: [{ subjectId, subjectTitle, percent, basis }],         // bottom band, see 2.3

  attentionFlags: [{                                     // each independently true/false, each traceable — NEVER a single opaque score
    flag: 'failed_subject_latest_cycle' | 'declining_trend' | 'high_incomplete_notebook_rate' | 'repeated_help_requests' | 'not_assessed_latest_cycle',
    subjectId: string | null,
    evidenceRefs: [ids into 2.1]
  }],

  conceptFormativeSummary: [{                            // separate, non-numeric layer — never merged into percent/trend above
    subjectId,
    understandingDistribution: { not_marked, ...counts },
    helpRequestedCount,
    notebookCompletionRate: number | null
  }]
}
```

### 2.3 Exact deterministic rules (must be pinned down before implementation — proposed defaults, flagged `[DECISION]` where a product call is needed)

- **Cycle ordering** — cycles sorted by their earliest matched event date (Timetable-linked) or `assessment.date` (manual), ascending. `[DECISION]` whether manual, unlinked same-named Assessments should be treated as a valid cycle chain for Progress even though `scorecardService.js` deliberately excludes them from the Scorecard view today (see Decision A below).
- **Growth** — simple percent-point delta between adjacent cycles, per subject and overall; **null, not 0**, when either side lacks a usable mark ("insufficient_data" is a real, displayable state, never silently hidden as a 0% change).
- **Trend** — proposed rule: look at the last up-to-3 cycle-to-cycle deltas (2.2 `growth`); `'improving'` if the majority of available deltas are positive, `'declining'` if majority negative, `'stable'` if roughly flat (±2 percentage points) or mixed with no majority, `'insufficient_data'` if fewer than 2 cycles exist. This mirrors `getBiggestClimber()`'s own existing precedent of "only declare a real signal when the data supports it, never fabricate movement."
- **Consistency** — proposed rule: `spreadPercentPoints = max(overallPercent across cycles) - min(overallPercent across cycles)`; `'stable'` below a threshold (proposed 15 points), `'variable'` above, `'insufficient_data'` under 2 cycles. (Standard deviation is an alternative if more cycles accumulate over a year — spread is simpler and auditable by a teacher with ≤4-5 cycles/year, which is this app's realistic scale.)
- **Strengths / areas needing improvement** — proposed rule: rank subjects by latest-cycle percent; top 2 (or all ≥ `GREEN_THRESHOLD_PERCENT`, whichever is fewer) = strengths, bottom 2 (or all < `passMarkPercent`) = needs improvement. `[DECISION]`: absolute banding (reusing the existing green/yellow/red thresholds, consistent with every other screen in this app) vs. relative-to-this-student's-own-average vs. relative-to-class-average. Recommendation: **absolute banding first** (zero new computation, consistent with existing UI language the teacher already knows), with relative-to-class as a later, additive layer built on `scorecardService`'s existing per-cycle class aggregation rather than a competing one.
- **Attention flags** — each flag is an independent boolean with its own named rule and cited evidence ids, never collapsed into one "risk score." A teacher-facing UI can show *why* a student is flagged; a single composite score cannot be explained without this layer underneath it anyway, so build the explainable layer first regardless of whether a composite is added later.

### 2.4 Class/teacher roll-up — `ClassAcademicProgressInsights`

Built by mapping §2.2 over every roster student for one classroom, reusing `scorecardService.getClassroomStudents()` and its existing per-cycle subject columns:
```
ClassAcademicProgressInsights {
  classroomId, cycleKey,
  subjectAverages: [{ subjectId, averagePercent, assessedCount, totalCount }],  // already-existing scorecardService shape, reused
  studentsNeedingAttention: [{ studentId, studentName, flags: [...] }],          // flags per 2.2, aggregated across students
  distribution: { green: count, yellow: count, red: count, notAssessed: count }
}
```
This is a thin wrapper, not a new aggregation engine — `scorecardService.js` already computes everything needed for `subjectAverages`/`distribution` per cycle; this just adds the per-student `attentionFlags` roll-up on top.

---

## Part 3 — Open decisions to resolve before implementation

**Decision A — Cycle identity for manually-created Assessments.** `scorecardService.js` deliberately limits "cycle" grouping to Timetable/`ScheduledEvent`-linked Assessments sharing a title, because a looser title-match across independently-created Assessments "is NOT reliably the same cycle." Progress/growth needs *some* reliable way to order and compare exams across a term, including ones a teacher created by hand (not every school's Mid-Term is Timetable-scheduled in this app today). Options: (1) reuse the exact same narrow definition and simply report "insufficient data" for any student/classroom that hasn't adopted Timetable-linked exams — safest, most consistent with existing code, but may under-deliver for real users; (2) widen cycle identity specifically for Progress to include exact-title-matched manual Assessments (what `buildScorecardForCycle()`'s own secondary fallback already does *within* a cycle, just not for *discovering* cycles) — more coverage, same reliability ceiling as the existing fallback already accepted elsewhere in this codebase. **Recommend (2)**, since it reuses a rule already judged acceptable in `scorecardService.js` rather than inventing a new reliability bar.

**Decision B — Where this computation lives.** Must not be named `studentProgressService.js` (taken, behavioral/stars). Recommend `js/services/academicProgressService.js` (student-level, §2.1–2.2) and extending `scorecardService.js` itself for §2.4 (class roll-up), since that file already owns "aggregate across students, per cycle."

**Decision C — Self-report concept evidence's role.** `StudentConceptRecord.understanding` is student-entered, not verified. Recommend it appears only in `conceptFormativeSummary` (clearly separated, never contributing to `percent`/`trend`/`strengths` above it) until/unless a product decision says otherwise — keeps "evidence vs. inference" honest exactly as asked.

**Decision D — Student-facing visibility gate.** Confirm: student's own `StudentAcademicProgress` must filter `examRecords` to `status === 'Published'` only (never Draft), matching `StudentAssessmentResultsView.js`'s existing convention — teacher view may optionally surface Drafts, clearly labeled "Draft — not yet visible to student."

---

## Summary

The only genuinely numeric, teacher-verified, cross-exam-comparable evidence in ClassMate today is **exam marks** (`Assessment`/`AssessmentSubject`/`StudentResult`), aggregated per the existing `scorecardService.js` rules (percentage-based, never-fabricate-zero, exclude absent/ungraded). Concept understanding, notebook/checkpoint status, and activity scores are real but structurally different (self-report, binary status, inconsistently populated) and must stay in a clearly separate, non-numeric evidence layer. Behavioral stars/points already have their own "progress" vocabulary in this codebase (`studentProgressService.js`) and must not be confused with academic progress. The model above computes current performance, growth, trend, consistency, strengths/weaknesses, and attention flags entirely from existing records with named, auditable formulas — no AI narrative layer is needed (or should be built) until this foundation is agreed on.
