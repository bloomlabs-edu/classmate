/**
 * models/StudentCheckpointRecord.js
 *
 * One student's own activity on one Checkpoint (see that model) —
 * created ONLY when something genuinely happens for that specific
 * student/checkpoint pair (a submission, a review, a note), never
 * upfront for every student the moment a checkpoint is created. This
 * is the sparse convention Checkpoint.js's own header comment
 * describes, applied concretely here — mirrors models/Goal.js's own
 * "no row until something is actually entered" pattern.
 *
 * `submissionStatus` — 'not_submitted' | 'submitted'.
 * `reviewStatus` — 'not_reviewed' | 'complete' | 'incomplete'.
 *
 * These are genuinely two independent dimensions, per explicit
 * product decision — but NOT every combination is valid. Exactly
 * four real workflow states exist:
 *   not_submitted + not_reviewed   (the default, and the only valid
 *                                   state while nothing has happened)
 *   submitted     + not_reviewed
 *   submitted     + complete
 *   submitted     + incomplete
 *
 * `not_submitted + complete` and `not_submitted + incomplete` are
 * explicitly disallowed — reviewing is something that happens to a
 * submission; a teacher can attach a note to a student who hasn't
 * submitted anything yet (see `teacherNote` below), but that is not
 * the same act as reviewing their work, and must never be represented
 * as one. This restriction is enforced by services/checkpointService.js's
 * own setReview() — see that function's own comment for the exact
 * check — never by this model, matching this app's own established
 * "model defines shape, service enforces the state machine" split
 * (see models/WorkRequest.js's own "only one open request" comment
 * for the same division of responsibility elsewhere in this app).
 *
 * `submittedDate`/`reviewedDate` are independently, directly
 * editable facts, not derived from `history` or any append-only log
 * — a genuine, deliberate difference from WorkRequestEntry.js's own
 * `updatedAt`, which gets silently overwritten by every later
 * transition and can't serve as a stable, correctable "date
 * submitted." A teacher must be able to correct either date later
 * without that correction being misread as a new event.
 *
 * "Late" is never stored on this record at all — always derived by
 * comparing `submittedDate` against the parent Checkpoint's own
 * `dueDate` at read time (see checkpointService.js's isLate()).
 *
 * `teacherNote` is optional and independent of both status
 * dimensions — a teacher may leave a note on a student who has not
 * submitted anything at all.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createStudentCheckpointRecord({
  id,
  studentId,
  submissionStatus = 'not_submitted',
  submittedDate = null,
  reviewStatus = 'not_reviewed',
  reviewedDate = null,
  teacherNote = '',
  updatedAt,
} = {}) {
  return {
    id: id || generateId(),
    studentId,
    submissionStatus,
    submittedDate,
    reviewStatus,
    reviewedDate,
    teacherNote,
    updatedAt: updatedAt || getCurrentIsoDate(),
  };
}
