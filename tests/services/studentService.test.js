import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudent } from '../../js/models/Student.js';
import * as studentService from '../../js/services/studentService.js';

function buildClassroom(students) {
  return { id: 'classroom-1', teams: [{ id: 'team-1', students }] };
}

test('validateRollNumberInput: blank input is valid and clears to null', () => {
  const result = studentService.validateRollNumberInput('', [], 's1');
  assert.equal(result.valid, true);
  assert.equal(result.value, null);
  assert.equal(result.error, null);
});

test('validateRollNumberInput: whitespace-only input is valid and clears to null', () => {
  const result = studentService.validateRollNumberInput('   ', [], 's1');
  assert.equal(result.valid, true);
  assert.equal(result.value, null);
});

test('validateRollNumberInput: preserves leading zeros as a string, never coerces to a number', () => {
  const result = studentService.validateRollNumberInput('01', [], 's1');
  assert.equal(result.valid, true);
  assert.equal(result.value, '01');
  assert.equal(typeof result.value, 'string');
});

test('validateRollNumberInput: trims surrounding whitespace on an otherwise valid value', () => {
  const result = studentService.validateRollNumberInput('  12  ', [], 's1');
  assert.equal(result.valid, true);
  assert.equal(result.value, '12');
});

test('validateRollNumberInput: rejects non-digit characters', () => {
  const result = studentService.validateRollNumberInput('12A', [], 's1');
  assert.equal(result.valid, false);
  assert.equal(result.value, null);
  assert.match(result.error, /digits only/);
});

test('validateRollNumberInput: rejects a value already assigned to another student', () => {
  const students = [
    createStudent({ id: 's1', name: 'A', rollNumber: '12' }),
    createStudent({ id: 's2', name: 'B' }),
  ];
  const result = studentService.validateRollNumberInput('12', students, 's2');
  assert.equal(result.valid, false);
  assert.equal(result.error, 'Roll number 12 is already assigned to another student.');
});

test('validateRollNumberInput: re-saving a student\'s own unchanged roll number does not flag itself as a duplicate', () => {
  const students = [
    createStudent({ id: 's1', name: 'A', rollNumber: '12' }),
    createStudent({ id: 's2', name: 'B' }),
  ];
  const result = studentService.validateRollNumberInput('12', students, 's1');
  assert.equal(result.valid, true);
  assert.equal(result.value, '12');
});

test('setStudentRollNumber: sets the roll number on the correct student across teams', () => {
  const studentA = createStudent({ id: 's1', name: 'A' });
  const studentB = createStudent({ id: 's2', name: 'B' });
  const classroom = { id: 'classroom-1', teams: [{ id: 'team-1', students: [studentA] }, { id: 'team-2', students: [studentB] }] };

  const updated = studentService.setStudentRollNumber(classroom, 's2', '07');
  assert.equal(updated.rollNumber, '07');
  assert.equal(studentA.rollNumber, null);
});

test('setStudentRollNumber: clearing to null does not touch any other field', () => {
  const student = createStudent({ id: 's1', name: 'A', rollNumber: '12', score: 5 });
  const classroom = buildClassroom([student]);

  studentService.setStudentRollNumber(classroom, 's1', null);
  assert.equal(student.rollNumber, null);
  assert.equal(student.name, 'A');
  assert.equal(student.score, 5);
});

test('setStudentRollNumber: returns null for an unknown studentId', () => {
  const classroom = buildClassroom([createStudent({ id: 's1', name: 'A' })]);
  const result = studentService.setStudentRollNumber(classroom, 'does-not-exist', '12');
  assert.equal(result, null);
});

/**
 * "Add Existing Student" picker — ui/components/AddExistingStudentsModal.js
 * only ever reports back a set of studentIds; the actual move happens
 * through the same moveStudentToTeam() every other move in the app
 * already uses. These tests cover the invariant that matters most for
 * that flow: a student picked from elsewhere ends up in EXACTLY the
 * target team's own `students` array — never duplicated, never left in
 * both, regardless of how many students are moved in one go.
 */
