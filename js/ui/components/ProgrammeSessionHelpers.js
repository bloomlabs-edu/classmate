/**
 * ui/components/ProgrammeSessionHelpers.js
 *
 * Pure, DOM-free decision/derivation functions shared by every screen
 * that reads a ProgrammeSession — the dashboard overview
 * (ui/views/ProgrammeSessionView.js), and its three drill-in screens
 * (ui/views/ProgrammeAttendanceView.js, ProgrammeGoalsReviewView.js,
 * ProgrammeObservationsView.js). Extracted into their own file this
 * round specifically because more than one screen now needs them —
 * before this round, everything lived in one file and needed no
 * shared home.
 *
 * Every function here is pure and DOM-free by construction, matching
 * this project's own established convention of keeping decision logic
 * unit-testable without a browser wherever possible (see
 * tests/ui/programmeSessionView.test.js, unchanged in spirit, now
 * importing from here instead).
 */

import { getTodayDateKey } from '../../utils/dateHelpers.js';
import * as learningProgrammeService from '../../services/learningProgrammeService.js';

/** A session is editable only if it's today's own session for a programme that hasn't been archived since. */
export function isSessionEditable(session, programme) {
  return session.date === getTodayDateKey() && programme.status !== 'archived';
}

/**
 * Every student this session's own data already mentions — the
 * union of attendance/goal/observation keys — used for the read-only
 * roster of a past session (see models/ProgrammeSession.js's own
 * header comment for why no separate participant-roster field is
 * stored: a session's own recorded data IS its roster).
 */
export function getSessionParticipantIds(session) {
  const ids = new Set([
    ...Object.keys(session.attendance || {}),
    ...Object.keys(session.goals || {}),
    ...Object.keys(session.teacherObservations || {}),
  ]);
  return Array.from(ids);
}

/**
 * The roster any Learning Circle screen actually works with: for an
 * editable (today's) session, every currently active member — a
 * teacher (or, per this round, a student themselves) needs to see
 * everyone, including a student with no entry yet. For a read-only
 * (past) session, only students the session's own data already
 * mentions — never the programme's CURRENT membership list, which
 * could have changed since. Returns `{ student, team }` pairs,
 * matching every other roster-wide view in this app.
 */
export function resolveSessionRoster(classroom, programme, session, editable) {
  const allStudentsById = new Map(classroom.teams.flatMap((team) => team.students.map((student) => [student.id, { student, team }])));
  const rosterStudentIds = editable
    ? learningProgrammeService.getActiveMembers(programme).map((m) => m.studentId)
    : getSessionParticipantIds(session);
  return rosterStudentIds.map((studentId) => allStudentsById.get(studentId)).filter(Boolean);
}

// ---------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------

export const ATTENDANCE_STATUS_META = {
  present: { label: 'Present', icon: '\ud83d\udfe2' },
  absent: { label: 'Absent', icon: '\ud83d\udd34' },
  late: { label: 'Late', icon: '\ud83d\udfe1' },
};

/**
 * The status this screen actually displays for a student, defaulting
 * to 'present' whenever nothing has been recorded yet. NEVER writes
 * anything. This default is only ever appropriate for an EDITABLE
 * (today's own) session — a read-only, historical session must use
 * hasRecordedAttendance() below instead, never default an unrecorded
 * student to "Present," which would misrepresent what actually
 * happened.
 */
export function getEffectiveAttendanceStatus(session, studentId) {
  return session.attendance[studentId]?.status || 'present';
}

/** Whether this student has an actual, explicit attendance entry in this session, as opposed to never having been recorded at all. */
export function hasRecordedAttendance(session, studentId) {
  return Boolean(session.attendance[studentId]);
}

/** What the primary, one-tap control should set a student's status to next — always exactly Present ↔ Absent; Late is only ever set/cleared explicitly. */
export function getToggledAttendanceStatus(currentStatus) {
  return currentStatus === 'present' ? 'absent' : 'present';
}

/**
 * The stats-strip's own attendance tally. For an EDITABLE (today's)
 * session, every roster member counts toward some bucket, defaulting
 * an unrecorded student to Present — so the three counts always sum
 * to the roster size, matching "9 Present · 2 Absent · 1 Late" for a
 * 12-student class. For a READ-ONLY (historical) session, only
 * students with an actual recorded entry are counted at all — an
 * unrecorded roster member contributes to none of the three buckets,
 * exactly matching this project's own "historical data is a record of
 * what happened, never inferred" principle (see
 * hasRecordedAttendance()'s own header comment); totals may not sum
 * to roster.length in that case, and that's correct, not a bug.
 */
export function countAttendanceByStatus(session, roster, editable) {
  const counts = { present: 0, absent: 0, late: 0 };
  roster.forEach(({ student }) => {
    if (!editable && !hasRecordedAttendance(session, student.id)) return;
    const status = getEffectiveAttendanceStatus(session, student.id);
    counts[status] = (counts[status] || 0) + 1;
  });
  return counts;
}

// ---------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------

/** How many roster students have at least one goal recorded in this session — the same number used both in the stats strip and the Daily Goals block's own "X / Y students have goals" summary, deliberately kept as one consistent figure rather than two different counts that could confuse a teacher. */
export function countStudentsWithGoals(session, roster) {
  return roster.filter(({ student }) => Object.keys(session.goals[student.id] || {}).length > 0).length;
}

// ---------------------------------------------------------------------
// Activities / Observations
// ---------------------------------------------------------------------

export function countActivities(session) {
  return session.activities.length;
}

/** Total observation entries across every student the session mentions — not scoped to the current roster, matching getSessionParticipantIds()'s own convention of reading directly from whatever the session's own data already contains. */
export function countObservations(session) {
  return Object.values(session.teacherObservations || {}).reduce((sum, entries) => sum + entries.length, 0);
}

// ---------------------------------------------------------------------
// Student progress (Part 12) — derived purely from an array of
// already-fetched ProgrammeSessions, never a new stored metric.
// ---------------------------------------------------------------------

/**
 * A student's own progress summary across a set of sessions —
 * attendance counts, goals set, and goals completed. Deliberately
 * derives ONLY from data that already exists on each session (no new
 * field, no new stored metric, matching this project's own "derive,
 * don't cache" principle already established for the rest of this
 * app's progress computation — see docs/PROGRESS_ENGINE.md). "Late"
 * counts as attended (the student was there), matching the
 * intuitive meaning of "sessions attended" as distinct from
 * "sessions missed."
 */
export function summarizeStudentProgress(sessions, studentId) {
  const summary = {
    totalSessions: sessions.length,
    sessionsPresent: 0,
    sessionsAbsent: 0,
    sessionsLate: 0,
    goalsSet: 0,
    goalsCompleted: 0,
  };

  sessions.forEach((session) => {
    const attendance = session.attendance[studentId];
    if (attendance?.status === 'present') summary.sessionsPresent += 1;
    else if (attendance?.status === 'absent') summary.sessionsAbsent += 1;
    else if (attendance?.status === 'late') summary.sessionsLate += 1;

    const goals = session.goals[studentId] || {};
    Object.values(goals).forEach((goal) => {
      summary.goalsSet += 1;
      if (goal.outcome === 'completed') summary.goalsCompleted += 1;
    });
  });

  return summary;
}
