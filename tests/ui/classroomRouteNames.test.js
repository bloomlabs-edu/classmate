/**
 * tests/ui/classroomRouteNames.test.js
 *
 * Regression coverage for the exact bug reported against
 * `/classroom/{id}/scoreboard-archive`: ui/router.js's resolvePathParts()
 * already parsed it correctly, and js/main.js already had a real
 * render branch for it — the route still silently fell through to the
 * Home/Personal Hub fallback because `scoreboardArchive`/
 * `scoreboardArchiveDetail` were simply missing from
 * config/classroomRouteNames.js's CLASSROOM_ROUTE_NAMES, the one array
 * main.js's renderRoute() gates its ENTIRE classroom-scoped rendering
 * block on.
 *
 * Rather than asserting only "scoreboardArchive is in the list" (which
 * only prevents this one instance from recurring), this walks every
 * `/classroom/{id}/...` branch ui/router.js's resolvePathParts() can
 * actually produce and asserts EVERY resulting route name is present
 * in CLASSROOM_ROUTE_NAMES — so adding a new classroom-scoped route to
 * the router without also registering it here fails a test
 * immediately, instead of silently rendering the wrong screen in
 * production.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePathParts } from '../../js/ui/router.js';
import { CLASSROOM_ROUTE_NAMES } from '../../js/config/classroomRouteNames.js';

const CLASSROOM_ID = 'c1';

// One representative path per branch in resolvePathParts()'s
// `/classroom/{id}/...` handling, in the same order as that function.
const CLASSROOM_SCOPED_PATHS = [
  `classroom/${CLASSROOM_ID}/class-mode`,
  `classroom/${CLASSROOM_ID}/reports`,
  `classroom/${CLASSROOM_ID}/recognition`,
  `classroom/${CLASSROOM_ID}/weekly-reports`,
  `classroom/${CLASSROOM_ID}/settings`,
  `classroom/${CLASSROOM_ID}/student-access`,
  `classroom/${CLASSROOM_ID}/setup`,
  `classroom/${CLASSROOM_ID}/student/s1`,
  `classroom/${CLASSROOM_ID}/team/t1`,
  `classroom/${CLASSROOM_ID}/activities`,
  `classroom/${CLASSROOM_ID}/activities/a1`,
  `classroom/${CLASSROOM_ID}/work-requests/w1`,
  `classroom/${CLASSROOM_ID}/notebooks`,
  `classroom/${CLASSROOM_ID}/notebooks/sub1/type1`,
  `classroom/${CLASSROOM_ID}/notebooks/sub1/type1/checkpoints`,
  `classroom/${CLASSROOM_ID}/notebooks/sub1/type1/daily`,
  `classroom/${CLASSROOM_ID}/notebooks/sub1/type1/new`,
  `classroom/${CLASSROOM_ID}/assessments`,
  `classroom/${CLASSROOM_ID}/goals`,
  `classroom/${CLASSROOM_ID}/learning`,
  `classroom/${CLASSROOM_ID}/lesson-plans`,
  `classroom/${CLASSROOM_ID}/lesson-plans/review`,
  `classroom/${CLASSROOM_ID}/lesson-plans/lp1/review`,
  `classroom/${CLASSROOM_ID}/lesson-plans/lp1`,
  `classroom/${CLASSROOM_ID}/feed`,
  `classroom/${CLASSROOM_ID}/timetable`,
  `classroom/${CLASSROOM_ID}/scoreboard-archive`,
  `classroom/${CLASSROOM_ID}/scoreboard-archive/arc1`,
  `classroom/${CLASSROOM_ID}/learning-programmes`,
  `classroom/${CLASSROOM_ID}/learning-programmes/p1`,
  `classroom/${CLASSROOM_ID}/learning-programmes/p1/settings`,
  `classroom/${CLASSROOM_ID}/learning-programmes/p1/session/s1`,
  `classroom/${CLASSROOM_ID}/learning-programmes/p1/session/s1/attendance`,
  `classroom/${CLASSROOM_ID}/learning-programmes/p1/session/s1/goals`,
  `classroom/${CLASSROOM_ID}/learning-programmes/p1/session/s1/observations`,
  `classroom/${CLASSROOM_ID}/diagnostics`,
  `classroom/${CLASSROOM_ID}`, // bare classroom URL -> dashboard
];

test('every classroom-scoped route resolvePathParts() can produce is registered in CLASSROOM_ROUTE_NAMES', () => {
  const missing = [];
  for (const path of CLASSROOM_SCOPED_PATHS) {
    const parts = path.split('/').filter(Boolean);
    const route = resolvePathParts(parts);
    assert.equal(route.classroomId, CLASSROOM_ID, `expected ${path} to resolve as classroom-scoped`);
    if (!CLASSROOM_ROUTE_NAMES.includes(route.name)) {
      missing.push(`${path} -> route.name "${route.name}"`);
    }
  }
  assert.deepEqual(missing, [], `route name(s) parsed correctly by the router but missing from CLASSROOM_ROUTE_NAMES (main.js would silently fall through to Home for these):\n${missing.join('\n')}`);
});

test('the specific reported regression: /scoreboard-archive resolves to scoreboardArchive and is registered', () => {
  const route = resolvePathParts(['classroom', CLASSROOM_ID, 'scoreboard-archive']);
  assert.equal(route.name, 'scoreboardArchive');
  assert.ok(CLASSROOM_ROUTE_NAMES.includes('scoreboardArchive'));
});

test('the specific reported regression: /scoreboard-archive/{archiveId} resolves to scoreboardArchiveDetail and is registered', () => {
  const route = resolvePathParts(['classroom', CLASSROOM_ID, 'scoreboard-archive', 'arc1']);
  assert.equal(route.name, 'scoreboardArchiveDetail');
  assert.ok(CLASSROOM_ROUTE_NAMES.includes('scoreboardArchiveDetail'));
});
