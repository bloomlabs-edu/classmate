/**
 * tests/services/scorecardClassroomIsolation.test.js
 *
 * Closes the one real gap found while auditing the existing Scorecard
 * implementation (services/scorecardService.js,
 * services/assessmentTimetableLinkService.js) against this feature's
 * own explicit requirement: classroom isolation must have regression
 * coverage, specifically because this project already had a real
 * Grade 8A -> Grade 6A timetable metadata leakage incident. Every
 * existing scorecardService/assessmentTimetableLinkService test built
 * exactly one classroom — none of them proved a second classroom's
 * data can't leak in.
 *
 * Also covers two other requirements the existing suite didn't yet
 * exercise: a manually-created, unlinked Assessment for a
 * non-Learning-Activities subject (e.g. PE) never leaking into the
 * normal Scorecard, and the exact 21-student fixture this feature's
 * own brief specifies.
 *
 * Structurally, isolation is already guaranteed by inspection —
 * every scorecardService function takes the actual `classroom` object
 * as a parameter and reads only `classroom.teams`/`classroom.assessments`/
 * `classroom.learningRecord` directly (see services/assessmentService.js's
 * own getClassroomStudents()/getAssessments()) — there is no shared or
 * global state anywhere in this path. These tests prove that
 * structural guarantee holds, and guard against a future change
 * accidentally introducing any.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createScheduledEvent } from '../../js/models/ScheduledEvent.js';
import { createAssessment } from '../../js/models/Assessment.js';
import * as assessmentService from '../../js/services/assessmentService.js';
import * as scorecardService from '../../js/services/scorecardService.js';
import { getEventsByType, SCHEDULED_EVENT_TYPES } from '../../js/services/scheduledEventService.js';

const SAME_TEACHER_UID = 'teacher-shared';
const SAME_TITLE = 'Quarterly Examinations';
const SAME_DATE = '2026-09-24';

function buildClassroomWithLearningActivities({ id, gradeSection, studentNames }) {
  const classroom = createClassroom({ id, schoolName: 'Test School', gradeSection });
  classroom.learningRecord.subjects.push(
    { id: `${id}-record-english`, subjectId: 'english', title: 'English', units: [] },
    { id: `${id}-record-maths`, subjectId: 'mathematics', title: 'Mathematics', units: [] },
    { id: `${id}-record-science`, subjectId: 'science', title: 'Science', units: [] },
    { id: `${id}-record-social`, subjectId: 'social_science', title: 'Social Science', units: [] }
  );
  classroom.teams = [
    {
      id: `${id}-team-1`,
      name: 'Team 1',
      students: studentNames.map((name, index) => ({ id: `${id}-student-${index}`, name })),
    },
  ];
  return classroom;
}

/**
 * Deliberately gives Grade 8A and Grade 6A the SAME teacher, SAME
 * exam title, and the SAME date — the exact "same on every axis
 * except classroomId" scenario this feature's own brief calls out by
 * name, matching how the real prior timetable leakage incident
 * actually looked.
 */
function buildTwoClassroomsSharingEverythingExceptClassroomId() {
  const grade6A = buildClassroomWithLearningActivities({ id: 'grade-6a', gradeSection: '6A', studentNames: ['Ananya M', 'Basariya M', 'Gokul SS'] });
  const grade8A = buildClassroomWithLearningActivities({ id: 'grade-8a', gradeSection: '8A', studentNames: ['Priya K', 'Rahul V'] });

  const events6A = [
    createScheduledEvent({ classroomId: 'grade-6a', date: SAME_DATE, startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'science', invigilatorUid: SAME_TEACHER_UID }),
  ];
  const events8A = [
    createScheduledEvent({ classroomId: 'grade-8a', date: SAME_DATE, startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'science', invigilatorUid: SAME_TEACHER_UID }),
  ];

  const scienceRecord6A = grade6A.learningRecord.subjects.find((s) => s.subjectId === 'science');
  const scienceRecord8A = grade8A.learningRecord.subjects.find((s) => s.subjectId === 'science');

  const assessment6A = assessmentService.createAssessmentFromScheduledEvent(grade6A, events6A[0], scienceRecord6A);
  assessment6A.assessmentSubjects[0].maximumMarks = 100;
  assessmentService.recordStudentMarks(assessment6A.assessmentSubjects[0], grade6A.teams[0].students[0].id, { marks: 90 });

  const assessment8A = assessmentService.createAssessmentFromScheduledEvent(grade8A, events8A[0], scienceRecord8A);
  assessment8A.assessmentSubjects[0].maximumMarks = 100;
  assessmentService.recordStudentMarks(assessment8A.assessmentSubjects[0], grade8A.teams[0].students[0].id, { marks: 12 });

  return { grade6A, grade8A, events6A, events8A };
}

