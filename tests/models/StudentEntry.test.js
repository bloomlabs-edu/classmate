/**
 * tests/models/StudentEntry.test.js
 *
 * PHASE 3 — Student Identity & Learning Circle Data Boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudentEntry } from '../../js/models/StudentEntry.js';

test('createStudentEntry: defaults to null attendance and an empty goals map', () => {
  const entry = createStudentEntry();
  assert.equal(entry.attendance, null);
  assert.deepEqual(entry.goals, {});
});

test('createStudentEntry: preserves given attendance and goals', () => {
  const entry = createStudentEntry({
    attendance: { status: 'absent', recordedAt: '2026-08-19T09:00:00.000Z' },
    goals: { 'cat-1': { text: 'Read for 10 minutes', source: 'custom', outcome: null, reflection: '' } },
  });
  assert.equal(entry.attendance.status, 'absent');
  assert.equal(entry.goals['cat-1'].text, 'Read for 10 minutes');
});

test('createStudentEntry: contains exactly the two documented fields, no more', () => {
  const entry = createStudentEntry();
  assert.deepEqual(Object.keys(entry).sort(), ['attendance', 'goals']);
});
