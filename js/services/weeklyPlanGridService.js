/**
 * services/weeklyPlanGridService.js
 *
 * Builds the Monday-Friday Weekly Plan review grid for one Fellow, in
 * one classroom, for one week — purely by composing data this app
 * already fetches elsewhere. Does NOT reconstruct timetable logic: the
 * "which periods actually happen on this date" question is answered
 * exclusively by services/schoolCalendarService.js's own
 * getEffectiveScheduleForDate() (holidays, special working days, exam/
 * scheduled-event overrides all already resolved there — see that
 * file's own header comment), never by re-deriving the recurring
 * timetable directly the way services/timetableService.js's
 * getConcreteSlotsForDateRange() does (that function is deliberately
 * NOT used here, since it does not consult the calendar at all).
 *
 * Pure and Firestore-free: `events` and `lessons` are already-fetched
 * plain arrays (services/scheduledEventRepository.js's
 * getScheduledEventsForDateRange(), services/plannerRepository.js's
 * getLessonsForDateRange()) for the same week — this file only ever
 * composes them, matching every other pure service in this codebase's
 * own "stays directly unit-testable" convention.
 */

import { getEffectiveScheduleForDate } from './schoolCalendarService.js';
import { getEventsForDate } from './scheduledEventService.js';
import { buildTeachingSlotId, weekdayOfDateKey } from './timetableService.js';
import { resolveLessonConcepts } from './timetableDisplayService.js';
import { getUnitById } from './learningRecordService.js';
import { shiftDateKey } from '../utils/dateHelpers.js';

/**
 * One entry per Monday-Friday date, each with only the periods THIS
 * `teacherUid` actually teaches that day (never another co-teacher's
 * periods in the same classroom — a Weekly Plan is one Fellow's own
 * week). A period suppressed by a scheduled event (an exam, per
 * getEffectiveScheduleForDate()'s own `suppressedByEventId`) is
 * dropped entirely, not shown as a regular lesson — matching this
 * task's own explicit "an exam must not accidentally appear as the
 * regular lesson" requirement.
 *
 * Each period carries its resolved Lesson (or `null` if the Fellow
 * hasn't touched that period's Weekly Plan content yet — never an
 * error, never a placeholder Lesson), plus the already-resolved Unit
 * and Topic(s) (see services/timetableDisplayService.js's own
 * resolveLessonConcepts() header comment on why Topic is an array, not
 * a single value) — Objective/Plan/Assessment are read directly off
 * the Lesson itself by the caller (`objectives`, `bigQuestion`,
 * `planSummary`, `assessmentNote`), not duplicated here.
 */
export function buildWeeklyPlanGrid(classroom, { events = [], lessons = [], teacherUid, weekStartDate }) {
  const lessonsByTeachingSlotId = new Map(lessons.map((lesson) => [lesson.teachingSlotId, lesson]));

  const days = [];
  for (let offset = 0; offset < 5; offset += 1) {
    const dateKey = shiftDateKey(weekStartDate, offset);
    const eventsForDate = getEventsForDate(events, dateKey);
    const schedule = getEffectiveScheduleForDate(classroom, dateKey, eventsForDate);

    const periods = schedule.periods
      .filter((period) => period.teacherUid === teacherUid && !period.suppressedByEventId)
      .map((period) => {
        const teachingSlotId = buildTeachingSlotId(classroom.id, dateKey, period.periodNumber);
        const lesson = lessonsByTeachingSlotId.get(teachingSlotId) || null;
        return {
          periodNumber: period.periodNumber,
          startTime: period.startTime,
          endTime: period.endTime,
          subjectId: period.subjectId,
          teachingSlotId,
          lesson,
          unit: lesson?.curriculumUnitId ? getUnitById(classroom, lesson.curriculumUnitId) : null,
          concepts: lesson ? resolveLessonConcepts(classroom, lesson) : [],
        };
      });

    days.push({
      dateKey,
      weekday: weekdayOfDateKey(dateKey),
      isWorkingDay: schedule.isWorkingDay,
      exceptionType: schedule.exceptionType,
      exceptionReason: schedule.exceptionReason,
      periods,
    });
  }

  return days;
}

/** Every Lesson document referenced anywhere in `grid` — the plain, flat list services/weeklyPlanSubmissionService.js's getWeekPlanDisplayStatus()/weeklyPlanValidationService.js's hasMeaningfulWeeklyPlanContent() need, without either of those pure functions having to walk the day/period grid shape themselves. */
export function getLessonsFromWeeklyPlanGrid(grid) {
  return grid.flatMap((day) => day.periods.map((period) => period.lesson).filter(Boolean));
}
