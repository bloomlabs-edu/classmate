/**
 * tests/config/notificationRouting.test.js
 *
 * Pure-logic coverage for config/notificationRouting.js's
 * resolveNotificationRoute() — extracted from js/main.js's own
 * handleOpenNotification() specifically so the click-through behavior
 * for every notification type (including the new
 * `connection_request_pending` type this feature adds) is testable
 * without importing main.js itself (see that module's own header
 * comment for why it can't be imported under plain `node --test`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNotificationRoute } from '../../js/config/notificationRouting.js';

test('a notification with payload.studentId routes to that student\'s profile (pre-existing behavior, unchanged)', () => {
  const route = resolveNotificationRoute({ classroomId: 'c1', payload: { studentId: 's1' } });
  assert.equal(route, '/classroom/c1/student/s1');
});

test('a notification with payload.postId routes to the classroom Feed (pre-existing behavior, unchanged)', () => {
  const route = resolveNotificationRoute({ classroomId: 'c1', payload: { postId: 'p1' } });
  assert.equal(route, '/classroom/c1/feed');
});

test('a connection_request_pending notification routes to that classroom\'s Connect Learning Hub screen', () => {
  const route = resolveNotificationRoute({ classroomId: 'c1', type: 'connection_request_pending', payload: { classroomId: 'c1' } });
  assert.equal(route, '/classroom/c1/connect-learning-hub');
});

test('connection_request_pending routing is keyed on `type`, not a payload field — a payload containing ONLY classroomId (never a learner identity) still routes correctly', () => {
  const notification = { classroomId: 'c42', type: 'connection_request_pending', payload: { classroomId: 'c42' } };
  assert.deepEqual(Object.keys(notification.payload), ['classroomId'], 'this notification must never carry anything beyond classroomId in its payload');
  assert.equal(resolveNotificationRoute(notification), '/classroom/c42/connect-learning-hub');
});

test('every resolved route is scoped to the notification\'s own classroomId — never a different classroom', () => {
  const studentRoute = resolveNotificationRoute({ classroomId: 'home-classroom', payload: { studentId: 's1' } });
  const feedRoute = resolveNotificationRoute({ classroomId: 'home-classroom', payload: { postId: 'p1' } });
  const connectRoute = resolveNotificationRoute({ classroomId: 'home-classroom', type: 'connection_request_pending', payload: {} });
  for (const route of [studentRoute, feedRoute, connectRoute]) {
    assert.ok(route.startsWith('/classroom/home-classroom/'), `expected ${route} to be scoped to home-classroom`);
  }
});

test('an unrecognized notification type/payload resolves to null — no navigation, matching the pre-existing fall-through behavior', () => {
  assert.equal(resolveNotificationRoute({ classroomId: 'c1', type: 'some_unknown_type', payload: {} }), null);
  assert.equal(resolveNotificationRoute({ classroomId: 'c1' }), null);
});

test('studentId/postId branches take priority over type — matches the exact pre-existing if/else-if order this function preserves', () => {
  // Not a real combination this app produces, but proves the extraction
  // preserved the original branch order rather than silently changing it.
  const route = resolveNotificationRoute({ classroomId: 'c1', type: 'connection_request_pending', payload: { studentId: 's1' } });
  assert.equal(route, '/classroom/c1/student/s1');
});
