import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as timetableService from '../../js/services/timetableService.js';

/**
 * A real, week-long pattern, not dummy per-test data invented ad hoc —
 * mirrors the approved reference: Period 1-3 every weekday (Mon-Fri),
 * Science on Tue and Thu Period 3, Maths on Mon/Wed/Fri Period 2.
 * Sat has no periods configured at all (no class that day), matching
 * the reference's "—" empty Saturday column.
 */
function classroomWithPattern() {
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  timetableService.setPeriods(classroom, [
    { periodNumber: 1, startTime: '09:00', endTime: '09:40' },
    { periodNumber: 2, startTime: '10:15', endTime: '10:55' },
    { periodNumber: 3, startTime: '11:30', endTime: '12:10' },
  ]);
  // Monday=1 ... Friday=5
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 2, subjectId: 'mathematics' });
  timetableService.upsertSlot(classroom, { weekday: 3, periodNumber: 2, subjectId: 'mathematics' });
  timetableService.upsertSlot(classroom, { weekday: 5, periodNumber: 2, subjectId: 'mathematics' });
  timetableService.upsertSlot(classroom, { weekday: 2, periodNumber: 3, subjectId: 'science' });
  timetableService.upsertSlot(classroom, { weekday: 4, periodNumber: 3, subjectId: 'science' });
  return classroom;
}

test('getTimetable: a brand-new classroom has an empty, real (not dummy) timetable', () => {
  const classroom = createClassroom({ id: 'classroom-empty', schoolName: 'Test', gradeSection: 'G1' });
  const timetable = timetableService.getTimetable(classroom);
  assert.deepEqual(timetable.periods, []);
  assert.deepEqual(timetable.slots, []);
});

test('upsertSlot + getSlot: round-trips a subject assignment for one weekday/period', () => {
  const classroom = classroomWithPattern();
  const slot = timetableService.getSlot(classroom, 2, 3);
  assert.equal(slot.subjectId, 'science');
});

test('getSlot: a weekday/period with nothing configured returns null (no class that period)', () => {
  const classroom = classroomWithPattern();
  assert.equal(timetableService.getSlot(classroom, 6, 1), null); // Saturday, Period 1
});

test('upsertSlot: calling it twice for the same weekday/period replaces the subject, not duplicates the slot', () => {
  const classroom = classroomWithPattern();
  timetableService.upsertSlot(classroom, { weekday: 2, periodNumber: 3, subjectId: 'english' });
  const matching = timetableService.getTimetable(classroom).slots.filter((s) => s.weekday === 2 && s.periodNumber === 3);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].subjectId, 'english');
});

test('removeSlot: clears a period back to "no class"', () => {
  const classroom = classroomWithPattern();
  timetableService.removeSlot(classroom, { weekday: 2, periodNumber: 3 });
  assert.equal(timetableService.getSlot(classroom, 2, 3), null);
});

test('getConcreteSlotsForDateRange: preloads the real subject for every real date in range, using the classroom\'s actual pattern', () => {
  const classroom = classroomWithPattern();
  // 2026-08-24 is a Monday; range covers Mon-Sun that week.
  const slots = timetableService.getConcreteSlotsForDateRange(classroom, '2026-08-24', '2026-08-30');

  const tuesdayScience = slots.find((s) => s.date === '2026-08-25' && s.periodNumber === 3);
  assert.ok(tuesdayScience, 'Tuesday Period 3 should be a concrete slot');
  assert.equal(tuesdayScience.subjectId, 'science');
  assert.equal(tuesdayScience.duration, 40);

  const mondayMaths = slots.find((s) => s.date === '2026-08-24' && s.periodNumber === 2);
  assert.equal(mondayMaths.subjectId, 'mathematics');

  // Saturday (2026-08-29) has no configured periods at all -> no slots that date.
  assert.equal(slots.some((s) => s.date === '2026-08-29'), false);
});

test('getConcreteSlotsForDateRange: the same (classroom, date, period) always derives the same TeachingSlot id', () => {
  const classroom = classroomWithPattern();
  const first = timetableService.getConcreteSlotsForDateRange(classroom, '2026-08-24', '2026-08-24');
  const second = timetableService.getConcreteSlotsForDateRange(classroom, '2026-08-24', '2026-08-24');
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].id, timetableService.buildTeachingSlotId('classroom-1', '2026-08-24', 2));
});

