import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createScheduledEvent } from '../../js/models/ScheduledEvent.js';
import * as scheduledEventService from '../../js/services/scheduledEventService.js';

const MONDAY = '2026-09-14';
const TUESDAY = '2026-09-15';

test('getEventsForDate: filters a mixed-date event list down to exactly one date, ordered by start time', () => {
  const examLate = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '10:45', endTime: '11:30', title: 'Later Exam' });
  const examEarly = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '09:45', title: 'Earlier Exam' });
  const examOtherDate = createScheduledEvent({ classroomId: 'c1', date: TUESDAY, startTime: '09:00', endTime: '09:45', title: 'Tuesday Exam' });

  const result = scheduledEventService.getEventsForDate([examLate, examEarly, examOtherDate], MONDAY);

  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'Earlier Exam');
  assert.equal(result[1].title, 'Later Exam');
});

test('getEventsForDate: a date with no matching events returns an empty array, never undefined/throws', () => {
  const exam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '09:45', title: 'Exam' });
  assert.deepEqual(scheduledEventService.getEventsForDate([exam], TUESDAY), []);
});

test('getEventsByType: filters to exactly one eventType', () => {
  const exam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '09:45', eventType: 'exam' });
  const assembly = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '09:45', eventType: 'assembly' });
  assert.deepEqual(scheduledEventService.getEventsByType([exam, assembly], 'exam'), [exam]);
});

test('resolveEventSubjectTitle: resolves the classroom\'s own Learning Record subject title for the event\'s canonical subjectId', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  classroom.learningRecord.subjects.push({ id: 'record-1', subjectId: 'science', title: 'Science', units: [] });
  const exam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:30', subjectId: 'science' });
  assert.equal(scheduledEventService.resolveEventSubjectTitle(classroom, exam), 'Science');
});

test('resolveEventSubjectTitle: an event with no subjectId at all (a future non-subject event type) resolves to an empty string, never a thrown error', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  const assembly = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '09:30', eventType: 'assembly', subjectId: null });
  assert.equal(scheduledEventService.resolveEventSubjectTitle(classroom, assembly), '');
});

test('getEventTypeLabel: "exam" labels as "Exam"; an unrecognized future type title-cases sensibly instead of showing a raw enum value', () => {
  assert.equal(scheduledEventService.getEventTypeLabel('exam'), 'Exam');
  assert.equal(scheduledEventService.getEventTypeLabel('school_event'), 'School Event');
  assert.equal(scheduledEventService.getEventTypeLabel('field_trip'), 'Field Trip');
});
