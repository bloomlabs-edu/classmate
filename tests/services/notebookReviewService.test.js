/**
 * tests/services/notebookReviewService.test.js
 *
 * services/notebookReviewService.js — criteria-scored notebook reviews:
 * each default/custom criterion, the timely-vs-late boundary (and its
 * hard, server-side enforcement regardless of what a caller requests),
 * duplicate-award prevention, editing a review vs. reviewing a genuine
 * resubmission without ever double-counting, cumulative
 * notebook-recognition points kept separate from the student's whole-app
 * total, and full award-history auditability.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudent } from '../../js/models/Student.js';
import { createTeam } from '../../js/models/Team.js';
import * as workRequestService from '../../js/services/workRequestService.js';
import * as notebookConfigService from '../../js/services/notebookConfigService.js';
import * as notebookReviewService from '../../js/services/notebookReviewService.js';
import * as timelineService from '../../js/services/timelineService.js';
import * as recognitionService from '../../js/services/recognitionService.js';

function freshClassroom() {
  const student = createStudent({ id: 'stu1', name: 'Ann' });
  const team = createTeam({ id: 'team1', name: 'Team A', students: [student] });
  return {
    id: 'c1',
    teams: [team],
    workRequests: [],
    notebookConfig: { subjects: [], notebookTypes: [], reviewCriteria: [] },
  };
}

function getStudent(classroom) {
  return classroom.teams[0].students[0];
}

/** Creates a WorkRequest, advances the one student's entry to 'submitted', then pins its submission date to exactly `submittedDateKey` (direct field assignment — the same "set the historical fact directly" convention this repo's own date-boundary tests already use, since advanceStatus() itself always uses the real current instant). */
function createSubmittedRequest(classroom, { dueDate, submittedDateKey }) {
  const request = workRequestService.createNewWorkRequest(classroom, { title: 'Science Notebook', subjectId: 'sci', notebookTypeId: 'hw', dueDate });
  const studentId = getStudent(classroom).id;
  workRequestService.advanceStatus(request, studentId); // assigned -> submitted
  const entry = workRequestService.getEntryForStudent(request, studentId);
  entry.updatedAt = `${submittedDateKey}T10:00:00.000Z`;
  entry.history[entry.history.length - 1].date = entry.updatedAt;
  return { request, studentId, entry };
}

function criterionIdByLabel(classroom, label) {
  return notebookConfigService.listReviewCriteria(classroom).find((c) => c.label === label).id;
}

// ---------------------------------------------------------------------
// Each default criterion, checked and unchecked
// ---------------------------------------------------------------------

test('submitNotebookReview: every checked default criterion earns exactly 1 point, unchecked criteria earn 0', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });

  const neat = criterionIdByLabel(classroom, 'Neat handwriting');
  const organization = criterionIdByLabel(classroom, 'Organization');
  // Punctuation deliberately left UNCHECKED.

  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat, organization] });

  assert.ok(review);
  const labels = review.criteriaAwarded.map((c) => c.label).sort();
  assert.deepEqual(labels, ['Neat handwriting', 'Organization', 'Timely submission'].sort()); // on time, so Timely submission is also auto-awarded
  assert.equal(review.totalPoints, 3);
  review.criteriaAwarded.forEach((c) => assert.equal(c.points, 1));
});

test('submitNotebookReview: checking NO ordinary criteria at all still correctly awards only the auto-determined Timely submission one (when on time)', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });

  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [] });
  assert.equal(review.totalPoints, 1);
  assert.equal(review.criteriaAwarded[0].label, 'Timely submission');
});

// ---------------------------------------------------------------------
// Timely vs. late, including the due-date boundary itself
// ---------------------------------------------------------------------

test('timeliness: submission dated EXACTLY on the due date counts as on time (boundary is inclusive)', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-12-01' });
  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});
  assert.ok(review.criteriaAwarded.some((c) => c.label === 'Timely submission'));
  assert.equal(review.isLate, false);
});

test('timeliness: submission dated one day BEFORE the due date counts as on time', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-30' });
  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});
  assert.ok(review.criteriaAwarded.some((c) => c.label === 'Timely submission'));
});

test('timeliness: submission dated one day AFTER the due date is late — Timely submission is never awarded', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-12-02' });
  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});
  assert.equal(review.criteriaAwarded.some((c) => c.label === 'Timely submission'), false);
  assert.equal(review.isLate, true);
});

