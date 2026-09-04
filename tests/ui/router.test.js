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
