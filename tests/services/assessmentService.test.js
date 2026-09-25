import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createScheduledEvent } from '../../js/models/ScheduledEvent.js';
import * as assessmentService from '../../js/services/assessmentService.js';
import { PASS_MARK_PERCENT, getPassMarkForSubject } from '../../js/config/assessmentMarksColorConfig.js';

function buildClassroomWithScienceOnly() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'G1' });
  classroom.learningRecord.subjects.push({ id: 'record-science', subjectId: 'science', title: 'Science', units: [] });
  classroom.teams = [{ id: 't1', name: 'Team 1', students: [{ id: 's1', name: 'Asha' }] }];
  return classroom;
}

test('getSubjectTitle: resolves an EXISTING manually-created Assessment\'s subjectId (a Learning Record Subject record id) — "1st Mid Term" regression', () => {
  const classroom = buildClassroomWithScienceOnly();
  // Mirrors createNewAssessment()'s own shape for a pre-existing, manually created Assessment.
  const assessment = assessmentService.createNewAssessment(classroom, {
    title: '1st Mid Term',
    type: 'Mid Term',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['record-science'],
  });

  assert.equal(assessmentService.getSubjectTitle(classroom, assessment.assessmentSubjects[0].subjectId), 'Science');
});

test('getSubjectTitle: resolves a canonical subjectId (not a Learning Record record id) via the canonical-registry fallback — the manual "not yet in Learning Activities" case', () => {
  const classroom = buildClassroomWithScienceOnly(); // Physical Education is NOT in Learning Record here
  assert.equal(assessmentService.getSubjectTitle(classroom, 'physical_education'), 'Physical Education');
});

test('MANUAL CREATION ACCEPTANCE TEST: a teacher can manually create a Physical Education Assessment even though PE is not in Learning Activities', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, {
    title: 'PE Fitness Test',
    type: 'Custom',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['physical_education'],
  });

  assert.ok(classroom.assessments.includes(assessment));
  assert.equal(assessment.assessmentSubjects[0].subjectId, 'physical_education');
  assert.equal(assessmentService.getSubjectTitle(classroom, 'physical_education'), 'Physical Education');
});

test('MANUAL CREATION MUST NOT SILENTLY MODIFY LEARNING ACTIVITIES: creating the PE Assessment above never adds PE to classroom.learningRecord.subjects', () => {
  const classroom = buildClassroomWithScienceOnly();
  const subjectsBefore = classroom.learningRecord.subjects.length;

  assessmentService.createNewAssessment(classroom, {
    title: 'PE Fitness Test',
    type: 'Custom',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['physical_education'],
  });

  assert.equal(classroom.learningRecord.subjects.length, subjectsBefore, 'Learning Record must be untouched');
  assert.ok(
    !classroom.learningRecord.subjects.some((s) => s.subjectId === 'physical_education'),
    'Physical Education must not have been silently added to Learning Activities'
  );
});

test('createAssessmentFromScheduledEvent: creates a linked Assessment referencing the ScheduledEvent, using the matched LearningSubject\'s own record id', () => {
  const classroom = buildClassroomWithScienceOnly();
  const learningSubject = classroom.learningRecord.subjects[0]; // { id: 'record-science', subjectId: 'science', ... }
  const event = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });

  const assessment = assessmentService.createAssessmentFromScheduledEvent(classroom, event, learningSubject);

  assert.equal(assessment.scheduledEventId, event.id);
  assert.equal(assessment.assessmentSubjects.length, 1);
  assert.equal(assessment.assessmentSubjects[0].subjectId, 'record-science');
  assert.equal(assessment.type, 'Quarterly');
  assert.ok(classroom.assessments.includes(assessment));
});

test('createAssessmentFromScheduledEvent: the Assessment\'s own date is the subject exam\'s actual start date, never the examination window\'s endDate — the window is metadata, not an override', () => {
  const classroom = buildClassroomWithScienceOnly();
  const learningSubject = classroom.learningRecord.subjects[0];
  // A ScheduledEvent that happens to carry a wider endDate (e.g. it
  // shares a title with a no-subject window placeholder spanning
  // 24–30 Sep) — Science itself still actually happened on the 24th.
  const event = createScheduledEvent({
    classroomId: 'c1',
    date: '2026-09-24',
    endDate: '2026-09-30',
    startTime: '09:00',
    endTime: '10:30',
    title: 'Quarterly Examinations',
    subjectId: 'science',
  });

  const assessment = assessmentService.createAssessmentFromScheduledEvent(classroom, event, learningSubject);

  assert.equal(assessment.date, '2026-09-24');
  assert.notEqual(assessment.date, '2026-09-30');
});

