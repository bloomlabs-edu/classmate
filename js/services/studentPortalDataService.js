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
import { firestoreClassroomRepository as repository } from '../repositories/firestoreClassroomRepository.js';
import * as studentDeviceService from './studentDeviceService.js';
import * as studentService from './studentService.js';
import * as studentProgressService from './studentProgressService.js';
import * as timelineService from './timelineService.js';
import * as studentEventService from './studentEventService.js';
import * as assessmentService from './assessmentService.js';
import * as workRequestService from './workRequestService.js';
import * as notebookConfigService from './notebookConfigService.js';
import * as goalService from './goalService.js';
import * as studentGoalsService from './studentGoalsService.js';
import * as learningRecordStudentService from './learningRecordStudentService.js';
import * as goalStatisticsService from './goalStatisticsService.js';
import * as teamStatisticsService from './teamStatisticsService.js';
import * as plannerRepository from './plannerRepository.js';
import * as studentAuthService from './studentAuthService.js';
import * as conceptRecordsRepository from '../repositories/firestoreStudentConceptRecordsRepository.js';
import { hydrateConceptRecordsForStudent } from './conceptRecordHydrationService.js';
import { getFeedbackEligibleConceptIds } from '../models/Lesson.js';
import { createStudentConceptRecord } from '../models/StudentConceptRecord.js';
import { getWeekRange } from '../utils/dateHelpers.js';
import { listRecognitionCategoriesForPeriod } from '../config/recognitionCategories.js';

/**
 * The Student Portal's own single, permanent live classroom
 * subscription (see Milestone 2's own architecture note: one live
 * subscription, owned once, every page a pure consumer of it —
 * mirrors workspaceService.js's own module-level
 * classroomSubscriptions pattern for the teacher side, since the
 * Student Portal's own shell is torn down and rebuilt on every
 * navigation and can never itself hold a subscription that survives
 * across renders). `liveClassroom` is the latest known snapshot for
 * `subscribedClassroomId`; `null` means the document doesn't exist (or
 * this device lost access to it), matching
 * repository.subscribeToClassroom()'s own contract.
 */
let subscribedClassroomId = null;
let liveClassroom = null;
let unsubscribeFromLiveClassroom = null;
let onLiveUpdateCallback = null;

// STAGE 1 ADDITION (notification architecture audit, Section E) — the
// student notification bell's own live read state, started/stopped
// alongside the classroom subscription above rather than as a third,
// separately-tracked lifecycle: both only ever make sense for exactly
// "the classroom this profile's Student Portal session is currently
// showing," so they share that same start/stop moment. See
// services/studentEventService.js's own subscribeToReadStateForCurrentStudent().
let liveReadState = { readEventIds: [] };
let unsubscribeFromReadState = null;

/**
 * Starts (or reuses) the live subscription for `classroomId` — a
 * no-op if already subscribed to this exact classroom (idempotent, so
 * every navigation within the portal can safely call this without
 * ever creating a second listener). Resolves once the first real
 * snapshot has arrived, so a caller never renders before live data
 * actually exists; every snapshot after the first calls `onUpdate`
 * directly, mirroring how the teacher side's own onChange callback
 * already triggers a renderRoute() re-run on every classroom update.
 */
