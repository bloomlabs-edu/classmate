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
    endDate: MONDAY,
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

// ---- groupEventsByTitle() -------------------------------------------------
//
// Round 4's School Calendar grouping fix: events sharing the same
// `title` (e.g. five subjects all under "Quarterly Examinations")
// group together under one shared heading instead of each repeating
// the exam name as prominent per-tile content.

test('groupEventsByTitle: events sharing the same title are grouped together, ordered by date/time within the group', () => {
  const examTamil = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:00', title: 'Quarterly Examinations', subjectId: 'tamil' });
  const examScience = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '08:00', endTime: '09:00', title: 'Quarterly Examinations', subjectId: 'science' });
  const examMaths = createScheduledEvent({ classroomId: 'c1', date: TUESDAY, startTime: '09:00', endTime: '10:00', title: 'Quarterly Examinations', subjectId: 'maths' });

  const groups = scheduledEventService.groupEventsByTitle([examTamil, examScience, examMaths]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Quarterly Examinations');
  assert.deepEqual(groups[0].events.map((e) => e.subjectId), ['science', 'tamil', 'maths']);
});

test('groupEventsByTitle: a title held by only one event still forms a valid (single-member) group — no special-casing collapses it away', () => {
  const soloExam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:00', title: 'Unit Test', subjectId: 'science' });
  const groups = scheduledEventService.groupEventsByTitle([soloExam]);
  assert.deepEqual(groups, [{ title: 'Unit Test', events: [soloExam] }]);
});

test('groupEventsByTitle: multiple distinct exam names produce multiple distinct groups, ordered by each group\'s earliest member', () => {
  const quarterly = createScheduledEvent({ classroomId: 'c1', date: TUESDAY, startTime: '09:00', endTime: '10:00', title: 'Quarterly Examinations' });
  const unitTest = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:00', title: 'Unit Test' });

  const groups = scheduledEventService.groupEventsByTitle([quarterly, unitTest]);

  assert.equal(groups.length, 2);
  // Unit Test (Monday) sorts before Quarterly Examinations (Tuesday).
  assert.deepEqual(groups.map((g) => g.title), ['Unit Test', 'Quarterly Examinations']);
});

test('groupEventsByTitle: never mutates or duplicates the underlying events — group members are the exact same object references', () => {
  const examA = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:00', title: 'Quarterly Examinations' });
  const examB = createScheduledEvent({ classroomId: 'c1', date: TUESDAY, startTime: '09:00', endTime: '10:00', title: 'Quarterly Examinations' });
  const original = [examA, examB];
  const originalSnapshot = JSON.stringify(original);

  const groups = scheduledEventService.groupEventsByTitle(original);

  assert.equal(groups[0].events.length, 2);
  assert.equal(groups[0].events[0], examA);
  assert.equal(groups[0].events[1], examB);
  assert.equal(JSON.stringify(original), originalSnapshot); // untouched
  assert.equal(original.length, 2); // no duplication into the source array either
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

test('buildDuplicateExamFields: an explicit endDate (a genuine range) carries through to the duplicate', () => {
  const source = createScheduledEvent({ classroomId: 'c1', date: MONDAY, endDate: TUESDAY, startTime: '09:00', endTime: '10:00', title: 'Quarterly Examinations' });
  const fields = scheduledEventService.buildDuplicateExamFields(source);
  assert.equal(fields.endDate, TUESDAY);
});

// ---- endDate / date range — the examination DATE RANGE feature -----------

test('getEventEndDate: returns event.endDate when set', () => {
  const exam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, endDate: TUESDAY, startTime: '09:00', endTime: '10:00' });
  assert.equal(scheduledEventService.getEventEndDate(exam), TUESDAY);
});

