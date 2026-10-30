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
 *
 * Example:
 *   node scripts/newWorktree.mjs student-progress-widget
 *   -> branch:    feature/student-progress-widget
 *   -> worktree:  ../classmate-student-progress-widget
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_TYPES = ['feature', 'investigation', 'fix'];
const EXPECTED_REMOTE_FRAGMENT = 'bloomlabs-edu/classmate';

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
// 1. Parse + validate arguments
// ---------------------------------------------------------------------

const args = process.argv.slice(2);
const rawName = args.find((a) => !a.startsWith('--'));
const typeArg = args.find((a) => a.startsWith('--type='));
const workerIdArg = args.find((a) => a.startsWith('--worker-id='));
const taskArg = args.find((a) => a.startsWith('--task='));
const skipRegister = args.includes('--no-register');

const type = typeArg ? typeArg.split('=')[1] : 'feature';
const workerId = workerIdArg ? workerIdArg.split('=').slice(1).join('=') : 'unknown';
const taskDescription = taskArg ? taskArg.split('=').slice(1).join('=') : null;

if (!rawName) {
  fail('Usage: node scripts/newWorktree.mjs <short-task-name> [--type=feature|investigation|fix] [--worker-id=<id>] [--task="description"] [--no-register]');
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(rawName)) {
  fail(`Task name must be lowercase, alphanumeric, hyphen-separated (got "${rawName}").`);
}
if (!ALLOWED_TYPES.includes(type)) {
  fail(`Unsupported --type "${type}". Allowed: ${ALLOWED_TYPES.join(', ')}.`);
}

// ---------------------------------------------------------------------
// 2. Repository validation — confirm we're really in the ClassMate repo,
//    and resolve the PRIMARY checkout regardless of which worktree this
//    script happens to be invoked from.
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
// 3. Destination validation — a sibling of the PRIMARY checkout, never
//    nested inside it, never an existing path.
// ---------------------------------------------------------------------

const branch = `${type}/${rawName}`;
const destination = path.resolve(primaryWorktreeRoot, '..', `classmate-${rawName}`);

if (destination === primaryWorktreeRoot || destination.startsWith(primaryWorktreeRoot + path.sep)) {
  fail(`Computed destination (${destination}) is inside the primary checkout (${primaryWorktreeRoot}) — refusing. This should not be reachable; report this as a bug.`);
}
if (existsSync(destination)) {
  fail(`Refusing to proceed: ${destination} already exists. Pick a different task name, or remove it yourself first if it's genuinely stale. This script never deletes or reuses an existing directory.`);
}

// ---------------------------------------------------------------------
// 4. Branch validation — local, remote, AND existing worktree
//    registrations (git worktree list can, in principle, diverge from
//    plain `git branch --list` — e.g. a detached-HEAD worktree — so both
//    are checked independently rather than assuming one implies the
//    other).
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
  if (entryPath === destination) {
    fail(`Refusing to proceed: "git worktree list" already has a registration at ${destination}, even though the directory doesn't currently exist on disk. Run "git worktree prune" yourself first if this is genuinely stale — this script will not do it for you.`);
  }
  if (entryBranch === branch) {
    fail(`Refusing to proceed: branch "${branch}" is already checked out in another worktree (${entryPath}). This script never reuses a branch that's already checked out elsewhere.`);
  }
}

// ---------------------------------------------------------------------
// 5. Fresh base requirement — origin/main, fetched just now, no fallback
//    to a possibly-stale local `main` under any circumstance.
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
// 6. Create the worktree + branch together, off origin/main exactly.
// ---------------------------------------------------------------------

try {
  run(['worktree', 'add', '-b', branch, toGitPath(destination), 'origin/main'], { cwd: primaryWorktreeRoot });
} catch (error) {
  fail(`git worktree add failed: ${error.message}`);
}

// ---------------------------------------------------------------------
// 7. Post-creation verification — never trust that step 6 "probably
//    worked." If any of these disagree, STOP and report; never attempt
//    to automatically remove what was just created.
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
  return pathLine && path.resolve(pathLine.slice('worktree '.length)) === destination;
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
// 8. Supervisor registry registration (best-effort, optional) — reuses
//    the EXISTING schema at .claude/supervisor/registry/work-registry.json
//    (see that directory's own SCHEMA.md), never a new/competing
//    coordination file. Uses an optimistic-concurrency check (re-read
//    immediately before writing) as its only safety mechanism — this is
//    NOT a real file lock, so if another session has touched the
//    registry between our read and write, this step backs off entirely
//    and prints the entry for manual/Supervisor registration instead,
//    rather than risking an overwrite of someone else's concurrent edit.
// ---------------------------------------------------------------------

if (skipRegister) {
  console.log('[newWorktree] --no-register given: skipping Supervisor registry update.');
  process.exit(0);
}

const registryPath = path.join(primaryWorktreeRoot, '.claude', 'supervisor', 'registry', 'work-registry.json');
if (!existsSync(registryPath)) {
  console.log('[newWorktree] No Supervisor registry found at .claude/supervisor/registry/work-registry.json — skipping registration.');
  process.exit(0);
}

let initialRaw;
let initialParsed;
try {
  initialRaw = readFileSync(registryPath, 'utf8');
  initialParsed = JSON.parse(initialRaw);
} catch (error) {
  console.warn(`[newWorktree] Could not read/parse the Supervisor registry (${error.message}) — skipping registration. The worktree itself was still created successfully.`);
  process.exit(0);
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
  process.exit(0);
}
if (recheckRaw !== initialRaw) {
  printManualRegistrationInstructions('the registry file changed between read and write (another session is likely editing it concurrently) — refusing to overwrite a change we have not seen.');
  process.exit(0);
}

const updatedParsed = JSON.parse(recheckRaw);
updatedParsed.items.push(newItem);
updatedParsed.next_id = initialParsed.next_id + 1;

try {
  writeFileSync(registryPath, JSON.stringify(updatedParsed, null, 2) + '\n', 'utf8');
} catch (error) {
  printManualRegistrationInstructions(`failed to write the registry (${error.message}).`);
  process.exit(0);
}

console.log(`[newWorktree] Registered ${newItem.id} in the Supervisor work registry (worker_id: "${workerId}").`);