export function startClassroomSubscription(classroomId, onUpdate) {
  onLiveUpdateCallback = onUpdate;

  if (subscribedClassroomId === classroomId) return Promise.resolve();

  stopClassroomSubscription();
  subscribedClassroomId = classroomId;

  // Started alongside the classroom subscription below, not awaited by
  // it — a student's own read state has nothing to do with whether the
  // classroom's own first snapshot has arrived yet (see this file's
  // own Promise below, which resolves purely on that). Every update
  // here also triggers onLiveUpdateCallback, same as a classroom
  // snapshot does, so the bell's own badge stays live without needing
  // its own separate render trigger.
  unsubscribeFromReadState = studentEventService.subscribeToReadStateForCurrentStudent(
    (readState) => {
      liveReadState = readState;
      onLiveUpdateCallback?.();
    },
    (error) => console.error('[studentPortalDataService] Read-state subscription failed:', error)
  );

  return new Promise((resolve) => {
    let isFirstSnapshot = true;
    unsubscribeFromLiveClassroom = repository.subscribeToClassroom(classroomId, (classroomData) => {
      // TEMPORARY DIAGNOSTIC — investigating why a just-submitted LSRW
      // goal's own "Submitted" state reverts to an empty entry form in
      // the real browser. This is the one spot in the whole render
      // chain with zero prior visibility: every snapshot this
      // subscription receives replaces liveClassroom wholesale, and
      // this log is the only way to see, directly, what that snapshot
      // actually contained for a specific goal category at the exact
      // moment it arrived — including whether it arrives mid-submission.
      try {
        const activeStudentId = studentDeviceService.getActiveProfile()?.studentId;
        const activeCycle = (classroomData.goalCycles || []).find((c) => c.status === 'active');
        const listeningCategory = activeCycle?.categories.find((c) => c.name === 'Listening');
        const listeningGoal = listeningCategory
          ? activeCycle.goals.find((g) => g.categoryId === listeningCategory.id && g.studentId === activeStudentId)
          : null;
        console.log('[LSRW-DIAG] startClassroomSubscription() SNAPSHOT RECEIVED — liveClassroom is about to be REPLACED', {
          timestamp: Date.now(),
          isFirstSnapshot,
          activeStudentId,
          activeCycleId: activeCycle?.id,
          listeningCategoryId: listeningCategory?.id,
          anyListeningGoalExistsInThisSnapshot: !!listeningGoal,
          listeningGoalText: listeningGoal?.text,
          listeningGoalStatus: listeningGoal?.status,
        });
      } catch (diagError) {
        console.log('[LSRW-DIAG] startClassroomSubscription() diagnostic logging itself failed (non-fatal, does not affect real behavior)', diagError);
      }
      liveClassroom = classroomData;
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        resolve();
      } else {
        console.log('[LSRW-DIAG] startClassroomSubscription() calling onLiveUpdateCallback() — this triggers renderRoute(..., "student-portal-live-update")', { timestamp: Date.now() });
        onLiveUpdateCallback?.();
      }
    });
  });
}

/** Tears down the live subscription entirely — called when leaving the Student Portal (back to landing) or switching to a different device profile, so no listener keeps firing after nothing is looking at it. */
export function stopClassroomSubscription() {
  unsubscribeFromLiveClassroom?.();
  unsubscribeFromLiveClassroom = null;
  subscribedClassroomId = null;
  liveClassroom = null;

  unsubscribeFromReadState?.();
  unsubscribeFromReadState = null;
  liveReadState = { readEventIds: [] };
}

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

  // Use the live, subscribed snapshot only when resolving the
  // device's own currently-active profile — compared by value
  // (classroomId + studentId), never by reference, since
  // getActiveProfile() parses localStorage fresh on every call and
  // never returns the same object twice. Any other profile (e.g.
  // StudentDeviceFlow.js validating a profile that isn't active yet)
  // still gets a genuine fresh read, since the live subscription is
  // only ever scoped to one classroom at a time.
  const activeProfile = studentDeviceService.getActiveProfile();
  const isActiveProfile =
    activeProfile && activeProfile.classroomId === profile.classroomId && activeProfile.studentId === profile.studentId;

  const classroom =
    isActiveProfile && subscribedClassroomId === profile.classroomId
      ? liveClassroom
      : await workspaceService.getClassroomOnce(profile.classroomId);
  if (!classroom) return null;

  const found = studentService.findStudentInClassroom(classroom, profile.studentId);
  if (!found) return null;

  return { classroom, student: found.student, team: found.team };
}

