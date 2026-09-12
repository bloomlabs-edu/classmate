/**
 * services/schoolCalendarService.js
 *
 * The one place "recurring weekly Timetable + calendar exceptions +
 * date-specific Scheduled Events -> effective schedule for a real date"
 * actually happens — every consumer (the Dashboard's Today's Schedule,
 * ui/views/TimetableView.js's Week/Day/Calendar views) derives from
 * these same functions rather than each re-implementing its own
 * holiday/exam logic. Pure and dependency-free (no Firestore import),
 * matching services/timetableService.js's own established convention —
 * `classroom.schoolCalendar` is mutated in place here exactly like
 * `classroom.timetable` already is by that file, with the caller still
 * responsible for persisting afterward (services/workspaceService.js's
 * save()).
 *
 * THE CENTRAL PRINCIPLE (see this feature's own architecture brief):
 * the recurring weekly Timetable is NEVER modified by a calendar
 * exception. Marking Monday 14 Sep a holiday adds one dated exception
 * document; the real Monday pattern in classroom.timetable stays
 * completely untouched, still fully intact for every other Monday.
 * Every function below reads the recurring pattern fresh each time
 * (via services/timetableService.js) and only ever OVERLAYS an
 * exception on top of that read — it never writes into
 * classroom.timetable itself.
 */

import { createCalendarException, CALENDAR_EXCEPTION_TYPES } from '../models/CalendarException.js';
import * as timetableService from './timetableService.js';
import { toDateKey, shiftDateKey } from '../utils/dateHelpers.js';

function ensureSchoolCalendar(classroom) {
  if (!classroom.schoolCalendar) classroom.schoolCalendar = { exceptions: [] };
  if (!Array.isArray(classroom.schoolCalendar.exceptions)) classroom.schoolCalendar.exceptions = [];
  return classroom.schoolCalendar;
}

