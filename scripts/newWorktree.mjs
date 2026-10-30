#!/usr/bin/env node
/**
 * scripts/newWorktree.mjs
 *
 * Creates an isolated Git worktree + branch for one independent task,
 * off the latest `origin/main`, in a sibling directory — the automated
 * half of AGENTS.md's "use a dedicated worktree before editing source
 * files" rule.
 *
 * Deliberately does only ONE thing (create) and nothing else: never
 * deletes, resets, overwrites, or reuses an existing worktree or branch.
 * If anything about the target already exists, or any precondition can't
 * be verified, this refuses and exits non-zero rather than guessing.
 *
 * Usage:
 *   node scripts/newWorktree.mjs <short-task-name> [options]
 *   npm run worktree:new -- <short-task-name> [options]
 *
 * Options:
 *   --type=feature|investigation|fix   Branch prefix (default: feature)
 *   --worker-id=<id>                   Self-reported identity for the
 *                                       Supervisor registry entry (e.g.
 *                                       "agent:claude-session-3",
 *                                       "human:rejeesh"). Never inferred —
 *                                       Git/the OS cannot reliably tell
 *                                       one agent session from another.
 *                                       Defaults to "unknown".
 *   --task="description"               Short task description for the
 *                                       registry entry.
 *   --no-register                      Skip the Supervisor registry step
 *                                       entirely (worktree is still
 *                                       created).
 *   --help, -h                         Print this usage message and exit.
 *
 * Example:
 *   node scripts/newWorktree.mjs student-progress-widget
 *   -> branch:    feature/student-progress-widget
 *   -> worktree:  ../classmate-student-progress-widget
 *
 * See AGENTS.md's own "Creating a worktree" section for the full option
 * reference, concrete examples, and feature-vs-investigation guidance.
 *
 * TESTABILITY — pure, exported functions (parseArgs, checkDestinationPathLength,
 * pathsEqual, isPathInside) are unit-tested directly in
 * tests/scripts/newWorktree.test.js, the same "export pure logic, guard
 * execution behind an invokedDirectly check" convention
 * scripts/runUnitTests.mjs already established. main() itself (which does
 * the real git/filesystem work) is deliberately left untested there —
 * exercised instead via real end-to-end runs against isolated scratch
 * repos, never the real ClassMate repo's own worktrees.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALLOWED_TYPES = ['feature', 'investigation', 'fix'];
const EXPECTED_REMOTE_FRAGMENT = 'bloomlabs-edu/classmate';

// Windows' own hard limit (MAX_PATH) is 260 characters total, including
// the drive letter and a trailing null terminator. This script's own
// destination is only the WORKTREE ROOT — real work happens in files
// nested further inside it (e.g. `tests/services/someLongName.test.js`,
// or `node_modules/<pkg>/dist/...` for anything that ever runs `npm
// install` there), so a path that's already close to 260 at the worktree
// ROOT leaves no headroom at all for that. 200 is a deliberately
// conservative ceiling — 60 characters of headroom — chosen so a
// worktree created successfully today doesn't start failing cryptic
// Windows/Git "File name too long" errors the first time someone adds a
// normally-named file inside it. This exact failure mode was reproduced
// directly while building this script's own test fixtures.
export const WINDOWS_SAFE_PATH_LENGTH = 200;

export const USAGE =
  'Usage: node scripts/newWorktree.mjs <short-task-name> [--type=feature|investigation|fix] [--worker-id=<id>] [--task="description"] [--no-register]\nSee AGENTS.md for the full option reference and examples.';

function run(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...options }).trim();
}

function fail(message) {
  console.error(`[newWorktree] FAIL: ${message}`);
  process.exit(1);
}

function toGitPath(p) {
  // git on this platform is consistently shown/used with forward slashes
  // (see `git worktree list`'s own output) — normalize so paths passed as
  // command arguments match that convention exactly, avoiding any
  // backslash-escaping ambiguity.
  return p.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------
// Pure, exported helpers — no I/O, no process.exit, fully unit-testable.
// ---------------------------------------------------------------------

/**
 * Strict argument parsing — accepts EXACTLY one positional task name and
 * ONLY the four documented flags; everything else (extra positional
 * arguments, unrecognized `--flags`, a known flag missing its required
 * `=value`) is rejected with a clear, actionable error rather than being
 * silently dropped.
 *
 * THE BUG THIS REPLACES: the previous implementation picked the FIRST
 * non-`--` token as the task name and silently ignored every other
 * argument — `node scripts/newWorktree.mjs my task name` silently
 * created a real worktree/branch named "my", discarding "task" and
 * "name" entirely. Confirmed directly in review. This version instead
 * detects "more than one positional argument" explicitly and refuses,
 * suggesting the likely fix (join with hyphens) rather than guessing
 * which one was intended.
 *
 * Returns `{ ok: true, value }` — where `value.help === true` short-
 * circuits everything else when `--help`/`-h` is present — or
 * `{ ok: false, error }`. Never throws, never touches the filesystem or
 * any process state, so every branch is directly assertable in a test.
 */