test('timeliness is determined by the SUBMISSION date, never the review date — a submission that was late stays late no matter how long it sits unreviewed', () => {
  const classroom = freshClassroom();
  // Submitted 2026-12-02 (a day late), "reviewed" happens much later — but
  // this service has no separate "review date" input at all; it only
  // ever reads entry.updatedAt (the submission) and workRequest.dueDate.
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-12-02' });
  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});
  assert.equal(review.isLate, true);
});

test('timeliness is NEVER caller-supplied — explicitly passing the system-determined criterion id while late does not award it', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-12-05' });
  const timelyId = criterionIdByLabel(classroom, 'Timely submission');

  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [timelyId] });
  assert.equal(review.criteriaAwarded.some((c) => c.criterionId === timelyId), false);
});

test('timeliness is NEVER caller-supplied — OMITTING the system-determined criterion id while on time still awards it', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-20' });
  // criterionIds deliberately omits the Timely submission id entirely.
  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [] });
  assert.ok(review.criteriaAwarded.some((c) => c.label === 'Timely submission'));
});

// ---------------------------------------------------------------------
// Custom criteria creation + reuse
// ---------------------------------------------------------------------

test('custom criteria: a teacher-added criterion can be awarded immediately, and is reusable across a SECOND, independent WorkRequest without recreating it', () => {
  const classroom = freshClassroom();
  const diagrams = notebookConfigService.addCustomReviewCriterion(classroom, 'Correctly labelled diagrams');

  const first = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const firstReview = notebookReviewService.submitNotebookReview(classroom, first.request, first.studentId, { criterionIds: [diagrams.id] });
  assert.ok(firstReview.criteriaAwarded.some((c) => c.criterionId === diagrams.id));

  // A second, later WorkRequest for the same classroom reuses the exact same catalog entry.
  const student2 = createStudent({ id: 'stu2', name: 'Ben' });
  classroom.teams[0].students.push(student2);
  const second = workRequestService.createNewWorkRequest(classroom, { title: 'Science Notebook 2', subjectId: 'sci', notebookTypeId: 'hw2', dueDate: '2026-12-10' });
  workRequestService.advanceStatus(second, student2.id);
  const secondReview = notebookReviewService.submitNotebookReview(classroom, second, student2.id, { criterionIds: [diagrams.id] });

  assert.ok(secondReview.criteriaAwarded.some((c) => c.criterionId === diagrams.id));
  assert.equal(notebookConfigService.listReviewCriteria(classroom).filter((c) => c.label === 'Correctly labelled diagrams').length, 1); // never duplicated
});

// ---------------------------------------------------------------------
// Duplicate award prevention
// ---------------------------------------------------------------------

test('duplicate prevention: passing the same criterionId twice in one review only ever counts it once', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');

  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat, neat, neat] });
  const neatAwards = review.criteriaAwarded.filter((c) => c.criterionId === neat);
  assert.equal(neatAwards.length, 1);
});

// ---------------------------------------------------------------------
// submitNotebookReview's own status guard
// ---------------------------------------------------------------------

test('submitNotebookReview: refuses (returns null) from "assigned" — nothing has been submitted yet', () => {
  const classroom = freshClassroom();
  const request = workRequestService.createNewWorkRequest(classroom, { title: 'X', subjectId: 'sci', notebookTypeId: 'hw', dueDate: '2026-12-01' });
  const studentId = getStudent(classroom).id;
  assert.equal(notebookReviewService.submitNotebookReview(classroom, request, studentId, {}), null);
});

test('submitNotebookReview: a second call while already "reviewed" is rejected — a double-tap/race can never double-award', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });

  const first = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});
  assert.ok(first);
  const second = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});
  assert.equal(second, null);

  const student = getStudent(classroom);
  assert.equal(timelineService.getNetPoints(student), first.totalPoints); // not doubled
});

test('submitNotebookReview: advances the entry to "reviewed" exactly like the plain one-tap advanceStatus() would — every other workRequestService reader keeps working', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  notebookReviewService.submitNotebookReview(classroom, request, studentId, {});

  const entry = workRequestService.getEntryForStudent(request, studentId);
  assert.equal(entry.status, 'reviewed');
  assert.equal(entry.reviewOutcome, 'complete');
  assert.equal(workRequestService.getStudentSummary(classroom, studentId).reviewed, 1);
});

