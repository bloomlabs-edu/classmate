# ClassMate — Curriculum Pipeline Architecture

**Status:** Finalized reference architecture for the Curriculum Index → Concept Builder pipeline.

This document records settled decisions, not options under consideration. If a future change requires departing from what's written here, **update this document first**, as its own change, before writing the code that depends on the new decision. Do not reopen a settled question below unless implementation has revealed a genuine, concrete limitation — "it might be cleaner another way" is not sufficient grounds on its own.

---

## 1. Scope

This document covers the Curriculum Index, its Parts/Units structure, both import paths, and the Concept Builder. It does not cover Textbook attachment (Phase 2, not yet designed in detail) or Submission/moderation internals beyond the boundary stated in Section 2.

---

## 2. Two Artifacts, Two Owners

A **Curriculum Index** is the author's own working artifact. It tracks a teacher's own progress and nothing about moderation.

A **Submission** (`services/curriculumSubmissionsService.js`) is the moderation artifact, created only when a teacher submits. It owns review outcome (`pending_review` / `published` / `rejected`) entirely on its own. **A Curriculum Index never stores or learns its own moderation outcome.** The two are joined only at display time (see `services/curriculumPublishService.js`), never merged into one record.

---

## 3. Data Model

```
CurriculumIndex {
  id, status, createdAt, updatedAt
  curriculum: { name, board, grade, subject }
  parts: [ Part ]
  units: [ Unit ]   // flat array, not nested — see Section 4
}

Part {
  id, name          // free text always — "History", "General", anything a
                     // teacher writes; never a fixed enum
}

Unit {
  id, partId        // which Part this belongs to
  number            // local to its own Part — "History Unit 3" and
                     // "Geography Unit 3" are different units that both
                     // happen to be numbered 3, not a collision
  title
  printedPage        // nullable — absent for manually-added units
  lessonType         // free text, optional — e.g. "Prose"/"Poem" for
                     // English; display/filter metadata only, never a
                     // structural hierarchy level
  concepts: [ Concept ]   // see Section 6 — always starts empty
}

Concept {
  id, unitId
  title
  source: 'ai_extracted' | 'topic_list' | 'manual'
  reviewed: boolean       // per-Concept — see Section 7
}
```

**`CurriculumIndex.status`** describes the author's own progress only:
`draft → units_confirmed → textbook_attached → concepts_in_progress → concepts_complete`. It advances forward only, is set by `curriculumIndexSession.js`, and never regresses even if a later step is revisited.

---

## 4. Why Units Are Flat, Not Nested Under Parts

`units` is one flat array; each Unit references its Part by `partId`. This is the hybrid model, chosen deliberately over nesting Units inside their Part:

- `services/curriculumReviewService.js`'s unit mutation functions (`renameDraftUnit`, `deleteDraftUnit`, `moveDraftUnitUp/Down`) only ever touch `id`, `title`, and array position — none of them needed to change when Parts were introduced, and none should need to change for any future per-Unit field either.
- Reordering (`moveDraftUnitUp/Down`) is guarded by comparing adjacent entries' `partId` — a unit can never be reordered across a Part boundary this way. Moving a unit to a different Part is a distinct, explicit operation (`moveDraftUnitToPart`, used by both the Part dropdown and drag-and-drop), never a side effect of reordering.
- Same-Part units are stored contiguously in the array; this contiguity is an invariant `moveDraftUnitToPart` must preserve when it splices a unit into a new Part's block.

A Part's own metadata (name today; an icon, colour, or teaching-period estimate later) lives once, on the Part, never repeated per-Unit.

---

## 5. Import: Two Modes, One Downstream Path

**Curriculum Import is responsible only for Parts and Units. It never creates a Concept.** Every Unit, regardless of import mode or subject, starts with `concepts: []`.

