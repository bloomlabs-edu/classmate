/**
 * services/studentPortalDataService.js
 *
 * The Student Portal's data source — every view in ui/student-portal/
 * calls through here rather than reading Firestore or hardcoding its
 * own values, so a future change to how this data is computed only
 * ever touches this one file.
 *
 * Live Firestore data, resolved from the current device's remembered
 * profile (see studentDeviceService.js's getLastActiveProfile() —
 * {classroomId, studentId}) via workspaceService.getClassroomOnce(), a
 * direct one-time read matching how resolveStudentJoinCode() and
 * markStudentJoinedPortal() already read for a student device with no
 * Firebase Auth. Every number here is computed with the same
 * studentProgressService.js functions Recognition Wall and Weekly
 * Snapshot already use on the teacher side — reusing existing
 * Firestore-backed logic rather than a parallel calculation, matching
 * this project's stated data philosophy.
 *
 * Every function returns null (not a fabricated number) when there's
 * no remembered profile, no matching classroom, or no matching
 * student — callers render an empty state rather than a fake value.
 */

import * as workspaceService from './workspaceService.js';
import * as studentDeviceService from './studentDeviceService.js';
import * as studentService from './studentService.js';
import * as studentProgressService from './studentProgressService.js';
import { getWeekRange } from '../utils/dateHelpers.js';

async function loadCurrentStudentAndClassroom() {
  const profile = studentDeviceService.getLastActiveProfile();
  if (!profile) return null;

  const classroom = await workspaceService.getClassroomOnce(profile.classroomId);
  if (!classroom) return null;

  const found = studentService.findStudentInClassroom(classroom, profile.studentId);
  if (!found) return null;

  return { classroom, student: found.student, team: found.team };
}

export async function getCurrentStudentProfile() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return null;

  return {
    name: found.student.name,
    classroomName: found.classroom.classroomName,
    groupName: found.team && !found.team.isUngrouped ? found.team.name : null,
    role: 'student',
  };
}

export async function getHomeSummary() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return null;

  const { classroom, student, team } = found;
  const weekRange = getWeekRange();

  const starsThisWeek = studentProgressService.getStarsInRange(classroom, student.id, weekRange);

  let teamName = null;
  let teamRank = null;
  if (team && !team.isUngrouped) {
    teamName = team.name;
    const teamRankings = studentProgressService.getTeamRankInRange(classroom, weekRange);
    const teamEntry = teamRankings.find((entry) => entry.teamId === team.id);
    teamRank = teamEntry ? teamEntry.rank : null;
  }

  const badges = student.badges || [];
  const recognitionCount = badges.length;
  const latestRecognition = badges.length > 0 ? badges[badges.length - 1] : null;

  const journeyStreak = studentProgressService.getBestActiveStreakAcrossNotebooks(classroom, student.id);

  return {
    studentName: student.name,
    classroomName: classroom.classroomName,
    starsThisWeek,
    teamName,
    teamRank,
    recognitionCount,
    latestRecognition,
    journeyStreak,
  };
}

export async function getAchievements() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return [];

  return (found.student.badges || []).map((badgeName) => ({
    id: badgeName,
    label: badgeName,
    earnedOn: null, // individual award dates aren't tracked per-badge yet — see models/Student.js
  }));
}

export async function getTeamSummary() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found || !found.team || found.team.isUngrouped) return null;

  const { classroom, student, team } = found;
  const weekRange = getWeekRange();

  return {
    teamName: team.name,
    teammates: team.students.filter((s) => s.id !== student.id).map((s) => s.name),
    teamStars: studentProgressService.getTeamStarsInRange(classroom, team.id, weekRange),
  };
}
