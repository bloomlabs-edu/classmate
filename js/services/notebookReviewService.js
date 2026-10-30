/**
 * services/notebookReviewService.js
 *
 * Turns a WorkRequest notebook's "Mark Reviewed" moment into a real,
 * auditable, criteria-scored event — the thing
 * services/workRequestService.js's own header comment explicitly keeps
 * out of itself ("no notebook-specific logic... never rebuilt per
 * type"), the exact same separation services/recognitionService.js
 * already establishes between the plain submission/checkpoint lifecycle
 * (services/notebookService.js, services/checkpointService.js) and the
 * star-awarding wrapped around it. This file is that same wrapper for
 * WorkRequest notebook reviews specifically — workRequestService.js
 * itself is never touched or taught anything about criteria.
 *
 * Reuses, never replaces:
 *   - services/workRequestService.js's own getEntryForStudent()/
 *     advanceStatus() for the actual lifecycle transition — this file
 *     only decides WHAT to award alongside that transition, never
 *     re-implements it.
 *   - services/notebookConfigService.js's own reviewCriteria catalog
 *     (ensureReviewCriteria()/listReviewCriteria()) for which criteria
 *     exist and their current labels.
 *   - services/timelineService.js's own logEntry()/getNetPoints() for
 *     the actual point ledger — a notebook-review award is a
 *     `kind: 'points'` timeline entry like every other star in this
 *     app, tagged `source: 'notebook_review'` (or
 *     `'notebook_review_correction'` for an edit) so it can be summed
 *     on its own (getCumulativeNotebookRecognitionPoints() below)
 *     without being a second, competing points system.
 *
 * TIMELINESS IS NEVER CALLER-SUPPLIED — the one hard invariant this
 * file enforces regardless of what a caller's own `criterionIds` list
 * contains: the "Timely submission" criterion
 * (models/NotebookReviewCriterion.js's own TIMELY_SUBMISSION_CRITERION_KEY/
 * isSystemDetermined) is always computed here, directly, from the
 * entry's own submission date vs. the WorkRequest's own `dueDate` — see
 * buildCriteriaAwarded() below. A caller that passes that criterion's
 * id anyway has it silently ignored; a caller that OMITS it when the
 * submission was genuinely on time still gets it correctly awarded.
 * This is what "read-only, or otherwise prevent awarding it incorrectly
 * when late" means as a real invariant, not just a disabled checkbox in
 * one UI.
 *
 * APPEND-ONLY REVIEWS, NEVER DOUBLE-COUNTED — see models/NotebookReview.js's
 * own header comment for the full design. In short:
 *   - submitNotebookReview() is the FIRST review of a submission cycle
 *     (entry currently 'submitted'/'resubmitted') — awards this
 *     review's full point value as one new timeline entry, and only
 *     ever runs once per cycle: a second call while the entry is
 *     already 'reviewed' is rejected by the exact same status guard
 *     services/workRequestService.js's own advanceStatus() already
 *     uses, so a double-tap/race can never double-award.
 *   - editNotebookReview() corrects the CURRENT review of an
 *     already-'reviewed' entry — logs only the DELTA between the old
 *     and new totals (zero delta logs nothing new at all), so the net
 *     effect on the student's cumulative total is always exactly the
 *     new total, never old-plus-new.
 *   - Reviewing a genuine resubmission (reset -> resubmitted -> Mark
 *     Reviewed again) is neither of the above calls' concern specially
 *     — it's just submitNotebookReview() again, because the entry's own
 *     status is 'resubmitted', not 'reviewed', at that point. A brand
 *     new, independent, full-value award, correctly reflecting the new
 *     submission's own date and criteria.
 */

import * as workRequestService from './workRequestService.js';
import * as notebookConfigService from './notebookConfigService.js';
import * as timelineService from './timelineService.js';
import { createNotebookReview, getCurrentReview } from '../models/NotebookReview.js';
import { TIMELY_SUBMISSION_CRITERION_KEY } from '../models/NotebookReviewCriterion.js';

