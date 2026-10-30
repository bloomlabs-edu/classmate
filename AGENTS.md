# Agent Instructions — ClassMate (classroom-tracker)

These instructions apply to any AI coding agent (Claude Code, Codex, or
otherwise) working in this repository. Read this before editing any file.

## Before starting ANY independent feature or bug-fix task

1. Identify the repository root (`git rev-parse --show-toplevel`).
2. Run `git status` and `git worktree list`.
3. Confirm which worktree and branch you are currently in — do not assume.
4. If this is a new, independent task: create a dedicated worktree and
   branch BEFORE editing any source file. Use `node scripts/newWorktree.mjs
   <short-task-name>` (or `npm run worktree:new -- <short-task-name>`).
5. Never reuse an existing worktree that has uncommitted changes belonging
   to a different task — if `git status` in that worktree is not clean and
   you don't recognize the changes as your own in-progress work, stop and
   ask rather than building on top of it or discarding it.
6. Never switch branches in a worktree that has uncommitted changes, and
   never switch branches in a worktree you don't know to be exclusively
   yours for this task.
7. Never stage or commit files you did not intentionally change for this
   task.

## Creating a worktree

```
node scripts/newWorktree.mjs <short-task-name> [options]
npm run worktree:new -- <short-task-name> [options]
```

`<short-task-name>` is required, lowercase, alphanumeric and hyphen-
separated (e.g. `student-progress-widget`), and must be the ONLY
positional argument — if your task has a multi-word name, join it with
hyphens (`fix-holiday-list`, not `fix holiday list`); extra space-
separated words are rejected outright, never silently dropped or
truncated to the first word.

Options:

| Flag | Default | Valid values | Purpose |
|---|---|---|---|
| `--type=<value>` | `feature` | `feature`, `investigation`, `fix` | Branch prefix (`feature/<name>`, `investigation/<name>`, `fix/<name>`). |
| `--worker-id=<id>` | `unknown` | any string | Self-reported identity recorded in the Supervisor registry entry (e.g. `agent:claude-session-3`, `human:rejeesh`). Never inferred — Git/the OS cannot reliably tell one agent session from another, so an omitted value is honestly recorded as `unknown`, not guessed. |
| `--task="description"` | an auto-generated description naming the task | any string | Short, human-readable description for the Supervisor registry entry. |
| `--no-register` | registration ON | n/a (boolean) | Skip the Supervisor registry step entirely. The worktree is still created either way. |
| `--help` / `-h` | n/a | n/a | Print usage and exit. |

**`feature` vs. `fix` vs. `investigation`:** use `feature` for new
functionality or any change with a clear implementation path, even a bug
fix with an obvious code-level cause (`fix` is a lighter-weight synonym
for the same case, reserved for pure defect fixes already understood
before work starts). Use `investigation` when the task is genuinely
exploratory — the deliverable might be findings or a report rather than
shipped code, and you don't yet know whether a code change is warranted
at all (e.g. auditing a flaky test, researching a data-integrity
question). This repo already uses `investigation/term-textbooks` as a
real example of the latter.

Examples:

```
# A new feature, default options
node scripts/newWorktree.mjs student-progress-widget
-> branch:    feature/student-progress-widget
-> worktree:  ../classmate-student-progress-widget

# A bug fix, self-identified, with a task description, registry skipped
node scripts/newWorktree.mjs holiday-list-fix \
  --type=fix --worker-id=agent:claude-session-3 \
  --task="Fix the holiday list rendering bug" --no-register
-> branch:    fix/holiday-list-fix
-> worktree:  ../classmate-holiday-list-fix
```

## The main worktree is not for parallel feature development

`C:\Users\...\GitHub\classroom-tracker` (this repo's primary checkout) is
not a scratch space for independent agent tasks. It may legitimately carry
the user's own in-progress work, or a task explicitly assigned there by the
user. If you were not explicitly told to work in the main worktree, assume
you were not, and create an isolated worktree instead.

## On multiple agents / sessions

Git has no reliable way to tell you which session (Claude, Codex, or a
human) last touched a file. Do not infer ownership from file timestamps,
process IDs, or "it looks like something I'd write." If you find unexpected
uncommitted changes you didn't make, do not move, stash, revert, discard,
or build on top of them — preserve them exactly as found, and report what
you found and ask before taking any action that could affect them.

## Git safety (all tasks)

- Stage explicitly-named files, or use `git add -p` for a file with mixed
  concerns. Never `git add .` / `git add -A` as a reflex — stage only what
  you intentionally changed for this task.
- Always run `git diff --cached --stat` and `git diff --cached` and review
  the result before every commit. Confirm the staged set matches only this
  task's intent, and that no unrelated file was swept in.
- Before committing, check for unexpected changes: re-run `git status` and
  confirm every modified/untracked file you see is either staged
  intentionally by you or recognized as pre-existing, unrelated work you
  are leaving alone.
- Keep each commit scoped to one feature/fix. Do not fold in unrelated
  cleanup "while you're in there."
- Never force-push (`--force`/`--force-with-lease`) without the user's
  explicit, per-instance approval.
- Pushing a branch, merging a PR, and deploying to production are three
  separate approvals. Never treat approval of one as approval of another —
  approving a commit is not approval to push; approving a push is not
  approval to merge; approving a merge is not approval to deploy.

## Repository-specific context

See `.claude/supervisor/README.md` for the existing (partially-implemented)
cross-session coordination model — work registry, conflict log, severity
levels. Check `registry/work-registry.json` and
`conflicts/conflicts-log.json` before starting work that might overlap with
another tracked item.
