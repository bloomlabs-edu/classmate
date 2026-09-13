# ClassMate Supervisor — foundation

This directory is the persistent coordination state for a future
`classmate-supervisor` agent (defined at `../agents/classmate-supervisor.md`).
It is **not itself an orchestration engine** — nothing here runs
automatically, assigns work, or spawns agents. It is the data and rules that
engine will read from and write to once it exists.

**Status as of 2026-09-13: foundation only.** No worker/specialist agents
exist yet. No worktree orchestration is implemented. No commits, pushes, or
deployments have been coordinated by anything in this directory.

## Where this state lives

Anchored inside the `classmate` (classroom-tracker) repo, not `learning-hub`
and not a third neutral location — see `decisions/decisions-log.md` DEC-0001
for the full rationale and the open question flagged to the user about it.
Every record below carries an explicit `project` field precisely so this one
location can coordinate both repos without ever needing to write into the
other one.

## Directory contents

| Path | Purpose |
|---|---|
| `registry/projects.json` | Static identity map: repo paths, remotes, Firebase projects, for `classmate` / `learning-hub` / `cross-project`. |
| `registry/work-registry.json` | Every work item, by whoever is doing it. Also serves as the task pool (filter by `status`). |
| `registry/SCHEMA.md` | Field-by-field documentation of the JSON records. |
| `decisions/decisions-log.md` | Decisions made by the user, architectural/product decisions, conflict resolutions, and — currently — 6 pending Learning Hub integration decisions inherited from prior research. |
| `conflicts/conflicts-log.json` | Potential/confirmed/resolved conflicts, and ones requiring a human decision. Empty today. |
| `cross-project/dependencies.md` | Indexes the existing ClassMate<->Learning Hub integration research (does not duplicate it) and lists live vs. not-yet-built coupling points. |
| `reports/session-reports.md` | One entry per Supervisor session — lets a new session pick up context without re-deriving it. |

## Project identity (see `registry/projects.json` for the machine-readable version)

- **`classmate`** — `classroom-tracker` repo, Firebase project `classmate-302c2`. Teacher workspace.
- **`learning-hub`** — sibling repo at `../../../learning-hub` relative to this file (i.e. a sibling of `classroom-tracker` under the same GitHub folder), Firebase project `learning-hub-b2586`. Learner workspace.
- **`cross-project`** — not a repo; tags work/decisions/conflicts about the boundary between the two.

These are separate Git repositories, separate Firebase projects, and separate
deploy pipelines (each has its own `.github/workflows/firebase-hosting-*.yml`,
confirmed identical in structure but pointing at different projects). **The
Supervisor must never treat a checkout of one as a valid place to make changes
intended for the other**, and must never assume a change is safe in both
just because it "looks similar."

## Authority model (proposed, for this and future sessions)

**READ** (already safe today, no restrictions needed):
both repos' working trees, Git history, branches/worktrees, tests,
documentation, and any active-agent state recorded in `registry/`.

**DELEGATE** (not yet implemented — no worker agents exist):
tasks to specialist agents; parallel work, when the checklist below says it's
safe.

**COORDINATE** (not yet implemented beyond this documentation):
dependencies between work items; conflicts; integration between ClassMate and
Learning Hub changes.

**ESCALATE** (the one authority already exercised by this foundation-setup
session, informally — see the end-of-task report):
product decisions, architectural decisions, significant cross-project
changes, ambiguous design decisions. Escalation means writing a `SIGNIFICANT`
or `BLOCKING` conflict record or a pending decision entry and telling the
user directly — never silently picking an answer.

**EVENTUALLY, not now:** coordinating test runs, coordinating commits,
coordinating pushes, coordinating deployments, verifying production. None of
this is implemented. Any future work in this area should be treated as a
distinct, explicitly-scoped task, not an assumed extension of the read/
coordinate/escalate authority above.

## Work registry model

Four `worker_type` values, per the task's own model:

- **USER** — the user's own work in a separate Claude Code window. The
  Supervisor observes and records this (e.g. `WORK-0001`), and never edits,
  reassigns, or overwrites it. Detecting USER work today means running
  `git status`/`git diff` in the relevant repo — there is no live/streaming
  visibility into an open, unsaved editor session, only what's on disk.
- **AGENT** — an autonomous development agent working on a task.
- **SPECIALIST** — a narrow-scope reviewer (visual QA, accessibility,
  testing, curriculum review). `classmate-visual-qa` is the first planned
  specialist; it does not exist yet (see "Explicitly deferred" below).
- **SUPERVISOR** — the coordination work itself (e.g. `WORK-0003`, this
  foundation-setup task).