export async function getCurrentStudentProfile() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return null;

  const { classroom, student } = found;
  const period = teamStatisticsService.getCurrentMonthPeriod();
  const classEntry = teamStatisticsService.getClassLeaderboardWithMovement(classroom, period).find((e) => e.studentId === student.id);

  return {
    studentId: student.id,
    name: student.name,
    classroomName: found.classroom.classroomName,
    groupName: found.team && !found.team.isUngrouped ? found.team.name : null,
    role: 'student',
    bucket: found.student.bucket, // reused directly from the Student model — see config/bucketConfig.js for the shared color/label mapping every screen (teacher and student) reads from
    totalStars: timelineService.getTotalPositivePoints(student),
    badgeCount: (student.badges || []).length,
    currentStreak: studentProgressService.getBestActiveStreakAcrossNotebooks(classroom, student.id),
    biggestClimb: classEntry && classEntry.movement === 'up' ? classEntry.movementAmount : 0,
    recentEvents: studentEventService.getEventsForStudent(classroom, student.id).slice(0, 3),
    weeklyNetPoints: studentProgressService.getWeeklyNetPoints(classroom, student.id),
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

/**
 * The current session's own weekly net points — see
 * services/studentProgressService.js's own getWeeklyNetPoints() for
 * the real, shared implementation every profile screen showing this
 * graph uses. This wrapper's only job is resolving "who is the
 * current student," matching every other session-scoped function in
 * this file.
 */
export async function getWeeklyNetPoints() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return [];

  return studentProgressService.getWeeklyNetPoints(found.classroom, found.student.id);
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

// --- Stage 1: notification bell (see ui/student-portal/components/StudentNotificationBell.js) ---
// Deliberately separate from getEventFeed() above, which stays exactly
// as it was — the always-visible "Your Updates" timeline has no
// concept of unread/read at all and must keep not needing one.

const BELL_RECENT_LIMIT = 20;

/** The current student's own unread StudentEvent count — live, backed by the exact same two subscriptions startClassroomSubscription() above already maintains (classroom content + read state). */
export async function getUnreadEventCount() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return 0;

  const events = studentEventService.getEventsForStudent(found.classroom, found.student.id);
  return studentEventService.countUnread(events, liveReadState.readEventIds);
}

/**
 * Same as getUnreadEventCount() above, scoped to one category — for a
 * Bento card (see StudentJourneyView.js) that wants to know "how many
 * of MY unread notifications are specifically about this feature,"
 * not the bell's own total. Reuses the exact same live classroom +
 * read-state data getUnreadEventCount() does (no new listener, no
 * second read) — only the filtering differs.
 */
export async function getUnreadEventCountByCategory(category) {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return 0;

  const events = studentEventService
    .getEventsForStudent(found.classroom, found.student.id)
    .filter((event) => event.category === category);
  return studentEventService.countUnread(events, liveReadState.readEventIds);
}

/** The bell popover's own recent list — the same events getEventFeed() would return, capped and each annotated with isUnread, computed against the same live read state getUnreadEventCount() above uses. Never affects, and is never affected by, "Your Updates" itself. */
export async function getRecentEventsForBell() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return [];

  const events = studentEventService.getEventsForStudent(found.classroom, found.student.id).slice(0, BELL_RECENT_LIMIT);
  const readSet = new Set(liveReadState.readEventIds);
  return events.map((event) => ({ ...event, isUnread: !readSet.has(event.id) }));
}

/** Marks one event read for the current student — see studentEventService.js's own markEventReadForCurrentStudent(). */
export async function markEventRead(eventId) {
  return studentEventService.markEventReadForCurrentStudent(eventId);
}