Two user-facing modes, both converging on the same shared code path (`curriculumIndexSession.js`'s `applyExtractedUnits`) once extraction produces a flat list of `{ number, title, printedPage, partName }`:

- **AI-Ready Import** (recommended) — `services/canonicalUnitExtractionService.js`. Strict, deterministic. One format:
  ```
  PART: <name>
  <number>|<title>|<page>
  ```
  `CURRICULUM:` lines are accepted and ignored (documentation only). A missing `PART:` line, or units before the first one, default to a single Part named `General`. Malformed lines are never silently dropped and never fail the import — every line that doesn't parse as a valid three-field row is reported back with its line number and original text, alongside whatever did parse correctly.
  **This format is not extended for any subject.** Mathematics' Topics are not a richer import shape — they're created later, through the Concept Builder, like every other subject's Concepts.

- **Import from Textbook** (experimental) — `services/unitExtractionService.js`. Tolerant, best-effort, for a raw copied Table of Contents. Detects Part boundaries using multiple structural signals (never casing/formatting alone — see the file's own header comment), tolerant of headers, extra columns, and inconsistent spacing. No guarantees; this is the fallback when AI-Ready Import isn't practical, not the default recommendation.

Neither mode is a special case of the other, and neither is scheduled for retirement.

---

## 6. The Concept Builder

Every Unit reaches Concepts through the exact same entry point, regardless of subject:

```
Unit (concepts: [])
      ↓
Create Concepts
      ↓
Choose Source
      ↓
 ┌──────────────┬─────────────┬──────────────┐
 │ AI Extraction │ Topic List  │ Manual Entry │
 └──────────────┴─────────────┴──────────────┘
```

- **AI Extraction** — works from the Unit's location in an attached Textbook (Phase 2).
- **Topic List** — a bulk-paste box scoped to one Unit; no textbook, no page numbers. Mechanically similar to AI-Ready Import's "paste a list, get structured entries" idea, but it is **not** part of the import grammar — it is its own standalone step, available whenever a teacher chooses it, for any Unit in any subject.
- **Manual Entry** — one Concept at a time, the same interaction pattern as the existing "+ Add Unit" control.

**The system never infers which source to use from the subject.** A Science Unit can use Topic List; a Math Unit can also run AI Extraction. The choice is always an explicit, per-Unit human decision.

A Unit's `lessonType` (Section 3) has no bearing on which source is available or how Concepts are created under it — it is display metadata only.

---

## 7. Create Concepts Is Safe to Repeat, Never Destructive

Precisely: not idempotent in the strict sense (a second AI Extraction pass may legitimately surface something the first missed) — **safe to repeat**, meaning nothing is ever lost by running it again.

Every run, from any source, follows:

```
New candidate Concepts produced
      ↓
ADD all of them to the Unit           (never gated on the check below)
      ↓
DETECT which new ones resemble an existing Concept
      ↓
FLAG each resembling pair on the review screen
      ↓
Teacher chooses, per pair: Merge (one survives, the other is discarded)
                        or Ignore (both stay; the flag is dismissed)
```

Detection (`findPotentialDuplicates`) is a pure function, independent of source, using two honest tiers — exact match after trim/case-fold/whitespace-normalization, and a softer "shares most significant words" signal — surfaced with different confidence wording, never auto-resolved.

**There is no automatic deletion or merging anywhere in this pipeline.** A Concept is removed only when a teacher explicitly chooses "Merge" on a specific flagged pair.

A Unit's `reviewed` status is stored **per Concept**, never as a single flag on the Unit — a Unit reviewed today can still gain new, unreviewed Concepts next year without that being a contradiction. Any Unit- or Curriculum-level progress display (`"3 of 8 Concepts reviewed"`, `"12 of 23 Units processed"`) is always a **derived count** over Concepts, never a stored counter — this was already true for Curriculum Index progress and applies identically one level deeper.

---

## 8. Explicit Non-Goals

Stated plainly so they aren't quietly reopened:

- Concepts are never created as a side effect of import, for any subject, ever.
- The canonical import format has exactly one shape. It is not varied per subject.
- `lessonType` and Part names are free text, not fixed enumerations — the moment either becomes a closed list, the next real textbook breaks it.
- No per-Unit or per-Curriculum status field is ever the source of truth when it can instead be derived from the Concepts/Units it summarizes.
- Duplicate detection informs a human decision; it never resolves itself.

---

## 9. Deferred, Not Forgotten

- `conceptLabel` — an optional cosmetic override (e.g., showing "Topic" instead of "Concept" for a Math curriculum). UI polish, not architecture; not yet built.
- Textbook attachment and Anchor Detection's exact integration with this Concept Builder flow — Phase 2, out of scope for this document until designed.