export { getCurrentReview };

function findStudentById(classroom, studentId) {
  for (const team of classroom.teams || []) {
    const student = team.students.find((s) => s.id === studentId);
    if (student) return student;
  }
  return null;
}

/**
 * Resolves the full `criteriaAwarded` array for one review, plus the
 * timeliness facts it was derived from. `requestedCriterionIds` is
 * whatever the teacher checked in the UI for the ordinary, judged
 * criteria — the system-determined one is NEVER read from this list
 * (see this file's own header comment).
 *
 * Submission date is `entry.updatedAt` — exactly when
 * workRequestService.js's own advanceStatus()/resubmission flow most
 * recently moved this entry INTO 'submitted'/'resubmitted', which is
 * still its value at the moment this runs (the 'reviewed' transition
 * that would next update it hasn't happened yet). `.slice(0, 10)`
 * reduces that full ISO timestamp to the same "YYYY-MM-DD" date-key
 * `workRequest.dueDate` is already stored as (a plain
 * `<input type="date">` value — see ui/views/WorkRequestCreateView.js),
 * so the comparison below is a plain string comparison, the same
 * idiom every date-keyed comparison elsewhere in this app already uses
 * — never a Date-object comparison, and never the review date, per the
 * explicit product rule.
 */
/**
 * The submission-date-vs-due-date facts alone, with no criteria
 * involved — exported so a UI building the checklist can show the same
 * "on time"/"late" determination buildCriteriaAwarded() below actually
 * enforces, rather than a second, independently-written copy of this
 * same two-line comparison drifting out of sync with it.
 */
export function computeSubmissionTimeliness(entry, workRequest) {
  const submissionDateKey = (entry.updatedAt || '').slice(0, 10);
  const isLate = Boolean(workRequest.dueDate) && Boolean(submissionDateKey) && submissionDateKey > workRequest.dueDate;
  return { submissionDateKey, isLate };
}

function buildCriteriaAwarded(classroom, entry, workRequest, requestedCriterionIds) {
  const allCriteria = notebookConfigService.listReviewCriteria(classroom);
  const { submissionDateKey, isLate } = computeSubmissionTimeliness(entry, workRequest);

  const requested = new Set(requestedCriterionIds || []);

  const criteriaAwarded = allCriteria
    .filter((criterion) => {
      if (criterion.isSystemDetermined) return !isLate;
      return requested.has(criterion.id);
    })
    .map((criterion) => ({ criterionId: criterion.id, label: criterion.label, points: 1 }));

  return { criteriaAwarded, isLate, submissionDateKey };
}

/**
 * The FIRST review of a submission cycle — only valid from
 * 'submitted'/'resubmitted' (the same states services/workRequestService.js's
 * own advanceStatus() would otherwise move straight to 'reviewed' from).
 * Advances the entry's lifecycle exactly as that plain one-tap path
 * would (so every other workRequestService reader — summary counts,
 * "needs attention," Last Checked — sees an perfectly ordinary
 * 'reviewed' transition; criteria scoring rides alongside it, never
 * replaces it), then logs ONE new timeline points entry for this
 * review's full total and appends the new NotebookReview record.
 *
 * Returns the new NotebookReview, or `null` if the entry doesn't exist,
 * isn't currently awaiting review (including: it's already 'reviewed'
 * — a second call here is never how an existing review gets corrected;
 * see editNotebookReview() for that), or this studentId no longer
 * resolves to a real student on the roster — checked BEFORE any
 * mutation, so a rejected call never advances the entry's status or
 * appends a review that would claim points with nothing real on the
 * ledger to back it.
 */
