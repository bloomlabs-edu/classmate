import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createScheduledEvent } from '../../js/models/ScheduledEvent.js';
import { createAssessment } from '../../js/models/Assessment.js';
import { createAssessmentSubject } from '../../js/models/AssessmentSubject.js';
import * as assessmentService from '../../js/services/assessmentService.js';
import * as scorecardService from '../../js/services/scorecardService.js';
import { getEventsByType, SCHEDULED_EVENT_TYPES } from '../../js/services/scheduledEventService.js';

const CYCLE_TITLE = 'Quarterly Examinations';

function buildClassroomWithFourSubjects() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'G1' });
  classroom.learningRecord.subjects.push(
    { id: 'record-english', subjectId: 'english', title: 'English', units: [] },
    { id: 'record-maths', subjectId: 'mathematics', title: 'Mathematics', units: [] },
    { id: 'record-science', subjectId: 'science', title: 'Science', units: [] },
    { id: 'record-social', subjectId: 'social_science', title: 'Social Science', units: [] }
  );
  classroom.teams = [
    {
      id: 't1',
      name: 'Team 1',
      students: [
        { id: 'student-bhavani', name: 'Bhavani' },
        { id: 'student-blessy', name: 'Blessy' },
      ],
    },
  ];
  return classroom;
}

function buildQuarterlyEvents({ includePE = true } = {}) {
  const events = [
    createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', startTime: '09:00', endTime: '10:00', title: CYCLE_TITLE, subjectId: 'english' }),
    createScheduledEvent({ classroomId: 'c1', date: '2026-09-25', startTime: '09:00', endTime: '10:00', title: CYCLE_TITLE, subjectId: 'mathematics' }),
    createScheduledEvent({ classroomId: 'c1', date: '2026-09-26', startTime: '09:00', endTime: '10:00', title: CYCLE_TITLE, subjectId: 'science' }),
    createScheduledEvent({ classroomId: 'c1', date: '2026-09-27', startTime: '09:00', endTime: '10:00', title: CYCLE_TITLE, subjectId: 'social_science' }),
  ];
  if (includePE) {
    events.push(createScheduledEvent({ classroomId: 'c1', date: '2026-09-28', startTime: '09:00', endTime: '10:00', title: CYCLE_TITLE, subjectId: 'physical_education' }));
  }
  return events;
}

test('SUBJECT SCOPE: Scorecard cycle includes only subjects that are in Learning Activities', () => {
  const classroom = buildClassroomWithFourSubjects();
  const events = buildQuarterlyEvents();
  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);

  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, []);

  assert.equal(cycles.length, 1);
  const subjectTitles = cycles[0].items.map((item) => item.subjectTitle).sort();
  assert.deepEqual(subjectTitles, ['English', 'Mathematics', 'Science', 'Social Science']);
});

test('PHYSICAL EDUCATION ACCEPTANCE TEST: a PE exam in the same cycle never appears as a Scorecard subject, even though it shares the exact same cycle title', () => {
  const classroom = buildClassroomWithFourSubjects(); // PE is NOT in Learning Activities
  const events = buildQuarterlyEvents({ includePE: true });
  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);

  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, []);

  assert.equal(cycles.length, 1);
  assert.ok(
    !cycles[0].items.some((item) => item.learningSubject.subjectId === 'physical_education'),
    'Physical Education must never appear as a Scorecard column'
  );
  assert.equal(cycles[0].items.length, 4, 'exactly the 4 Learning Activities subjects, never the 5th (PE) timetable subject');
});