// ---------------------------------------------------------------------
// Editing a review — correction, never a second full award
// ---------------------------------------------------------------------

test('editNotebookReview: refuses (returns null) unless the entry is already "reviewed"', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  // Still 'submitted' — never reviewed yet.
  assert.equal(notebookReviewService.editNotebookReview(classroom, request, studentId, {}), null);
});

test('editNotebookReview: refuses (returns null) for a legacy "reviewed" entry with no reviews array at all', () => {
  const classroom = freshClassroom();
  const request = workRequestService.createNewWorkRequest(classroom, { title: 'X', subjectId: 'sci', notebookTypeId: 'hw', dueDate: '2026-12-01' });
  const studentId = getStudent(classroom).id;
  workRequestService.advanceStatus(request, studentId); // -> submitted
  workRequestService.advanceStatus(request, studentId); // -> reviewed, via the OLD plain path, no `reviews` ever created
  assert.equal(notebookReviewService.editNotebookReview(classroom, request, studentId, {}), null);
});

test('editNotebookReview: increasing the awarded criteria logs only the POSITIVE DELTA, never the new total on top of the old one', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');
  const organization = criterionIdByLabel(classroom, 'Organization');

  const original = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] });
  assert.equal(original.totalPoints, 2); // Timely + Neat

  const corrected = notebookReviewService.editNotebookReview(classroom, request, studentId, { criterionIds: [neat, organization] });
  assert.equal(corrected.totalPoints, 3); // Timely + Neat + Organization
  assert.equal(corrected.supersedesReviewId, original.id);

  const student = getStudent(classroom);
  assert.equal(timelineService.getNetPoints(student), 3); // NOT 2 + 3 = 5
});

test('editNotebookReview: decreasing the awarded criteria logs a NEGATIVE delta, never lets the cumulative total go below the corrected true value', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');
  const organization = criterionIdByLabel(classroom, 'Organization');

  notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat, organization] }); // Timely + Neat + Org = 3
  notebookReviewService.editNotebookReview(classroom, request, studentId, { criterionIds: [] }); // corrected down to just Timely = 1

  const student = getStudent(classroom);
  assert.equal(timelineService.getNetPoints(student), 1);
});

test('editNotebookReview: a ZERO-delta correction (re-saving the exact same criteria) logs NO new timeline entry at all, but still records the new review for audit purposes', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');

  notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] });
  const student = getStudent(classroom);
  const historyLengthBefore = student.history.length;

  const corrected = notebookReviewService.editNotebookReview(classroom, request, studentId, { criterionIds: [neat] });
  assert.equal(student.history.length, historyLengthBefore); // no new timeline entry
  assert.equal(corrected.pointsEntryId, workRequestService.getEntryForStudent(request, studentId).reviews[0].pointsEntryId); // carries the ORIGINAL entry id forward
});

test('editNotebookReview: the original review is never mutated — it stays exactly as it was, permanently, for audit', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');

  const original = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] });
  const originalSnapshot = JSON.parse(JSON.stringify(original));

  notebookReviewService.editNotebookReview(classroom, request, studentId, { criterionIds: [] });

  const entry = workRequestService.getEntryForStudent(request, studentId);
  const stillThere = entry.reviews.find((r) => r.id === original.id);
  assert.deepEqual(stillThere, originalSnapshot);
  assert.equal(entry.reviews.length, 2); // appended, never replaced
});

// ---------------------------------------------------------------------
// Reviewing a resubmission — an independent, full-value review, never an edit
// ---------------------------------------------------------------------

test('resubmission: resetting and resubmitting after a review creates a SECOND, INDEPENDENT review — not a correction of the first, and never a double-count', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');

  const firstReview = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] }); // Timely + Neat = 2
  assert.equal(firstReview.totalPoints, 2);

  // Teacher resets, student genuinely resubmits (new, later date), teacher reviews again.
  workRequestService.resetWorkRequestEntry(request, studentId);
  workRequestService.advanceStatus(request, studentId); // -> submitted again
  const entry = workRequestService.getEntryForStudent(request, studentId);
  entry.updatedAt = '2026-12-05T10:00:00.000Z'; // now late
  entry.history[entry.history.length - 1].date = entry.updatedAt;

  const secondReview = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] }); // late now -> only Neat = 1
  assert.equal(secondReview.totalPoints, 1);
  assert.equal(secondReview.supersedesReviewId, null); // NOT a correction of the first

  const student = getStudent(classroom);
  assert.equal(timelineService.getNetPoints(student), 3); // 2 + 1, both independently real
  assert.equal(entry.reviews.length, 2);
  assert.equal(entry.reviews[0].id, firstReview.id); // the original is untouched
});

