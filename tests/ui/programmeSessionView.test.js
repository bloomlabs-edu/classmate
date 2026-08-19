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
import { isSessionEditable, getSessionParticipantIds, getEffectiveAttendanceStatus, getToggledAttendanceStatus, hasRecordedAttendance } from '../../js/ui/views/ProgrammeSessionView.js';
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

// ---------------------------------------------------------------------
// PHASE 2A UX CORRECTION — attendance single-tap toggle
// ---------------------------------------------------------------------

test('getEffectiveAttendanceStatus: defaults to present when no attendance record exists', () => {
  const session = { attendance: {} };
  assert.equal(getEffectiveAttendanceStatus(session, 'student-1'), 'present');
});

test('getEffectiveAttendanceStatus: the default is display-only — this function never mutates the session', () => {
  const session = { attendance: {} };
  getEffectiveAttendanceStatus(session, 'student-1');
  assert.deepEqual(session.attendance, {}, 'reading the effective status must never create an attendance entry as a side effect');
});

test('getEffectiveAttendanceStatus: returns the actual recorded status once one exists', () => {
  const session = { attendance: { 'student-1': { status: 'late' } } };
  assert.equal(getEffectiveAttendanceStatus(session, 'student-1'), 'late');
});

test('getEffectiveAttendanceStatus: returns absent when explicitly recorded, not the default', () => {
  const session = { attendance: { 'student-1': { status: 'absent' } } };
  assert.equal(getEffectiveAttendanceStatus(session, 'student-1'), 'absent');
});

test('getToggledAttendanceStatus: present toggles to absent', () => {
  assert.equal(getToggledAttendanceStatus('present'), 'absent');
});

test('getToggledAttendanceStatus: absent toggles to present', () => {
  assert.equal(getToggledAttendanceStatus('absent'), 'present');
});

test('getToggledAttendanceStatus: late resolves to present — the fast toggle never cycles through late', () => {
  assert.equal(getToggledAttendanceStatus('late'), 'present');
});

test('getToggledAttendanceStatus: tapping twice from the default (present) returns to present', () => {
  const first = getToggledAttendanceStatus('present');
  const second = getToggledAttendanceStatus(first);
  assert.equal(first, 'absent');
  assert.equal(second, 'present');
});

test('hasRecordedAttendance: false when no entry exists', () => {
  const session = { attendance: {} };
  assert.equal(hasRecordedAttendance(session, 'student-1'), false);
});

test('hasRecordedAttendance: true once any status is explicitly recorded', () => {
  const session = { attendance: { 'student-1': { status: 'absent' } } };
  assert.equal(hasRecordedAttendance(session, 'student-1'), true);
});

test('hasRecordedAttendance: distinguishes "never touched" from "explicitly present" — a historical read-only row must not silently default', () => {
  const untouched = { attendance: {} };
  const explicitlyPresent = { attendance: { 'student-1': { status: 'present' } } };
  assert.equal(hasRecordedAttendance(untouched, 'student-1'), false);
  assert.equal(hasRecordedAttendance(explicitlyPresent, 'student-1'), true);
  // Both would show the same *effective* status if asked, which is
  // exactly why hasRecordedAttendance() — not getEffectiveAttendanceStatus()
  // — must be the check a read-only view uses before deciding whether
  // to show a real status or "Not recorded".
  assert.equal(getEffectiveAttendanceStatus(untouched, 'student-1'), getEffectiveAttendanceStatus(explicitlyPresent, 'student-1'));
});
