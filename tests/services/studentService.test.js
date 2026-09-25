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
