/**
 * services/studentPortalDataService.js
 *
 * The Student Portal's data source — every view in ui/student-portal/
 * calls through here rather than reading Firestore or hardcoding its
 * own values, so a future change to how this data is computed only
 * ever touches this one file.
 *
 * Live Firestore data, resolved from the current device's active
 * profile (see studentDeviceService.js's trusted-device model —
 * getActiveProfile() returns {classroomId, studentId}) via
 * workspaceService.getClassroomOnce(), a direct one-time read matching
 * how resolveStudentJoinCode() and markStudentJoinedPortal() already
 * read for a student device with no Firebase Auth. Every number here
 * is computed with the same studentProgressService.js functions
 * Recognition Wall and Weekly Snapshot already use on the teacher
 * side — reusing existing Firestore-backed logic rather than a
 * parallel calculation, matching this project's stated data
 * philosophy.
 *
 * Every function returns null (not a fabricated number) when there's
 * no active profile, no matching classroom, or no matching student —
 * callers render an empty state rather than a fake value.
 */

import * as workspaceService from './workspaceService.js';
import * as studentDeviceService from './studentDeviceService.js';
import * as studentService from './studentService.js';
import * as studentProgressService from './studentProgressService.js';
import * as studentEventService from './studentEventService.js';
import * as assessmentService from './assessmentService.js';
import { getWeekRange } from '../utils/dateHelpers.js';
import { listRecognitionCategoriesForPeriod } from '../config/recognitionCategories.js';

/**
 * Resolves the classroom/student/team for a given student profile
 * reference — defaults to whatever's currently active on this device
 * (studentDeviceService.getActiveProfile()), but accepts an explicit
 * one too, so a caller can validate a profile *before* committing to
 * it as active (see
 * ui/student-portal/onboarding/StudentDeviceFlow.js's startup
 * validation, which checks a profile is still real before ever
 * calling setActiveProfile() on it).
 *
 * Returns null — never throws, never fabricates a value — for a
 * missing profile, a deleted classroom, or a student no longer on the
 * roster. This is the one place both "get today's data" and "is this
 * stale session still valid" share the same real check, rather than
 * two separate implementations that could drift apart.
 */
export async function loadCurrentStudentAndClassroom(profile = studentDeviceService.getActiveProfile()) {
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
    studentId: found.student.id,
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
    studentId: student.id,
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

/**
 * The Recognition Wall, from the student's own point of view — a
 * genuinely different thing from getAchievements() above. Achievements
 * are manually-awarded Behaviour Badges (Helper, Team Player, ...);
 * this is "did I (or my team, for Team Champion) win one of the
 * computed weekly recognition categories?" — the same categories and
 * the same getRecognitionWinners() the teacher-side Recognition Wall
 * already uses (see config/recognitionCategories.js,
 * studentProgressService.js). Deliberately week-scoped only, matching
 * the rest of this file's weekly framing.
 *
 * Returns raw structured data only (category metadata plus the
 * winner's own fields) — formatting the "how much" statistic into a
 * display string is left to the UI layer (see
 * ui/components/RecognitionCard.js's formatKeyStatistic()), matching
 * this project's stated rule that services never own display
 * formatting.
 */
export async function getRecognitionWins() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return [];

  const { classroom, student, team } = found;

  const wins = [];
  listRecognitionCategoriesForPeriod('week').forEach((category) => {
    const winners = studentProgressService.getRecognitionWinners(classroom, category.id, 'week');
    const isTeamCategory = category.resolverId === 'team_stars';

    const mine = isTeamCategory
      ? team && !team.isUngrouped && winners.find((winner) => winner.teamId === team.id)
      : winners.find((winner) => winner.studentId === student.id);

    if (mine) {
      wins.push({ category, winner: mine });
    }
  });

  return wins;
}

/**
 * The Student Event Feed — the "Your Updates" timeline on Student
 * Home (see ui/student-portal/views/StudentJourneyView.js). Newest
 * first; sorting is services/studentEventService.js's own job, not
 * repeated here.
 */
