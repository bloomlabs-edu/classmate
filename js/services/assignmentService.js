/**
 * services/assignmentService.js
 *
 * Sibling to services/checkpointService.js, mirroring its exact shape
 * (classroom.assignments as a flat array, same create/update/delete/
 * reorder functions, same "service mutates the passed-in object, caller
 * persists" convention) — see models/Assignment.js's own header comment
 * for why this is a parallel, not a reuse-by-import of checkpointService
 * itself (Assignments has its own identity pair — categoryId only, no
 * subjectId/notebookTypeId — and its own generalized ratings tracking
 * instead of Checkpoint's hardcoded submission/review).
 *
 * `ratings`/`teacherNote` above have NO scoreboard-point integration of
 * their own — nothing in the original Assignments brief asked for
 * automatic scoring from them. The one exception is `completionStatus`
 * (Workstream 4C, see setCompletionStatus()/getCompletionStatus() below
 * and models/StudentAssignmentRecord.js's own header comment for why
 * it's a third, independent axis) — its Done/Not Done toggle DOES drive
 * an automatic Completion Star, via services/recognitionService.js's
 * own recordAssignmentCompletion(), which wraps setCompletionStatus()
 * here exactly like every other wrapper in that file wraps its own
 * underlying service call.
 */

import { createAssignment } from '../models/Assignment.js';
import { createStudentAssignmentRecord } from '../models/StudentAssignmentRecord.js';
import * as assignmentConfigService from './assignmentConfigService.js';
import { generateWorksheetCode } from './worksheetCodeService.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/**
 * Same structural-limitation shape as checkpointService.js's own
 * CHECKPOINT_DELETION_STRUCTURAL_LIMITATION, for the same reason:
 * deleteAssignment() below is a hard, in-place array filter — no
 * tombstone, no `deletedAt`, no trace left anywhere else. An Assignment
 * that no longer appears in `classroom.assignments` is indistinguishable
 * from one that never existed, so services/recognitionService.js's own
 * Completion Star audit (auditCompletionStarsForClassroom()) can never
 * treat "this assignment can't be found" as proof that an active
 * assignment-completion star is wrong — it is reported as
 * structurally unverifiable, never as a concrete rule violation, and is
 * never, on its own, grounds to revoke an existing award.
 */
export const ASSIGNMENT_DELETION_STRUCTURAL_LIMITATION =
  'Assignment deletion is undetectable in this data model: deleteAssignment() removes an ' +
  'assignment and every student record attached to it with no tombstone, no deletedAt flag, ' +
  'and no trace left anywhere else. This audit cannot confirm whether a deleted assignment\'s ' +
  'own completion status was still genuinely "done" at the time it was removed. This is a ' +
  'structural limitation of the entire historical audit, not evidence that any individual ' +
  'award below is incorrect, and is never, on its own, grounds to revoke an existing award.';

export function listAssignmentsForCategory(classroom, categoryId) {
  return (classroom.assignments || [])
    .filter((a) => a.categoryId === categoryId)
    .sort((a, b) => a.order - b.order);
}

export function getAssignmentById(classroom, assignmentId) {
  return (classroom.assignments || []).find((a) => a.id === assignmentId) || null;
}

/**
 * `order` defaults to one past the current highest order within this
 * exact category, mirroring checkpointService.js's own
 * createNewCheckpoint(). `subjectId`/`unitId` are optional, `null`-safe,
 * same reference-not-copy convention as `conceptIds`. `code` is
 * generated here, once, via services/worksheetCodeService.js — never
 * accepted as a caller-supplied param, so nothing can ever create an
 * Assignment with a teacher-typed or duplicated code (see that
 * service's own header comment).
 */
export function createNewAssignment(classroom, { categoryId, title, description, givenDate, dueDate, conceptIds, resourceUrl, subjectId, unitId, categoryName = null }) {
  if (!classroom.assignments) classroom.assignments = [];

  const existingInCategory = listAssignmentsForCategory(classroom, categoryId);
  const nextOrder = existingInCategory.length > 0 ? Math.max(...existingInCategory.map((a) => a.order)) + 1 : 0;

  const code = generateWorksheetCode(classroom, { subjectId, unitId, categoryName });
  const assignment = createAssignment({ categoryId, title, description, givenDate, dueDate, order: nextOrder, conceptIds, resourceUrl, subjectId, unitId, code });
  classroom.assignments.push(assignment);
  return assignment;
}

/**
 * Metadata only — title/description/givenDate/dueDate/conceptIds/
 * resourceUrl/subjectId/unitId/categoryId. Never touches `records`,
 * `order`, `id`, or `code` (see models/Assignment.js's own `code` field
 * comment: generated once at creation, never regenerated even if
 * Subject/Unit change later) — use reorderAssignments() for ordering.
 * `categoryId` is included here (unlike the retired per-category
 * creation flow) because the redesigned landing page lets a teacher
 * change an Assignment's own Type after creation, not just at creation
 * time.
 */
