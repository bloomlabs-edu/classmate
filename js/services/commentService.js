/**
 * services/commentService.js
 *
 * TEACHER-FACING ONLY — the Private Comments + Testimonial-publishing
 * half of "Recognition, comments, and testimonials" (the star/badge
 * half lives in services/recognitionService.js). Never imported from
 * anything under ui/student-portal/ or services/studentPortalDataService.js
 * — the one function a student-facing code path may ever call for this
 * feature is services/testimonialService.js's own
 * getPublishedTestimonialsForStudent(), a SEPARATE file, deliberately,
 * so a static import graph alone shows this file (and the private
 * studentComments collection it reads/writes) is never reachable from
 * the student portal.
 *
 * A private comment and a published testimonial are DIFFERENT
 * documents in DIFFERENT Firestore collections (see models/StudentComment.js
 * and models/Testimonial.js's own header comments, and
 * firestore.rules's own rules for both) — publishComment() below COPIES
 * text into a new testimonial document; it never links the two
 * collections at the database level, and unpublishing/deleting one
 * never touches the other.
 *
 * Per this project's standing data-handling rules: `text` here is a
 * short teacher observation about classroom performance, behaviour, or
 * a specific piece of work only. Nothing in this file (or
 * models/StudentComment.js/models/Testimonial.js) stores contact
 * details, government IDs, health/medical information, caste/religion,
 * or photos/videos — if a future change to this file seems to need any
 * of those, stop and escalate to the AI Working Committee first rather
 * than adding the field.
 */

import { createStudentComment } from '../models/StudentComment.js';
import { buildTestimonialFromComment } from './testimonialBuilder.js';
import * as commentsRepository from '../repositories/firestoreStudentCommentsRepository.js';
import * as testimonialsRepository from '../repositories/firestoreTestimonialsRepository.js';

export { buildTestimonialFromComment };

/** Adds a new private comment — optionally tied to a work item (see services/recognitionService.js's own workItemRef shapes) via `workItemRef`, or left null for a standalone recognition note. Teacher-only, enforced again at the firestore.rules layer, not just here. */
export async function addComment(classroomId, { studentId, workItemRef = null, text, actingUid }) {
  const comment = createStudentComment({ classroomId, studentId, workItemRef, text, createdByUid: actingUid });
  return commentsRepository.createComment(classroomId, comment);
}

/** Edits an existing comment's own text only. */
export async function updateComment(classroomId, commentId, { text, actingUid }) {
  return commentsRepository.updateCommentText(classroomId, commentId, { text, updatedByUid: actingUid });
}

/** Every private comment about one student — teacher-only read. */
export async function listCommentsForStudent(classroomId, studentId) {
  return commentsRepository.listCommentsForStudent(classroomId, studentId);
}

/** The explicit "Publish" action — never automatic (see this file's own header comment). Creates a brand-new testimonial document; the source comment is untouched. */
export async function publishComment(classroomId, comment, { actingUid, workItemLabel = null } = {}) {
  const testimonial = buildTestimonialFromComment(comment, { actingUid, workItemLabel });
  return testimonialsRepository.publishTestimonial(classroomId, testimonial);
}

/** Unpublishing hides a testimonial from students again WITHOUT deleting it (so it can be republished later with no new text/approval step) and never touches the original comment. */
export async function unpublishTestimonial(classroomId, testimonialId) {
  return testimonialsRepository.setPublished(classroomId, testimonialId, false);
}

/** The inverse of unpublishTestimonial() above — re-shows an already-published-once testimonial without re-copying text from the (possibly since-edited) original comment. */
export async function republishTestimonial(classroomId, testimonialId) {
  return testimonialsRepository.setPublished(classroomId, testimonialId, true);
}

/** Every testimonial for one student, published or not — teacher-only management view (Student Profile). */
export async function listTestimonialsForStudent(classroomId, studentId) {
  return testimonialsRepository.listTestimonialsForStudent(classroomId, studentId);
}
