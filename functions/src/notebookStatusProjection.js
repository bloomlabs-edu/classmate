/**
 * functions/src/notebookStatusProjection.js
 *
 * Deliberate duplicate of js/services/notebookStatusService.js's
 * getNotebookStatusForStudent() and its own checkpoint-side pure
 * dependencies (js/services/checkpointService.js's
 * listCheckpointsForNotebook/getRecordForStudent/
 * getCheckpointsForStudentAcrossNotebooks, js/services/
 * notebookConfigService.js's listSubjects/listNotebookTypes/
 * getSubjectById/getNotebookTypeById) — NOT a re-export, for the exact
 * same Cloud Functions packaging reason already documented in
 * ./notebookObligationsProjection.js's own header comment (functions/
 * is the only directory packaged at deploy time; a relative import
 * reaching outside it crashes the deployed container at startup).
 *
 * The legacy (WorkRequest) half of the merge is NOT re-duplicated
 * here — it already exists, verbatim, as
 * ./notebookObligationsProjection.js's own
 * getNotebookObligationsForStudent(), imported below unmodified. This
 * file adds ONLY the checkpoint half plus the merge/precedence logic
 * that combines the two, mirroring
 * js/services/notebookStatusService.js's own structure exactly —
 * same function names, same bucket keys, same field shapes, so a
 * parity test can compare this file's output against the real one
 * directly, fixture for fixture.
 *
 * PRECEDENCE RULE (copied verbatim from notebookStatusService.js's own
 * header comment, repeated here because it is the single most
 * important property of this file and must never drift):
 * checkpoint tracking WINS whenever both sources describe the same
 * (subjectId, notebookTypeId) identity — a legacy WorkRequest
 * obligation sharing that identity is DROPPED entirely, never merged,
 * never double-counted. notebookIdentityKey() returns null (never a
 * partial key) when either id is missing, so two identity-less items
 * are never falsely matched to each other.
 *
 * If this file and js/services/notebookStatusService.js (plus its own
 * checkpointService.js/notebookConfigService.js dependencies) ever
 * disagree, the ORIGINAL client-side files are the source of truth —
 * update this duplicate to match, byte-for-byte on behavior, never the
 * other way around. Parity is asserted by
 * tests/functions/notebookStatusProjection.test.js.
 *
 * ONE DELIBERATE, DOCUMENTED EXCEPTION to "verbatim," found and fixed
 * while building this file's own parity tests (same kind of exception
 * already established for ./notebookObligationsProjection.js's own
 * entries-guard — see that file's header comment): the real
 * js/services/notebookConfigService.js's listSubjects()/
 * listNotebookTypes() read `classroom.notebookConfig.subjects`/
 * `.notebookTypes` WITHOUT a defensive guard — a classroom document
 * with no `notebookConfig` field at all (a real, pre-existing shape:
 * any classroom never configured for notebooks, including a legacy-
 * only or zero-notebook classroom) makes the real
 * getNotebookStatusForStudent() THROW, uncaught, inside
 * checkpointService.getCheckpointsForStudentAcrossNotebooks(). This
 * server-side duplicate's listSubjects()/listNotebookTypes() below
 * default to an empty array instead, so a classroom with no
 * notebookConfig safely contributes zero checkpoint items rather than
 * crashing. ../getNotebookObligationsForLearnerEndpoint.js's own outer
 * try/catch around the whole projection step would catch the real
 * service's throw anyway (converting it to the same anti-oracle
 * GENERIC_FAILURE every other failure uses) — this guard exists so a
 * legitimate zero-notebook classroom gets a real "no obligations"
 * answer instead of an opaque failure, a better outcome for an
 * otherwise-unremarkable case, not a security-relevant change. The
 * real js/services/notebookConfigService.js was deliberately NOT
 * changed to add the same guard — it is a shared client-side file with
 * its own callers, tests, and release process, outside this task's
 * scope; that file's own same-shaped gap remains open and is proven to
 * still exist by this file's own parity tests, so it stays visible
 * rather than silently looking fixed.
 */

import { getNotebookObligationsForStudent } from './notebookObligationsProjection.js';

const STATUS_KEYS = ['awaitingSubmission', 'awaitingReview', 'needsCorrection', 'reviewed', 'absent'];

function emptyBuckets() {
  const buckets = {};
  STATUS_KEYS.forEach((key) => {
    buckets[key] = [];
  });
  return buckets;
}

/** Verbatim copy of notebookStatusService.js's own notebookIdentityKey(). */
function notebookIdentityKey(subjectId, notebookTypeId) {
  if (!subjectId || !notebookTypeId) return null;
  return `${subjectId}::${notebookTypeId}`;
}

/** Verbatim copy of notebookStatusService.js's own classifyCheckpoint(). */
function classifyCheckpoint(record) {
  if (!record || record.submissionStatus === 'not_submitted') return 'awaitingSubmission';
  if (record.reviewStatus === 'incomplete') return 'needsCorrection';
  if (record.reviewStatus === 'complete') return 'reviewed';
  return 'awaitingReview';
}

/** Verbatim copy of notebookStatusService.js's own classifyWorkRequestStatus(). */
function classifyWorkRequestStatus(status) {
  if (status === 'assigned') return 'awaitingSubmission';
  if (status === 'submitted' || status === 'resubmitted') return 'awaitingReview';
  if (status === 'needs_correction') return 'needsCorrection';
  if (status === 'reviewed') return 'reviewed';
  if (status === 'absent') return 'absent';
  return null;
}

