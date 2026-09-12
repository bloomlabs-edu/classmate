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

test('resolveEventSubjectTitle: a canonical subjectId NOT yet configured in this classroom\'s Learning Record still resolves to the canonical registry\'s own title, not the raw id', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  const exam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:30', subjectId: 'tamil' });
  assert.equal(scheduledEventService.resolveEventSubjectTitle(classroom, exam), 'Tamil');
});

test('resolveEventSubjectTitle: customSubjectName wins outright, even when subjectId is also set', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  classroom.learningRecord.subjects.push({ id: 'record-1', subjectId: 'science', title: 'Science', units: [] });
  const exam = createScheduledEvent({
    classroomId: 'c1',
    date: MONDAY,
    startTime: '09:00',
    endTime: '10:30',
    subjectId: 'custom_french',
    customSubjectName: 'French',
  });
  assert.equal(scheduledEventService.resolveEventSubjectTitle(classroom, exam), 'French');
});

test('getEventTypeLabel: "exam" labels as "Exam"; an unrecognized future type title-cases sensibly instead of showing a raw enum value', () => {
  assert.equal(scheduledEventService.getEventTypeLabel('exam'), 'Exam');
  assert.equal(scheduledEventService.getEventTypeLabel('school_event'), 'School Event');
  assert.equal(scheduledEventService.getEventTypeLabel('field_trip'), 'Field Trip');
});

test('buildDuplicateExamFields: copies every real field a duplicate needs, and nothing else', () => {
  const source = createScheduledEvent({
    classroomId: 'c1',
    date: MONDAY,
    startTime: '10:00',
    endTime: '12:30',
    title: 'Quarterly Examinations',
    subjectId: 'tamil',
    customSubjectName: null,
    gradeLabel: 'Grade 8A',
    room: '204',
    invigilatorUid: 'teacher-1',
  });

  const fields = scheduledEventService.buildDuplicateExamFields(source);

  assert.deepEqual(fields, {
    date: MONDAY,
    startTime: '10:00',
    endTime: '12:30',
    title: 'Quarterly Examinations',
    subjectId: 'tamil',
    customSubjectName: null,
    gradeLabel: 'Grade 8A',
    room: '204',
    invigilatorUid: 'teacher-1',
  });
});

test('buildDuplicateExamFields: never carries id/classroomId/createdAt/updatedAt/eventType — no field a caller could mistake for a link back to the source', () => {
  const source = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '09:45', title: 'Exam' });
  const fields = scheduledEventService.buildDuplicateExamFields(source);

  assert.equal('id' in fields, false);
  assert.equal('classroomId' in fields, false);
  assert.equal('createdAt' in fields, false);
  assert.equal('updatedAt' in fields, false);
  assert.equal('eventType' in fields, false);
  assert.equal('batchId' in fields, false);
  assert.equal('duplicatedFrom' in fields, false);
});

test('buildDuplicateExamFields + createScheduledEvent: the resulting duplicate is a genuinely independent record (its own id), editing one never touches the other', () => {
  const source = createScheduledEvent({
    classroomId: 'c1',
    date: MONDAY,
    startTime: '10:00',
    endTime: '12:30',
    title: 'Quarterly Examinations',
    subjectId: 'tamil',
  });

  const duplicate = createScheduledEvent({ classroomId: 'c1', ...scheduledEventService.buildDuplicateExamFields(source) });

  assert.notEqual(duplicate.id, source.id);

  // Editing the duplicate's own copy must never mutate the source.
  duplicate.date = TUESDAY;
  duplicate.subjectId = 'science';
  assert.equal(source.date, MONDAY);
  assert.equal(source.subjectId, 'tamil');
});