export function updateAssignment(assignment, { title, description, givenDate, dueDate, conceptIds, resourceUrl, subjectId, unitId, categoryId }) {
  if (title !== undefined) assignment.title = title;
  if (description !== undefined) assignment.description = description;
  if (givenDate !== undefined) assignment.givenDate = givenDate;
  if (dueDate !== undefined) assignment.dueDate = dueDate;
  if (conceptIds !== undefined) assignment.conceptIds = conceptIds;
  if (resourceUrl !== undefined) assignment.resourceUrl = resourceUrl;
  if (subjectId !== undefined) assignment.subjectId = subjectId;
  if (unitId !== undefined) assignment.unitId = unitId;
  if (categoryId !== undefined) assignment.categoryId = categoryId;
}

/**
 * Every Assignment (across every category, classroom-wide) linked to
 * one Concept — the "Concept -> linked Assignments" reverse direction.
 * A plain filter, never a stored back-reference, exactly mirroring
 * services/sparkService.js's identical conceptIds.includes() pattern —
 * see models/Assignment.js's own header comment on why.
 */
export function listAssignmentsForConcept(classroom, conceptId) {
  return (classroom.assignments || []).filter((a) => (a.conceptIds || []).includes(conceptId));
}

export function deleteAssignment(classroom, assignmentId) {
  classroom.assignments = (classroom.assignments || []).filter((a) => a.id !== assignmentId);
}

export function reorderAssignments(classroom, categoryId, orderedIds) {
  const assignmentsInCategory = listAssignmentsForCategory(classroom, categoryId);
  orderedIds.forEach((id, index) => {
    const assignment = assignmentsInCategory.find((a) => a.id === id);
    if (assignment) assignment.order = index;
  });
}

/** How many Assignments (and their own student records) one category owns — for an honest delete-confirmation message, same purpose as checkpointService.js's own countCheckpointImpactForNotebook(). */
export function countAssignmentImpactForCategory(classroom, categoryId) {
  const assignments = listAssignmentsForCategory(classroom, categoryId);
  const recordCount = assignments.reduce((sum, a) => sum + (a.records || []).length, 0);
  return { assignmentCount: assignments.length, recordCount };
}

/** Cascade-deletes every Assignment belonging to one category — must be called BEFORE assignmentConfigService.removeCategory(), mirroring checkpointService.js's own deleteAllCheckpointsForNotebook(). */
export function deleteAllAssignmentsForCategory(classroom, categoryId) {
  listAssignmentsForCategory(classroom, categoryId).forEach((assignment) => {
    deleteAssignment(classroom, assignment.id);
  });
}

export function getRecordForStudent(assignment, studentId) {
  return (assignment.records || []).find((r) => r.studentId === studentId) || null;
}

function findOrCreateRecord(assignment, studentId) {
  if (!assignment.records) assignment.records = [];
  let record = assignment.records.find((r) => r.studentId === studentId);
  if (!record) {
    record = createStudentAssignmentRecord({ studentId });
    assignment.records.push(record);
  }
  return record;
}

/** Sets one student's rating for one aspect of this assignment — 'not_yet' | 'developing' | 'met'. The one place a StudentAssignmentRecord is ever created as a side effect of real teacher action, same convention as checkpointService.js's own setSubmission()/setReview(). */
export function setRating(assignment, studentId, aspectId, rating) {
  const record = findOrCreateRecord(assignment, studentId);
  record.ratings = { ...record.ratings, [aspectId]: rating };
  record.updatedAt = getCurrentIsoDate();
  return record;
}

export function setTeacherNote(assignment, studentId, note) {
  const record = findOrCreateRecord(assignment, studentId);
  record.teacherNote = note;
  record.updatedAt = getCurrentIsoDate();
}

/**
 * Assignment-level completion — a THIRD, independent tracking axis
 * from `ratings` above and from AssignmentCheckpoint's own submission/
 * review (see models/StudentAssignmentRecord.js's own `completionStatus`
 * field comment). `status` is 'done' | 'not_done'; passing `null`
 * clears it back to "Not Recorded." The one place this field is ever
 * written, mirroring setRating()'s own lazy-create-on-real-action
 * convention exactly.
 */
export function setCompletionStatus(assignment, studentId, status) {
  const record = findOrCreateRecord(assignment, studentId);
  record.completionStatus = status;
  record.updatedAt = getCurrentIsoDate();
  return record;
}

/** 'done' | 'not_done' | 'not_recorded' — the sparse "no record, or no explicit status yet, means Not Recorded" read, mirroring checkpointService.js's own getRecordForStudent() null-means-nothing-happened convention. */
export function getCompletionStatus(assignment, studentId) {
  const record = getRecordForStudent(assignment, studentId);
  return record?.completionStatus || 'not_recorded';
}

