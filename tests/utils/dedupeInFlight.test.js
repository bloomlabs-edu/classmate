/**
 * tests/utils/dedupeInFlight.test.js
 *
 * Regression coverage for the duplicate-archive-protection gap found in
 * services/scoreboardArchiveService.js's archiveAndReset(): two
 * overlapping calls for the same classroom (e.g. a double-invoked
 * Reset Scoreboard confirm) previously created two independent
 * Scoreboard Archives, and therefore two separate sets of Winning Team
 * Member Achievement Events, for what should have been a single reset
 * event. createInFlightDeduper() is the fix; these tests exercise the
 * dedup contract directly, since scoreboardArchiveService.js itself
 * cannot be imported under plain `node --test` (it transitively pulls
 * in the Firestore SDK via an https:// specifier).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInFlightDeduper } from '../../js/utils/dedupeInFlight.js';

test('two concurrent calls for the same key run the underlying function exactly once', async () => {
  let runCount = 0;
  const dedupe = createInFlightDeduper();
  const run = () =>
    dedupe('classroom-1', async () => {
      runCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'archive-A';
    });

  const [resultA, resultB] = await Promise.all([run(), run()]);

  assert.equal(runCount, 1);
  assert.equal(resultA, 'archive-A');
  assert.equal(resultB, 'archive-A');
});

test('a later, non-overlapping call for the same key runs its own fresh invocation', async () => {
  let runCount = 0;
  const dedupe = createInFlightDeduper();
  const run = () =>
    dedupe('classroom-1', async () => {
      runCount += 1;
      return `archive-${runCount}`;
    });

  const first = await run();
  const second = await run();

  assert.equal(runCount, 2);
  assert.equal(first, 'archive-1');
  assert.equal(second, 'archive-2');
});

test('two different keys never share a promise, even while both are in flight', async () => {
  let runCount = 0;
  const dedupe = createInFlightDeduper();
  const run = (key) =>
    dedupe(key, async () => {
      runCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return key;
    });

  const [resultA, resultB] = await Promise.all([run('classroom-1'), run('classroom-2')]);

  assert.equal(runCount, 2);
  assert.equal(resultA, 'classroom-1');
  assert.equal(resultB, 'classroom-2');
});

test('a rejected call clears its own key so a retry is not permanently stuck sharing the failed promise', async () => {
  let attempt = 0;
  const dedupe = createInFlightDeduper();
  const run = () =>
    dedupe('classroom-1', async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('write failed');
      return 'archive-succeeded';
    });

  await assert.rejects(run(), /write failed/);
  const result = await run();
  assert.equal(result, 'archive-succeeded');
  assert.equal(attempt, 2);
});

test('three overlapping calls for the same key all resolve to the one real result (simulates a triple-fired reset confirm)', async () => {
  let runCount = 0;
  const dedupe = createInFlightDeduper();
  const run = () =>
    dedupe('classroom-1', async () => {
      runCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { archiveId: 'only-one-archive' };
    });

  const results = await Promise.all([run(), run(), run()]);

  assert.equal(runCount, 1);
  results.forEach((result) => assert.equal(result.archiveId, 'only-one-archive'));
});