export function submitNotebookReview(classroom, workRequest, studentId, { criterionIds = [], reviewedByUid = null } = {}) {
  const entry = workRequestService.getEntryForStudent(workRequest, studentId);
  if (!entry) return null;
  if (entry.status !== 'submitted' && entry.status !== 'resubmitted') return null;

  // Reject BEFORE any mutation at all (status, history, reviews) when
  // this entry's own studentId no longer resolves to a real student on
  // the roster (e.g. the student was later removed from the classroom
  // while this WorkRequestEntry — never itself cleaned up — still sits
  // at 'submitted'/'resubmitted'). Without this guard, a review record
  // claiming real points would be created with nothing on the ledger
  // to back it — this entry simply isn't reviewable until it resolves
  // to a real student again.
  const student = findStudentById(classroom, studentId);
  if (!student) return null;

  const { criteriaAwarded, isLate, submissionDateKey } = buildCriteriaAwarded(classroom, entry, workRequest, criterionIds);
  const totalPoints = criteriaAwarded.reduce((sum, criterion) => sum + criterion.points, 0);

  const advanced = workRequestService.advanceStatus(workRequest, studentId);
  if (!advanced) return null;

  const timelineEntry = timelineService.logEntry(student, {
    kind: 'points',
    label: `Notebook Review: ${workRequest.title}`,
    delta: totalPoints,
    source: 'notebook_review',
    workItemRef: { type: 'notebook_review', requestId: workRequest.id },
  });
  const pointsEntryId = timelineEntry.id;

  const review = createNotebookReview({
    requestId: workRequest.id,
    studentId,
    criteriaAwarded,
    reviewedByUid,
    submissionDateKey,
    dueDate: workRequest.dueDate || null,
    isLate,
    pointsEntryId,
  });

  if (!entry.reviews) entry.reviews = [];
  entry.reviews.push(review);
  return review;
}

/**
 * Corrects the CURRENT review of an entry that is already 'reviewed' —
 * never changes `entry.status` (it's already 'reviewed'; this isn't a
 * lifecycle transition), and never re-awards the full total. Only the
 * DELTA between the old and new totals is logged as a new timeline
 * entry (`source: 'notebook_review_correction'`, `correctsEntryId`
 * pointing at the original award), matching
 * services/recognitionService.js's own undoManualStarAward() correction
 * shape. A zero-delta edit (same criteria re-saved, or a different mix
 * that happens to total the same) logs NO new timeline entry at all —
 * the point ledger is never touched for a correction that doesn't
 * actually change the total — but still appends the new NotebookReview
 * record itself, so WHICH criteria were corrected stays fully
 * auditable even when the point total didn't move.
 *
 * Returns `null` if the entry doesn't exist, isn't currently
 * 'reviewed', has no existing review to correct (a 'reviewed' entry
 * from before this feature existed — real, valid, un-migrated state;
 * there is nothing to edit, only a fresh submitNotebookReview() on its
 * NEXT genuine resubmission cycle), or this studentId no longer
 * resolves to a real student on the roster — checked BEFORE any
 * mutation (including a zero-delta edit, which would otherwise still
 * append a new review record with nothing real on the ledger to back
 * it).
 */
