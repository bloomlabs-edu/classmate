/**
 * models/StudentAssignmentRecord.js
 *
 * One student's own activity on one Assignment (see that model) —
 * created ONLY when something genuinely happens for that specific
 * student/assignment pair, same sparse convention as
 * models/StudentCheckpointRecord.js.
 *
 * `ratings` — the generalized tracking axis, per explicit product
 * instruction: "support different teacher-defined aspects such as
 * participation, completion, accuracy, quality, collaboration, etc.,
 * rather than hard-coding participation." Shape: `{ [aspectId]: rating
 * }`, where `aspectId` references one of this assignment's own
 * category's `aspects` (see models/AssignmentCategory.js) and `rating`
 * is one of 'not_yet' | 'developing' | 'met' — the one fixed, reused
 * SCALE every aspect shares (so the UI is one consistent 3-state
 * control repeated per aspect, not a different custom scale per
 * aspect), while WHICH aspects exist and WHAT they're called is never
 * fixed anywhere in code. This is the direct generalization of
 * StudentCheckpointRecord's own hardcoded `submissionStatus`/
 * `reviewStatus` pair into an open map — nothing here special-cases
 * "completion" or "participation" as a distinct, hardcoded field the
 * way Checkpoint does for submission.
 *
 * A record with an empty `ratings` map (or no record at all) means
 * nothing has happened yet for this student on this assignment —
 * identical in spirit to Checkpoint's own "absence means not_submitted"
 * rule, just generalized across however many aspects the category
 * defines (see services/assignmentService.js's own getAssignmentCellStatus()
 * for how this derives a single at-a-glance status).
 *
 * `teacherNote` is independent of `ratings`, same as
 * StudentCheckpointRecord's own `teacherNote`.
 *
 * `completionStatus` — 'done' | 'not_done' | null. A THIRD, independent
 * tracking axis, deliberately never merged with `ratings` above or with
 * AssignmentCheckpoint's own submission/review axis (see
 * ui/views/AssignmentDetailView.js's own header comment: "two
 * independent axes, never merged" — this is that same established
 * pattern extended to a third). Exists so a plain worksheet can be
 * marked done/undone directly, with zero checkpoints and with no
 * category `aspects` configured at all — per explicit product
 * instruction, a teacher must not have to invent a fake checkpoint just
 * to record that a task was completed. `null` (or no record at all)
 * means "Not Recorded" — the same "absence means nothing happened yet"
 * sparse convention every other record in this app already uses; there
 * is no separate stored value for "Not Recorded," it is simply the
 * absence of 'done'/'not_done'. Completion is deliberately NEVER a
 * proxy for submission, quality, or marks — those stay on `ratings`/
 * `teacherNote`/AssignmentCheckpoint, untouched by this field.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createStudentAssignmentRecord({ id, studentId, ratings = {}, teacherNote = '', completionStatus = null, updatedAt } = {}) {
  return {
    id: id || generateId(),
    studentId,
    ratings,
    teacherNote,
    completionStatus,
    updatedAt: updatedAt || getCurrentIsoDate(),
  };
}
