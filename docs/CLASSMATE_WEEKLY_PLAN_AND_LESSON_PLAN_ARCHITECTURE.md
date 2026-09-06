# ClassMate — Weekly Plan / Detailed Lesson Plan Architecture

**Status:** Agreed and implemented. This document records the architecture decided jointly with the product owner, the terminology collision it resolves, and how existing data is preserved. Update this file if the model changes again — it is the reference for why things are split the way they are.

---

## 1. The problem this solves

ClassMate had (and still has) two genuinely different planning artifacts a teacher produces:

1. **Weekly Plan** — a lightweight per-period plan created for ordinary, non-observed teaching. Should never require a full detailed instructional design.
2. **Detailed Lesson Plan** — the full "5 Questions" structured document, required only when a period is being observed by a Program Manager, with its own review/approval workflow.

Before this change, the Detailed Lesson Plan's own submission readiness required Concept + Objectives + Big Question + Spark + Activities + Helping (Pair Explanation/Final Question/Teacher Look-Fors) for **every** plan, with no lighter-weight tier — meaning a teacher had to build the full detailed document even for a routine period, and there was no way to start a Detailed Lesson Plan from information already captured elsewhere.

## 2. What already existed (and the terminology collision)

Two unrelated domain models already existed for "a period":

- **`models/Lesson.js`** — a lightweight record attached to one `teachingSlotId` (a deterministic id derived from `classroomId` + date + period number): `curriculumUnitId`, `conceptIds`, `executedConceptIds`, `status` ('planned'/'taught'/'skipped'/'rescheduled'), `teacherReflection`. Surfaced in `ui/views/TimetableView.js`'s Week grid + Period Detail panel — the actively-used, real "weekly planning" surface.
- **`models/LessonPlan.js`** — the "5 Questions" structured document (Objectives, Big Question, Connection, Showcase, Spark, Activities, Pair Explanation, Final Question, Teacher Look-Fors) with a DRAFT → SUBMITTED → CHANGES_REQUESTED → APPROVED review lifecycle. Reached via its own separate `ui/views/LessonPlansListView.js`.

These two had **zero cross-reference** — a `LessonPlan` was always created blank and free-standing, even if a `Lesson` already existed for the same period with concepts already planned.

"Lesson Plan" was also, confusingly, used for a **third**, unrelated thing: `ui/views/TimetableView.js`'s own Period Detail "Lesson Plan" tab, which is actually a resource-link-sharing tab (attach a URL/PDF reference), reusing the Student Resources tab's UI with a different `audience`. That tab's name is unchanged by this work — flagged here so it isn't confused with either of the two real models above.

## 3. The agreed model

```
Lesson (Weekly Plan)                         LessonPlan (Detailed Lesson Plan)
──────────────────────                       ──────────────────────────────────
teachingSlotId                               scheduledDate + scheduledPeriodNumber
curriculumUnitId, conceptIds                 curriculumUnitId, conceptIds      (seeded copy)
objectives[], bigQuestion        ── seeds ──▶ objectives[], bigQuestion         (seeded copy)
lessonPlanId ─────────────────────(links to)─▶ id
                                              selfOthersIndia (optional)
                                              assessments[] (optional)
                                              spark (optional)
                                              activities[] (REQUIRED)
                                              pairExplanation/finalQuestion/
                                                teacherLookFors (REQUIRED)
                                              status: DRAFT → SUBMITTED →
                                                CHANGES_REQUESTED → APPROVED
```