function buildFullScorecardFixture() {
  const classroom = buildClassroomWithFourSubjects();
  const events = buildQuarterlyEvents({ includePE: false });
  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);

  // English + Mathematics: linked Assessments, different maximumMarks (/50).
  // Science: linked Assessment, /100, one student not yet marked.
  // Social Science: NOT yet "set up" — no linked Assessment at all.
  const englishSubjectRecord = classroom.learningRecord.subjects.find((s) => s.subjectId === 'english');
  const mathsSubjectRecord = classroom.learningRecord.subjects.find((s) => s.subjectId === 'mathematics');
  const scienceSubjectRecord = classroom.learningRecord.subjects.find((s) => s.subjectId === 'science');

  const englishEvent = examEvents.find((e) => e.subjectId === 'english');
  const mathsEvent = examEvents.find((e) => e.subjectId === 'mathematics');
  const scienceEvent = examEvents.find((e) => e.subjectId === 'science');

  const englishAssessment = assessmentService.createAssessmentFromScheduledEvent(classroom, englishEvent, englishSubjectRecord);
  englishAssessment.assessmentSubjects[0].maximumMarks = 50;
  assessmentService.recordStudentMarks(englishAssessment.assessmentSubjects[0], 'student-bhavani', { marks: 42 });
  assessmentService.recordStudentMarks(englishAssessment.assessmentSubjects[0], 'student-blessy', { marks: 31 });

  const mathsAssessment = assessmentService.createAssessmentFromScheduledEvent(classroom, mathsEvent, mathsSubjectRecord);
  mathsAssessment.assessmentSubjects[0].maximumMarks = 50;
  assessmentService.recordStudentMarks(mathsAssessment.assessmentSubjects[0], 'student-bhavani', { marks: 38 });
  assessmentService.recordStudentMarks(mathsAssessment.assessmentSubjects[0], 'student-blessy', { marks: 28 });

  const scienceAssessment = assessmentService.createAssessmentFromScheduledEvent(classroom, scienceEvent, scienceSubjectRecord);
  scienceAssessment.assessmentSubjects[0].maximumMarks = 100;
  assessmentService.recordStudentMarks(scienceAssessment.assessmentSubjects[0], 'student-bhavani', { marks: 53.5 });
  // student-blessy: no Science mark recorded at all — must not be treated as 0.

  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, assessmentService.getAssessments(classroom));
  return { classroom, cycle: cycles[0] };
}

test('EACH STUDENT APPEARS ONCE, MARKS UNDER THE CORRECT SUBJECT, MAXIMUM MARKS RESPECTED', () => {
  const { classroom, cycle } = buildFullScorecardFixture();
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycle.items, cycle.title);

  assert.equal(scorecard.rows.length, 2, 'exactly one row per student, no duplicates');

  const bhavaniRow = scorecard.rows.find((r) => r.student.name === 'Bhavani');
  const subjectIndex = (title) => scorecard.subjects.findIndex((s) => s.subjectTitle === title);

  assert.deepEqual(
    { marks: bhavaniRow.cells[subjectIndex('English')].marks, max: bhavaniRow.cells[subjectIndex('English')].maximumMarks },
    { marks: 42, max: 50 }
  );
  assert.deepEqual(
    { marks: bhavaniRow.cells[subjectIndex('Mathematics')].marks, max: bhavaniRow.cells[subjectIndex('Mathematics')].maximumMarks },
    { marks: 38, max: 50 }
  );
  assert.deepEqual(
    { marks: bhavaniRow.cells[subjectIndex('Science')].marks, max: bhavaniRow.cells[subjectIndex('Science')].maximumMarks },
    { marks: 53.5, max: 100 }
  );
});

test('SOCIAL SCIENCE NOT YET SET UP: the subject still appears as a column, with no linked Assessment and no marks for anyone', () => {
  const { classroom, cycle } = buildFullScorecardFixture();
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycle.items, cycle.title);
  const socialScienceSubject = scorecard.subjects.find((s) => s.subjectTitle === 'Social Science');

  assert.equal(socialScienceSubject.linkedAssessment, null);
  assert.ok(
    socialScienceSubject.scheduledEvent,
    'Social Science DOES have a Timetable exam event in this cycle — ui/views/ScorecardView.js uses this to offer one-click "Set Up Assessment" instead of a plain inert "Not set up" note'
  );
  assert.equal(socialScienceSubject.scheduledEvent.subjectId, 'social_science');
  assert.equal(socialScienceSubject.learningSubject.title, 'Social Science');
  scorecard.rows.forEach((row) => {
    const cell = row.cells[scorecard.subjects.indexOf(socialScienceSubject)];
    assert.equal(cell.hasResult, false);
    assert.equal(cell.marks, null);
  });
});

