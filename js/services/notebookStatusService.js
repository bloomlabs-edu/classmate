/**
 * services/notebookStatusService.js
 *
 * Single source of truth for "where does one student's notebook work
 * stand right now" — merges the two notebook-tracking systems that
 * coexist in this codebase today into the four statuses every
 * notebook-status screen should agree on: Awaiting Submission,
 * Awaiting Review, Needs Correction, Reviewed (plus WorkRequest's own
 * `absent`, preserved separately — see classifyWorkRequestEntry()
 * below).
 *
 * THE ACTUAL FIX for the "Raban M" discrepancy (teacher's Notebook
 * Tracker correctly shows several checkpoints "Not Submitted," while
 * the student's own profile reported zero notebooks awaiting
 * submission): the teacher's day-to-day Notebook Tracker, for any
 * notebook using the default 'checkpoint' tracking mode (see
 * notebookConfigService.js's own getTrackingMode()), is
 * services/checkpointService.js's own sparse-record model — "no
 * record for this checkpoint" correctly means "not submitted" (see
 * ui/views/NotebookCheckpointsView.js's own getCellMeta()). But every
 * existing "how is this student doing on notebooks" READ outside that
 * one grid (ui/views/StudentProfileView.js's own Notebooks tab,
 * services/studentPortalDataService.js's own getAlertsForCurrentStudent())
 * read EXCLUSIVELY from services/workRequestService.js — a completely
 * separate array (classroom.workRequests) that a checkpoint-tracked
 * notebook never writes to at all. Once a classroom has no open
 * WorkRequest for a given notebook (true for any notebook using the
 * default checkpoint workflow — see ui/views/NotebookTrackerView.js's
 * own header comment on that entry point no longer being surfaced
 * from the main tracker), those reads silently report zero
 * outstanding work, even while the checkpoint grid correctly shows
 * several "Not Submitted" cells for the exact same student.
 *
 * This function reads BOTH systems and merges their counts/items, so a
 * notebook tracked via checkpoints, via WorkRequest, or (for a
 * classroom mid-migration) both, is counted exactly once either way —
 * no caller needs to know or care which system a given notebook
 * actually uses. checkpointService.js and workRequestService.js
 * remain deliberately independent of each other (see
 * checkpointService.js's own header comment on why Checkpoints was
 * never built as an extension of WorkRequest); this module is the one
 * place that reads across both without either depending on the other.
 *
 * DEDUPLICATION (fixes a real double-count: a notebook with both an
 * open WorkRequest AND checkpoint data — the exact "mid-migration"
 * case this module's own merge exists to handle — used to be counted
 * TWICE, once from each source). `notebookIdentityKey()` below uses
 * exactly (subjectId, notebookTypeId) — models/WorkRequest.js's own
 * header comment is explicit that "Notebook identity stays exactly
 * (subjectId, notebookTypeId)," never including curriculum, title, or
 * anything else, "and this must not change." Reusing that exact,
 * already-documented identity (never inventing a new one, e.g. never
 * matching on title, which two genuinely different notebooks could
 * coincidentally share) is what makes this safe.
 *
 * Checkpoint tracking wins whenever both sources describe the same
 * notebook identity: if this student's checkpoint read above already
 * produced at least one item for a given (subjectId, notebookTypeId),
 * every WorkRequest obligation sharing that exact identity is dropped
 * entirely (not merged, not re-classified — the checkpoint item(s)
 * already carry this notebook's real status). This mirrors checkpoint
 * tracking's own role as the active default (see
 * notebookConfigService.js's own getTrackingMode(), `'checkpoint'` is
 * the default), and sidesteps a staleness problem a trackingMode check
 * alone would have: an obligation can reference a subjectId/
 * notebookTypeId whose NotebookType has since been deleted entirely
 * (see getNotebookObligationsForStudent()'s own already-established
 * "resolve to null, fall back to the obligation's own title" handling
 * below), where there is no current trackingMode to read at all —
 * "does real checkpoint data for this exact identity actually exist"
 * is checked directly instead, and needs no separate lookup.
 *
 * A missing/null subjectId or notebookTypeId on EITHER side never
 * matches anything — see notebookIdentityKey()'s own comment. Two
 * items that both happen to have no usable identity are two distinct,
 * never-deduplicated items, not a false match on "nothing == nothing."
 */

import * as checkpointService from './checkpointService.js';
import * as notebookConfigService from './notebookConfigService.js';
import * as workRequestService from './workRequestService.js';

const STATUS_KEYS = ['awaitingSubmission', 'awaitingReview', 'needsCorrection', 'reviewed', 'absent'];

function emptyBuckets() {
  const buckets = {};
  STATUS_KEYS.forEach((key) => {
    buckets[key] = [];
  });
  return buckets;
}

