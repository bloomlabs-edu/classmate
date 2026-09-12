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
 *
 * Round 4 adds computeExamOverlayInset() (below) — a second pure
 * helper, same file/same reasoning, that answers a related but
 * distinct question: once groupPeriodsForExamSpanning() has decided
 * WHICH grid rows an exam's card spans, exactly how far should the
 * card's own top/bottom edges sit WITHIN that spanned area so it
 * reflects the event's real clock time rather than simply filling the
 * whole spanned block edge-to-edge? See its own doc comment.
 */
import { parseTimeToMinutes } from '../../services/timetableService.js';

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

/**
 * Given one exam/event (`event`, with its own real `startTime`/
 * `endTime`) and the ordered list of effective periods it suppresses
 * (`coveredPeriods` — the same periods a groupPeriodsForExamSpanning()
 * run collapsed into one spanning grid cell, each with its own real
 * `startTime`/`endTime`), returns `{ topPercent, bottomPercent }`: how
 * far to inset the exam card's own top and bottom edges from the
 * spanned grid area's own top and bottom edges, as a percentage of the
 * total time range those covered periods span.
 *
 * The caller (ui/views/TimetableView.js's renderWeekGrid()) renders the
 * spanned grid cell as a `position: relative` wrapper (it already
 * fills the correct rows via `grid-row: N / span M` — untouched) and
 * the exam card inside it as `position: absolute; top: {topPercent}%;
 * bottom: {bottomPercent}%;` — so the card's visual top/bottom track
 * the event's OWN clock time relative to the periods it overlaps,
 * rather than always filling the full combined height of however many
 * whole periods got suppressed.
 *
 * - The common case — an exam configured to start/end exactly on its
 *   covered periods' own boundaries — yields (approximately) `{ 0, 0 }`,
 *   so the card still fills the spanned area edge-to-edge exactly as
 *   before this fix; this is deliberately visually invisible for that
 *   case.
 * - An exam starting/ending mid-period yields a proportional non-zero
 *   inset on the relevant side.
 * - Malformed/missing input (no event, no covered periods, unparsable
 *   times, or a covered-period time range collapsing to zero width)
 *   clamps gracefully to `{ 0, 0 }` (full spanned area) rather than
 *   throwing or producing NaN/negative/over-100 percentages — the same
 *   "never invents, never crashes on bad input" convention this file's
 *   own header comment already documents for groupPeriodsForExamSpanning().
 * - An event whose own start/end time falls entirely outside every
 *   covered period's own time range clamps to 0%/100% in that
 *   direction (never negative, never over 100).
 */
export function computeExamOverlayInset({ event, coveredPeriods }) {
  const FULL_BLOCK = { topPercent: 0, bottomPercent: 0 };
  if (!event || !Array.isArray(coveredPeriods) || coveredPeriods.length === 0) return FULL_BLOCK;

  const sortedByStartTime = [...coveredPeriods].sort((a, b) => {
    const aStart = parseTimeToMinutes(a.startTime);
    const bStart = parseTimeToMinutes(b.startTime);
    if (aStart == null || bStart == null) return 0;
    return aStart - bStart;
  });

  const rangeStart = parseTimeToMinutes(sortedByStartTime[0].startTime);
  const rangeEnd = parseTimeToMinutes(sortedByStartTime[sortedByStartTime.length - 1].endTime);
  const eventStart = parseTimeToMinutes(event.startTime);
  const eventEnd = parseTimeToMinutes(event.endTime);

  if (rangeStart == null || rangeEnd == null || eventStart == null || eventEnd == null) return FULL_BLOCK;

  const totalMinutes = rangeEnd - rangeStart;
  if (totalMinutes <= 0) return FULL_BLOCK;

  return {
    topPercent: clampPercent(((eventStart - rangeStart) / totalMinutes) * 100),
    bottomPercent: clampPercent(((rangeEnd - eventEnd) / totalMinutes) * 100),
  };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