test('MISSING MARKS ARE NOT TREATED AS ZERO: a student with no Science mark is excluded from that subject entirely, not scored as 0', () => {
  const { classroom, cycle } = buildFullScorecardFixture();
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycle.items, cycle.title);
  const blessyRow = scorecard.rows.find((r) => r.student.name === 'Blessy');
  const scienceCell = blessyRow.cells[scorecard.subjects.findIndex((s) => s.subjectTitle === 'Science')];

  assert.equal(scienceCell.hasResult, false);
  assert.equal(scienceCell.marks, null, 'a missing mark must render as blank, never a fabricated 0');
});

test('OVERALL AGGREGATION: total-obtained/total-maximum across only the subjects a student actually has marks for — never per-subject-percentage averaging, never treating a missing subject as 0', () => {
  const { classroom, cycle } = buildFullScorecardFixture();
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycle.items, cycle.title);

  const bhavaniRow = scorecard.rows.find((r) => r.student.name === 'Bhavani');
  // English 42/50 + Mathematics 38/50 + Science 53.5/100 = 133.5/200 = 66.75% -> rounded to 1 decimal place: 66.8%
  assert.equal(bhavaniRow.overallPercent, 66.8);
  assert.equal(bhavaniRow.subjectsAssessedCount, 3, 'Social Science (not set up) never counts toward assessed subjects');
  assert.equal(bhavaniRow.subjectsTotalCount, 4);

  const blessyRow = scorecard.rows.find((r) => r.student.name === 'Blessy');
  // English 31/50 + Mathematics 28/50 = 59/100 = 59% — Science is blank and must NOT be averaged in as 0/100.
  assert.equal(blessyRow.overallPercent, 59);
  assert.equal(blessyRow.subjectsAssessedCount, 2);
});

test('a student with no usable mark in any subject of the cycle has a null Overall percent, never a fabricated 0%', () => {
  const classroom = buildClassroomWithFourSubjects();
  classroom.teams[0].students.push({ id: 'student-new', name: 'NewStudent' });
  const { cycle } = (() => {
    const events = buildQuarterlyEvents({ includePE: false });
    const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);
    const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, []);
    return { cycle: cycles[0] };
  })();

  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycle.items, cycle.title);
  const newStudentRow = scorecard.rows.find((r) => r.student.name === 'NewStudent');
  assert.equal(newStudentRow.overallPercent, null);
  assert.equal(newStudentRow.subjectsAssessedCount, 0);
});

test('getSubjectAssessedCounts: reflects exactly how many students have a usable mark per subject, independent of the Overall calculation', () => {
  const { classroom, cycle } = buildFullScorecardFixture();
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycle.items, cycle.title);
  const counts = scorecardService.getSubjectAssessedCounts(classroom, scorecard.subjects);

  const byTitle = Object.fromEntries(counts.map((c) => [c.subjectTitle, c]));
  assert.deepEqual(byTitle['English'], { subjectTitle: 'English', assessedCount: 2, totalCount: 2 });
  assert.deepEqual(byTitle['Science'], { subjectTitle: 'Science', assessedCount: 1, totalCount: 2 });
  assert.deepEqual(byTitle['Social Science'], { subjectTitle: 'Social Science', assessedCount: 0, totalCount: 2 });
});

test('getOverallAssessedPercent: the header stat sums assessed/total across every subject column, using the same per-(student,subject) convention as the Gradebook\'s own "Marks Entered" line', () => {
  const { classroom, cycle } = buildFullScorecardFixture();
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycle.items, cycle.title);
  const counts = scorecardService.getSubjectAssessedCounts(classroom, scorecard.subjects);
  // English 2/2 + Mathematics 2/2 + Science 1/2 + Social Science 0/2 = 5/8 = 62.5% -> rounded to 63%
  assert.equal(scorecardService.getOverallAssessedPercent(counts), 63);
});

test('getOverallAssessedPercent: null (never a fabricated 0%) when there are no subjects/students to measure', () => {
  assert.equal(scorecardService.getOverallAssessedPercent([]), null);
});

