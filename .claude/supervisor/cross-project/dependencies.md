# Cross-project dependencies: ClassMate <-> Learning Hub

This file indexes and summarizes existing research; it deliberately does not
duplicate it. The authoritative source is four documents already sitting
(untracked) in the `learning-hub` repo:

| Document | Path (relative to `learning-hub` repo root) | Covers |
|---|---|---|
| Integration Contract | `docs/CLASSMATE_LEARNING_HUB_INTEGRATION_CONTRACT.md` | Resource/Concept data model, auth boundary, `?entry=` launcher, the minimal cross-product contract, staged implementation sequence |
| Governance Decision Analysis | `docs/CLASSMATE_LEARNING_HUB_INTEGRATION_DECISIONS.md` | The 6 open decisions, framed with options + architectural meaning, no recommendation |
| Recommended Decisions | `docs/CLASSMATE_LEARNING_HUB_INTEGRATION_RECOMMENDATIONS.md` | A recommended (not ratified) position on each of the 6 decisions, with tradeoffs and revisit triggers |
| Learning Hub Current-State Architecture | `docs/LEARNING_HUB_ARCHITECTURE_CURRENT_STATE.md` | Full from-scratch audit of Learning Hub: learner model, identity, Concept model(s), evidence/progress models, existing ClassMate integration points |

**These are uncommitted in `learning-hub` as of 2026-09-13.** Treat them as
real but not yet stable — if the user or another agent later amends or
discards them, this summary will go stale. Re-check `git status` in
`learning-hub` before relying on this file for anything load-bearing.

Corresponding work-registry entry: `WORK-0002`. Corresponding open decisions:
`DEC-PENDING-1` through `DEC-PENDING-6` in `decisions/decisions-log.md`.

## What actually connects the two products today (live, in production)

1. **ClassMate reads two static files Learning Hub publishes** — `catalogue.json` / `packs.json` — via a direct `fetch()`. One-directional, read-only, no auth.
2. **ClassMate can deep-link into Learning Hub** via `?entry=<type>:<id>` (`ENTRY_HANDLERS` in Learning Hub's `app.js`). The `concept` entry type was purpose-built for this. No ClassMate code constructs one of these URLs yet.
3. **Nothing else.** No shared Firestore project, no server-to-server call, no webhook, no shared auth. `classmate-302c2` and `learning-hub-b2586` are separate Firebase projects with mutually unrecognizable auth tokens.

## Shared vocabulary that is NOT actually shared (traps for a future agent)

- **"Concept" means two-to-three different things — recorded as `CONFLICT-0001` (SIGNIFICANT, status: confirmed, unresolved by design).** ClassMate's curriculum-pipeline `Concept` (see `../../ARCHITECTURE.md` in this repo — Curriculum Index -> Unit -> Concept) is a different object from Learning Hub's `RepositoryConcept` (`concepts/{conceptId}`), which is itself different from Learning Hub's legacy in-memory `MissionConcept`. None of the three share an ID space today. Any agent working across both repos must never assume a `conceptId` in one system resolves in the other without going through the (currently unbuilt) `learningHubConcept` mapping field described in the Contract doc. Per explicit user instruction, this ambiguity is recorded, not resolved — do not propose a reconciliation without a real decision entry in `decisions-log.md`.
- **"Resource"/"Learning Experience"** is Learning Hub-specific (`resources/{resourceId}`); ClassMate's closest equivalent is `ConceptResourceLink`/`Activity`, a different schema.
- **Evidence/progress has no shared shape.** Learning Hub alone has three non-unified evidence models (Learning Check, LSRW Attempt, legacy local progress); ClassMate is not currently a consumer of any of them.

## Proposed dependency edges (for future conflict detection)

| Edge | Direction | Status |
|---|---|---|
| ClassMate -> Learning Hub static catalogue/packs read | ClassMate depends on Learning Hub | Live today |
| ClassMate -> Learning Hub `?entry=concept:<id>` deep link | ClassMate depends on Learning Hub | Live today, unused (no ClassMate caller yet) |
| ClassMate `LearningConcept.learningHubConcept` mapping | ClassMate-side only | Not built (Contract §J stage 1) |
| ClassMate-authored Resource -> Learning Hub `resources/{id}` write | ClassMate depends on new Learning Hub infra | Not built — blocked on DEC-PENDING-1/2 |
| Learning Hub -> ClassMate result callback | Learning Hub would depend on ClassMate | Explicitly out of scope for now (DEC-PENDING-4) |
| Shared terminology ("Concept", "Resource", "Evidence") | Both | **Not actually shared** — see trap list above. Any work item that assumes shared meaning without checking should be flagged as at least `WARNING` severity. |

## How a future Supervisor should use this file

When evaluating a new task under the Parallel Work Principle (see the main
`README.md`), check this table for question 7 ("Does it create a
cross-project dependency?"). If a ClassMate-side task touches
`learningHubConcept`, catalogue/packs consumption, or `?entry=` URL
construction, or a Learning Hub-side task touches `resources/{id}` creation
semantics, `conceptIds`, or auth/role handling — treat it as at minimum
`WARNING` severity and cross-reference `WORK-0002` and the pending decisions
above before assigning it in parallel with unrelated work.