// ---------------------------------------------------------------------
// Cumulative notebook-recognition points — scoped, never conflated with
// the student's whole-app total, and never the SAME number as one
// review's own score.
// ---------------------------------------------------------------------

test('getCumulativeNotebookRecognitionPoints: sums only notebook_review(_correction) sourced points, ignoring every other star source on the same history log', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');
  notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] }); // +2 notebook points

  const student = getStudent(classroom);
  recognitionService.awardManualStar(student, { label: 'Great participation' }); // +1, unrelated source

  assert.equal(notebookReviewService.getCumulativeNotebookRecognitionPoints(student), 2); // only the notebook-review points
  assert.equal(timelineService.getNetPoints(student), 3); // whole-app total includes BOTH sources
});

test('the review\'s own score and the student\'s cumulative total are never the same number when they genuinely differ — proves they are tracked independently, not conflated', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, {}); // this ONE review: Timely only = 1

  const student = getStudent(classroom);
  recognitionService.awardManualStar(student, { label: 'Bonus' }); // cumulative total now includes this too

  assert.equal(review.totalPoints, 1);
  assert.equal(notebookReviewService.getCumulativeNotebookRecognitionPoints(student), 1);
  assert.equal(timelineService.getNetPoints(student), 2); // genuinely different from both of the above
});

// ---------------------------------------------------------------------
// Auditability — student, submission, criterion, awarding teacher,
// timestamp, point value, all present and inspectable.
// ---------------------------------------------------------------------

test('every award is fully auditable: student, submission (requestId), criteria, awarding teacher uid, timestamp, and point value are all present', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');

  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat], reviewedByUid: 'teacher-42' });

  assert.equal(review.studentId, studentId);
  assert.equal(review.requestId, request.id);
  assert.equal(review.reviewedByUid, 'teacher-42');
  assert.equal(typeof review.reviewedAt, 'string');
  assert.ok(review.reviewedAt.length > 0);
  review.criteriaAwarded.forEach((c) => {
    assert.equal(typeof c.criterionId, 'string');
    assert.equal(typeof c.label, 'string');
    assert.equal(c.points, 1);
  });

  // The points themselves are traceable back to a real timelineService entry.
  const student = getStudent(classroom);
  const timelineEntry = student.history.find((e) => e.id === review.pointsEntryId);
  assert.ok(timelineEntry);
  assert.equal(timelineEntry.delta, review.totalPoints);
  assert.equal(timelineEntry.source, 'notebook_review');
});

test('getNotebookReviewAwardHistory: returns every review (current and superseded) for a student, newest first, with notebook identity attached', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const neat = criterionIdByLabel(classroom, 'Neat handwriting');

  const original = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] });
  const corrected = notebookReviewService.editNotebookReview(classroom, request, studentId, { criterionIds: [] });

  const history = notebookReviewService.getNotebookReviewAwardHistory(classroom, studentId);
  assert.equal(history.length, 2);
  assert.equal(history[0].id, corrected.id); // newest first
  assert.equal(history[0].isCurrent, true);
  assert.equal(history[1].id, original.id);
  assert.equal(history[1].isCurrent, false); // superseded, but still listed — never hidden
  assert.equal(history[0].requestTitle, 'Science Notebook');
  assert.equal(history[0].subjectId, 'sci');
  assert.equal(history[0].notebookTypeId, 'hw');
});

// ---------------------------------------------------------------------
// Existing recognition/star and WorkRequest behavior preserved
// ---------------------------------------------------------------------

test('existing recognition behavior is completely unaffected: automatic completion stars and manual stars keep working exactly as before alongside notebook-review points', () => {
  const classroom = freshClassroom();
  const student = getStudent(classroom);
  const ref = recognitionService.buildNotebookCheckpointWorkItemRef({ subjectId: 'sci', notebookTypeId: 'hw', checkpointId: 'cp1' });

  recognitionService.awardAutomaticCompletionStar(student, ref);
  assert.equal(timelineService.getNetPoints(student), 1);

  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  notebookReviewService.submitNotebookReview(classroom, request, studentId, {});

  assert.equal(timelineService.getNetPoints(student), 2); // 1 (existing) + 1 (new notebook review) — neither clobbered the other
});

