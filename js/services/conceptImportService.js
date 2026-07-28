/**
 * services/conceptImportService.js
 *
 * The one generic pipeline every bulk concept import goes through,
 * regardless of where the concept titles came from. Its input
 * contract is deliberately minimal and source-agnostic — a plain
 * array of title strings — so:
 *   - Curriculum Library (this milestone — see
 *     services/curriculumLibraryService.js) hands it the concept
 *     titles from a chosen chapter.
 *   - A future PDF Upload importer would extract titles from a
 *     document and hand this the exact same shape.
 *   - A future Paste Text importer would split pasted lines into
 *     titles and hand this the exact same shape.
 *
 * None of those sources needs to know anything about
 * services/learningRecordTeacherService.js, Firestore, or how a
 * Concept is actually created — they only need to produce
 * `string[]`. This file is the only thing that knows how an import
 * candidate becomes a real Concept.
 *
 * Same mutate-then-caller-saves convention as every other service in
 * this app: nothing here calls workspaceService.save() itself.
 */

import * as learningRecordTeacherService from './learningRecordTeacherService.js';

/**
 * Creates one Concept per title, in order, on the given unit. Blank
 * titles are silently skipped rather than creating an empty-titled
 * Concept — a teacher unchecking every item in a review step and
 * hitting Import should do nothing, not create zero-length junk.
 *
 * Returns the array of newly created Concept objects, in the same
 * order as `conceptTitles` — callers (see ui/views/AddConceptsView.js)
 * use this to show "12 concepts imported" and to immediately reflect
 * them in the current unit's list.
 */
export function importConceptsIntoUnit(classroom, unit, conceptTitles) {
  return conceptTitles
    .map((title) => (title || '').trim())
    .filter(Boolean)
    .map((title) => learningRecordTeacherService.createConcept(classroom, unit.id, { title }));
}
