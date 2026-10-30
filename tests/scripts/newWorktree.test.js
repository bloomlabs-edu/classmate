/**
 * tests/scripts/newWorktree.test.js
 *
 * Regression coverage for the independent review fixes to
 * scripts/newWorktree.mjs:
 *   1. Strict argument parsing (parseArgs) — the confirmed defect where
 *      `node scripts/newWorktree.mjs my task name` silently created a
 *      worktree/branch named "my", discarding "task"/"name" entirely.
 *   2. Windows path-length protection (checkDestinationPathLength).
 *   3. Platform-aware, case-insensitive-on-Windows path comparison
 *      (pathsEqual/isPathInside).
 *
 * Exercises only the pure, exported functions — never spawns git, never
 * touches the filesystem or any real worktree, matching this task's own
 * "use temporary isolated repositories or safe test fixtures; never
 * create or delete existing user worktrees as part of testing" rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  checkDestinationPathLength,
  normalizePathForComparison,
  pathsEqual,
  isPathInside,
  ALLOWED_TYPES,
  WINDOWS_SAFE_PATH_LENGTH,
} from '../../scripts/newWorktree.mjs';

// ---------------------------------------------------------------------
// parseArgs — the headline fix
// ---------------------------------------------------------------------

test('parseArgs: THE CONFIRMED DEFECT — multiple positional arguments ("my task name") are REJECTED, never silently collapsed to the first one', () => {
  const result = parseArgs(['my', 'task', 'name']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Expected exactly one task name, got 3/);
  assert.match(result.error, /"my", "task", "name"/);
  // Suggests the likely fix (hyphen-joined) rather than just rejecting.
  assert.match(result.error, /my-task-name/);
});

test('parseArgs: exactly two positional arguments are also rejected (not just 3+)', () => {
  const result = parseArgs(['foo', 'bar']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Expected exactly one task name, got 2/);
});

test('parseArgs: missing task name is rejected with the usage message', () => {
  const result = parseArgs([]);
  assert.equal(result.ok, false);
  assert.match(result.error, /Missing task name/);
  assert.match(result.error, /Usage: node scripts\/newWorktree\.mjs/);
});

test('parseArgs: missing task name when only flags are given is still rejected (flags alone are not a task name)', () => {
  const result = parseArgs(['--type=fix', '--no-register']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Missing task name/);
});

test('parseArgs: an unknown flag is rejected, never silently ignored', () => {
  const result = parseArgs(['valid-name', '--bogus']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown or malformed option\(s\): --bogus/);
});

test('parseArgs: a known flag name used without its required "=value" is rejected as malformed, not silently defaulted', () => {
  const result = parseArgs(['valid-name', '--type']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown or malformed option\(s\): --type/);
});

test('parseArgs: multiple unknown/malformed flags are all named in the error, not just the first', () => {
  const result = parseArgs(['valid-name', '--bogus', '--also-bad']);
  assert.equal(result.ok, false);
  assert.match(result.error, /--bogus, --also-bad/);
});

test('parseArgs: a valid task name with no options uses the documented defaults', () => {
  const result = parseArgs(['student-progress-widget']);
  assert.equal(result.ok, true);
  assert.equal(result.value.rawName, 'student-progress-widget');
  assert.equal(result.value.type, 'feature');
  assert.equal(result.value.workerId, 'unknown');
  assert.equal(result.value.taskDescription, null);
  assert.equal(result.value.skipRegister, false);
  assert.equal(result.value.help, false);
});

test('parseArgs: a valid task name with every supported option set', () => {
  const result = parseArgs(['holiday-list-fix', '--type=fix', '--worker-id=agent:test-session', '--task=Fix the holiday list rendering bug', '--no-register']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    help: false,
    rawName: 'holiday-list-fix',
    type: 'fix',
    workerId: 'agent:test-session',
    taskDescription: 'Fix the holiday list rendering bug',
    skipRegister: true,
  });
});

test('parseArgs: flags may appear before OR after the positional task name', () => {
  const before = parseArgs(['--type=investigation', 'term-textbooks-audit']);
  const after = parseArgs(['term-textbooks-audit', '--type=investigation']);
  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  assert.equal(before.value.type, 'investigation');
  assert.equal(after.value.type, 'investigation');
});

test('parseArgs: every ALLOWED_TYPES value is accepted, anything else is rejected', () => {
  for (const type of ALLOWED_TYPES) {
    const result = parseArgs(['some-task', `--type=${type}`]);
    assert.equal(result.ok, true, `expected --type=${type} to be accepted`);
  }
  const rejected = parseArgs(['some-task', '--type=refactor']);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Unsupported --type "refactor"/);
});

test('parseArgs: invalid task name formats are rejected (uppercase, underscore, leading hyphen, empty-after-flags-stripped)', () => {
  assert.equal(parseArgs(['UpperCase']).ok, false);
  assert.equal(parseArgs(['snake_case']).ok, false);
  assert.equal(parseArgs(['-leading-hyphen']).ok, false);
  assert.equal(parseArgs(['trailing-space ']).ok, false); // the trailing space itself is not in [a-z0-9-]
});

test('parseArgs: a valid task name is accepted (sanity check the regex itself is not overly strict)', () => {
  assert.equal(parseArgs(['a']).ok, true); // single character
  assert.equal(parseArgs(['task-with-many-hyphens-123']).ok, true);
});

test('parseArgs: --help / -h short-circuits everything else, even with other (otherwise invalid) arguments present', () => {
  assert.deepEqual(parseArgs(['--help']), { ok: true, value: { help: true } });
  assert.deepEqual(parseArgs(['-h']), { ok: true, value: { help: true } });
  assert.deepEqual(parseArgs(['too', 'many', 'args', '--help']), { ok: true, value: { help: true } });
});

test('parseArgs: an empty --worker-id or --task value falls back to the documented default (distinct from an invalid --type, which is always rejected)', () => {
  const result = parseArgs(['some-task', '--worker-id=', '--task=']);
  assert.equal(result.ok, true);
  assert.equal(result.value.workerId, 'unknown');
  assert.equal(result.value.taskDescription, null);
});

test('parseArgs: a --task value containing "=" is preserved in full, not truncated at the first "="', () => {
  const result = parseArgs(['some-task', '--task=Fix a=b edge case']);
  assert.equal(result.ok, true);
  assert.equal(result.value.taskDescription, 'Fix a=b edge case');
});

// ---------------------------------------------------------------------
// checkDestinationPathLength — Windows path-length protection
// ---------------------------------------------------------------------

test('checkDestinationPathLength: a short path is accepted on win32', () => {
  const result = checkDestinationPathLength('C:/Users/someone/GitHub/classmate-short-task', 'win32');
  assert.equal(result.ok, true);
});

test('checkDestinationPathLength: a path exactly at the limit is accepted (boundary is inclusive)', () => {
  const exact = 'C:/'.padEnd(WINDOWS_SAFE_PATH_LENGTH, 'a');
  assert.equal(exact.length, WINDOWS_SAFE_PATH_LENGTH);
  const result = checkDestinationPathLength(exact, 'win32');
  assert.equal(result.ok, true);
});

test('checkDestinationPathLength: a path one character over the limit is rejected on win32, with a clear, actionable message', () => {
  const tooLong = 'C:/'.padEnd(WINDOWS_SAFE_PATH_LENGTH + 1, 'a');
  const result = checkDestinationPathLength(tooLong, 'win32');
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(`${WINDOWS_SAFE_PATH_LENGTH + 1} characters long`));
  assert.match(result.error, /Pick a shorter task name/);
  assert.match(result.error, /Path: /);
});

test('checkDestinationPathLength: the SAME long path is NEVER rejected on a non-Windows platform — platform-aware, not a blanket limit', () => {
  const veryLong = 'a'.repeat(500);
  assert.equal(checkDestinationPathLength(veryLong, 'linux').ok, true);
  assert.equal(checkDestinationPathLength(veryLong, 'darwin').ok, true);
});

// ---------------------------------------------------------------------
// normalizePathForComparison / pathsEqual / isPathInside — platform-
// aware path normalization
// ---------------------------------------------------------------------

test('pathsEqual: identical paths are equal on every platform', () => {
  assert.equal(pathsEqual('C:/Users/Foo/Bar', 'C:/Users/Foo/Bar', 'win32'), true);
  assert.equal(pathsEqual('/home/foo/bar', '/home/foo/bar', 'linux'), true);
});

test('pathsEqual: on win32, differently-cased paths that refer to the same real path ARE equal (case-insensitive filesystem)', () => {
  assert.equal(pathsEqual('C:/Users/Foo/classmate-bar', 'c:/users/foo/CLASSMATE-BAR', 'win32'), true);
});

test('pathsEqual: on a case-SENSITIVE platform (linux/darwin), the same differently-cased paths are correctly NOT equal', () => {
  assert.equal(pathsEqual('/Users/Foo/classmate-bar', '/users/foo/CLASSMATE-BAR', 'linux'), false);
});

test('pathsEqual: backslash vs forward-slash separators are normalized identically on win32', () => {
  assert.equal(pathsEqual('C:\\Users\\Foo\\Bar', 'C:/Users/Foo/Bar', 'win32'), true);
});

test('pathsEqual: genuinely different paths are never equal, on any platform', () => {
  assert.equal(pathsEqual('C:/Users/Foo/Bar', 'C:/Users/Foo/Baz', 'win32'), false);
});

test('isPathInside: a direct child path is inside its parent', () => {
  assert.equal(isPathInside('C:/repo/sub', 'C:/repo', 'win32'), true);
});

test('isPathInside: the parent itself counts as "inside" (self-containment)', () => {
  assert.equal(isPathInside('C:/repo', 'C:/repo', 'win32'), true);
});

test('isPathInside: a sibling whose name merely starts with the parent\'s name is NEVER a false match (the classic "foo-bar starts with foo" bug)', () => {
  assert.equal(isPathInside('C:/classroom-tracker-other', 'C:/classroom-tracker', 'win32'), false);
  assert.equal(isPathInside('C:/classroom-trackerX/sub', 'C:/classroom-tracker', 'win32'), false);
});

test('isPathInside: on win32, case differences between child and parent still correctly detect containment', () => {
  assert.equal(isPathInside('c:/classroom-tracker/sub/dir', 'C:/CLASSROOM-TRACKER', 'win32'), true);
});

test('isPathInside: on a case-sensitive platform, a case mismatch correctly does NOT count as containment', () => {
  assert.equal(isPathInside('/classroom-tracker/sub', '/CLASSROOM-TRACKER', 'linux'), false);
});

test('isPathInside: an unrelated, non-nested directory is never "inside"', () => {
  assert.equal(isPathInside('C:/Users/Foo/other-project', 'C:/Users/Foo/classroom-tracker', 'win32'), false);
});
