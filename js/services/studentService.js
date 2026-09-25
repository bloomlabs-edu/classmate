/**
 * services/studentService.js
 *
 * Operations on the Students that belong to a single Team (see
 * models/Team.js). Students live nested inside `team.students`, so every
 * function here takes the team (or classroom, for cross-team lookups/
 * resets) it should operate on.
 */

import { createStudent } from '../models/Student.js';

export function addStudent(team, name) {
  const student = createStudent({ name });
  team.students.push(student);
  return student;
}

export function renameStudent(team, studentId, newName) {
  const student = team.students.find((s) => s.id === studentId);
  if (student) student.name = newName;
  return student;
}

/**
 * Validates a teacher-typed Roll Number before it's ever applied —
 * required only in the sense that a blank/whitespace-only input is
 * treated as "clear it back to null" (models/Student.js's own
 * documented default), never an error; a non-blank value must be
 * digits only (matching every existing Roll Number convention already
 * in this codebase: services/assessmentImportService.js's own
 * matching logic and this file's own getPassMarkForSubject-style
 * "Sort by Roll Number" in AssessmentManagementView.js both treat it
 * as a short numeric identifier, never free text), and must not
 * already belong to a different student in the same classroom — Roll
 * Numbers are a real-world uniqueness convention within one class,
 * and assessmentImportService.js's own studentsByRollNumber lookup
 * already silently assumes exactly one student per Roll Number.
 *
 * Deliberately kept as a STRING, never coerced to a Number: "01" must
 * stay "01", not become "1" — Roll Number is an identifier, not a
 * mathematical value (see models/Student.js's own header comment).
 *
 * `students` is every student already in the classroom (any team);
 * `currentStudentId` is excluded from the duplicate check so re-saving
 * a student's own unchanged Roll Number never flags itself.
 */
export function validateRollNumberInput(rawValue, students, currentStudentId) {
  const trimmed = String(rawValue ?? '').trim();
  if (trimmed === '') return { valid: true, value: null, error: null };

  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, value: null, error: 'Roll number must contain digits only.' };
  }

  const duplicate = students.find((s) => s.id !== currentStudentId && s.rollNumber === trimmed);
  if (duplicate) {
    return { valid: false, value: null, error: `Roll number ${trimmed} is already assigned to another student.` };
  }

  return { valid: true, value: trimmed, error: null };
}

/**
 * Sets a student's own Roll Number — the one place this field is ever
 * written (see models/Student.js's own header comment: "currently
 * only read, not written, anywhere in the UI" — this is that
 * follow-up). Student-level, not Assessment-level: this is the same
 * `student.rollNumber` every existing reader (Assessment Management's
 * Gradebook, its own "Sort by Roll Number", assessmentImportService.js's
 * own matching) already reads, so a change here is immediately visible
 * everywhere that student appears — there is exactly one Roll Number
 * per student, never a second, Assessment-scoped copy of it.
 *
 * Callers are expected to have already validated via
 * validateRollNumberInput() above; this function only applies
 * `value`, it does not re-validate.
 */
export function setStudentRollNumber(classroom, studentId, value) {
  const found = findStudentInClassroom(classroom, studentId);
  if (!found) return null;
  found.student.rollNumber = value;
  return found.student;
}

export function removeStudent(team, studentId) {
  const before = team.students.length;
  team.students = team.students.filter((student) => student.id !== studentId);
  return team.students.length < before;
}

/**
 * Moves a student from one team to another within the same classroom —
 * the capability this app was missing entirely until now (only
 * rename and remove existed; a student could never be reassigned to
 * a different group once created, other than being removed and
 * re-added to Ungrouped by name, losing their score/badges/history in
 * the process). Everything about the student — score, badges,
 * history, bucket — is untouched; only which team's `students` array
 * they live in changes.
 */
export function moveStudentToTeam(classroom, fromTeamId, studentId, toTeamId) {
  const fromTeam = classroom.teams.find((t) => t.id === fromTeamId);
  const toTeam = classroom.teams.find((t) => t.id === toTeamId);
  if (!fromTeam || !toTeam || fromTeamId === toTeamId) return null;

  const studentIndex = fromTeam.students.findIndex((s) => s.id === studentId);
  if (studentIndex === -1) return null;

  const [student] = fromTeam.students.splice(studentIndex, 1);
  toTeam.students.push(student);
  return student;
}

/** Finds a student by id across every team in a classroom. */
export function findStudentInClassroom(classroom, studentId) {
  for (const team of classroom.teams) {
    const student = team.students.find((s) => s.id === studentId);
    if (student) return { student, team };
  }
  return null;
}

/** Zeroes every student's score across every team in a classroom. */
export function resetAllScores(classroom) {
  console.log('[SCORE-WRITE] studentService.resetAllScores() called', {
    timestamp: new Date().toISOString(),
    classroomId: classroom.id,
    note: 'no longer called by TrackerView\'s own header button (see the Reset Scoreboard workflow instead) — kept intact per explicit instruction, unused-but-not-deleted',
  });
  classroom.teams.forEach((team) => {
    team.students.forEach((student) => {
      student.score = 0;
    });
  });
}

/**
 * A genuinely comprehensive reset — clears every field a "stat" is
 * computed from, not just the score `resetAllScores` above touches.
 * `history` in particular is what Recognition Wall, streaks, and
 * Weekly Snapshot are actually computed from (see
 * services/studentProgressService.js) — clearing only `score` (as the
 * existing Reset Session action does) leaves all of that still
 * reading old data, which is exactly the gap this function exists to
 * close. Bucket assignment is included too: not a "stat" in the same
 * sense as score/badges, but part of "start this classroom from zero"
 * as it was actually requested.
 *
 * Deliberately does NOT touch classroom structure/configuration —
 * teams, student names, notebookConfig, learningActivities'
 * definitions, or classroom.settings all survive this untouched; only
 * per-student accumulated data is cleared. Clearing
 * classroom.notebooks (a classroom-level field, not per-student) is a
 * separate call — see services/notebookService.js's
 * clearAllNotebookData().
 */
export function resetAllStudentData(classroom) {
  classroom.teams.forEach((team) => {
    team.students.forEach((student) => {
      student.score = 0;
      student.bucket = null;
      student.badges = [];
      student.notes = [];
      student.submissions = {};
      student.history = [];
    });
  });
}
