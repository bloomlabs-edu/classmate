# ClassMate ↔ Learning Hub Integration Architecture (ADR)

**Status:** proposed / architecture-only. No code, schema, or Firestore
rule changes have been made as part of this document. See
`docs/LEARNING_HUB_INTEGRATION_CONTRACT.md` for the existing, separate
Activity-launch/Result contract (already defined) and
`docs/UNIFIED_PLATFORM_ARCHITECTURE.md` for the existing Concept/
Resource domain split this builds on. This document does not replace
either — it is the cross-product layer both of those already point
toward but that has never been written down.

---

# Context

ClassMate (`classmate-302c2`) and Learning Hub (`learning-hub-b2586`)
are two separate Firebase projects with separate Auth tenancies.
ClassMate students authenticate via a per-device-slot anonymous
Firebase Auth identity (`studentSlot0/1/2`, see
`services/studentAuthService.js`) plus a self-attested, unverified
roster `Student.id` stored in `localStorage`. Learning Hub users
authenticate exclusively via Google Sign-In into `users/{uid}`
(`app/auth.js`, `app/repository/user-service.js`) — there is no
separate Learner entity, and no path by which a ClassMate identity
could become a Learning Hub `uid` today.

ClassMate's classroom-facing data (Feed, Notebooks, Goals, Concept
records, Resources, Activities) is modeled as either fields embedded
in one `classrooms/{classroomId}` document or dedicated subcollections
under it (`firestore.rules`). Learning Hub's content-facing data
(`concepts`, `resources`, `conceptFamilies`, per-user `conceptState`/
`learningChecks`) lives in its own top-level collections, entirely
independent of any classroom concept (`app/repository/concept-service.js`,
`resource-service.js`, `learning-check-service.js`).

**Direct Firestore sharing is not the desired architecture** for three
independent reasons, not one: (1) the two Firebase projects have no
cross-project read/write path without a bridge; (2) even if they were
merged, ClassMate's classroom-embedded documents have no per-student
security scoping that would be safe to expose broadly (see Notebooks,
below); (3) merging identity/data models would collapse two
deliberately different ownership boundaries — classroom context
(ClassMate) vs. learning content and evidence (Learning Hub) — into
one, which neither product's current architecture assumes and which
the decisions below explicitly reject.

---

# Decisions

The following are treated as settled for this document, not reopened:

1. Do not merge the two Firebase projects.
2. ClassMate and Learning Hub remain separate systems with separate
   data ownership.
3. Concept is the intended cross-product semantic join.
4. ClassMate remains the owner of classroom context.
5. Learning Hub remains the owner of learning content and learning
   evidence.
6. No ClassMate-student ↔ Learning-Hub-uid identity mapping yet.
7. No attribution of Learning Hub Learning Checks to named ClassMate
   students yet.
8. No synchronization between ClassMate `StudentConceptRecord.understanding`
   and Learning Hub understanding yet.
9. No aggregate/weighted understanding statistics yet.
10. No exposure of ClassMate Notebooks to Learning Hub yet.
11. No second Feed data store — Feed, when it eventually crosses the
    boundary, uses the existing ClassMate `feedPosts` model through the
    integration bridge, never a Learning-Hub-local copy.
12. `classroomContext` is defined conceptually
    (`{classroomId, teachingSlotId, lessonId}`) but not wired into
    production yet.
13. `LearningConcept.learningHubConcept` remains an optional, curated
    mapping — never automatically generated or inferred from titles.
14. One canonical ClassMate → Learning Hub resource attachment
    mechanism must be established before extending resource sharing
    across the product boundary (see Investigation, below).

---

# Investigation — current teacher resource-attachment workflow

Four structurally different Concept ↔ Learning Hub attachment
mechanisms exist in ClassMate today. All code references below were
verified directly against the current working tree, following actual
callers rather than inferring usage from a model or service's mere
existence.

## Mechanism 1 — `LearningUnit.learningHubPack`

- **UI:** `ui/views/LearningManagementView.js`'s Unit detail panel,
  `renderUnitPackControl()` (`:1070-1120`), mounted at `:1352`. Shows
  "+ Associate Learning Hub Pack" when unset, or the current Pack's
  title with Change/Remove.
