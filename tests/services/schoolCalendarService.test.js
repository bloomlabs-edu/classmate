import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as timetableService from '../../js/services/timetableService.js';
import * as schoolCalendarService from '../../js/services/schoolCalendarService.js';
import { createScheduledEvent } from '../../js/models/ScheduledEvent.js';

/**
 * A real weekday pattern — Period 1 (09:00-09:45), Period 2 (09:45-10:30)
 * every Mon-Fri, matching this feature's own worked example almost
 * exactly ("09:00–09:45 Mathematics, 09:45–10:30 Science" on a normal
 * Friday). Weekends (Sat=6, Sun=0) have nothing configured — normally
 * non-working, matching the task's own "Saturday/Sunday → normally
 * non-working" framing.
 */
function classroomWithWeekdayPattern() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  timetableService.setPeriods(classroom, [
    { periodNumber: 1, startTime: '09:00', endTime: '09:45' },
    { periodNumber: 2, startTime: '09:45', endTime: '10:30' },
    { periodNumber: 3, startTime: '10:45', endTime: '11:30' },
  ]);
  [1, 2, 3, 4, 5].forEach((weekday) => {
    timetableService.upsertSlot(classroom, { weekday, periodNumber: 1, subjectId: 'mathematics' });
    timetableService.upsertSlot(classroom, { weekday, periodNumber: 2, subjectId: 'science' });
    timetableService.upsertSlot(classroom, { weekday, periodNumber: 3, subjectId: 'english' });
  });
  return classroom;
}

// Real dates matching this feature's own worked examples exactly:
// Mon 2026-09-14, Tue 2026-09-15, Sat 2026-09-19, Sun 2026-09-20, Mon 2026-09-21 (a second Monday, used for the consecutive-holiday case).
const MONDAY = '2026-09-14';
const TUESDAY = '2026-09-15';
const WEDNESDAY = '2026-09-16';
const THURSDAY = '2026-09-17';
const FRIDAY = '2026-09-18';
const SATURDAY = '2026-09-19';
const SUNDAY = '2026-09-20';
const NEXT_MONDAY = '2026-09-21';
const NEXT_TUESDAY = '2026-09-22';

// ---------------------------------------------------------------------
// Working-day resolution
// ---------------------------------------------------------------------

test('getWorkingDayStatus: a normal weekday with recurring periods is a working day, no exception', () => {
  const classroom = classroomWithWeekdayPattern();
  const status = schoolCalendarService.getWorkingDayStatus(classroom, MONDAY);
  assert.equal(status.isWorkingDay, true);
  assert.equal(status.exceptionType, null);
});

test('getWorkingDayStatus: a normal weekend with no recurring periods is NOT a working day', () => {
  const classroom = classroomWithWeekdayPattern();
  const status = schoolCalendarService.getWorkingDayStatus(classroom, SATURDAY);
  assert.equal(status.isWorkingDay, false);
  assert.equal(status.exceptionType, null);
});

test('setHolidayException: a Monday explicitly marked Holiday is NOT a working day, even though Monday normally has periods', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, MONDAY, 'Local school holiday');
  const status = schoolCalendarService.getWorkingDayStatus(classroom, MONDAY);
  assert.equal(status.isWorkingDay, false);
  assert.equal(status.exceptionType, 'holiday');
  assert.equal(status.reason, 'Local school holiday');
});

test('setHolidayException: the recurring Monday pattern itself is completely untouched — the core architectural principle', () => {
  const classroom = classroomWithWeekdayPattern();
  const beforeSlots = JSON.stringify(timetableService.getSlotsForWeekday(classroom, 1));
  schoolCalendarService.setHolidayException(classroom, MONDAY, 'Local school holiday');
  const afterSlots = JSON.stringify(timetableService.getSlotsForWeekday(classroom, 1));
  assert.equal(afterSlots, beforeSlots);
  // A DIFFERENT Monday (no exception on it) still gets the real, intact pattern.
  const otherMondayStatus = schoolCalendarService.getWorkingDayStatus(classroom, NEXT_MONDAY);
  assert.equal(otherMondayStatus.isWorkingDay, true);
});

test('setWorkingDayException: a Saturday with no recurring pattern becomes a working day once marked, using an empty period list unless customized', () => {
  const classroom = classroomWithWeekdayPattern(); // Saturday has no recurring slots at all
  schoolCalendarService.setWorkingDayException(classroom, SATURDAY, 'Special working day');
  const status = schoolCalendarService.getWorkingDayStatus(classroom, SATURDAY);
  assert.equal(status.isWorkingDay, true);
  assert.equal(status.exceptionType, 'workingDay');
  assert.deepEqual(schoolCalendarService.getEffectivePeriodsForDate(classroom, SATURDAY), []);
});