/** Classroom-wide Done/Not Done/Not Recorded counts for one assignment — `roster` is required (unlike getAssignmentSummary()'s optional one) since "Not Recorded" can only be known by comparing against who exists at all, exactly like checkpointService.js's own notSubmittedCount derivation. */
export function getAssignmentCompletionSummary(assignment, roster) {
  const doneCount = roster.filter((student) => getCompletionStatus(assignment, student.id) === 'done').length;
  const notDoneCount = roster.filter((student) => getCompletionStatus(assignment, student.id) === 'not_done').length;
  return { doneCount, notDoneCount, notRecordedCount: roster.length - doneCount - notDoneCount };
}

/**
 * Derives one at-a-glance status from a record's own open ratings map,
 * resolved against the category's CURRENT aspect list — the
 * generalized counterpart to NotebookCheckpointsView.js's own
 * getCellMeta(), reused here rather than duplicated since both drive
 * the exact same four-color chip language (see that function's own
 * header comment): 'not_started' (red) | 'in_progress' (purple) |
 * 'needs_attention' (orange) | 'complete' (green).
 *
 *   not_started     - no record, or no aspect has been rated yet
 *   in_progress     - at least one aspect rated, but not every current
 *                      aspect has a rating yet
 *   needs_attention - every current aspect is rated, and at least one
 *                      is 'not_yet' or 'developing'
 *   complete        - every current aspect is rated 'met'
 *
 * Only ever reads ratings for aspects the category CURRENTLY defines —
 * a stale rating left behind by a since-removed aspect (see
 * assignmentConfigService.js's own removeAspect()) is simply never
 * consulted, never resurrected into this derivation.
 */
export function getAssignmentCellStatus(category, record) {
  const aspects = assignmentConfigService.listAspects(category);
  if (aspects.length === 0 || !record) return 'not_started';

  const ratings = aspects.map((aspect) => record.ratings?.[aspect.id]).filter(Boolean);
  if (ratings.length === 0) return 'not_started';
  if (ratings.length < aspects.length) return 'in_progress';
  return ratings.every((r) => r === 'met') ? 'complete' : 'needs_attention';
}

/** Classroom-wide summary counts for one assignment, mirroring checkpointService.js's own getCheckpointSummary(). `roster` (optional) also derives notStartedCount. */
export function getAssignmentSummary(category, assignment, roster = null) {
  const records = assignment.records || [];
  const statuses = records.map((record) => getAssignmentCellStatus(category, record));

  const summary = {
    inProgressCount: statuses.filter((s) => s === 'in_progress').length,
    needsAttentionCount: statuses.filter((s) => s === 'needs_attention').length,
    completeCount: statuses.filter((s) => s === 'complete').length,
  };
  if (roster) {
    const startedCount = statuses.filter((s) => s !== 'not_started').length;
    summary.notStartedCount = roster.length - startedCount;
  }
  return summary;
}

// ---------------------------------------------------------------------
// Student Profile evidence (derived — see ui/views/StudentProfileView.js's
// own "Assignments" tab). Nothing here ever writes anywhere — Assignment
// itself stays the one source record (per this project's own
// source-of-truth principle); these functions only ever READ it back out
// in a shape a profile can render. Nothing here ever touches
// `student.learningRecord` — assignment completion is evidence about an
// assignment, never interpreted as concept mastery/understanding, which
// stays a separate, student-controlled field (see
// models/StudentConceptRecord.js's own header comment).
// ---------------------------------------------------------------------

/**
 * Every Assignment one student has an actual record on (across every
 * category, classroom-wide), most recently updated first — the raw
 * data behind a Student Profile's "Assignments" evidence, same
 * "nothing shown until something real has happened" sparse philosophy
 * this whole feature already uses (see models/StudentAssignmentRecord.js's
 * own header comment) — mirrors
 * services/workRequestService.js's own getNotebooksForStudent() shape
 * for the equivalent Notebooks tab.
 */
export function getAssignmentsForStudent(classroom, studentId) {
  return (classroom.assignments || [])
    .map((assignment) => ({ assignment, record: getRecordForStudent(assignment, studentId) }))
    .filter(({ record }) => record !== null)
    .map(({ assignment, record }) => {
      const category = assignmentConfigService.getCategoryById(classroom, assignment.categoryId);
      return { assignment, category, record, status: category ? getAssignmentCellStatus(category, record) : 'not_started' };
    })
    .sort((a, b) => new Date(b.record.updatedAt) - new Date(a.record.updatedAt));
}

/** Classroom-wide status counts for one student across every Assignment they have an actual record on — the stat row above a Student Profile's Assignments list, mirroring services/workRequestService.js's own getStudentSummary(). */
export function getStudentAssignmentSummary(classroom, studentId) {
  const summary = { inProgressCount: 0, needsAttentionCount: 0, completeCount: 0 };
  getAssignmentsForStudent(classroom, studentId).forEach(({ status }) => {
    if (status === 'in_progress') summary.inProgressCount += 1;
    else if (status === 'needs_attention') summary.needsAttentionCount += 1;
    else if (status === 'complete') summary.completeCount += 1;
  });
  return summary;
}
