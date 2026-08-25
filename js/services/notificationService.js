/**
 * services/notificationService.js
 *
 * The single service every publisher and every reader of teacher-facing
 * in-app notifications goes through — mirrors feedService.js's own
 * teacher-side half (a thin pass-through to its repository, with
 * try/catch-and-log around writes so a publisher's own triggering
 * action never fails because a notification failed to record). Reads
 * always go through the live subscription below; there is no separate
 * student-facing half here at all, unlike feedService.js, since nothing
 * about this feature is ever student-visible or student-writable — see
 * firestore.rules's own comment on this collection.
 */

import * as notificationRepository from '../repositories/firestoreNotificationRepository.js';

/**
 * Publishes one notification for a classroom. Call this only after the
 * triggering action has actually succeeded — same explicit contract
 * services/studentEventService.js's publishEvent() already establishes
 * for its own, student-facing equivalent. Fire-and-forget from the
 * caller's own point of view: a failure here is logged, never thrown,
 * so a real, already-successful teacher action (joining a classroom,
 * marking a checkpoint Incomplete) is never rolled back or blocked by
 * this side-channel failing.
 */
export async function publishNotification(classroomId, { type, category, title, message, payload, createdByUid, readBy }) {
  try {
    return await notificationRepository.createNotification(classroomId, { type, category, title, message, payload, createdByUid, readBy });
  } catch (error) {
    console.error('[notificationService] publishNotification() failed — the triggering action itself still succeeded:', error);
    return null;
  }
}

/**
 * Publishes a notification at a deterministic id derived from
 * whatever it's actually about (e.g. `feed_post_${postId}`) — the
 * multi-writer-safe alternative to publishNotification() above, for
 * exactly the case that function can't handle safely: more than one
 * client independently deciding, at nearly the same moment, that the
 * same real-world event deserves this same notification. See
 * repositories/firestoreNotificationRepository.js's own
 * createNotificationIfAbsent() for how the race itself is actually
 * closed (a transaction, not just "hope the ids don't collide").
 * Same fire-and-forget contract as publishNotification(): logs and
 * swallows a failure rather than throwing.
 */
export async function publishNotificationIfAbsent(notificationId, classroomId, { type, category, title, message, payload, createdByUid }) {
  try {
    return await notificationRepository.createNotificationIfAbsent(classroomId, notificationId, { type, category, title, message, payload, createdByUid });
  } catch (error) {
    console.error('[notificationService] publishNotificationIfAbsent() failed:', error);
    return null;
  }
}

/** Live-subscribes to this classroom's own recent notifications, newest-first. Returns the unsubscribe function directly. */
export function subscribeToNotifications(classroomId, onChange, onError) {
  return notificationRepository.subscribeToNotifications(classroomId, onChange, onError);
}

/** Marks one notification read for this uid only — every other classroom member's own read state is untouched. */
export async function markNotificationRead(classroomId, notificationId, uid) {
  try {
    await notificationRepository.markRead(classroomId, notificationId, uid);
    return true;
  } catch (error) {
    console.error('[notificationService] markNotificationRead() failed:', error);
    return false;
  }
}

/** How many of the given notifications this uid has not yet read — the UserBar bell's own badge count. */
export function countUnread(notifications, uid) {
  return notifications.filter((notification) => !(notification.readBy || []).includes(uid)).length;
}
