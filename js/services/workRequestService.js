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

/** The one-tap primary action — advances this student's entry along the happy path (including through the correction branch, once already on it). When the destination is 'reviewed', this always records the common outcome ('complete') — see markReviewIncomplete() for the alternate one. A no-op (returns null) only from 'reviewed', the terminal status. */
export function advanceStatus(workRequest, studentId) {
  const entry = getEntryForStudent(workRequest, studentId);
  if (!entry) return null;

  const next = getNextStatus(entry.status);
  if (!next) return null;

  entry.status = next;
  entry.updatedAt = getCurrentIsoDate();
  const historyEntry = { status: next, date: entry.updatedAt };
  if (next === 'reviewed') {
    entry.reviewOutcome = 'complete';
    historyEntry.reviewOutcome = 'complete';
  }
  if (!entry.history) entry.history = [];
  entry.history.push(historyEntry);
  return entry;
}

/**
 * The alternate review outcome — offered from the overflow menu
 * alongside "Needs Correction," per explicit product decision: review
 * genuinely branches into complete/incomplete/needs-correction, but
 * only the common case (complete) gets the primary one-tap button.
 * Meaningful from 'submitted' or 'resubmitted' only (review outcomes
 * only make sense once the work has actually reached the teacher).
 */
export function markReviewIncomplete(workRequest, studentId) {
  const entry = getEntryForStudent(workRequest, studentId);
  if (!entry) return null;
  if (entry.status !== 'submitted' && entry.status !== 'resubmitted') return null;

  entry.status = 'reviewed';
  entry.reviewOutcome = 'incomplete';
  entry.updatedAt = getCurrentIsoDate();
  if (!entry.history) entry.history = [];
  entry.history.push({ status: 'reviewed', reviewOutcome: 'incomplete', date: entry.updatedAt });
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

/**
 * Another exceptional, secondary action — reachable only through this
 * function, never the primary one-tap button, per explicit product
 * decision ("Absent should remain an exceptional action... it should
 * not become part of the primary one-tap workflow"). Meaningful from
 * any status except 'reviewed' (once genuinely reviewed, marking
 * absent after the fact would misrepresent real, completed work).
 */
export function markAbsent(workRequest, studentId) {
  const entry = getEntryForStudent(workRequest, studentId);
  if (!entry) return null;
  if (entry.status === 'reviewed') return null;

  entry.status = 'absent';
  entry.updatedAt = getCurrentIsoDate();
  if (!entry.history) entry.history = [];
  entry.history.push({ status: 'absent', date: entry.updatedAt });
  return entry;
}

/**
 * The one, simple recovery path for any mistake — "Reset Work
 * Request" in the overflow menu, per explicit product decision:
 * rather than separate "Undo Review"/"Undo Submission"/"Mark Not
 * Submitted" actions (one per possible mistake, harder to reason
 * about), a single reset always returns to the true initial state.
 * The primary lifecycle itself is completely unchanged by this — this
 * is an escape hatch, not a new path through it. A no-op from
 * 'assigned' itself, since there's nothing to reset.
 */
export function resetWorkRequestEntry(workRequest, studentId) {
  const entry = getEntryForStudent(workRequest, studentId);
  if (!entry) return null;
  if (entry.status === 'assigned') return null;

  entry.status = 'assigned';
  entry.reviewOutcome = null;
  entry.updatedAt = getCurrentIsoDate();
  if (!entry.history) entry.history = [];
  entry.history.push({ status: 'assigned', date: entry.updatedAt });
  return entry;
}

/** This entry's own full lifecycle history, oldest first — what the roster's inline expansion renders instead of a separate Timeline page. */
export function getEntryHistory(entry) {
  return entry.history || [];
}

/**
 * "Last Checked" for one student's own (subjectId, notebookTypeId)
 * notebook — a Notebook-level projection, per the frozen architecture
 * ("Last Checked... persists across request boundaries; a new
 * request opening doesn't erase the fact that the teacher looked
 * three days ago"). Deliberately searches across EVERY WorkRequest
 * sharing this exact notebook identity, open or closed — never scoped
 * to only the request currently on screen, since a teacher's
 * relationship to a student's notebook outlives any one administrative
 * cycle. Requires no new persistence: this is a query over
 * WorkRequestEntry.history, which already records every 'reviewed'
 * transition with a real date.
 *
 * Returns the most recent 'reviewed' date (an ISO string), or null if
 * this student's notebook for this Subject x Type has never been
 * reviewed at all.
 */
export function getLastChecked(classroom, studentId, subjectId, notebookTypeId) {
  let mostRecent = null;

  listWorkRequests(classroom)
    .filter((request) => request.subjectId === subjectId && request.notebookTypeId === notebookTypeId)
    .forEach((request) => {
      const entry = getEntryForStudent(request, studentId);
      if (!entry) return;
      getEntryHistory(entry)
        .filter((step) => step.status === 'reviewed')
        .forEach((step) => {
          if (!mostRecent || step.date > mostRecent) mostRecent = step.date;
        });
    });

  return mostRecent;
}

/**
 * One student's own summary across EVERY WorkRequest they have an
 * entry in — open and closed alike, since "Reviewed" would almost
 * never appear otherwise (a request is typically closed once
 * everyone's been reviewed). This is the single source of truth
 * StudentProfileView.js's own Notebook tab now reads from, the same
 * function the WorkRequest roster's own status chips are ultimately
 * derived from — the roster and the profile can never disagree,
 * because they're reading the same underlying entries, not two
 * separately-maintained tallies.
 */
export function getStudentSummary(classroom, studentId) {
  const summary = { awaitingSubmission: 0, awaitingReview: 0, needsCorrection: 0, reviewed: 0 };

  listWorkRequests(classroom).forEach((request) => {
    const entry = getEntryForStudent(request, studentId);
    if (!entry) return;
    if (entry.status === 'assigned') summary.awaitingSubmission += 1;
    else if (entry.status === 'submitted' || entry.status === 'resubmitted') summary.awaitingReview += 1;
    else if (entry.status === 'needs_correction') summary.needsCorrection += 1;
    else if (entry.status === 'reviewed') summary.reviewed += 1;
    // 'absent' is deliberately excluded from all four counts — it isn't
    // a stage of the ordinary lifecycle, and folding it into any one
    // of these four would misrepresent it as still being one of the
    // ordinary outcomes.
  });

  return summary;
}

/**
 * Every WorkRequest this student has an entry in, most recently
 * updated first — the raw data behind "Recent Notebook Activity."
 * Deliberately not filtered to open requests only, since a teacher
 * opening a profile genuinely benefits from seeing a request that was
 * just reviewed and closed, not only what's still outstanding.
 */
export function getRecentActivityForStudent(classroom, studentId, limit = 10) {
  return listWorkRequests(classroom)
    .map((request) => ({ request, entry: getEntryForStudent(request, studentId) }))
    .filter(({ entry }) => entry !== null)
    .sort((a, b) => (b.entry.updatedAt || '').localeCompare(a.entry.updatedAt || ''))
    .slice(0, limit)
    .map(({ request, entry }) => ({
      title: request.title,
      status: entry.status,
      reviewOutcome: entry.reviewOutcome,
      dueDate: request.dueDate || null,
      updatedAt: entry.updatedAt,
    }));
}
