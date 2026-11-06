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
 *
 * COMPLETION STAR ELIGIBILITY (corrected — WORK-0038, 2026-11-05):
 * a Completion Star is now awarded ONLY once a checkpoint's own review
 * is genuinely marked 'complete' (services/checkpointService.js /
 * services/assignmentCheckpointService.js's own reviewStatus), never
 * merely on submission. Submitted + 'incomplete': no star. Submitted +
 * 'complete': award one star, regardless of whether the submission
 * itself was on time or late — Completion Star has never been, and
 * still is not, date-gated (that is Readiness Champion's own, entirely
 * separate rule — see notebookBadgeAwardService.js). This mirrors
 * Organization/Punctuation Champion's own established trigger shape
 * (awarded only once a review reaches 'complete') — see
 * notebookBadgeAwardService.js's own header comment for why that
 * trigger is correct and why "submission alone" never was. Each
 * checkpoint system below (Notebook Checkpoints / Assignment
 * Checkpoints) gets TWO wrapper functions, not one:
 *   - record*CheckpointReview() — the PRIMARY trigger: awards on a
 *     genuine not_reviewed/incomplete -> complete transition, reverses
 *     on complete -> anything-else (covers "Complete -> Incomplete" and
 *     covers re-completion correctly, since reversal only ever nets the
 *     work item back to 0, never blocking a later fresh award).
 *   - record*CheckpointSubmission() — now never AWARDS a star, but
 *     still must REVERSE one: checkpointService.setSubmission()/
 *     assignmentCheckpointService.setSubmission() each silently reset
 *     reviewStatus back to 'not_reviewed' whenever a submission is
 *     withdrawn (status -> 'not_submitted'), entirely bypassing
 *     setReview()/record*CheckpointReview() — so a withdrawal while
 *     review was genuinely 'complete' must independently reverse any
 *     active star here, or it would survive as a star for a submission
 *     that functionally no longer exists.
 * The legacy, retired Notebook Register path (recordNotebookSubmission()
 * below, services/notebookService.js) has no review-status concept at
 * all (confirmed: that entry model only ever had a `submission` field) —
 * it cannot be review-gated, so it simply never awards a star anymore,
 * full stop (this route is unreachable via the router today regardless —
 * see ui/router.js's own "register and Timeline routes are retired
 * entirely" comment — but the correction applies here too, for
 * consistency and in case the route is ever reconnected).
 *
 * TEACHER REMOVAL (WORK-0038): removeCompletionStar() is the explicit,
 * OWNER/TEACHER-gated counterpart to the automatic reversal paths above
 * — mirrors notebookReadinessChampionService.js's own
 * revokeReadinessChampionForNotebook() exactly: throws (never silently
 * no-ops) on an unauthorized uid or on
 * "nothing active to remove," since silently no-op-ing would hide a
 * teacher's own mistaken belief that a star existed. Reuses the SAME
 * reverseAutomaticCompletionStar() ledger mechanics as every other
 * reversal path — the net-of-append-only-entries invariant is the one
 * and only source of truth for "is this work item's star currently
 * active," so an explicit removal, an automatic un-complete reversal,
 * and a withdrawal-triggered reversal can never double-reverse or drift
 * out of sync with each other.
 */

import * as timelineService from './timelineService.js';
import * as notebookService from './notebookService.js';
import * as checkpointService from './checkpointService.js';
import * as assignmentCheckpointService from './assignmentCheckpointService.js';
import * as badgeService from './badgeService.js';
import { canPerformAsUid } from './permissionService.js';
import { PERMISSIONS } from '../config/memberRoles.js';

// ---------------------------------------------------------------------
// Work item identity
// ---------------------------------------------------------------------

export function buildNotebookWorkItemRef({ subjectId, notebookTypeId, dateKey }) {
  return { type: 'notebook', subjectId, notebookTypeId, dateKey };
}

export function buildAssignmentCheckpointWorkItemRef({ assignmentId, checkpointId }) {
  return { type: 'assignment_checkpoint', assignmentId, checkpointId };
}

/**
 * Notebook Checkpoints' own work-item identity (services/checkpointService.js
 * — the system ui/views/NotebookCheckpointsView.js actually uses today,
 * distinct from the legacy, retired `buildNotebookWorkItemRef()` above).
 * A checkpoint's own identity is (subjectId, notebookTypeId,
 * checkpointId), never a date — multiple checkpoints coexist permanently
 * on the same notebook (Unit 1, Unit 2, Question Paper), unlike a dated
 * daily Register entry — so this is its own distinct `type`, never
 * conflated with either existing ref shape. Deliberately the exact same
 * field shape PR #3 (feature/student-profile-notebook-tracking,
 * currently on hold — see CONFLICT-0006) independently arrived at, so a
 * future rebase/reconciliation of that branch recognizes this as the
 * same identity concept rather than a competing one.
 */
export function buildNotebookCheckpointWorkItemRef({ subjectId, notebookTypeId, checkpointId }) {
  return { type: 'notebook_checkpoint', subjectId, notebookTypeId, checkpointId };
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
 *
 * `...meta` (e.g. `reason`, `removedBy`) rides straight through to
 * timelineService.logEntry()'s own purely-additive escape hatch — lets
 * every caller below (automatic un-complete, withdrawal side effect,
 * explicit teacher removal) tag WHY a reversal happened without this
 * function needing to know about any of those cases itself.
 */
export function reverseAutomaticCompletionStar(student, workItemRef, { label = 'Completion Star Reversed', ...meta } = {}) {
  if (getAutomaticStarNetForWorkItem(student, workItemRef) < 1) return null;
  return timelineService.logEntry(student, { kind: 'points', label, delta: -1, source: 'auto', workItemRef, ...meta });
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
// Teacher removal of an automatic Completion Star
// ---------------------------------------------------------------------

/**
 * Real, OWNER/TEACHER-only gate for Completion Star management — both
 * the AUTOMATIC award's own grant (see record*CheckpointReview() below)
 * and explicit teacher removal. Reuses PERMISSIONS.AWARD_POINTS, the
 * same scope every other points-affecting teacher action in this app
 * already uses. AUTOMATIC REVERSALS (Complete -> Incomplete,
 * withdrawal) are deliberately NEVER gated by this — see
 * record*CheckpointReview()/record*CheckpointSubmission()'s own header
 * comments for why, mirroring notebookReadinessChampionService.js's own
 * automatic-revoke-on-no-longer-honest precedent (see
 * evaluateReadinessChampionForNotebook()) exactly: a reversal
 * is a deterministic data-integrity correction, never a discretionary
 * grant, so gating it the same way would risk a stale, factually-wrong
 * star surviving because the acting uid happened to lack this
 * permission.
 */
export function canManageCompletionStar(classroom, uid) {
  return canPerformAsUid(classroom, uid, PERMISSIONS.AWARD_POINTS);
}

/**
 * Explicit teacher removal of an active Completion Star — mirrors
 * notebookReadinessChampionService.js's own
 * revokeReadinessChampionForNotebook() exactly: throws for an
 * unauthorized uid, and throws (rather than silently
 * no-op-ing) when there is nothing active to remove, since a silent
 * no-op here would hide a teacher's own mistaken belief that a star
 * existed. Reverses the EXACT associated +1 points event via the same
 * ledger mechanics every other reversal in this file uses (net of
 * append-only entries) — never deletes or edits the original award
 * entry, only appends a new, labeled, attributed reversal entry.
 */
export function removeCompletionStar(classroom, student, workItemRef, actingUid) {
  if (!canManageCompletionStar(classroom, actingUid)) {
    throw new Error("Not authorized to remove a Completion Star — must be this classroom's owner or a co-teacher.");
  }
  if (getAutomaticStarNetForWorkItem(student, workItemRef) < 1) {
    throw new Error('No active Completion Star to remove for this submission.');
  }
  return reverseAutomaticCompletionStar(student, workItemRef, { label: 'Completion Star Removed', reason: 'teacher_removed', removedBy: actingUid });
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
 * — kept as the one place Notebook Register submission writes happen
 * (see ui/views/NotebookRegisterView.js, the one caller), for callers
 * that still depend on this exact function existing and writing the
 * submission field correctly. CORRECTED (WORK-0038): no longer touches
 * Completion Star state in either direction — this entry model has no
 * review-status concept at all to gate a star on (see this file's own
 * header comment), and "submission alone" is no longer a valid
 * Completion Star trigger for ANY system, so this never awards one.
 * This route is also unreachable via the router today regardless (see
 * ui/router.js's own "register and Timeline routes are retired
 * entirely" comment) — this correction applies anyway, for consistency
 * and in case the route is ever reconnected.
 */
export function recordNotebookSubmission(classroom, { subjectId, notebookTypeId, dateKey, studentId, submission }, actingUid) {
  return notebookService.setEntry(classroom, subjectId, notebookTypeId, dateKey, studentId, { submission }, actingUid);
}

// ---------------------------------------------------------------------
// Notebook Checkpoints (services/checkpointService.js) — the system
// ui/views/NotebookCheckpointsView.js actually uses today. See this
// file's own header comment ("COMPLETION STAR ELIGIBILITY") for exactly
// why this needs two wrapper functions, not one.
// ---------------------------------------------------------------------

/**
 * Wraps checkpointService.setSubmission() — never AWARDS a star (see
 * recordNotebookCheckpointReview() below for the real trigger), but
 * must still REVERSE one: setSubmission() silently resets reviewStatus
 * to 'not_reviewed' whenever a submission is withdrawn, bypassing
 * setReview() entirely — so a withdrawal while review was genuinely
 * 'complete' must reverse any active star here, or it would survive for
 * a submission that functionally no longer exists.
 */
export function recordNotebookCheckpointSubmission(classroom, checkpoint, studentId, { status, submittedDate = null }) {
  const workItemRef = buildNotebookCheckpointWorkItemRef({
    subjectId: checkpoint.subjectId,
    notebookTypeId: checkpoint.notebookTypeId,
    checkpointId: checkpoint.id,
  });
  const wasComplete = checkpointService.getRecordForStudent(checkpoint, studentId)?.reviewStatus === 'complete';

  checkpointService.setSubmission(checkpoint, studentId, { status, submittedDate });

  if (status !== 'submitted' && wasComplete) {
    const found = findStudentById(classroom, studentId);
    if (found) reverseAutomaticCompletionStar(found.student, workItemRef, { label: 'Completion Star Reversed', reason: 'submission_withdrawn' });
  }
}

/**
 * Wraps checkpointService.setReview() — THE real Completion Star
 * trigger for Notebook Checkpoints. Awards on a genuine
 * not_reviewed/incomplete -> complete transition; reverses on
 * complete -> anything else (covers Complete -> Incomplete, and
 * correctly supports re-completion, since a reversal only ever nets
 * this work item back to 0, never blocking a later fresh award — same
 * net-of-append-only-entries mechanics as every other star here). An
 * edit that re-saves an already-'complete' record as 'complete' again
 * is a no-op by construction (awardAutomaticCompletionStar()'s own
 * idempotency guard), never a double award.
 *
 * `actingUid` gates the AWARD only (mirrors
 * notebookReadinessChampionService.evaluateReadinessChampionForNotebook()
 * exactly): an
 * unauthorized uid silently skips the star — never throws, and never
 * blocks the underlying setReview() write itself, since marking a
 * review Complete is a side effect this function reacts to, not a
 * primary command it owns. The REVERSAL branch is deliberately never
 * gated — see canManageCompletionStar()'s own header comment.
 */
export function recordNotebookCheckpointReview(classroom, checkpoint, studentId, { status, reviewedDate = null }, actingUid) {
  const workItemRef = buildNotebookCheckpointWorkItemRef({
    subjectId: checkpoint.subjectId,
    notebookTypeId: checkpoint.notebookTypeId,
    checkpointId: checkpoint.id,
  });
  const wasComplete = checkpointService.getRecordForStudent(checkpoint, studentId)?.reviewStatus === 'complete';

  checkpointService.setReview(checkpoint, studentId, { status, reviewedDate });

  const isNowComplete = status === 'complete';
  const found = findStudentById(classroom, studentId);
  if (found) {
    if (isNowComplete && !wasComplete && canManageCompletionStar(classroom, actingUid)) {
      awardAutomaticCompletionStar(found.student, workItemRef);
    } else if (!isNowComplete && wasComplete) {
      reverseAutomaticCompletionStar(found.student, workItemRef, { label: 'Completion Star Reversed', reason: 'review_uncompleted' });
    }
  }
}

// ---------------------------------------------------------------------
// Assignment Checkpoints (services/assignmentCheckpointService.js) —
// exact mirror of the Notebook Checkpoints pair above, same reasoning.
// ---------------------------------------------------------------------

/** Mirrors recordNotebookCheckpointSubmission() exactly, for Assignment Checkpoints — never awards, only reverses on a withdrawal that silently un-completes an already-'complete' review. */
export function recordAssignmentCheckpointSubmission(classroom, checkpoint, studentId, { status, submittedDate = null }) {
  const workItemRef = buildAssignmentCheckpointWorkItemRef({ assignmentId: checkpoint.assignmentId, checkpointId: checkpoint.id });
  const wasComplete = assignmentCheckpointService.getRecordForStudent(checkpoint, studentId)?.reviewStatus === 'complete';

  assignmentCheckpointService.setSubmission(checkpoint, studentId, { status, submittedDate });

  if (status !== 'submitted' && wasComplete) {
    const found = findStudentById(classroom, studentId);
    if (found) reverseAutomaticCompletionStar(found.student, workItemRef, { label: 'Completion Star Reversed', reason: 'submission_withdrawn' });
  }
}

/** Mirrors recordNotebookCheckpointReview() exactly, for Assignment Checkpoints — THE real Completion Star trigger for this system. `actingUid` gates the AWARD only, same reasoning. */
export function recordAssignmentCheckpointReview(classroom, checkpoint, studentId, { status, reviewedDate = null }, actingUid) {
  const workItemRef = buildAssignmentCheckpointWorkItemRef({ assignmentId: checkpoint.assignmentId, checkpointId: checkpoint.id });
  const wasComplete = assignmentCheckpointService.getRecordForStudent(checkpoint, studentId)?.reviewStatus === 'complete';

  assignmentCheckpointService.setReview(checkpoint, studentId, { status, reviewedDate });

  const isNowComplete = status === 'complete';
  const found = findStudentById(classroom, studentId);
  if (found) {
    if (isNowComplete && !wasComplete && canManageCompletionStar(classroom, actingUid)) {
      awardAutomaticCompletionStar(found.student, workItemRef);
    } else if (!isNowComplete && wasComplete) {
      reverseAutomaticCompletionStar(found.student, workItemRef, { label: 'Completion Star Reversed', reason: 'review_uncompleted' });
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

// ---------------------------------------------------------------------
// Read-only audit (WORK-0038) — finds ACTIVE automatic Completion Stars
// that are no longer eligible under the corrected rule, WITHOUT
// modifying anything. Deliberately a pure, in-memory function over an
// already-loaded Classroom object — never connects to Firestore itself,
// never writes, never bulk-modifies — so it can be run safely against a
// scoped, read-only snapshot of real data (mirroring this project's own
// established precedent: a prior incident's "purpose-built read-only
// Node/firebase-admin audit script" using a user-supplied, kept-outside-
// the-repo credential, explicit no-writes instruction, dry-run-first
// discipline) without this file itself ever needing write access or
// Firestore knowledge of any kind.
// ---------------------------------------------------------------------

/**
 * Resolves whether `entry` (an active, `source: 'auto'`, `kind: 'points'`
 * Completion Star entry) is still eligible under the corrected rule —
 * i.e. whether its own `workItemRef`'s CURRENT reviewStatus is genuinely
 * 'complete'. The legacy `notebook` work-item type has no review concept
 * at all (see this file's own "COMPLETION STAR ELIGIBILITY" header
 * comment) and so can never be eligible under the corrected rule — every
 * active star of that type is automatically incorrect, regardless of
 * any other data. An unresolvable work item (its own checkpoint was
 * since deleted) is conservatively treated as incorrect too, rather than
 * silently assumed fine.
 */
function isCompletionStarStillEligible(classroom, entry) {
  const ref = entry.workItemRef;
  if (!ref) return false; // a manual-looking auto entry with no ref at all — can't verify, treat as incorrect
  if (ref.type === 'notebook_checkpoint') {
    const checkpoint = checkpointService.getCheckpointById(classroom, ref.checkpointId);
    if (!checkpoint) return false;
    return checkpointService.getRecordForStudent(checkpoint, entry.__studentId)?.reviewStatus === 'complete';
  }
  if (ref.type === 'assignment_checkpoint') {
    const checkpoint = assignmentCheckpointService.getCheckpointById(classroom, ref.checkpointId);
    if (!checkpoint) return false;
    return assignmentCheckpointService.getRecordForStudent(checkpoint, entry.__studentId)?.reviewStatus === 'complete';
  }
  return false; // 'notebook' (legacy) and any unrecognized type: never eligible under the corrected rule
}

/**
 * Read-only audit across one already-loaded Classroom: every currently
 * ACTIVE (net >= 1) automatic Completion Star that is no longer
 * eligible under the corrected rule (never awarded/revoked/modified by
 * this function — purely a report). Returns one entry per incorrect
 * star: `{ studentId, studentName, workItemRef, entryId, awardedAt }`.
 * Safe to call repeatedly, safe to call against a read-only snapshot —
 * performs zero writes of any kind, to any object it's given.
 */
export function auditCompletionStarsForClassroom(classroom) {
  const findings = [];
  for (const team of classroom.teams || []) {
    for (const student of team.students || []) {
      const activeAutoEntries = new Map(); // workItemRef key -> { entry, net }
      for (const entry of student.history || []) {
        if (entry.kind !== 'points' || entry.source !== 'auto' || !entry.workItemRef) continue;
        const key = JSON.stringify(entry.workItemRef);
        const existing = activeAutoEntries.get(key) || { lastEntry: null, net: 0 };
        existing.net += entry.delta;
        existing.lastEntry = entry.delta > 0 ? entry : existing.lastEntry;
        activeAutoEntries.set(key, existing);
      }
      for (const { lastEntry, net } of activeAutoEntries.values()) {
        if (net < 1 || !lastEntry) continue; // not currently active
        const eligible = isCompletionStarStillEligible(classroom, { ...lastEntry, __studentId: student.id });
        if (!eligible) {
          findings.push({
            studentId: student.id,
            studentName: student.name,
            workItemRef: lastEntry.workItemRef,
            entryId: lastEntry.id,
            awardedAt: lastEntry.recordedAt,
          });
        }
      }
    }
  }
  return findings;
}