test('SCHEDULED EVENT IS THE LINK IDENTITY: two different ScheduledEvents sharing the exact same title produce two SEPARATE, independent Assessments', () => {
  const classroom = buildClassroomWithScienceOnly();
  const learningSubject = classroom.learningRecord.subjects[0];
  const eventA = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });
  const eventB = createScheduledEvent({ classroomId: 'c1', date: '2026-12-10', startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });

  const assessmentA = assessmentService.createAssessmentFromScheduledEvent(classroom, eventA, learningSubject);
  const assessmentB = assessmentService.createAssessmentFromScheduledEvent(classroom, eventB, learningSubject);

  assert.notEqual(assessmentA.id, assessmentB.id, 'identical titles must never be conflated into one Assessment');
  assert.equal(assessmentA.scheduledEventId, eventA.id);
  assert.equal(assessmentB.scheduledEventId, eventB.id);
  assert.equal(classroom.assessments.length, 2);
  // Re-calling with eventA's own id again must still resolve back to assessmentA specifically, not assessmentB.
  assert.equal(assessmentService.getLinkedAssessment(classroom, eventA.id).id, assessmentA.id);
  assert.equal(assessmentService.getLinkedAssessment(classroom, eventB.id).id, assessmentB.id);
});

test('MANUAL CREATION DOES NOT TRIGGER AUTOMATIC SURFACING: after manually creating a PE Assessment, PE still does not become eligible for automatic Timetable surfacing', () => {
  const classroom = buildClassroomWithScienceOnly(); // PE still not in Learning Record after this
  assessmentService.createNewAssessment(classroom, {
    title: 'PE Fitness Test',
    type: 'Custom',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['physical_education'],
  });

  assert.ok(
    !classroom.learningRecord.subjects.some((s) => s.subjectId === 'physical_education'),
    'the manual Assessment must not have added PE to Learning Record — automatic surfacing is gated on Learning Record membership alone'
  );
});

test('ASSESSMENT TYPE INFERENCE: word-boundary matching never lets one ASSESSMENT_TYPES entry falsely match inside another word', () => {
  const classroom = buildClassroomWithScienceOnly();
  const learningSubject = classroom.learningRecord.subjects[0];
  const event = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', startTime: '09:00', endTime: '10:30', title: 'Half Yearly Examination', subjectId: 'science' });

  const assessment = assessmentService.createAssessmentFromScheduledEvent(classroom, event, learningSubject);

  assert.equal(assessment.type, 'Half Yearly');
});

test('NO DUPLICATES: calling createAssessmentFromScheduledEvent twice for the same event returns the SAME Assessment, never creating a second one', () => {
  const classroom = buildClassroomWithScienceOnly();
  const learningSubject = classroom.learningRecord.subjects[0];
  const event = createScheduledEvent({ classroomId: 'c1', date: '2026-09-24', startTime: '09:00', endTime: '10:30', title: 'Quarterly Exam', subjectId: 'science' });

  const first = assessmentService.createAssessmentFromScheduledEvent(classroom, event, learningSubject);
  const second = assessmentService.createAssessmentFromScheduledEvent(classroom, event, learningSubject);

  assert.equal(first.id, second.id);
  assert.equal(classroom.assessments.filter((a) => a.scheduledEventId === event.id).length, 1);
});

test('EXISTING STUDENT MARKS/RESULTS FUNCTIONALITY REMAINS INTACT: recordStudentMarks + getStudentResult + computeRankings still work on a manually created Assessment', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, {
    title: '1st Mid Term',
    type: 'Mid Term',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['record-science'],
  });
  const [assessmentSubject] = assessment.assessmentSubjects;
  const students = assessmentService.getClassroomStudents(classroom);

  assessmentService.recordStudentMarks(assessmentSubject, students[0].id, { marks: 45 });
  const result = assessmentService.getStudentResult(assessmentSubject, students[0].id);
  assert.equal(result.marks, 45);

  const rankings = assessmentService.computeRankings(assessmentSubject, students);
  assert.equal(rankings.get(students[0].id), 1);
});

