/**
 * tests/ui/programmeSessionView.test.js
 *
 * Real, executed unit tests against
 * ui/views/ProgrammeSessionView.js's own pure, exported decision
 * functions — isSessionEditable() and getSessionParticipantIds().
 * Everything else in that file builds real DOM (document.createElement,
 * etc.), which this sandbox cannot exercise without introducing a DOM
 * library this project has never depended on (see this phase's own
 * implementation report for why that wasn't done) — these two
 * functions were deliberately extracted and exported specifically so
 * the actual decisions they encode are still genuinely testable
 * without one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionEditable, getSessionParticipantIds } from '../../js/ui/views/ProgrammeSessionView.js';
import { getTodayDateKey } from '../../js/utils/dateHelpers.js';

test('isSessionEditable: true for today\'s session on an active programme', () => {
  const session = { date: getTodayDateKey() };
  const programme = { status: 'active' };
  assert.equal(isSessionEditable(session, programme), true);
});

test('isSessionEditable: false for a past session, even on an active programme', () => {
  const session = { date: '2020-01-01' };
  const programme = { status: 'active' };
  assert.equal(isSessionEditable(session, programme), false);
});

test('isSessionEditable: false for today\'s session on an archived programme', () => {
  const session = { date: getTodayDateKey() };
  const programme = { status: 'archived' };
  assert.equal(isSessionEditable(session, programme), false);
});

test('isSessionEditable: false for a past session on an archived programme', () => {
  const session = { date: '2020-01-01' };
  const programme = { status: 'archived' };
  assert.equal(isSessionEditable(session, programme), false);
});

test('getSessionParticipantIds: returns the union of attendance/goals/teacherObservations keys', () => {
  const session = {
    attendance: { 'student-1': { status: 'present' } },
    goals: { 'student-2': { 'cat-1': { text: 'x' } } },
    teacherObservations: { 'student-3': [{ note: 'x' }] },
  };
  const ids = getSessionParticipantIds(session).sort();
  assert.deepEqual(ids, ['student-1', 'student-2', 'student-3']);
});

test('getSessionParticipantIds: deduplicates a student appearing in more than one map', () => {
  const session = {
    attendance: { 'student-1': { status: 'present' } },
    goals: { 'student-1': { 'cat-1': { text: 'x' } } },
    teacherObservations: {},
  };
  assert.deepEqual(getSessionParticipantIds(session), ['student-1']);
});

test('getSessionParticipantIds: returns an empty array for a session with no recorded data', () => {
  const session = { attendance: {}, goals: {}, teacherObservations: {} };
  assert.deepEqual(getSessionParticipantIds(session), []);
});

test('getSessionParticipantIds: tolerates missing fields entirely (defaults to empty)', () => {
  assert.deepEqual(getSessionParticipantIds({}), []);
});