test('setWorkingDayException: a Saturday that already HAS its own recurring pattern reuses it when no customPeriods is given', () => {
  const classroom = classroomWithWeekdayPattern();
  timetableService.upsertSlot(classroom, { weekday: 6, periodNumber: 1, subjectId: 'mathematics' }); // Saturday's own real recurring period
  schoolCalendarService.setWorkingDayException(classroom, SATURDAY, 'Special working day');
  const periods = schoolCalendarService.getEffectivePeriodsForDate(classroom, SATURDAY);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].subjectId, 'mathematics');
});

test('setWorkingDayException with customPeriods: a special working day can have its own periods, different from the normal weekday pattern', () => {
  const classroom = classroomWithWeekdayPattern();
  const customPeriods = [{ periodNumber: 1, startTime: '10:00', endTime: '11:00', subjectId: 'science', teacherUid: null }];
  schoolCalendarService.setWorkingDayException(classroom, SATURDAY, 'Special working day', customPeriods);
  const periods = schoolCalendarService.getEffectivePeriodsForDate(classroom, SATURDAY);
  assert.deepEqual(periods, customPeriods);
});

test('clearException: removes an exception, returning the date to Normal', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, MONDAY, 'Test');
  schoolCalendarService.clearException(classroom, MONDAY);
  const status = schoolCalendarService.getWorkingDayStatus(classroom, MONDAY);
  assert.equal(status.isWorkingDay, true);
  assert.equal(status.exceptionType, null);
});

test('a date can only ever have ONE exception — setting a second replaces the first, never appends', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, SATURDAY, 'First reason');
  schoolCalendarService.setWorkingDayException(classroom, SATURDAY, 'Changed my mind');
  const exceptions = schoolCalendarService.getCalendarExceptions(classroom);
  assert.equal(exceptions.filter((exception) => exception.date === SATURDAY).length, 1);
  assert.equal(schoolCalendarService.getExceptionForDate(classroom, SATURDAY).type, 'workingDay');
});

test('getNextWorkingDate: consecutive non-working days (weekend + a Monday holiday) are all skipped, landing on Tuesday', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, NEXT_MONDAY, 'Holiday');
  // Starting the search from Saturday: Sat (weekend) -> Sun (weekend) -> Mon (holiday) -> Tue (real working day).
  const next = schoolCalendarService.getNextWorkingDate(classroom, SATURDAY);
  assert.equal(next, NEXT_TUESDAY);
});

test('getNextWorkingDate: a temporary working Saturday IS returned as the next working date when it is genuinely next', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setWorkingDayException(classroom, SATURDAY, 'Special working day', [
    { periodNumber: 1, startTime: '09:00', endTime: '09:45', subjectId: 'mathematics', teacherUid: null },
  ]);
  const next = schoolCalendarService.getNextWorkingDate(classroom, SATURDAY);
  assert.equal(next, SATURDAY);
});

// ---------------------------------------------------------------------
// Time-aware resolution (resolveDashboardScheduleDate)
// ---------------------------------------------------------------------

function at(dateKey, hours, minutes) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

test('resolveDashboardScheduleDate: before the first period, still shows today', () => {
  const classroom = classroomWithWeekdayPattern();
  const result = schoolCalendarService.resolveDashboardScheduleDate(classroom, { now: at(MONDAY, 8, 0) });
  assert.deepEqual(result, { dateKey: MONDAY, isToday: true });
});

test('resolveDashboardScheduleDate: during a period, still shows today', () => {
  const classroom = classroomWithWeekdayPattern();
  const result = schoolCalendarService.resolveDashboardScheduleDate(classroom, { now: at(MONDAY, 9, 15) });
  assert.deepEqual(result, { dateKey: MONDAY, isToday: true });
});

test('resolveDashboardScheduleDate: between periods, still shows today', () => {
  const classroom = classroomWithWeekdayPattern();
  const result = schoolCalendarService.resolveDashboardScheduleDate(classroom, { now: at(MONDAY, 10, 37) }); // between Period 2 (ends 10:30) and Period 3 (starts 10:45)
  assert.deepEqual(result, { dateKey: MONDAY, isToday: true });
});