test('getNextFutureSlotForSubject: finds the next occurrence later the SAME day if a matching period exists after the given one', () => {
  const classroom = classroomWithPattern();
  timetableService.upsertSlot(classroom, { weekday: 2, periodNumber: 1, subjectId: 'science' }); // Tue Period 1 also Science
  // Tue 2026-08-25 Period 1 is 'science'; asking "after Period 1" the same Tuesday should find Period 3, same date.
  const next = timetableService.getNextFutureSlotForSubject(classroom, {
    subjectId: 'science',
    afterDateKey: '2026-08-25',
    afterPeriodNumber: 1,
  });
  assert.equal(next.date, '2026-08-25');
  assert.equal(next.periodNumber, 3);
});

test('getNextFutureSlotForSubject: "Move to next Science period" — finds Thursday from Tuesday, matching the reference example', () => {
  const classroom = classroomWithPattern();
  const next = timetableService.getNextFutureSlotForSubject(classroom, {
    subjectId: 'science',
    afterDateKey: '2026-08-25', // Tuesday
    afterPeriodNumber: 3,
  });
  assert.equal(next.date, '2026-08-27'); // Thursday
  assert.equal(next.periodNumber, 3);
  assert.equal(next.subjectId, 'science');
});

test('getNextFutureSlotForSubject: returns null when the subject never occurs again within the horizon', () => {
  const classroom = classroomWithPattern();
  const next = timetableService.getNextFutureSlotForSubject(classroom, {
    subjectId: 'art', // never scheduled anywhere in this pattern
    afterDateKey: '2026-08-25',
    afterPeriodNumber: 1,
    horizonDays: 10,
  });
  assert.equal(next, null);
});

test('getOtherFutureSlotsForSubject: returns the alternatives strictly after the primary suggestion, with no duplicate of it', () => {
  const classroom = classroomWithPattern();
  const primary = timetableService.getNextFutureSlotForSubject(classroom, {
    subjectId: 'science',
    afterDateKey: '2026-08-25',
    afterPeriodNumber: 3,
  });
  const others = timetableService.getOtherFutureSlotsForSubject(classroom, {
    subjectId: 'science',
    afterDateKey: primary.date,
    afterPeriodNumber: primary.periodNumber,
    limit: 2,
  });
  assert.equal(others.length, 2);
  assert.ok(others.every((slot) => !(slot.date === primary.date && slot.periodNumber === primary.periodNumber)));
  assert.equal(others[0].date, '2026-09-01'); // next Tuesday
});

test('suggestCarryForwardTargets: primary is the next Science period, others are the alternatives after it (no duplicate)', () => {
  const classroom = classroomWithPattern();
  const { primary, others } = timetableService.suggestCarryForwardTargets(classroom, {
    subjectId: 'science',
    afterDateKey: '2026-08-25', // Tuesday
    afterPeriodNumber: 3,
  });
  assert.equal(primary.date, '2026-08-27'); // Thursday
  assert.equal(others.length, 2);
  assert.ok(others.every((slot) => slot.date !== primary.date));
  assert.equal(others[0].date, '2026-09-01');
});

test('suggestCarryForwardTargets: no future occurrence -> primary null, others empty', () => {
  const classroom = classroomWithPattern();
  const { primary, others } = timetableService.suggestCarryForwardTargets(classroom, {
    subjectId: 'art',
    afterDateKey: '2026-08-25',
    afterPeriodNumber: 3,
    otherLimit: 2,
  });
  assert.equal(primary, null);
  assert.deepEqual(others, []);
});

// ---------------------------------------------------------------------
// Phase S — validateTimetableDraft() (Manage Timetable)
// ---------------------------------------------------------------------

