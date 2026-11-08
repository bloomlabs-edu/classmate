/**
 * functions/src/notebookObligationsProjection.js
 *
 * Deliberate duplicate of exactly four pure, read-only functions from
 * js/services/workRequestService.js — listWorkRequests, isOpen,
 * getEntryForStudent, and getNotebookObligationsForStudent itself — NOT
 * a re-export, because js/services/workRequestService.js lives outside
 * functions/, and Cloud Functions only packages the functions/
 * directory itself at deploy time (see
 * functions/src/learnerVerification/verifyLearnerConnection.js's own
 * header comment, and functions/index.js's header comment, for the
 * exact packaging failure this duplication avoids).
 *
 * Same duplication pattern already established in this codebase for
 * exactly this reason — see js/utils/hashUtils.js /
 * functions/src/learnerVerification/hashUtils.js and
 * js/models/LearnerConnection.js /
 * functions/src/learnerVerification/learnerConnectionShared.js, both
 * kept in sync via a cross-environment parity test. This file's parity
 * with js/services/workRequestService.js is asserted the same way —
 * see tests/functions/notebookObligationsProjection.test.js. If these
 * two files ever disagree, js/services/workRequestService.js is the
 * source of truth; update this file to match, byte-for-byte on
 * behavior, never the other way around.
 *
 * Every line of actual logic below is copied verbatim from
 * js/services/workRequestService.js — this file does not modify,
 * simplify, or "improve" that business logic in any way, per this
 * endpoint's own explicit requirement to reuse the existing projection
 * unmodified. createWorkRequest/createWorkRequestEntry/advanceStatus
 * and every other mutating export are deliberately NOT duplicated here
 * — this server-side endpoint is read-only (see
 * ./getNotebookObligationsForLearnerEndpoint.js's own header comment)
 * and has no legitimate reason to ever construct or mutate a
 * WorkRequest.
 *
 * ONE DELIBERATE, DOCUMENTED EXCEPTION to "verbatim" above:
 * getEntryForStudent() below guards against `workRequest.entries`
 * being missing or not an array before calling `.find()` on it — the
 * original js/services/workRequestService.js does NOT have this guard
 * (`workRequest.entries.find(...)` unconditionally), because every
 * WorkRequest it has ever written itself always populates `entries`
 * at creation (see js/models/WorkRequest.js). This server-side
 * endpoint has no such guarantee about the classroom documents it
 * reads — it can encounter a malformed or legacy notebook WorkRequest
 * it never wrote — and unlike the client-side teacher UI (where a
 * thrown exception surfaces as a visible, recoverable screen error to
 * someone who can just reload), this is a Cloud Function serving an
 * external, authenticated caller once per request: an uncaught
 * exception here would risk leaking a framework-default error
 * response instead of this endpoint's own documented anti-oracle
 * shape (see ../getNotebookObligationsForLearnerEndpoint.js's own
 * try/catch around its call into this function, which is the broader,
 * catch-all safety net this one narrow guard complements, not
 * replaces).
 *
 * js/services/workRequestService.js's own getEntryForStudent() was
 * deliberately NOT changed to add the same guard as part of this
 * endpoint's own patch — it is a shared client-side file with its own
 * callers, tests, and release process, and this task's own scope is
 * this new server-side endpoint only. That file's own same-shaped gap
 * (a WorkRequest with missing/non-array `entries` would still throw
 * there) remains open; tests/functions/notebookObligationsProjection.test.js's
 * own "malformed entries" tests below prove this gap still exists in
 * the original, specifically so this known limitation stays visible
 * and does not silently bit-rot into looking fixed.
 */

export function listWorkRequests(classroom) {
  return classroom.workRequests || [];
}

export function isOpen(workRequest) {
  return workRequest.status === 'open';
}

export function getEntryForStudent(workRequest, studentId) {
  // Guard not present in the original (see this file's own header
  // comment) — a WorkRequest with missing/null/non-array `entries` is
  // treated as "no entry for this student," identically to a
  // WorkRequest whose (valid, real) `entries` array just doesn't
  // contain this studentId. A genuinely empty array (`entries: []`)
  // already reached this same outcome before this guard existed
  // (`[].find(...)` returns `undefined`) — this guard changes nothing
  // about that intended case, only about entries being absent/malformed.
  if (!Array.isArray(workRequest.entries)) return null;
  return workRequest.entries.find((entry) => entry.studentId === studentId) || null;
}

/**
 * The student-facing equivalent of everything workRequestService.js
 * owns — one student's own obligations, across every notebook
 * WorkRequest that exists for them, most relevant first (still
 * awaiting action, then most recently resolved).
 */
export function getNotebookObligationsForStudent(classroom, studentId) {
  return listWorkRequests(classroom)
    .filter((request) => request.type === 'notebook')
    .map((request) => {
      const entry = getEntryForStudent(request, studentId);
      if (!entry) return null;
      return {
        requestId: request.id,
        title: request.title,
        subjectId: request.subjectId,
        notebookTypeId: request.notebookTypeId,
        dueDate: request.dueDate || null,
        status: entry.status,
        reviewOutcome: entry.reviewOutcome,
        isOpen: isOpen(request),
        updatedAt: entry.updatedAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aPending = a.isOpen && a.status !== 'reviewed';
      const bPending = b.isOpen && b.status !== 'reviewed';
      if (aPending !== bPending) return aPending ? -1 : 1;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
}
