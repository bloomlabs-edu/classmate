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