test('resolveDashboardScheduleDate: after the final period ends, transitions to the next working day (Tuesday)', () => {
  const classroom = classroomWithWeekdayPattern();
  const result = schoolCalendarService.resolveDashboardScheduleDate(classroom, { now: at(MONDAY, 11, 30) }); // exactly when Period 3 ends
  assert.deepEqual(result, { dateKey: TUESDAY, isToday: false });
});

test('resolveDashboardScheduleDate: after the final period, transitions ACROSS a holiday to the day after it', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, TUESDAY, 'Holiday');
  const result = schoolCalendarService.resolveDashboardScheduleDate(classroom, { now: at(MONDAY, 12, 0) });
  assert.equal(result.dateKey, '2026-09-16'); // Wednesday
  assert.equal(result.isToday, false);
});

test('resolveDashboardScheduleDate: on a holiday, transitions forward to the next real working day (skips the weekend, lands on the temporary working Saturday if one exists before Monday)', () => {
  const classroom = classroomWithWeekdayPattern();
  // Friday 2026-09-18 is a holiday; Saturday 09-19 is a temporary working day.
  const friday = '2026-09-18';
  schoolCalendarService.setHolidayException(classroom, friday, 'Holiday');
  schoolCalendarService.setWorkingDayException(classroom, SATURDAY, 'Special working day', [
    { periodNumber: 1, startTime: '09:00', endTime: '09:45', subjectId: 'mathematics', teacherUid: null },
  ]);
  const result = schoolCalendarService.resolveDashboardScheduleDate(classroom, { now: at(friday, 9, 0) });
  assert.deepEqual(result, { dateKey: SATURDAY, isToday: false });
});

test('resolveDashboardScheduleDate: consecutive holidays are all skipped from a non-working starting day', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, NEXT_MONDAY, 'Holiday');
  // "Now" is Sunday (already non-working) — must not show Monday's holiday schedule, must land on Tuesday.
  const result = schoolCalendarService.resolveDashboardScheduleDate(classroom, { now: at(SUNDAY, 10, 0) });
  assert.deepEqual(result, { dateKey: NEXT_TUESDAY, isToday: false });
});

// ---------------------------------------------------------------------
// computeNextRefreshDelayMs — the lightweight, targeted refresh timer
// ---------------------------------------------------------------------

test('computeNextRefreshDelayMs: schedules for the next upcoming period boundary today', () => {
  const classroom = classroomWithWeekdayPattern();
  const periods = schoolCalendarService.getEffectivePeriodsForDate(classroom, MONDAY);
  const now = at(MONDAY, 9, 0); // Period 1 just started; next boundary is 09:45 (Period 1 ends / Period 2 starts)
  const delayMs = schoolCalendarService.computeNextRefreshDelayMs(periods, now);
  const expectedMs = 45 * 60 * 1000 + 1000; // 45 minutes + 1s buffer
  assert.equal(delayMs, expectedMs);
});

test('computeNextRefreshDelayMs: after the last boundary today, schedules for the next local midnight', () => {
  const classroom = classroomWithWeekdayPattern();
  const periods = schoolCalendarService.getEffectivePeriodsForDate(classroom, MONDAY);
  const now = at(MONDAY, 23, 0); // 1 hour before midnight
  const delayMs = schoolCalendarService.computeNextRefreshDelayMs(periods, now);
  // Midnight is exactly 1 hour away, plus this function's own +5s "definitely past it" buffer.
  assert.equal(delayMs, 60 * 60 * 1000 + 5000);
});

test('computeNextRefreshDelayMs: never returns a delay below the 1-second floor, even for an empty period list', () => {
  const delayMs = schoolCalendarService.computeNextRefreshDelayMs([], at(MONDAY, 23, 59, 59));
  assert.ok(delayMs >= 1000);
});

// ---------------------------------------------------------------------
// Events — date-specific Scheduled Events (exams) and the override rule
// ---------------------------------------------------------------------

test('getEffectiveScheduleForDate: an exam on its own date overlaps and suppresses the recurring period it conflicts with', () => {
  const classroom = classroomWithWeekdayPattern();
  const exam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:30', eventType: 'exam', title: 'Term 1 Science Examination', subjectId: 'science' });
  const schedule = schoolCalendarService.getEffectiveScheduleForDate(classroom, MONDAY, [exam]);

  assert.equal(schedule.events.length, 1);
  assert.equal(schedule.events[0].id, exam.id);

  const period1 = schedule.periods.find((p) => p.periodNumber === 1);
  const period2 = schedule.periods.find((p) => p.periodNumber === 2);
  const period3 = schedule.periods.find((p) => p.periodNumber === 3);
  assert.equal(period1.suppressedByEventId, exam.id); // 09:00-09:45 fully inside the exam's 09:00-10:30
  assert.equal(period2.suppressedByEventId, exam.id); // 09:45-10:30 overlaps the exam too
  assert.equal(period3.suppressedByEventId, null); // 10:45-11:30 — no overlap, normal lesson stands
});

