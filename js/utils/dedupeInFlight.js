/**
 * utils/dedupeInFlight.js
 *
 * A tiny, dependency-free concurrency guard: given a key and an async
 * function, ensures at most one call for that key is ever running at
 * once — a second, overlapping call for the same key joins the first
 * call's own promise instead of starting a second one. Once the first
 * call settles (success or failure), the key is cleared, so a later,
 * non-overlapping call for the same key runs its own fresh invocation.
 *
 * Extracted as its own pure module (no Firestore/DOM import) so the
 * dedup contract itself is directly unit-testable under plain
 * `node --test`, matching this project's own established convention of
 * pulling load-bearing pure logic out of anything that would otherwise
 * require mocking Firestore to exercise at all (see
 * services/achievementEngine.js's own header comment for the same
 * reasoning applied elsewhere). Used by
 * services/scoreboardArchiveService.js's archiveAndReset() to prevent
 * two overlapping calls for the same classroom from creating two
 * Scoreboard Archives (and therefore two sets of Achievement Events)
 * for what should be a single reset event — see that file's own
 * comment for the full same-tab-only scope of this guard.
 */
export function createInFlightDeduper() {
  const inFlight = new Map(); // key -> in-flight Promise

  return function runDeduped(key, fn) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = fn().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
