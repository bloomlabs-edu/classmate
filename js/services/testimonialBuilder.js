/**
 * services/testimonialBuilder.js
 *
 * Pure, Firestore-free logic shared by services/commentService.js
 * (teacher-facing: builds what gets published) and
 * services/testimonialService.js (student-facing: selects what's safe
 * to ever return). Deliberately its own file, with NO import of
 * anything that touches the Firebase CDN — both of those other files
 * either statically import real Firestore repositories
 * (commentService.js, which is itself teacher-only and never reachable
 * from the student portal) or dynamically import them specifically so
 * they stay safely importable under plain `node --test`
 * (testimonialService.js). This file has none of that problem to begin
 * with, which is also what makes both functions below directly
 * unit-testable with no mocking at all.
 */

import { createTestimonial } from '../models/Testimonial.js';

/**
 * Builds the exact document a "Publish" action writes: a fresh
 * Testimonial carrying only `text`, copied as-is at this moment from
 * the private comment, plus the minimum metadata a public/student-
 * facing reader needs. Deliberately does NOT spread the comment object
 * — only ever reads the handful of fields named explicitly below — so
 * a future field added to models/StudentComment.js (workItemRef's own
 * internal shape, createdByUid, an internal audit trail, etc.) can
 * never leak into a testimonial just by existing on the source
 * comment.
 */
export function buildTestimonialFromComment(comment, { actingUid, workItemLabel = null } = {}) {
  return createTestimonial({
    classroomId: comment.classroomId,
    studentId: comment.studentId,
    sourceCommentId: comment.id,
    text: comment.text,
    workItemLabel,
    published: true,
    publishedByUid: actingUid,
  });
}

/**
 * The student-facing allowlist — the LAST line of defense before any
 * testimonial-shaped object reaches a student-portal screen. Even if a
 * future bug upstream (a repository change, a bad migration, a
 * mis-scoped Firestore query) ever caused a comment-shaped or
 * otherwise over-full object to reach this function, only these five
 * fields would ever survive it; `sourceCommentId`, `publishedByUid`,
 * `classroomId`, `published`, `updatedAt`, and anything else present
 * on the raw object are always dropped, unconditionally.
 */
export const PUBLIC_TESTIMONIAL_FIELDS = Object.freeze(['id', 'studentId', 'text', 'workItemLabel', 'publishedAt']);

export function selectPublicTestimonialFields(raw) {
  const safe = {};
  PUBLIC_TESTIMONIAL_FIELDS.forEach((key) => {
    if (raw[key] !== undefined) safe[key] = raw[key];
  });
  return safe;
}
