/**
 * models/CalendarException.js
 *
 * A single date-specific override of the recurring weekly Timetable
 * (models/Timetable.js) — the "school calendar" half of "recurring
 * pattern + calendar exceptions = effective schedule for a date" (see
 * services/schoolCalendarService.js, which is the one place that
 * composition actually happens). This model deliberately never touches
 * `classroom.timetable` itself — a Monday marked as a holiday leaves
 * the real Monday pattern completely intact for every OTHER Monday;
 * only this one dated exception says "not this Monday."
 *
 * Storage: `classroom.schoolCalendar = { exceptions: CalendarException[] }`,
 * embedded directly on the classroom document — the same "small,
 * bounded config field" convention `classroom.timetable` itself already
 * established (see that model's own header comment): a real school
 * year has, realistically, a few dozen holidays/special days, never the
 * unbounded per-date growth Lessons/ScheduledEvents have, so this never
 * needs its own subcollection. This was never a "one Firestore document
 * per day" concern to begin with — there is no per-day Firestore write
 * anywhere in this model or its service — so a multi-day range (below)
 * is naturally still just ONE array entry, exactly like a single day is.
 *
 * DATE RANGES: an exception covers an inclusive `startDate`..`endDate`
 * span (a single day is simply `startDate === endDate`) — this is NOT a
 * second calendar system, just this same one exception object covering
 * more than one date. `date` is kept as a legacy alias (always equal to
 * `startDate`) so any older code path that still reads `.date` directly
 * keeps working unchanged, and so an exception object persisted before
 * this range extension existed (which only ever had `.date`, no
 * `.startDate`/`.endDate`) still round-trips correctly with no migration
 * needed — see services/schoolCalendarService.js's own getExceptionForDate()
 * and validateExceptionRange(), which both fall back to `.date` when
 * `.startDate`/`.endDate` are absent.
 *
 * `type` — exactly two kinds, per explicit product scope (a third kind
 * would be "this date behaves like some OTHER weekday's pattern," which
 * isn't part of this phase):
 *   - HOLIDAY: no normal periods for any date in this range, regardless
 *     of what each date's own weekday would normally have.
 *   - WORKING_DAY: a normally non-working weekday (typically Saturday/
 *     Sunday) becomes a real teaching day for every date in this range.
 *
 * `customPeriods` — ONLY meaningful for WORKING_DAY, and only when the
 * teacher explicitly chose "Customize this day's periods" (see
 * ui/views/TimetableView.js's own School Calendar flow). `null` (the
 * default) means "use whatever recurring pattern this date's own
 * weekday already has" — e.g. a temporary working Saturday with no
 * customPeriods reuses Saturday's own configured recurring periods, if
 * any exist. When set, it's a full, self-contained mini period list —
 * the SAME shape models/Timetable.js's own createTimetableSlot()
 * combined with a period's startTime/endTime already uses (see
 * services/schoolCalendarService.js's own createCustomPeriod()) — never
 * a diff against the recurring pattern, so this one date's own periods
 * stay simple to reason about in isolation.
 *
 * A HOLIDAY exception is never paired with customPeriods — there is
 * nothing to customize when the day has no periods at all;
 * services/schoolCalendarService.js's own setHolidayException() always
 * clears it, and the School Calendar UI never offers the "Customize"
 * step for a Holiday.
 */

import { generateId } from '../utils/idGenerator.js';

export const CALENDAR_EXCEPTION_TYPES = Object.freeze({
  HOLIDAY: 'holiday',
  WORKING_DAY: 'workingDay',
});

/** One custom period for a WORKING_DAY exception's own `customPeriods[]` — mirrors models/Timetable.js's TimetablePeriod + TimetableSlot fields flattened into one row, since a single date's own mini-schedule has no separate "shared period structure" to normalize against. */
export function createCustomPeriod({ periodNumber, startTime, endTime, subjectId = null, teacherUid = null } = {}) {
  return { periodNumber, startTime, endTime, subjectId, teacherUid };
}

/**
 * `date` (legacy, single-day callers) OR `startDate`/`endDate` (a range —
 * pass the same value for both for a single day) may be given; whichever
 * form is provided, all three fields below are always populated so every
 * reader can rely on `startDate`/`endDate` existing, while `.date` stays
 * available for any code that never needed to know about ranges.
 */
export function createCalendarException({ id, date, startDate, endDate, type, reason = '', customPeriods = null } = {}) {
  const resolvedStart = startDate || date;
  const resolvedEnd = endDate || startDate || date;
  return {
    id: id || generateId(),
    date: resolvedStart, // legacy field, kept for any code reading .date directly — always equals startDate
    startDate: resolvedStart, // "YYYY-MM-DD"
    endDate: resolvedEnd, // "YYYY-MM-DD" — equals startDate for a single-day exception
    type, // CALENDAR_EXCEPTION_TYPES value
    reason,
    customPeriods, // null | CustomPeriod[]
  };
}
