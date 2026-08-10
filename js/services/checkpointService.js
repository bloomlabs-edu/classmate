/**
 * services/checkpointService.js
 *
 * Sibling to workRequestService.js, not a caller of it or an
 * extension of it — see models/Checkpoint.js's own header comment
 * for exactly why WorkRequest itself couldn't be reused (its "one
 * open request at a time" constraint is fundamentally incompatible
 * with checkpoints coexisting permanently).
 *
 * `classroom.checkpoints` is a flat array, exactly mirroring
 * `classroom.workRequests`'s own shape — each checkpoint filtered by
 * `subjectId` + `notebookTypeId` to belong to the correct Notebook,
 * the same way WorkRequest already is. No new nesting pattern
 * introduced.
 *
 * Every mutating function here takes the actual Checkpoint object
 * (found via listCheckpointsForNotebook()/getCheckpointById() by the
 * caller) and mutates it in place, then the caller is responsible for
 * persisting the classroom — mirrors workRequestService.js's own
 * advanceStatus() convention exactly (mutate the passed-in object,
 * no return value, no persistence call inside the service itself).
 */

import { createCheckpoint } from '../models/Checkpoint.js';
import { createStudentCheckpointRecord } from '../models/StudentCheckpointRecord.js';
import * as notebookConfigService from './notebookConfigService.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function listCheckpointsForNotebook(classroom, subjectId, notebookTypeId) {
  return (classroom.checkpoints || [])
    .filter((c) => c.subjectId === subjectId && c.notebookTypeId === notebookTypeId)
    .sort((a, b) => a.order - b.order);
}

export function getCheckpointById(classroom, checkpointId) {
  return (classroom.checkpoints || []).find((c) => c.id === checkpointId) || null;
}

/**
 * `order` defaults to one past the current highest order within this
 * exact Notebook, so a newly-created checkpoint lands at the end of
 * the existing list by default — a teacher can still freely
 * reorder afterward via reorderCheckpoints().
 */
export function createNewCheckpoint(classroom, { subjectId, notebookTypeId, title, description, givenDate, dueDate }) {
  if (!classroom.checkpoints) classroom.checkpoints = [];

  const existingInNotebook = listCheckpointsForNotebook(classroom, subjectId, notebookTypeId);
  const nextOrder = existingInNotebook.length > 0 ? Math.max(...existingInNotebook.map((c) => c.order)) + 1 : 0;

  const checkpoint = createCheckpoint({
    subjectId,
    notebookTypeId,
    title,
    description,
    givenDate,
    dueDate,
    order: nextOrder,
  });
  classroom.checkpoints.push(checkpoint);
  return checkpoint;
}

/** Metadata only — title/description/givenDate/dueDate. Never touches `records`, `order`, or `id`; use reorderCheckpoints() for ordering. */
export function updateCheckpoint(checkpoint, { title, description, givenDate, dueDate }) {
  if (title !== undefined) checkpoint.title = title;
  if (description !== undefined) checkpoint.description = description;
  if (givenDate !== undefined) checkpoint.givenDate = givenDate;
  if (dueDate !== undefined) checkpoint.dueDate = dueDate;
}

export function deleteCheckpoint(classroom, checkpointId) {
  if (!classroom.checkpoints) return;
  classroom.checkpoints = classroom.checkpoints.filter((c) => c.id !== checkpointId);
}

/** Reassigns `order` for every checkpoint in one Notebook to match `orderedIds`'s own sequence — a checkpoint id present in this Notebook but omitted from `orderedIds` keeps its own existing order, rather than being silently dropped or reset. */
export function reorderCheckpoints(classroom, subjectId, notebookTypeId, orderedIds) {
  const checkpointsInNotebook = listCheckpointsForNotebook(classroom, subjectId, notebookTypeId);
  orderedIds.forEach((id, index) => {
    const checkpoint = checkpointsInNotebook.find((c) => c.id === id);
    if (checkpoint) checkpoint.order = index;
  });
}

/**
 * The one existing record for this student on this checkpoint, or
 * null — absence means exactly not_submitted + not_reviewed, per
 * explicit product decision. Never creates a record as a side effect
 * of reading.
 */
export function getRecordForStudent(checkpoint, studentId) {
  return (checkpoint.records || []).find((r) => r.studentId === studentId) || null;
}

/**
 * Finds or lazily creates this student's own record — the ONE place
 * a StudentCheckpointRecord is ever created, called only from
 * setSubmission()/setReview()/setTeacherNote() below, each of which
 * represents a genuine, real action a teacher just took. Never called
 * merely to read a value; getRecordForStudent() (above) is what
 * read-only callers use, and correctly returns null rather than
 * fabricating a record for a student nothing has happened to yet.
 */
function findOrCreateRecord(checkpoint, studentId) {
  if (!checkpoint.records) checkpoint.records = [];
  let record = checkpoint.records.find((r) => r.studentId === studentId);
  if (!record) {
    record = createStudentCheckpointRecord({ studentId });
    checkpoint.records.push(record);
  }
  return record;
}

/**
 * Sets this student's own submission — `status` is 'not_submitted' or
 * 'submitted'. Setting 'not_submitted' does NOT delete the record
 * outright (unlike goalCompletionService.js's own delete-to-unset
 * convention) — a record may still carry a genuine teacherNote worth
 * keeping even if a submission is walked back, and only the
 * submission/review fields themselves reset. `submittedDate` is
 * cleared automatically when status is 'not_submitted'.
 *
 * Also resets reviewStatus/reviewedDate back to 'not_reviewed'/null
 * in that same case — not optional cleanup. Without this, correcting
 * an already-reviewed record back to not_submitted would leave
 * reviewStatus still set, landing exactly on the one explicitly
 * disallowed state (not_submitted + reviewed) via a different path
 * than setReview()'s own direct check guards against. The constraint
 * must hold regardless of which function reaches it.
 */
