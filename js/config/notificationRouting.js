/**
 * config/notificationRouting.js
 *
 * Pure mapping from a teacher notification to the route it should open
 * — extracted out of js/main.js's own handleOpenNotification()
 * specifically so it's unit-testable without importing main.js itself
 * (main.js has real side effects at import time and transitively pulls
 * in Firestore via an `https://` specifier Node's own ESM loader can't
 * resolve at all — see config/classroomRouteNames.js's own header
 * comment for the identical constraint hit there).
 *
 * Every branch returns a path scoped to `notification.classroomId` —
 * every teacher notification in this app is classroom-scoped (see
 * models/Notification.js's own header comment), so there is no branch
 * here that could ever navigate somewhere not tied to the classroom the
 * notification itself came from. Returns `null` for a notification
 * type this app has no deep-link destination for yet (unchanged
 * fall-through behavior from before this function was extracted).
 */
export function resolveNotificationRoute(notification) {
  if (notification.payload?.studentId) {
    return `/classroom/${notification.classroomId}/student/${notification.payload.studentId}`;
  }
  if (notification.payload?.postId) {
    return `/classroom/${notification.classroomId}/feed`;
  }
  if (notification.type === 'connection_request_pending') {
    // Deliberately keyed on `type`, not a payload field — this
    // notification's own payload is just `{ classroomId }` (see
    // ui/views/ConnectLearningHubView.js's own publish call), since the
    // whole point of this notification is to never carry a learner
    // identity, not even an opaque one, the way studentId/postId above
    // safely do for their own non-identity-sensitive targets.
    return `/classroom/${notification.classroomId}/connect-learning-hub`;
  }
  return null;
}