// ---------------------------------------------------------------------
// Editable Pass Mark
// ---------------------------------------------------------------------

test('EXISTING DEFAULT BEHAVIOUR: an assessment with no explicitly stored passMarkPercent resolves to the system-wide PASS_MARK_PERCENT default', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, {
    title: '1st Mid Term',
    type: 'Mid Term',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['record-science'],
  });

  assert.equal(assessment.passMarkPercent, null, 'a newly created assessment has no explicit override yet');
  assert.equal(assessmentService.getPassMarkPercent(assessment), PASS_MARK_PERCENT);
});

test('VALID CHANGE + PERSISTENCE: updateAssessmentDetails changes and persists the Pass Mark on the Assessment record itself, not just local UI state', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, {
    title: '1st Mid Term',
    type: 'Mid Term',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['record-science'],
  });

  assessmentService.updateAssessmentDetails(assessment, {
    title: assessment.title,
    type: assessment.type,
    academicYear: assessment.academicYear,
    date: assessment.date,
    passMarkPercent: 40,
  });

  assert.equal(assessment.passMarkPercent, 40);
  assert.equal(assessmentService.getPassMarkPercent(assessment), 40);

  // "Reload" simulation: getAssessmentById re-reads the same stored
  // object from classroom.assessments — exactly what a real page
  // refresh's own re-fetch-then-render would do — never a copy held
  // only in the view's own draft state.
  const reloaded = assessmentService.getAssessmentById(classroom, assessment.id);
  assert.equal(reloaded.passMarkPercent, 40);
});

test('CHANGING PASS MARK DOES NOT TOUCH STUDENT MARKS, MAXIMUM MARKS, OR SUBJECTS: updateAssessmentDetails only ever changes its own named top-level fields', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, {
    title: '1st Mid Term',
    type: 'Mid Term',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['record-science'],
  });
  const [assessmentSubject] = assessment.assessmentSubjects;
  assessmentService.recordStudentMarks(assessmentSubject, 's1', { marks: 35 });
  const maximumMarksBefore = assessmentSubject.maximumMarks;
  const subjectsBefore = JSON.stringify(assessment.assessmentSubjects);

  assessmentService.updateAssessmentDetails(assessment, {
    title: assessment.title,
    type: assessment.type,
    academicYear: assessment.academicYear,
    date: assessment.date,
    passMarkPercent: 40,
  });

  assert.equal(assessmentSubject.maximumMarks, maximumMarksBefore, 'maximum marks must be untouched');
  assert.equal(JSON.stringify(assessment.assessmentSubjects), subjectsBefore, 'no subject or student result may change');
  assert.equal(assessmentService.getStudentResult(assessmentSubject, 's1').marks, 35, "the student's recorded mark must remain exactly what it was");
});

test('DEPENDENT CALCULATION UPDATE: raising the Pass Mark from 36% to 40% moves the absolute threshold, correctly flipping a borderline mark\'s pass/fail classification', () => {
  const maximumMarks = 50;
  const borderlineMark = 19; // 19/50 = 38% — passes at 36%, fails at 40%

  const thresholdAt36 = getPassMarkForSubject(maximumMarks, 36);
  const thresholdAt40 = getPassMarkForSubject(maximumMarks, 40);

  assert.equal(thresholdAt36, 18);
  assert.equal(thresholdAt40, 20);
  assert.ok(borderlineMark >= thresholdAt36, 'passes under the original 36% Pass Mark');
  assert.ok(borderlineMark < thresholdAt40, 'the SAME mark now fails once the Pass Mark is raised to 40% — the mark itself never changed');
});

test('INVALID INPUT REJECTION: parsePassMarkPercentInput rejects non-numeric, negative, and over-100 values; accepts a blank value as "use the default"', () => {
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('abc'), { valid: false, value: null });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('-5'), { valid: false, value: null });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('101'), { valid: false, value: null });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('150'), { valid: false, value: null });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput(''), { valid: true, value: null });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('   '), { valid: true, value: null });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('40'), { valid: true, value: 40 });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('40.5'), { valid: true, value: 40.5 });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('0'), { valid: true, value: 0 });
  assert.deepEqual(assessmentService.parsePassMarkPercentInput('100'), { valid: true, value: 100 });
});

