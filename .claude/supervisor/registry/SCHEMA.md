# Registry schema

This documents the shape of `work-registry.json` and `conflicts/conflicts-log.json` in
human-readable form. The JSON files are the source of truth; this file explains them.

Design choice: **the "work registry" and the "task pool" are the same file.**
The task requested them as two structures, but every field the task pool needs
(status: active/ready/blocked/queued/completed/cancelled) is a property of a
work item, not a separate object. Splitting them would create two records per
task that could silently drift out of sync — the Safety Principle ("never
hide conflicts", "never silently...") argues against that. "The task pool" is
simply `work-registry.json` filtered by `status`.

## Work item

```jsonc
{
  "id": "WORK-0001",                 // unique, monotonic, never reused
  "worker_type": "USER",             // USER | AGENT | SPECIALIST | SUPERVISOR
  "worker_id": "human:rejeesh",      // e.g. "agent:classmate-feature-x", "specialist:classmate-visual-qa", "supervisor"
  "project": "classmate",            // must match an id in registry/projects.json
  "task": "short human description",
  "status": "active",                // active | ready | blocked | queued | completed | cancelled
  "affected_areas": ["css/styles.css", "js/ui/views/LandingView.js"],
  "dependencies": [],                // array of other WORK-xxxx ids this depends on
  "worktree": null,                  // { "path": "...", "branch": "..." } or null if working directly in the main checkout
  "started_at": "2026-09-13T00:00:00Z",
  "updated_at": "2026-09-13T00:00:00Z",
  "current_state": "free-text note on what's actually happening right now",
  "blocked_reason": null,            // required if status == "blocked"
  "notes": ""
}
```

Notes on fields:
- `worker_type` distinguishes the four kinds of worker the task specifies. `USER` work items represent the user's own Claude Code window / manual edits — the Supervisor never edits or reassigns these, only observes and records them.
- `worktree` is null for anything happening in a single shared checkout (this is the norm today — see `cross-project/dependencies.md` and the README's Worktree Principle section for why worktree orchestration is not yet implemented).
- `affected_areas` should be file paths where known, or component/feature names when a task hasn't touched files yet (e.g. a `ready`/`queued` item).

## Conflict record

```jsonc
{
  "id": "CONFLICT-0001",
  "severity": "INFO",                // INFO | WARNING | SIGNIFICANT | BLOCKING
  "status": "potential",             // potential | confirmed | resolved | requires_human_decision
  "involved_work_items": ["WORK-0001", "WORK-0003"],
  "project": "classmate",
  "description": "what overlaps and why",
  "detected_at": "2026-09-13T00:00:00Z",
  "resolution": null,                // free text once resolved
  "resolved_at": null
}
```

## Decision entry (decisions-log.md)

Not JSON — decisions are narrative and infrequent, so a Markdown log with one
`###` heading per decision (id, date, made-by, status) is more readable than a
JSON array, and this file is meant to be read by a human as often as by an
agent. Each entry states what future agents/work must respect as a result.
