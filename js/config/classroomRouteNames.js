/**
 * config/classroomRouteNames.js
 *
 * Every route name that lives "inside" a classroom — extracted out of
 * js/main.js specifically so it's importable from a test without also
 * importing main.js itself (main.js has real side effects at import
 * time and transitively pulls in Firestore via an `https://` specifier
 * Node's own ESM loader can't resolve at all — see
 * services/achievementEngine.js's own header comment for the same
 * constraint hit elsewhere in this app).
 *
 * main.js's renderRoute() gates its entire classroom-scoped rendering
 * block on `CLASSROOM_ROUTE_NAMES.includes(route.name)` — a route name
 * ui/router.js's resolvePathParts() can produce that ISN'T listed here
 * silently falls through to the Home/Personal Hub fallback instead of
 * ever reaching its own view. This is exactly the bug reported against
 * `/classroom/{id}/scoreboard-archive`: ui/router.js already parsed it
 * correctly (to `scoreboardArchive`/`scoreboardArchiveDetail`), and
 * main.js already had a real `else if (route.name === 'scoreboardArchive'...)`
 * render branch — neither was ever reached because both names were
 * simply missing from this array. tests/ui/classroomRouteNames.test.js
 * asserts every classroom-scoped route resolvePathParts() can produce
 * is present here, specifically so this class of bug (not just this
 * one instance of it) can't silently reappear.
 */
export const CLASSROOM_ROUTE_NAMES = [
  'dashboard',
  'tracker',
  'reports',
  'recognition',
  'weeklyReports',
  'settings',
  'setup',
  'studentProfile',
  'teamProfile',
  'studentAccess',
  'activitiesList',
  'activityRoster',
  'workRequestRoster',
  'notebookTracker',
  'workRequestCreate',
  'notebookCheckpoints',
  'notebookDailyCheck',
  'assessments',
  'goalManagement',
  'learningManagement',
  'lessonPlansList',
  'lessonPlanBuilder',
  'lessonPlanReviewQueue',
  'lessonPlanReview',
  'feed',
  'timetable',
  'scoreboardArchive',
  'scoreboardArchiveDetail',
  'learningProgrammesList',
  'learningProgrammeOverview',
  'learningProgrammeSettings',
  'programmeSession',
  'programmeSessionAttendance',
  'programmeSessionGoals',
  'programmeSessionObservations',
  'diagnostics', // TEMPORARY — see ui/views/TeacherDiagnosticsView.js's own header comment
];
