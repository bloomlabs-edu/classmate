# Academic Progress — Metric Specification & Test Matrix

**Status:** Specification only. No code implemented. Builds on, and assumes
the three locked decisions from `STUDENT_PROGRESS_DATA_MODEL_PROPOSAL.md`:

1. Examination cycles must be identifiable across manually-created and
   Timetable-linked Assessments alike, via a stable mechanism — not fuzzy
   title matching as the permanent model. Title matching is retained only
   as a **compatibility fallback** for Assessments that predate the stable
   mechanism.
2. The academic module is `academicProgressService.js` — fully separate
   from the existing behavioral `studentProgressService.js` (stars,
   streaks, Biggest Climber). Neither file imports the other's domain
   concepts.
3. Every metric below reads **only** `Assessment.status === 'Published'`
   records. **Resolved during implementation:** `'Locked'` is also
   excluded (treated the same as `'Draft'`) — only `'Published'` is a
   real, finished exam for academic-progress purposes, per the approved
   guardrail ("Published assessments only"); `'Locked'` isn't a
   functional status anywhere else in this codebase today either. This
   narrows this section's own earlier tentative "Published or Locked"
   wording below — every occurrence of that phrasing in this document is
   superseded by this one line. `'Draft'` is invisible to every metric in
   this spec, for both teacher and student views, with no exception.
   Absent, not-entered, and zero remain three distinct, never-conflated
   states throughout.

Everything in Part 1–4 is **deterministic**: given the same classroom data,
every function returns the exact same output, every time, with no
AI/LLM call anywhere in the path. Part 5 explicitly marks the line where a
future interpretive/narrative layer would begin — nothing on that side is
specified or built here.

---

## 0. Prerequisites — resolution rules every metric below depends on

### 0.1 Cycle identity (Decision 1)

**Long-term mechanism (proposed, not yet implemented — a schema addition, called out explicitly so it is never confused with something already built):** a new optional field `Assessment.examinationCycleId`, referencing a new, explicit `ExaminationCycle` record `{ id, classroomId, academicYear, title, createdAt }` that a teacher selects or creates once, shared by every Assessment that is genuinely the same cycle — manually created or Timetable-linked alike. This is the stable identity Decision 1 asks for. It is a future data-model/UI change, out of scope for this document (no UI is being built here).

**Resolution algorithm — what every function in this spec actually calls:**

```
resolveCycleKey(classroom, assessment):
  if assessment.examinationCycleId:                      # long-term path, once it exists
    return assessment.examinationCycleId
  # compatibility fallback — title matching, scoped and bounded, never the
  # permanent mechanism:
  return `${assessment.academicYear || ''}::${normalizeTitle(assessment.title)}`
```

`normalizeTitle()` = trim + collapse internal whitespace + case-fold. The fallback key is **scoped by `academicYear`**, closing a gap the existing `scorecardService.groupEventsByTitle()` does not close today (it compares raw titles with no year scoping) — two different years' "Quarterly Examinations" must never collapse into one cycle.

**Cycle eligibility:** a cycle is included in any academic-progress computation only if it contains **at least one** `Assessment` with `status ∈ {Published, Locked}`. A cycle whose every Assessment is still `Draft` does not exist yet, for progress purposes — it must not appear in any cycle list, teacher or student side.

**Cycle representative date** (for chronological ordering): the earliest `date` among the cycle's own eligible (Published/Locked) Assessments — resolved live from the linked `ScheduledEvent` when `scheduledEventId` is set, else `Assessment.date` directly (same resolution `assessmentService`/`scheduledEventService` already use elsewhere; no new date logic invented).

### 0.2 Subject identity across cycles

`AssessmentSubject.subjectId` is, per the existing architecture audit, ambiguous — it may be a `LearningSubject.id` (record-local) or a canonical subject id directly. Comparing raw `subjectId` strings across two different Assessments is **not safe** by itself. Every metric below compares subjects via a resolved `subjectKey`:

```
resolveSubjectKey(classroom, rawSubjectId):
  subject = learningRecordService.getSubjects(classroom).find(s => s.id === rawSubjectId)
  return subject ? subject.subjectId : rawSubjectId   # LearningSubject's own canonical id, or the raw value itself if it was already canonical
```

