/**
 * models/Testimonial.js
 *
 * A PUBLISHED, classroom-public copy of a private comment's text (see
 * models/StudentComment.js) — created only via an explicit teacher
 * "Publish" action (services/commentService.js's own publishComment()),
 * never automatically. Lives at
 * classrooms/{classroomId}/testimonials/{testimonialId} — a genuinely
 * separate Firestore collection from studentComments, so
 * firestore.rules can safely grant student-reachable read access to
 * this collection alone (gated on `published`) without that rule ever
 * being able to reach a private comment.
 *
 * `text` is a deliberate COPY taken at publish time, not a live
 * reference back to the source comment — editing or deleting the
 * original studentComments document never silently changes or removes
 * an already-published testimonial, and this document's own field
 * list is short and fixed (see firestore.rules's own
 * `request.resource.data.keys().hasOnly([...])` allowlist on create)
 * specifically so no private-only field could ever end up here by
 * accident.
 *
 * `published` is the only field a teacher ever flips after creation —
 * unpublishing hides a testimonial from students again WITHOUT
 * deleting this document (so re-publishing later needs no new text/
 * approval step) and never touches the original comment at all.
 *
 * `sourceCommentId` is an opaque pointer back to the originating
 * studentComments document, kept only so the UI can show "already
 * published" state against that comment — it carries no information
 * about the comment's own content, so it is safe to be world-readable
 * alongside every other field here.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createTestimonial({
  id,
  classroomId,
  studentId,
  sourceCommentId,
  text,
  workItemLabel = null,
  published = true,
  publishedByUid,
  publishedAt,
  updatedAt = null,
} = {}) {
  const now = getCurrentIsoDate();
  return {
    id: id || generateId(),
    classroomId,
    studentId,
    sourceCommentId,
    text,
    workItemLabel,
    published,
    publishedByUid,
    publishedAt: publishedAt || now,
    updatedAt,
  };
}