Every item gets a unique, monotonic `WORK-000N` id (see
`registry/work-registry.json`, `next_id`). IDs are never reused, even for
cancelled work.

## Severity model (for conflicts)

- **INFO** — no action required.
- **WARNING** — potential overlap; continue unless risk increases.
- **SIGNIFICANT** — meaningful dependency or likely conflict; notify the
  user.
- **BLOCKING** — work cannot safely continue without coordination or a
  decision.

Applies identically to USER-vs-AGENT, AGENT-vs-AGENT, and cross-project
conflicts. Never suppress a detected conflict to keep things moving — record
it even at INFO, so the history is honest (Safety Principle).

## Parallel work: the evaluation checklist

Default assumption: **parallel work is desirable when safe.** Do not default
to sequential execution. For every new task, before assigning:

1. Does this overlap with active work (check `work-registry.json` for
   `status: active` items in the same `project`)?
2. Does it touch the same files (`affected_areas`)?
3. Does it touch related components, even under different file names?
4. Does it change a shared API/data contract (check
   `cross-project/dependencies.md` if either project is `classmate` or
   `learning-hub` and the task touches an edge listed there)?
5. Does it depend on another task (`dependencies` field)?
6. Does it create a product-direction conflict (check `decisions-log.md` for
   anything it would contradict)?
7. Does it create a cross-project dependency it didn't have before?
8. Can it safely happen in an isolated Git worktree (see below)?

- **Independent -> assign in parallel.**
- **Dependent -> coordinate the dependency** (record it in `dependencies`,
  don't just start it and hope).
- **Unsafe -> hold the task and explain why** (a `blocked` work item with a
  populated `blocked_reason`, or a conflict record).

Do not optimize for maximum agent activity. More agents running does not
mean more real progress — optimize for useful parallelism, minimal duplicated
work, minimal context switching, minimal merge/integration risk, and
preservation of both products' principles (ClassMate: `../../ARCHITECTURE.md`
and the curriculum-pipeline non-goals in it; Learning Hub: the boundaries in
`cross-project/dependencies.md`, especially the "Concept means multiple
things" trap).

## Worktree principle (documented intent — not implemented)

Independent coding agents should eventually work in isolated Git worktrees or
equivalent isolated branches, never multiple autonomous agents blindly
modifying the same working directory. The user's own working directory
(wherever their separate Claude Code window is pointed) must remain theirs —
the Supervisor coordinates integration rather than assuming everyone shares
one checkout.

**What exists today to support this:** ordinary `git worktree` (confirmed
available; `git worktree list` currently shows only the one primary checkout
for `classroom-tracker`), and this session's own `EnterWorktree`/
`ExitWorktree` tool capability for agent isolation. **What does not exist
yet:** any actual policy or code that creates a worktree per agent, assigns
work into it, or merges it back. This is deliberately not built in this
foundation-setup task — only documented, per the task's own instruction not
to implement full worktree orchestration "unless the repository already has
a safe established mechanism for it" (it doesn't).

When it is built, the intended model is: one worktree/branch per AGENT work
item; the user's primary checkout is never assigned to an agent; the
Supervisor records `worktree: {path, branch}` on the work item once created;
integration back to `main` is a distinct, Supervisor-coordinated step, not
something an individual agent does unilaterally.

## Explicitly deferred (do not build without a separate go-ahead)

- **`classmate-visual-qa`** specialist agent — its intended scope (Bento
  consistency, spacing, typography/Plus Jakarta Sans, overflow/clipping,
  responsive behavior, contrast, visual hierarchy) is documented here so a
  future session knows what it's for, but it is not created. It would report
  findings to the Supervisor, not make product decisions unilaterally.
- Any other worker/specialist agent.
- Actual worktree creation/assignment/merge automation.
- Any automation that commits, pushes, or deploys on the Supervisor's own
  initiative.
- Hooks or scheduled/autonomous overnight execution.

## How to add work without disrupting active work

Append a new item to `registry/work-registry.json` with `status: "queued"`
(or `"ready"` if nothing blocks it). Adding a task must never itself change
the status of an unrelated active item. Whether it can start immediately, go
to another agent, wait on a dependency, get combined with an existing item,
or needs clarification from the user is exactly the parallel-work checklist
above — evaluate it, don't just leave it queued by default either.

## Safety principle (restated for this file specifically)

Never hide a conflict — if uncertain, investigate, record the uncertainty in
`conflicts-log.json`, and report it. Never silently overwrite or discard
another worker's changes (including the user's `WORK-0001`). Never assume
"Git can merge it" means the underlying product decisions are compatible —
check `decisions-log.md`.
