/**
 * ui/views/timetableExamSpanning.js
 *
 * Pure, DOM-free helpers backing TimetableView.js's renderWeekGrid()
 * and renderDayGrid(). Extracted specifically so these decisions are
 * unit-testable in this repo's Node test runner, which has no DOM
 * library (same pattern as ui/components/TimePickerState.js and this
 * project's own tests/ui/programmeSessionView.test.js).
 *
 * Before this fix, renderWeekGrid()'s per-period loop rendered a
 * SEPARATE renderExamCard(event) in its own single-row grid cell for
 * EVERY period a multi-period exam happened to suppress — a 3-period
 * exam drew as 3 identical, visually-separate cards stacked with gaps
 * between them. groupPeriodsForExamSpanning() (below) groups a day's
 * ordered periods into rendering "runs" so the caller can instead
 * render ONE card per run, spanning `length` grid rows (mirroring the
 * exact same `grid-row: N / span M` technique renderWeekGrid() already
 * uses for its day-level Holiday block).
 *
 * This is a pure rendering-loop concern: it never creates, mutates, or
 * duplicates a ScheduledEvent, and never touches the effective-
 * schedule engine (getEffectiveScheduleForDate()) that already
 * computed each period's own `suppressedByEventId` — it only reads
 * that field to decide how to GROUP already-computed periods for
 * drawing.
 *
 * ROUND 5 rewrite — the geometry problem. Round 4 added
 * computeExamOverlayInset(), which positioned an exam card via CSS
 * `top`/`bottom` PERCENTAGES inside the spanned grid cell it occupied.
 * That cell's own rendered height was governed by
 * `grid-template-rows: auto repeat(N, min-content)` — i.e. purely by
 * whatever content happened to occupy ANY column sharing those row
 * tracks (CSS Grid row tracks are shared across the whole grid, not
 * per-column). A percentage of a content-driven, non-time-proportional
 * dimension is not a time-accurate position at all — if a lesson
 * elsewhere in the same row(s) grew taller (more concepts), the exam's
 * percentage-based inset silently drifted with it. This was a real,
 * reported bug; two correction attempts before this one did not fully
 * resolve it.
 *
 * The fix (see computeEventOverlayGeometry() below): an exam's pixel
 * geometry is now computed via a FIXED pixels-per-minute scale against
 * a fixed "day axis start" (the earliest period's own start time),
 * never against any rendered/measured dimension. These functions take
 * only plain time fields and a constant as input — there is no
 * row-height, DOM, or "other periods' content" parameter for them to
 * even read — so content-height-independence holds BY CONSTRUCTION,
 * not by convention.
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
 * The fixed content-independent scale every exam-overlay pixel
 * computation below is built from. Chosen so a typical ~40-45 minute
 * period's time-proportional baseline height (see
 * computePeriodDurationMinutes() below, used for the grid's own
 * per-period row minimums) lands close to this app's pre-existing
 * default row height (~90-110px) — a tunable visual constant, not a
 * value with any deeper meaning.
 */
export const PIXELS_PER_MINUTE = 2.2;

/** A graceful floor for a period/row whose own start/end time can't be parsed at all — never NaN, never 0 (a genuinely zero-height row would be indistinguishable from "not rendered"). */
export const FALLBACK_ROW_MIN_PX = 64;

/**
 * A period's (or, since it duck-types on the same `startTime`/
 * `endTime` field names, an event's) own real duration in minutes, or
 * `null` when either time is missing/unparsable or the range is
 * zero/negative width — never NaN, never negative.
 */
export function computePeriodDurationMinutes(period) {
  const start = parseTimeToMinutes(period?.startTime);
  const end = parseTimeToMinutes(period?.endTime);
  if (start == null || end == null || end <= start) return null;
  return end - start;
}

/**
 * The fixed "zero point" of a day's time axis for overlay geometry —
 * the earliest of `periods`' own `startTime` (in minutes). `periods`
 * here is the classroom's ordinary recurring period list (Week view
 * shares this same axis across every date column, matching Week
 * view's existing "shared period-ROW structure" scope boundary — see
 * TimetableView.js's own doc comment on that). Returns `0` when no
 * period has a parsable start time, rather than throwing or NaN.
 */
export function computeDayAxisStartMinutes(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return 0;
  const starts = periods.map((p) => parseTimeToMinutes(p?.startTime)).filter((m) => m != null);
  if (starts.length === 0) return 0;
  return Math.min(...starts);
}

/**
 * The day axis's own end point — the latest of `periods`' own
 * `endTime` (in minutes), or `null` when none parse. Used only to
 * clamp an event that runs past the last configured period (case 8 in
 * this round's own test list) — never to scale/normalize anything
 * (that would reintroduce the exact "percentage of a variable range"
 * bug this rewrite removes).
 */
export function computeDayAxisEndMinutes(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const ends = periods.map((p) => parseTimeToMinutes(p?.endTime)).filter((m) => m != null);
  if (ends.length === 0) return null;
  return Math.max(...ends);
}

/**
 * The core fix. Given one exam/event (`event`, with its own real
 * `startTime`/`endTime`) and the day's fixed axis start (
 * `dayAxisStartMinutes`, from computeDayAxisStartMinutes() above),
 * returns `{ topPx, heightPx }`: the exam overlay's absolute pixel top
 * offset and height, measured from the day axis's own zero point.
 *
 * Pure arithmetic — `event.startTime`/`endTime` and the two axis/scale
 * inputs are the ONLY things this function reads. There is no
 * row-height, rendered-dimension, or "what else is in this day"
 * parameter for it to depend on, so two calls with the same event and
 * the same axis inputs always produce bit-for-bit identical output,
 * regardless of anything else happening elsewhere in the day/week —
 * this is the content-independence invariant this round exists to
 * guarantee.
 *
 * `dayAxisEndMinutes` (optional, from computeDayAxisEndMinutes()) only
 * clamps an event that runs past the day's last configured period —
 * never used to scale/normalize the result.
 *
 * Malformed/missing input (no event, unparsable start/end time, an
 * end time at or before the start) clamps to `{ topPx: 0, heightPx: 0 }`
 * rather than throwing or producing NaN/negative geometry. An event
 * starting before the day axis's own start clamps its start to the
 * axis start (never a negative topPx); an event ending after
 * `dayAxisEndMinutes` (when provided) clamps its end there.
 */
export function computeEventOverlayGeometry({ event, dayAxisStartMinutes, dayAxisEndMinutes = null, pixelsPerMinute = PIXELS_PER_MINUTE }) {
  const FALLBACK = { topPx: 0, heightPx: 0 };
  if (!event) return FALLBACK;

  const axisStart = Number.isFinite(dayAxisStartMinutes) ? dayAxisStartMinutes : 0;
  let eventStart = parseTimeToMinutes(event.startTime);
  let eventEnd = parseTimeToMinutes(event.endTime);
  if (eventStart == null || eventEnd == null || eventEnd <= eventStart) return FALLBACK;

  // Clamp to the day's own real axis — an event configured (or, for a
  // malformed one, misconfigured) outside the day's own period range
  // renders at the nearest honest edge rather than off-axis/negative.
  if (eventStart < axisStart) eventStart = axisStart;
  if (Number.isFinite(dayAxisEndMinutes) && eventEnd > dayAxisEndMinutes) eventEnd = dayAxisEndMinutes;
  if (eventEnd < eventStart) eventEnd = eventStart;

  return {
    topPx: (eventStart - axisStart) * pixelsPerMinute,
    heightPx: (eventEnd - eventStart) * pixelsPerMinute,
  };
}