test('getEffectiveScheduleForDate: an exam does NOT appear on, or affect, an unrelated date', () => {
  const classroom = classroomWithWeekdayPattern();
  // Monday's own exam is real data elsewhere; TUESDAY's own events list is
  // correctly empty here — the caller (real code) only ever passes events
  // already filtered to the date being resolved (see getEventsForDate()).
  const schedule = schoolCalendarService.getEffectiveScheduleForDate(classroom, TUESDAY, []);
  assert.equal(schedule.events.length, 0);
  assert.ok(schedule.periods.every((period) => period.suppressedByEventId === null));
});

test('getEffectiveScheduleForDate: back-to-back periods and events (touching exactly at the boundary) do not count as overlapping', () => {
  const classroom = classroomWithWeekdayPattern();
  const exam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '10:30', endTime: '10:45', eventType: 'exam', title: 'A very short exam', subjectId: 'english' });
  const schedule = schoolCalendarService.getEffectiveScheduleForDate(classroom, MONDAY, [exam]);
  // Period 2 ends exactly at 10:30 (exam starts then) and Period 3 starts exactly at 10:45 (exam ends then) — neither is a real overlap.
  assert.ok(schedule.periods.every((period) => period.suppressedByEventId === null));
});

// ---------------------------------------------------------------------
// Date RANGES — Holiday/Working Day exceptions spanning multiple days
// (getExceptionForDate's own inclusive startDate..endDate containment
// check is the only range-aware-ification this feature needed; every
// test below exercises that through the same public functions the
// single-day tests above already use).
// ---------------------------------------------------------------------

test('range: a single-day holiday (startDate === endDate) resolves exactly like the legacy single-date case', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: MONDAY, endDate: MONDAY }, 'Local school holiday');
  const status = schoolCalendarService.getWorkingDayStatus(classroom, MONDAY);
  assert.equal(status.isWorkingDay, false);
  assert.equal(status.exceptionType, 'holiday');
  assert.equal(status.reason, 'Local school holiday');
  const exception = schoolCalendarService.getExceptionForDate(classroom, MONDAY);
  assert.equal(exception.startDate, MONDAY);
  assert.equal(exception.endDate, MONDAY);
  assert.equal(exception.date, MONDAY);
});

test('range: a multi-day holiday (Wed-Fri) makes every date in between a non-working day', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  [WEDNESDAY, THURSDAY, FRIDAY].forEach((dateKey) => {
    const status = schoolCalendarService.getWorkingDayStatus(classroom, dateKey);
    assert.equal(status.isWorkingDay, false, `${dateKey} should be non-working`);
    assert.equal(status.exceptionType, 'holiday');
  });
});

test('range: the first day of a holiday range is affected', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  assert.equal(schoolCalendarService.getWorkingDayStatus(classroom, WEDNESDAY).isWorkingDay, false);
});

test('range: the last day of a holiday range is affected', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  assert.equal(schoolCalendarService.getWorkingDayStatus(classroom, FRIDAY).isWorkingDay, false);
});

test('range: the day immediately before a holiday range is unaffected (normal recurring schedule)', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  const status = schoolCalendarService.getWorkingDayStatus(classroom, TUESDAY);
  assert.equal(status.isWorkingDay, true);
  assert.equal(status.exceptionType, null);
});

test('range: the day immediately after a holiday range is unaffected — no leak past endDate', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  // Saturday right after the range is non-working, but for its own natural weekend reason, not a leaked exception.
  const saturdayStatus = schoolCalendarService.getWorkingDayStatus(classroom, SATURDAY);
  assert.equal(saturdayStatus.isWorkingDay, false);
  assert.equal(saturdayStatus.exceptionType, null);
  // The next real working day (the following Monday) is fully restored to normal.
  const mondayStatus = schoolCalendarService.getWorkingDayStatus(classroom, NEXT_MONDAY);
  assert.equal(mondayStatus.isWorkingDay, true);
  assert.equal(mondayStatus.exceptionType, null);
});