/** Every calendar exception this classroom has, ordered by date. An empty array is a real, valid state (no exceptions configured yet) — never fabricated. */
export function getCalendarExceptions(classroom) {
  return [...ensureSchoolCalendar(classroom).exceptions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The one exception (if any) for a specific date — a date can have at most one, enforced by setHolidayException()/setWorkingDayException() below always replacing rather than appending. */
export function getExceptionForDate(classroom, dateKey) {
  return ensureSchoolCalendar(classroom).exceptions.find((exception) => exception.date === dateKey) || null;
}

function upsertException(classroom, exception) {
  const schoolCalendar = ensureSchoolCalendar(classroom);
  const index = schoolCalendar.exceptions.findIndex((existing) => existing.date === exception.date);
  if (index === -1) {
    schoolCalendar.exceptions.push(exception);
  } else {
    schoolCalendar.exceptions[index] = exception;
  }
  return exception;
}

/** Marks `dateKey` as a Holiday/non-working day — no normal periods that date, regardless of what its own weekday would normally have. Replaces any existing exception for this date (a date is Holiday, Working Day, or Normal — never two at once). */
export function setHolidayException(classroom, dateKey, reason = '') {
  return upsertException(classroom, createCalendarException({ date: dateKey, type: CALENDAR_EXCEPTION_TYPES.HOLIDAY, reason, customPeriods: null }));
}

/** Marks `dateKey` as a temporary/special Working Day. `customPeriods` (see models/CalendarException.js) is null unless the teacher explicitly customized this date's own periods — omitting it means "use this weekday's own recurring pattern, if any." */
export function setWorkingDayException(classroom, dateKey, reason = '', customPeriods = null) {
  return upsertException(classroom, createCalendarException({ date: dateKey, type: CALENDAR_EXCEPTION_TYPES.WORKING_DAY, reason, customPeriods }));
}

/** Removes any exception for `dateKey`, returning it to Normal (whatever its own weekday's recurring pattern says). */
export function clearException(classroom, dateKey) {
  const schoolCalendar = ensureSchoolCalendar(classroom);
  schoolCalendar.exceptions = schoolCalendar.exceptions.filter((exception) => exception.date !== dateKey);
}

/** Whether this weekday (0=Sun..6=Sat) has ANY recurring periods configured at all — the baseline "is this normally a working day" fact, before any calendar exception is considered. Reuses services/timetableService.js's own getSlotsForWeekday() — never a second definition of "working weekday" (mirrors services/personalHubService.js's own isWorkingDay(), scoped to one classroom instead of "any of several"). */
export function isNormallyWorkingWeekday(classroom, weekday) {
  return timetableService.getSlotsForWeekday(classroom, weekday).length > 0;
}

/**
 * The resolved working-day status for one real date — baseline weekday
 * fact, overridden by whatever calendar exception (if any) exists for
 * it. This is the ONE function every other "is this a working day"
 * question in this file (and its callers) goes through.
 */
export function getWorkingDayStatus(classroom, dateKey) {
  const exception = getExceptionForDate(classroom, dateKey);

  if (exception?.type === CALENDAR_EXCEPTION_TYPES.HOLIDAY) {
    return { isWorkingDay: false, exceptionType: CALENDAR_EXCEPTION_TYPES.HOLIDAY, reason: exception.reason, exception };
  }
  if (exception?.type === CALENDAR_EXCEPTION_TYPES.WORKING_DAY) {
    return { isWorkingDay: true, exceptionType: CALENDAR_EXCEPTION_TYPES.WORKING_DAY, reason: exception.reason, exception };
  }

  const weekday = timetableService.weekdayOfDateKey(dateKey);
  return { isWorkingDay: isNormallyWorkingWeekday(classroom, weekday), exceptionType: null, reason: '', exception: null };
}

/**
 * The effective list of periods for one real date — [] for a non-
 * working day (Holiday, or a normally-non-working weekday with no
 * override), the recurring pattern's own periods for an ordinary
 * working day, or a Working-Day exception's own `customPeriods` when
 * explicitly set. Always ordered by periodNumber.
 *
 * Matches services/timetableService.js's own getConcreteSlotsForDateRange()
 * convention exactly for the ordinary case: only periods that actually
 * have a subject assigned appear — a (weekday, periodNumber) with no
 * slot is "no class," not an empty row.
 */
export function getEffectivePeriodsForDate(classroom, dateKey) {
  const status = getWorkingDayStatus(classroom, dateKey);
  if (!status.isWorkingDay) return [];

  if (status.exceptionType === CALENDAR_EXCEPTION_TYPES.WORKING_DAY && status.exception.customPeriods) {
    return [...status.exception.customPeriods].sort((a, b) => a.periodNumber - b.periodNumber);
  }

  const weekday = timetableService.weekdayOfDateKey(dateKey);
  const periods = timetableService.getPeriods(classroom);
  return periods
    .map((period) => {
      const slot = timetableService.getSlot(classroom, weekday, period.periodNumber);
      if (!slot) return null;
      return { periodNumber: period.periodNumber, startTime: period.startTime, endTime: period.endTime, subjectId: slot.subjectId, teacherUid: slot.teacherUid ?? null };
    })
    .filter(Boolean);
}

/**
 * The next real date on/after `fromDateKey` (inclusive) whose effective
 * schedule is a working day — what "skip the weekend, skip Monday's
 * holiday, land on Tuesday" resolves to (see this feature's own worked
 * example). Bounded by `horizonDays` (default 120 — comfortably beyond
 * a single term) so a misconfigured classroom with no working weekday
 * at all returns `null` rather than scanning forever.
 */
export function getNextWorkingDate(classroom, fromDateKey, { horizonDays = 120 } = {}) {
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const dateKey = shiftDateKey(fromDateKey, offset);
    if (getWorkingDayStatus(classroom, dateKey).isWorkingDay) return dateKey;
  }
  return null;
}

/**
 * Whether two "HH:mm"-based time ranges overlap at all (touching
 * exactly at an edge, e.g. one ending 10:30 and the next starting
 * 10:30, does NOT count as overlapping — the same "half-open interval"
 * convention a real school day already uses: Period 2 starting the
 * instant Period 1 ends is normal back-to-back scheduling, not a
 * conflict).
 */
export function doTimeRangesOverlap(startA, endA, startB, endB) {
  const startAMin = timetableService.parseTimeToMinutes(startA);
  const endAMin = timetableService.parseTimeToMinutes(endA);
  const startBMin = timetableService.parseTimeToMinutes(startB);
  const endBMin = timetableService.parseTimeToMinutes(endB);
  return startAMin < endBMin && startBMin < endAMin;
}

/**
 * THE composed effective schedule for one real date — periods AND
 * date-specific events together, with the explicit override rule this
 * feature's own brief requires: an event whose time range overlaps a
 * recurring period's time range REPLACES it for that one date (never
 * both shown at once). `eventsForDate` must already be filtered to this
 * exact date (see services/scheduledEventService.js's own
 * getEventsForDate()) — this function does no Firestore fetching of
 * its own, staying pure.
 *
 * Each period gets `suppressedByEventId` — non-null exactly when an
 * event's time range overlaps it, so a renderer knows to skip that
 * period's own normal lesson card and show the event in its place,
 * rather than both.
 */
export function getEffectiveScheduleForDate(classroom, dateKey, eventsForDate = []) {
  const status = getWorkingDayStatus(classroom, dateKey);
  const rawPeriods = getEffectivePeriodsForDate(classroom, dateKey);
  const sortedEvents = [...eventsForDate].sort((a, b) => timetableService.parseTimeToMinutes(a.startTime) - timetableService.parseTimeToMinutes(b.startTime));

  const periods = rawPeriods.map((period) => {
    const overlappingEvent = sortedEvents.find((event) => doTimeRangesOverlap(period.startTime, period.endTime, event.startTime, event.endTime));
    return { ...period, suppressedByEventId: overlappingEvent ? overlappingEvent.id : null };
  });

  return {
    dateKey,
    isWorkingDay: status.isWorkingDay,
    exceptionType: status.exceptionType,
    exceptionReason: status.reason,
    periods,
    events: sortedEvents,
  };
}

// ---------------------------------------------------------------------
// Dashboard time-awareness — "what is the next relevant schedule right
// now," never a blind "today's date -> today's timetable" read. Both
// functions below are pure (take `now` as a parameter, default to the
// real current moment only at the call site) so they're directly unit-
// testable against a fixed clock, and both are in LOCAL time throughout
// (utils/dateHelpers.js's own toDateKey()/no-UTC convention) — never a
// UTC comparison that could roll the day over early/late.
// ---------------------------------------------------------------------

/**
 * Which date the Dashboard should show right now, and whether that's
 * literally today. Today's OWN effective schedule is shown whenever
 * today is a working day and the current time is still before its last
 * period ends (before/during/between periods all resolve here — the
 * per-item Upcoming/In progress/Not taught distinction is a separate,
 * finer-grained concern the Dashboard widget itself still renders).
 * Once today is a non-working day, OR the current time is at/after
 * today's own last period's end time, this searches forward
 * (getNextWorkingDate(), which already skips consecutive Holidays and
 * honors a temporary Working Day) starting from TOMORROW — never from
 * today again, so an already-finished school day is never re-shown.
 */
export function resolveDashboardScheduleDate(classroom, { now = new Date() } = {}) {
  const todayKey = toDateKey(now);
  const todayStatus = getWorkingDayStatus(classroom, todayKey);

  if (todayStatus.isWorkingDay) {
    const periods = getEffectivePeriodsForDate(classroom, todayKey);
    if (periods.length > 0) {
      const lastPeriodEndMinutes = Math.max(...periods.map((period) => timetableService.parseTimeToMinutes(period.endTime)));
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (nowMinutes < lastPeriodEndMinutes) {
        return { dateKey: todayKey, isToday: true };
      }
    }
  }

  const nextDateKey = getNextWorkingDate(classroom, shiftDateKey(todayKey, 1));
  return { dateKey: nextDateKey, isToday: false };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many milliseconds until the Dashboard's own schedule widget
 * should recompute itself — a lightweight, precisely-targeted refresh,
 * never a fixed-interval poll (per explicit product direction). The
 * next MEANINGFUL moment is always either a period boundary later
 * today (a period starting/ending changes what "current/upcoming"
 * means, or crossing the last one's end triggers the next-working-day
 * jump above) or, if there are none left today, the next local
 * midnight (so a long-open tab on a non-working day still notices the
 * date itself changing). Floored at 1 second so a boundary that's
 * technically already `now` (clock drift) never schedules a same-
 * instant re-fire loop.
 */
export function computeNextRefreshDelayMs(periods, now = new Date()) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const boundaryMinutes = periods.flatMap((period) => [timetableService.parseTimeToMinutes(period.startTime), timetableService.parseTimeToMinutes(period.endTime)]);
  const futureBoundaryMinutes = boundaryMinutes.filter((minutes) => minutes > nowMinutes);

  if (futureBoundaryMinutes.length > 0) {
    const nextBoundaryMinutes = Math.min(...futureBoundaryMinutes);
    const delayMs = (nextBoundaryMinutes - nowMinutes) * 60 * 1000;
    return Math.max(1000, Math.round(delayMs) + 1000); // +1s buffer so the boundary has definitely passed once this fires
  }

  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5, 0); // +5s past midnight, same "definitely past it" buffer
  return Math.max(1000, midnight.getTime() - now.getTime());
}
