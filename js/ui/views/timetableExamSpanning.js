/**
 * ui/views/timetableExamSpanning.js
 *
 * Pure, DOM-free helper backing TimetableView.js's renderWeekGrid().
 * Extracted specifically so the "which periods draw as one continuous
 * exam block" decision is unit-testable in this repo's Node test
 * runner, which has no DOM library (same pattern as
 * ui/components/TimePickerState.js and this project's own
 * tests/ui/programmeSessionView.test.js).
 *
 * Before this fix, renderWeekGrid()'s per-period loop rendered a
 * SEPARATE renderExamCard(event) in its own single-row grid cell for
 * EVERY period a multi-period exam happened to suppress — a 3-period
 * exam drew as 3 identical, visually-separate cards stacked with gaps
 * between them. This module groups a day's ordered periods into
 * rendering "runs" so the caller can instead render ONE card per run,
 * spanning `length` grid rows (mirroring the exact same
 * `grid-row: N / span M` technique renderWeekGrid() already uses for
 * its day-level Holiday block).
 *
 * This is a pure rendering-loop concern: it never creates, mutates, or
 * duplicates a ScheduledEvent, and never touches the effective-
 * schedule engine (getEffectiveScheduleForDate()) that already
 * computed each period's own `suppressedByEventId` — it only reads
 * that field to decide how to GROUP already-computed periods for
 * drawing.
 */

/**
 * `periods`: the classroom's ordered TimetablePeriods for one day
 *   (each has `periodNumber`) — services/timetableService.js's own
 *   getPeriods().
 * `effectivePeriods`: that same date's `schedule.periods` from
 *   getEffectiveScheduleForDate() (each has `periodNumber` and,
 *   possibly, `suppressedByEventId`).
 *
 * Returns an array of `{ startIndex, length, suppressedByEventId }` in
 * period order, covering every index into `periods` exactly once.
 * Consecutive periods sharing the same non-null `suppressedByEventId`
 * are merged into one run (`length > 1`); everything else — a normal
 * period, an empty period, or an exam that only suppresses a single
 * period — is its own `length === 1` run.
 */
export function groupPeriodsForExamSpanning(periods, effectivePeriods) {
  const groups = [];
  periods.forEach((period, index) => {
    const effectivePeriod = effectivePeriods.find((p) => p.periodNumber === period.periodNumber);
    const suppressedByEventId = effectivePeriod?.suppressedByEventId || null;
    const previous = groups[groups.length - 1];
    if (suppressedByEventId && previous && previous.suppressedByEventId === suppressedByEventId) {
      previous.length += 1;
    } else {
      groups.push({ startIndex: index, length: 1, suppressedByEventId });
    }
  });
  return groups;
}