/** Marks several events read at once — the bell's own dwell-to-read behavior. */
export async function markEventsRead(eventIds) {
  return studentEventService.markEventsReadForCurrentStudent(eventIds);
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

/**
 * Resolves a `concept_feedback_available` StudentEvent's own `lessonId`
 * pointer (see config/studentEventNavigation.js) into the current
 * student's own view of it — read fresh from the live Lesson document
 * every time this is called, never from the event itself, which only
 * ever carried the pointer (same principle getAssessmentResultsForCurrentStudent()
 * above already follows for assessmentId).
 *
 * Returns only the currently-EXECUTED concept ids (models/Lesson.js's
 * own getFeedbackEligibleConceptIds()) — a concept carried forward out
 * of this Lesson after the event was published, or never executed at
 * all, is correctly excluded even if it was in `conceptIds`. Returns
 * null (never throws) for a missing profile/classroom, a Lesson that
 * no longer exists, or one with nothing executed yet — a stale or
 * early-tapped link degrades to a real empty state, matching this
 * file's own established convention.
 */
export async function getConceptFeedbackForLesson(lessonId) {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return null;

  const { classroom, student } = found;

  // Phase N fix — a real student device's DEFAULT app is never signed
  // in (see plannerRepository.getLessonById()'s own header comment),
  // so this Lesson read must go through the student's own per-slot
  // instance, same as every other student-side write/read in this
  // file, or firestore.rules's own lessons/{lessonId} read rule
  // (request.auth != null) always denies it in production.
  const slotIndex = studentDeviceService.getSlotForStudent(student.id);
  if (slotIndex === null) return null;
  const studentDb = studentAuthService.getFirestoreForSlot(slotIndex);
  await studentAuthService.ensureAnonymousSignIn(slotIndex);

  const lesson = await plannerRepository.getLessonById(classroom.id, lessonId, studentDb);
  if (!lesson) return null;

  const conceptIds = getFeedbackEligibleConceptIds(lesson);
  if (conceptIds.length === 0) return null;

  // Phase N — overlays this student's own real studentConceptRecords
  // documents onto student.learningRecord before
  // ConceptFeedbackFlowView.js reads it, so a concept this student
  // already responded to (on a previous visit, possibly from a
  // different device session) shows its real current selection rather
  // than a stale/default one. See services/conceptRecordHydrationService.js's
  // own header comment for the full fallback order this participates in.
  await hydrateConceptRecordsForStudent(classroom, student);

  // classroom/student are returned alongside conceptIds so
  // ui/student-portal/views/ConceptFeedbackFlowView.js doesn't need a
  // second loadCurrentStudentAndClassroom() call right after this one.
  return { conceptIds, classroom, student };
}

/**
 * One student's own view of the active Goal Cycle — every category,
 * whether they have a goal for it yet (and its own approval status
 * and, once approved, its own live statistics), or null if they don't.
 * Reuses goalService/goalStatisticsService entirely; this function
 * only shapes their combined output for this one screen, the same
 * role every other function in this file already plays.
 */
/**
 * One classmate's own public profile — for an arbitrary `studentId`,
 * never "current student." Header stats, recognition, and current
 * goals, composed entirely from existing services:
 * teamStatisticsService.js (rank/score), studentEventService.js
 * (timeline), goalService.js/goalStatisticsService.js (current
 * goals) — none of their own math is duplicated here, only shaped for
 * this one screen, the same role every other function in this file
 * already plays.
 *
 * Deliberately reusable, not coupled to how it was reached: Team
 * Standings, a future Community Feed, Recognition cards, and future
 * leaderboards can all call this with just a studentId. Returns null
 * (never throws) if the student can't be found on the current live
 * classroom.
 */
export async function getPublicProfileForStudent(studentId) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return null;

  const classroom = subscribedClassroomId === activeProfile.classroomId ? liveClassroom : await workspaceService.getClassroomOnce(activeProfile.classroomId);
  if (!classroom) return null;

  const found = studentService.findStudentInClassroom(classroom, studentId);
  if (!found) return null;
  const { student, team } = found;

  const period = teamStatisticsService.getCurrentMonthPeriod();
  const classEntry = teamStatisticsService.getClassLeaderboard(classroom, period).find((e) => e.studentId === studentId);
  const teamEntry = team && !team.isUngrouped
    ? teamStatisticsService.getTeamLeaderboard(classroom, team.id, period).find((e) => e.studentId === studentId)
    : null;

  const badges = student.badges || [];
  const latestBadgeEntry = (student.history || [])
    .filter((entry) => entry.kind === 'badge')
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];

  const activeCycle = goalService.getActiveCycle(classroom);
  const currentGoals = activeCycle
    ? goalService.getGoalsForStudent(activeCycle, studentId).map((goal) => ({
        categoryName: activeCycle.categories.find((c) => c.id === goal.categoryId)?.name || 'Goal',
        text: goal.text,
        status: goal.status,
        currentStreak: goal.status === 'approved' ? goalStatisticsService.getCurrentStreak(activeCycle, goal.id) : 0,
        overallCompletionPercent: goal.status === 'approved' ? goalStatisticsService.getOverallCompletionPercent(activeCycle, goal.id) : 0,
      }))
    : [];

  return {
    studentId: student.id,
    name: student.name,
    bucket: student.bucket,
    teamName: team ? team.name : null,
    monthlyScore: classEntry ? classEntry.score : 0,
    classRank: classEntry ? classEntry.rank : null,
    teamRank: teamEntry ? teamEntry.rank : null,
    badgeCount: badges.length,
    latestBadgeName: latestBadgeEntry ? latestBadgeEntry.label : null,
    events: studentEventService.getEventsForStudent(classroom, studentId),
    currentGoals,
    weeklyNetPoints: studentProgressService.getWeeklyNetPoints(classroom, studentId),
  };
}