test('moveStudentToTeam: moving multiple existing students into one group in a single batch leaves each in exactly one team, with no duplicates', () => {
  const studentA = createStudent({ id: 's1', name: 'A' });
  const studentB = createStudent({ id: 's2', name: 'B' });
  const studentC = createStudent({ id: 's3', name: 'C' }); // stays behind
  const classroom = {
    id: 'classroom-1',
    teams: [
      { id: 'ungrouped', students: [studentA, studentB, studentC] },
      { id: 'team-red', students: [] },
    ],
  };

  ['s1', 's2'].forEach((studentId) => {
    studentService.moveStudentToTeam(classroom, 'ungrouped', studentId, 'team-red');
  });

  const ungrouped = classroom.teams.find((t) => t.id === 'ungrouped');
  const teamRed = classroom.teams.find((t) => t.id === 'team-red');

  assert.deepEqual(teamRed.students.map((s) => s.id).sort(), ['s1', 's2']);
  assert.deepEqual(ungrouped.students.map((s) => s.id), ['s3']);

  // No duplicates anywhere in the classroom, and every moved student
  // belongs to exactly one team's own array (the "only one team at a
  // time" invariant this app already enforces structurally).
  const allIds = classroom.teams.flatMap((t) => t.students.map((s) => s.id));
  assert.deepEqual(allIds.sort(), ['s1', 's2', 's3']);
  ['s1', 's2', 's3'].forEach((id) => {
    const owningTeams = classroom.teams.filter((t) => t.students.some((s) => s.id === id));
    assert.equal(owningTeams.length, 1, `student ${id} must belong to exactly one team`);
  });
});

test('moveStudentToTeam: moving a student between two real groups (not just to/from Ungrouped) never leaves them in both', () => {
  const student = createStudent({ id: 's1', name: 'A' });
  const classroom = {
    id: 'classroom-1',
    teams: [
      { id: 'team-blue', students: [student] },
      { id: 'team-red', students: [] },
    ],
  };

  const moved = studentService.moveStudentToTeam(classroom, 'team-blue', 's1', 'team-red');

  assert.equal(moved.id, 's1');
  assert.deepEqual(classroom.teams.find((t) => t.id === 'team-blue').students, []);
  assert.deepEqual(classroom.teams.find((t) => t.id === 'team-red').students.map((s) => s.id), ['s1']);
});

test('moveStudentToTeam: preserves the student\'s own score/badges/history untouched across the move', () => {
  const student = createStudent({ id: 's1', name: 'A', score: 12, badges: ['star'], history: [{ id: 'h1', kind: 'bonus', delta: 5 }] });
  const classroom = { id: 'classroom-1', teams: [{ id: 'team-a', students: [student] }, { id: 'team-b', students: [] }] };

  studentService.moveStudentToTeam(classroom, 'team-a', 's1', 'team-b');

  const moved = classroom.teams.find((t) => t.id === 'team-b').students[0];
  assert.equal(moved.score, 12);
  assert.deepEqual(moved.badges, ['star']);
  assert.deepEqual(moved.history, [{ id: 'h1', kind: 'bonus', delta: 5 }]);
});

test('moveStudentToTeam: re-attempting to move a student already in the target team is a safe no-op, never a duplicate (fromTeamId === toTeamId guard)', () => {
  const student = createStudent({ id: 's1', name: 'A' });
  const classroom = { id: 'classroom-1', teams: [{ id: 'team-a', students: [student] }] };

  const result = studentService.moveStudentToTeam(classroom, 'team-a', 's1', 'team-a');

  assert.equal(result, null);
  assert.equal(classroom.teams.find((t) => t.id === 'team-a').students.length, 1);
});

/**
 * "Create a brand new student" (addStudent) stays a completely
 * separate code path from the existing-student picker above — adding
 * a new student must never look at, exclude, or interact with any
 * other team's roster the way the picker's exclusion logic does.
 */
test('addStudent: creating a new student is unaffected by, and does not touch, any other team\'s students', () => {
  const existingElsewhere = createStudent({ id: 's1', name: 'Existing' });
  const classroom = {
    id: 'classroom-1',
    teams: [
      { id: 'team-a', students: [existingElsewhere] },
      { id: 'team-b', students: [] },
    ],
  };
  const teamB = classroom.teams.find((t) => t.id === 'team-b');

  const created = studentService.addStudent(teamB, 'Brand New');

  assert.notEqual(created.id, 's1');
  assert.equal(teamB.students.length, 1);
  assert.equal(classroom.teams.find((t) => t.id === 'team-a').students.length, 1);
  assert.equal(classroom.teams.find((t) => t.id === 'team-a').students[0].id, 's1');
});
