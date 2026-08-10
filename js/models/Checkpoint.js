/**
 * models/Checkpoint.js
 *
 * A teacher-defined checkpoint within one Notebook (identified by
 * `subjectId` + `notebookTypeId`, the same identity pair
 * WorkRequest.js already uses) — "Unit 2," "Question Paper,"
 * "Homework — Force & Pressure," anything a teacher names. `title` is
 * a plain string; this model has no concept of curriculum units at
 * all, and must not gain one — per explicit product decision, a
 * checkpoint's identity and existence never depends on curriculum
 * data being present.
 *
 * Deliberately NOT built on WorkRequest.js, despite the surface
 * similarity ("a teacher-created expectation that student work gets
 * submitted and reviewed" — WorkRequest's own header comment).
 * WorkRequest enforces exactly one open request per subject/type at a
 * time (see workRequestService.js's createNewWorkRequest()) — a real,
 * load-bearing constraint for its own actual purpose (a recurring,
 * one-at-a-time physical notebook check), but fundamentally
 * incompatible with checkpoints, which must coexist permanently and
 * simultaneously (Unit 1, Unit 2, and Question Paper all open at
 * once). This is a new, sibling model — same classroom-embedded
 * storage pattern, same reference-not-copy conventions, same
 * service-owns-mutation split — not a second parallel Notebook
 * system layered on top of an incompatible one.
 *
 * `records` is SPARSE by explicit design — mirrors models/Goal.js's
 * own "no row until something is actually entered" convention
 * directly: a checkpoint is created with `records: []`, and a
 * StudentCheckpointRecord (see that model) is only ever added once a
 * teacher genuinely does something for that specific student on this
 * checkpoint (a submission, a review, a note). Absence of a record
 * means exactly `not_submitted` + `not_reviewed` — the same
 * "presence means it happened, absence means it didn't" principle
 * goalCompletionService.js already uses for daily completions.
 *
 * `dueDate` is explicitly optional — `''` when not set, never
 * assumed present. Lateness is derived elsewhere (see
 * services/checkpointService.js's isLate()) by comparing a record's
 * own submittedDate against this field; never stored here or on the
 * record, and a checkpoint with no dueDate can never produce a late
 * submission at all, by construction.
 *
 * `order` is a plain integer a teacher can freely reassign — display
 * ordering only, never inferred from creation time or title.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createCheckpoint({
  id,
  subjectId,
  notebookTypeId,
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
    subjectId,
    notebookTypeId,
    title,
    description,
    givenDate: givenDate || getCurrentIsoDate(),
    dueDate,
    order,
    createdAt: createdAt || getCurrentIsoDate(),
    records,
  };
}
