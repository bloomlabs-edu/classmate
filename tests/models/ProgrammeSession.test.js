import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProgrammeSession,
  createAttendanceEntry,
  createProgrammeGoalEntry,
  createActivityEntry,
  createTeacherObservationEntry,
} from '../../js/models/ProgrammeSession.js';

test('createProgrammeSession: safe defaults, date falls back to createdAt', () => {
  const session = createProgrammeSession({ programmeId: 'programme-1' });

  assert.equal(session.programmeId, 'programme-1');
  assert.deepEqual(session.attendance, []);
  assert.deepEqual(session.goals, []);
  assert.deepEqual(session.activities, []);
  assert.deepEqual(session.componentInstances, {});
  assert.deepEqual(session.teacherObservations, []);
  assert.equal(session.date, session.createdAt.slice(0, 10));
});

test('createProgrammeSession: an explicit date is preserved as-is', () => {
  const session = createProgrammeSession({ programmeId: 'programme-1', date: '2026-08-19' });
  assert.equal(session.date, '2026-08-19');
});

test('createProgrammeSession: no score/progress field exists on the model', () => {
  const session = createProgrammeSession({ programmeId: 'programme-1' });
  const keys = Object.keys(session);

  assert.ok(!keys.includes('score'));
  assert.ok(!keys.includes('progress'));
  assert.ok(!keys.includes('attendancePercentage'));
});

test('createAttendanceEntry: shape', () => {
  const entry = createAttendanceEntry({ studentId: 'student-1', status: 'present' });
  assert.equal(entry.studentId, 'student-1');
  assert.equal(entry.status, 'present');
  assert.ok(entry.recordedAt);
});

test('createProgrammeGoalEntry: defaults source to custom, outcome to null', () => {
  const entry = createProgrammeGoalEntry({ studentId: 'student-1', categoryId: 'cat-1', text: 'Read two pages' });

  assert.equal(entry.source, 'custom');
  assert.equal(entry.outcome, null);
  assert.equal(entry.reflection, '');
  assert.equal(entry.text, 'Read two pages');
});

test('createProgrammeGoalEntry: accepts a suggested source', () => {
  const entry = createProgrammeGoalEntry({ studentId: 'student-1', categoryId: 'cat-1', text: 'Read two pages', source: 'suggested' });
  assert.equal(entry.source, 'suggested');
});

test('createActivityEntry: shape', () => {
  const entry = createActivityEntry({ name: 'Guided Reading' });
  assert.equal(entry.name, 'Guided Reading');
  assert.equal(entry.notes, '');
});

test('createTeacherObservationEntry: shape, is evidence not student reflection', () => {
  const entry = createTeacherObservationEntry({ studentId: 'student-1', note: 'Needed less prompting today' });
  assert.equal(entry.studentId, 'student-1');
  assert.equal(entry.note, 'Needed less prompting today');
  assert.ok(entry.recordedAt);
});
