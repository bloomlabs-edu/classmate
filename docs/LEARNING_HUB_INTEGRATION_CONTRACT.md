# ClassMate ↔ Learning Hub Integration Contract

**Status: foundation only.** This document defines the ClassMate-side
data model, identifiers, and boundaries that a future integration with
Learning Hub and external activity providers (e.g. Kahoot) will build
on. As of this version, ClassMate does **not** connect to Learning Hub
live, does **not** call any Kahoot API, and does **not** expose any
network endpoint for receiving results. See `docs/UNIFIED_PLATFORM_ARCHITECTURE.md`
for how this relates to the existing Curriculum/Learning Hub domain
split (Concept as the shared join point).

---

## 1. Identity contract

Every identifier below is an **existing, already-stable ClassMate id**
— nothing new was introduced at the identity layer. None of them
depend on a display name, title, or any other text a teacher can
freely edit.

| Integration id | ClassMate source | Notes |
|---|---|---|
| `conceptId` | `LearningConcept.id` (`models/LearningConcept.js`) | UUID via `generateId()`. Unique within its classroom, exactly like `Unit.id`/`Subject.id`. |
| `studentId` | `Student.id` (`models/Student.js`) | UUID, generated once, never reassigned. Students have no top-level Firestore document of their own (nested in `Classroom.teams[].students[]`), but the app already keys subcollection documents by `studentId` elsewhere (`StudentEntry`, `MembershipLink`) — safe to use as a Result key the same way. |
| `classroomId` | `Classroom.id` (`models/Classroom.js`) | The literal Firestore document id at `classrooms/{classroomId}`. |
| `activityId` | `Activity.id` (`models/Activity.js`) | New model, same UUID convention. The Firestore document id at `classrooms/{classroomId}/activities/{activityId}`. |
| `assignmentId` | `LearningActivity.id` (`models/LearningActivity.js`) | Existing model, reused as-is — ClassMate's "Assignment" (a classroom's instance of asking its roster to do something). Unique within its classroom. |
| `resultId` | the pair `(assignmentId, studentId)` | No synthetic id was introduced — a Result is `student.submissions[assignmentId]`, addressed by that composite key, the same "map key is the identity" convention `StudentConceptRecord` already uses right next to it. |

`classroomId` scoping matters: `conceptId`/`assignmentId`/`activityId`
are unique **within** their classroom, not globally — a cross-system
reference should always carry `classroomId` alongside them.

---

## 2. Domain model

### Concept — unchanged
`models/LearningConcept.js`. No change made or needed. Its `id` is the
`conceptId` above.

### Activity — new
`models/Activity.js`, persisted at `classrooms/{classroomId}/activities/{activityId}`
(`repositories/activityRepository.js`). The reusable "what to do",
attached to exactly one Concept:

```
{
  id, conceptId,               // conceptId is required
  title, description,
  activityType,                // 'native' | 'learning_hub' | 'external'
  externalProvider,             // null, or e.g. 'kahoot' — only meaningful when activityType === 'external'
  destination,                  // opaque: a Learning Hub entry id, or an external URL. ClassMate never parses this.
  scoreMax,                     // null = unscored
  createdAt, updatedAt,
}
```

Why not extend `models/Resource.js` instead? A Resource is
deliberately many-to-many with Concepts and knows nothing about being
assigned or scored (see `docs/UNIFIED_PLATFORM_ARCHITECTURE.md`).
Activity is the opposite on both points — single Concept, scoring
config, exists specifically to be launched and to report a result.
Reusing Resource would blur that boundary; Activity mirrors Resource's
*persistence pattern* only, not its *relationship shape*.

### Assignment — existing `LearningActivity`, extended
`models/LearningActivity.js`. Two new, optional, backward-compatible
fields:

```
{
  id, title, type, dueDate, createdAt, pinnedToDashboard,  // unchanged
  activityId = null,   // NEW: points to an Activity definition. null = classic teacher-authored task.
  conceptId  = null,   // NEW: denormalized from the Activity, or settable directly with no Activity at all.
}
```

Lives inside `classroom.learningActivities[]`, exactly as before — no
`classroomId` field was added to the model itself, since that scope is
already contextual (the array it lives in).

### Result — existing `Student.submissions[activityId]`, extended
`services/learningActivityService.js`'s `setSubmissionStatus()`. Four
new, optional, backward-compatible fields:

```
{
  status, feedback, score, updatedAt,   // unchanged
  scoreMax    = null,        // NEW: pairs with score. null = unscored result.
  completedAt = null,        // NEW: distinct from updatedAt (set once on completion, not on every edit)
  source      = 'classmate', // NEW: 'classmate' | 'learning_hub' | 'external'
  conceptId   = null,        // NEW: resolved from the Assignment, never accepted directly from a caller
}
```

No existing call site needed to change — every new field defaults to
exactly today's behavior.