test('LEARNING ACTIVITIES IS THE SUBJECT SOURCE: a Subject in Learning Activities with NO Timetable exam event in this cycle at all still appears as a column (Not set up)', () => {
  const classroom = buildClassroomWithFourSubjects();
  classroom.learningRecord.subjects.push({ id: 'record-cs', subjectId: 'computer_science', title: 'Computer Science', units: [] });

  // Only the original 4 subjects get a Timetable exam event — Computer Science has none at all.
  const events = buildQuarterlyEvents({ includePE: false });
  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);
  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, []);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].items.length, 4, 'the cycle picker list itself is still only Timetable-event-driven');

  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycles[0].items, cycles[0].title);

  assert.deepEqual(
    scorecard.subjects.map((s) => s.subjectTitle).sort(),
    ['Computer Science', 'English', 'Mathematics', 'Science', 'Social Science'],
    'every Learning Activities subject is a column, even one with no Timetable exam event at all'
  );
  const csSubject = scorecard.subjects.find((s) => s.subjectTitle === 'Computer Science');
  assert.equal(csSubject.linkedAssessment, null);
  assert.equal(
    csSubject.scheduledEvent,
    null,
    'no Timetable exam at all for this Subject in this cycle — ui/views/ScorecardView.js must fall back to the plain "Not set up" note, never offer one-click Timetable setup with nothing to link to'
  );
  scorecard.rows.forEach((row) => {
    const cell = row.cells[scorecard.subjects.indexOf(csSubject)];
    assert.equal(cell.hasResult, false);
    assert.equal(cell.marks, null);
  });
});

test('MANUALLY BUNDLED ASSESSMENT: a Learning Activities subject with no Timetable event resolves its marks from an Assessment sharing this cycle\'s own title', () => {
  const classroom = buildClassroomWithFourSubjects();
  const csRecord = { id: 'record-cs', subjectId: 'computer_science', title: 'Computer Science', units: [] };
  classroom.learningRecord.subjects.push(csRecord);

  const events = buildQuarterlyEvents({ includePE: false });
  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);

  // Manually created — never linked to any ScheduledEvent — but its title matches this cycle exactly,
  // the same way a teacher might bundle several Subjects into one hand-made Assessment.
  const bundledAssessment = createAssessment({
    classroomId: 'c1',
    title: CYCLE_TITLE,
    type: 'Custom',
    assessmentSubjects: [createAssessmentSubject({ subjectId: csRecord.id, maximumMarks: 50 })],
  });
  classroom.assessments.push(bundledAssessment);
  assessmentService.recordStudentMarks(bundledAssessment.assessmentSubjects[0], 'student-bhavani', { marks: 45 });

  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, assessmentService.getAssessments(classroom));
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycles[0].items, cycles[0].title);

  const csSubject = scorecard.subjects.find((s) => s.subjectTitle === 'Computer Science');
  assert.equal(csSubject.linkedAssessment.id, bundledAssessment.id);

  const bhavaniRow = scorecard.rows.find((r) => r.student.name === 'Bhavani');
  const csCell = bhavaniRow.cells[scorecard.subjects.indexOf(csSubject)];
  assert.deepEqual({ marks: csCell.marks, max: csCell.maximumMarks, hasResult: csCell.hasResult }, { marks: 45, max: 50, hasResult: true });

  const blessyRow = scorecard.rows.find((r) => r.student.name === 'Blessy');
  const blessyCsCell = blessyRow.cells[scorecard.subjects.indexOf(csSubject)];
  assert.equal(blessyCsCell.hasResult, false, 'a student with no entered mark in the bundled Assessment must show as missing, never 0');
});

test('A TIMETABLE-ONLY SUBJECT NOT IN LEARNING ACTIVITIES IS STILL EXCLUDED even when a same-titled manual Assessment exists for it', () => {
  const classroom = buildClassroomWithFourSubjects(); // PE is NOT in Learning Activities
  const events = buildQuarterlyEvents({ includePE: true });
  const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);

  const bundledPeAssessment = createAssessment({
    classroomId: 'c1',
    title: CYCLE_TITLE,
    type: 'Custom',
    assessmentSubjects: [createAssessmentSubject({ subjectId: 'physical_education', maximumMarks: 50 })],
  });
  classroom.assessments.push(bundledPeAssessment);

  const cycles = scorecardService.getEligibleExamCycles(classroom, examEvents, assessmentService.getAssessments(classroom));
  const scorecard = scorecardService.buildScorecardForCycle(classroom, cycles[0].items, cycles[0].title);

  assert.ok(
    !scorecard.subjects.some((s) => s.subjectTitle === 'PE' || s.subjectTitle === 'Physical Education'),
    'PE must never appear as a Scorecard column merely because a same-titled manual Assessment exists for it'
  );
});