export function setSubmission(checkpoint, studentId, { status, submittedDate = null }) {
  const record = findOrCreateRecord(checkpoint, studentId);
  record.submissionStatus = status;
  if (status === 'submitted') {
    record.submittedDate = submittedDate;
  } else {
    record.submittedDate = null;
    record.reviewStatus = 'not_reviewed';
    record.reviewedDate = null;
  }
  record.updatedAt = getCurrentIsoDate();
}

/**
 * Sets this student's own review outcome — `status` is 'not_reviewed'
 * | 'complete' | 'incomplete'. Enforces the one explicitly disallowed
 * state directly here, per explicit product decision: a student who
 * has not submitted cannot be marked 'complete' or 'incomplete' —
 * reviewing is something that happens to a submission. Throws rather
 * than silently clamping or ignoring the call, matching this app's
 * own "surface a genuine misuse, don't paper over it" convention
 * (see workRequestService.js's own createNewWorkRequest(), which
 * throws rather than silently no-op-ing on its own invalid-state
 * attempt).
 */
export function setReview(checkpoint, studentId, { status, reviewedDate = null }) {
  const existingSubmissionStatus = getRecordForStudent(checkpoint, studentId)?.submissionStatus ?? 'not_submitted';

  if (status !== 'not_reviewed' && existingSubmissionStatus !== 'submitted') {
    throw new Error(
      `Cannot mark a review outcome ("${status}") for a student who has not submitted this checkpoint. Record a submission first.`
    );
  }

  const record = findOrCreateRecord(checkpoint, studentId);
  record.reviewStatus = status;
  record.reviewedDate = status === 'not_reviewed' ? null : reviewedDate;
  record.updatedAt = getCurrentIsoDate();
}

/** A note is independent of both status dimensions — may be set on a student who has not submitted anything at all, per explicit product decision. Does not itself count as reviewing. */
export function setTeacherNote(checkpoint, studentId, note) {
  const record = findOrCreateRecord(checkpoint, studentId);
  record.teacherNote = note;
  record.updatedAt = getCurrentIsoDate();
}

/**
 * Pure derivation, never stored — true only when a real submission
 * date exists AND the checkpoint has a real due date AND the
 * submission genuinely came after it. A checkpoint with no dueDate
 * can never produce a late submission at all, by construction (the
 * `checkpoint.dueDate` check below is not optional/defensive
 * dressing — it is the entire point of this guard, per explicit
 * product decision: "a submission cannot be classified as late if
 * there is no due date").
 */
export function isLate(checkpoint, record) {
  if (!record || !record.submittedDate) return false;
  if (!checkpoint.dueDate) return false;
  return record.submittedDate > checkpoint.dueDate;
}

/**
 * Classroom-wide summary counts for one checkpoint — reads
 * `records` directly for the four original counts. `roster`
 * (optional, defaults to null) — when provided, also derives
 * notSubmittedCount (roster size minus submittedCount — genuinely
 * requires the full roster, since a student with no record at all
 * is, by sparse-record design, indistinguishable from one on this
 * function's own records array alone) and needsReviewCount
 * (submitted but not yet reviewed). Existing callers passing only
 * `checkpoint` get the exact same four fields as before, unchanged —
 * this extension is fully backward compatible, not a breaking change
 * to an already-tested function.
 */
export function getCheckpointSummary(checkpoint, roster = null) {
  const records = checkpoint.records || [];
  const summary = {
    submittedCount: records.filter((r) => r.submissionStatus === 'submitted').length,
    completeCount: records.filter((r) => r.reviewStatus === 'complete').length,
    incompleteCount: records.filter((r) => r.reviewStatus === 'incomplete').length,
    lateCount: records.filter((r) => isLate(checkpoint, r)).length,
  };
  if (roster) {
    summary.notSubmittedCount = roster.length - summary.submittedCount;
    summary.needsReviewCount = records.filter((r) => r.submissionStatus === 'submitted' && r.reviewStatus === 'not_reviewed').length;
  }
  return summary;
}
/**
 * Every checkpoint across every configured Notebook (Subject x
 * Notebook Type), grouped by Notebook, resolved against exactly one
 * student's own record — the read-only, student-facing counterpart
 * to the teacher grid. Deliberately filters by `studentId` at the
 * data layer, not left to the caller/view, so a Student Portal
 * screen built on this can never accidentally receive another
 * student's own record.
 *
 * Never creates a record for an untouched checkpoint/student pair —
 * getRecordForStudent() already, correctly returns null for that
 * case; this function simply carries that null straight through
 * rather than substituting a fabricated one, preserving the sparse-
 * record principle for the one new read path this milestone adds.
 */
export function getCheckpointsForStudentAcrossNotebooks(classroom, studentId) {
  const notebooks = [];

  notebookConfigService.listSubjects(classroom).forEach((subject) => {
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      const checkpoints = listCheckpointsForNotebook(classroom, subject.id, notebookType.id);
      if (checkpoints.length === 0) return; // an empty Notebook contributes nothing to a student's own view at all

      notebooks.push({
        subject,
        notebookType,
        checkpoints: checkpoints.map((checkpoint) => {
          const record = getRecordForStudent(checkpoint, studentId);
          return { checkpoint, record, late: isLate(checkpoint, record) };
        }),
      });
    });
  });

  return notebooks;
}