test('CLASSROOM ISOLATION: identical teacher + identical exam title + identical date on two different classrooms never mix students, marks, or cycles', () => {
  const { grade6A, grade8A, events6A, events8A } = buildTwoClassroomsSharingEverythingExceptClassroomId();

  const examEvents6A = getEventsByType(events6A, SCHEDULED_EVENT_TYPES.EXAM);
  const examEvents8A = getEventsByType(events8A, SCHEDULED_EVENT_TYPES.EXAM);

  const cycles6A = scorecardService.getEligibleExamCycles(grade6A, examEvents6A, assessmentService.getAssessments(grade6A));
  const cycles8A = scorecardService.getEligibleExamCycles(grade8A, examEvents8A, assessmentService.getAssessments(grade8A));

  const scorecard6A = scorecardService.buildScorecardForCycle(grade6A, cycles6A[0].items);
  const scorecard8A = scorecardService.buildScorecardForCycle(grade8A, cycles8A[0].items);

  // Grade 6A's Scorecard contains ONLY Grade 6A's own 3 students — never Grade 8A's 2.
  assert.equal(scorecard6A.rows.length, 3);
  assert.deepEqual(scorecard6A.rows.map((r) => r.student.name).sort(), ['Ananya M', 'Basariya M', 'Gokul SS']);
  assert.ok(!scorecard6A.rows.some((r) => r.student.name === 'Priya K' || r.student.name === 'Rahul V'), 'Grade 8A students must never appear in Grade 6A\'s Scorecard');

  // Grade 8A's Scorecard contains ONLY Grade 8A's own 2 students.
  assert.equal(scorecard8A.rows.length, 2);
  assert.deepEqual(scorecard8A.rows.map((r) => r.student.name).sort(), ['Priya K', 'Rahul V']);

  // The marks themselves never cross over, even though both used the identical subject/title/date/teacher.
  const grade6AScience = scorecard6A.rows.find((r) => r.student.name === 'Ananya M').cells[0];
  const grade8AScience = scorecard8A.rows.find((r) => r.student.name === 'Priya K').cells[0];
  assert.equal(grade6AScience.marks, 90);
  assert.equal(grade8AScience.marks, 12);
});

test('CLASSROOM ISOLATION: an Assessment record belonging to classroom A is never picked up as the "linked Assessment" for the same-titled event in classroom B', () => {
  const { grade6A, grade8A, events6A } = buildTwoClassroomsSharingEverythingExceptClassroomId();
  const examEvents6A = getEventsByType(events6A, SCHEDULED_EVENT_TYPES.EXAM);

  // Sanity: grade8A's own assessments array must not contain grade6A's assessment, and vice versa.
  const grade6AAssessmentIds = assessmentService.getAssessments(grade6A).map((a) => a.id);
  const grade8AAssessmentIds = assessmentService.getAssessments(grade8A).map((a) => a.id);
  assert.equal(grade6AAssessmentIds.some((id) => grade8AAssessmentIds.includes(id)), false);

  // Attempting to resolve grade6A's own event against grade8A's assessment list must find nothing linked.
  const cyclesUsingWrongAssessments = scorecardService.getEligibleExamCycles(grade6A, examEvents6A, assessmentService.getAssessments(grade8A));
  const scienceItem = cyclesUsingWrongAssessments[0].items.find((item) => item.learningSubject.subjectId === 'science');
  assert.equal(scienceItem.linkedAssessment, null, 'a same-titled event must never resolve to another classroom\'s own Assessment record');
});

test('MANUAL ASSESSMENT NON-LEAKAGE: a manually-created, unlinked Assessment for a non-Learning-Activities subject (e.g. PE) never appears in the normal Scorecard', () => {
  const classroom = buildClassroomWithLearningActivities({ id: 'grade-6a', gradeSection: '6A', studentNames: ['Ananya M', 'Basariya M'] });
  const events = [
    createScheduledEvent({ classroomId: 'grade-6a', date: SAME_DATE, startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'science' }),
  ];

  // A manually created PE Assessment, NOT linked to any ScheduledEvent (scheduledEventId omitted) — exactly
  // how "PE can still be manually created as an Assessment" works today (see models/Assessment.js).
  const manualPeAssessment = createAssessment({ classroomId: 'grade-6a', title: 'PE Fitness Test', type: 'Manual' });
  classroom.assessments.push(manualPeAssessment);

  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);
  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, assessmentService.getAssessments(classroom));

  assert.equal(cycles.length, 1);
  assert.ok(
    !cycles[0].items.some((item) => item.subjectTitle === 'PE' || item.subjectTitle === 'Physical Education'),
    'a manually created, unlinked PE Assessment must never surface as a Scorecard subject column'
  );
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycles[0].items);
  assert.ok(
    !scorecard.subjects.some((s) => s.subjectTitle.toLowerCase().includes('pe') || s.subjectTitle === 'Physical Education'),
    'PE must not appear as a Scorecard column merely because a manual Assessment exists for it'
  );
});

