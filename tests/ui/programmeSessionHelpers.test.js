/**
 * tests/ui/programmeSessionHelpers.test.js
 *
 * Real, executed unit tests against
 * ui/components/ProgrammeSessionHelpers.js's own pure, DOM-free
 * decision functions. This file used to test
 * ui/views/ProgrammeSessionView.js directly, before an earlier
 * round's own redesign extracted these functions into their own
 * shared module (now used by four screens, not one) — renamed to
 * match. Everything DOM-building in any of those four screens builds
 * real document.createElement() nodes, which this sandbox cannot
 * exercise without introducing a DOM library this project has never
 * depended on — these pure functions were deliberately extracted and
 * exported specifically so the actual decisions they encode stay
 * genuinely testable without one.
 *
 * getSessionParticipantIds() no longer exists — this round removed it
 * entirely (see resolveSessionRoster()'s own header comment in
 * ProgrammeSessionHelpers.js for the full bug it caused). Its own
 * former tests below are replaced with tests for
 * learningProgrammeService.getMembersOnDate(), the correct
 * replacement, which already lives in and is tested alongside that
 * service's own test file — see
 * tests/services/learningProgrammeService.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSessionEditable,
  resolveSessionRoster,
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

// ---------------------------------------------------------------------
// ATTENDANCE ROSTER BUG FIX — resolveSessionRoster() for a historical
// session must include every genuine member on that date, regardless
// of whether any attendance/goal/observation record exists for them.
// This is the actual bug this round fixed; these tests exist
// specifically to pin it down so it can't silently regress.
// ---------------------------------------------------------------------

function buildTestClassroom(studentIds) {
  return {
    teams: [
      {
        id: 'team-1',
        students: studentIds.map((id) => ({ id, name: id })),
      },
    ],
  };
}

function buildTestProgramme(memberships) {
  return {
    memberships,
  };
}

test('resolveSessionRoster (historical): includes a member with NO attendance/goal/observation record at all — the core bug this round fixed', () => {
  const classroom = buildTestClassroom(['student-present', 'student-absent']);
  const programme = buildTestProgramme([
    { studentId: 'student-present', joinedAt: '2020-01-01T00:00:00.000Z', leftAt: null, status: 'active' },
    { studentId: 'student-absent', joinedAt: '2020-01-01T00:00:00.000Z', leftAt: null, status: 'active' },
  ]);
  const session = {
    date: '2026-08-19',
    attendance: { 'student-absent': { status: 'absent', recordedAt: '2026-08-19T09:00:00.000Z' } },
    goals: {},
    teacherObservations: {},
  };
  const roster = resolveSessionRoster(classroom, programme, session, false);
  const rosterIds = roster.map((r) => r.student.id).sort();
  assert.deepEqual(rosterIds, ['student-absent', 'student-present'], 'the untouched, default-present student must still appear');
});

test('resolveSessionRoster (historical): reproduces the exact 19 August scenario — 12 members, 9 untouched, 3 explicitly absent', () => {
  const presentIds = Array.from({ length: 9 }, (_, i) => `present-${i}`);
  const absentIds = Array.from({ length: 3 }, (_, i) => `absent-${i}`);
  const classroom = buildTestClassroom([...presentIds, ...absentIds]);
  const programme = buildTestProgramme(
    [...presentIds, ...absentIds].map((studentId) => ({ studentId, joinedAt: '2020-01-01T00:00:00.000Z', leftAt: null, status: 'active' }))
  );
  const session = {
    date: '2026-08-19',
    attendance: Object.fromEntries(absentIds.map((id) => [id, { status: 'absent', recordedAt: '2026-08-19T09:00:00.000Z' }])),
    goals: {},
    teacherObservations: {},
  };
  const roster = resolveSessionRoster(classroom, programme, session, false);
  assert.equal(roster.length, 12, 'all 12 real members must appear, not just the 3 with an explicit record');
});

test('resolveSessionRoster (historical): a student who joined AFTER the session date is correctly excluded', () => {
  const classroom = buildTestClassroom(['student-old', 'student-new']);
  const programme = buildTestProgramme([
    { studentId: 'student-old', joinedAt: '2020-01-01T00:00:00.000Z', leftAt: null, status: 'active' },
    { studentId: 'student-new', joinedAt: '2026-09-01T00:00:00.000Z', leftAt: null, status: 'active' },
  ]);
  const session = { date: '2026-08-19', attendance: {}, goals: {}, teacherObservations: {} };
  const roster = resolveSessionRoster(classroom, programme, session, false);
  assert.deepEqual(roster.map((r) => r.student.id), ['student-old']);
});

test('resolveSessionRoster (historical): a student who left BEFORE the session date is correctly excluded', () => {
  const classroom = buildTestClassroom(['student-current', 'student-departed']);
  const programme = buildTestProgramme([
    { studentId: 'student-current', joinedAt: '2020-01-01T00:00:00.000Z', leftAt: null, status: 'active' },
    { studentId: 'student-departed', joinedAt: '2020-01-01T00:00:00.000Z', leftAt: '2026-01-01T00:00:00.000Z', status: 'left' },
  ]);
  const session = { date: '2026-08-19', attendance: {}, goals: {}, teacherObservations: {} };
  const roster = resolveSessionRoster(classroom, programme, session, false);
  assert.deepEqual(roster.map((r) => r.student.id), ['student-current']);
});

test('resolveSessionRoster (editable): unaffected by this round\'s fix — still uses current active membership, unchanged', () => {
  const classroom = buildTestClassroom(['student-1']);
  const programme = buildTestProgramme([{ studentId: 'student-1', joinedAt: '2020-01-01T00:00:00.000Z', leftAt: null, status: 'active' }]);
  const session = { date: getTodayDateKey(), attendance: {}, goals: {}, teacherObservations: {} };
  const roster = resolveSessionRoster(classroom, programme, session, true);
  assert.deepEqual(roster.map((r) => r.student.id), ['student-1']);
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

test('hasRecordedAttendance: distinguishes "never touched" from "explicitly present" — the function itself still correctly makes this distinction, even though no current caller in this file uses it for that purpose anymore (see this file\'s own header comment)', () => {
  const untouched = { attendance: {} };
  const explicitlyPresent = { attendance: { 'student-1': { status: 'present' } } };
  assert.equal(hasRecordedAttendance(untouched, 'student-1'), false);
  assert.equal(hasRecordedAttendance(explicitlyPresent, 'student-1'), true);
  // Both show the same *effective* status regardless — this pins down
  // that hasRecordedAttendance() and getEffectiveAttendanceStatus()
  // remain two genuinely different questions ("was this explicitly
  // recorded" vs. "what should this display as"), even though this
  // round's own fix means only the second one still drives what a
  // historical attendance row actually shows.
  assert.equal(getEffectiveAttendanceStatus(untouched, 'student-1'), getEffectiveAttendanceStatus(explicitlyPresent, 'student-1'));
});

// ---------------------------------------------------------------------
// LEARNING CIRCLE REDESIGN — stats-strip counting functions
// ---------------------------------------------------------------------

test('countAttendanceByStatus: every roster member counts, unset defaults to present', () => {
  const session = { attendance: { s1: { status: 'absent' } } };
  const roster = [{ student: { id: 's1' } }, { student: { id: 's2' } }, { student: { id: 's3' } }];
  const counts = countAttendanceByStatus(session, roster);
  assert.deepEqual(counts, { present: 2, absent: 1, late: 0 });
});

test('countAttendanceByStatus: counts always sum to roster size', () => {
  const session = { attendance: { s1: { status: 'late' }, s2: { status: 'absent' } } };
  const roster = [{ student: { id: 's1' } }, { student: { id: 's2' } }, { student: { id: 's3' } }, { student: { id: 's4' } }];
  const counts = countAttendanceByStatus(session, roster);
  assert.equal(counts.present + counts.absent + counts.late, roster.length);
});

test('countAttendanceByStatus: ATTENDANCE ROSTER BUG FIX — an unrecorded roster member now counts as present, even for a historical (already-corrected) roster, matching "9 Present, 3 Absent" for the 19 August scenario', () => {
  const session = { attendance: { s1: { status: 'absent' } } };
  const roster = [{ student: { id: 's1' } }, { student: { id: 's2' } }, { student: { id: 's3' } }];
  const counts = countAttendanceByStatus(session, roster);
  assert.deepEqual(counts, { present: 2, absent: 1, late: 0 }, 's2/s3 have no explicit record and must count as present, not be silently excluded');
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
