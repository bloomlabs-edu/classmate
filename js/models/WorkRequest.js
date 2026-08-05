/**
 * models/WorkRequest.js
 *
 * A teacher-created expectation that a specific piece of student work
 * (Notebook Check today; Worksheet, Project, Reading Log, Lab Record,
 * Portfolio later — see config/workRequestTypes.js) gets submitted,
 * reviewed, and returned. Notebook work is only the first
 * implementation of this — the aggregate itself is not notebook-
 * specific.
 *
 * Deliberately its own aggregate, not an evolution of
 * models/LearningActivity.js — the two are declarative vs. imperative
 * (see services/workRequestService.js's own header comment for the
 * full reasoning). The overlap in example type names ("Notebook
 * Check," "Worksheet") is coincidental vocabulary, not shared
 * structure: LearningActivity lets a teacher directly assert any
 * status at any time with no ordering; a WorkRequest's own entries
 * always progress through one real, service-enforced lifecycle (see
 * services/workRequestService.js's advanceStatus()).
 *
 * `subjectId`/`notebookTypeId` are notebook-specific reference fields,
 * present now because Notebook is the only type that exists — a
 * future type (Worksheet, Project, ...) gets its own reference
 * field(s) added when it's actually built, not designed speculatively
 * now. This mirrors the same "don't force a shared shape prematurely"
 * principle already applied to rejecting a generic ClassroomTask
 * aggregate.
 *
 * `status` — 'open' | 'closed'. Only one open WorkRequest may exist
 * per `type` + `subjectId` + `notebookTypeId` combination at a time —
 * enforced by the service (see createNewWorkRequest()'s own comment),
 * the same "enforced by the service, not the model" split every other
 * teacher-created cycle in this app already follows (GoalCycle,
 * Assessment).
 *
 * `entries` is a flat array of WorkRequestEntry (see that model) —
 * one per student on the roster at creation time, referencing
 * `studentId` by id, never a copy, matching this app's own
 * established reference-not-copy convention throughout.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createWorkRequest({
  id,
  type = 'notebook',
  title,
  subjectId,
  notebookTypeId,
  createdDate,
  dueDate = '',
  status = 'open',
  entries = [],
} = {}) {
  return {
    id: id || generateId(),
    type,
    title,
    subjectId,
    notebookTypeId,
    createdDate: createdDate || getCurrentIsoDate(),
    dueDate,
    status,
    entries,
  };
}
