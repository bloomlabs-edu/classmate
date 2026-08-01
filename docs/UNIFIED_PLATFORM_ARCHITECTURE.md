# Unified Platform Architecture — Concept as the Shared Join Point

This document has been referenced by name from `models/LearningConcept.js`, `models/Resource.js`, `models/ConceptResourceLink.js`, `services/resourceService.js`, `services/resourceRepository.js`, and `ui/views/ConceptWorkspaceView.js` since before it existed. It exists now to hold the reasoning those files have been pointing to.

---

## 1. The Core Idea

`docs/LEARNING_RECORD.md` describes Learning Record's own Milestone 3 Phase 1 — built deliberately independent of Learning Hub, because Learning Hub didn't exist yet: "If Learning Hub is built later, it should depend on this module's services... not the other way around."

Learning Hub was built later. Rather than growing a second, parallel `Subject -> Unit -> Concept`-shaped tree of its own — one tree for "what's been taught," a different tree for "what materials exist" — Learning Hub attaches to the *same* Concept Learning Record already defines. The Concept is the one shared join point every concept-attached system hangs off: Learning Record's own taught/not-taught status, Resources (this document's main subject), and whatever comes after (a future AI tutor, classroom-specific overrides, analytics). Nothing should bypass the Concept to build a parallel tree of its own.

This is why `models/LearningConcept.js` lives where it does and why `services/resourceService.js` is its own file rather than folded into `learningRecordTeacherService.js`: two systems attaching to one shared entity, not one system owning the other.

---

## 2. Curriculum and Learning Hub Are Two Domains, Not One

**Curriculum answers "what should be taught."** The `Subject -> Unit -> Concept` tree, syllabus structure, taught status — see `docs/LEARNING_RECORD.md`.

**Learning Hub answers "how it should be taught."** Reusable teaching resources — a reading, a worksheet, a quiz, a video, and so on — see `models/Resource.js`, `services/resourceRepository.js`, `config/resourceTypeConfig.js`.

A Resource has no knowledge that Concepts exist. It's fully valid and usable with zero Concepts referencing it, and the same Resource can be linked from any number of Concepts at once — a Force concept and a Gravity concept can both point at the same Worksheet, with no duplication. Learning Hub is the single source of truth for a resource's own content; Curriculum only ever holds a lightweight reference to it.

This was not the original design. Before this redesign, `models/Resource.js` stated plainly: "A Resource belongs to exactly one Concept." Resources were embedded directly in `LearningConcept.resources[]` — full objects, not references — which made reuse across concepts architecturally impossible, not merely unbuilt. That field is now `LearningConcept.resourceLinks[]` (see §3), and the Resource model itself no longer knows what a Concept is.

---

## 3. Why `ConceptResourceLink` Is Part of the Concept Aggregate, Not Its Own Collection

This was evaluated explicitly using Domain-Driven Design reasoning, not decided by default toward "more scalable":

- **Does a link have independent identity or lifecycle?** No. A `ConceptResourceLink` has no meaning without both a specific Concept and a specific Resource — nobody ever looks one up on its own terms. Deleting a Concept deletes its links; the Resources those links pointed to are untouched, since they're only ever removed through their own, independent lifecycle. A child whose entire lifecycle cascades with its parent's is the textbook signature of being *part of* that parent's aggregate, not a peer aggregate root.
- **Does it have enough behavior to earn root status?** No. It holds `resourceId`, `resourceType`, `addedAt`, `addedBy` — pure descriptive metadata, no state machine, no invariants of its own. Contrast with Resource, which has a real status lifecycle (draft/published/archived) and genuine reuse across concepts — Resource earns independent-aggregate status; the link connecting them doesn't.
- **Would embedding cause real scale problems?** No — and this corrected an earlier, wrong instinct in this same redesign discussion, which initially leaned toward a separate `ConceptResourceLink` collection on Firestore-document-growth grounds. That growth risk lives entirely in *Resource content* (a Reading's blocks, a future Worksheet's own shape), which already moved to its own subcollection regardless (§4). What's left inside a Concept per link — a handful of small fields, realistically a few per concept — is genuinely trivial.

So: `ConceptResourceLink` is `Concept.resourceLinks[]`, ordinary aggregate-internal data, the same "array position is order" convention this app already uses for `LearningUnit.concepts` and `LearningSubject.units`. `Resource` is the one genuinely independent aggregate this redesign produced.

---

## 4. Persistence

Every classroom is one shared Firestore document (`classrooms/{classroomId}`, see `services/workspaceService.js`) — subject to Firestore's 1MB document limit. Resource content (a Reading's `blocks`, future Worksheet/Quiz content) is exactly the kind of unbounded growth that document shouldn't have to absorb, and a single resource edit shouldn't require rewriting the whole document.

Resources live in their own subcollection, `classrooms/{classroomId}/resources/{resourceId}` (see `services/resourceRepository.js`) — not a top-level `resources` collection. This mirrors the pattern `services/plannerRepository.js` already established for Lessons (`classrooms/{classroomId}/lessons/{lessonId}`), for the same reason stated there: scoping under `classrooms/{classroomId}` keeps the existing "membership of this classroom document controls access" security-rule shape, rather than introducing a parallel one for a top-level collection.

Resource access is a plain, explicit async fetch (`resourceRepository.getResourcesForClassroom()`), not a live-synced cache — per explicit product direction, favoring simple and explicit over cached and synchronized until an actual need for the latter appears. `resourceService.js`'s public functions are `async` accordingly (create/read/rename/status/delete all touch a real Firestore document); reordering (`moveResourceUp`/`moveResourceDown`) stays synchronous, since it only touches `Concept.resourceLinks`' array position — part of the classroom document itself, with no Resource document access at all.

---

## 5. Migration

No classroom-wide `schemaVersion` was introduced for this — a data extraction from an embedded array into a subcollection didn't justify classroom-wide schema versioning, per explicit product decision. Migration is lazy and explicit instead: `resourceService.migrateConceptResourceLinksIfNeeded(classroomId, concept)` is a Learning Hub concern, called by Learning Hub's own UI code at the one point it actually matters — right before a Concept's resources are first read in a session. It's idempotent (a concept with no legacy `resources[]` field is a clean no-op) and mutates the concept in place, returning whether anything changed so the caller knows whether a classroom save is actually needed. Nothing in `services/workspaceService.js` or `services/classroomService.js` needs to know Resources exist at all.

---

## 6. What's Still Ahead

Phase 1 (this document's own scope) is domain and persistence only — Resource's own collection, `ConceptResourceLink`, the migration, and the minimal `ui/views/ConceptWorkspaceView.js` changes needed to keep existing operations working. Later phases (not yet built): the real teacher linking experience (Link Existing / Create New / auto-link), a reusable Learning Hub browser (search by title/type/subject/grade/tags), and broken-link handling in the UI (a link whose Resource no longer resolves is already handled gracefully at the service layer — silently skipped, never a crash — but has no "⚠ Resource unavailable" UI treatment yet).

One open note for whoever picks this up next: `ui/views/ConceptWorkspaceView.js` is not currently reachable from anywhere in the app's real navigation, despite its own header comment describing it as "the permanent home for every concept-related feature." This predates this redesign and isn't something this work introduced, but it means none of the above is actually visible to a teacher yet — wiring an entry point to it is a prerequisite for any of this being used, not just tested.