This reuses the exact same two-case resolution `assessmentService.getSubjectTitle()` already performs — no second, competing resolution is introduced. `subjectTitle` for display is still resolved via the existing `getSubjectTitle()`; `subjectKey` (this spec's addition) is strictly for cross-cycle identity comparison, never shown in UI.

### 0.3 Percentage normalization (used by every metric)

```
round1(x) = Math.round(x * 10) / 10          # one decimal place, half-up
toPercent(marksObtained, maximumMarks):
  if marksObtained === null or maximumMarks <= 0: return null
  return round1((marksObtained / maximumMarks) * 100)
```

Raw marks are never compared directly across two exams. Every cross-exam number in this spec is a percentage.

### 0.4 Absent / not-entered / zero (must stay distinguishable everywhere)

| State | Condition | Included in numeric aggregation? | Counted as |
|---|---|---|---|
| **Zero** | A `StudentResult` row exists, `absent: false`, `marks: 0` | **Yes** — percent = 0, a real, poor-but-real score | a usable mark |
| **Absent** | A `StudentResult` row exists, `absent: true` | **No** | `absentCount` |
| **Not entered** | No `StudentResult` row exists at all for this student in this `AssessmentSubject` | **No** | `notEnteredCount` |

No formula in this spec ever substitutes 0 for "absent" or "not entered." Every aggregate that excludes them reports `null` (not 0) when nothing usable exists, exactly matching the existing `scorecardService.js`/`assessmentService.js` convention.

### 0.5 Pass-mark and band resolution

```
getEffectivePassMarkPercent(assessment) = assessment.passMarkPercent ?? PASS_MARK_PERCENT   # 36, from assessmentMarksColorConfig.js — reused, never reinvented
GREEN_THRESHOLD_PERCENT = 70                                                                 # fixed, imported, never redefined
bandOf(percent, passMarkPercent):
  if percent === null: return 'not_assessed'
  if percent >= GREEN_THRESHOLD_PERCENT: return 'green'     # Strong
  if percent >= passMarkPercent: return 'yellow'            # Developing
  return 'red'                                              # Needs Help
```
Boundaries are inclusive on the pass side at both thresholds (`percent === passMarkPercent` → yellow, not red; `percent === 70` → green, not yellow) — matching `getMarksColorClass()`'s existing `>=` comparisons exactly.

### 0.6 Duplicate AssessmentSubject rows for the same (cycle, subject, student) — data-quality edge case

Normal use is one `AssessmentSubject` per subject per cycle. Cycle widening (Decision 1) makes it *possible* for two independently-created Assessments in the same cycle to both include the same subject (teacher error, or a genuinely multi-part exam). Rule: **sum** `marksObtained` and `maximumMarks` across every usable row for that exact (cycleKey, subjectKey, studentId) before computing percent — consistent with the existing sum-based (never average-of-percentages) philosophy — and attach a `duplicateSubjectInCycle: true` data-quality flag to the resulting evidence so a teacher UI can surface it rather than silently merge it. This is never silently dropped to "pick one."

---

## 1. Evidence layer — `StudentAcademicEvidence` (uninterpreted mirror)

One exam-evidence row per (student, AssessmentSubject) pair where that AssessmentSubject's parent `Assessment.status ∈ {Published, Locked}`:

```
ExamEvidenceRow {
  assessmentId, assessmentSubjectId, cycleKey, cycleTitle, academicYear,
  subjectKey, subjectTitle, date, type, status,
  marksObtained: number | null,
  maximumMarks: number,
  absent: boolean,
  entered: boolean,                 # false only for "not entered" (no StudentResult row)
  percent: number | null,           # toPercent(marksObtained, maximumMarks); null if absent or not entered
  passMarkPercent: number,          # getEffectivePassMarkPercent(assessment)
  outcome: 'passed' | 'failed' | 'not_assessed',   # per-row: not_assessed if absent/not-entered; else percent >= passMarkPercent ? passed : failed
  remarks: string,
  duplicateSubjectInCycle: boolean  # see §0.6
}
```

**Minimum evidence to produce this layer at all:** zero — an empty array is a valid, correct result for a student with no Published exam data yet. Every downstream metric must handle a zero-length evidence array as `insufficient_data` / `null`, never throw.

Concept/activity/checkpoint evidence rows are unchanged from the prior proposal (`STUDENT_PROGRESS_DATA_MODEL_PROPOSAL.md` §2.1) and are not re-specified here except where §4 (attention flags) depends on their exact shape.

---

## 2. Per-student derived metrics

For every metric: **formula**, **minimum evidence**, **missing/absent/zero handling**, **edge cases**, **traceability**.

### 2.1 Current Performance

**Formula:**
```
asOfCycleKey = the eligible cycle (§0.1) with the latest representative date for which this student has ≥1 usable ExamEvidenceRow (percent !== null)
overallPercent = round1( sum(usable rows' marksObtained) / sum(usable rows' maximumMarks) * 100 )   # across ALL subjects in asOfCycleKey, sum-based — identical rule to scorecardService.buildScorecardForCycle()
bySubject = for every subjectKey present as an AssessmentSubject anywhere in asOfCycleKey (even if this student has no usable mark for it):
  { subjectKey, subjectTitle, percent, band: bandOf(percent, passMarkPercent), outcome }
```

**Minimum evidence:** ≥1 usable (non-absent, entered) mark in the most recent eligible cycle. If the student has zero usable marks in every eligible cycle ever, `currentPerformance = null` with `reason: 'no_published_results'`.

**Missing/absent handling:** a subject with `percent === null` in `bySubject` still appears (band `'not_assessed'`), never silently omitted — matches `scorecardService`'s "honestly show an expected-but-not-yet-graded subject."

**Edge cases:**
- Multiple eligible cycles tie on the exact same representative date → the one with the lexicographically later `cycleKey` is chosen deterministically (documented tie-break, not left to array order), and this is flagged as a data-quality note (two cycles should not legitimately share a date in normal use).
- A cycle entirely Published but with zero usable marks across every subject (exam happened, nothing graded yet) is **not** `asOfCycleKey` — the search walks backward to the next cycle that has ≥1 usable mark. (`currentPerformance` is "most recent cycle we can actually measure," not "most recent cycle that occurred.")

**Traceability:** `evidenceRefs = [assessmentSubjectId, ...]` for every row contributing to `overallPercent`.

### 2.2 Growth Between Examinations

**Formula (pairwise, for any two eligible cycles A, B with A chronologically before B):**
```
growth(A, B, subjectKey = null):
  percentA = subjectKey ? subjectCyclePercent(A, subjectKey) : overallCyclePercent(A)
  percentB = subjectKey ? subjectCyclePercent(B, subjectKey) : overallCyclePercent(B)
  if percentA === null or percentB === null: return { deltaPercentPoints: null, reason: 'insufficient_data', missingSide: percentA === null ? 'from' : 'to' }
  return { deltaPercentPoints: round1(percentB - percentA), reason: null }
```
`subjectCyclePercent`/`overallCyclePercent` both apply §0.6's duplicate-row summing.

**Growth series** (what a trend line plots): the ordered list of consecutive eligible-cycle pairs `(cycle[i], cycle[i+1])` for every `i`, each computed via `growth()` above — overall and per-subject.

**Minimum evidence:** both cycles must have a usable percent (overall, or for that subjectKey) — not merely exist. A Published cycle with zero usable marks for a subject contributes `null`/`insufficient_data` for that subject's growth, even though the cycle itself is otherwise eligible.

**Delta is always percentage points (B − A), never a relative/ratio change** — e.g. 55% → 70% is reported as `+15.0`, never "+27%."

**Edge cases:**
- Only one eligible cycle exists total → growth series is empty (`[]`), not an error.
- Cycle pair spans two different `academicYear`s → still computed; the result is returned, but each entry's own `academicYear` fields let a caller choose to filter cross-year comparisons out — this spec does not forbid it.
- A subject exists in cycle A but was dropped from the classroom's Learning Activities before cycle B (so `subjectKey` can't be resolved in B at all) → `percentB = null`, `reason: 'insufficient_data'`, `missingSide: 'to'` — never silently excluded from the output list; the caller sees exactly why.

