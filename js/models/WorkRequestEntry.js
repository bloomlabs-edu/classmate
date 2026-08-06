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
 *   'absent'             — exceptional; reachable only via a
 *                         dedicated action, never advanced through
 *
 * `reviewOutcome` — 'complete' | 'incomplete' | null. Meaningful only
 * once `status === 'reviewed'`. Deliberately NOT a fifth status value:
 * "Incomplete" is a different *outcome* of the same review stage, not
 * a different stage of the lifecycle — the one-tap primary button
 * always sets 'complete' (the common case); "Mark Incomplete" is an
 * overflow-menu action offering the other outcome instead of the
 * default one, mirroring how "Needs Correction" already offers an
 * alternative to a plain review pass. Keeping this a field rather
 * than a status means every existing consumer of `status` (pending
 * tasks, summary cards, filters) never needs to learn a value that
 * means almost the same thing as 'reviewed' already does.
 *
 * `history` — an append-only log of every status this entry has ever
 * held, `{ status, date, reviewOutcome? }`, oldest first — the
 * `reviewOutcome` is included on 'reviewed' entries specifically, so
 * expanding a student's history can distinguish a complete pass from
 * an incomplete one, not just show "Reviewed" twice with no way to
 * tell them apart. This is what lets the WorkRequest's own roster
 * screen show each student's full lifecycle inline (see
 * ui/views/WorkRequestRosterView.js) without a separate Timeline page.
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

export function createWorkRequestEntry({ id, studentId, status = 'assigned', updatedAt = null, reviewOutcome = null, history = null } = {}) {
  return {
    id: id || generateId(),
    studentId,
    status,
    reviewOutcome,
    updatedAt,
    history: history || [{ status, date: getCurrentIsoDate() }],
  };
}