/**
 * The Journey page's own "alerts" panel — pending notebook
 * submissions and upcoming published tests, for whichever student is
 * currently active. Deliberately just a thin combination of two
 * existing, already-correct reads (workRequestService.js's own
 * getNotebookObligationsForStudent(), assessmentService.js's own
 * getUpcomingAssessments()) — no new derivation logic, no duplicate
 * status/date rules.
 */
export async function getAlertsForCurrentStudent() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return { pendingSubmissions: [], upcomingAssessments: [] };

  const pendingSubmissions = workRequestService
    .getNotebookObligationsForStudent(found.classroom, found.student.id)
    .filter((obligation) => obligation.isOpen && obligation.status !== 'reviewed')
    .map((obligation) => {
      const subject = notebookConfigService.getSubjectById(found.classroom, obligation.subjectId);
      const notebookType = notebookConfigService.getNotebookTypeById(found.classroom, obligation.notebookTypeId);
      return {
        requestId: obligation.requestId,
        label: [subject?.name, notebookType?.name].filter(Boolean).join(' \u00b7 ') || obligation.title,
        dueDate: obligation.dueDate,
      };
    });

  const upcomingAssessments = assessmentService.getUpcomingAssessments(found.classroom).map((assessment) => ({
    id: assessment.id,
    title: assessment.title,
    date: assessment.date,
  }));

  return { pendingSubmissions, upcomingAssessments };
}

export async function getGoalCycleForCurrentStudent() {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return null;

  const cycle = goalService.getActiveCycle(found.classroom);
  if (!cycle) return null;

  const categories = goalService.listCategories(cycle).map((category) => {
    const goal = goalService.getGoalForStudent(cycle, category.id, found.student.id);
    return {
      categoryId: category.id,
      categoryName: category.name,
      goal: goal
        ? {
            id: goal.id,
            text: goal.text,
            status: goal.status,
            completedToday: goalStatisticsService.isCompletedToday(cycle, goal.id),
            currentStreak: goalStatisticsService.getCurrentStreak(cycle, goal.id),
            longestStreak: goalStatisticsService.getLongestStreak(cycle, goal.id),
            weeklyCompletionPercent: goalStatisticsService.getWeeklyCompletionPercent(cycle, goal.id),
            overallCompletionPercent: goalStatisticsService.getOverallCompletionPercent(cycle, goal.id),
          }
        : null,
    };
  });

  return {
    cycleId: cycle.id,
    cycleTitle: cycle.title,
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    categories,
  };
}

/** Creates or updates this student's own pending goal for one category — refuses silently (returns false) if that goal is already approved, matching goalService.submitGoal()'s own "cannot edit once approved" rule. */
export async function submitGoalForCurrentStudent(categoryId, text) {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return false;

  const cycle = goalService.getActiveCycle(found.classroom);
  if (!cycle) return false;

  const result = goalService.submitGoal(cycle, categoryId, found.student.id, text);
  if (!result) return false;

  workspaceService.save(found.classroom);
  return true;
}

/** Ticks or unticks one day's completion for one of this student's own approved goals. */
export async function setGoalCompletionForCurrentStudent(goalId, dateKey, completed) {
  // Delegates to studentGoalsService.js's own setCompletionForCurrentStudent()
  // — a scoped write to this one goal's own document, via the
  // student's own per-slot Firestore instance. The previous
  // implementation here mutated the old, deprecated
  // cycle.completions{} shape and called workspaceService.saveExplicitly()
  // on the ENTIRE classroom document — a write a student's own
  // anonymous identity was never permitted to make at all, which is
  // exactly the real "Missing or insufficient permissions" error
  // this was rewired to fix.
  return studentGoalsService.setCompletionForCurrentStudent(goalId, dateKey, completed);
}

