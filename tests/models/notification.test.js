/**
 * tests/models/notification.test.js
 *
 * Covers models/Notification.js's createNotification() shape for the
 * new `connection_request_pending` type/`Connections` category this
 * feature adds (config/notificationCategories.js), with a specific
 * focus on the anti-identity-leak requirement: this notification's own
 * payload must never contain a learner identity, only `classroomId`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotification } from '../../js/models/Notification.js';
import { NOTIFICATION_CATEGORIES } from '../../js/config/notificationCategories.js';

test('NOTIFICATION_CATEGORIES includes CONNECTIONS alongside the three pre-existing categories, unchanged', () => {
  assert.deepEqual(NOTIFICATION_CATEGORIES, {
    CLASSROOM: 'Classroom',
    CHECKPOINTS: 'Checkpoints',
    FEED: 'Feed',
    CONNECTIONS: 'Connections',
  });
});

test('a connection_request_pending notification carries ONLY classroomId in its payload — never a learnerProfileId or any other learner-identifying field', () => {
  const notification = createNotification({
    classroomId: 'classroom-1',
    type: 'connection_request_pending',
    category: NOTIFICATION_CATEGORIES.CONNECTIONS,
    title: 'Learning Hub connection requests waiting',
    message: 'One or more learners are waiting to be matched to a student in your classroom.',
    payload: { classroomId: 'classroom-1' },
    createdByUid: 'teacher-1',
  });

  assert.deepEqual(Object.keys(notification.payload), ['classroomId']);
  assert.equal(notification.payload.classroomId, 'classroom-1');
  assert.equal(notification.type, 'connection_request_pending');
  assert.equal(notification.category, NOTIFICATION_CATEGORIES.CONNECTIONS);
  // Generic shape checks shared with every other notification type —
  // this new type introduces no special-cased fields.
  assert.ok(notification.id);
  assert.ok(notification.createdAt);
  assert.deepEqual(notification.readBy, []);
});
