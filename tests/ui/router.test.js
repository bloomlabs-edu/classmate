/**
 * tests/ui/router.test.js
 *
 * Real, executed unit tests against ui/router.js's own pure
 * resolvePathParts() — no DOM, no `window`, no mocking of anything.
 * Covers exactly the four new Learning Programme routes added in
 * Phase 2A, plus a handful of pre-existing routes re-verified
 * unchanged, so a regression in the new branches' own placement
 * inside the existing if/else chain would be caught here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePathParts } from '../../js/ui/router.js';

function parts(path) {
  return path.split('/').filter(Boolean);
}

test('learning-programmes list route', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes'));
  assert.deepEqual(route, { name: 'learningProgrammesList', classroomId: 'classroom-1' });
});

test('learning-programmes overview route', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1'));
  assert.deepEqual(route, { name: 'learningProgrammeOverview', classroomId: 'classroom-1', programmeId: 'programme-1' });
});

test('learning-programmes settings route', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1/settings'));
  assert.deepEqual(route, { name: 'learningProgrammeSettings', classroomId: 'classroom-1', programmeId: 'programme-1' });
});

test('learning-programmes session route', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1/session/session-1'));
  assert.deepEqual(route, {
    name: 'programmeSession',
    classroomId: 'classroom-1',
    programmeId: 'programme-1',
    sessionId: 'session-1',
  });
});

test('learning-programmes session route: missing sessionId falls back to overview, never throws', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1/session'));
  assert.deepEqual(route, { name: 'learningProgrammeOverview', classroomId: 'classroom-1', programmeId: 'programme-1' });
});

// ---------------------------------------------------------------------
// LEARNING CIRCLE REDESIGN — the three new drill-in routes
// ---------------------------------------------------------------------

test('learning-programmes session attendance drill-in route', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1/session/session-1/attendance'));
  assert.deepEqual(route, {
    name: 'programmeSessionAttendance',
    classroomId: 'classroom-1',
    programmeId: 'programme-1',
    sessionId: 'session-1',
  });
});

test('learning-programmes session goals drill-in route', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1/session/session-1/goals'));
  assert.deepEqual(route, {
    name: 'programmeSessionGoals',
    classroomId: 'classroom-1',
    programmeId: 'programme-1',
    sessionId: 'session-1',
  });
});

test('learning-programmes session observations drill-in route', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1/session/session-1/observations'));
  assert.deepEqual(route, {
    name: 'programmeSessionObservations',
    classroomId: 'classroom-1',
    programmeId: 'programme-1',
    sessionId: 'session-1',
  });
});

test('learning-programmes session route: an unrecognized sixth segment falls back to the plain session dashboard, never throws', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1/session/session-1/something-unexpected'));
  assert.deepEqual(route, {
    name: 'programmeSession',
    classroomId: 'classroom-1',
    programmeId: 'programme-1',
    sessionId: 'session-1',
  });
});

test('learning-programmes route: an unrecognized fourth segment falls back to overview, never throws', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/learning-programmes/programme-1/something-unexpected'));
  assert.deepEqual(route, { name: 'learningProgrammeOverview', classroomId: 'classroom-1', programmeId: 'programme-1' });
});

// ---------------------------------------------------------------------
// Confirm the new branch didn't disturb any pre-existing route
// ---------------------------------------------------------------------

test('pre-existing route: dashboard', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1')), { name: 'dashboard', classroomId: 'classroom-1' });
});

test('pre-existing route: goals', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/goals')), { name: 'goalManagement', classroomId: 'classroom-1' });
});

// ---------------------------------------------------------------------
// PROGRAMME MANAGER WEEKLY PLAN REVIEW — the one new top-level route
// ---------------------------------------------------------------------

test('program-manager weekly-plans route — not classroom-scoped, no classroomId in the resolved route', () => {
  assert.deepEqual(resolvePathParts(parts('program-manager/weekly-plans')), { name: 'programManagerWeeklyPlans' });
});

test('program-manager with no matching second segment does not resolve to the weekly-plans route', () => {
  assert.notDeepEqual(resolvePathParts(parts('program-manager/something-else')), { name: 'programManagerWeeklyPlans' });
});

test('program-manager weekly-plans/review route resolves distinctly from the queue route', () => {
  assert.deepEqual(resolvePathParts(parts('program-manager/weekly-plans/review')), { name: 'programManagerWeeklyPlanReview' });
});

test('program-manager chapter-plans route — not classroom-scoped, no classroomId in the resolved route', () => {
  assert.deepEqual(resolvePathParts(parts('program-manager/chapter-plans')), { name: 'programManagerChapterPlans' });
});

test('program-manager chapter-plans/review route resolves distinctly from the queue route', () => {
  assert.deepEqual(resolvePathParts(parts('program-manager/chapter-plans/review')), { name: 'programManagerChapterPlanReview' });
});

test('program-manager chapter-plans route does not collide with the Fellow-facing classroom-scoped chapter-plans route', () => {
  const pmRoute = resolvePathParts(parts('program-manager/chapter-plans'));
  const fellowRoute = resolvePathParts(parts('classroom/classroom-1/chapter-plans'));
  assert.notEqual(pmRoute.name, fellowRoute.name);
});

test('program-manager observations route — the renamed detailed LessonPlan queue, not classroom-scoped', () => {
  assert.deepEqual(resolvePathParts(parts('program-manager/observations')), { name: 'programManagerObservations' });
});

test('pre-existing route: learning management', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/learning')), { name: 'learningManagement', classroomId: 'classroom-1' });
});

test('lesson plans list route', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/lesson-plans')), { name: 'lessonPlansList', classroomId: 'classroom-1' });
});

test('lesson plan builder route', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/lesson-plans/plan-1')), {
    name: 'lessonPlanBuilder',
    classroomId: 'classroom-1',
    lessonPlanId: 'plan-1',
  });
});

test('chapter plans list route', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/chapter-plans')), { name: 'chapterPlansList', classroomId: 'classroom-1' });
});

test('chapter plan editor route', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/chapter-plans/plan-1')), {
    name: 'chapterPlanEditor',
    classroomId: 'classroom-1',
    chapterPlanId: 'plan-1',
  });
});

test('chapter plan editor route is stable on a fresh parse (browser refresh) — resolvePathParts is pure and derives the same route from the same URL every time', () => {
  const first = resolvePathParts(parts('classroom/classroom-1/chapter-plans/plan-1'));
  const second = resolvePathParts(parts('classroom/classroom-1/chapter-plans/plan-1'));
  assert.deepEqual(first, second);
});

test('lesson plan review queue route', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/lesson-plans/review')), {
    name: 'lessonPlanReviewQueue',
    classroomId: 'classroom-1',
  });
});

test('lesson plan review route: a real lessonPlanId followed by /review opens the reviewer view, not the builder', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/lesson-plans/plan-1/review')), {
    name: 'lessonPlanReview',
    classroomId: 'classroom-1',
    lessonPlanId: 'plan-1',
  });
});

test('pre-existing route: feed', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/feed')), { name: 'feed', classroomId: 'classroom-1' });
});

test('pre-existing route: student profile with tab', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/student/student-1/notebooks')), {
    name: 'studentProfile',
    classroomId: 'classroom-1',
    studentId: 'student-1',
    tab: 'notebooks',
  });
});

test('pre-existing route: notebooks checkpoints', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/notebooks/subject-1/type-1/checkpoints')), {
    name: 'notebookCheckpoints',
    classroomId: 'classroom-1',
    subjectId: 'subject-1',
    notebookTypeId: 'type-1',
  });
});

test('pre-existing route: teacher home', () => {
  assert.deepEqual(resolvePathParts(parts('teacher')), { name: 'home' });
});

test('pre-existing route: bare root is landing', () => {
  assert.deepEqual(resolvePathParts([]), { name: 'landing' });
});

test('visitor access route: a code in the path resolves to visitorAccess with that code', () => {
  assert.deepEqual(resolvePathParts(parts('visitor/ABCD12')), { name: 'visitorAccess', code: 'ABCD12' });
});

test('visitor access route: no code falls back to null, not a thrown error — the view itself prompts for one', () => {
  assert.deepEqual(resolvePathParts(parts('visitor')), { name: 'visitorAccess', code: null });
});

test('weekly reports list route: no week segment resolves to the week picker', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/weekly-reports')), {
    name: 'weeklyReports',
    classroomId: 'classroom-1',
    week: null,
  });
});

test('weekly reports detail route: a Monday date key opens that week specifically', () => {
  assert.deepEqual(resolvePathParts(parts('classroom/classroom-1/weekly-reports/2026-08-24')), {
    name: 'weeklyReports',
    classroomId: 'classroom-1',
    week: '2026-08-24',
  });
});

// ---------------------------------------------------------------------
// ASSESSMENTS — Scorecard as the default route, /manage as the
// demoted-but-still-reachable old card-based home, /scorecard kept as
// a backward-compatible alias
// ---------------------------------------------------------------------

test('assessments bare route: no assessmentId, no view — this is what now opens the Scorecard (see js/main.js)', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/assessments'));
  assert.deepEqual(route, { name: 'assessments', classroomId: 'classroom-1', assessmentId: null, view: null });
});

test('assessments route with an assessmentId still resolves exactly as before — Gradebook/Details/Subject/Import are unaffected', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/assessments/asm-1/gradebook'));
  assert.deepEqual(route, { name: 'assessments', classroomId: 'classroom-1', assessmentId: 'asm-1', view: 'gradebook' });
});

test('assessments/manage route: the old card-based home, reserved literal checked before the generic assessmentId slot', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/assessments/manage'));
  assert.deepEqual(route, { name: 'assessmentsManage', classroomId: 'classroom-1' });
});

test('assessments/scorecard route (no cycleKey): unchanged backward-compatible alias', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/assessments/scorecard'));
  assert.deepEqual(route, { name: 'assessmentsScorecard', classroomId: 'classroom-1', cycleKey: null });
});

test('assessments/scorecard/{cycleKey} route: unchanged backward-compatible alias', () => {
  const route = resolvePathParts(parts('classroom/classroom-1/assessments/scorecard/Quarterly%20Examinations'));
  assert.deepEqual(route, { name: 'assessmentsScorecard', classroomId: 'classroom-1', cycleKey: 'Quarterly Examinations' });
});
