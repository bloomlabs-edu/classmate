import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createScheduledEvent } from '../../js/models/ScheduledEvent.js';
import { createAssessment } from '../../js/models/Assessment.js';
import * as timetableService from '../../js/services/timetableService.js';
import * as assessmentTimetableLinkService from '../../js/services/assessmentTimetableLinkService.js';

const EXAM_DATE = '2026-09-24'; // whichever weekday this is, buildClassroomWithScienceAndMath() derives its slots' weekday from it directly

function buildClassroomWithScienceAndMath() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'G1' });
  classroom.learningRecord.subjects.push({ id: 'record-science', subjectId: 'science', title: 'Science', units: [] });
  classroom.learningRecord.subjects.push({ id: 'record-math', subjectId: 'mathematics', title: 'Mathematics', units: [] });

  const weekday = timetableService.weekdayOfDateKey(EXAM_DATE);
  classroom.timetable = {
    periods: [
      { periodNumber: 1, startTime: '09:00', endTime: '09:45' },
      { periodNumber: 2, startTime: '09:45', endTime: '10:30' },
    ],
    slots: [
      { weekday, periodNumber: 1, subjectId: 'science', teacherUid: null },
      { weekday, periodNumber: 2, subjectId: 'science', teacherUid: null },
    ],
  };
  return classroom;
}

test('getSurfaceableExamAssessments: a Science exam surfaces when Science is in Learning Activities', () => {
  const classroom = buildClassroomWithScienceAndMath();
  const scienceExam = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });

  const result = assessmentTimetableLinkService.getSurfaceableExamAssessments(classroom, [scienceExam], []);

  assert.equal(result.length, 1);
  assert.equal(result[0].subjectTitle, 'Science');
  assert.equal(result[0].learningSubject.id, 'record-science');
  assert.equal(result[0].linkedAssessment, null);
});

test('PHYSICAL EDUCATION ACCEPTANCE TEST: a PE exam does NOT surface when PE is not in Learning Activities, even though it exists in the Timetable', () => {
  const classroom = buildClassroomWithScienceAndMath(); // only Science + Mathematics in Learning Activities
  const peExam = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'physical_education' });
  const scienceExam = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });

  const result = assessmentTimetableLinkService.getSurfaceableExamAssessments(classroom, [peExam, scienceExam], []);

  assert.equal(result.length, 1, 'only the Science exam should surface');
  assert.equal(result[0].subjectTitle, 'Science');
  assert.ok(
    result.every((item) => item.learningSubject.subjectId !== 'physical_education'),
    'Physical Education must never appear in the surfaced list'
  );
});

test('getSurfaceableExamAssessments: an already-linked exam reports its existing Assessment, never creating a second one', () => {
  const classroom = buildClassroomWithScienceAndMath();
  const scienceExam = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });
  const linkedAssessment = createAssessment({ classroomId: 'c1', title: 'Quarterly Exam', type: 'Quarterly', scheduledEventId: scienceExam.id });

  const result = assessmentTimetableLinkService.getSurfaceableExamAssessments(classroom, [scienceExam], [linkedAssessment]);

  assert.equal(result.length, 1);
  assert.equal(result[0].linkedAssessment.id, linkedAssessment.id);
});

test('getSurfaceableExamAssessments: an event with no subjectId at all (a future non-subject event type) never surfaces', () => {
  const classroom = buildClassroomWithScienceAndMath();
  const assembly = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '09:00', endTime: '09:30', eventType: 'assembly', subjectId: null });
  assert.deepEqual(assessmentTimetableLinkService.getSurfaceableExamAssessments(classroom, [assembly], []), []);
});

test('getEventPeriodLabel: a two-period exam resolves "Period 1–2" from the effective schedule, never a second date/period calculation', () => {
  const classroom = buildClassroomWithScienceAndMath();
  const scienceExam = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });
  assert.equal(assessmentTimetableLinkService.getEventPeriodLabel(classroom, scienceExam), 'Period 1–2');
});

test('getEventPeriodLabel: a single-period exam resolves "Period 1"', () => {
  const classroom = buildClassroomWithScienceAndMath();
  const shortExam = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '09:00', endTime: '09:45', title: 'Quarterly Exam', subjectId: 'science' });
  assert.equal(assessmentTimetableLinkService.getEventPeriodLabel(classroom, shortExam), 'Period 1');
});

test('getEventPeriodLabel: reflects the CURRENT Timetable, not a stale copy — removing period 2 from the pattern changes the label without touching the event or any Assessment', () => {
  const classroom = buildClassroomWithScienceAndMath();
  const scienceExam = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });
  assert.equal(assessmentTimetableLinkService.getEventPeriodLabel(classroom, scienceExam), 'Period 1–2');

  // Simulate a Timetable edit (e.g. Manage Timetable removing period 2's slot) — nothing about the event itself changes.
  classroom.timetable.slots = classroom.timetable.slots.filter((slot) => slot.periodNumber !== 2);

  assert.equal(assessmentTimetableLinkService.getEventPeriodLabel(classroom, scienceExam), 'Period 1', 'must reflect the updated Timetable immediately');
});

test('getEventPeriodLabel: null when the exam does not overlap any real period (e.g. scheduled outside school hours)', () => {
  const classroom = buildClassroomWithScienceAndMath();
  const lateExam = createScheduledEvent({ classroomId: 'c1', date: EXAM_DATE, startTime: '18:00', endTime: '19:00', title: 'Evening Exam', subjectId: 'science' });
  assert.equal(assessmentTimetableLinkService.getEventPeriodLabel(classroom, lateExam), null);
});