export function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { ok: true, value: { help: true } };
  }

  const positional = [];
  const unknown = [];
  const value = { help: false, type: 'feature', workerId: 'unknown', taskDescription: null, skipRegister: false };

  for (const arg of argv) {
    if (arg === '--no-register') {
      value.skipRegister = true;
      continue;
    }
    const match = /^--(type|worker-id|task)=(.*)$/.exec(arg);
    if (match) {
      const [, name, flagValue] = match;
      if (name === 'type') value.type = flagValue;
      else if (name === 'worker-id') value.workerId = flagValue || 'unknown';
      else if (name === 'task') value.taskDescription = flagValue || null;
      continue;
    }
    if (arg.startsWith('--')) {
      // Covers both a truly unknown flag (e.g. "--bogus") AND a known
      // flag name used without its required "=value" (e.g. bare
      // "--type") — neither matched the pattern above, so both are
      // "malformed" from this parser's point of view, deliberately not
      // distinguished further: either way, the input doesn't mean what
      // the caller probably intended, so neither should be silently
      // accepted with a guessed default.
      unknown.push(arg);
      continue;
    }
    positional.push(arg);
  }

  if (unknown.length > 0) {
    return { ok: false, error: `Unknown or malformed option(s): ${unknown.join(', ')}.\n${USAGE}` };
  }
  if (positional.length === 0) {
    return { ok: false, error: `Missing task name.\n${USAGE}` };
  }
  if (positional.length > 1) {
    const suggestion = positional.join('-');
    return {
      ok: false,
      error: `Expected exactly one task name, got ${positional.length} separate arguments: ${positional.map((p) => `"${p}"`).join(', ')}. If you meant one multi-word task name, join the words with hyphens instead of spaces (e.g. "${suggestion}").\n${USAGE}`,
    };
  }

  const rawName = positional[0];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(rawName)) {
    return { ok: false, error: `Task name must be lowercase, alphanumeric, hyphen-separated (got "${rawName}").` };
  }
  if (!ALLOWED_TYPES.includes(value.type)) {
    return { ok: false, error: `Unsupported --type "${value.type}". Allowed: ${ALLOWED_TYPES.join(', ')}.` };
  }

  return { ok: true, value: { ...value, rawName } };
}

/**
 * Windows-only, platform-aware guard against the worktree's own root
 * path already being too close to Windows' 260-character MAX_PATH — see
 * WINDOWS_SAFE_PATH_LENGTH's own comment for the exact reasoning. A
 * no-op (`{ ok: true }`) on every other platform, so a legitimately long
 * path on macOS/Linux (where the equivalent limits are far more
 * generous) is never unnecessarily rejected.
 */
export function checkDestinationPathLength(destinationPath, platform = process.platform) {
  if (platform !== 'win32') return { ok: true };
  if (destinationPath.length <= WINDOWS_SAFE_PATH_LENGTH) return { ok: true };
  return {
    ok: false,
    error: `The resulting worktree path is ${destinationPath.length} characters long, which exceeds this script's conservative Windows-safe limit of ${WINDOWS_SAFE_PATH_LENGTH} (Windows' own hard limit is 260 total, including the drive letter — this leaves headroom for files created inside the worktree, not just the worktree root itself). Pick a shorter task name and try again.\nPath: ${destinationPath}`,
  };
}

/**
 * Normalizes a path for COMPARISON ONLY (never for display, never passed
 * back to git/the filesystem) — forward slashes throughout, and
 * lowercased on Windows, whose filesystem is case-insensitive (but
 * case-PRESERVING: git and Node can each report the "same" real path
 * with different casing depending on how it was typed/cloned). Left
 * untouched (case-sensitive) on every other platform, so two genuinely
 * different paths that only differ by case on a case-sensitive
 * filesystem are never incorrectly treated as equal.
 */