test('existing WorkRequest lifecycle (needs_correction / resubmitted / Mark Incomplete) is untouched by this feature — only "Mark Reviewed" gained criteria scoring', () => {
  const classroom = freshClassroom();
  const request = workRequestService.createNewWorkRequest(classroom, { title: 'X', subjectId: 'sci', notebookTypeId: 'hw', dueDate: '2026-12-01' });
  const studentId = getStudent(classroom).id;

  workRequestService.advanceStatus(request, studentId); // -> submitted
  workRequestService.markNeedsCorrection(request, studentId);
  assert.equal(workRequestService.getEntryForStudent(request, studentId).status, 'needs_correction');

  workRequestService.advanceStatus(request, studentId); // -> resubmitted
  assert.equal(workRequestService.getEntryForStudent(request, studentId).status, 'resubmitted');

  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});
  assert.ok(review);
  assert.equal(workRequestService.getEntryForStudent(request, studentId).status, 'reviewed');
});

// ---------------------------------------------------------------------
// Missing-student validation (targeted fix) — an orphaned
// WorkRequestEntry (the student was later removed from the roster,
// while workRequestService itself never cleans up existing entries)
// must never produce a review claiming points with nothing on the
// ledger to back it. Rejected BEFORE any mutation at all.
// ---------------------------------------------------------------------

test('submitNotebookReview: rejects (returns null) when the studentId no longer resolves to a real student, WITHOUT mutating status, history, or reviews', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const entry = workRequestService.getEntryForStudent(request, studentId);
  const entrySnapshotBefore = JSON.parse(JSON.stringify(entry));

  // Simulate the student being removed from the roster after the
  // WorkRequestEntry was created — the entry itself is never cleaned
  // up by workRequestService, so it's still sitting at 'submitted'.
  classroom.teams[0].students = [];

  const result = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});

  assert.equal(result, null);
  assert.deepEqual(workRequestService.getEntryForStudent(request, studentId), entrySnapshotBefore); // status/history untouched
  assert.equal(entry.reviews, undefined); // no review record ever appended
});

test('editNotebookReview: rejects (returns null) when the studentId no longer resolves to a real student, WITHOUT mutating reviews or the ledger — even for a zero-delta edit', () => {
  const classroom = freshClassroom();
  const { request, studentId } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const original = notebookReviewService.submitNotebookReview(classroom, request, studentId, {}); // reviewed while the student still exists
  assert.ok(original);

  const entry = workRequestService.getEntryForStudent(request, studentId);
  const entrySnapshotBefore = JSON.parse(JSON.stringify(entry));

  // Student removed AFTER the original review — editing it afterward
  // must be rejected, never silently re-appended with no ledger entry.
  const removedStudent = classroom.teams[0].students[0];
  classroom.teams[0].students = [];

  const result = notebookReviewService.editNotebookReview(classroom, request, studentId, { criterionIds: [] }); // same criteria -> would be a zero-delta edit if it ran at all

  assert.equal(result, null);
  assert.deepEqual(workRequestService.getEntryForStudent(request, studentId), entrySnapshotBefore); // entry.reviews still has exactly the one original review, untouched
  assert.equal(entry.reviews.length, 1);
  assert.equal(removedStudent.history.length, 1); // the original award's own single history entry — no new entry, no removal
});

test('submitNotebookReview: the missing-student rejection returns the SAME null sentinel every other rejection path already uses (no missing entry, no bad status, no missing student — all strictly ===null, never a different failure shape)', () => {
  const classroom = freshClassroom();
  const request = workRequestService.createNewWorkRequest(classroom, { title: 'X', subjectId: 'sci', notebookTypeId: 'hw', dueDate: '2026-12-01' });
  const studentId = getStudent(classroom).id;
  workRequestService.advanceStatus(request, studentId); // -> submitted
  classroom.teams[0].students = [];

  const missingStudentResult = notebookReviewService.submitNotebookReview(classroom, request, studentId, {});
  const unknownEntryResult = notebookReviewService.submitNotebookReview(classroom, request, 'no-such-student-id', {});

  assert.equal(missingStudentResult, null);
  assert.equal(unknownEntryResult, null);
});
