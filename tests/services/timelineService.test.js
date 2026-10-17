import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudent } from '../../js/models/Student.js';
import { logEntry, logPoints, findEntryById, removeEntryById } from '../../js/services/timelineService.js';

test('logEntry honors a caller-supplied deterministic id instead of a random one', () => {
  const student = createStudent({ id: 's1', name: 'T' });
  const entry = logEntry(student, { id: 'fixed-id', kind: 'points', label: 'x', delta: 1 });
  assert.equal(entry.id, 'fixed-id');
});

test('logEntry stores optional source/sourceId/studentId when provided, omits them when not', () => {
  const student = createStudent({ id: 's1', name: 'T' });
  const withExtra = logEntry(student, {
    kind: 'points',
    label: 'x',
    delta: 1,
    source: 'notebook_checkpoint',
    sourceId: 'cp-1',
    studentId: 's1',
  });
  assert.equal(withExtra.source, 'notebook_checkpoint');
  assert.equal(withExtra.sourceId, 'cp-1');
  assert.equal(withExtra.studentId, 's1');

  const withoutExtra = logEntry(student, { kind: 'points', label: 'y', delta: 1 });
  assert.equal('source' in withoutExtra, false);
  assert.equal('sourceId' in withoutExtra, false);
  assert.equal('studentId' in withoutExtra, false);
});

test('findEntryById finds an existing entry and returns null for a missing one', () => {
  const student = createStudent({ id: 's1', name: 'T' });
  logEntry(student, { id: 'find-me', kind: 'points', label: 'x', delta: 1 });
  assert.ok(findEntryById(student, 'find-me'));
  assert.equal(findEntryById(student, 'nope'), null);
});

test('removeEntryById removes the entry and reverses exactly its own delta, not a blind +/-1', () => {
  const student = createStudent({ id: 's1', name: 'T' });
  logPoints(student, 5, 'big award', { id: 'big' });
  assert.equal(student.score, 5);
  const removed = removeEntryById(student, 'big');
  assert.equal(removed.delta, 5);
  assert.equal(student.score, 0);
  assert.equal(findEntryById(student, 'big'), null);
});

test('removeEntryById is a safe no-op for an id that does not exist', () => {
  const student = createStudent({ id: 's1', name: 'T' });
  logPoints(student, 2, 'kept', { id: 'kept' });
  const result = removeEntryById(student, 'never-existed');
  assert.equal(result, null);
  assert.equal(student.score, 2); // untouched
});

test('removeEntryById never touches score for a non-points entry (e.g. a badge)', () => {
  const student = createStudent({ id: 's1', name: 'T' });
  logEntry(student, { id: 'badge-1', kind: 'badge', label: 'Great Effort', delta: 0 });
  removeEntryById(student, 'badge-1');
  assert.equal(student.score, 0);
});
