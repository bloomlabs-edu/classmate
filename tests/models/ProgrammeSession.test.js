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
  assert.deepEqual(session.attendance, {}, 'attendance is a student-keyed map, not an array, as of Phase 1.6');
  assert.deepEqual(session.goals, {}, 'goals is a student-keyed map, not an array, as of Phase 1.6');
  assert.deepEqual(session.activities, [], 'activities remains a plain array — it is session-wide, not per-student');
  assert.deepEqual(session.componentInstances, {});
  assert.deepEqual(session.teacherObservations, {}, 'teacherObservations is a student-keyed map, not an array, as of Phase 1.6');
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

test('createProgrammeSession: no separate participant-roster field exists — deliberate Phase 1.6 decision', () => {
  const session = createProgrammeSession({ programmeId: 'programme-1' });
  const keys = Object.keys(session);

  assert.ok(!keys.includes('participants'));
  assert.ok(!keys.includes('roster'));
});

test('createAttendanceEntry: shape — studentId is NOT part of the value, it is the map key', () => {
  const entry = createAttendanceEntry({ status: 'present' });
  assert.equal(entry.status, 'present');
  assert.ok(entry.recordedAt);
  assert.deepEqual(Object.keys(entry).sort(), ['recordedAt', 'status']);
});

test('createProgrammeGoalEntry: defaults source to custom, outcome to null; studentId/categoryId are NOT part of the value', () => {
  const entry = createProgrammeGoalEntry({ text: 'Read two pages' });

  assert.equal(entry.source, 'custom');
  assert.equal(entry.outcome, null);
  assert.equal(entry.reflection, '');
  assert.equal(entry.text, 'Read two pages');
  assert.deepEqual(Object.keys(entry).sort(), ['outcome', 'reflection', 'source', 'text']);
});

test('createProgrammeGoalEntry: accepts a suggested source', () => {
  const entry = createProgrammeGoalEntry({ text: 'Read two pages', source: 'suggested' });
  assert.equal(entry.source, 'suggested');
});

test('createActivityEntry: shape', () => {
  const entry = createActivityEntry({ name: 'Guided Reading' });
  assert.equal(entry.name, 'Guided Reading');
  assert.equal(entry.notes, '');
});

test('createTeacherObservationEntry: shape, is evidence not student reflection; studentId is NOT part of the value', () => {
  const entry = createTeacherObservationEntry({ note: 'Needed less prompting today' });
  assert.equal(entry.note, 'Needed less prompting today');
  assert.ok(entry.recordedAt);
  assert.deepEqual(Object.keys(entry).sort(), ['note', 'recordedAt']);
});
