import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as timetableService from '../../js/services/timetableService.js';
import * as schoolCalendarService from '../../js/services/schoolCalendarService.js';
import { createTimetablePeriod } from '../../js/models/Timetable.js';
import { createScheduledEvent } from '../../js/models/ScheduledEvent.js';
import { createLesson } from '../../js/models/Lesson.js';
import { buildTeachingSlotId } from '../../js/services/timetableService.js';
import { buildWeeklyPlanGrid, getLessonsFromWeeklyPlanGrid } from '../../js/services/weeklyPlanGridService.js';
import { getMondayStartOfWeek, shiftDateKey } from '../../js/utils/dateHelpers.js';

const FELLOW = 'fellow-uid';
const OTHER_TEACHER = 'other-teacher-uid';

const WEEK_START = getMondayStartOfWeek('2026-09-24');

function buildClassroom() {
  const classroom = {
    id: 'classroom-1',
    name: 'Test Classroom',
    learningRecord: {
      subjects: [
        {
          id: 'science',
          title: 'Science',
          units: [{ id: 'unit-1', title: 'Photosynthesis Unit', concepts: [{ id: 'concept-1', title: 'Chlorophyll' }, { id: 'concept-2', title: 'Sunlight' }] }],
        },
      ],
    },
  };
  timetableService.setPeriods(classroom, [
    createTimetablePeriod({ periodNumber: 1, startTime: '09:00', endTime: '09:40' }),
    createTimetablePeriod({ periodNumber: 2, startTime: '09:40', endTime: '10:20' }),
  ]);
  for (let offset = 0; offset < 5; offset += 1) {
    const weekday = timetableService.weekdayOfDateKey(shiftDateKey(WEEK_START, offset));
    timetableService.upsertSlot(classroom, { weekday, periodNumber: 1, subjectId: 'science', teacherUid: FELLOW });
    timetableService.upsertSlot(classroom, { weekday, periodNumber: 2, subjectId: 'science', teacherUid: OTHER_TEACHER });
  }
  return classroom;
}

test('buildWeeklyPlanGrid: only shows periods taught by the requested teacherUid, not a co-teacher\'s periods in the same classroom', () => {
  const classroom = buildClassroom();
  const grid = buildWeeklyPlanGrid(classroom, { events: [], lessons: [], teacherUid: FELLOW, weekStartDate: WEEK_START });
  assert.equal(grid.length, 5);
  grid.forEach((day) => {
    assert.equal(day.periods.length, 1);
    assert.equal(day.periods[0].periodNumber, 1);
  });
});

test('buildWeeklyPlanGrid: a holiday day has no periods and isWorkingDay is false', () => {
  const classroom = buildClassroom();
  const tuesday = shiftDateKey(WEEK_START, 1);
  schoolCalendarService.setHolidayException(classroom, tuesday, 'Festival');

  const grid = buildWeeklyPlanGrid(classroom, { events: [], lessons: [], teacherUid: FELLOW, weekStartDate: WEEK_START });
  const tuesdayEntry = grid.find((day) => day.dateKey === tuesday);
  assert.equal(tuesdayEntry.isWorkingDay, false);
  assert.equal(tuesdayEntry.exceptionType, 'holiday');
  assert.deepEqual(tuesdayEntry.periods, []);
});

test('buildWeeklyPlanGrid: an exam overlapping a period suppresses it — the period never appears as a regular lesson', () => {
  const classroom = buildClassroom();
  const wednesday = shiftDateKey(WEEK_START, 2);
  const events = [
    createScheduledEvent({ classroomId: classroom.id, date: wednesday, startTime: '09:00', endTime: '09:40', title: 'Unit Test' }),
  ];

  const grid = buildWeeklyPlanGrid(classroom, { events, lessons: [], teacherUid: FELLOW, weekStartDate: WEEK_START });
  const wednesdayEntry = grid.find((day) => day.dateKey === wednesday);
  assert.equal(wednesdayEntry.isWorkingDay, true); // still a working day...
  assert.equal(wednesdayEntry.periods.length, 0); // ...but Period 1 (the Fellow's only period) is suppressed by the exam
});

test('buildWeeklyPlanGrid: resolves Unit (from curriculumUnitId) and Topic (from conceptIds, every concept, not just the first)', () => {
  const classroom = buildClassroom();
  const monday = WEEK_START;
  const teachingSlotId = buildTeachingSlotId(classroom.id, monday, 1);
  const lesson = createLesson({ classroomId: classroom.id, date: monday, teachingSlotId, curriculumUnitId: 'unit-1', conceptIds: ['concept-1', 'concept-2'] });

  const grid = buildWeeklyPlanGrid(classroom, { events: [], lessons: [lesson], teacherUid: FELLOW, weekStartDate: WEEK_START });
  const mondayEntry = grid.find((day) => day.dateKey === monday);
  const period = mondayEntry.periods[0];
  assert.equal(period.unit.title, 'Photosynthesis Unit');
  assert.deepEqual(period.concepts.map((c) => c.title), ['Chlorophyll', 'Sunlight']);
  assert.equal(period.lesson.id, lesson.id);
});

test('buildWeeklyPlanGrid: a period with no Lesson yet still appears, with null lesson/unit and empty concepts — never an error', () => {
  const classroom = buildClassroom();
  const grid = buildWeeklyPlanGrid(classroom, { events: [], lessons: [], teacherUid: FELLOW, weekStartDate: WEEK_START });
  const mondayEntry = grid.find((day) => day.dateKey === WEEK_START);
  const period = mondayEntry.periods[0];
  assert.equal(period.lesson, null);
  assert.equal(period.unit, null);
  assert.deepEqual(period.concepts, []);
});

test('getLessonsFromWeeklyPlanGrid: flattens every real Lesson across the whole grid, skipping periods with none', () => {
  const classroom = buildClassroom();
  const monday = WEEK_START;
  const friday = shiftDateKey(WEEK_START, 4);
  const lessonMonday = createLesson({ classroomId: classroom.id, date: monday, teachingSlotId: buildTeachingSlotId(classroom.id, monday, 1) });
  const lessonFriday = createLesson({ classroomId: classroom.id, date: friday, teachingSlotId: buildTeachingSlotId(classroom.id, friday, 1) });

  const grid = buildWeeklyPlanGrid(classroom, { events: [], lessons: [lessonMonday, lessonFriday], teacherUid: FELLOW, weekStartDate: WEEK_START });
  const lessons = getLessonsFromWeeklyPlanGrid(grid);
  assert.equal(lessons.length, 2);
  assert.ok(lessons.some((lesson) => lesson.id === lessonMonday.id));
  assert.ok(lessons.some((lesson) => lesson.id === lessonFriday.id));
});
