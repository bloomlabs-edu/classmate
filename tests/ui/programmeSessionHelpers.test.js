/**
 * tests/ui/programmeSessionHelpers.test.js
 *
 * Real, executed unit tests against
 * ui/components/ProgrammeSessionHelpers.js's own pure, DOM-free
 * decision functions. This file used to test
 * ui/views/ProgrammeSessionView.js directly, before this round's own
 * redesign extracted these functions into their own shared module
 * (now used by four screens, not one) — renamed to match. Everything
 * DOM-building in any of those four screens builds real
 * document.createElement() nodes, which this sandbox cannot exercise
 * without introducing a DOM library this project has never depended
 * on — these pure functions were deliberately extracted and exported
 * specifically so the actual decisions they encode stay genuinely
 * testable without one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSessionEditable,
  getSessionParticipantIds,
  getEffectiveAttendanceStatus,
  getToggledAttendanceStatus,
  hasRecordedAttendance,
  countAttendanceByStatus,
  countStudentsWithGoals,
  countActivities,
  countObservations,
  summarizeStudentProgress,
} from '../../js/ui/components/ProgrammeSessionHelpers.js';
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

// ---------------------------------------------------------------------
// LEARNING CIRCLE REDESIGN — stats-strip counting functions
// ---------------------------------------------------------------------

test('countAttendanceByStatus: editable session — every roster member counts, unset defaults to present', () => {
  const session = { attendance: { s1: { status: 'absent' } } };
  const roster = [{ student: { id: 's1' } }, { student: { id: 's2' } }, { student: { id: 's3' } }];
  const counts = countAttendanceByStatus(session, roster, true);
  assert.deepEqual(counts, { present: 2, absent: 1, late: 0 });
});

test('countAttendanceByStatus: editable session — counts always sum to roster size', () => {
  const session = { attendance: { s1: { status: 'late' }, s2: { status: 'absent' } } };
  const roster = [{ student: { id: 's1' } }, { student: { id: 's2' } }, { student: { id: 's3' } }, { student: { id: 's4' } }];
  const counts = countAttendanceByStatus(session, roster, true);
  assert.equal(counts.present + counts.absent + counts.late, roster.length);
});

test('countAttendanceByStatus: read-only (historical) session — an unrecorded roster member counts toward nothing', () => {
  const session = { attendance: { s1: { status: 'present' } } };
  const roster = [{ student: { id: 's1' } }, { student: { id: 's2' } }];
  const counts = countAttendanceByStatus(session, roster, false);
  assert.deepEqual(counts, { present: 1, absent: 0, late: 0 }, 's2 was never recorded and must not be counted as present');
});

test('countStudentsWithGoals: counts roster students with at least one goal, regardless of category count', () => {
  const session = { goals: { s1: { catA: { text: 'x' }, catB: { text: 'y' } }, s2: {} } };
  const roster = [{ student: { id: 's1' } }, { student: { id: 's2' } }, { student: { id: 's3' } }];
  assert.equal(countStudentsWithGoals(session, roster), 1, 'only s1 has any goal at all — s2 has an empty object, s3 has none');
});

test('countStudentsWithGoals: zero when no roster student has any goal', () => {
  const session = { goals: {} };
  const roster = [{ student: { id: 's1' } }];
  assert.equal(countStudentsWithGoals(session, roster), 0);
});

test('countActivities: returns the plain activities array length', () => {
  assert.equal(countActivities({ activities: [{ name: 'a' }, { name: 'b' }] }), 2);
  assert.equal(countActivities({ activities: [] }), 0);
});

test('countObservations: sums observation entries across every student the session mentions', () => {
  const session = { teacherObservations: { s1: [{ note: 'a' }, { note: 'b' }], s2: [{ note: 'c' }] } };
  assert.equal(countObservations(session), 3);
});

test('countObservations: zero when there are no observations at all', () => {
  assert.equal(countObservations({ teacherObservations: {} }), 0);
});

// ---------------------------------------------------------------------
// LEARNING CIRCLE REDESIGN — Part 12, student progress summary
// ---------------------------------------------------------------------

test('summarizeStudentProgress: counts present/absent/late correctly across sessions', () => {
  const sessions = [
    { attendance: { s1: { status: 'present' } }, goals: {} },
    { attendance: { s1: { status: 'absent' } }, goals: {} },
    { attendance: { s1: { status: 'late' } }, goals: {} },
  ];
  const summary = summarizeStudentProgress(sessions, 's1');
  assert.equal(summary.totalSessions, 3);
  assert.equal(summary.sessionsPresent, 1);
  assert.equal(summary.sessionsAbsent, 1);
  assert.equal(summary.sessionsLate, 1);
});

test('summarizeStudentProgress: a session with no attendance entry for this student counts toward none of the three buckets', () => {
  const sessions = [{ attendance: {}, goals: {} }];
  const summary = summarizeStudentProgress(sessions, 's1');
  assert.equal(summary.sessionsPresent, 0);
  assert.equal(summary.sessionsAbsent, 0);
  assert.equal(summary.sessionsLate, 0);
});

test('summarizeStudentProgress: counts goals set and completed across sessions', () => {
  const sessions = [
    { attendance: {}, goals: { s1: { catA: { text: 'x', outcome: 'completed' }, catB: { text: 'y', outcome: null } } } },
    { attendance: {}, goals: { s1: { catA: { text: 'z', outcome: 'try_again' } } } },
  ];
  const summary = summarizeStudentProgress(sessions, 's1');
  assert.equal(summary.goalsSet, 3);
  assert.equal(summary.goalsCompleted, 1);
});

test('summarizeStudentProgress: only counts the given student\'s own goals, never another student\'s', () => {
  const sessions = [{ attendance: {}, goals: { s1: { catA: { text: 'x', outcome: 'completed' } }, s2: { catA: { text: 'y', outcome: 'completed' } } } }];
  const summary = summarizeStudentProgress(sessions, 's1');
  assert.equal(summary.goalsSet, 1);
});

test('summarizeStudentProgress: zero sessions produces all-zero counts, never throws', () => {
  const summary = summarizeStudentProgress([], 's1');
  assert.deepEqual(summary, { totalSessions: 0, sessionsPresent: 0, sessionsAbsent: 0, sessionsLate: 0, goalsSet: 0, goalsCompleted: 0 });
});
