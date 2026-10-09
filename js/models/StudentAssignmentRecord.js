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
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createStudentAssignmentRecord({ id, studentId, ratings = {}, teacherNote = '', updatedAt } = {}) {
  return {
    id: id || generateId(),
    studentId,
    ratings,
    teacherNote,
    updatedAt: updatedAt || getCurrentIsoDate(),
  };
}