test('a blank Pass Mark input, once saved, explicitly reverts an assessment back to the system default (stores null, not the resolved number)', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, {
    title: '1st Mid Term',
    type: 'Mid Term',
    academicYear: '2026-2027',
    date: '2026-10-01',
    subjectIds: ['record-science'],
  });
  assessmentService.updateAssessmentDetails(assessment, { title: assessment.title, type: assessment.type, academicYear: assessment.academicYear, date: assessment.date, passMarkPercent: 40 });
  assert.equal(assessment.passMarkPercent, 40);

  const parsed = assessmentService.parsePassMarkPercentInput('');
  assessmentService.updateAssessmentDetails(assessment, { title: assessment.title, type: assessment.type, academicYear: assessment.academicYear, date: assessment.date, passMarkPercent: parsed.value });

  assert.equal(assessment.passMarkPercent, null);
  assert.equal(assessmentService.getPassMarkPercent(assessment), PASS_MARK_PERCENT);
});

// ---------------------------------------------------------------------
// Passed / Failed / Not Assessed summary
// ---------------------------------------------------------------------

function buildClassroomForOutcomes() {
  const classroom = buildClassroomWithScienceOnly(); // students s1 (Asha) already on the roster
  classroom.teams[0].students.push({ id: 's2', name: 'Bilal' }, { id: 's3', name: 'Chitra' }, { id: 's4', name: 'Deepa' });
  return classroom;
}

test('PASS/FAIL RULES: passing, failing, and not-assessed marks are classified per the task\'s own worked examples (Pass Mark 36%, /100)', () => {
  const classroom = buildClassroomForOutcomes();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Quarterly', type: 'Quarterly', academicYear: '2026-2027', date: '2026-09-24', subjectIds: ['record-science'] });
  const [subject] = assessment.assessmentSubjects;
  subject.maximumMarks = 100;

  assessmentService.recordStudentMarks(subject, 's1', { marks: 53.5 }); // pass
  assessmentService.recordStudentMarks(subject, 's2', { marks: 29.5 }); // fail
  assessmentService.recordStudentMarks(subject, 's3', { marks: 15 }); // fail
  // s4: no marks recorded at all — blank

  assert.equal(assessmentService.getStudentOutcome(assessment, 's1'), 'passed');
  assert.equal(assessmentService.getStudentOutcome(assessment, 's2'), 'failed');
  assert.equal(assessmentService.getStudentOutcome(assessment, 's3'), 'failed');
  assert.equal(assessmentService.getStudentOutcome(assessment, 's4'), 'not_assessed', 'a student with no recorded mark must be Not Assessed, never Failed');
});

test('BLANK IS NOT ZERO / NOT FAILED: a student explicitly marked absent is Not Assessed, not Failed', () => {
  const classroom = buildClassroomForOutcomes();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Quarterly', type: 'Quarterly', academicYear: '2026-2027', date: '2026-09-24', subjectIds: ['record-science'] });
  const [subject] = assessment.assessmentSubjects;
  assessmentService.recordStudentMarks(subject, 's1', { absent: true });

  assert.equal(assessmentService.getStudentOutcome(assessment, 's1'), 'not_assessed');
});

test('CORRECT PASSED/FAILED/NOT-ASSESSED COUNTS: summarizeAssessmentOutcomes tallies every student into exactly one bucket', () => {
  const classroom = buildClassroomForOutcomes();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Quarterly', type: 'Quarterly', academicYear: '2026-2027', date: '2026-09-24', subjectIds: ['record-science'] });
  const [subject] = assessment.assessmentSubjects;
  subject.maximumMarks = 100;
  assessmentService.recordStudentMarks(subject, 's1', { marks: 63 }); // pass
  assessmentService.recordStudentMarks(subject, 's2', { marks: 20 }); // fail
  // s3, s4: not assessed

  const students = assessmentService.getClassroomStudents(classroom);
  const counts = assessmentService.summarizeAssessmentOutcomes(assessment, students);

  assert.deepEqual(counts, { passed: 1, failed: 1, notAssessed: 2 });
});

