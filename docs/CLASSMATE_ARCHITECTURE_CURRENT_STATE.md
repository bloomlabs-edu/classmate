# ClassMate — Current-State Architecture

**Status:** Inspection only. This document describes what exists in the `classroom-tracker` codebase today, as found by direct code inspection — it does not propose changes, and it does not assume any future Learning Hub integration decision has already been made. Where the current implementation is imperfect, incomplete, or inconsistent, that is documented as-is rather than smoothed over.

**Purpose:** Input to a joint ClassMate/Learning Hub architecture review. Every entity below is described with: current owner, current storage/model, who reads it, who writes it, whether it looks suitable for cross-product sharing/reference, and the concrete IDs involved.

---

## 1. What ClassMate Currently Is

ClassMate (this repo, `classroom-tracker`) is a **vanilla-JS ES-module web app with no build step** — `index.html` loads modules directly in the browser — backed by **Firebase** (Auth + Firestore, project `classmate-302c2`). There is no server-side application code beyond Firestore security rules and a GitHub Actions deploy-on-merge workflow to Firebase Hosting.

The app has one shared entry point (`js/main.js`) and a hand-rolled hash router (`js/ui/router.js`, `#/...` URLs). It presents two experiences from one codebase:

- **Teacher Mode** — gated by real Firebase Auth (Google Sign-In).
- **Student Mode** ("Student Portal") — gated by a lighter, non-account "trusted device" mechanism, not Firebase Auth in the way teachers use it.

A **Classroom** is the central unit: one shared Firestore document per classroom (`classrooms/{id}`), read/written in real time by every teacher-member's device, with a handful of dedicated Firestore subcollections carved out for unbounded-growth or student-owned-writable data (Lessons, Resources, Activities, Feed posts/comments, Student Goals, Learning Programme sessions, Scoreboard archives).

Product areas live as routed views under `#/classroom/{id}/...`: Dashboard, Timetable, Classroom Management, Learning Management (curriculum authoring), Concept Workspace, Resources, Assessments, Goals, Class Feed, Recognition/Standings, Notebook Tracker, Learning Programmes, Seating, Settings — plus a parallel Student Portal (`#/student/...`) covering Journey (home), Team, Recognition, Profile, Goals, Feed, Notebooks, and Learning/Learning Circle.

**A note on scale of change:** this codebase has migrated ownership boundaries before without a big-bang rewrite — e.g. Resources moved from embedded-in-Concept arrays to their own subcollection; Goal *submissions* moved from an embedded array to their own subcollection while Goal *cycle/category* metadata stayed embedded. Migrations here are consistently lazy/explicit (migrate-on-first-read) rather than versioned schema migrations. This is relevant prior art for how a future Concept↔Learning Hub link might also be staged.

---

## 2. Current Teacher Mode

**Entry:** `#/teacher` → `PersonalHubView.js` (My Classrooms, Profile, Today) or directly into `#/classroom/{id}/dashboard` → `DashboardView.js`.

**Gate:** Real Firebase Auth, Google Sign-In only (`js/services/authService.js`), `browserLocalPersistence`. Notably, **email is deliberately never read/stored/logged** — `toSafeProfile()` strips every signed-in user down to `{ uid, displayName, photoURL }` only, an explicit data-minimization decision already documented in the code as something that would need AI Working Committee escalation to change.

**Role model:** `js/config/memberRoles.js` defines `MEMBER_ROLES = { OWNER, TEACHER, VIEWER, STUDENT, PARENT, PROGRAM_MANAGER, HEAD_MASTER }`, but **only OWNER/TEACHER/VIEWER are ever actually assigned to a real uid today**. `STUDENT`, `PARENT`, `PROGRAM_MANAGER`, `HEAD_MASTER` are zero-permission placeholders — see §12. Membership (`js/services/memberService.js`) operates on `classroom.members`/`classroom.memberUids` — this is real, Google-authenticated **co-teacher** membership; students are never entered into this system.

**Dashboard composition** (`DashboardView.js`): classroom identity header; Open Work widget; Today's Schedule widget (teacher-only, links to full Timetable); primary module cards (Classroom, Learning Management, Assessment Management, Goal Management, Learning Programmes, Notebook Tracker, Class Feed) each with an attention-indicator chip computed from real pending-work counts; Recognition Wall + Weekly Snapshot; Pending Tasks; Teaching/Classroom section groupings. A classroom with zero students shows a pre-roster welcome/setup screen instead.