export function normalizePathForComparison(p, platform = process.platform) {
  const withForwardSlashes = p.replace(/\\/g, '/');
  return platform === 'win32' ? withForwardSlashes.toLowerCase() : withForwardSlashes;
}

/** Path equality for the purpose of "is this the same worktree/directory," platform-aware per normalizePathForComparison() above. */
export function pathsEqual(a, b, platform = process.platform) {
  return normalizePathForComparison(a, platform) === normalizePathForComparison(b, platform);
}

/**
 * Whether `child` is `parent` itself, or genuinely nested inside it —
 * platform-aware via normalizePathForComparison(). Requires an exact
 * path-segment boundary (`parent/` as a prefix, not just a string
 * prefix) specifically so e.g. "C:/foo-bar" is never incorrectly treated
 * as inside "C:/foo".
 */
export function isPathInside(child, parent, platform = process.platform) {
  const normChild = normalizePathForComparison(child, platform);
  const normParent = normalizePathForComparison(parent, platform).replace(/\/+$/, '');
  return normChild === normParent || normChild.startsWith(`${normParent}/`);
}

// ---------------------------------------------------------------------
// main() — all real I/O (git, filesystem, process.exit) lives here.
// ---------------------------------------------------------------------

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    fail(parsed.error);
  }
  if (parsed.value.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const { rawName, type, workerId, taskDescription, skipRegister } = parsed.value;

  // ---------------------------------------------------------------------
  // Repository validation — confirm we're really in the ClassMate repo,
  // and resolve the PRIMARY checkout regardless of which worktree this
  // script happens to be invoked from.
  // ---------------------------------------------------------------------

  let gitCommonDirRaw;
  try {
    gitCommonDirRaw = run(['rev-parse', '--git-common-dir']);
  } catch {
    fail('Not inside a Git repository (git rev-parse --git-common-dir failed). Run this from within the ClassMate checkout.');
  }
  const gitCommonDir = path.resolve(process.cwd(), gitCommonDirRaw);
  if (path.basename(gitCommonDir) !== '.git') {
    fail(`Unexpected git-common-dir shape: ${gitCommonDir}. Refusing to guess the primary checkout location.`);
  }
  const primaryWorktreeRoot = path.dirname(gitCommonDir);

  let remoteUrl = '';
  try {
    remoteUrl = run(['remote', 'get-url', 'origin'], { cwd: primaryWorktreeRoot });
  } catch {
    fail('Could not read the "origin" remote URL — cannot confirm this is the ClassMate repository.');
  }
  if (!remoteUrl.toLowerCase().includes(EXPECTED_REMOTE_FRAGMENT)) {
    fail(`origin remote ("${remoteUrl}") does not look like the ClassMate repository (expected it to contain "${EXPECTED_REMOTE_FRAGMENT}"). Refusing to proceed.`);
  }

  // ---------------------------------------------------------------------
  // Destination validation — a sibling of the PRIMARY checkout, never
  // nested inside it, never an existing path, never unsafely long.
  // ---------------------------------------------------------------------

  const branch = `${type}/${rawName}`;
  const destination = path.resolve(primaryWorktreeRoot, '..', `classmate-${rawName}`);

  if (isPathInside(destination, primaryWorktreeRoot)) {
    fail(`Computed destination (${destination}) is inside the primary checkout (${primaryWorktreeRoot}) — refusing. This should not be reachable; report this as a bug.`);
  }

  const lengthCheck = checkDestinationPathLength(destination);
  if (!lengthCheck.ok) {
    fail(lengthCheck.error);
  }

  if (existsSync(destination)) {
    fail(`Refusing to proceed: ${destination} already exists. Pick a different task name, or remove it yourself first if it's genuinely stale. This script never deletes or reuses an existing directory.`);
  }

  // ---------------------------------------------------------------------
  // Branch validation — local, remote, AND existing worktree
  // registrations (git worktree list can, in principle, diverge from
  // plain `git branch --list` — e.g. a detached-HEAD worktree — so both
  // are checked independently rather than assuming one implies the
  // other).
  // ---------------------------------------------------------------------

  const localBranches = run(['branch', '--list', branch], { cwd: primaryWorktreeRoot });
  if (localBranches) {
    fail(`Refusing to proceed: branch "${branch}" already exists locally. If you meant to resume existing work, check it out manually in its own worktree — this script only creates new work.`);
  }

  let remoteBranches;
  try {
    remoteBranches = run(['ls-remote', '--heads', 'origin', branch], { cwd: primaryWorktreeRoot });
  } catch (error) {
    fail(`Could not check origin for an existing remote branch: ${error.message}. Refusing to proceed without this check (no fallback).`);
  }
  if (remoteBranches) {
    fail(`Refusing to proceed: branch "${branch}" already exists on origin. Fetch and check it out manually in its own worktree if you meant to resume it.`);
  }

  const worktreePorcelain = run(['worktree', 'list', '--porcelain'], { cwd: primaryWorktreeRoot });
  const existingWorktreeEntries = worktreePorcelain.split('\n\n').filter(Boolean);
  for (const entry of existingWorktreeEntries) {
    const pathLine = entry.split('\n').find((l) => l.startsWith('worktree '));
    const branchLine = entry.split('\n').find((l) => l.startsWith('branch '));
    const entryPath = pathLine ? path.resolve(pathLine.slice('worktree '.length)) : null;
    const entryBranch = branchLine ? branchLine.slice('branch '.length).replace(/^refs\/heads\//, '') : null;
    if (entryPath && pathsEqual(entryPath, destination)) {
      fail(`Refusing to proceed: "git worktree list" already has a registration at ${destination}, even though the directory doesn't currently exist on disk. Run "git worktree prune" yourself first if this is genuinely stale — this script will not do it for you.`);
    }
    if (entryBranch === branch) {
      fail(`Refusing to proceed: branch "${branch}" is already checked out in another worktree (${entryPath}). This script never reuses a branch that's already checked out elsewhere.`);
    }
  }

  // ---------------------------------------------------------------------
  // Fresh base requirement — origin/main, fetched just now, no fallback
  // to a possibly-stale local `main` under any circumstance.
  // ---------------------------------------------------------------------

  try {
    run(['fetch', 'origin', 'main'], { cwd: primaryWorktreeRoot });
  } catch (error) {
    fail(`git fetch origin main failed: ${error.message}. Refusing to branch from a potentially stale local main — fix connectivity/auth and try again.`);
  }

  let baseCommit;
  try {
    baseCommit = run(['rev-parse', '--verify', 'origin/main'], { cwd: primaryWorktreeRoot });
  } catch {
    fail('origin/main does not exist after a successful fetch. Refusing to proceed — there is no safe base to branch from.');
  }
  console.log(`[newWorktree] Base: origin/main @ ${baseCommit}`);

  // ---------------------------------------------------------------------
  // Create the worktree + branch together, off origin/main exactly.
  // ---------------------------------------------------------------------

  try {
    run(['worktree', 'add', '-b', branch, toGitPath(destination), 'origin/main'], { cwd: primaryWorktreeRoot });
  } catch (error) {
    fail(`git worktree add failed: ${error.message}`);
  }

  // ---------------------------------------------------------------------
  // Post-creation verification — never trust that the previous step
  // "probably worked." If any of these disagree, STOP and report; never
  // attempt to automatically remove what was just created.
  // ---------------------------------------------------------------------

  function verifyOrFailWithoutCleanup(condition, message) {
    if (condition) return;
    console.error(`[newWorktree] VERIFICATION FAILED: ${message}`);
    console.error(`[newWorktree] The worktree at ${destination} was NOT automatically removed — inspect it manually before deciding what to do.`);
    process.exit(1);
  }

  verifyOrFailWithoutCleanup(existsSync(destination), `${destination} does not exist on disk after "git worktree add" reported success.`);

  const postPorcelain = run(['worktree', 'list', '--porcelain'], { cwd: primaryWorktreeRoot });
  const postEntries = postPorcelain.split('\n\n').filter(Boolean);
  const createdEntry = postEntries.find((entry) => {
    const pathLine = entry.split('\n').find((l) => l.startsWith('worktree '));
    return pathLine && pathsEqual(path.resolve(pathLine.slice('worktree '.length)), destination);
  });
  verifyOrFailWithoutCleanup(Boolean(createdEntry), `"git worktree list" does not show a registration at ${destination}.`);

  const createdBranchLine = createdEntry.split('\n').find((l) => l.startsWith('branch '));
  const createdBranch = createdBranchLine ? createdBranchLine.slice('branch '.length).replace(/^refs\/heads\//, '') : null;
  verifyOrFailWithoutCleanup(createdBranch === branch, `expected branch "${branch}", but the worktree registration shows "${createdBranch}".`);

  let createdHead;
  try {
    createdHead = run(['rev-parse', 'HEAD'], { cwd: destination });
  } catch (error) {
    verifyOrFailWithoutCleanup(false, `could not read HEAD inside the new worktree: ${error.message}`);
  }
  verifyOrFailWithoutCleanup(createdHead === baseCommit, `expected HEAD to be ${baseCommit} (origin/main at creation time), but it is ${createdHead}.`);

  console.log(`[newWorktree] Verified: worktree exists, branch is "${branch}", HEAD matches the intended base commit.`);
  console.log(`[newWorktree] Created worktree at: ${destination}`);
  console.log(`[newWorktree] Branch: ${branch} (from origin/main @ ${baseCommit})`);
  console.log(`[newWorktree] Next: cd "${destination}" before editing any files.`);

  // ---------------------------------------------------------------------
  // Supervisor registry registration (best-effort, optional) — reuses
  // the EXISTING schema at .claude/supervisor/registry/work-registry.json
  // (see that directory's own SCHEMA.md), never a new/competing
  // coordination file. Uses an optimistic-concurrency check (re-read
  // immediately before writing) as its only safety mechanism — this is
  // NOT a real file lock, so if another session has touched the
  // registry between our read and write, this step backs off entirely
  // and prints the entry for manual/Supervisor registration instead,
  // rather than risking an overwrite of someone else's concurrent edit.
  // ---------------------------------------------------------------------

  if (skipRegister) {
    console.log('[newWorktree] --no-register given: skipping Supervisor registry update.');
    return;
  }

  const registryPath = path.join(primaryWorktreeRoot, '.claude', 'supervisor', 'registry', 'work-registry.json');
  if (!existsSync(registryPath)) {
    console.log('[newWorktree] No Supervisor registry found at .claude/supervisor/registry/work-registry.json — skipping registration.');
    return;
  }

  let initialRaw;
  let initialParsed;
  try {
    initialRaw = readFileSync(registryPath, 'utf8');
    initialParsed = JSON.parse(initialRaw);
  } catch (error) {
    console.warn(`[newWorktree] Could not read/parse the Supervisor registry (${error.message}) — skipping registration. The worktree itself was still created successfully.`);
    return;
  }

  const nowIso = new Date().toISOString();
  const newItem = {
    id: `WORK-${String(initialParsed.next_id).padStart(4, '0')}`,
    worker_type: 'AGENT',
    worker_id: workerId,
    project: 'classmate',
    task: taskDescription || `Worktree created via scripts/newWorktree.mjs for task: ${rawName}`,
    status: 'active',
    affected_areas: [],
    dependencies: [],
    worktree: { path: toGitPath(destination), branch },
    started_at: nowIso,
    updated_at: nowIso,
    current_state: 'Worktree created; no implementation has started yet.',
    blocked_reason: null,
    notes: 'Registered automatically by scripts/newWorktree.mjs at worktree-creation time.',
  };

  function printManualRegistrationInstructions(reason) {
    console.warn(`[newWorktree] Supervisor registry NOT updated automatically: ${reason}`);
    console.warn('[newWorktree] The worktree itself was still created successfully. To register it manually, review and append this item to .claude/supervisor/registry/work-registry.json (after re-checking the current next_id), or ask the Supervisor agent to do it:');
    console.warn(JSON.stringify(newItem, null, 2));
  }

  // Re-read immediately before writing — the one safeguard against
  // clobbering a concurrent edit. If anything has changed since our first
  // read, back off entirely rather than guessing which version is "right."
  let recheckRaw;
  try {
    recheckRaw = readFileSync(registryPath, 'utf8');
  } catch (error) {
    printManualRegistrationInstructions(`could not re-read the registry immediately before writing (${error.message}).`);
    return;
  }
  if (recheckRaw !== initialRaw) {
    printManualRegistrationInstructions('the registry file changed between read and write (another session is likely editing it concurrently) — refusing to overwrite a change we have not seen.');
    return;
  }

  const updatedParsed = JSON.parse(recheckRaw);
  updatedParsed.items.push(newItem);
  updatedParsed.next_id = initialParsed.next_id + 1;

  try {
    writeFileSync(registryPath, JSON.stringify(updatedParsed, null, 2) + '\n', 'utf8');
  } catch (error) {
    printManualRegistrationInstructions(`failed to write the registry (${error.message}).`);
    return;
  }

  console.log(`[newWorktree] Registered ${newItem.id} in the Supervisor work registry (worker_id: "${workerId}").`);
}

// Only run when invoked directly (`node scripts/newWorktree.mjs`), not
// when imported for its pure helpers — same cross-platform-safe pattern
// scripts/runUnitTests.mjs already establishes.
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
