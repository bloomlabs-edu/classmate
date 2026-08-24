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
 * The roster any Learning Circle screen actually works with: for an
 * editable (today's) session, every currently active member — a
 * teacher (or, per an earlier round, a student themselves) needs to
 * see everyone, including a student with no entry yet. For a
 * read-only (past) session, every student who was genuinely a
 * programme member ON THAT SESSION'S OWN DATE — via
 * learningProgrammeService.getMembersOnDate(), which correctly
 * accounts for membership changing over time (a student who joined
 * after this date, or left before it, is correctly excluded; one who
 * was a member at the time is correctly included regardless of
 * whether anything happened to be recorded for them).
 *
 * CORRECTED THIS ROUND — this used to call a since-removed
 * getSessionParticipantIds(session), which derived the historical
 * roster from the union of attendance/goal/observation record KEYS.
 * Given "Present is the default attendance state" (an explicit,
 * unchanged product requirement — an untouched student writes NO
 * attendance record at all), that approach silently excluded every
 * student who was simply, unremarkably present that day: only a
 * student who was explicitly touched (most commonly, marked absent)
 * ever had a record to be included by. The bug's own visible
 * signature was exactly this: an explicitly-absent student would
 * appear in a historical session's roster; an untouched, actually-
 * present student would not. Membership-on-date has nothing to do
 * with which fields happen to have explicit sub-records, and doesn't
 * have this failure mode.
 *
 * Returns `{ student, team }` pairs, matching every other roster-wide
 * view in this app.
 */
export function resolveSessionRoster(classroom, programme, session, editable) {
  const allStudentsById = new Map(classroom.teams.flatMap((team) => team.students.map((student) => [student.id, { student, team }])));
  const rosterStudentIds = editable
    ? learningProgrammeService.getActiveMembers(programme).map((m) => m.studentId)
    : learningProgrammeService.getMembersOnDate(programme, session.date);
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

/**
 * Whether this student has an actual, explicit attendance entry in
 * this session, as opposed to never having been recorded at all.
 *
 * Left entirely unchanged this round, per explicit instruction — but
 * worth noting plainly: after this round's roster/stats fixes, this
 * function has no remaining internal caller in this file (the two
 * places that used to call it — the historical "Not recorded" row
 * display in ProgrammeAttendanceControls.js, and this file's own
 * countAttendanceByStatus()) both moved to treating an unrecorded
 * student as Present, uniformly, once the roster itself is correctly
 * scoped to genuine membership-on-date. Still exported and still
 * correct as a standalone primitive — kept available deliberately,
 * not left behind by oversight, in case a future need for this exact
 * distinction (explicitly recorded vs. defaulted) comes up again in a
 * different context.
 */
export function hasRecordedAttendance(session, studentId) {
  return Boolean(session.attendance[studentId]);
}

/** What the primary, one-tap control should set a student's status to next — always exactly Present ↔ Absent; Late is only ever set/cleared explicitly. */
export function getToggledAttendanceStatus(currentStatus) {
  return currentStatus === 'present' ? 'absent' : 'present';
}

/**
 * The stats-strip's own attendance tally. Every roster member counts
 * toward some bucket, defaulting an unrecorded student to Present —
 * so the three counts always sum to the roster size, matching
 * "9 Present · 2 Absent · 1 Late" for a 12-student class.
 *
 * CORRECTED THIS ROUND, alongside resolveSessionRoster()'s own fix
 * above — this function used to skip counting an unrecorded student
 * at all for a read-only (historical) session, which was the exact
 * same bug in a different place: given the OLD, buggy historical
 * roster (getSessionParticipantIds(), since removed) already excluded
 * unrecorded students entirely, this function's own skip-guard was
 * layering a second exclusion on top of the first. Now that the
 * roster itself is correctly scoped to genuine membership-on-date
 * (see resolveSessionRoster()), every roster member — editable
 * session or historical — is a real, confirmed participant, and
 * "no record means Present" is simply this product's own explicit,
 * unchanged default, applying uniformly rather than only for today's
 * own session.
 */
export function countAttendanceByStatus(session, roster) {
  const counts = { present: 0, absent: 0, late: 0 };
  roster.forEach(({ student }) => {
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

/** Total observation entries across every student the session mentions — not scoped to the current roster, reading directly from whatever the session's own data already contains. */
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