test('range: a single-day special working day still works via From === To', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setWorkingDayException(classroom, { startDate: SATURDAY, endDate: SATURDAY }, 'Special working day');
  const status = schoolCalendarService.getWorkingDayStatus(classroom, SATURDAY);
  assert.equal(status.isWorkingDay, true);
  assert.equal(status.exceptionType, 'workingDay');
});

test('range: a multi-day special working day (Sat-Sun) makes every date in the range a working day, each using its own weekday pattern when not customized', () => {
  const classroom = classroomWithWeekdayPattern();
  timetableService.upsertSlot(classroom, { weekday: 6, periodNumber: 1, subjectId: 'mathematics' }); // Saturday's own recurring period
  // Sunday (weekday 0) has no recurring slots configured in the fixture at all.
  schoolCalendarService.setWorkingDayException(classroom, { startDate: SATURDAY, endDate: SUNDAY }, 'Special working weekend');

  const saturdayStatus = schoolCalendarService.getWorkingDayStatus(classroom, SATURDAY);
  const sundayStatus = schoolCalendarService.getWorkingDayStatus(classroom, SUNDAY);
  assert.equal(saturdayStatus.isWorkingDay, true);
  assert.equal(sundayStatus.isWorkingDay, true);

  const saturdayPeriods = schoolCalendarService.getEffectivePeriodsForDate(classroom, SATURDAY);
  const sundayPeriods = schoolCalendarService.getEffectivePeriodsForDate(classroom, SUNDAY);
  assert.equal(saturdayPeriods.length, 1);
  assert.equal(saturdayPeriods[0].subjectId, 'mathematics'); // Saturday's own recurring pattern, since no customPeriods was given
  assert.deepEqual(sundayPeriods, []); // Sunday has no recurring pattern of its own
});

test('range: a multi-day special working day WITH customPeriods gives every date in the range the identical custom periods', () => {
  const classroom = classroomWithWeekdayPattern();
  const customPeriods = [{ periodNumber: 1, startTime: '10:00', endTime: '11:00', subjectId: 'science', teacherUid: null }];
  schoolCalendarService.setWorkingDayException(classroom, { startDate: SATURDAY, endDate: SUNDAY }, 'Special working weekend', customPeriods);
  assert.deepEqual(schoolCalendarService.getEffectivePeriodsForDate(classroom, SATURDAY), customPeriods);
  assert.deepEqual(schoolCalendarService.getEffectivePeriodsForDate(classroom, SUNDAY), customPeriods);
});

test('validateExceptionRange: an invalid range (endDate before startDate) is rejected', () => {
  const classroom = classroomWithWeekdayPattern();
  const result = schoolCalendarService.validateExceptionRange(classroom, FRIDAY, WEDNESDAY);
  assert.equal(result.valid, false);
  assert.ok(result.error);
});

test('getExceptionForDate: a legacy exception object with only .date (no startDate/endDate, simulating pre-migration Firestore data) still resolves correctly', () => {
  const classroom = classroomWithWeekdayPattern();
  // Simulates data written before this range extension existed — never
  // goes through createCalendarException()'s own defaulting.
  classroom.schoolCalendar = { exceptions: [{ id: 'legacy-1', date: MONDAY, type: 'holiday', reason: 'Old data', customPeriods: null }] };

  const exception = schoolCalendarService.getExceptionForDate(classroom, MONDAY);
  assert.ok(exception);
  assert.equal(exception.reason, 'Old data');

  const status = schoolCalendarService.getWorkingDayStatus(classroom, MONDAY);
  assert.equal(status.isWorkingDay, false);
  assert.equal(status.exceptionType, 'holiday');

  // A neighboring date is correctly NOT covered by this legacy single-date record.
  assert.equal(schoolCalendarService.getExceptionForDate(classroom, TUESDAY), null);
});

test('range: editing a range (by id) changes which dates are affected — old dates outside the new range are no longer affected', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  const original = schoolCalendarService.getExceptionForDate(classroom, WEDNESDAY);

  // Edit: move the range to NEXT_MONDAY..NEXT_TUESDAY, passing the original id.
  schoolCalendarService.setHolidayException(classroom, { startDate: NEXT_MONDAY, endDate: NEXT_TUESDAY }, 'Rescheduled break', { id: original.id });

  // Old dates are back to normal.
  assert.equal(schoolCalendarService.getWorkingDayStatus(classroom, WEDNESDAY).isWorkingDay, true);
  assert.equal(schoolCalendarService.getWorkingDayStatus(classroom, THURSDAY).isWorkingDay, true);
  assert.equal(schoolCalendarService.getWorkingDayStatus(classroom, FRIDAY).isWorkingDay, true);

  // New dates are now affected.
  assert.equal(schoolCalendarService.getWorkingDayStatus(classroom, NEXT_MONDAY).isWorkingDay, false);
  assert.equal(schoolCalendarService.getWorkingDayStatus(classroom, NEXT_TUESDAY).isWorkingDay, false);

  // Still only one exception overall — an edit, not an additional create.
  assert.equal(schoolCalendarService.getCalendarExceptions(classroom).length, 1);
});

