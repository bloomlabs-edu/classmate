import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as learningRecordTeacherService from '../../js/services/learningRecordTeacherService.js';
import * as timetableService from '../../js/services/timetableService.js';
import { buildVisitorSnapshot } from '../../js/services/visitorAccessService.js';

function buildClassroomWithContent() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'CHS Kannamapet', gradeSection: 'Grade 8A' });
  const subject = learningRecordTeacherService.createSubject(classroom, { title: 'Social Science', subjectId: 'social_science' });
  const unit = learningRecordTeacherService.createUnit(classroom, subject.id, { title: 'Unit 1: Colonial India' });
  learningRecordTeacherService.createConcept(classroom, unit.id, { title: 'Poligars Revolt' });
  learningRecordTeacherService.createConcept(classroom, unit.id, { title: 'Kattabomman' });
  timetableService.setPeriods(classroom, [{ periodNumber: 1, startTime: '09:00', endTime: '09:45' }]);
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 1, subjectId: 'social_science' });
  return classroom;
}

test('buildVisitorSnapshot: includes classroom identity and curriculum/timetable structure', () => {
  const classroom = buildClassroomWithContent();
  const snapshot = buildVisitorSnapshot(classroom);

  assert.equal(snapshot.gradeSection, 'Grade 8A');
  assert.equal(snapshot.schoolName, 'CHS Kannamapet');
  assert.equal(snapshot.subjects.length, 1);
  assert.equal(snapshot.subjects[0].title, 'Social Science');
  assert.equal(snapshot.subjects[0].units[0].title, 'Unit 1: Colonial India');
  assert.deepEqual(
    snapshot.subjects[0].units[0].concepts.map((c) => c.title),
    ['Poligars Revolt', 'Kattabomman']
  );
  assert.equal(snapshot.timetable.periods.length, 1);
  assert.equal(snapshot.timetable.slots.length, 1);
  assert.equal(snapshot.timetable.slots[0].subjectTitle, 'Social Science');
  assert.ok(snapshot.generatedAt);
});

test('buildVisitorSnapshot: never includes teams, students, members, or any join/reset code — an explicit allow-list, not an exclude-list', () => {
  const classroom = buildClassroomWithContent();
  classroom.teams = [{ id: 't1', name: 'Team A', students: [{ id: 's1', name: 'Real Student Name' }] }];
  classroom.members = { 'uid-1': { role: 'owner', displayName: 'Teacher' } };
  classroom.classroomJoinCode = 'SECRET1';
  classroom.classroomStudentJoinCode = 'SECRET2';
  classroom.deviceResetPin = '1234';

  const snapshot = buildVisitorSnapshot(classroom);
  const serialized = JSON.stringify(snapshot);

  assert.ok(!serialized.includes('Real Student Name'));
  assert.ok(!serialized.includes('SECRET1'));
  assert.ok(!serialized.includes('SECRET2'));
  assert.ok(!serialized.includes('1234'));
  assert.equal(snapshot.teams, undefined);
  assert.equal(snapshot.members, undefined);
});

test('buildVisitorSnapshot: an empty classroom (no subjects/timetable yet) produces empty, never-thrown structure', () => {
  const classroom = createClassroom({ id: 'c2', schoolName: 'A School', gradeSection: 'Grade 9' });
  const snapshot = buildVisitorSnapshot(classroom);
  assert.deepEqual(snapshot.subjects, []);
  assert.deepEqual(snapshot.timetable.periods, []);
  assert.deepEqual(snapshot.timetable.slots, []);
});