test("NO MUTATION: building a Scorecard never writes to the classroom object it reads (viewing must never mutate Firestore-bound data)", () => {
  const classroom = buildClassroomWithLearningActivities({ id: 'grade-6a', gradeSection: '6A', studentNames: ['Ananya M', 'Basariya M'] });
  const events = [
    createScheduledEvent({ classroomId: 'grade-6a', date: SAME_DATE, startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'science' }),
  ];
  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);
  const before = JSON.stringify(classroom);

  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, assessmentService.getAssessments(classroom));
  scorecardService.buildScorecardForCycle(classroom, cycles[0].items);
  scorecardService.getSubjectAssessedCounts(classroom, cycles[0].items.map((item) => ({ subjectTitle: item.subjectTitle, linkedAssessment: null })));

  assert.equal(JSON.stringify(classroom), before, 'reading the Scorecard must never change the classroom object');
});

test('FULL FIXTURE (21 students, Grade 6A): normal Scorecard columns are exactly Student/English/Mathematics/Science/Social Science/Overall — PE never appears', () => {
  const classroom = buildClassroomWithLearningActivities({
    id: 'grade-6a',
    gradeSection: '6A',
    studentNames: Array.from({ length: 21 }, (_, i) => `Student ${i + 1}`),
  });

  // Timetable also contains Physical Education (not in Learning Activities) — represented here as a
  // 5th exam event for the same cycle, exactly like the real Timetable would produce.
  const events = [
    createScheduledEvent({ classroomId: 'grade-6a', date: '2026-09-17', startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'english' }),
    createScheduledEvent({ classroomId: 'grade-6a', date: '2026-09-21', startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'mathematics' }),
    createScheduledEvent({ classroomId: 'grade-6a', date: '2026-09-24', startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'science' }),
    createScheduledEvent({ classroomId: 'grade-6a', date: '2026-09-23', startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'social_science' }),
    createScheduledEvent({ classroomId: 'grade-6a', date: '2026-09-25', startTime: '09:00', endTime: '10:00', title: SAME_TITLE, subjectId: 'physical_education' }),
  ];
  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);

  // English/Mathematics/Science/Social Science get real Assessments (linked via ScheduledEvent);
  // PE gets its own manually-created, UNLINKED Assessment — exactly the fixture this feature's brief specifies.
  ['english', 'mathematics', 'science', 'social_science'].forEach((subjectId) => {
    const record = classroom.learningRecord.subjects.find((s) => s.subjectId === subjectId);
    const event = examEvents.find((e) => e.subjectId === subjectId);
    const assessment = assessmentService.createAssessmentFromScheduledEvent(classroom, event, record);
    // Only 14 of the 21 students get a Science mark — the rest must show "-", never 0.
    const studentsToMark = subjectId === 'science' ? classroom.teams[0].students.slice(0, 14) : classroom.teams[0].students;
    studentsToMark.forEach((student, i) => {
      assessmentService.recordStudentMarks(assessment.assessmentSubjects[0], student.id, { marks: 20 + (i % 10) });
    });
  });
  classroom.assessments.push(createAssessment({ classroomId: 'grade-6a', title: 'PE — manually created', type: 'Manual' }));

  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, assessmentService.getAssessments(classroom));
  assert.equal(cycles.length, 1);

  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycles[0].items);

  assert.equal(scorecard.rows.length, 21, 'every classroom student gets exactly one row, regardless of who has marks');
  assert.deepEqual(
    scorecard.subjects.map((s) => s.subjectTitle).sort(),
    ['English', 'Mathematics', 'Science', 'Social Science'],
    'PE must never appear as a Scorecard column'
  );

  const scienceIndex = scorecard.subjects.findIndex((s) => s.subjectTitle === 'Science');
  const withScienceMark = scorecard.rows.filter((r) => r.cells[scienceIndex].hasResult).length;
  const withoutScienceMark = scorecard.rows.filter((r) => !r.cells[scienceIndex].hasResult).length;
  assert.equal(withScienceMark, 14);
  assert.equal(withoutScienceMark, 7, 'the remaining 7 students must show as missing, never a fabricated 0');
  scorecard.rows.filter((r) => !r.cells[scienceIndex].hasResult).forEach((r) => {
    assert.equal(r.cells[scienceIndex].marks, null);
  });
});
