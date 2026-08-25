/**
 * models/Notification.js
 *
 * One entry in a classroom's own in-app notification feed for
 * TEACHERS — the teacher-facing counterpart to models/StudentEvent.js,
 * which already does exactly this for students (see that file's own
 * header comment). Deliberately the same generic shape for the same
 * reason: every publisher produces the same fields, so the UI (see
 * ui/components/UserBar.js's own notification popover) never needs
 * per-type rendering logic and a new publisher never requires a UI
 * change — only a new `type`/`category` value and its own title/message
 * text.
 *
 * Stored in its own subcollection, classrooms/{classroomId}/notifications
 * — NOT a flat array on the classroom document the way studentEvents
 * is. A live onSnapshot listener on this collection (for the unread
 * badge) would otherwise have to be a listener on the whole classroom
 * document, re-firing the entire classroom object on every unrelated
 * write; see services/firestoreNotificationRepository.js's own header
 * comment for the full reasoning. This mirrors
 * classrooms/{classroomId}/feedPosts' own existing shape instead.
 *
 * `createdByUid` — the real, authenticated uid of whichever teacher
 * action triggered this notification. Firestore rules require this to
 * equal request.auth.uid at create time (see firestore.rules's own
 * comment on this collection) specifically so an ordinary classroom
 * member can never author a notification impersonating someone else,
 * and so creation can never come from a student's own (anonymous,
 * lower-trust) identity at all.
 *
 * `readBy` — an array of uids, mirroring feedPosts.reactorUids' own
 * existing shape exactly: several teachers can share one classroom, so
 * a single readAt timestamp (as StudentEvent uses, correctly, for its
 * one-reader-per-event case) doesn't fit here — each member's own read
 * state has to be tracked independently on the same document.
 *
 * `payload` — a plain object carrying whatever structured data this
 * notification's own type needs beyond title/message (e.g.
 * `{ studentId, checkpointId }`), so a click handler can navigate
 * somewhere useful. Never read generically by the popover UI itself —
 * only a type-aware click handler reaches into it, same convention as
 * StudentEvent.payload.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createNotification({
  id,
  classroomId,
  type,
  category,
  title,
  message,
  payload = {},
  createdAt,
  createdByUid,
  readBy = [],
} = {}) {
  return {
    id: id || generateId(),
    classroomId,
    type,
    category,
    title,
    message,
    payload,
    createdAt: createdAt || getCurrentIsoDate(),
    createdByUid,
    readBy,
  };
}