**Major teacher views** (non-exhaustive, from `js/ui/views/`): `DashboardView`, `TimetableView`, `ClassroomLandingView`, `ClassroomManagementView`, `TrackerView` (live "Class Mode"), `LearningManagementView`, `LearningRecordView`, `ConceptWorkspaceView`, `CurriculumManagementView`, `AssessmentManagementView`, `GoalManagementView`, `GoalDashboardView`, `FeedModerationView`, `NotebookTrackerView` (+ `NotebookCheckpointsView`, `NotebookDailyCheckView`, `NotebookRegisterView`, `NotebookTimelineView`), `LearningProgrammesListView` (+ `LearningProgrammeOverviewView`, `ProgrammeSessionView`, `ProgrammeAttendanceView`, `ProgrammeGoalsReviewView`, `ProgrammeObservationsView`), `SeatingView`, `SettingsView`, `RecognitionScreenView`, `ScoreboardArchiveView`, `StudentProfileView`, `StudentAccessView`, `SetupWizardView`, `ActivitiesView`.

**Orphaned/unwired:** `AdminDashboardView.js` and `ConceptWorkspaceView.js` both exist as real, functioning files but are **not currently reachable from any actual route/navigation in the app** — see §16.

---

## 3. Current Student Mode

**Entry:** `#/student/{section}` → default section is `StudentJourneyView.js`. Reached via `StudentDeviceFlow.js` (the actual onboarding controller called from `main.js`).

**No real account.** There is no Firebase Auth sign-in tied to a person the way teachers have one. The live flow is:

1. Type the classroom's `classroomStudentJoinCode` (read-only roster access, "no PIN, sign-in, or account of any kind behind it").
2. Pick your real name off the roster (`StudentRosterPickerView.js`).
3. The device now "trusts" that `{classroomId, studentId, studentName}` profile in `localStorage` (`studentDeviceService.js`) — up to **3 approved profiles per device**, all from the *same* classroom (a structural rule, not a server-enforced one). A `deviceResetPin` (set per-classroom) gates adding/removing profiles beyond the first free one.
4. Each of the 3 device "slots" additionally gets its **own independent Firebase Anonymous Auth identity** (`studentAuthService.js`, separate named Firebase App per slot) — used only for write-attribution (so a security rule could eventually check `request.auth.uid`), explicitly **not yet load-bearing for any actual security rule**.

**A second, dormant identity system exists** (`studentIdentityService.js`, `js/services/identity/*`, `js/repositories/identity/*`): a PIN/invitation-token based parent/guardian-linking model. It is fully built but explicitly unused by the live flow — "left in place, unused... backing a secondary parent-connection path this phase deliberately left alone."