export function editNotebookReview(classroom, workRequest, studentId, { criterionIds = [], reviewedByUid = null } = {}) {
  const entry = workRequestService.getEntryForStudent(workRequest, studentId);
  if (!entry) return null;
  if (entry.status !== 'reviewed') return null;

  const current = getCurrentReview(entry);
  if (!current) return null;

  // Reject BEFORE any mutation (including a zero-delta edit, which
  // would still append a new review record to entry.reviews) when this
  // studentId no longer resolves to a real student — same reasoning as
  // submitNotebookReview()'s own guard above: never create or correct a
  // review record with nothing real on the ledger to back it.
  const student = findStudentById(classroom, studentId);
  if (!student) return null;

  const { criteriaAwarded, isLate, submissionDateKey } = buildCriteriaAwarded(classroom, entry, workRequest, criterionIds);
  const totalPoints = criteriaAwarded.reduce((sum, criterion) => sum + criterion.points, 0);
  const delta = totalPoints - current.totalPoints;

  let pointsEntryId = current.pointsEntryId;
  if (delta !== 0) {
    const timelineEntry = timelineService.logEntry(student, {
      kind: 'points',
      label: `Corrected Notebook Review: ${workRequest.title}`,
      delta,
      source: 'notebook_review_correction',
      correctsEntryId: current.pointsEntryId,
      workItemRef: { type: 'notebook_review', requestId: workRequest.id },
    });
    pointsEntryId = timelineEntry.id;
  }

  const review = createNotebookReview({
    requestId: workRequest.id,
    studentId,
    criteriaAwarded,
    reviewedByUid,
    submissionDateKey,
    dueDate: workRequest.dueDate || null,
    isLate,
    pointsEntryId,
    supersedesReviewId: current.id,
  });

  entry.reviews.push(review);
  return review;
}

/**
 * A student's all-time cumulative NOTEBOOK-RECOGNITION points only —
 * deliberately NOT services/timelineService.js's own getNetPoints()
 * (that remains the student's whole-app, every-source total: manual
 * stars, assignment/checkpoint completions, notebook reviews, everything
 * combined). This sums only the `source: 'notebook_review'`/
 * `'notebook_review_correction'` entries on the exact same history log
 * — the same scoped-derivation pattern
 * services/recognitionService.js's own getAutomaticStarNetForWorkItem()
 * already establishes for one work item; this is that same idea scoped
 * to an entire award TYPE instead. Never a separately-maintained
 * counter — always derived live, so it can never drift from history.
 */
export function getCumulativeNotebookRecognitionPoints(student) {
  return (student.history || [])
    .filter((entry) => entry.kind === 'points' && (entry.source === 'notebook_review' || entry.source === 'notebook_review_correction'))
    .reduce((sum, entry) => sum + entry.delta, 0);
}

/**
 * Every notebook-review award this student has ever received, most
 * recent first — the "open the relevant award history" / "show the
 * notebook and criteria associated with each award" data, read
 * directly from the same WorkRequestEntry.reviews this file writes
 * (never a parallel log). Includes every review in `entry.reviews`
 * (not just the current one) — a corrected or superseded review is
 * still a real, past event an auditor should be able to see, not
 * hidden once superseded.
 *
 * Sorted by `reviewedAt` descending, with each award's own build-order
 * index (`_sequence`, stripped before returning) as a tiebreaker —
 * `getCurrentIsoDate()` is millisecond-resolution, and an edit
 * immediately following its own original review (as every test, and
 * plausibly a real fast teacher correction, can do) can legitimately
 * land in the exact same millisecond; without the tiebreaker, a plain
 * string-sort would non-deterministically order two reviews that are
 * actually chronologically ordered by construction (an edit always
 * builds on, and is pushed after, the review it corrects — see
 * editNotebookReview() above).
 */
export function getNotebookReviewAwardHistory(classroom, studentId) {
  const awards = [];
  let sequence = 0;

  workRequestService.listWorkRequests(classroom).forEach((workRequest) => {
    const entry = workRequestService.getEntryForStudent(workRequest, studentId);
    if (!entry || !entry.reviews) return;
    entry.reviews.forEach((review) => {
      awards.push({
        ...review,
        requestTitle: workRequest.title,
        subjectId: workRequest.subjectId,
        notebookTypeId: workRequest.notebookTypeId,
        isCurrent: review.id === getCurrentReview(entry)?.id,
        _sequence: sequence++,
      });
    });
  });

  return awards
    .sort((a, b) => (b.reviewedAt || '').localeCompare(a.reviewedAt || '') || b._sequence - a._sequence)
    .map(({ _sequence, ...award }) => award);
}

export { TIMELY_SUBMISSION_CRITERION_KEY };