**Traceability:** `evidenceRefs = [assessmentSubjectId from A, assessmentSubjectId from B]` (both sides, when present).

### 2.3 Ongoing Trend

**Available-cycle sequence:** the ordered list of eligible cycles for which the student has a usable percent (overall, or per-subject) — cycles with no usable mark for that scope are **skipped entirely** from the sequence (not inserted as a gap/zero).

**Formula:**
```
deltas = last up to 3 consecutive deltas from the available-cycle sequence's own growth() results (overall, or per subjectKey)
classify(delta):
  if delta === null: unreachable here (available-cycle sequence already filters nulls out)
  if delta > +2.0: 'up'
  if delta < -2.0: 'down'
  else: 'flat'                      # dead zone, absorbs noise

if len(available sequence) < 2: return 'insufficient_data'
classified = deltas.map(classify)
upCount = count('up'); downCount = count('down')
if upCount > downCount: 'improving'
elif downCount > upCount: 'declining'
else: 'stable'                      # includes all-flat and exact up/down ties
```

The ±2.0 percentage-point dead zone and the "last up to 3 deltas" window are both named, tunable constants (`TREND_FLAT_DEADZONE_PP = 2.0`, `TREND_WINDOW_DELTAS = 3`) — proposed defaults, not hardcoded inline, flagged for product sign-off same as `CONSISTENCY_SPREAD_THRESHOLD_PERCENT_POINTS` below.

