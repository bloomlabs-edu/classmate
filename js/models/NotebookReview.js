/**
 * models/NotebookReview.js
 *
 * One criteria-scored REVIEW EVENT for a single student's single
 * submission cycle on a WorkRequest — the auditable record behind the
 * "Mark Reviewed" tap once it asks for a criteria checklist instead of
 * just flipping a status (see services/notebookReviewService.js, the
 * only writer of this shape, and ui/views/WorkRequestRosterView.js, the
 * one caller).
 *
 * Stored on `WorkRequestEntry.reviews` (see models/WorkRequestEntry.js)
 * — an append-only array, one entry per review EVENT, never mutated in
 * place and never collapsed into a single "the review" field. This is
 * what makes editing a review and reviewing a resubmission both safe
 * without ever double-counting or silently overwriting history:
 *   - EDITING a review (services/notebookReviewService.js's own
 *     editNotebookReview()) appends a NEW NotebookReview whose own
 *     `supersedesReviewId` points at the one it corrects — the original
 *     stays exactly as it was, permanently, for audit purposes. The
 *     "current" review for an entry is always `reviews[reviews.length -
 *     1]` (see getCurrentReview()) — the same last-one-wins convention
 *     services/timetableService.js's own getTimetableForDate() already
 *     uses for same-dated TimetableVersion entries.
 *   - REVIEWING A RESUBMISSION is never an edit at all: once an entry
 *     is reset back to 'assigned' (services/workRequestService.js's own
 *     resetWorkRequestEntry()) and genuinely resubmitted, the next
 *     "Mark Reviewed" tap only ever calls submitNotebookReview() again
 *     (the entry's status is 'submitted'/'resubmitted', never
 *     'reviewed', at that point) — a brand-new, independent
 *     NotebookReview with its own submission date and its own full
 *     point value, never a delta against the earlier one.
 *
 * `criteriaAwarded` — a snapshot, not a live reference: each entry is
 * `{ criterionId, label, points: 1 }`, capturing the criterion's own
 * label AT AWARD TIME (see models/NotebookReviewCriterion.js's own
 * header comment on why) so a later rename/removal from the catalog
 * never rewrites what this past award already, correctly means. Never
 * contains the same `criterionId` twice — duplicate prevention is
 * structural, enforced by how notebookReviewService.js builds this
 * array (always derived from the catalog's own deduplicated list), not
 * a flag checked after the fact.
 *
 * `totalPoints` is this ONE review's own score (e.g. "3/4") — kept
 * deliberately separate from a student's cumulative, all-time
 * recognition total (services/notebookReviewService.js's own
 * getCumulativeNotebookRecognitionPoints(), which sums the
 * `source: 'notebook_review'`/`'notebook_review_correction'` entries on
 * services/timelineService.js's own append-only history instead). The
 * two must never be conflated in any view.
 *
 * `pointsEntryId` — the id of the services/timelineService.js history
 * entry this review's own points came from (the initial award, or the
 * latest correction's entry if this review has been edited at least
 * once) — the thread tying this review record back to the exact
 * timeline entry an auditor would need to inspect next.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createNotebookReview({
  id,
  requestId,
  studentId,
  criteriaAwarded = [],
  reviewedByUid = null,
  reviewedAt,
  submissionDateKey = null,
  dueDate = null,
  isLate = false,
  pointsEntryId = null,
  supersedesReviewId = null,
} = {}) {
  return {
    id: id || generateId(),
    requestId,
    studentId,
    criteriaAwarded,
    totalPoints: criteriaAwarded.reduce((sum, criterion) => sum + (criterion.points || 0), 0),
    reviewedByUid,
    reviewedAt: reviewedAt || getCurrentIsoDate(),
    submissionDateKey,
    dueDate,
    isLate,
    pointsEntryId,
    supersedesReviewId,
  };
}

/** The current, active review for this entry — always the LAST element of `reviews` (see this file's own header comment: edits and resubmission-reviews are both always appended, never inserted/replaced). `null` for an entry that has never been reviewed under this feature yet (including every 'reviewed' entry that predates it — real, valid, un-migrated state, not an error). */
export function getCurrentReview(entry) {
  const reviews = entry.reviews || [];
  return reviews.length > 0 ? reviews[reviews.length - 1] : null;
}
