/**
 * services/recognitionService.js
 *
 * "Recognition, comments, and testimonials" — the completion-star and
 * work-item-scoped badge half of that feature (private comments and
 * testimonials themselves live in services/commentService.js, a
 * separate file, since they go through a genuinely different
 * persistence path — see that file's own header comment).
 *
 * Owns exactly one thing this app didn't already have: turning a
 * notebook/assignment-checkpoint submission into a "completion star" on
 * services/timelineService.js's own append-only history log, correctly
 * and idempotently, and distinguishing those AUTOMATIC awards from a
 * teacher's own MANUAL star awards so either can be reversed/corrected
 * independently. Reuses, never replaces:
 *   - services/timelineService.js's own logEntry()/getNetPoints() — a
 *     "completion star" IS a `kind: 'points'`, `delta: 1` timeline
 *     entry; "Stars" anywhere else in this app (Recognition Wall, Star
 *     Performer, studentProgressService.js's own getStarsInRange())
 *     already means exactly this, so this file invents no new score
 *     concept, just a new, auditable way of logging one.
 *   - services/notebookService.js's own setEntry() for the actual
 *     notebook write — this file only watches the submission
 *     transition around that call, never duplicates it.
 *   - services/assignmentCheckpointService.js's own setSubmission() —
 *     same wrapping pattern, for Assignment Checkpoints.
 *   - services/badgeService.js's own awardBadge() for the actual badge
 *     award — this file only supplies the optional `workItemRef`/
 *     `commentId` metadata that function's own `meta` parameter already
 *     supports.
 *
 * WORK ITEM IDENTITY — the key every function below keys an award
 * against, so multiple worksheets/checkpoints are never conflated:
 *   { type: 'notebook', subjectId, notebookTypeId, dateKey }
 *   { type: 'assignment_checkpoint', assignmentId, checkpointId }
 * Deliberately the exact same compound keys notebookService.js and
 * assignmentCheckpointService.js already use to key their own records
 * — see buildNotebookWorkItemRef()/buildAssignmentCheckpointWorkItemRef()
 * below.
 *
 * AUTOMATIC STAR IDEMPOTENCY/REVERSAL — a student's own history is
 * append-only (matching this app's established convention: see
 * badgeService.js's own revokeBadge() header comment — "Participation
 * History is an append-only record of what happened"), so an automatic
 * star is never deleted from history, even when reversed. Instead:
 *   - Every automatic-star entry for one exact work item carries
 *     `source: 'auto'` and that work item's own `workItemRef`.
 *   - "Is this work item's automatic star currently active?" is the
 *     NET of every such entry's own `delta` (+1 when awarded, -1 when
 *     reversed) — never a boolean flag anywhere else, so the full
 *     history of award/reversal for this one work item stays fully
 *     auditable from the log alone.
 *   - Awarding again when the net is already >= 1 is a deliberate
 *     no-op (idempotent: marking "done" twice never double-awards).
 *   - Reversing when the net is already <= 0 is also a no-op (marking
 *     "undone" twice, or undoing something never awarded, does
 *     nothing) — and reversal can never touch a MANUAL award, because
 *     it only ever looks at `source: 'auto'` entries for this exact
 *     workItemRef.
 *
 * MANUAL STAR CORRECTION — mirrors the same append-only-reversal shape:
 * undoing a manual award appends a `source: 'manual_correction'` entry
 * referencing the original entry's own id (`correctsEntryId`), rather
 * than deleting it, and is itself idempotent (undoing the same manual
 * award twice is a no-op).
 */

import * as timelineService from './timelineService.js';
import * as notebookService from './notebookService.js';
import * as assignmentCheckpointService from './assignmentCheckpointService.js';
import * as badgeService from './badgeService.js';

// ---------------------------------------------------------------------
// Work item identity
// ---------------------------------------------------------------------

export function buildNotebookWorkItemRef({ subjectId, notebookTypeId, dateKey }) {
  return { type: 'notebook', subjectId, notebookTypeId, dateKey };
}

export function buildAssignmentCheckpointWorkItemRef({ assignmentId, checkpointId }) {
  return { type: 'assignment_checkpoint', assignmentId, checkpointId };
}