**Minimum evidence:** ≥2 available cycles (i.e. ≥1 delta). Exactly 1 delta → trend equals that single delta's own classification directly (no majority vote needed/possible).

**Computed overall, and independently per subjectKey** — a subject can be `'declining'` while the overall trend is `'improving'` (or vice versa); neither is derived from the other.

**Edge cases:**
- Exactly 2 up, 2 down (4 cycles, even split) → `'stable'` by the tie rule above, not a coin flip.
- A single large jump (e.g. +40pp) followed by small negative noise (−1pp, −1pp) → `upCount=1, downCount=0`(the two −1pp's classify as `'flat'`, not `'down'`, since |−1| < 2.0 dead zone) → `'improving'`. This is intentional: the dead zone exists exactly to stop small noise from outweighing one real jump.

**Traceability:** `evidenceRefs` = every `assessmentSubjectId` feeding the deltas actually used in the classification window.

### 2.4 Consistency

**Formula:**
```
values = available-cycle sequence's own percents (§2.3's sequence, overall or per-subject)
if len(values) < 2: return { spreadPercentPoints: null, label: 'insufficient_data' }
spreadPercentPoints = round1(max(values) - min(values))
label = spreadPercentPoints <= CONSISTENCY_SPREAD_THRESHOLD_PERCENT_POINTS ? 'stable' : 'variable'   # threshold = 15.0, proposed default
```
Optional secondary stat (not required, included only if ≥3 values present): population standard deviation, `round1(sqrt(mean((v - mean(values))^2)))`, for a future richer display once a student has accumulated more than a handful of cycles.

**Minimum evidence:** ≥2 available cycles (same sequence as trend — reused, not recomputed independently, so trend and consistency can never silently disagree about which cycles "count").

**Edge cases:**
- Identical percent in every available cycle (e.g. always exactly 72%) → `spreadPercentPoints = 0.0`, `label: 'stable'` — a real, valid result, not a "no data" case.
- Exactly `spreadPercentPoints === 15.0` → `'stable'` (inclusive boundary, `<=`).

**Traceability:** `evidenceRefs` = every `assessmentSubjectId` behind the min/max values specifically (not the whole sequence) plus the full sequence's own cycle keys for context.

### 2.5 Subject Strengths / Developing / Areas Needing Improvement / Not Yet Assessed

**Formula:** derived directly from §2.1's `currentPerformance.bySubject` — no separate historical averaging (this is explicitly "how is this subject doing right now," not an across-year blend):
```
for each entry in bySubject:
  band = bandOf(entry.percent, entry.passMarkPercent)   # §0.5
  'green'        → strengths
  'yellow'       → developing
  'red'          → areasNeedingImprovement
  'not_assessed' → notYetAssessed       # explicitly its OWN bucket — absence of evidence, never folded into "needs improvement"
```

**Minimum evidence:** requires `currentPerformance` itself to be non-null (§2.1). If the student has zero usable marks ever, all four buckets are `[]` with `reason: 'no_published_results'` at the parent level, not silently empty with no explanation.

**No "top N" ranking, no ties to break** — every subject lands in exactly one of the four absolute bands, deterministically, with no arbitrary cutoff count. (This replaces the earlier "top 2 / bottom 2" idea from the prior proposal — absolute banding was the explicit recommendation there and is the one being formally specified here.)

**Edge cases:**
- All subjects `'green'` → `areasNeedingImprovement = []` (a genuinely empty, correct result — not an error, not "insufficient data").
- A subject exactly at its own `passMarkPercent` → `'yellow'`, never `'red'` (§0.5 inclusive boundary).
- A subject exactly at 70% → `'green'`, never `'yellow'`.

**Traceability:** each bucket entry carries its own `assessmentSubjectId` (singular, or the summed list if §0.6 duplicates applied).

### 2.6 Attention Flags

Each flag is **independent**, boolean, named, with its own minimum-evidence rule and its own `evidenceRefs` — never collapsed into a single composite score.

| Flag | Scope | Condition | Minimum evidence | If insufficient evidence |
|---|---|---|---|---|
| `failed_subject_latest_cycle` | per subject | `bySubject` entry has `outcome === 'failed'` in `asOfCycleKey` | `currentPerformance` non-null | flag simply doesn't fire (not an "unknown" state — absence of a usable mark is its own flag, below) |
| `not_assessed_latest_cycle` | per subject | `bySubject` entry has `band === 'not_assessed'` in `asOfCycleKey` | `currentPerformance` non-null | doesn't fire if `currentPerformance` itself is null (nothing to compare against) |
| `declining_trend_overall` | classroom-wide | `trend.overall === 'declining'` | ≥2 available cycles (§2.3) | doesn't fire; trend itself separately reports `insufficient_data` |
| `declining_trend_subject` | per subject | `trend.bySubject[subjectKey] === 'declining'` | ≥2 available cycles for that subject | doesn't fire for that subject |
| `high_incomplete_checkpoint_rate` | per notebook (subject × notebookType) | among checkpoints with `dueDate` already past: `(incompleteCount + notSubmittedCount) / pastDueCount >= 0.30` OR `notSubmittedCount / pastDueCount >= 0.40` | ≥3 past-due checkpoints in that notebook | doesn't fire; reported separately as `insufficient_data` if <3 |
| `repeated_help_requests` | classroom-wide | ≥2 concepts currently have `helpRequested === true` (live state, not historical) | none required — zero concepts with the flag set is itself a valid, directly-observed "false," not missing data | always computable; never `insufficient_data` |

**Rationale for treating `repeated_help_requests` differently:** it reads a *current* boolean state that is always fully known (every concept record either has `helpRequested: true` or doesn't) — there is no "not enough data" case possible, unlike trend/consistency which require a minimum history length. This distinction (state vs. history-dependent) is called out explicitly so implementers don't accidentally apply an `insufficient_data` branch where none is possible.

**Thresholds** (`0.30`, `0.40`, `≥3 past-due`, `≥2 concepts`) are named, proposed defaults requiring product sign-off — not to be inlined as magic numbers in the implementation.

**Output shape per flag instance:**
```
{ flag: '<name above>', subjectId: string | null, evidenceRefs: [...], detail: { ...flag-specific numbers, e.g. incompleteRate } }
```

**Edge cases:**
- A student with zero Published exam evidence at all → only `repeated_help_requests` and `high_incomplete_checkpoint_rate` can possibly fire; every exam-based flag is simply absent from the list (an empty `attentionFlags` array for an exam-based flag is the correct "healthy" result, not a defect).
- A subject simultaneously `failed_subject_latest_cycle` AND `declining_trend_subject` → both fire independently; no suppression/precedence rule between flags.

---

## 3. Class-level rollups — `ClassAcademicProgressInsights`

Computed once per `(classroom, cycleKey)` — always classroom + one specific cycle, never "all cycles blended."

### 3.1 Subject averages
```
for each subjectKey present in cycleKey:
  usablePercents = [ student's subjectCyclePercent(cycleKey, subjectKey) for every roster student, excluding null ]
  averagePercent = usablePercents.length > 0 ? round1(mean(usablePercents)) : null
  assessedCount = usablePercents.length
  totalCount = roster size
```
**Why plain mean here is correct** (and is a different rule from §2.1's sum-based per-student Overall%): this is averaging the *same* subject's percent across *different students* — an apples-to-apples axis, unlike averaging *different subjects'* percentages *within* one student, which `scorecardService.js` correctly avoids because it would equal-weight a /50 subject against a /100 one. No such distortion exists here since every value being averaged is already that one subject's own percent.

**Minimum evidence:** `assessedCount === 0` → `averagePercent: null`, not 0 — an ungraded subject must never read as a 0% class average.

### 3.2 Distribution
```
for each subjectKey (and one 'overall' pseudo-row): count of roster students in {green, yellow, red, not_assessed} via bandOf()
```
Every roster student is counted in exactly one bucket, including `not_assessed` — counts must sum to `totalCount` exactly (a correctness invariant worth asserting in tests).

### 3.3 Students needing attention
```
for each roster student: attentionFlags(student) (§2.6, evaluated AS OF the classroom's current state, not frozen to cycleKey for the non-exam flags)
studentsNeedingAttention = [ {studentId, studentName, flags} for students where flags.length > 0 ]
```
**Edge case:** `cycleKey`-scoped flags (`failed_subject_latest_cycle`, `not_assessed_latest_cycle`) are evaluated against **that specific cycle**, even if a later cycle already exists and is this student's own "current" — because the class rollup is explicitly about one named cycle, e.g. "who needs attention after the Quarterly." Non-cycle-scoped flags (`repeated_help_requests`, `high_incomplete_checkpoint_rate`) are always evaluated against live/current state regardless of which cycle was requested — documented so the two don't appear inconsistently dated to someone reading the output.

### 3.4 Class growth / class trend (optional roll-up)
```
classGrowth(cycleA, cycleB) = mean of per-student growth() deltas, including only students with a usable value on BOTH sides
```
**Minimum evidence:** ≥1 student with usable data on both cycles; else `null`, `reason: 'insufficient_data'`.

---

## 4. Full test matrix

Scenario → Expected result, grouped by metric. "Row(s)" describes the minimal `ExamEvidenceRow`/other-evidence setup needed to realize the scenario.

### 4.1 Evidence layer

| # | Scenario | Expected |
|---|---|---|
| E1 | Assessment.status = 'Draft', has a real StudentResult | Row excluded entirely from evidence |
| E2 | Assessment.status = 'Locked' | Row included, same as 'Published' |
| E3 | No StudentResult row for student in an eligible AssessmentSubject | `entered: false`, `percent: null`, `outcome: 'not_assessed'` |
| E4 | StudentResult `{absent: true, marks: null}` | `absent: true`, `percent: null`, `outcome: 'not_assessed'` |
| E5 | StudentResult `{absent: false, marks: 0}` | `percent: 0`, `outcome` computed normally against pass mark (likely `'failed'`) — **not** excluded |
| E6 | `AssessmentSubject.maximumMarks` missing/0 (malformed legacy doc) | `percent: null` (never divide by zero) |
| E7 | Two Assessments, same resolved `cycleKey`, same `subjectKey`, both with a usable mark for this student | Both rows present; downstream sum-based metrics combine them; `duplicateSubjectInCycle: true` on both |

### 4.2 Cycle resolution (§0.1)

| # | Scenario | Expected |
|---|---|---|
| C1 | Two Assessments share `examinationCycleId` (once that field exists) | Same `cycleKey`, regardless of title differing |
| C2 | Two Assessments, no `examinationCycleId`, identical `title` + `academicYear` | Same `cycleKey` (fallback path) |
| C3 | Two Assessments, identical `title`, different `academicYear` | **Different** `cycleKey`s — must not merge |
| C4 | A cycle whose every Assessment is 'Draft' | Cycle entirely absent from `listExaminationCycles()`/any rollup |
| C5 | A cycle with one 'Draft' and one 'Published' Assessment | Cycle is eligible; only the Published Assessment's rows contribute evidence |
| C6 | Title with inconsistent whitespace/case ("quarterly examinations " vs "Quarterly Examinations") under the fallback path | Same `cycleKey` (normalizeTitle collapses both) |

### 4.3 Current Performance

| # | Scenario | Expected |
|---|---|---|
| P1 | Student has zero Published results, ever | `currentPerformance: null`, `reason: 'no_published_results'` |
| P2 | Latest eligible cycle has usable marks in 2 of 3 subjects | `bySubject` has all 3 entries; the ungraded one is `band: 'not_assessed'`; `overallPercent` sums only the 2 graded ones |
| P3 | Most recent cycle by date has zero usable marks anywhere (exam occurred, nothing graded yet); an earlier cycle has usable marks | `asOfCycleKey` = the earlier, actually-measurable cycle, not the chronologically latest one |
| P4 | Two eligible cycles share the exact same representative date | Deterministic tie-break (later `cycleKey` string wins) — same result on repeated calls |
| P5 | Subject percent exactly equals its own `passMarkPercent` | `band: 'yellow'`, `outcome: 'passed'` |

### 4.4 Growth

| # | Scenario | Expected |
|---|---|---|
| G1 | Exactly one eligible cycle exists | Growth series = `[]` |
| G2 | Two cycles, both usable, overall 55% → 70% | `deltaPercentPoints: 15.0` (not a ratio) |
| G3 | Cycle A usable, Cycle B has `percent: null` for that subject | `deltaPercentPoints: null`, `reason: 'insufficient_data'`, `missingSide: 'to'` |
| G4 | Subject present in A, removed from classroom's Learning Activities before B | Same as G3 — reported, not silently dropped |
| G5 | Explicit `getGrowthBetweenCycles(A, C)` requested where B lies chronologically between them | Computed directly, ignoring B entirely (API supports non-adjacent comparisons, not only the consecutive series) |

### 4.5 Trend

| # | Scenario | Expected |
|---|---|---|
| T1 | 0 or 1 available cycles | `'insufficient_data'` |
| T2 | 2 cycles, delta = +10pp | `'improving'` (single-delta direct classification) |
| T3 | 2 cycles, delta = +1pp | `'stable'` (inside ±2pp dead zone) |
| T4 | 4 cycles → deltas `[+1, -5, +1]` | classified `['flat','down','flat']` → `downCount=1, upCount=0` → `'declining'` |
| T5 | 4 cycles → deltas `[+10, -1, -1]` | classified `['up','flat','flat']` → `upCount=1, downCount=0` → `'improving'` |
| T6 | deltas `[+5, -5]` (one up, one down) | tie → `'stable'` |
| T7 | Subject-level trend differs from overall trend in the same student | Both computed and reported independently; no cross-influence |

### 4.6 Consistency

| # | Scenario | Expected |
|---|---|---|
| S1 | 1 available cycle | `spreadPercentPoints: null`, `label: 'insufficient_data'` |
| S2 | Values `[72, 72, 72]` | `spreadPercentPoints: 0.0`, `label: 'stable'` |
| S3 | Values `[50, 65]` → spread = 15.0 exactly | `label: 'stable'` (inclusive boundary) |
| S4 | Values `[50, 66]` → spread = 16.0 | `label: 'variable'` |

### 4.7 Strengths / Developing / Needs Improvement / Not Yet Assessed

| # | Scenario | Expected |
|---|---|---|
| B1 | Subject percent = 70.0 exactly | `'green'` → strengths |
| B2 | Subject percent = passMarkPercent exactly (e.g. 36.0) | `'yellow'` → developing, not needs-improvement |
| B3 | Subject percent = passMarkPercent − 0.1 | `'red'` → areasNeedingImprovement |
| B4 | Subject with `band: 'not_assessed'` | → notYetAssessed bucket, **never** areasNeedingImprovement |
| B5 | All subjects green | `areasNeedingImprovement: []`, not an error |

### 4.8 Attention flags

| # | Scenario | Expected |
|---|---|---|
| A1 | Healthy student: all subjects green, stable trend, no help requests, no overdue checkpoints | `attentionFlags: []` |
| A2 | One subject `'failed'` in latest cycle only | Only `failed_subject_latest_cycle` fires, scoped to that subjectId |
| A3 | A subject never graded at all this cycle | `not_assessed_latest_cycle` fires — distinct from A2, never conflated |
| A4 | `repeated_help_requests`: exactly 1 concept flagged | Does **not** fire (threshold is ≥2) |
| A5 | `repeated_help_requests`: exactly 2 concepts flagged | Fires |
| A6 | Checkpoint notebook with only 2 past-due checkpoints, both incomplete | Does **not** fire `high_incomplete_checkpoint_rate` — below the ≥3 minimum-evidence floor, regardless of rate |
| A7 | 3 past-due checkpoints, exactly 1 incomplete (rate = 0.333) | Fires (≥0.30 inclusive) |
| A8 | 3 past-due checkpoints, 0 incomplete, 2 not_submitted (rate 0.667) | Fires via the `notSubmitted` sub-condition independently |
| A9 | Student with zero Published exam evidence at all | Only behavior-based flags (`repeated_help_requests`, `high_incomplete_checkpoint_rate`) can possibly appear; no exam-based flag present, and this is correct, not a bug |

### 4.9 Class rollups

| # | Scenario | Expected |
|---|---|---|
| R1 | Subject with 0 of 30 roster students assessed in this cycle | `averagePercent: null`, `assessedCount: 0`, `totalCount: 30` — never `0%` |
| R2 | Distribution counts for one subject | `green + yellow + red + not_assessed === totalCount`, always (invariant to assert in every test) |
| R3 | `studentsNeedingAttention` for a cycle where a student's *current* cycle (chronologically later than the requested one) differs from the requested cycle | Cycle-scoped flags use the **requested** cycle only; non-cycle-scoped flags use live state — both correctly dated per §3.3 |
| R4 | `classGrowth(A, B)` where only 2 of 30 students have usable data on both sides | Computed from exactly those 2; not `insufficient_data` (≥1 is the floor) |
| R5 | `classGrowth(A, B)` where 0 students have usable data on both sides | `null`, `reason: 'insufficient_data'` |

---

## 5. Deterministic metrics vs. future interpretive/narrative layer — explicit line

**Everything above (Parts 1–4) is deterministic and fully specified here**: every number, band, flag, and edge case has one correct answer given the input data, verifiable by hand against the source records, with named/tunable constants called out rather than hidden as magic numbers (`PASS_MARK_PERCENT`, `GREEN_THRESHOLD_PERCENT`, `TREND_FLAT_DEADZONE_PP`, `TREND_WINDOW_DELTAS`, `CONSISTENCY_SPREAD_THRESHOLD_PERCENT_POINTS`, the two checkpoint-rate thresholds, the `repeated_help_requests` count floor).

**Explicitly NOT part of this spec, and not to be built until this foundation ships and is validated:**
- Any natural-language sentence describing a student ("Alex is struggling in Science") — a narrative layer, if built later, must be generated *from* the structured fields above (`attentionFlags`, `bandOf()` results, `trend`), never compute its own parallel judgment.
- Any single composite "risk score" blending multiple flags into one number — deliberately not specified; the flags above are designed to stay independent and explainable precisely so that if a composite is ever wanted, it is built visibly on top of this layer, not instead of it.
- Any weighting of concept self-report / checkpoint completion into the numeric `percent`/`trend`/`consistency` figures — those remain exam-only per §0/§2; concept and checkpoint evidence feed only their own named flags (§2.6) and the separate, non-numeric `conceptFormativeSummary` from the prior proposal.
- Cross-classroom or cross-year trend — every metric here is scoped to one classroom; the fallback cycle key is explicitly year-scoped (§0.1) to prevent this from happening by accident.

---

## 6. Proposed service API — `js/services/academicProgressService.js`

Read-only throughout — no Firestore writes, no mutation of the `classroom`/`student` objects passed in, matching the existing convention of `scorecardService.js` and `studentProgressService.js`. Not implemented by this document.

```js
// --- Cycle resolution (§0.1) ---
export function resolveCycleKey(classroom, assessment) { ... }
export function listExaminationCycles(classroom) { ... }
// -> [{ cycleKey, title, academicYear, representativeDate, assessmentIds[] }], eligible cycles only, chronological

// --- Evidence layer (§1) ---
export function getStudentExamEvidence(classroom, studentId) { ... }        // -> ExamEvidenceRow[]
export function getStudentConceptEvidence(classroom, studentId) { ... }
export function getStudentActivityEvidence(classroom, studentId) { ... }
export function getStudentCheckpointEvidence(classroom, studentId) { ... }
export function getStudentAcademicEvidence(classroom, studentId) { ... }    // bundles all four -> StudentAcademicEvidence

// --- Per-student derived metrics (§2) ---
export function getCurrentPerformance(classroom, studentId) { ... }         // §2.1
export function getGrowthSeries(classroom, studentId) { ... }               // §2.2, consecutive-cycle pairs, overall + bySubject
export function getGrowthBetweenCycles(classroom, studentId, fromCycleKey, toCycleKey) { ... }  // §2.2, arbitrary pair
export function getTrend(classroom, studentId) { ... }                      // §2.3
export function getConsistency(classroom, studentId) { ... }                // §2.4
export function getSubjectBands(classroom, studentId) { ... }               // §2.5 -> { strengths[], developing[], areasNeedingImprovement[], notYetAssessed[] }
export function getAttentionFlags(classroom, studentId) { ... }             // §2.6 -> flag[]
export function getStudentAcademicProgress(classroom, studentId) { ... }    // single entry point bundling everything above into one StudentAcademicProgress

// --- Class-level rollups (§3) ---
export function getClassSubjectAverages(classroom, cycleKey) { ... }        // §3.1
export function getClassDistribution(classroom, cycleKey) { ... }           // §3.2
export function getStudentsNeedingAttention(classroom, cycleKey) { ... }    // §3.3
export function getClassGrowth(classroom, fromCycleKey, toCycleKey) { ... } // §3.4
export function getClassAcademicProgressInsights(classroom, cycleKey) { ... } // bundles 3.1–3.3 into one ClassAcademicProgressInsights
```

**Internal (not exported) helpers implied by the spec above**, so a later implementation doesn't have to rediscover them: `resolveSubjectKey`, `normalizeTitle`, `toPercent`/`round1`, `bandOf`, `subjectCyclePercent`, `overallCyclePercent`, `classify` (trend delta classifier), `getAvailableCycleSequence` (shared by trend + consistency so they can never disagree about which cycles count, per §2.4).

**Naming boundary with `studentProgressService.js`:** this file must never import from, or be imported by, `studentProgressService.js` for any academic computation — the only legitimate overlap is both files independently reading `classroom.teams[].students[]` for roster iteration, the same way `assessmentService.getClassroomStudents()` already does, not a shared dependency between the two progress domains.
