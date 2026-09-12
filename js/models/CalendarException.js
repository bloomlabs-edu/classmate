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
 * needs its own subcollection.
 *
 * `type` — exactly two kinds, per explicit product scope (a third kind
 * would be "this date behaves like some OTHER weekday's pattern," which
 * isn't part of this phase):
 *   - HOLIDAY: no normal periods on this date at all, regardless of
 *     what its own weekday would normally have.
 *   - WORKING_DAY: a normally non-working weekday (typically Saturday/
 *     Sunday) becomes a real teaching day this once.
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

export function createCalendarException({ id, date, type, reason = '', customPeriods = null } = {}) {
  return {
    id: id || generateId(),
    date, // "YYYY-MM-DD"
    type, // CALENDAR_EXCEPTION_TYPES value
    reason,
    customPeriods, // null | CustomPeriod[]
  };
}
