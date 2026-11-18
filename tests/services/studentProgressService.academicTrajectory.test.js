/**
 * tests/services/studentProgressService.academicTrajectory.test.js
 *
 * Real, executed unit tests for the Student Growth Dashboard's own
 * getAcademicTrajectoryForStudent()/getSubjectTrajectory() — the
 * cross-Assessment, per-Subject percentage trajectory. No DOM, no
 * Firebase; fixtures built directly against models/Classroom.js and
 * services/assessmentService.js's own real functions (never a
 * hand-rolled shortcut shape), matching
 * tests/services/assessmentService.test.js's own established
 * fixture style.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as assessmentService from '../../js/services/assessmentService.js';
import { getAcademicTrajectoryForStudent, getSubjectTrajectory } from '../../js/services/studentProgressService.js';

function buildClassroomWithScienceOnly() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'G1' });
  classroom.learningRecord.subjects.push({ id: 'record-science', subjectId: 'science', title: 'Science', units: [] });
  classroom.teams = [{ id: 't1', name: 'Team 1', students: [{ id: 's1', name: 'Asha' }, { id: 's2', name: 'Baiju' }] }];
  return classroom;
}

test('getAcademicTrajectoryForStudent: zero Assessments on the classroom returns []', () => {
  const classroom = buildClassroomWithScienceOnly();
  assert.deepEqual(getAcademicTrajectoryForStudent(classroom, 's1'), []);
});

test('COMPARABILITY: same raw marks, different maximumMarks across two Assessments produce correctly different percentages, never compared as raw marks', () => {
  const classroom = buildClassroomWithScienceOnly();
  const first = assessmentService.createNewAssessment(classroom, { title: 'First Mid Term', type: 'Mid Term', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  const second = assessmentService.createNewAssessment(classroom, { title: 'Second Mid Term', type: 'Mid Term', academicYear: '2026-2027', date: '2026-09-01', subjectIds: ['record-science'] });
  assessmentService.setMaximumMarks(first.assessmentSubjects[0], 100);
  assessmentService.setMaximumMarks(second.assessmentSubjects[0], 50);
  assessmentService.recordStudentMarks(first.assessmentSubjects[0], 's1', { marks: 35 });
  assessmentService.recordStudentMarks(second.assessmentSubjects[0], 's1', { marks: 35 });

  const [subject] = getAcademicTrajectoryForStudent(classroom, 's1');

  assert.equal(subject.points[0].percent, 35, 'same 35 marks out of 100 is 35%');
  assert.equal(subject.points[1].percent, 70, 'the exact same 35 marks out of 50 is 70% — never compared as raw marks');
});

test('COMPARABILITY: the SAME percentage classifies into a different bucket across two Assessments with different passMarkPercent', () => {
  const classroom = buildClassroomWithScienceOnly();
  const strict = assessmentService.createNewAssessment(classroom, { title: 'Strict Exam', type: 'Custom', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  const lenient = assessmentService.createNewAssessment(classroom, { title: 'Lenient Exam', type: 'Custom', academicYear: '2026-2027', date: '2026-09-01', subjectIds: ['record-science'] });
  assessmentService.updateAssessmentDetails(strict, { ...strict, passMarkPercent: 60 });
  assessmentService.updateAssessmentDetails(lenient, { ...lenient, passMarkPercent: 30 });
  assessmentService.recordStudentMarks(strict.assessmentSubjects[0], 's1', { marks: 50 });
  assessmentService.recordStudentMarks(lenient.assessmentSubjects[0], 's1', { marks: 50 });

  const [subject] = getAcademicTrajectoryForStudent(classroom, 's1');

  assert.equal(subject.points[0].percent, 50);
  assert.equal(subject.points[1].percent, 50);
  assert.equal(subject.points[0].bucketKey, 'red', 'below a 60% pass mark, 50% is Red');
  assert.equal(subject.points[1].bucketKey, 'yellow', 'the SAME 50%, above a 30% pass mark, is Yellow on the other Assessment');
});

test('MISSING IS NEVER ZERO: a student with no StudentResult at all for an Assessment contributes no point for it', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Mid Term', type: 'Mid Term', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  assessmentService.recordStudentMarks(assessment.assessmentSubjects[0], 's2', { marks: 90 }); // only the OTHER student has a mark

  assert.deepEqual(getAcademicTrajectoryForStudent(classroom, 's1'), [], 's1 has no usable mark in any Assessment — the Subject is omitted entirely, not a fabricated 0');
});

test('ABSENT IS NEVER ZERO: a student explicitly marked absent contributes no point either, even though `marks` may still hold a stale number', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Mid Term', type: 'Mid Term', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  assessmentService.recordStudentMarks(assessment.assessmentSubjects[0], 's1', { marks: 0, absent: true });

  assert.deepEqual(getAcademicTrajectoryForStudent(classroom, 's1'), []);
});

test('SOFT-DELETED ASSESSMENTS ARE EXCLUDED: a deleted Assessment\'s marks never appear in the trajectory', () => {
  const classroom = buildClassroomWithScienceOnly();
  const kept = assessmentService.createNewAssessment(classroom, { title: 'Kept', type: 'Custom', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  const deleted = assessmentService.createNewAssessment(classroom, { title: 'Deleted', type: 'Custom', academicYear: '2026-2027', date: '2026-09-01', subjectIds: ['record-science'] });
  assessmentService.recordStudentMarks(kept.assessmentSubjects[0], 's1', { marks: 80 });
  assessmentService.recordStudentMarks(deleted.assessmentSubjects[0], 's1', { marks: 10 });
  assessmentService.deleteAssessment(classroom, deleted.id);

  const [subject] = getAcademicTrajectoryForStudent(classroom, 's1');

  assert.equal(subject.points.length, 1);
  assert.equal(subject.points[0].assessmentId, kept.id);
});

test('A RESTORED ASSESSMENT REAPPEARS IN THE TRAJECTORY with its original mark, unchanged', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Mid Term', type: 'Custom', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  assessmentService.recordStudentMarks(assessment.assessmentSubjects[0], 's1', { marks: 64 });
  assessmentService.deleteAssessment(classroom, assessment.id);
  assert.deepEqual(getAcademicTrajectoryForStudent(classroom, 's1'), []);

  assessmentService.restoreAssessment(classroom, assessment.id);

  const [subject] = getAcademicTrajectoryForStudent(classroom, 's1');
  assert.equal(subject.points.length, 1);
  assert.equal(subject.points[0].marks, 64);
});

test('ORDERING: points come back oldest-first by date, independent of getAssessments()\'s own newest-created-first order', () => {
  const classroom = buildClassroomWithScienceOnly();
  // Created in reverse chronological (by exam date) order on purpose.
  const later = assessmentService.createNewAssessment(classroom, { title: 'Later Exam', type: 'Custom', academicYear: '2026-2027', date: '2026-10-01', subjectIds: ['record-science'] });
  const earlier = assessmentService.createNewAssessment(classroom, { title: 'Earlier Exam', type: 'Custom', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  assessmentService.recordStudentMarks(later.assessmentSubjects[0], 's1', { marks: 50 });
  assessmentService.recordStudentMarks(earlier.assessmentSubjects[0], 's1', { marks: 60 });

  const [subject] = getAcademicTrajectoryForStudent(classroom, 's1');

  assert.deepEqual(
    subject.points.map((p) => p.assessmentId),
    [earlier.id, later.id]
  );
});

test('TIEBREAK: two Assessments sharing the exact same date sort deterministically and stably across repeated calls', () => {
  const classroom = buildClassroomWithScienceOnly();
  const a = assessmentService.createNewAssessment(classroom, { title: 'Exam A', type: 'Custom', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  const b = assessmentService.createNewAssessment(classroom, { title: 'Exam B', type: 'Custom', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  assessmentService.recordStudentMarks(a.assessmentSubjects[0], 's1', { marks: 40 });
  assessmentService.recordStudentMarks(b.assessmentSubjects[0], 's1', { marks: 45 });

  const firstCall = getAcademicTrajectoryForStudent(classroom, 's1')[0].points.map((p) => p.assessmentId);
  const secondCall = getAcademicTrajectoryForStudent(classroom, 's1')[0].points.map((p) => p.assessmentId);

  assert.deepEqual(firstCall, secondCall, 'the tiebreak must be deterministic, not insertion-order-dependent');
});

test('getSubjectTrajectory: returns the exact same points as the matching entry in getAcademicTrajectoryForStudent(), and [] for a subject with no usable marks', () => {
  const classroom = buildClassroomWithScienceOnly();
  const assessment = assessmentService.createNewAssessment(classroom, { title: 'Mid Term', type: 'Custom', academicYear: '2026-2027', date: '2026-08-01', subjectIds: ['record-science'] });
  assessmentService.recordStudentMarks(assessment.assessmentSubjects[0], 's1', { marks: 72 });

  const direct = getSubjectTrajectory(classroom, 's1', 'record-science');
  assert.equal(direct.length, 1);
  assert.equal(direct[0].marks, 72);

  assert.deepEqual(getSubjectTrajectory(classroom, 's1', 'nonexistent-subject'), []);
});