**Student Portal home** (`StudentJourneyView.js`, "Journey"): personal greeting; an "Explore" Bento grid (My Goals, Class Feed, Notebooks, Learning, Learning Circle); Class Standings (the *same* shared `TeamStandingsBoardElement` component Teacher Mode's Class Mode renders — not a copy); a compact stars/streak/badge summary; a unified "Your Updates" event timeline. Shell nav (`StudentPortalShell.js`): Journey / Team / Recognition / Profile.

**Other student views:** `StudentFeedView`, `StudentGoalTrackerView`, `StudentAssessmentResultsView`, `StudentNotebooksView`, `StudentLearningView` (Subjects → Units → Concept Map → Concept Detail — students *do* have their own read path into the curriculum tree, just not into Timetable/lesson-planning), `StudentLearningCircleView`, `StudentRecognitionView`, `StudentAchievementsView`, `StudentTeamView`/`StudentTeamDetailView`, `StudentPublicProfileView`, `StudentProfileView`, `StudentAvatarBuilderView` (local-only), `ConceptFeedbackFlowView`, `StudentLearnView` (an explicit placeholder for the not-yet-built Learning Hub product).

---

## 4. Current Timetable Architecture (priority focus)

**This is the most important section for the shared-classroom-timeline question, because the underlying data model turns out to already be role-agnostic — only the current UI/consumption layer is teacher-only.**

### The three-tier model

| Tier | What it represents | Where it lives |
|---|---|---|
| `Timetable` | The classroom's recurring weekly pattern | `classroom.timetable = { periods: [], slots: [] }` — embedded field on the Classroom document |
| `TimetablePeriod` | The shared daily period grid (period number + start/end time), same every weekday | `Timetable.periods[]` |
| `TimetableSlot` | One recurring assignment: `(weekday, periodNumber) → subject [+ teacherUid]` | `Timetable.slots[]`. A `(weekday, periodNumber)` with no matching slot = "no class" |
| `TeachingSlot` | A **concrete, dated occurrence**, derived on demand from the pattern above — never stored per-date on its own | Computed by `timetableService.getConcreteSlotsForDateRange()` |
| `Lesson` | The actual lesson-plan content attached to one concrete `TeachingSlot` | Its own Firestore document, `classrooms/{classroomId}/lessons/{lessonId}` |

**The exact connecting mechanism:** `TeachingSlot.id` is a deterministic string, `buildTeachingSlotId(classroomId, dateKey, periodNumber)` → `"{classroomId}_{dateKey}_p{periodNumber}"`. `Lesson.teachingSlotId` is set to that same string. There is no separate join table — a Lesson simply carries the id its origin slot would deterministically have. `plannerRepository.getLessonByTeachingSlotId()` looks it up with a single-field Firestore query (`where('teachingSlotId', '==', teachingSlotId)`).

**Carry Forward** (`carryForwardService.js` + `models/Lesson.js`'s `carryForwardConcept()`): a concept can be moved from a source Lesson to a future same-subject Lesson without being cloned — it stays in the source's `conceptIds` (marked via `carriedForwardConceptIds`, never removed) and is appended to the target's `conceptIds` with a `conceptProvenance` entry recording where it came from. `suggestCarryForwardTargets()` is a pure, read-only forward scan (bounded by a 60-day horizon) for the next matching-subject slot; the actual move persists both Lessons atomically in one Firestore batch.

### Current visibility: verified teacher-only, by absence not by design intent

A repo-wide search confirms: **there is no student-facing Timetable/schedule view anywhere in this codebase today.** `TodaysScheduleWidget.js` (the only "Today's Schedule" surface) is explicitly built for, and only wired into, `DashboardView.js`/`PersonalHubView.js` — both teacher-side. No student-portal file imports `timetableService`, `TeachingSlot`, or any period/schedule concept for display purposes.

**Why this matters for the shared-classroom-timeline question:** the *data model* itself has no baked-in teacher-only assumption:
- `getConcreteSlotsForDateRange()` is a pure function of the classroom's own recurring pattern and a date range — it has no concept of "who is asking."
- `plannerRepository.getLessonsForDateRange()` / `getLessonByTeachingSlotId()` already accept an **optional `firestoreOverride` parameter**, added specifically so student-side callers can pass their own per-slot-authenticated Firestore instance instead of the (signed-out-by-default) main app instance — this pattern already exists and is already used elsewhere for student reads (e.g. `studentPortalDataService.getConceptFeedbackForLesson()`, `timetableLessonService.getRecentlyTaughtLessons()`).
- Concept coverage status per occurrence (`executedConceptIds`/`carriedForwardConceptIds`) and resources-per-lesson are already stored per-Lesson, independent of any teacher-only field.

**What would actually be needed** for "student looks backward/today/forward at the same classroom timeline": a new student-facing route/view (there is genuine UI work here — nothing to repurpose directly, since `TimetableView.js` is full of teacher-only actions: Assign Unit, Add Concept, Mark Covered, Carry Forward, Manage Timetable), reading through the *same* `timetableService`/`plannerRepository` functions with the `firestoreOverride` pattern already established, presenting a read-only projection (topic, resources marked `audience: 'student'/'both'`, concept status) with all teacher actions stripped. The backend/model layer does not need to change to support this — the gap is entirely in the UI/route layer.

---

## 5. Current Period/Lesson Data Model

`models/Lesson.js` fields: `id, planningCycleId, classroomId, date, teachingSlotId, curriculumUnitId, conceptIds, executedConceptIds, carriedForwardConceptIds, conceptProvenance, sequenceIndex, estimatedMinutes, actualMinutes, status, teacherReflection, feedbackSharedAt`.

`models/TeachingSlot.js` fields: `id, date, weekday, periodNumber, duration, subjectId, teacherUid`.

Key distinctions already enforced in the model:
- `conceptIds` (planned) vs `executedConceptIds` (subset, actually taught **in this one occurrence**) vs `carriedForwardConceptIds` (subset, deferred elsewhere — stays in `conceptIds` for display, never removed).
- `Lesson.executedConceptIds` is explicitly **independent of** `LearningConcept.status` (see §6) — one is per-occurrence, the other is classroom-wide/shared, and they're allowed to disagree.
- `getFeedbackEligibleConceptIds(lesson)` returns `executedConceptIds` — this is what gates the student self-report feedback flow (§10-adjacent, `conceptFeedbackService.js`).

**Storage:** one Firestore document per Lesson, `classrooms/{classroomId}/lessons/{lessonId}` (a dedicated subcollection, not embedded — explicitly for unbounded multi-year growth and single small writes on status changes).

---

## 6. Current Concept Model and Ownership (priority focus)

### The hierarchy

```
Classroom.learningRecord.subjects[]   (LearningSubject)
  └── units[]                          (LearningUnit)
        └── concepts[]                 (LearningConcept)
```

All three tiers are **plain nested arrays embedded in one Classroom document** — no separate Firestore documents/collections for Subject, Unit, or Concept.

| Model | Fields | Notes |
|---|---|---|
| `LearningSubject` | `id, subjectId, title, units[], linkedCurriculumIndexId` | `subjectId` is the *canonical* subject-type id (`subjectIdentityService.js`), distinct from this record's own `id` — a pre-existing, already-confusing "two different subject ids" pattern (see §16). |
| `LearningUnit` | `id, title, concepts[], partName, linkedCurriculumUnitId, number, learningHubPack` | `learningHubPack` (optional, `{ packId, title }`) is a real, existing **Unit-level** reference into Learning Hub's catalogue of "Packs." Omitted entirely (not `undefined`) when absent. |
| `LearningConcept` | `id, title, status ('taught'\|'not_taught'), resourceLinks[], description` | `status` is **classroom-wide** — "a concept is taught to the whole class as one event." **No Learning Hub id field exists on Concept itself, by deliberate design** (see below). |
| `StudentConceptRecord` (per-student, not on Concept) | `understanding, notebook, helpRequested, updatedAt` | Lives at `Student.learningRecord[conceptId]`, *not* on `LearningConcept` — the "two places to look, not one" design decision documented in `docs/LEARNING_RECORD.md`: whole-class facts stay on the Concept, per-student facts stay on the Student. |

### Deliberate absence of a Concept-level Learning Hub ID

`docs/UNIFIED_PLATFORM_ARCHITECTURE.md` frames `LearningConcept` explicitly as "the one shared join point every concept-attached system hangs off" — and consistent with that framing, **every existing cross-reference to Learning Hub attaches one level away from the Concept itself**, never directly on it:

1. `LearningUnit.learningHubPack` — a Unit-level pointer to a Learning Hub "Pack."
2. `Resource.content = { kind: 'learning_hub_experience', experienceType, experienceId }` — a Resource (attached to a Concept via `ConceptResourceLink`, §7) that happens to point at a Learning Hub catalogue entry.
3. `Activity.destination` + `Activity.activityType === 'learning_hub'` — an Activity (tied 1:1 to a `conceptId`) whose destination is a Learning Hub entry id.

None of these make `LearningConcept` and a Learning Hub bucket the *same* database entity — they're all optional, one-hop references. This is already consistent with the caution in this review's brief not to assume Concept and Learning Hub's representation must be one shared entity; the current codebase already doesn't assume that.

### ⚠️ Terminology collision worth flagging explicitly

**"Learning Hub" is used in the existing docs/code in two different senses that must be disambiguated in joint review:**

- **Sense A (older/internal):** `docs/UNIFIED_PLATFORM_ARCHITECTURE.md` uses "Learning Hub" to refer to ClassMate's *own* internal Resource/`ConceptWorkspaceView.js` subsystem ("Learning Hub answers 'how it should be taught'... see `models/Resource.js`") — i.e., an in-app module, not a separate product.
- **Sense B (current/external):** `docs/LEARNING_HUB_INTEGRATION_CONTRACT.md`, `learningHubCatalogueService.js`, and the live catalogue fetch all refer to a **genuinely separate, externally deployed product** at `https://learning-hub-b2586.web.app/`.
- `docs/LEARNING_RECORD.md` (the earlier of the two docs) explicitly states Learning Record is "not part of Learning Hub" and that a grep for "Learning Hub" outside itself returns only one unrelated comment — meaning at the time that doc was written, sense B (the real external product) essentially didn't exist in the codebase's vocabulary yet.

Practically: when reading any ClassMate doc/comment that says "Learning Hub," check which era/sense it means before treating it as a statement about the real external product.

### Reachability gap

`ConceptWorkspaceView.js` — the one screen with a genuine per-concept "Activities" tab (showing Learning-Hub-typed Assignments and roster tallies) — is, per `UNIFIED_PLATFORM_ARCHITECTURE.md`'s own explicit note, **not currently reachable from anywhere in the app's real navigation**, despite its own header comment describing itself as "the permanent home for every concept-related feature." This predates the current review and is a real gap, not a design decision.

---

## 7. Current Resource Model

`models/Resource.js` — a fully independent aggregate with **no knowledge that Concepts exist**: `{ id, title, type, status ('draft'|'published'|'archived'), content, audience ('teacher'|'student'|'both', default 'teacher'), createdAt, updatedAt }`. `content` is type-specific and open-ended; one shape is `{ kind: 'learning_hub_experience', experienceType, experienceId }`.

**Storage:** own Firestore subcollection, `classrooms/{classroomId}/resources/{resourceId}` — moved out of embedded arrays specifically because Resource content (e.g. a Reading's `blocks`) is unbounded growth that shouldn't bloat the Classroom document.

**Linkage to Concepts:** many-to-many, via `ConceptResourceLink` (`{ resourceId, resourceType, addedAt, addedBy }`) stored in `LearningConcept.resourceLinks[]` — the same Resource can be linked from multiple Concepts with zero duplication. `ConceptResourceLink` is deliberately *not* its own collection (evaluated explicitly via DDD reasoning: no independent identity/lifecycle, no real invariants of its own — see `UNIFIED_PLATFORM_ARCHITECTURE.md` §3).

`audience` is the field that currently distinguishes "Student Resources" from teacher-only "Lesson Plan" material in the Timetable's Resources tab (built this session) — new resources still default to `'teacher'` unless explicitly set otherwise.

---

## 8. Current Assignment / Learning Activity Model

Three-layer model, per `docs/LEARNING_HUB_INTEGRATION_CONTRACT.md` (a real contract document, not yet live end-to-end):

| Layer | Model | Storage | Notes |
|---|---|---|---|
| The reusable "what to do" | `Activity` (`models/Activity.js`) — **new** | own subcollection, `classrooms/{classroomId}/activities/{activityId}` | `{ id, conceptId (required), title, description, activityType: 'native'\|'learning_hub'\|'external', externalProvider, destination (opaque), scoreMax, createdAt, updatedAt }`. Deliberately not folded into Resource — single-Concept, scoring-aware, exists to be launched and report a result. |
| The classroom's instance of assigning it | `LearningActivity` — existing, extended | embedded, `classroom.learningActivities[]` | `+activityId (nullable), +conceptId (nullable, denormalized)` — both optional/backward-compatible additions. `activityId: null` = a classic teacher-authored task with nothing external attached. |
| The per-student outcome | `Student.submissions[assignmentId]` — existing, extended | embedded on the Student record | `+scoreMax, +completedAt, +source ('classmate'\|'learning_hub'\|'external'), +conceptId`. No synthetic Result id — the composite key `(assignmentId, studentId)` *is* the identity. |

**Launch/result contract, currently unimplemented end-to-end:**
- `learningIntegrationService.resolveActivityLaunch(classroom, assignmentId, studentId)` → `{ assignmentId, activityId, activityType, destination, conceptId, studentId }` — resolves a payload only, **performs no actual cross-app launch** (no redirect, no `window.open`).
- `learningIntegrationService.recordResult(classroom, {...})` — validates and writes a result, but **is not a network endpoint**. There is no HTTP route anywhere in this codebase that lets an external caller (i.e. a real Learning Hub) claim a result happened. Both functions are same-codebase calls only today.

**Teacher UI:** `ActivitiesView.js` (list + roster), `ConceptWorkspaceView.js`'s Activities tab (per-concept, read-only — but see §6's reachability gap).

---

## 9. Current Assessment Model

Fully independent of Concepts/Units/Resources — the *only* link to curriculum is `AssessmentSubject.subjectId`, resolved live against the Learning Management subject list (never copied).

| Model | Fields |
|---|---|
| `Assessment` | `id, classroomId, title, type, academicYear, date, status ('Draft'\|'Published'\|'Locked' — only Draft is functional today), createdAt, detailsLastSavedAt, assessmentSubjects[], pinnedToDashboard` |
| `AssessmentSubject` | `id, subjectId, maximumMarks (default 100), studentResults[], lastSavedAt` |
| `StudentResult` | `id, studentId, marks, absent, remarks` — only exists once a teacher enters something; no grade is computed/stored ("do not implement grades yet") |

Types: `Mid Term, Unit Test, Quarterly, Half Yearly, Annual, Custom`. Ranking uses standard competition ranking, excluding absent/unmarked students. Publishing (`Draft → Published`) notifies the whole roster via `studentEventService`.

**Storage:** embedded in `classroom.assessments[]` — no dedicated subcollection (unlike Lessons/Resources/Activities).

**Access:** teacher writes everything; students read only their own results (`StudentAssessmentResultsView.js`, fetched fresh each time, not cached from the notification event).

---

## 10. Current Feed / Goal / Recognition / Stars Functionality

### Class Feed
`FeedPost` — dedicated subcollection `classrooms/{id}/feedPosts/{postId}` (+ `.../comments/{commentId}` subcollection; reactions are a small bounded `reactorUids[]` array on the post directly — deliberately not a further subcollection). **Both teachers and students can post** — a rare case in this codebase of genuinely symmetric write access. The exact same `FeedPostCard.js` component renders both `FeedModerationView.js` (teacher, + moderation controls: soft-remove, media approve/reject) and `StudentFeedView.js` (student). Student-authored posts can't self-notify teachers (anonymous uid), so any currently-open teacher session live-detects new student posts and creates the notification on the student's behalf, deduped across multiple open teacher sessions.

### Goals
Two generations coexist by design: `GoalCycle`/categories remain **embedded** on `classroom.goalCycles[]` (cycle/category metadata only — one active cycle per classroom); actual `Goal` **submissions** live in their own subcollection, `classrooms/{id}/studentGoals/{goalId}` (deterministic id `studentId::cycleId::categoryId`). **Student-authored, teacher-approved**: a student submits goal text (locked once approved, or returned as `changes_requested` with teacher feedback); a student toggles their own daily completion, written through their own per-slot Firestore identity. Teachers never edit goal text, only approve/request-changes.

### Recognition (three distinct subsystems)
- **Badges** — teacher-awarded only, from a per-classroom catalog (`classroom.settings.badgeCatalog`), stored as `student.badges[]` (embedded) + an append-only Timeline entry.
- **Recognition Wall/Screen** — fully computed/derived leaderboards (`RECOGNITION_CATEGORIES` config: star performer, longest streak, notebook champion, biggest climber, team champion). **No recognition data is ever stored** — it's a pure read projection over existing `score`/`history`/notebook data, with no "awarding" action at all. Same component renders for both teacher (`RecognitionScreenView.js`) and student (`StudentRecognitionView.js`).
- **Standings** — Team/Classroom leaderboards, also pure computed projections (`teamStatisticsService.js`); Team scores are *never* stored, always the live sum of member students' `score`. A **permanent point-in-time snapshot** (`scoreboardArchives` subcollection) is taken only at explicit "Reset Scoreboard" actions.

### Stars / Score
Not a separate entity — `student.score` (current total) derives from an append-only `student.history` timeline (`{ id, kind, label, delta, recordedAt }`). "Stars" is a Recognition-layer interpretation (positive-only entries within a date range), not a stored field.

---

## 11. Classroom, Teacher, and Learner Relationships

- **Classroom** — one shared Firestore document (`classrooms/{id}`), owned by `ownerUid`, with real Google-authenticated **co-teacher** membership via `members{uid:{role,displayName,joinedAt}}` + a mirrored `memberUids[]` array (for Firestore query support, since Firestore can't query map-key membership directly).
- **Teacher ↔ Classroom** — many-to-many. A teacher can belong to (co-teach) several classrooms; a classroom can have several teacher-members plus one owner.
- **Student ↔ Classroom** — **exactly one classroom per device**, structurally (not server-enforced) — every approved profile on one device comes from the same classroom. Students live nested in `classroom.teams[].students[]` — **not** in `members`, and **not** their own top-level collection.
- **Student ↔ Identity** — `Student.id` has **zero linkage field** to any Firebase Auth uid or external identity system on the model itself. The link is entirely environmental: a trusted device's `{classroomId, studentId}` localStorage entry, plus a per-slot anonymous Firebase Auth uid used only for write-attribution.

---

## 12. Authentication and Identity Assumptions

| | Teacher | Student |
|---|---|---|
| Identity provider | Real Firebase Auth, Google Sign-In only | None — device-trust + roster pick |
| Durable across devices? | Yes | **No** — tied to one device's `localStorage`, max 3 profiles, all one classroom |
| Auth uid on the entity model? | Yes (`ownerUid`, `members` keys) | **No** — `Student.id` carries no auth linkage |
| PII collected | `{uid, displayName, photoURL}` only — **email deliberately never stored** | Name + roll number only; no email, no photo tied to identity |
| Governance status | Live, unrestricted | **Explicitly deferred** — `MEMBER_ROLES`'s own header comment states real STUDENT/PARENT permission enforcement is "intentionally deferred until student/parent authentication is approved... blocked pending AI Working Committee review of Google Sign-In, profile photos, and DPDP Act children's-data handling for minors" |

**This is a load-bearing existing decision, not an oversight.** A dormant, fully-built parent/guardian-linking identity system (`studentIdentityService.js`) already exists but is unused — evidence that "build it and it gets wired up later" does not reliably happen in this codebase once something falls off the main call path (same fate as `ConceptWorkspaceView.js`'s reachability gap, §6). Any joint architecture decision involving student identity federation with Learning Hub must be evaluated against this: ClassMate itself has deliberately not built durable student accounts, for compliance reasons that are still pending committee review — not simply because nobody got to it yet.

---

## 13. Existing Learning Hub References / Integration Points

| Integration point | Direction | Status |
|---|---|---|
| `learningHubCatalogueService.js` → `https://learning-hub-b2586.web.app/catalogue.json` and `/packs.json` | ClassMate reads Learning Hub | **Real, live, deployed.** Plain unauthenticated `fetch()`, never cached/persisted — every browse is a fresh network call. (The file's own header comment is stale and says "placeholder, not deployed" — the code and URLs below it say otherwise; trust the code.) |
| `LearningUnit.learningHubPack` (`{packId, title}`) | Reference only | Set/cleared via `LearningManagementView.js`'s "Link Learning Hub Pack" flow |
| `Resource.content.kind === 'learning_hub_experience'` | Reference only | Set via "Link Learning Hub concept card" pickers in `LearningManagementView.js` and `TimetableView.js` |
| `Activity.activityType === 'learning_hub'` + `Activity.destination` | Reference only (opaque) | Modeled per `docs/LEARNING_HUB_INTEGRATION_CONTRACT.md`; ClassMate never parses `destination` |
| `LearningActivity.activityId` / `.conceptId` | Reference only | Links a classroom Assignment to an Activity definition |
| `Student.submissions[].source === 'learning_hub'` / `.conceptId` | Result/evidence field | Modeled, but **nothing currently writes this from a real Learning Hub** — no network path exists |
| `resolveActivityLaunch()` / `recordResult()` | Both directions, in theory | **Same-codebase function calls only.** No actual cross-app launch (no redirect/`window.open`), no network endpoint for results to arrive |
| `ConceptWorkspaceView.js` Activities tab | ClassMate reads its own stored data | Real UI, but the whole view is unreachable from navigation (§6) |

**Net assessment:** the *only* live, working interaction with the real external Learning Hub today is **one-directional and read-only**: a teacher browsing Learning Hub's public catalogue JSON to attach a reference as a Resource or Activity destination. Nothing flows the other way yet — no launch, no result callback, no shared identity.

---

## 14. Important IDs and Relationships

| ID | Source | Scope | Cross-product suitability |
|---|---|---|---|
| `classroomId` | `Classroom.id` (Firestore doc id) | Global (per classroom) | Must accompany any other id below if referenced cross-classroom or cross-product |
| `Student.id` | `Student.id` (`generateId()`) | Unique within classroom | No auth linkage; not durable across devices; treat as classroom-local only |
| `conceptId` | `LearningConcept.id` | Unique within classroom | Good taxonomy anchor; **not globally unique**, always needs `classroomId` alongside |
| `unitId` / `subjectId` (record) | `LearningUnit.id` / `LearningSubject.id` | Unique within classroom | `subjectId` is ambiguous — see below |
| `subjectId` (canonical) | `subjectIdentityService.js`'s registry | Global | **Same field name, different meaning** from `LearningSubject.id` above — an existing internal ambiguity, worth learning from before introducing a Learning Hub id with a similarly generic name |
| `teachingSlotId` | Deterministic string `"{classroomId}_{dateKey}_p{periodNumber}"` | Unique within classroom | Composite, not a random id — recomputable from (classroom, date, period) |
| `Lesson.id` | `generateId()` | Firestore doc id, unique within classroom | — |
| `resourceId` | `Resource.id` | Firestore doc id, unique within classroom | Resource itself has no Concept awareness — link is external (`ConceptResourceLink`) |
| `activityId` | `Activity.id` | Firestore doc id, unique within classroom | New model, designed for this exact integration |
| `assignmentId` | `LearningActivity.id` | Unique within classroom | ClassMate's "Assignment" |
| Result key | `(assignmentId, studentId)` composite | — | No synthetic id introduced, by design |
| `learningHubPack.packId` | External (Learning Hub) | Opaque to ClassMate | Never parsed |
| `Resource.content.experienceId` / `Activity.destination` | External (Learning Hub) | Opaque to ClassMate | Never parsed |

**Standing rule already documented in the existing Integration Contract:** every classroom-scoped id above is unique *within* its classroom, never globally — any cross-system reference should always carry `classroomId` alongside it.

---

## 15. Teacher-Facing / Student-Facing / Shared Functionality

| Feature | Teacher | Student | Shared component/data? |
|---|---|---|---|
| Timetable / Lesson planning | Full read/write (only interface that exists) | **None today** — data model would support a read-only view (§4) | No |
| Concepts / syllabus authoring | Full read/write | Read-only, own view (`StudentLearningView.js`) | No — separate views, same underlying data |
| Concept taught-status / coverage | Teacher sets | Student sees resulting resources/feedback prompts, not the authoring UI | No |
| Concept self-report feedback (`conceptFeedbackService.js`) | Reads aggregate | Submits own | No — but genuinely independent of any Learning Hub signal |
| Resources | Teacher manages | Sees only `audience: 'student'/'both'` resources | No |
| Assessments | Full read/write | Read own results only | No |
| Class Feed | Read/write + moderate | Read/write (own posts/comments) | **Yes** — identical `FeedPostCard.js` for both |
| Goals | Approve/request-changes; manage cycle | Write own goal text + daily completion | No, but a clean split-ownership pattern |
| Recognition Wall/Screen, Standings | Read (computed) | Read (computed) | **Yes** — same components/services, zero write path for either role |
| Badges | Award only | Read own | No |
| Notebook Tracker | Full read/write | Read-only | No |
| Learning Programmes | Full read/write | Session participation view | Partial |

---

## 16. Current Architectural Limitations / Coupling Relevant to Future Integration

1. **Terminology collision on "Learning Hub"** (§6) — two different referents exist in ClassMate's own docs/code history (an internal module, and the real external product). Must be disambiguated before any joint design discussion proceeds, or conversations will silently talk past each other.
2. **No network boundary exists yet** for Learning Hub → ClassMate results, or for ClassMate → Learning Hub launch. Everything today is same-codebase function calls (`resolveActivityLaunch`, `recordResult`) or one-directional public-JSON reads (`learningHubCatalogueService.js`). A real integration needs to design this network boundary from scratch — nothing to repurpose.
3. **Reachability gap:** `ConceptWorkspaceView.js`, the one screen built to show per-concept Learning Hub activity, isn't linked from any real navigation. Decide explicitly whether to wire it in or supersede it — don't let it silently continue existing-but-unused.
4. **No Concept-level Learning Hub id** — by design, all references are one hop away (Unit's pack, a Resource's pointer, an Activity's destination). Good for not conflating identities prematurely; means "does this concept have Learning Hub content" today requires checking three different possible attachment points, not one field.
5. **Student identity is deliberately thin and non-durable**, for reasons still pending compliance review (§12). Any Learning Hub identity-federation design must not assume ClassMate students have (or will soon have) durable real accounts — that assumption would be ahead of what ClassMate itself has decided to build.
6. **Assessments are fully siloed** from Concepts/Curriculum by explicit design (only a loose live-resolved `subjectId` reference). If Learning Hub evidence is ever considered grade-adjacent, it would be crossing into a domain that today has zero structural linkage to Concept-level data at all — that boundary would need to be built, not just connected.
7. **`subjectId` already means two different things** in this codebase (a canonical registry id vs. a `LearningSubject` record's own id) — a preexisting cautionary example of exactly the kind of naming collision a new Concept↔Learning-Hub identifier could repeat if not named carefully.
8. **Firestore document-size convention already established:** bounded/teacher-owned config stays embedded on the Classroom document; unbounded-growth or student-owned-writable data gets its own subcollection (Lessons, Resources, Activities, Feed posts/comments, Student Goals, Programme sessions, Scoreboard archives). Any new Learning-Hub-adjacent ClassMate-side entity should follow this existing rule rather than inventing a third storage pattern.
9. **Things that fall off the main call path stay unused indefinitely** — both the dormant parent-identity system and the unreachable `ConceptWorkspaceView.js` demonstrate this. A phased integration plan should treat "not yet wired into real navigation" as equivalent to "does not exist yet" for planning purposes.
10. **A parallel `src/js/...` tree was found during research**, apparently mirroring parts of the real `js/...` tree (e.g. duplicate `bucketConfig.js`/`bucketService.js`). Not diffed as part of this inspection; flagged here only because it's the kind of thing that could cause confusion if anyone starts grepping this codebase for integration points and finds two copies of similar-looking files. Worth a separate, unrelated cleanup pass at some point.

---

## Questions for Joint Architecture Review

1. Does Learning Hub's own "Concept Bucket" have a stable, catalog-scoped identity today, and what's its actual current data shape — is it the same `{id, title, type, description, entry}` shape `learningHubCatalogueService.js` already consumes, or richer?
2. ClassMate already has *three* informal Concept↔Learning-Hub attachment points (Unit's `learningHubPack`, a Resource's `experienceId`, an Activity's `destination`). Should these converge into one canonical link, or do they legitimately serve different granularities (Unit-level "pack" vs. Concept-level "specific experience")?
3. Does Learning Hub assume a durable, real per-student account? If so, how does that reconcile with ClassMate's own deliberately thin, anonymous-per-device-slot student identity — which is itself still pending AI Working Committee review for anything more durable?
4. Is bucket/content creation entirely a Learning-Hub-side curriculum-authoring concern, or does ClassMate ever need to trigger/request it? (Relevant to the earlier strategy discussion's "auto-provisioning" question.)
5. Does Learning Hub's own roadmap already have a plan for a results/evidence callback, and whose infrastructure would host that endpoint — since ClassMate's `recordResult()` is real but has no network surface today?
6. Does Learning Hub have any notion of "classroom" or "roster" at all today, or is it currently a stateless/anonymous catalogue with no assignment concept? This determines whether an Assignment-shaped bridge is buildable now or needs new Learning-Hub-side infrastructure first.
7. Is the public, unauthenticated `learning-hub-b2586.web.app/catalogue.json` endpoint meant to stay public/unauthenticated indefinitely, or is scoped/authenticated access planned? This affects whether ClassMate's current "browse and link" flow is a permanent integration pattern or a placeholder to be replaced.
8. Should `ConceptWorkspaceView.js` be wired into real navigation as part of this work, given it already has a built Activities tab for exactly this purpose — or is it being superseded by new UI entirely?
9. Does (or should) Learning Hub distinguish formative practice evidence from anything grade-adjacent, matching ClassMate's existing hard separation between Assessments and everything else?
10. What does Learning Hub call the thing ClassMate calls a "Concept"? Is there a real risk of two independently-maintained curriculum taxonomies drifting apart, and if so, which side should be authoritative for naming/wording?
11. Does Learning Hub have (or plan) any notion of teacher-side authoring/customization of content, or is its content entirely centrally curated today? This affects whether "teacher creates a concept in ClassMate" should ever be capable of creating Learning Hub content, or only ever linking to existing content.
