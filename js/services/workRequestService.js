/**
 * services/workRequestService.js
 *
 * Owns WorkRequest creation and lifecycle progression — a completely
 * separate aggregate from models/LearningActivity.js, by deliberate
 * architectural decision, not an oversight: LearningActivity is
 * declarative ("the student's status is X," set directly, in any
 * order, no enforced progression); a WorkRequest is imperative ("this
 * submission progresses through a workflow," one real lifecycle,
 * advanced one tap at a time). The overlap in example type names
 * ("Notebook Check," "Worksheet") between the two systems is
 * coincidental vocabulary, not shared structure — forcing them
 * together would mean either every LearningActivity type inheriting
 * lifecycle machinery it never needed, or this exact model growing a
 * type-conditional fork between two incompatible interaction
 * philosophies. Two honestly-scoped systems age better than one
 * system hiding a fork inside it.
 *
 * `classroom.workRequests` is never assumed present — defaulted at
 * the read/write boundary here, the same way studentEventService.js
 * treats `classroom.studentEvents`, since this is a brand-new field
 * on an app with many already-deployed classrooms.
 *
 * Only one WorkRequest may be 'open' per (type, subjectId,
 * notebookTypeId) combination at a time — an invariant this service
 * enforces (createNewWorkRequest() automatically closes any existing
 * open match first), the same "enforced by the service, not left to
 * the UI" split goalService.js's own createNewGoalCycle() already
 * establishes for GoalCycle.status.
 */

import { createWorkRequest } from '../models/WorkRequest.js';
import { createWorkRequestEntry } from '../models/WorkRequestEntry.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

function getClassroomStudents(classroom) {
  return classroom.teams.flatMap((team) => team.students);
}

export function listWorkRequests(classroom) {
  return classroom.workRequests || [];
}

/** The one open WorkRequest matching this exact (type, subjectId, notebookTypeId) combination, or null if none is currently open. */
export function getActiveWorkRequest(classroom, { type, subjectId, notebookTypeId }) {
  return (
    listWorkRequests(classroom).find(
      (request) =>
        request.status === 'open' &&
        request.type === type &&
        request.subjectId === subjectId &&
        request.notebookTypeId === notebookTypeId
    ) || null
  );
}

export function isOpen(workRequest) {
  return workRequest.status === 'open';
}

export function isClosed(workRequest) {
  return workRequest.status === 'closed';
}

export function getWorkRequestById(classroom, requestId) {
  return listWorkRequests(classroom).find((request) => request.id === requestId) || null;
}

/**
 * Creates a new, open WorkRequest for this (type, subjectId,
 * notebookTypeId) combination. Throws a clear Error, rather than
 * silently closing anything, if one is already open for this exact
 * combination — per explicit product decision: unlike GoalCycle's own
 * auto-close (safe because a new calendar month is a fact, not a
 * choice), a WorkRequest is entirely teacher-driven and irregular, so
 * silently closing one could mean real, in-progress, unreviewed work
 * quietly disappears from view without the teacher ever deciding
 * that. The caller must explicitly closeWorkRequest() the existing
 * one first.
 *
 * Creates one entry (status 'assigned') for every student currently
 * on the real roster — including Ungrouped students, since this
 * tracks individual work, not team standing.
 */
export function createNewWorkRequest(classroom, { type = 'notebook', title, subjectId, notebookTypeId, dueDate = '' }) {
  if (!classroom.workRequests) classroom.workRequests = [];

  const existingOpen = getActiveWorkRequest(classroom, { type, subjectId, notebookTypeId });
  if (existingOpen) {
    throw new Error(
      `"${existingOpen.title}" is still open. Close it before starting a new ${type} request for this subject.`
    );
  }

  const entries = getClassroomStudents(classroom).map((student) => createWorkRequestEntry({ studentId: student.id }));
  const request = createWorkRequest({ type, title, subjectId, notebookTypeId, dueDate, entries });
  classroom.workRequests.push(request);
  return request;
}

export function closeWorkRequest(workRequest) {
  workRequest.status = 'closed';
}

export function getEntryForStudent(workRequest, studentId) {
  return workRequest.entries.find((entry) => entry.studentId === studentId) || null;
}

export function getEntriesByStatus(workRequest, status) {
  return workRequest.entries.filter((entry) => entry.status === status);
}

/**
 * The happy-path next status for the primary, one-tap button — see
 * models/WorkRequestEntry.js's own header comment for the full
 * lifecycle this walks: 'assigned' -> 'submitted' -> 'reviewed', and
 * the corrected path 'needs_correction' -> 'resubmitted' ->
 * 'reviewed'. Only *entering* 'needs_correction' is exceptional (see
 * markNeedsCorrection() below, a deliberate, separate teacher
 * decision) — once an entry is already on that branch, advancing
 * through it is itself the ordinary next step for that one notebook,
 * per explicit product decision not to optimize for rare cases at the
 * expense of the common workflow once a case is already exceptional.
 * Returns null only for 'reviewed' (terminal).
 */
export function getNextStatus(currentStatus) {
  const HAPPY_PATH_NEXT = {
    assigned: 'submitted',
    submitted: 'reviewed',
    needs_correction: 'resubmitted',
    resubmitted: 'reviewed',
  };
  return HAPPY_PATH_NEXT[currentStatus] || null;
}

/** The one-tap primary action — advances this student's entry along the happy path (including through the correction branch, once already on it). A no-op (returns null) only from 'reviewed', the terminal status. */
export function advanceStatus(workRequest, studentId) {
  const entry = getEntryForStudent(workRequest, studentId);
  if (!entry) return null;

  const next = getNextStatus(entry.status);
  if (!next) return null;

  entry.status = next;
  entry.updatedAt = getCurrentIsoDate();
  if (!entry.history) entry.history = [];
  entry.history.push({ status: next, date: entry.updatedAt });
  return entry;
}

/** The exceptional, secondary action — deliberately separate from the primary button, since entering the correction branch is a real teacher decision, not a default next step. Only meaningful from 'submitted' or 'resubmitted' (the work is genuinely in the teacher's hands to review); a no-op from any other status. */
export function markNeedsCorrection(workRequest, studentId) {
  const entry = getEntryForStudent(workRequest, studentId);
  if (!entry) return null;
  if (entry.status !== 'submitted' && entry.status !== 'resubmitted') return null;

  entry.status = 'needs_correction';
  entry.updatedAt = getCurrentIsoDate();
  if (!entry.history) entry.history = [];
  entry.history.push({ status: 'needs_correction', date: entry.updatedAt });
  return entry;
}

/** This entry's own full lifecycle history, oldest first — what the roster's inline expansion renders instead of a separate Timeline page. */
export function getEntryHistory(entry) {
  return entry.history || [];
}