test('PASS MARK INTEGRATION: outcome classification uses THIS Assessment\'s own passMarkPercent, not the raw global constant directly', () => {
  const classroom = buildClassroomForOutcomes();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Quarterly', type: 'Quarterly', academicYear: '2026-2027', date: '2026-09-24', subjectIds: ['record-science'] });
  const [subject] = assessment.assessmentSubjects;
  subject.maximumMarks = 50;
  assessmentService.recordStudentMarks(subject, 's1', { marks: 19 }); // 38% — passes at the 36% default

  assert.equal(assessmentService.getStudentOutcome(assessment, 's1'), 'passed');

  assessmentService.updateAssessmentDetails(assessment, {
    title: assessment.title,
    type: assessment.type,
    academicYear: assessment.academicYear,
    date: assessment.date,
    passMarkPercent: 40,
  });

  assert.equal(assessmentService.getStudentOutcome(assessment, 's1'), 'failed', 'the SAME 19/50 mark now fails once the Assessment\'s own Pass Mark is raised to 40%');
});

test('CHANGING PASS MARK CHANGES THE APPROPRIATE COUNT: raising the Pass Mark moves a borderline student from the Passed count into the Failed count', () => {
  const classroom = buildClassroomForOutcomes();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Quarterly', type: 'Quarterly', academicYear: '2026-2027', date: '2026-09-24', subjectIds: ['record-science'] });
  const [subject] = assessment.assessmentSubjects;
  subject.maximumMarks = 50;
  assessmentService.recordStudentMarks(subject, 's1', { marks: 19 });
  const students = assessmentService.getClassroomStudents(classroom);

  const countsBefore = assessmentService.summarizeAssessmentOutcomes(assessment, students);
  assert.equal(countsBefore.passed, 1);
  assert.equal(countsBefore.failed, 0);

  assessmentService.updateAssessmentDetails(assessment, { title: assessment.title, type: assessment.type, academicYear: assessment.academicYear, date: assessment.date, passMarkPercent: 40 });
  const countsAfter = assessmentService.summarizeAssessmentOutcomes(assessment, students);
  assert.equal(countsAfter.passed, 0);
  assert.equal(countsAfter.failed, 1);
});

// ---------------------------------------------------------------------
// Pass/Fail boundary regression (Pass Mark vs bucket colour root-cause fix)
// ---------------------------------------------------------------------

function outcomeFor(marks, maximumMarks, passMarkPercent) {
  const classroom = buildClassroomForOutcomes();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Quarterly', type: 'Quarterly', academicYear: '2026-2027', date: '2026-09-24', subjectIds: ['record-science'] });
  const [subject] = assessment.assessmentSubjects;
  subject.maximumMarks = maximumMarks;
  assessmentService.recordStudentMarks(subject, 's1', { marks });
  assessmentService.updateAssessmentDetails(assessment, { title: assessment.title, type: assessment.type, academicYear: assessment.academicYear, date: assessment.date, passMarkPercent });
  return assessmentService.getStudentOutcome(assessment, 's1');
}

test('THE CRITICAL LIVE REGRESSION: Pass Mark 35%, Kavisri 35/100 -> PASS (never Fail)', () => {
  assert.equal(outcomeFor(35, 100, 35), 'passed');
});

test('Pass/Fail boundary at Pass Mark = 35%', () => {
  assert.equal(outcomeFor(34.99, 100, 35), 'failed');
  assert.equal(outcomeFor(35, 100, 35), 'passed');
  assert.equal(outcomeFor(35.01, 100, 35), 'passed');
  assert.equal(outcomeFor(69.99, 100, 35), 'passed');
  assert.equal(outcomeFor(70, 100, 35), 'passed');
});

test('Pass/Fail is a direct score-vs-passMark comparison, never derived from bucket colour', () => {
  // A Yellow score (35-69.99%) and a Green score (70%+) must both be
  // "Passed" — Pass/Fail has exactly one threshold (the Pass Mark),
  // never a second implicit one at the Green boundary.
  assert.equal(outcomeFor(50, 100, 35), 'passed');
  assert.equal(outcomeFor(80, 100, 35), 'passed');
});