---

## 3. Activity types

| `activityType` | Meaning | `destination` |
|---|---|---|
| `native` | A plain ClassMate task, no external system involved (the default; every pre-existing `LearningActivity` is implicitly this). | `null` |
| `learning_hub` | The activity's content and interaction live in Learning Hub. | A Learning Hub entry identifier (mirrors the existing `resource.content.kind === 'learning_hub_experience'` pattern already used in `ui/views/ConceptWorkspaceView.js`, generalized here into a scoring-aware model). |
| `external` | The activity lives on a third-party provider. | A plain URL. |

`externalProvider` is a free-form string constrained only by
`config/activityTypeConfig.js`'s `EXTERNAL_PROVIDER_KEYS` — `'kahoot'`
is one entry in that list, never the foundational type. Adding a new
provider later is a config-list addition, not a structural change.

---

## 4. Result statuses and scoring semantics

ClassMate's existing status vocabulary is reused as-is
(`config/submissionStatuses.js`), not replaced with a new enum:

| Existing status | Abstract meaning |
|---|---|
| `Not Assigned` | assigned (default; no result recorded yet) |
| `Submitted` / `Submitted Late` / `Resubmitted` | completed |
| `Missing` | not_completed |

**Known gap**: there is no existing "started" status. This is flagged
here deliberately rather than papered over with an unused value — no
current UI has a "started but not finished" concept, so introducing
one now would be speculative.

Scoring is optional per-result, not per-activity-type: `score`/
`scoreMax` are both `null` for an unscored, "Completed / No score"
result, and both set for a scored one (`8 / 10`). `recordResult()`
(§6) rejects a `score` outside `[0, scoreMax]`.

---

## 5. Activity Launch Contract

`services/learningIntegrationService.js`'s `resolveActivityLaunch(classroom, assignmentId, studentId)`
returns:

```
{ assignmentId, activityId, activityType, destination, conceptId, studentId }
```

This function performs **no actual cross-app launch** (no
`window.open`, no redirect) — it only resolves the payload. A legacy/
native Assignment (no `activityId`) resolves to `activityType: 'native'`,
`destination: null`, the honest answer for a task with nothing outside
ClassMate to launch.

---

## 6. Result Contract and ownership

`services/learningIntegrationService.js`'s `recordResult(classroom, {assignmentId, studentId, status, score, scoreMax, completedAt, source, feedback})`
is the one function a future result would flow through. It validates,
against the classroom's own already-loaded data:

- the Assignment (`assignmentId`) actually exists in this classroom
- the student (`studentId`) is actually on this classroom's roster
- `status` is a known value
- if both `score` and `scoreMax` are given, `0 <= score <= scoreMax`

`conceptId` is never accepted from a caller — it is always resolved
from the Assignment itself, so a result can never claim a Concept its
own Assignment doesn't have.

**Ownership boundary:**

- **Learning Hub owns**: activity content, questions, student
  interaction, attempts, activity execution, calculation of the
  activity-specific score.
- **ClassMate owns**: classroom context, the Assignment relationship,
  student/classroom association, the Concept-level teacher record, the
  *received* result, teacher feedback, classroom performance views.

ClassMate stores the resulting score; it never reproduces Learning
Hub's own activity engine, and never reads or depends on Learning
Hub's internal Firestore structure. The relationship is always
`ClassMate ↔ this contract ↔ Learning Hub`, never
`ClassMate ↔ Learning Hub's own database`.

---

## 7. Security boundary

`recordResult()` is **not a network endpoint**. There is no HTTP route,
no client-side-URL-driven write path, anywhere in this codebase that
lets an external caller claim "Student X completed Assignment Y with
score Z." That absence of a network surface is the entire security
boundary for this phase.

For the eventual production integration, a real ingestion path must
additionally verify, before ever calling `recordResult()`:

- the caller's authenticated identity actually maps to `studentId`
- the request is authorized for `classroomId` (e.g. a Learning-Hub-
  issued, classroom/assignment-scoped signed token — not implemented)
- `assignmentId`/`activityId` were genuinely issued by ClassMate for
  that classroom, not guessed

`recordResult()`'s own validation (§6) is necessary but not
sufficient for that future boundary — it protects the data model's own
integrity once a call is made; it does not authenticate who is
calling.

---

## 8. Concept Profile

`ui/views/ConceptWorkspaceView.js` gained one new tab, **Activities**,
listing this Concept's Assignments with their type/points/roster
status tally — read-only, no new authoring flow, reusing the existing
tab-bar and row/tag styling verbatim (no visual redesign).

---

## 9. Migration / backward compatibility

Every field this contract adds is optional with a safe default.
Existing `LearningActivity` documents and `submissions` entries need no
migration — a document written before this contract simply reads as
`activityId: undefined`/`conceptId: undefined`/etc., which every reader
here treats identically to `null`.
