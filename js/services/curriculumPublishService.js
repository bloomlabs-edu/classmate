/**
 * services/curriculumPublishService.js
 *
 * Curriculum Import Pipeline redesign, Stage 8. Deliberately thin —
 * services/curriculumSubmissionsService.js already owns the entire
 * pending_review -> published lifecycle correctly, including the one
 * rule that must never be bypassed: nothing reaches the global
 * Curriculum Library except through an admin's explicit approval (see
 * that file's own header comment, and ui/views/CurriculumManagementView.js's
 * Review Submissions screen, where that approval actually happens).
 *
 * This file exists only to name Stage 8 correctly at the pipeline
 * level: what a teacher sees as "Publish" is always, underneath,
 * "Submit for Review" — moderation is not optional, and this is the
 * one function that submission flows through, so that fact can never
 * quietly stop being true no matter how the UI's button is worded.
 */

import * as curriculumSubmissionsService from './curriculumSubmissionsService.js';

/**
 * Submits a fully-reviewed curriculum pack for moderation. Always
 * starts 'pending_review' — see curriculumSubmissionsService.js's own
 * submitContribution() for the lifecycle this hands off into. Nothing
 * here, or downstream, ever skips straight to published.
 */
export function submitForReview(packJson) {
  return curriculumSubmissionsService.submitContribution(packJson);
}