test('range: deleting a range (clearExceptionById) restores normal recurring resolution for every date that was in it', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  const exception = schoolCalendarService.getExceptionForDate(classroom, WEDNESDAY);

  schoolCalendarService.clearExceptionById(classroom, exception.id);

  [WEDNESDAY, THURSDAY, FRIDAY].forEach((dateKey) => {
    const status = schoolCalendarService.getWorkingDayStatus(classroom, dateKey);
    assert.equal(status.isWorkingDay, true, `${dateKey} should be back to normal`);
    assert.equal(status.exceptionType, null);
  });
  assert.equal(schoolCalendarService.getCalendarExceptions(classroom).length, 0);
});

test('validateExceptionRange: an overlapping range is rejected with a clear error (existing 20-29 Sep Holiday; attempted 25-27 Sep Special Working Day)', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: '2026-09-20', endDate: '2026-09-29' }, 'Term break');

  const result = schoolCalendarService.validateExceptionRange(classroom, '2026-09-25', '2026-09-27');
  assert.equal(result.valid, false);
  assert.match(result.error, /overlaps an existing Holiday exception/);
});

test('validateExceptionRange: excludeExceptionId lets a range be re-saved against itself without falsely colliding', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  const exception = schoolCalendarService.getExceptionForDate(classroom, WEDNESDAY);

  const resultWithoutExclude = schoolCalendarService.validateExceptionRange(classroom, WEDNESDAY, FRIDAY);
  assert.equal(resultWithoutExclude.valid, false);

  const resultWithExclude = schoolCalendarService.validateExceptionRange(classroom, WEDNESDAY, FRIDAY, { excludeExceptionId: exception.id });
  assert.equal(resultWithExclude.valid, true);
});

test('range: a holiday range correctly overrides the normal recurring timetable for every date in it (range equivalent of the single-day case)', () => {
  const classroom = classroomWithWeekdayPattern();
  const beforeSlots = JSON.stringify(timetableService.getSlotsForWeekday(classroom, 3)); // Wednesday's own recurring pattern
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  const afterSlots = JSON.stringify(timetableService.getSlotsForWeekday(classroom, 3));
  assert.equal(afterSlots, beforeSlots); // the recurring pattern itself is untouched
  assert.deepEqual(schoolCalendarService.getEffectivePeriodsForDate(classroom, WEDNESDAY), []);
});

test('getEffectiveScheduleForDate: an exam on a date inside a holiday range still appears in schedule.events, but there are no periods for it to overlap/suppress — the Holiday empties periods entirely first', () => {
  const classroom = classroomWithWeekdayPattern();
  schoolCalendarService.setHolidayException(classroom, { startDate: WEDNESDAY, endDate: FRIDAY }, 'Mid-term break');
  const exam = createScheduledEvent({ classroomId: 'c1', date: THURSDAY, startTime: '09:00', endTime: '10:30', eventType: 'exam', title: 'Exam scheduled on a holiday', subjectId: 'science' });

  const schedule = schoolCalendarService.getEffectiveScheduleForDate(classroom, THURSDAY, [exam]);

  assert.equal(schedule.isWorkingDay, false);
  assert.equal(schedule.exceptionType, 'holiday');
  // getEffectivePeriodsForDate() already returns [] for a non-working day
  // (its own early return), before getEffectiveScheduleForDate() ever
  // gets to the overlap/suppression step — so there is structurally
  // nothing for the exam to suppress.
  assert.deepEqual(schedule.periods, []);
  // The event itself is NOT filtered out by the Holiday — this function
  // never removes events, it only ever suppresses PERIODS. Any UI
  // surface showing schedule.events on a Holiday date would still see
  // this exam; that is the current, unchanged behavior, documented here
  // rather than assumed.
  assert.equal(schedule.events.length, 1);
  assert.equal(schedule.events[0].id, exam.id);
});
