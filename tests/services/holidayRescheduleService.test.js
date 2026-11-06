/**
 * tests/services/holidayRescheduleService.test.js
 *
 * Unit coverage for the PURE planning half of holiday rescheduling
 * (services/holidayRescheduleService.js) — no Firestore involved at
 * all, matching services/schoolCalendarService.js's own test
 * conventions. The real-Firestore fetch/persist/UI half (the School
 * Calendar save handler in ui/views/TimetableView.js) is covered
 * separately by tests/ui/holidayReschedule.emulator.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createLesson } from '../../js/models/Lesson.js';
import * as timetableService from '../../js/services/timetableService.js';
import * as schoolCalendarService from '../../js/services/schoolCalendarService.js';
import * as holidayRescheduleService from '../../js/services/holidayRescheduleService.js';

function classroomWithSciencePattern() {
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  timetableService.setPeriods(classroom, [
    { periodNumber: 1, startTime: '09:00', endTime: '09:40' },
    { periodNumber: 2, startTime: '10:15', endTime: '10:55' },
    { periodNumber: 3, startTime: '11:30', endTime: '12:10' },
  ]);
  // Science: Tuesday(2) and Thursday(4), period 3, teacher-A.
  timetableService.upsertSlot(classroom, { weekday: 2, periodNumber: 3, subjectId: 'science', teacherUid: 'teacher-A' });
  timetableService.upsertSlot(classroom, { weekday: 4, periodNumber: 3, subjectId: 'science', teacherUid: 'teacher-A' });
  return classroom;
}

function lessonOn(dateKey, periodNumber, overrides = {}) {
  const teachingSlotId = timetableService.buildTeachingSlotId('classroom-1', dateKey, periodNumber);
  return createLesson({
    classroomId: 'classroom-1',
    date: dateKey,
    teachingSlotId,
    curriculumUnitId: 'unit-1',
    conceptIds: ['c1', 'c2'],
    ...overrides,
  });
}

test('planHolidayReschedule: a single holiday reschedules its affected lesson to the next valid teacher-scoped period', () => {
  const classroom = classroomWithSciencePattern();
  const lesson = lessonOn('2026-08-27', 3); // Thursday — about to become a holiday
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [lesson],
    lessonsInSearchWindow: [],
    eventsAffected: [],
  });

  assert.equal(plan.entries.length, 1);
  assert.equal(plan.unresolvedCount, 0);
  assert.equal(plan.totalOpenConceptCount, 2);
  assert.deepEqual(plan.entries[0].openConceptIds, ['c1', 'c2']);
  assert.equal(plan.entries[0].destination.date, '2026-09-01', 'the next Tuesday — Thursday itself is now a holiday');
  assert.equal(plan.entries[0].destination.periodNumber, 3);
});

test('planHolidayReschedule: a date-range holiday considers every affected date, one entry per Lesson, no duplicates', () => {
  const classroom = classroomWithSciencePattern();
  const lessonTue = lessonOn('2026-08-25', 3);
  const lessonThu = lessonOn('2026-08-27', 3);
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-25', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-25',
    endDate: '2026-08-27',
    lessonsAffected: [lessonTue, lessonThu],
    lessonsInSearchWindow: [],
    eventsAffected: [],
  });

  assert.equal(plan.entries.length, 2, 'both affected lessons get exactly one entry each');
  const destinationDates = plan.entries.map((entry) => entry.destination.date);
  assert.equal(new Set(destinationDates).size, 2, 'two different lessons never resolve to the SAME destination slot');
  assert.ok(destinationDates.every((d) => d > '2026-08-27'), 'every destination must be strictly after the holiday range');
});

test('planHolidayReschedule: a partially-taught lesson only reschedules its OPEN concepts — executed ones are excluded entirely', () => {
  const classroom = classroomWithSciencePattern();
  const lesson = lessonOn('2026-08-27', 3, { conceptIds: ['c1', 'c2', 'c3'], executedConceptIds: ['c1'] });
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [lesson],
    lessonsInSearchWindow: [],
    eventsAffected: [],
  });

  assert.equal(plan.entries.length, 1);
  assert.deepEqual(plan.entries[0].openConceptIds, ['c2', 'c3'], 'c1 (already executed) must never be included');
});

test('planHolidayReschedule: a fully-executed lesson has nothing open — produces NO entry at all, not an entry with zero concepts', () => {
  const classroom = classroomWithSciencePattern();
  const lesson = lessonOn('2026-08-27', 3, { conceptIds: ['c1'], executedConceptIds: ['c1'] });
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [lesson],
    lessonsInSearchWindow: [],
    eventsAffected: [],
  });

  assert.equal(plan.entries.length, 0);
  assert.equal(plan.totalOpenConceptCount, 0);
});

test('planHolidayReschedule: an occupied destination is skipped — the search advances to the NEXT open period instead', () => {
  const classroom = classroomWithSciencePattern();
  const lesson = lessonOn('2026-08-27', 3); // Thursday, about to be a holiday
  const occupyingLesson = lessonOn('2026-09-01', 3); // the following Tuesday — ALREADY has a real lesson
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [lesson],
    lessonsInSearchWindow: [occupyingLesson],
    eventsAffected: [],
  });

  assert.equal(plan.entries[0].destination.date, '2026-09-03', 'Tuesday 09-01 is occupied — must skip to the FOLLOWING Thursday');
  assert.equal(plan.unresolvedCount, 0);
});

test('planHolidayReschedule: no valid destination within the horizon — the lesson is preserved (untouched) and surfaced as unresolved, never dropped', () => {
  const classroom = classroomWithSciencePattern();
  const lesson = lessonOn('2026-08-27', 3);
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [lesson],
    lessonsInSearchWindow: [],
    eventsAffected: [],
    horizonDays: 0, // forces the search to find nothing (Thursday itself is excluded as a holiday)
  });

  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].destination, null);
  assert.ok(plan.entries[0].unresolvedReason, 'must carry a human-readable reason, never a bare null with no explanation');
  assert.equal(plan.unresolvedCount, 1);
  // The source Lesson object itself must be completely untouched by planning alone — planning never mutates.
  assert.deepEqual(lesson.conceptIds, ['c1', 'c2']);
  assert.deepEqual(lesson.executedConceptIds, []);
});

test('planHolidayReschedule: the horizon is an ABSOLUTE boundary from the holiday itself, never silently re-extended by skipping occupied candidates along the way', () => {
  const classroom = classroomWithSciencePattern();
  const lesson = lessonOn('2026-08-27', 3); // Thursday, about to become a holiday
  // Occupy every single future Tuesday/Thursday Science occurrence for
  // far longer than the (deliberately small) horizon below — if the
  // horizon were wrongly re-extended every time a candidate is
  // rejected for occupancy (the exact bug this regression test catches:
  // each inner search call re-applies its own full horizon relative to
  // an ever-advancing cursor), this would eventually find ONE of these
  // far-future dates anyway instead of correctly reporting unresolved.
  // Occupy every REAL future Science occurrence (generated via the same
  // search function under test, for exact alignment) for 400 days —
  // far longer than the 14-day horizon below.
  const occupied = [];
  let cursorDate = '2026-08-27';
  let cursorPeriod = 3;
  for (let i = 0; i < 60; i += 1) {
    const next = timetableService.getNextFutureSlotForSubject(classroom, { subjectId: 'science', afterDateKey: cursorDate, afterPeriodNumber: cursorPeriod, horizonDays: 400 });
    if (!next) break;
    occupied.push(lessonOn(next.date, next.periodNumber));
    cursorDate = next.date;
    cursorPeriod = next.periodNumber;
  }
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [lesson],
    lessonsInSearchWindow: occupied,
    eventsAffected: [],
    horizonDays: 14, // small and deliberate — only 1-2 real candidates fall inside it, both occupied
  });

  assert.equal(plan.entries[0].destination, null, 'must report unresolved rather than drifting past the real 14-day horizon to find a far-future free slot');
  assert.ok(plan.entries[0].unresolvedReason);
});

test('planHolidayReschedule: consecutive holidays / a holiday spanning multiple of the subject’s own occurrences are all skipped past by the destination search', () => {
  const classroom = classroomWithSciencePattern();
  const lesson = lessonOn('2026-08-25', 3); // Tuesday
  // A long break covering BOTH this Tuesday and the following Thursday's own Science occurrences.
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-25', endDate: '2026-09-01' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-25',
    endDate: '2026-09-01',
    lessonsAffected: [lesson],
    lessonsInSearchWindow: [],
    eventsAffected: [],
  });

  assert.equal(plan.entries[0].destination.date, '2026-09-03', 'must land on the first Thursday genuinely AFTER the whole break, not inside it');
});

test('planHolidayReschedule: a ScheduledEvent overlapping the range requires an explicit exam decision — never silently proceeds as conflict-free', () => {
  const classroom = classroomWithSciencePattern();
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });
  const exam = { id: 'exam-1', date: '2026-08-27', endDate: '2026-08-27', eventType: 'exam', subjectId: 'science' };

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [],
    lessonsInSearchWindow: [],
    eventsAffected: [exam],
  });

  assert.equal(plan.requiresExamDecision, true);
  assert.deepEqual(plan.affectedEvents, [exam]);
});

test('planHolidayReschedule: zero affected lessons and zero events is a safe, empty, non-blocking plan', () => {
  const classroom = classroomWithSciencePattern();
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [],
    lessonsInSearchWindow: [],
    eventsAffected: [],
  });

  assert.equal(plan.entries.length, 0);
  assert.equal(plan.requiresExamDecision, false);
  assert.equal(plan.unresolvedCount, 0);
});

test('buildDraftClassroomWithPendingHoliday: marks the range as a holiday on the DRAFT only, never mutating the real classroom', () => {
  const classroom = classroomWithSciencePattern();
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  assert.equal(schoolCalendarService.getWorkingDayStatus(draftClassroom, '2026-08-27').isWorkingDay, false);
  assert.equal(schoolCalendarService.getWorkingDayStatus(classroom, '2026-08-27').isWorkingDay, true, 'the REAL classroom must be completely unaffected until the teacher actually confirms');
});

test('planHolidayReschedule: teacher-scoped — a destination belonging to a DIFFERENT teacher is never selected, even if free', () => {
  const classroom = classroomWithSciencePattern();
  // A second, different teacher's own Science period on Friday(5) p3 — closer in time than the real teacher-A's own next Tuesday.
  timetableService.upsertSlot(classroom, { weekday: 5, periodNumber: 3, subjectId: 'science', teacherUid: 'teacher-B' });
  const lesson = lessonOn('2026-08-27', 3); // Thursday, teacher-A, about to be a holiday
  const draftClassroom = holidayRescheduleService.buildDraftClassroomWithPendingHoliday(classroom, { startDate: '2026-08-27', endDate: '2026-08-27' });

  const plan = holidayRescheduleService.planHolidayReschedule(draftClassroom, {
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    lessonsAffected: [lesson],
    lessonsInSearchWindow: [],
    eventsAffected: [],
  });

  assert.equal(plan.entries[0].destination.date, '2026-09-01', 'must skip Friday (teacher-B) and land on the next teacher-A Tuesday');
});

test('findUnresolvedHolidayLessons: surfaces a Lesson sitting on a Holiday date with open concepts', () => {
  const classroom = classroomWithSciencePattern();
  schoolCalendarService.setHolidayException(classroom, '2026-08-27', 'Test Holiday');
  const lesson = lessonOn('2026-08-27', 3);

  const unresolved = holidayRescheduleService.findUnresolvedHolidayLessons(classroom, [lesson]);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].lesson.id, lesson.id);
  assert.deepEqual(unresolved[0].openConceptIds, ['c1', 'c2']);
});

test('findUnresolvedHolidayLessons: a Lesson with nothing open (already handled) is never reported, even on a Holiday date', () => {
  const classroom = classroomWithSciencePattern();
  schoolCalendarService.setHolidayException(classroom, '2026-08-27', 'Test Holiday');
  const lesson = lessonOn('2026-08-27', 3, { conceptIds: ['c1'], executedConceptIds: ['c1'] });

  assert.deepEqual(holidayRescheduleService.findUnresolvedHolidayLessons(classroom, [lesson]), []);
});

test('findUnresolvedHolidayLessons: a Lesson on an ORDINARY (non-holiday) date is never reported, regardless of open concepts', () => {
  const classroom = classroomWithSciencePattern();
  schoolCalendarService.setHolidayException(classroom, '2026-08-27', 'Test Holiday');
  const lesson = lessonOn('2026-08-25', 3); // Tuesday — not a holiday

  assert.deepEqual(holidayRescheduleService.findUnresolvedHolidayLessons(classroom, [lesson]), []);
});
