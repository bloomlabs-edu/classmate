/**
 * models/WorkRequestEntry.js
 *
 * One student's own progression through a WorkRequest's lifecycle
 * (see that model). `studentId` is a reference, never a copy — the
 * same convention every per-student record in this app already
 * follows (StudentResult, Goal).
 *
 * `status` — one of:
 *   'assigned'          — the default; the student hasn't submitted yet
 *   'submitted'
 *   'needs_correction'  — the exceptional branch; reached only via an
 *                         explicit, secondary teacher action, never
 *                         the primary one-tap button
 *   'resubmitted'
 *   'reviewed'           — terminal; the work has been checked, and
 *                         (matching the real classroom workflow) is
 *                         by definition also "ready to return" — no
 *                         separate tracked state exists for the
 *                         physical act of handing it back
 *
 * `history` — an append-only log of every status this entry has ever
 * held, `{ status, date }`, oldest first. This is what lets the
 * WorkRequest's own roster screen show each student's full lifecycle
 * inline (see ui/views/WorkRequestRosterView.js) without a separate
 * Timeline page — the previous Notebook Tracker's Timeline screen
 * existed only because the old day-by-day register had no other way
 * to answer "what happened to this notebook over time"; a
 * WorkRequestEntry already carries its own answer.
 *
 * See services/workRequestService.js's advanceStatus() for the exact,
 * one-tap-per-transition happy path this status field is designed
 * around: 'assigned' -> 'submitted' -> 'reviewed', with
 * 'needs_correction' -> 'resubmitted' -> 'reviewed' as the one
 * exceptional branch — optimized for the common case being a single
 * tap, per explicit product decision, not for symmetry between every
 * possible path.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createWorkRequestEntry({ id, studentId, status = 'assigned', updatedAt = null, history = null } = {}) {
  return {
    id: id || generateId(),
    studentId,
    status,
    updatedAt,
    history: history || [{ status, date: getCurrentIsoDate() }],
  };
}