// --- duplicated checkpoint-side pure helpers (js/services/checkpointService.js) ---

/** Verbatim copy of checkpointService.js's own listCheckpointsForNotebook(). */
function listCheckpointsForNotebook(classroom, subjectId, notebookTypeId) {
  return (classroom.checkpoints || [])
    .filter((c) => c.subjectId === subjectId && c.notebookTypeId === notebookTypeId)
    .sort((a, b) => a.order - b.order);
}

/** Verbatim copy of checkpointService.js's own getRecordForStudent(). */
function getRecordForStudent(checkpoint, studentId) {
  return (checkpoint.records || []).find((r) => r.studentId === studentId) || null;
}

// --- duplicated notebookConfigService.js pure helpers ---

/** Verbatim copy of notebookConfigService.js's own listSubjects(). */
function listSubjects(classroom) {
  return (classroom.notebookConfig && classroom.notebookConfig.subjects) || [];
}

/** Verbatim copy of notebookConfigService.js's own listNotebookTypes(). */
function listNotebookTypes(classroom, subjectId) {
  const types = (classroom.notebookConfig && classroom.notebookConfig.notebookTypes) || [];
  return subjectId ? types.filter((type) => type.subjectId === subjectId) : types;
}

/** Verbatim copy of notebookConfigService.js's own getSubjectById(). */
function getSubjectById(classroom, subjectId) {
  return ((classroom.notebookConfig && classroom.notebookConfig.subjects) || []).find((s) => s.id === subjectId) || null;
}

/** Verbatim copy of notebookConfigService.js's own getNotebookTypeById(). */
function getNotebookTypeById(classroom, typeId) {
  return ((classroom.notebookConfig && classroom.notebookConfig.notebookTypes) || []).find((t) => t.id === typeId) || null;
}

/** Verbatim copy of checkpointService.js's own getCheckpointsForStudentAcrossNotebooks(). */
function getCheckpointsForStudentAcrossNotebooks(classroom, studentId) {
  const notebooks = [];

  listSubjects(classroom).forEach((subject) => {
    listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      const checkpoints = listCheckpointsForNotebook(classroom, subject.id, notebookType.id);
      if (checkpoints.length === 0) return; // an empty Notebook contributes nothing to a student's own view at all

      notebooks.push({
        subject,
        notebookType,
        checkpoints: checkpoints.map((checkpoint) => ({
          checkpoint,
          record: getRecordForStudent(checkpoint, studentId),
        })),
      });
    });
  });

  return notebooks;
}

/**
 * One student's full notebook-status picture, merged across both
 * tracking systems — verbatim port of notebookStatusService.js's own
 * getNotebookStatusForStudent(). See this file's own header comment
 * for the precedence rule and why this must stay byte-for-byte
 * identical to the original's behavior.
 *
 * `summary` — a plain count per status (always includes all of
 * STATUS_KEYS, 0 where nothing contributes).
 * `items` — the same totals broken out into individual notebooks/
 * checkpoints, each `{source, id, title, subjectId, notebookTypeId,
 * checkpointId?, requestId?, dueDate, updatedAt, actionable}`. This is
 * the FULL internal shape (matching the original exactly, for parity
 * testing) — the Cloud Function endpoint that calls this is
 * responsible for its own further field-minimization before any of
 * this crosses the project boundary to Learning Hub (see
 * ../getNotebookObligationsForLearnerEndpoint.js's own response
 * construction) — this module itself has no cross-project awareness
 * and performs no minimization of its own, exactly like
 * ./notebookObligationsProjection.js before it.
 */
export function getNotebookStatusForStudent(classroom, studentId) {
  const buckets = emptyBuckets();
  const checkpointTrackedKeys = new Set();

  getCheckpointsForStudentAcrossNotebooks(classroom, studentId).forEach(({ subject, notebookType, checkpoints }) => {
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
        updatedAt: (record && record.updatedAt) || null,
        actionable: true,
      });
    });
  });

  getNotebookObligationsForStudent(classroom, studentId).forEach((obligation) => {
    const status = classifyWorkRequestStatus(obligation.status);
    if (!status) return;

    // See this file's own header comment on deduplication — checkpoint
    // tracking already produced this exact notebook identity's real
    // status above; this WorkRequest obligation describes the SAME
    // notebook, not a second one, so it is dropped here rather than
    // pushed as an additional item.
    const identityKey = notebookIdentityKey(obligation.subjectId, obligation.notebookTypeId);
    if (identityKey && checkpointTrackedKeys.has(identityKey)) return;

    const subject = getSubjectById(classroom, obligation.subjectId);
    const notebookType = getNotebookTypeById(classroom, obligation.notebookTypeId);
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

/** Exposed ONLY for this file's own parity test — never imported by the endpoint. */
export const __testing = {
  notebookIdentityKey,
  classifyCheckpoint,
  classifyWorkRequestStatus,
  listCheckpointsForNotebook,
  getRecordForStudent,
  listSubjects,
  listNotebookTypes,
  getSubjectById,
  getNotebookTypeById,
  getCheckpointsForStudentAcrossNotebooks,
};