- `Lesson` gained `objectives[]` (same `{id, text}` shape as `LessonPlan`'s own `createLessonPlanObjective()` — reused directly, not duplicated) and `bigQuestion`, plus a nullable `lessonPlanId`.
- `LessonPlan` is **created lazily**, only when a teacher taps "Build Detailed Lesson Plan" on that period's Plan tab — never merely because a period/Lesson exists. Most periods never get one.
- `services/timetableLessonService.js`'s `buildDetailedLessonPlanFromLesson()` is the one bridge: it creates the `LessonPlan`, seeds it from the Lesson's own `curriculumUnitId`/`conceptIds`/`objectives`/`bigQuestion` plus the resolved subject/date/period, sets `lesson.lessonPlanId`, and returns the new plan for the caller to open.
- The Lesson↔LessonPlan link is one field (`lessonPlanId`), not a live query — the Period Detail panel can tell "no detailed plan yet" from "one exists" with a single field check.

## 4. Two independent readiness computations, not one cumulative checklist

This is the core structural point: **Weekly Plan readiness and Detailed Lesson Plan readiness are two separate, independently-computed functions over two separate documents** — never one growing list of requirements.

- **`services/weeklyPlanValidationService.js`'s `getWeeklyPlanReadiness(lesson)`** — gates the Lesson: Concepts present, ≥1 non-blank Objective, non-blank Big Question. This is the "Weekly Plan complete" state; most periods stop here.
- **`services/lessonPlanValidationService.js`'s `getLessonPlanReadiness(lessonPlan)`** — narrowed. No longer checks Concept or Objectives/Big Question at all (that's the Weekly Plan tier's job — by the time a `LessonPlan` exists, it was seeded from an already-weekly-complete Lesson). Only requires:
  - **Activities** (≥1, each with title/teacher action/student action) — required.
  - **Helping** (Pair Explanation + Final Question + Teacher Look-Fors) — required.
  - **Connection** (Self/Others/India) — optional (unchanged from the earlier arc).
  - **Showcase** (Assessment/Evidence) — optional (unchanged from the earlier arc).
  - **Spark** — optional (new in this change — an enrichment layer on top of Activities, not a structural requirement).

Concepts/Objectives/Big Question still exist as real, editable content inside the Detailed Lesson Plan Builder (the Concepts and Purpose stages are unchanged) — they simply no longer block *that document's own* submission gate, because the Weekly Plan tier already required them before the document could exist.

## 5. UI surface

- **`ui/views/TimetableView.js`** Period Detail panel gained a new **"Plan"** tab (additive — the pre-existing Overview/Concepts/Student Resources/Lesson Plan/Reflection tabs are unchanged): Objectives (add/edit/remove), Big Question, a "Weekly Plan complete/incomplete" status line, and either:
  - **"Build Detailed Lesson Plan"** (disabled until the Weekly Plan is complete, with a hint explaining why) — creates and opens a new `LessonPlan`, seeded from the Lesson; or
  - **"Open Detailed Lesson Plan"** — once `lesson.lessonPlanId` is set, jumps straight to `ui/views/LessonPlanBuilderView.js` for that plan (`router.navigate('/classroom/{id}/lesson-plans/{lessonPlanId}')`).
- **`ui/views/LessonPlanBuilderView.js`** — Spark's own heading now carries a quiet "Optional" tag (reusing the tag already introduced for Connection/Showcase), matching its new optional status.
- The existing free-standing "+ New Lesson Plan" flow in `ui/views/LessonPlansListView.js` is untouched — a teacher can still create a completely free-floating `LessonPlan` not tied to any period. Its readiness is governed by the same narrowed `getLessonPlanReadiness()`, uniformly.

## 6. Migration

No bulk migration was needed or run:

- Every **existing** `Lesson` document simply gains `objectives: []`, `bigQuestion: ''`, `lessonPlanId: null` the next time it's read and re-saved (Firestore documents are schemaless; these fields are absent-then-defaulted on read, exactly like every other optional field this model already has — the same lazy, on-demand convention this codebase already uses elsewhere, e.g. Resources' move to a subcollection).
- Every **existing** `LessonPlan` document is unaffected in shape — no fields removed, only which ones gate submission. A previously-DRAFT plan that happened to have blank Concepts/Objectives (rare, since the old rules required them) simply becomes valid for submission the moment Activities/Helping are complete.
- No existing `Lesson` is retroactively linked to any existing `LessonPlan` — `lessonPlanId` starts `null` on every pre-existing Lesson, even if a matching `LessonPlan` already exists for that same `teachingSlotId` (computable via `buildTeachingSlotId(classroomId, lessonPlan.scheduledDate, lessonPlan.scheduledPeriodNumber)`, but nothing back-fills this automatically). If a teacher had already built a detailed plan for a period under the old flow, the new Plan tab won't know about it and would offer "Build Detailed Lesson Plan" again — a real, accepted gap, not silently wrong (the old free-standing plan still exists and opens correctly from the Lesson Plans list; this only affects the *new* one-click bridge for plans that predate this change).

## 7. Deliberately not built yet

- **Observation-announcement workflow.** "Build Detailed Lesson Plan" is entirely teacher-initiated. `models/Observation.js` remains an unimplemented stub (unrelated to classroom periods — it's a student behavioural-note shape). `PROGRAM_MANAGER`/`HEAD_MASTER` remain zero-permission placeholder roles. Nothing in this change adds a way for a manager to flag a period for observation or notify a teacher — that's real future work, not approximated here.
- **Retroactive Lesson↔LessonPlan linking** for plans created before this change (see §6).
- **Renaming** the pre-existing, confusingly-named "Lesson Plan" resource-sharing tab in `TimetableView.js` — flagged as a known collision, left alone as out of scope for this change.