- **Workflow it invokes:** teacher opens a Unit → clicks Associate →
  `fetchLearningHubPacks()` loads Learning Hub's static `packs.json` →
  teacher picks a Pack → `onSetUnitLearningHubPack(unit, pack)`
  (`:405`) sets `unit.learningHubPack = { packId, title }`.
- **Owning service:** none — a direct model mutation from the view's
  own handler, saved via `workspaceService.save()`.
- **Persisted fields:** `LearningUnit.learningHubPack: {packId, title}`,
  embedded in `classroom.learningRecord.subjects[].units[]`
  (`models/LearningUnit.js:63,86-88`).
- **Reachable from live teacher UI:** yes.
- **Purpose:** (b) unit-level Pack attachment only — a whole Unit is
  labeled with a curated Learning Hub Pack. No resource content, no
  Concept-level granularity; it never flows any actual resource into
  the app.
- **Test coverage:** none — no `tests/models/LearningUnit.test.js`
  exists at all.
- **Live or dead:** live but shallow. A real, working reference-only
  label with no downstream consumer beyond its own display.

## Mechanism 2 — `ConceptResourceLink` + `Resource.content.kind === 'learning_hub_experience'`

- **UI — two independent, mirrored entry points:**
  - `ui/views/LearningManagementView.js`: "Link Learning Hub" panel
    (`onOpenLearningHubPanel` `:521`, `onPickLearningHubExperience`
    `:533`, `onUseLearningHubResourceForConcept` `:551-586`), reachable
    from a Unit that has exactly one Concept.
  - `ui/views/ConceptWorkspaceView.js`: the Concept workspace's own
    "Add Resource → Learning Hub Experience" flow
    (`onChooseLearningHubExperience` `:275`, `onCreateLearningHubResource`
    `:305-329`) — verified, by direct read, to build the byte-for-byte
    identical `Resource`/`content` shape as mechanism 2's other entry
    point (both comments explicitly say "mirrors... exactly, not a
    second implementation").
- **Workflow it invokes:** teacher opens a Unit or Concept → picks a
  Learning Hub catalogue experience (`fetchLearningHubCatalogue()`,
  static `catalogue.json`/`packs.json`) → a real `Resource` document is
  created via `resourceService.createResourceOnConcept()`
  (`services/resourceService.js:138-146`) → its `content` is then set
  to `{ kind: 'learning_hub_experience', experienceType, experienceId }`
  and `audience` set → a `ConceptResourceLink` is pushed onto
  `concept.resourceLinks[]`.
- **Owning service:** `services/resourceService.js` (`createResourceOnConcept`)
  + `services/resourceRepository.js` (`saveResource`).
- **Persisted fields:** `Resource` document at
  `classrooms/{classroomId}/resources/{resourceId}` — `{id, title,
  type, content: {kind:'learning_hub_experience', experienceType,
  experienceId}, audience, status, createdAt, updatedAt}` — plus
  `ConceptResourceLink {id, resourceId, resourceType, addedAt, addedBy}`
  embedded in `concept.resourceLinks[]`.
- **Reachable from live teacher UI:** yes, from both entry points.
- **Purpose:** (a) concept-level resource attachment — this is the
  mechanism that actually attaches a specific Learning Hub experience
  to a specific Concept, in the same place and the same shape as any
  other Resource (reading, worksheet, external link) on that Concept.
- **Test coverage:** `tests/models/Resource.test.js` exists but does
  not test the `learning_hub_experience` content shape specifically
  (verified: no match for `learning_hub|learningHub` in that file).
  There is no `tests/services/resourceService.test.js` at all — the
  function that actually performs this attachment, `createResourceOnConcept()`,
  has zero dedicated unit tests.
- **Live or dead:** live, and the only mechanism with two independent
  real entry points into the same code path — the strongest signal
  that this, not any of the other three, is what a teacher actually
  uses today to put a Learning Hub experience "on a Concept."
- **A third call site exists but is dead:** `ui/views/LessonStudioView.js:174`
  calls `resourceService.createResourceOnConcept(selectedConcept, {...})`
  with the wrong signature (missing `classroomId`, not awaited) — this
  is a stale/broken call. `renderLessonStudioView` itself is never
  imported anywhere in the app (verified by grep); it is unreachable,
  dead code, not part of the live workflow.

## Mechanism 3 — `Activity.destination` (`activityType: 'learning_hub'`)

- **UI:** `ui/views/TimetableView.js`'s Period Detail Panel, "Student
  Resources" mode only (`mode === 'student'`, `:2630-2653`) — a "Link
  Learning Hub concept card" button, distinct from the panel's
  ordinary "+ Add resource" form beneath it.
- **Workflow it invokes:** teacher opens a timetable period → Student
  Resources → Link Learning Hub concept card → `renderLearningHubPicker()`
  (`:2738-2824`) loads the same static catalogue → picking an
  experience calls `learningIntegrationService.createActivity()`
  (`:2804-2810`) with `activityType: 'learning_hub'`,
  `destination: "<experienceType>:<experienceId>"` → then
  `assignActivityToClassroom()` creates a roster-wide `LearningActivity`
  assignment.
- **Owning service:** `services/learningIntegrationService.js`
  (`createActivity`, `assignActivityToClassroom`), per
  `docs/LEARNING_HUB_INTEGRATION_CONTRACT.md` — an existing, separate,
  already-documented contract for **assignable, scoreable** classwork,
  not for concept-resource browsing.
- **Persisted fields:** `Activity` document at
  `classrooms/{classroomId}/activities/{activityId}` (`conceptId,
  title, description, activityType, destination, scoreMax`) +
  `LearningActivity` assignment embedded in `classroom.learningActivities[]`.
- **Reachable from live teacher UI:** yes.
- **Purpose:** (c) activity launch — this is deliberately a different
  concern from resource attachment: an Activity is single-Concept,
  scoreable, and exists specifically to be assigned to the roster and
  to report a Result (`docs/LEARNING_HUB_INTEGRATION_CONTRACT.md §2`
  explicitly explains why this is not built on `Resource`).
- **Test coverage:** `tests/models/Activity.test.js:34-43` explicitly
  covers a `learning_hub` activity's opaque `destination` —
  the best-tested of the three live mechanisms for its own narrow
  purpose. `tests/services/learningActivityService.test.js` covers
  assignment.
- **Live or dead:** live, well-scoped, and already governed by its own
  contract document. Not a competitor to mechanism 2 — it solves a
  genuinely different problem (assignment + scoring vs. resource
  availability).

## Mechanism 4 — `LearningConcept.learningHubConcept`

- **UI:** none. Verified by repo-wide grep: appears only in
  `models/LearningConcept.js` (the field definition) and in
  `tests/models/LearningConcept.test.js` /
  `tests/services/learningRecordTeacherService.test.js` (mutation-
  preservation tests only — they confirm the field survives unrelated
  edits, not that anything reads or writes it in a real flow).
- **Workflow it invokes:** none exists.
- **Purpose:** (d) dormant/future integration only — this is the
  Concept **identity** join (this Concept ↔ Learning Hub's
  `concepts/{conceptId}`), not a resource-attachment mechanism at all.
  It answers "which Learning Hub Concept is this," never "what
  resources does this Concept have."
- **Test coverage:** identity/model-shape tests only, as above.
- **Live or dead:** 100% dead code today — by design, per its own
  doc comment ("purely additive... nothing reads this field yet").

## Corresponding Learning Hub resource flow (verified against `learning-hub`)

- `resources/{id}` is Learning Hub's **only** generic resource
  abstraction: `{conceptIds[], type, contentKind, contentData, authorId,
  status, visibility, ...}` (`app/repository/resource-service.js`).
  `contentKind` is `lesson-data` (pointer into static content),
  `storage` (unviewable file), or `structured-json` (inline teacher
  content) — there is no fourth kind for "a pointer to a ClassMate
  Resource," and no field anticipating external/ClassMate-originated
  content at all (no `source`/`origin`/`externalId`/`provider`).
- The Concept Bucket (`repository-ui.js`'s `repoConceptBucketHtml()`)
  already merges built-in and teacher-authored resources into one
  list, keyed only by `conceptIds array-contains conceptId` — a single,
  real insertion point that a canonical ClassMate mechanism could
  eventually target.
- `catalogue.json`/`packs.json` (what mechanisms 2 and 3's pickers both
  read today) are a **completely separate, disjoint static system**
  with no `conceptId` field at all on any row (confirmed on both
  sides) — meaning even today's "canonical" mechanism 2 attaches
  experiences that Learning Hub's own Concept Bucket does not yet
  associate with any `RepositoryConcept`. This is a real, pre-existing
  gap, not something this integration introduces.

---

# Deliverable 1 — Canonical resource mechanism comparison

| Mechanism | Current UI usage | Current purpose | Persistence | Strengths | Problems | Migration cost | Recommendation |
|---|---|---|---|---|---|---|---|
| 1. `LearningUnit.learningHubPack` | Unit detail panel (`LearningManagementView.js`) | Unit-level Pack label | Embedded in classroom doc | Simple, already live | Wrong grain (Unit, not Concept); carries no resource content; no test coverage | Low — nothing depends on it | Leave as-is, ClassMate-only, not canonical |
| 2. `ConceptResourceLink` + `Resource.content.kind='learning_hub_experience'` | Two independent live entry points (Unit view + Concept workspace) | Concept-level resource attachment | `Resource` doc (`classrooms/{id}/resources`) + embedded link | Concept-scoped (correct join axis); structurally closest to LH's own `resources/{id}` pointer model; already the one teachers reach two different ways | No test coverage on `resourceService.js` or the LH content shape; catalogue picker has no `conceptId`, so it's blind to LH's own Concept graph | Moderate — needs a `contentKind`-style extension on the LH side and a real catalogue↔concept association, but no ClassMate schema change | **Canonical** |
| 3. `Activity.destination` (`activityType:'learning_hub'`) | Timetable period panel, Student Resources mode | Assignable, scoreable classwork launch | `Activity` doc + `LearningActivity` assignment | Well-scoped, already has its own contract doc, best unit-test coverage | Solves a different problem (assignment/scoring), not resource browsing; would duplicate mechanism 2 if extended for that purpose | N/A — not being changed | Retain for its existing purpose; do not extend into resource attachment |
| 4. `LearningConcept.learningHubConcept` | None | Concept identity mapping (not a resource mechanism) | Field on `LearningConcept` | Clean, additive, already the intended Concept join | Currently unpopulated/unused anywhere | None — nothing to migrate | Retain as the identity join Concept-2 rides on top of |

## Recommendation

**Mechanism 2 — `ConceptResourceLink` + `Resource.content.kind='learning_hub_experience'` — becomes the canonical Concept → Resource attachment path.**

It is concept-scoped (matching the locked decision that Concept is the
primary semantic join), it is already the mechanism a teacher reaches
from two separate, real workflows today, and its persistence shape (a
`Resource` document carrying a `content` discriminator) is structurally
the closest existing ClassMate analog to Learning Hub's own
`resources/{id}` document (`contentKind`/`contentData`). Extending it
to eventually carry a pointer at a Learning Hub `resources/{id}` (or,
in the other direction, to let a ClassMate-authored Resource become
visible inside a Learning Hub Concept Bucket) requires generalizing
one existing content shape, not inventing a new attachment concept.

**Disposition of the other three:**

- **Mechanism 1 (`learningHubPack`):** leave ClassMate-only. It
  operates at the wrong grain (Unit, not Concept) for the canonical
  path; do not extend it to carry resource content. May be repurposed
  later as a purely presentational "recommended Pack for this Unit"
  hint, never as a data path.
- **Mechanism 3 (`Activity.destination`):** retain exactly as-is,
  governed by its own existing contract
  (`docs/LEARNING_HUB_INTEGRATION_CONTRACT.md`). It solves assignment
  and scoring, a genuinely different problem from "does this Concept
  have a resource available." Do not merge it into mechanism 2. A
  future, separate decision could let an `Activity` reference a
  canonical Resource rather than re-encoding its own catalogue string,
  but that is out of scope here and not required for the Concept
  Bucket flow this ADR addresses.
- **Mechanism 4 (`learningHubConcept`):** retain and continue curating
  as the Concept identity join — complementary to, never competing
  with, mechanism 2. Mechanism 2 attaches resources to a ClassMate
  Concept; mechanism 4 says which Learning Hub Concept that ClassMate
  Concept corresponds to. Both are needed; neither replaces the other.

---

# System boundaries

**ClassMate owns:** classroom, students/classroom membership,
timetable/periods, Weekly Plans, Detailed Lesson Plans, classroom
Concepts (`LearningConcept`, local id), Activities (assignment/scoring
launch contract), classroom Feed, classroom-specific experience and
context.

**Learning Hub owns:** global Concepts (`RepositoryConcept`), Concept
Buckets, learning resources/experiences (`resources/{id}`), Learning
Checks, learning evidence/understanding (`conceptState`,
`currentLevel`, learning history).

Neither product reads the other's Firestore project directly. All
cross-product access goes through the integration/API boundary defined
below.

---

# Canonical Concept join

```
ClassMate LearningConcept
        │
        │ learningHubConcept  { conceptId, title }
        ↓
Learning Hub concepts/{conceptId}  (RepositoryConcept)
```

`LearningConcept.id` remains the ClassMate-local identity; it is never
replaced or reinterpreted. `learningHubConcept.conceptId` is a one-hop,
opaque reference — never parsed, normalized, or derived from a title.
`learningHubConcept.title` is a cached display value only, never used
for identity resolution. The mapping is **curated, optional, and
one-directional**: a teacher or administrator deliberately sets it for
a specific concept; it is never auto-generated by title-matching, and
Learning Hub holds no reverse reference back to ClassMate. A concept
with no mapping simply has no Learning Hub connection yet — this is
the expected default, not an error state.

---

# Canonical Resource path

```
Teacher
  → ClassMate UI (Concept workspace's "Add Resource → Learning Hub
    Experience", or the Unit-level Learning Hub panel — mechanism 2)
  → ClassMate model (Resource { content: { kind: 'learning_hub_experience',
    experienceType, experienceId } } + ConceptResourceLink on the
    LearningConcept that already carries learningHubConcept)
  → integration boundary (read/publish call, not implemented yet)
  → Learning Hub resource (resources/{id}, conceptIds
    includes the mapped RepositoryConcept id)
  → Concept Bucket (repoConceptBucketHtml() renders it alongside
    built-in and teacher-authored resources, same list, same card)
```

The teacher-facing step does not change from what exists today; what
is missing is only the integration-boundary hop that would let a
ClassMate Resource of this shape actually surface inside the
corresponding Learning Hub Concept Bucket, rather than remaining a
ClassMate-only bookmark of an experience id.

---

# Integration/API boundary

The smallest sensible boundary is a single, small, intentional service
— not a generic CRUD layer, and not one bridge per feature.

- **Who initiates:** ClassMate initiates publish-style calls (a
  teacher attaches/updates/removes a Learning-Hub-facing Resource on a
  mapped Concept). Learning Hub initiates read-style calls only when a
  student opens a Concept Bucket for a Concept that has ClassMate-
  originated resources — it asks "what does ClassMate have for this
  mapped concept," it does not push.
- **What crosses the boundary today (conceptually, not implemented):**
  `classroomId`, `conceptId` (ClassMate-local), the mapped
  `learningHubConcept.conceptId`, and the Resource's own
  publishable fields (title, type, a launchable reference — never
  full embedded content blocks). Nothing about a specific student
  crosses in either direction under this ADR.
- **Read vs. writable:** ClassMate → Learning Hub is the only writable
  direction, and only for Resource publication tied to a curated
  Concept mapping. Learning Hub → ClassMate is read-only for the
  foreseeable future (see Learning evidence section — no Learning
  Check data flows back yet).
- **Authentication:** each product authenticates the integration call
  using its own existing identity — a ClassMate teacher's already-
  authenticated session on the ClassMate side; a Learning-Hub-issued,
  classroom/concept-scoped credential on the Learning Hub side. No
  student-level identity crosses this boundary under this ADR (see
  Identity, below).
- **Authorization:** a publish call must be authorized for the
  specific `classroomId` it names; a read call must be scoped to
  concepts that actually carry a curated `learningHubConcept` mapping
  — an unmapped Concept has nothing to read.
- **What must NOT cross the boundary:** any student identity, roster
  data, Feed content beyond the eventual, explicitly-scoped Feed read
  (Decision 11), Notebooks (Decision 10), StudentConceptRecord
  understanding (Decision 8), or any content large enough to duplicate
  ownership of a Resource's actual body — the boundary carries
  references and small publishable metadata, never a second copy of a
  resource's full content.

---

# classroomContext

```
{
  classroomId,
  teachingSlotId,
  lessonId
}
```

This is the minimal shape ClassMate would eventually attach to a
learning event so Learning Hub could, later, understand *which*
classroom moment produced it — which period, which lesson. It belongs
conceptually as metadata ClassMate supplies alongside a future
cross-product event (e.g. a launch or a returned evidence record), not
as a stored, synchronized domain object of its own. It should not yet
become a broad shared domain model because nothing on either side
currently consumes it — defining its shape now, without wiring it
anywhere, avoids inventing three different ad hoc "which lesson was
this" shapes later, without pretending there's an integration to
attach it to today.

---

# Identity

Identity mapping between a ClassMate student and a Learning Hub `uid`
is explicitly **deferred**, per Decision 6. This document does not
design around, and does not propose, ClassMate's anonymous per-device-
slot Firebase UID becoming a Learning Hub user identity — that UID
represents a device slot, not a durable person, and using it this way
would misrepresent what it actually is. Nor does this document propose
the roster `Student.id` for the same purpose — it is self-attested and
unverified. Any future identity bridge is a separate, governance-gated
decision (see the prior identity-feasibility audit), not something
this integration architecture resolves or works around.

---

# Learning evidence / understanding

Learning Hub owns Learning Check evidence today and is expected to
remain the source of truth for learner understanding
(`conceptState`/`currentLevel`/learning history). ClassMate may, in a
later phase, consume a contextualized, classroom-facing projection of
that evidence (e.g. aggregate counts per Concept, never a per-student
record, per Decisions 7-9). **No synchronization is implemented now.**
This document defines only the direction the future connection would
take, not its mechanism, aggregation logic, or weighting — those remain
explicitly out of scope per the prior audit's instructions.

---

# Feed

ClassMate remains the sole owner of `feedPosts`
(`classrooms/{classroomId}/feedPosts`). No second Feed collection is
created in Learning Hub. When Feed eventually becomes visible from a
Learning-Hub-connected context, it is via the integration bridge
reading the same ClassMate documents — never a Learning-Hub-local
mirror or copy. This is a direction, not a current capability: today
no bridge exists, and Learning Hub cannot reach `feedPosts` in any
form.

---

# Notebooks

Notebooks remain ClassMate-only for now. The current implementation
embeds all notebook data (`notebooks`, `notebookConfig`,
`notebookChecks`) directly in the classroom document with no per-
student server-side scoping at all — access is presently gated only by
client-side filtering. Exposing Notebooks across the product boundary
before that scoping exists would widen an already-loose surface rather
than sharing a well-bounded one; this is a prerequisite that has
nothing to do with Learning Hub and should be solved on the ClassMate
side first, independent of this integration.

---

# Deferred work

Explicitly out of scope for this architecture and not designed here:

- Identity mapping (ClassMate student ↔ Learning Hub uid)
- Per-student Learning Check attribution
- Understanding synchronization
- Aggregate/weighted understanding statistics
- Notebook projection into Learning Hub
- Real-time synchronization of any kind
- Firebase project merge
- Generalized bidirectional resource authoring (Learning Hub authoring
  directly into ClassMate, or vice versa, beyond the one-directional
  publish path above)

---

# Migration strategy

No migration is performed as part of this document. Existing data
under all four mechanisms is preserved exactly as-is:

- Mechanism 1 (`learningHubPack`) and mechanism 4 (`learningHubConcept`)
  need no change — neither is being altered or deprecated.
- Mechanism 2's existing `Resource` documents (`content.kind ===
  'learning_hub_experience'`) already have the shape the canonical path
  builds on; becoming "canonical" means new integration-boundary code
  will read this existing shape, not that existing documents need
  rewriting.
- Mechanism 3 (`Activity.destination`) is untouched; it continues to
  operate under its own existing contract.

When implementation eventually begins, the recommended approach is
additive: extend `Resource.content` (or add a sibling field) to carry
whatever the integration boundary needs to publish a resource, with
every new field optional and defaulting to today's exact behavior —
the same "purely additive, safe default" convention already used for
`learningHubConcept` and every field in
`docs/LEARNING_HUB_INTEGRATION_CONTRACT.md`. No existing Resource,
Activity, or LearningUnit document requires a backfill.

---

# Risks

- **Duplicate resource representations:** ClassMate already has four
  Concept↔Learning-Hub attachment shapes, and Learning Hub itself has
  three disjoint content systems (`resources`/Concept Bucket,
  `catalogue.json`/`packs.json`, and a second localStorage-only
  teacher-Pack builder). Extending across the boundary without first
  narrowing to one canonical mechanism per side compounds this rather
  than resolving it.
- **Concept ID mismatch:** `learningHubConcept` is curated, not
  verified against Learning Hub's actual `concepts/{conceptId}` at
  entry time in this proposal. A stale or mistyped `conceptId` would
  silently fail to surface anything, with no current mechanism to
  detect that.
- **Identity mismatch:** any premature attempt to bridge ClassMate and
  Learning Hub identities before governance approval risks
  misattributing learning evidence to the wrong person, or exposing
  data on an unverified assumption of which anonymous device slot maps
  to which real student.
- **Authorization across Firebase projects:** the two projects have no
  shared Auth tenancy; every integration call must be authorized on
  its own terms rather than assuming a token from one project means
  anything to the other.
- **Stale cached concept titles:** `learningHubConcept.title` is a
  display cache; if the Learning Hub concept is later renamed, nothing
  currently refreshes ClassMate's cached copy, and this document does
  not introduce a refresh mechanism.
- **Legacy attachment mechanisms:** mechanisms 1 and 3 remain live and
  unrelated to the canonical path; a future contributor unfamiliar with
  this ADR could reasonably reach for the wrong one absent this
  document.
- **Security boundary:** the integration boundary, once built, becomes
  a new attack surface between two products with different trust
  models; per `docs/LEARNING_HUB_INTEGRATION_CONTRACT.md §7`, no
  network endpoint or ingestion path exists yet, and building one
  requires its own authentication/authorization design, not assumed
  here.

---

# Future sequence

1. Curate a small pilot set of `LearningConcept.learningHubConcept`
   mappings (a handful of concepts, deliberately chosen, not bulk).
2. Confirm mechanism 2 as the canonical Concept → Resource path in
   practice — no code change required beyond documentation, since it
   is already live; this step is about intent, not new engineering.
3. Build the minimal ClassMate ↔ Learning Hub integration boundary
   (the one-directional publish call described above), scoped only to
   the pilot concepts.
4. Make Concept Bucket access work end-to-end for the pilot: a
   ClassMate-attached resource on a mapped Concept becomes visible in
   that Concept's Learning Hub Concept Bucket.
5. Solve identity/governance later, as its own gated decision — not a
   prerequisite for steps 1-4, which are deliberately identity-free.
6. Connect Learning Check evidence back to ClassMate later, once
   identity is resolved, as a read-only, contextualized projection.
7. Consider ClassMate-side projections/statistics only after step 6,
   and only as aggregate, never per-student, per the existing
   deferral on weighting/aggregation design.

This sequence matches the one suggested in the request; the
investigation did not surface a reason to reorder it, only to make
step 2 explicit as "confirm," not "build," since the canonical
mechanism already exists and is already live.

---

# Unresolved architectural questions

- **Learning Hub's `resources/{id}.authorId` is hard-bound to a
  Console-role-gated Firebase Auth uid inside `learning-hub-b2586`.**
  The integration boundary's publish call will need to write (or
  cause to be written) a Learning Hub resource attributed to *some*
  author identity, since no code path in Learning Hub creates a
  resource without one. Whether that becomes a dedicated service-
  account/system-author identity, or something else, cannot be
  answered by reading either codebase as it exists today — it requires
  a decision Learning Hub's own maintainers would need to make.
- **The catalogue/pack pickers used by mechanisms 2 and 3 read static
  `catalogue.json`/`packs.json` rows that carry no `conceptId` at all.**
  Whether the canonical path should stop reading that disjoint static
  system altogether (and instead only ever attach resources that are
  already properly `conceptIds`-linked inside Learning Hub's real
  `resources` collection) is a product question, not something this
  audit can settle from code alone.
- **How a ClassMate-originated resource should be represented inside
  Learning Hub's `contentKind` enum** (`lesson-data` / `storage` /
  `structured-json`) — whether it needs a fourth kind, or fits one of
  the existing three — is a Learning Hub-side design decision this
  document intentionally leaves open, since deciding it unilaterally
  from the ClassMate side would risk exactly the kind of premature,
  ClassMate-authored assumption about Learning Hub's own model this
  audit was asked not to make.
