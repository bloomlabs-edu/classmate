/**
 * models/AssignmentCheckpoint.js
 *
 * A teacher-defined checkpoint within one Assignment (identified by
 * `assignmentId`) — direct sibling of models/Checkpoint.js (Notebook
 * Checkpoints), with the identity pair `subjectId`+`notebookTypeId`
 * replaced by a single `assignmentId`. Everything else — shape,
 * semantics, sparse-record convention, `order`/`dueDate` rules — is
 * identical by design, per the Assignment Tracker redesign's explicit
 * instruction to reuse the Notebook checkpoint architecture rather than
 * inventing a parallel one.
 *
 * `records` is SPARSE, same as Checkpoint.records: created with
 * `records: []`, and a StudentCheckpointRecord (see that model — REUSED
 * here verbatim, not re-implemented) is only ever added once a teacher
 * genuinely does something for that specific student on this checkpoint.
 *
 * `dueDate` is explicitly optional — `''` when not set. Lateness is
 * derived elsewhere (see services/assignmentCheckpointService.js's
 * isLate(), mirroring checkpointService.js's own) by comparing a
 * record's own submittedDate against this field.
 *
 * `order` is a plain integer a teacher can freely reassign — display
 * ordering only, never inferred from creation time or title.
 *
 * Deliberately has NO `conceptIds` of its own — concept linking stays
 * at the parent Assignment level only (see models/Assignment.js), the
 * same way models/Checkpoint.js's own header comment establishes that a
 * checkpoint "must not gain a concept of curriculum units at all."
 * Observation-aspect ratings (models/StudentAssignmentRecord.js) also
 * stay at the Assignment level, not here — checkpoint completion and
 * Overall Rating are two independent, coexisting tracking axes, never
 * merged (see services/assignmentCheckpointService.js's own header
 * comment).
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createAssignmentCheckpoint({
  id,
  assignmentId,
  title,
  description = '',
  givenDate,
  dueDate = '',
  order = 0,
  createdAt,
  records = [],
} = {}) {
  return {
    id: id || generateId(),
    assignmentId,
    title,
    description,
    givenDate: givenDate || getCurrentIsoDate(),
    dueDate,
    order,
    createdAt: createdAt || getCurrentIsoDate(),
    records,
  };
}
