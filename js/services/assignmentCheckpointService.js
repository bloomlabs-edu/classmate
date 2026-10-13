/**
 * services/assignmentCheckpointService.js
 *
 * Sibling to services/checkpointService.js, mirroring its exact shape
 * (classroom.assignmentCheckpoints as a flat array, same create/update/
 * delete/reorder/setSubmission/setReview/isLate/getCheckpointSummary
 * functions, same "service mutates the passed-in object, caller
 * persists" convention) — see models/AssignmentCheckpoint.js's own
 * header comment for why this is a parallel, not a reuse-by-import of
 * checkpointService.js itself (its own identity pair is `assignmentId`
 * only, not subjectId+notebookTypeId).
 *
 * REUSES models/StudentCheckpointRecord.js verbatim — the submission/
 * review workflow this redesign needs is identical to Notebook's own,
 * so nothing new was modeled for it.
 *
 * This is the "checkpoint completion" tracking axis for one Assignment
 * — deliberately independent of, and never merged with, that same
 * Assignment's own Overall Rating (services/assignmentService.js's
 * setRating()/getRecordForStudent() against models/StudentAssignmentRecord.js).
 * Checkpoint completion is workflow (did they submit it, was it
 * reviewed); Overall Rating is quality (how good was it). Neither
 * function in this file ever reads or writes `assignment.records`, and
 * neither assignmentService.js function ever reads or writes
 * `classroom.assignmentCheckpoints` — the two axes coexist on the same
 * screen but share no code path, per explicit product instruction not
 * to conflate checkpoint completion with Overall Rating, concept
 * understanding, or examination marks.
 */

import { createAssignmentCheckpoint } from '../models/AssignmentCheckpoint.js';
import { createStudentCheckpointRecord } from '../models/StudentCheckpointRecord.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function listCheckpointsForAssignment(classroom, assignmentId) {
  return (classroom.assignmentCheckpoints || [])
    .filter((c) => c.assignmentId === assignmentId)
    .sort((a, b) => a.order - b.order);
}

export function getCheckpointById(classroom, checkpointId) {
  return (classroom.assignmentCheckpoints || []).find((c) => c.id === checkpointId) || null;
}

/**
 * `order` defaults to one past the current highest order within this
 * exact Assignment, mirroring checkpointService.js's own
 * createNewCheckpoint(). A teacher can still freely reorder afterward
 * via reorderCheckpoints().
 */
export function createNewCheckpoint(classroom, { assignmentId, title, description, givenDate, dueDate }) {
  if (!classroom.assignmentCheckpoints) classroom.assignmentCheckpoints = [];

  const existingForAssignment = listCheckpointsForAssignment(classroom, assignmentId);
  const nextOrder = existingForAssignment.length > 0 ? Math.max(...existingForAssignment.map((c) => c.order)) + 1 : 0;

  const checkpoint = createAssignmentCheckpoint({
    assignmentId,
    title,
    description,
    givenDate,
    dueDate,
    order: nextOrder,
  });
  classroom.assignmentCheckpoints.push(checkpoint);
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
  if (!classroom.assignmentCheckpoints) return;
  classroom.assignmentCheckpoints = classroom.assignmentCheckpoints.filter((c) => c.id !== checkpointId);
}

/**
 * Everything this Assignment's own checkpoints would lose if the
 * Assignment itself were deleted right now — the data a caller needs to
 * build an honest, specific delete-confirmation message, mirroring
 * checkpointService.js's own countCheckpointImpactForNotebook(). Pure
 * read, no mutation.
 */
export function countCheckpointImpactForAssignment(classroom, assignmentId) {
  const checkpoints = listCheckpointsForAssignment(classroom, assignmentId);
  const recordCount = checkpoints.reduce((sum, c) => sum + (c.records || []).length, 0);
  return { checkpointCount: checkpoints.length, recordCount };
}

