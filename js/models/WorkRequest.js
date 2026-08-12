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
 *
 * `curriculumUnitId`/`curriculumUnitNumberSnapshot`/
 * `curriculumUnitTitleSnapshot` — optional. A notebook check may
 * exist for reasons that have nothing to do with curriculum (Holiday
 * Homework, Revision Notebook, a Practical Record, a surprise
 * inspection); when it does relate to a specific unit, this is
 * captured here, but the relationship is never required — Notebook
 * identity stays exactly (subjectId, notebookTypeId), never including
 * curriculum, and this must not change (see
 * services/workRequestService.js's own getLastChecked()/
 * getNotebooksForStudent(), whose own correctness — history and
 * "Last Checked" spanning many cycles regardless of which unit each
 * one happened to be for — already depends on curriculum staying
 * outside notebook identity).
 *
 * Per the frozen platform principle — "references preserve
 * relationships, snapshots preserve history" — these are two
 * different responsibilities, not duplicated data:
 *   - `curriculumUnitId` is a stable reference for joins, navigation,
 *     analytics, and future Learning Hub integration. It may resolve
 *     to a unit that has since been renamed, reorganized, or deleted
 *     entirely — that's expected, not an error condition, and this
 *     field alone should never be used for display.
 *   - `curriculumUnitNumberSnapshot`/`curriculumUnitTitleSnapshot` are
 *     captured ONCE, at creation, and never updated or re-resolved
 *     afterwards — even while the request stays open for corrections.
 *     The teacher's intent is recorded at the moment they created the
 *     check, not at whatever moment it happens to close; renaming the
 *     unit six months later must never rewrite what this request
 *     already, correctly means. These are raw context DATA, not
 *     preformatted display strings — every renderer composes them
 *     however fits that screen (see
 *     ui/views/WorkRequestRosterView.js and
 *     services/workTypes/NotebookWorkType.js for two different, real
 *     compositions of the same two raw fields).
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
  curriculumUnitId,
  curriculumUnitNumberSnapshot,
  curriculumUnitTitleSnapshot,
  pinnedToDashboard = false,
} = {}) {
  const request = {
    id: id || generateId(),
    type,
    title,
    subjectId,
    notebookTypeId,
    createdDate: createdDate || getCurrentIsoDate(),
    dueDate,
    status,
    entries,
    pinnedToDashboard,
  };

  // Only set when actually provided -- an explicit `key: undefined`
  // still creates the key in the object literal, and Firestore
  // rejects undefined values outright. A request with no curriculum
  // relationship must have these keys genuinely absent, not present
  // with an undefined value.
  if (curriculumUnitId !== undefined) request.curriculumUnitId = curriculumUnitId;
  if (curriculumUnitNumberSnapshot !== undefined) request.curriculumUnitNumberSnapshot = curriculumUnitNumberSnapshot;
  if (curriculumUnitTitleSnapshot !== undefined) request.curriculumUnitTitleSnapshot = curriculumUnitTitleSnapshot;

  return request;
}