test('getEventEndDate: falls back to event.date when endDate is missing entirely — backward compatibility for a document saved before this field existed, with no migration', () => {
  // A plain object literal, NOT createScheduledEvent() — this is
  // exactly what a pre-existing Firestore document looks like once
  // read back: no `endDate` key at all, not even `undefined` set
  // explicitly.
  const legacyExam = { id: 'e1', classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:00', title: 'Unit Test', subjectId: 'science' };
  assert.equal('endDate' in legacyExam, false);
  assert.equal(scheduledEventService.getEventEndDate(legacyExam), MONDAY);
});

test('formatEventDateRangeLabel: a single-day event (the existing, pre-feature default) displays as one date, not a range', () => {
  const exam = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', startTime: '09:00', endTime: '10:00' });
  assert.equal(scheduledEventService.formatEventDateRangeLabel(exam), '24 Sep 2026');
});

test('formatEventDateRangeLabel: a genuine multi-day event displays as a compact range', () => {
  const exam = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', endDate: '2026-09-30', startTime: '09:00', endTime: '10:00' });
  assert.equal(scheduledEventService.formatEventDateRangeLabel(exam), '24–30 Sep 2026');
});

test('formatEventDateRangeLabel: a legacy event with no endDate key at all still displays as one date, never throws', () => {
  const legacyExam = { date: '2026-09-24' };
  assert.equal(scheduledEventService.formatEventDateRangeLabel(legacyExam), '24 Sep 2026');
});

// The worked example from this feature's own product brief: a
// "Quarterly Examinations" window (24–30 Sep) containing individually
// dated subject exams. The window is metadata describing the overall
// period; each subject exam keeps its own real date — never seven
// separate daily events, never the window's range overwriting a
// subject's own date.
test('getGroupDateRange / formatGroupDateRangeLabel: the window is the min/max span across dated subject exams, each of which keeps its own individual date', () => {
  const science = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', startTime: '09:00', endTime: '10:30', title: 'Quarterly Examinations', subjectId: 'science' });
  const maths = createScheduledEvent({ classroomId: 'c1', date: '2026-09-25', startTime: '09:00', endTime: '10:30', title: 'Quarterly Examinations', subjectId: 'maths' });
  const socialScience = createScheduledEvent({ classroomId: 'c1', date: '2026-09-29', startTime: '09:00', endTime: '11:30', title: 'Quarterly Examinations', subjectId: 'social_science' });
  const english = createScheduledEvent({ classroomId: 'c1', date: '2026-09-30', startTime: '09:00', endTime: '10:30', title: 'Quarterly Examinations', subjectId: 'english' });

  const group = scheduledEventService.groupEventsByTitle([science, maths, socialScience, english])[0];

  assert.deepEqual(scheduledEventService.getGroupDateRange(group.events), { start: '2026-09-24', end: '2026-09-30' });
  assert.equal(scheduledEventService.formatGroupDateRangeLabel(group.events), '24–30 Sep 2026');

  // No duplication: exactly the 4 subject exams, never 7 (one per day
  // of the range), and each keeps its own real date untouched.
  assert.equal(group.events.length, 4);
  assert.equal(science.date, '2026-09-24');
  assert.equal(maths.date, '2026-09-25');
  assert.equal(socialScience.date, '2026-09-29');
  assert.equal(english.date, '2026-09-30');
});

test('getGroupDateRange: an explicit no-subject window placeholder event participates in the same computation as the dated subject exams — no special-casing needed', () => {
  const windowPlaceholder = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', endDate: '2026-09-30', startTime: '09:00', endTime: '10:00', title: 'Quarterly Examinations', subjectId: null });
  const science = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', startTime: '09:00', endTime: '10:30', title: 'Quarterly Examinations', subjectId: 'science' });

  const range = scheduledEventService.getGroupDateRange([windowPlaceholder, science]);
  assert.deepEqual(range, { start: '2026-09-24', end: '2026-09-30' });
});

test('getGroupDateRange: a single-day group (one event, or every event on the same day) reduces to one plain date, never "X – X"', () => {
  const exam = createScheduledEvent({ classroomId: 'c1', date: MONDAY, startTime: '09:00', endTime: '10:00', title: 'Unit Test' });
  assert.equal(scheduledEventService.formatGroupDateRangeLabel([exam]), '14 Sep 2026');
});
