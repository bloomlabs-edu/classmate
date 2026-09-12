import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { ensureVisitorAccessCode, revokeVisitorAccessCode, ensureProgramManagerJoinCode } from '../../js/services/classroomService.js';

test('ensureVisitorAccessCode: generates a code once, and is a no-op if one already exists', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  assert.equal(classroom.visitorAccessCode, null);

  const created = ensureVisitorAccessCode(classroom);
  assert.equal(created, true);
  assert.ok(classroom.visitorAccessCode);

  const existingCode = classroom.visitorAccessCode;
  const createdAgain = ensureVisitorAccessCode(classroom);
  assert.equal(createdAgain, false);
  assert.equal(classroom.visitorAccessCode, existingCode); // never silently regenerated over an existing code
});

test('revokeVisitorAccessCode: clears the classroom\'s own pointer back to null', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  ensureVisitorAccessCode(classroom);
  assert.ok(classroom.visitorAccessCode);

  revokeVisitorAccessCode(classroom);
  assert.equal(classroom.visitorAccessCode, null);
});

test('ensureProgramManagerJoinCode: generates a code once, and is a no-op if one already exists', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  assert.equal(classroom.programManagerJoinCode, null);

  const created = ensureProgramManagerJoinCode(classroom);
  assert.equal(created, true);
  assert.ok(classroom.programManagerJoinCode);

  const existingCode = classroom.programManagerJoinCode;
  const createdAgain = ensureProgramManagerJoinCode(classroom);
  assert.equal(createdAgain, false);
  assert.equal(classroom.programManagerJoinCode, existingCode);
});

test('ensureProgramManagerJoinCode: generates a DIFFERENT code from classroomJoinCode — the two must never be interchangeable', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  classroom.classroomJoinCode = 'ABC123';
  ensureProgramManagerJoinCode(classroom);
  assert.notEqual(classroom.programManagerJoinCode, classroom.classroomJoinCode);
});