export async function getEventFeed() {
  // TEMPORARY DIAGNOSTIC — see this project's own Student Event Feed
  // investigation. Traces every step of this function's own
  // resolution chain, so a caller can see exactly where (if anywhere)
  // the data stops matching what was persisted.
  const activeProfile = studentDeviceService.getActiveProfile();
  console.log('[EventFeedDiagnostic] getEventFeed() called. Active profile:', activeProfile);

  const found = await loadCurrentStudentAndClassroom();
  if (!found) {
    console.log('[EventFeedDiagnostic] loadCurrentStudentAndClassroom() returned null \u2014 no active profile, no matching classroom, or no matching student. Feed is empty for this reason alone.');
    return [];
  }

  console.log('[EventFeedDiagnostic] Resolved classroom id:', found.classroom.id);
  console.log('[EventFeedDiagnostic] Resolved student id:', found.student.id);
  console.log('[EventFeedDiagnostic] Total events on this classroom (before filtering by student):', found.classroom.studentEvents?.length ?? 0);

  const events = studentEventService.getEventsForStudent(found.classroom, found.student.id);
  console.log('[EventFeedDiagnostic] Events remaining after filtering for this student:', events.length);

  return events;
}

/**
 * The first implementation of this app's permanent event-navigation
 * pattern (see ui/student-portal/views/StudentJourneyView.js's own
 * EVENT_DETAIL_ROUTES header comment for the full shape this
 * establishes): a StudentEvent's payload carries only an id
 * (`assessmentId`); this function is what turns that id into the
 * current student's own view of that Assessment, read fresh from the
 * live classroom every time it's called — never from the event
 * itself, which only ever carried a pointer.
 *
 * Reuses assessmentService entirely — getAssessmentById(),
 * getStudentResult(), getSubjectTitle() are the exact same functions
 * the teacher-side editor (ui/views/AssessmentManagementView.js) and
 * the importer (services/assessmentImportService.js) already call.
 * No assessment logic is duplicated here; this is purely a
 * student-scoped read shaped for this one screen, the same role every
 * other function in this file already plays for its own screen.
 *
 * Returns null (never throws) for a missing profile/classroom/student
 * — the existing convention — and also for an assessmentId that no
 * longer resolves to a real Assessment (e.g. deleted after the event
 * was published), so a stale or broken link degrades to a real empty
 * state rather than a crash.
 */
export async function getAssessmentResultsForCurrentStudent(assessmentId) {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return null;

  const { classroom, student } = found;
  const assessment = assessmentService.getAssessmentById(classroom, assessmentId);
  if (!assessment) return null;

  const subjects = assessment.assessmentSubjects.map((assessmentSubject) => {
    const result = assessmentService.getStudentResult(assessmentSubject, student.id);
    return {
      subjectTitle: assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId),
      marks: result ? result.marks : null, // null covers both "no result recorded yet" and "recorded but marks itself is null" identically — both mean "not yet published" to the student
      maximumMarks: assessmentSubject.maximumMarks,
    };
  });

  return {
    title: assessment.title,
    type: assessment.type,
    date: assessment.date,
    academicYear: assessment.academicYear,
    subjects,
  };
}

export async function getTeamSummary() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found || !found.team || found.team.isUngrouped) return null;

  const { classroom, student, team } = found;
  const weekRange = getWeekRange();

  // Every real team's rank this week (Ungrouped is deliberately
  // excluded — same reasoning as GroupsWidget.js and the Dashboard's
  // Groups section: it isn't a group a teacher organized, so it
  // doesn't belong in a "classroom leaderboard" of teams).
  const classroomLeaderboard = studentProgressService
    .getTeamRankInRange(classroom, weekRange)
    .filter((entry) => {
      const entryTeam = classroom.teams.find((t) => t.id === entry.teamId);
      return entryTeam && !entryTeam.isUngrouped;
    });

  const myLeaderboardEntry = classroomLeaderboard.find((entry) => entry.teamId === team.id);

  const members = team.students
    .map((teammate) => ({
      studentId: teammate.id,
      name: teammate.name,
      isSelf: teammate.id === student.id,
      stars: studentProgressService.getStarsInRange(classroom, teammate.id, weekRange),
    }))
    .sort((a, b) => b.stars - a.stars);

  return {
    teamName: team.name,
    teamStars: myLeaderboardEntry ? myLeaderboardEntry.stars : studentProgressService.getTeamStarsInRange(classroom, team.id, weekRange),
    teamRank: myLeaderboardEntry ? myLeaderboardEntry.rank : null,
    members,
    classroomLeaderboard,
  };
}
