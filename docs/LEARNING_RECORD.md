# Learning Record — Milestone 3, Phase 1 (Architecture Only)

This document describes the Learning Record domain: a student's academic record — what's been taught, what each student understands, notebook status per concept, and open help requests. It is **not** a lesson player, and it is **not** part of Learning Hub. Phase 1 delivers models, services, data flow, and persistence — deliberately no UI yet.

---

## 1. Independence from Learning Hub

Learning Hub may consume this data later, but as of Phase 1:

- No file in this feature imports from, or is imported by, anything Learning-Hub-related.
- No shared vocabulary: models are named `LearningSubject` / `LearningUnit` / `LearningConcept`, not `Subject` / `Unit` / `Concept` — partly to avoid colliding with the unrelated `NotebookSubject` model that already exists (see §6), and partly so this domain never accidentally inherits assumptions from a lesson-player mental model.
- A grep for `learningHub`/`Learning Hub` outside of this doc and one unrelated comment in `ui/student-portal/StudentPortalShell.js` (about the nav tab that doesn't exist yet) returns nothing that touches this feature.

If Learning Hub is built later, it should depend on this module's services (`learningRecordService.js` at minimum), not the other way around.

---

## 2. The Hierarchy

```
LearningSubject
  └── LearningUnit
        └── LearningConcept
```

- **Subject** — e.g. "Mathematics". Root of the tree.
- **Unit** — e.g. "Fractions". A named grouping within a subject.
- **Concept** — e.g. "Adding fractions with unlike denominators". The leaf node — the actual unit of teaching/understanding/tracking.

All three are plain arrays owned by their parent (`subject.units`, `unit.concepts`), the same "owns its children directly" shape `Team.students` already uses — no separate lookup table, no normalized IDs-only relationships.

---

## 3. The Key Design Decision: Two Places to Look, Not One

The brief describes a Concept as having five fields: `id`, `title`, `status`, `understanding`, `notebook`, `helpRequested`. Phase 1 does **not** store all five on one object. Here's why, and where each one actually lives:

| Field | Varies by student? | Who sets it | Lives on |
|---|---|---|---|
| `id`, `title` | No | Teacher | `LearningConcept` (classroom-level) |
| `status` (taught / not_taught) | No — a concept is taught to the whole class as one event | Teacher | `LearningConcept` (classroom-level) |
| `understanding` | **Yes** | Student | `Student.learningRecord[conceptId]` (per-student) |
| `notebook` | **Yes** | Teacher | `Student.learningRecord[conceptId]` (per-student) |
| `helpRequested` | **Yes** | Student (or resolved by teacher) | `Student.learningRecord[conceptId]` (per-student) |

If all five lived on one shared `LearningConcept` object, "understanding" would mean the same thing for all 40–60 students in a class simultaneously — which isn't what the feature means (each student has their own understanding, their own notebook status, their own help requests for the same concept).

This is not a new pattern for this codebase — it's the exact shape `LearningActivity` + `Student.submissions` already use: a Learning Activity is created once at the classroom level, and each student gets an independent status against it (see `models/LearningActivity.js`'s own doc comment). Learning Record's Concept/`learningRecord` split is the same idea, one level deeper in a tree instead of a flat list.

**This is the one deviation from the brief's literal wording, and the reason Phase 1 exists for review before UI is built on top of it.** If the intent was genuinely a single shared record (e.g., one whole-class understanding score, not per-student), that would be a different, much simpler design — flag this if so.

---

## 4. Control Boundary (Structural, Not Just Documented)

| Teacher controls | Student controls |
|---|---|
| Syllabus structure (create/rename/delete subjects, units, concepts) | Understanding (`setUnderstanding`) |
| Taught status (`setConceptTaughtStatus`) | Help request (`requestHelp` / `withdrawHelpRequest`) |
| Notebook status (`setNotebookStatus`) | |
| Resolving a help request (`resolveHelpRequest`) — the one shared action; either side can clear a request | |

This split is enforced by **file boundaries**, not comments a future editor could ignore:

- `services/learningRecordService.js` — shared, read-only queries. Never mutates, never saves. Both other services (and eventually both Teacher Portal and Student Portal UI) read through this one file, so there is exactly one implementation of "what does a missing record default to" (see §5) and exactly one way to walk the tree.
- `services/learningRecordTeacherService.js` — every syllabus/taught/notebook mutation. Has no function that takes a bare `studentId` to look up — see §7 on why.
- `services/learningRecordStudentService.js` — every understanding/help-request mutation. Every function takes the specific `student` object being modified directly, not an id to search for, so there's no path for a caller to accidentally (or maliciously) pass in a different student's id and modify someone else's record through this file.

A future UI is expected to import only `learningRecordTeacherService.js` from the Teacher Portal and only `learningRecordStudentService.js` from the Student Portal — never the other one — the same separation `ui/student-portal/` already maintains from teacher-only services elsewhere in this app.

---

## 5. The Default-Record Contract

A concept a student has never touched has **no entry** in `student.learningRecord` — not an entry with empty/zero values. `learningRecordService.getStudentConceptRecord(student, conceptId)` is the one place that turns "no entry" into a real default record:

```js
{ understanding: 'not_marked', notebook: 'not_required', helpRequested: false, updatedAt: null }
```

This mirrors `learningActivityService.getSubmissionStatus()`'s existing "no entry = 'Not Assigned'" contract exactly. Every reader — teacher and student services, and any future UI — must call this function rather than reading `student.learningRecord[conceptId]` directly, or a student who's never opened a concept would show as `undefined` instead of a defined, correct default.

---

## 6. Relationship to Existing Models (and Why the Names Differ)

| Existing model | Relationship to Learning Record |
|---|---|
| `NotebookSubject` (`models/NotebookSubject.js`) | Conceptually similar ("a subject taught in this classroom") but a **different, unrelated** entity — it's the Notebook Tracker's own subject taxonomy (e.g. "English" as a notebook category), stored on `classroom.notebookConfig`, with its own service (`notebookConfigService.js`). Named `LearningSubject` here specifically to avoid this collision. |
| `LearningActivity` + `Student.submissions` | The direct architectural precedent for this whole feature — see §3. Not otherwise related; a Learning Activity is a one-off assignable item ("Plant Kingdom Worksheet"), not part of an ongoing syllabus tree. |
| Notebook Tracker's `notebooks` register | Unrelated day-by-day submission log for a different feature. Learning Record's `notebook` status field is conceptually adjacent (both track "has this work been submitted/corrected") but is its own field on `StudentConceptRecord`, with no shared code path to the Notebook Tracker. |

No file in this feature imports from `notebookConfigService.js`, `notebookService.js`, or `learningActivityService.js`. The similarity is in *shape*, deliberately reused for consistency — not in *code*.

---

## 7. Persistence

**There is no new persistence layer.** Learning Record data is just two new fields on entities the app already persists as a whole:

- `classroom.learningRecord = { subjects: [] }` — new field on the existing classroom document.
- `student.learningRecord = {}` — new field on each existing Student record, nested inside `classroom.teams[].students[]` the same as `submissions`.

Both are written to Firestore by the exact same mechanism every other classroom mutation already uses: a caller mutates the in-memory `classroom` object (directly, or via a student inside it), then calls `workspaceService.save(classroom)`, which upserts the one classroom document via `ClassroomRepository.saveClassroom()`. No new Firestore collection, no new security rule, no new repository method — the whole feature rides on the existing "classroom is one shared document" model documented in `repositories/classroomRepository.js`.

### Data flow

```
Teacher: builds syllabus, marks taught, sets notebook status
                    │
                    ▼
      learningRecordTeacherService.js  (mutates classroom / student in memory)
                    │
Student: reports understanding, requests help
                    │
                    ▼
      learningRecordStudentService.js  (mutates student in memory)
                    │
                    ▼
         workspaceService.save(classroom)   (existing, unchanged)
                    │
                    ▼
      ClassroomRepository.saveClassroom()   (existing, unchanged)
                    │
                    ▼
              Firestore: classrooms/{classroomId}
                    │
                    ▼
      learningRecordService.js   (read-only queries, both roles + future UI)
```

Same read/write split `studentProgressService.js` documents for itself in `docs/PROGRESS_ENGINE.md`: one read-only query layer, no separate "recompute" step, no cache to keep in sync — a query is always a live read over whatever's currently stored.

---

## 8. What Phase 1 Deliberately Does Not Include

- **No UI.** Per the brief.
- **No Timeline logging.** See `learningRecordTeacherService.js`'s doc comment — whether marking concepts taught/corrected happens one at a time or in bulk (e.g. "mark this whole unit taught") changes whether a Timeline entry per change would be useful or just noise. That's a UI-shape question, deferred.
- **No progress-percentage/reporting layer** beyond the two rollup helpers already in `learningRecordService.js` (`getTaughtConcepts`, `getStudentUnderstandingSummary`, `getOpenHelpRequests`) — enough for this phase's review, not a full reporting API. More would be speculative before there's a UI asking for it.
- **No notification/alerting on help requests.** `getOpenHelpRequests()` is a pull-based query a future teacher dashboard would call; nothing pushes a help request anywhere yet.

---

## 9. File Reference

| File | Responsibility |
|---|---|
| `config/learningRecordConfig.js` | The three status enums + labels. No logic. |
| `models/LearningSubject.js` | Root of the syllabus tree. |
| `models/LearningUnit.js` | Middle tier. |
| `models/LearningConcept.js` | Leaf — classroom-level fields only (`id`, `title`, `status`). |
| `models/StudentConceptRecord.js` | Per-student fields (`understanding`, `notebook`, `helpRequested`, `updatedAt`) — the value shape stored in `Student.learningRecord[conceptId]`. |
| `models/Student.js` | +`learningRecord` field (existing file, documented in §5 of its own header comment). |
| `models/Classroom.js` | +`learningRecord` field (existing file, documented in its own header comment). |
| `services/learningRecordService.js` | Shared read-only queries. Read-only guarantee — never mutates, never saves. |
| `services/learningRecordTeacherService.js` | Every teacher-only mutation. |
| `services/learningRecordStudentService.js` | Every student-only mutation. |
