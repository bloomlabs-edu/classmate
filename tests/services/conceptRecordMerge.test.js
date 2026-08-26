import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createTeam } from '../../js/models/Team.js';
import { createStudent } from '../../js/models/Student.js';
import { mergeConceptRecordsIntoClassroom } from '../../js/services/conceptRecordMerge.js';
import { getStudentConceptRecord } from '../../js/services/learningRecordService.js';

function classroomWithStudent(studentOverrides = {}) {
  const student = createStudent({ id: 'student-1', name: 'A', ...studentOverrides });
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  classroom.teams = [createTeam({ name: 'Alpha', students: [student] })];
  return { classroom, student };
}

test('mergeConceptRecordsIntoClassroom: overlays a fetched record onto the matching student', () => {
  const { classroom, student } = classroomWithStudent();
  mergeConceptRecordsIntoClassroom(classroom, [
    { studentId: 'student-1', conceptId: 'concept-1', understanding: 'confident', notebook: 'not_required', helpRequested: false, updatedAt: '2026-01-01' },
  ]);

  const record = getStudentConceptRecord(student, 'concept-1');
  assert.equal(record.understanding, 'confident');
  assert.equal(record.updatedAt, '2026-01-01');
});

test('mergeConceptRecordsIntoClassroom: new-collection data overrides legacy embedded data for the same concept', () => {
  const { classroom, student } = classroomWithStudent({
    learningRecord: { 'concept-1': { understanding: 'need_help', notebook: 'not_required', helpRequested: false, updatedAt: '2025-01-01' } },
  });

  mergeConceptRecordsIntoClassroom(classroom, [
    { studentId: 'student-1', conceptId: 'concept-1', understanding: 'can_teach', notebook: 'not_required', helpRequested: false, updatedAt: '2026-01-01' },
  ]);

  assert.equal(getStudentConceptRecord(student, 'concept-1').understanding, 'can_teach');
});

test('mergeConceptRecordsIntoClassroom: a concept with no fetched record at all falls back to legacy embedded data untouched', () => {
  const { classroom, student } = classroomWithStudent({
    learningRecord: { 'concept-legacy-only': { understanding: 'understand', notebook: 'not_required', helpRequested: false, updatedAt: '2025-06-01' } },
  });

  mergeConceptRecordsIntoClassroom(classroom, [
    { studentId: 'student-1', conceptId: 'concept-other', understanding: 'confident', notebook: 'not_required', helpRequested: false, updatedAt: '2026-01-01' },
  ]);

  assert.equal(getStudentConceptRecord(student, 'concept-legacy-only').understanding, 'understand');
});

test('mergeConceptRecordsIntoClassroom: a concept with neither new nor legacy data falls back to the real default record, not undefined', () => {
  const { classroom, student } = classroomWithStudent();
  mergeConceptRecordsIntoClassroom(classroom, []);

  const record = getStudentConceptRecord(student, 'concept-never-touched');
  assert.equal(record.understanding, 'not_marked');
  assert.equal(record.notebook, 'not_required');
  assert.equal(record.helpRequested, false);
});

test('mergeConceptRecordsIntoClassroom: a record for a student no longer on the roster is silently skipped, not thrown', () => {
  const { classroom } = classroomWithStudent();
  assert.doesNotThrow(() => {
    mergeConceptRecordsIntoClassroom(classroom, [
      { studentId: 'removed-student', conceptId: 'concept-1', understanding: 'confident', notebook: 'not_required', helpRequested: false, updatedAt: '2026-01-01' },
    ]);
  });
});

test('mergeConceptRecordsIntoClassroom: routes each record to its own correct student across a multi-student roster', () => {
  const studentA = createStudent({ id: 'student-A', name: 'A' });
  const studentB = createStudent({ id: 'student-B', name: 'B' });
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  classroom.teams = [createTeam({ name: 'Alpha', students: [studentA, studentB] })];

  mergeConceptRecordsIntoClassroom(classroom, [
    { studentId: 'student-A', conceptId: 'concept-1', understanding: 'confident', notebook: 'not_required', helpRequested: false, updatedAt: '2026-01-01' },
    { studentId: 'student-B', conceptId: 'concept-1', understanding: 'need_help', notebook: 'not_required', helpRequested: false, updatedAt: '2026-01-01' },
  ]);

  assert.equal(getStudentConceptRecord(studentA, 'concept-1').understanding, 'confident');
  assert.equal(getStudentConceptRecord(studentB, 'concept-1').understanding, 'need_help');
});