/** Deep-equal for the small, flat workItemRef shapes above — deliberately strict about `type` first, so a notebook ref and a checkpoint ref are never accidentally treated as equal even if other keys happened to collide. */
export function workItemRefsEqual(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

// ---------------------------------------------------------------------
// Automatic completion stars
// ---------------------------------------------------------------------

/** The net (award minus reversal) delta of every automatic-star entry logged for this exact work item — see this file's own header comment. 0 means "not currently active," whether that's because it was never awarded or because it was awarded then reversed. */
export function getAutomaticStarNetForWorkItem(student, workItemRef) {
  return (student.history || [])
    .filter((entry) => entry.kind === 'points' && entry.source === 'auto' && workItemRefsEqual(entry.workItemRef, workItemRef))
    .reduce((sum, entry) => sum + entry.delta, 0);
}

/**
 * Awards exactly one automatic completion star for this work item —
 * idempotent: a second call for the same, still-active work item is a
 * deliberate no-op (returns null) rather than a second +1 entry.
 */
export function awardAutomaticCompletionStar(student, workItemRef, { label = 'Completion Star' } = {}) {
  if (getAutomaticStarNetForWorkItem(student, workItemRef) >= 1) return null;
  return timelineService.logEntry(student, { kind: 'points', label, delta: 1, source: 'auto', workItemRef });
}

/**
 * Reverses this work item's own automatic star — a no-op (returns
 * null) if it isn't currently active, so undoing an already-undone (or
 * never-awarded) submission never creates a runaway negative balance.
 * Never touches a manually-awarded star: only ever sums/appends
 * `source: 'auto'` entries for this exact workItemRef.
 */
export function reverseAutomaticCompletionStar(student, workItemRef, { label = 'Completion Star Reversed' } = {}) {
  if (getAutomaticStarNetForWorkItem(student, workItemRef) < 1) return null;
  return timelineService.logEntry(student, { kind: 'points', label, delta: -1, source: 'auto', workItemRef });
}

// ---------------------------------------------------------------------
// Manual star awards + corrections
// ---------------------------------------------------------------------

/**
 * A teacher explicitly awarding an extra star — never idempotency-
 * guarded like the automatic path above, by design: a teacher may
 * genuinely want to award several manual stars to the same student for
 * the same work item (e.g. one for completion, a separate one for
 * exceptional effort), each its own auditable entry.
 */
export function awardManualStar(student, { label = 'Manual Star', workItemRef = null, commentId = null } = {}) {
  return timelineService.logEntry(student, { kind: 'points', label, delta: 1, source: 'manual', workItemRef, commentId });
}

/**
 * Corrects (reverses) one specific manual star award by its own entry
 * id — never a blanket "remove the last manual star," so a teacher
 * undoing one mistaken award can never accidentally reverse a
 * different, legitimate one. Idempotent: undoing the same entry twice
 * is a no-op (returns null) — detected by checking whether a
 * `manual_correction` entry already references this exact
 * `correctsEntryId`.
 */
export function undoManualStarAward(student, entryId) {
  const original = (student.history || []).find((entry) => entry.id === entryId && entry.kind === 'points' && entry.source === 'manual');
  if (!original) return null;

  const alreadyCorrected = (student.history || []).some((entry) => entry.source === 'manual_correction' && entry.correctsEntryId === entryId);
  if (alreadyCorrected) return null;

  return timelineService.logEntry(student, {
    kind: 'points',
    label: `Corrected: ${original.label}`,
    delta: -original.delta,
    source: 'manual_correction',
    correctsEntryId: entryId,
  });
}

// ---------------------------------------------------------------------
// Badge awards tied to a specific work item
// ---------------------------------------------------------------------

/** Thin pass-through to badgeService.awardBadge() with this work item's own reference attached — see that function's own `meta` parameter. Reused, not reimplemented: the badge catalog, the "already has this badge" guard, and the timeline entry itself are all still badgeService.js's own. */
export function awardBadgeForWorkItem(student, badgeName, { workItemRef = null, commentId = null } = {}) {
  return badgeService.awardBadge(student, badgeName, { workItemRef, commentId });
}

// ---------------------------------------------------------------------
// Notebook / Assignment Checkpoint submission wrappers
// ---------------------------------------------------------------------

/**
 * Wraps notebookService.setEntry() for a Submission change specifically
 * — the one place "first marked submitted" and "marked back to
 * un-submitted" actually happen for Notebook Tracker — so the automatic
 * star transition lives in exactly one place rather than being
 * duplicated at every call site (see ui/views/NotebookRegisterView.js,
 * the one caller so far). Completion-only updates (no `submission` key
 * in `updates`) never touch star state at all — a star is earned for
 * SUBMITTING, not for how it was later assessed.
 */
export function recordNotebookSubmission(classroom, { subjectId, notebookTypeId, dateKey, studentId, submission }, actingUid) {
  const workItemRef = buildNotebookWorkItemRef({ subjectId, notebookTypeId, dateKey });
  const previousEntry = notebookService.getEntry(classroom, subjectId, notebookTypeId, dateKey, studentId);
  const wasSubmitted = previousEntry?.submission === 'submitted';

  const updatedEntry = notebookService.setEntry(classroom, subjectId, notebookTypeId, dateKey, studentId, { submission }, actingUid);

  const isNowSubmitted = submission === 'submitted';
  const found = findStudentById(classroom, studentId);
  if (found) {
    if (isNowSubmitted && !wasSubmitted) {
      awardAutomaticCompletionStar(found.student, workItemRef);
    } else if (!isNowSubmitted && wasSubmitted) {
      reverseAutomaticCompletionStar(found.student, workItemRef);
    }
  }

  return updatedEntry;
}

/**
 * Same wrapping pattern as recordNotebookSubmission() above, for
 * Assignment Checkpoints — wraps
 * assignmentCheckpointService.setSubmission(), reading the PRIOR
 * submissionStatus first via getRecordForStudent() (the same "read
 * before write" shape) so the automatic star transition is based on a
 * real before/after comparison, not just the new value in isolation.
 */
export function recordAssignmentCheckpointSubmission(classroom, checkpoint, studentId, { status, submittedDate = null }) {
  const workItemRef = buildAssignmentCheckpointWorkItemRef({ assignmentId: checkpoint.assignmentId, checkpointId: checkpoint.id });
  const wasSubmitted = assignmentCheckpointService.getRecordForStudent(checkpoint, studentId)?.submissionStatus === 'submitted';

  assignmentCheckpointService.setSubmission(checkpoint, studentId, { status, submittedDate });

  const isNowSubmitted = status === 'submitted';
  const found = findStudentById(classroom, studentId);
  if (found) {
    if (isNowSubmitted && !wasSubmitted) {
      awardAutomaticCompletionStar(found.student, workItemRef);
    } else if (!isNowSubmitted && wasSubmitted) {
      reverseAutomaticCompletionStar(found.student, workItemRef);
    }
  }
}

function findStudentById(classroom, studentId) {
  for (const team of classroom.teams || []) {
    const student = team.students.find((s) => s.id === studentId);
    if (student) return { student, team };
  }
  return null;
}