/**
 * Cascade-deletes every checkpoint belonging to one Assignment — must be
 * called BEFORE assignmentService.deleteAssignment(), while assignmentId
 * can still resolve this Assignment's own checkpoints, exactly mirroring
 * checkpointService.js's own deleteAllCheckpointsForNotebook() /
 * assignmentService.js's own deleteAllAssignmentsForCategory(). Reuses
 * deleteCheckpoint() per checkpoint rather than a bespoke bulk filter,
 * so this stays exactly as safe as deleting one checkpoint by hand.
 */
export function deleteAllCheckpointsForAssignment(classroom, assignmentId) {
  listCheckpointsForAssignment(classroom, assignmentId).forEach((checkpoint) => {
    deleteCheckpoint(classroom, checkpoint.id);
  });
}

/** Reassigns `order` for every checkpoint in one Assignment to match `orderedIds`'s own sequence — a checkpoint id present in this Assignment but omitted from `orderedIds` keeps its own existing order, rather than being silently dropped or reset. */
export function reorderCheckpoints(classroom, assignmentId, orderedIds) {
  const checkpointsForAssignment = listCheckpointsForAssignment(classroom, assignmentId);
  orderedIds.forEach((id, index) => {
    const checkpoint = checkpointsForAssignment.find((c) => c.id === id);
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
 * Finds or lazily creates this student's own record — the ONE place a
 * StudentCheckpointRecord is ever created here, called only from
 * setSubmission()/setReview()/setTeacherNote() below, each representing
 * a genuine, real action a teacher just took.
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
 * 'submitted'. Mirrors checkpointService.js's own setSubmission()
 * exactly, including resetting reviewStatus/reviewedDate back to
 * 'not_reviewed'/null when walked back to 'not_submitted', so the one
 * explicitly disallowed state (not_submitted + reviewed) can never be
 * reached via this path either.
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
 * | 'complete' | 'incomplete'. Enforces the same guard
 * checkpointService.js's own setReview() does: a student who has not
 * submitted cannot be marked 'complete' or 'incomplete'.
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

/** A note is independent of both status dimensions — may be set on a student who has not submitted anything at all. */
export function setTeacherNote(checkpoint, studentId, note) {
  const record = findOrCreateRecord(checkpoint, studentId);
  record.teacherNote = note;
  record.updatedAt = getCurrentIsoDate();
}

/**
 * Pure derivation, never stored — true only when a real submission date
 * exists AND the checkpoint has a real due date AND the submission
 * genuinely came after it, mirroring checkpointService.js's own
 * isLate() exactly.
 */
export function isLate(checkpoint, record) {
  if (!record || !record.submittedDate) return false;
  if (!checkpoint.dueDate) return false;
  return record.submittedDate > checkpoint.dueDate;
}

/**
 * Classroom-wide summary counts for one checkpoint, mirroring
 * checkpointService.js's own getCheckpointSummary() exactly, including
 * the optional `roster` extension.
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
 * One student's overall progress across every checkpoint on one
 * Assignment — "3 of 4 submitted" style derived evidence, the
 * checkpoint-completion counterpart to assignmentService.js's own
 * getAssignmentCellStatus() (which derives status from Overall Rating
 * instead). Used by the per-assignment tracker's own "overall progress"
 * column and by Student Profile evidence (see
 * services/assignmentService.js's own getAssignmentsForStudent(), §6 of
 * the approved design). Returns null fields when the Assignment has no
 * checkpoints at all yet — never a fabricated 0/0.
 */
export function getStudentCheckpointProgress(classroom, assignmentId, studentId) {
  const checkpoints = listCheckpointsForAssignment(classroom, assignmentId);
  if (checkpoints.length === 0) return { totalCount: 0, submittedCount: null, completeCount: null };

  const records = checkpoints.map((checkpoint) => getRecordForStudent(checkpoint, studentId));
  return {
    totalCount: checkpoints.length,
    submittedCount: records.filter((r) => r?.submissionStatus === 'submitted').length,
    completeCount: records.filter((r) => r?.reviewStatus === 'complete').length,
  };
}