test('validateTimetableDraft: a well-formed, non-overlapping set of periods is valid', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([
    { periodNumber: 1, startTime: '09:00', endTime: '09:40' },
    { periodNumber: 2, startTime: '10:15', endTime: '10:55' },
    { periodNumber: 3, startTime: '11:30', endTime: '12:10' },
  ]);
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('validateTimetableDraft: an empty draft (no periods yet) is valid', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([]);
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('validateTimetableDraft: end time at or before start time is invalid', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([
    { periodNumber: 1, startTime: '09:40', endTime: '09:00' },
  ]);
  assert.equal(valid, false);
  assert.equal(errors.some((e) => e.type === 'invalidTime' && e.periodNumber === 1), true);
});

test('validateTimetableDraft: equal start and end time is invalid (zero-length period)', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([
    { periodNumber: 1, startTime: '09:00', endTime: '09:00' },
  ]);
  assert.equal(valid, false);
  assert.equal(errors.some((e) => e.type === 'invalidTime'), true);
});

test('validateTimetableDraft: malformed time strings are invalid, not thrown', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([
    { periodNumber: 1, startTime: 'nine am', endTime: '09:40' },
  ]);
  assert.equal(valid, false);
  assert.equal(errors.some((e) => e.type === 'invalidTime'), true);
});

test('validateTimetableDraft: two periods with overlapping time ranges are invalid', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([
    { periodNumber: 1, startTime: '09:00', endTime: '10:00' },
    { periodNumber: 2, startTime: '09:30', endTime: '10:30' },
  ]);
  assert.equal(valid, false);
  assert.equal(errors.some((e) => e.type === 'overlappingPeriods'), true);
});

test('validateTimetableDraft: back-to-back periods (one ends exactly when the next starts) do NOT overlap', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([
    { periodNumber: 1, startTime: '09:00', endTime: '09:40' },
    { periodNumber: 2, startTime: '09:40', endTime: '10:20' },
  ]);
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('validateTimetableDraft: overlap is still detected regardless of input order (sorts before comparing)', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([
    { periodNumber: 2, startTime: '09:30', endTime: '10:30' },
    { periodNumber: 1, startTime: '09:00', endTime: '10:00' },
  ]);
  assert.equal(valid, false);
  assert.equal(errors.some((e) => e.type === 'overlappingPeriods'), true);
});

test('validateTimetableDraft: the same period number listed twice is invalid', () => {
  const { valid, errors } = timetableService.validateTimetableDraft([
    { periodNumber: 1, startTime: '09:00', endTime: '09:40' },
    { periodNumber: 1, startTime: '11:00', endTime: '11:40' },
  ]);
  assert.equal(valid, false);
  assert.equal(errors.some((e) => e.type === 'duplicatePeriod' && e.periodNumber === 1), true);
});

// ---------------------------------------------------------------------
// Phase S — recurring-pattern edits must never rewrite historical Lessons
// ---------------------------------------------------------------------

test('buildTeachingSlotId: a past date+period keeps the same id after the recurring pattern changes — historical Lessons are keyed by date, never by the current recurring subject', () => {
  const classroom = classroomWithPattern();
  const idBefore = timetableService.buildTeachingSlotId(classroom.id, '2026-08-24', 2); // Monday, Period 2 (Mathematics)

  // Editing the recurring pattern for that exact weekday/period...
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 2, subjectId: 'english' });

  const idAfter = timetableService.buildTeachingSlotId(classroom.id, '2026-08-24', 2);
  assert.equal(idBefore, idAfter); // ...never changes the id a Lesson for that real date is stored under.
});

test('getConcreteSlotsForDateRange: a past date reflects whatever subject the recurring pattern says NOW — the pattern has no memory of what it said before, which is exactly why historical protection lives in the Lesson’s own stored data, not in the pattern', () => {
  const classroom = classroomWithPattern();
  const before = timetableService.getConcreteSlotsForDateRange(classroom, '2026-08-24', '2026-08-24'); // Monday
  assert.equal(before.find((s) => s.periodNumber === 2).subjectId, 'mathematics');

  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 2, subjectId: 'english' });

  const after = timetableService.getConcreteSlotsForDateRange(classroom, '2026-08-24', '2026-08-24');
  assert.equal(after.find((s) => s.periodNumber === 2).subjectId, 'english');
  // A real Lesson document already attached to that Monday's teachingSlotId is untouched by this
  // change (see the buildTeachingSlotId test above) — only this on-demand grid label changed.
});