/**
 * The one, already-documented notebook identity in this codebase (see
 * models/WorkRequest.js's own header comment: "Notebook identity stays
 * exactly (subjectId, notebookTypeId)"). Returns `null` — never a
 * key built from a missing piece — when either id is absent, so a
 * legacy/malformed record with no real identity can never accidentally
 * collide with another one that also has none.
 */
function notebookIdentityKey(subjectId, notebookTypeId) {
  if (!subjectId || !notebookTypeId) return null;
  return `${subjectId}::${notebookTypeId}`;
}

/** A checkpoint has no "absent" concept and no closing window — every (checkpoint, record-or-absence) pair resolves to exactly one of the first four statuses, always actionable (see `actionable` on the returned item). */
function classifyCheckpoint(record) {
  if (!record || record.submissionStatus === 'not_submitted') return 'awaitingSubmission';
  if (record.reviewStatus === 'incomplete') return 'needsCorrection';
  if (record.reviewStatus === 'complete') return 'reviewed';
  return 'awaitingReview'; // submitted, not yet reviewed
}

/** Mirrors workRequestService.js's own getStudentSummary() classification exactly, so the two never drift apart. 'absent' is its own bucket, never folded into one of the other four — see that function's own comment on why. */
function classifyWorkRequestStatus(status) {
  if (status === 'assigned') return 'awaitingSubmission';
  if (status === 'submitted' || status === 'resubmitted') return 'awaitingReview';
  if (status === 'needs_correction') return 'needsCorrection';
  if (status === 'reviewed') return 'reviewed';
  if (status === 'absent') return 'absent';
  return null;
}

/**
 * One student's full notebook-status picture, merged across both
 * tracking systems.
 *
 * `summary` — a plain count per status (always includes all of
 * STATUS_KEYS, 0 where nothing contributes).
 *
 * `items` — the same totals broken out into the individual
 * notebooks/checkpoints contributing to each one, each carrying a
 * human-readable `title`, a `dueDate` (or null), and `actionable`
 * (true for every checkpoint-sourced item — checkpoints never close —
 * and for a WorkRequest-sourced item only while its own request is
 * still open; a WorkRequest that closed while a student was still
 * 'assigned' genuinely was missed, but isn't something re-prompting
 * the student to submit would make sense for). This is what a status
 * count, once opened, actually shows: see
 * ui/components/NotebookStatusSummary.js.
 */
export function getNotebookStatusForStudent(classroom, studentId) {
  const buckets = emptyBuckets();
  const checkpointTrackedKeys = new Set();

  checkpointService.getCheckpointsForStudentAcrossNotebooks(classroom, studentId).forEach(({ subject, notebookType, checkpoints }) => {
    const key = notebookIdentityKey(subject.id, notebookType.id);
    if (key) checkpointTrackedKeys.add(key);

    checkpoints.forEach(({ checkpoint, record }) => {
      const status = classifyCheckpoint(record);
      buckets[status].push({
        source: 'checkpoint',
        id: `checkpoint:${checkpoint.id}`,
        title: `${subject.name} — ${notebookType.name}: ${checkpoint.title}`,
        subjectId: subject.id,
        notebookTypeId: notebookType.id,
        checkpointId: checkpoint.id,
        dueDate: checkpoint.dueDate || null,
        updatedAt: record?.updatedAt || null,
        actionable: true,
      });
    });
  });

  workRequestService.getNotebookObligationsForStudent(classroom, studentId).forEach((obligation) => {
    const status = classifyWorkRequestStatus(obligation.status);
    if (!status) return;

    // See this module's own header comment on deduplication — checkpoint
    // tracking already produced this exact notebook identity's real
    // status above; this WorkRequest obligation describes the SAME
    // notebook, not a second one, so it is dropped here rather than
    // pushed as an additional item.
    const identityKey = notebookIdentityKey(obligation.subjectId, obligation.notebookTypeId);
    if (identityKey && checkpointTrackedKeys.has(identityKey)) return;

    const subject = notebookConfigService.getSubjectById(classroom, obligation.subjectId);
    const notebookType = notebookConfigService.getNotebookTypeById(classroom, obligation.notebookTypeId);
    buckets[status].push({
      source: 'workRequest',
      id: `workRequest:${obligation.requestId}`,
      title: [subject?.name, notebookType?.name].filter(Boolean).join(' — ') || obligation.title,
      subjectId: obligation.subjectId,
      notebookTypeId: obligation.notebookTypeId,
      requestId: obligation.requestId,
      dueDate: obligation.dueDate || null,
      updatedAt: obligation.updatedAt || null,
      actionable: obligation.isOpen,
    });
  });

  const summary = {};
  STATUS_KEYS.forEach((key) => {
    summary[key] = buckets[key].length;
  });

  return { summary, items: buckets };
}