/**
 * A student self-reporting their own understanding of a concept.
 *
 * Phase N rewrite: no longer saves the whole classroom document (see
 * setGoalCompletionForCurrentStudent()'s own header comment on exactly
 * this same class of bug) — a real anonymous student device was never
 * actually permitted to do that under firestore.rules's own
 * classrooms/{classroomId} update rule (request.auth.uid in
 * memberUids), which this project's own Phase M end-to-end emulator
 * test confirmed fails with a genuine PERMISSION_DENIED. Writes
 * instead through this student's own per-slot Firestore instance to
 * their own dedicated classrooms/{id}/studentConceptRecords/{uid}_{conceptId}
 * document — see repositories/firestoreStudentConceptRecordsRepository.js
 * (uid-keyed, not studentId-keyed — see that file's own header comment
 * on why) and firestore.rules's own new match block for that collection.
 *
 * Still mutates the in-memory record via learningRecordStudentService's
 * own real setUnderstanding() first — no second implementation of that
 * logic — purely so this session's own immediately-rendered UI (e.g.
 * ConceptFeedbackFlowView.js's own optimistic re-render) reflects the
 * change without waiting on a fresh hydration round-trip. That mutation
 * is never itself persisted via workspaceService — the repository call
 * below is the only durable write.
 */
export async function setUnderstandingForCurrentStudent(conceptId, understanding) {
  const found = await loadCurrentStudentAndClassroom();
  if (!found) return false;

  const slotIndex = studentDeviceService.getSlotForStudent(found.student.id);
  if (slotIndex === null) return false;

  const updatedRecord = learningRecordStudentService.setUnderstanding(found.student, conceptId, understanding);

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  try {
    const existing = await conceptRecordsRepository.findRecord(db, found.classroom.id, uid, conceptId);
    if (existing) {
      await conceptRecordsRepository.updateUnderstanding(db, found.classroom.id, uid, conceptId, {
        understanding: updatedRecord.understanding,
        updatedAt: updatedRecord.updatedAt,
      });
    } else {
      // Always the model's own true defaults here, never
      // updatedRecord.notebook/.helpRequested — those could carry a
      // stale legacy value forward via setUnderstanding()'s own
      // {...existing} spread (see learningRecordStudentService.js) if
      // this session's in-memory student object happened to already
      // hold one, e.g. from the old embedded classroom.teams[].students[].learningRecord
      // field. A student's FIRST-ever create must match
      // firestore.rules's own create rule exactly (notebook ==
      // 'not_required', helpRequested == false) — reconciling a real
      // legacy notebook value into the new collection, if one ever
      // exists, is the migration script's job, not this live write path's.
      const defaults = createStudentConceptRecord();
      await conceptRecordsRepository.createRecord(db, {
        classroomId: found.classroom.id,
        studentId: found.student.id,
        conceptId,
        uid,
        understanding: updatedRecord.understanding,
        notebook: defaults.notebook,
        helpRequested: defaults.helpRequested,
        updatedAt: updatedRecord.updatedAt,
      });
    }
  } catch (error) {
    console.error('[studentPortalDataService] setUnderstandingForCurrentStudent() — the write did not reach the server:', error);
    return false;
  }

  return true;
}

/** Whether the live subscription is already active for this exact classroom — lets a caller (main.js) skip re-running onboarding/device-resolution logic on a snapshot-triggered re-render, going straight to the main portal render instead. */
export function isClassroomSubscribed(classroomId) {
  return subscribedClassroomId === classroomId;
}

/**
 * The one, minimal new public surface this milestone adds — lets
 * code outside this file (studentGoalsService.js,
 * StudentNotebooksView.js) reuse the exact same "live snapshot if
 * subscribed, else null" check already proven inside this file (see
 * getPublicProfileForStudent()'s own identical inline check), rather
 * than duplicating this logic or leaving a read site to bypass the
 * live subscription entirely. Returns null (never throws, never
 * silently falls back itself) when not subscribed to this exact
 * classroom — the caller decides how to handle that, exactly as
 * getPublicProfileForStudent() already does today.
 */
export function getLiveClassroomIfSubscribed(classroomId) {
  return subscribedClassroomId === classroomId ? liveClassroom : null;
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
