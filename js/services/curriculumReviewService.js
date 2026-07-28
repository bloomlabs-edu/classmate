/**
 * services/curriculumReviewService.js
 *
 * Curriculum Import Pipeline redesign: owns every edit a teacher can
 * make while reviewing a curriculum before it's submitted — renaming,
 * deleting, reordering, merging, and splitting Units; renaming,
 * deleting, and reordering Concepts within a Unit — plus building and
 * exporting the underlying draft itself. This used to live under the
 * name "curriculumPackBuilderService" (the file has moved, not just
 * been renamed cosmetically): rename/delete/merge/split are business
 * logic, not presentation, and belong in a service a UI view calls
 * into rather than something embedded directly in
 * ui/views/CurriculumManagementView.js, where it would eventually be
 * hard to test or reuse on its own.
 *
 * createDraftPack() captures the full standardized metadata set up
 * front, before any extraction happens — Curriculum Name, Board,
 * Grade, Subject, Academic Year, Version, Language, Publisher — so a
 * published curriculum never has placeholder or back-filled fields.
 *
 * A draft's units/concepts are plain objects with ids (for stable UI
 * keys while editing), unlike the final exported JSON, where a unit's
 * concepts are a plain string array — exactly matching the shape
 * services/curriculumSubmissionsService.js stores and
 * services/curriculumLibraryService.js reads. exportPackJson() is the
 * one place that difference gets flattened out.
 *
 * Same mutate-in-place convention as every other service in this
 * app's editing screens: functions here mutate the draft object
 * directly; ui/views/CurriculumManagementView.js re-renders after
 * calling them.
 *
 * A unit built from a PDF's Table of Contents (see
 * services/tableOfContentsService.js's parseTableOfContents()) arrives
 * with a page range (`startPage`/`endPage`) but no concepts yet —
 * concept extraction is a separate, later, on-demand step (see
 * services/conceptExtractionService.js) run only once a teacher
 * actually reaches that Unit's review step, not at curriculum-creation
 * time. A unit added by hand has no page range at all
 * (`startPage`/`endPage` both `null`) — there's no PDF page it came
 * from. Both shapes flow through exportPackJson() the same way.
 *
 * mergeUnits() and splitUnit() exist because a Table of Contents isn't
 * always a perfect one-to-one map to how a teacher actually wants a
 * curriculum organized — two ToC entries might really be one lesson,
 * or one entry might cover more ground than a single Unit should. Both
 * operations happen during Stage 4 (Review Units), before any concept
 * extraction — see this file's own function comments for exactly what
 * each one does with page ranges and concepts.
 */

import { generateId } from '../utils/idGenerator.js';

export function createDraftPack({ curriculumName, board, gradeName, subjectName, academicYear, versionLabel, language, publisher }) {
  return {
    curriculumName,
    board,
    gradeName,
    subjectName,
    academicYear,
    versionLabel,
    language,
    publisher,
    units: [],
  };
}

/**
 * Builds a draft's units directly from a parsed Table of Contents
 * (see services/tableOfContentsService.js's parseTableOfContents())
 * — each unit arrives with a real title and page range but,
 * deliberately, no concepts yet.
 */
export function loadUnitsFromTableOfContents(draft, tocUnits) {
  draft.units = tocUnits.map((tocUnit) => ({
    id: generateId(),
    title: tocUnit.title,
    concepts: [],
    startPage: tocUnit.startPage,
    endPage: tocUnit.endPage,
  }));
}

export function addDraftUnit(draft, title, { startPage = null, endPage = null } = {}) {
  const unit = { id: generateId(), title, concepts: [], startPage, endPage };
  draft.units.push(unit);
  return unit;
}

export function renameDraftUnit(draft, unitId, newTitle) {
  const unit = draft.units.find((u) => u.id === unitId);
  if (unit) unit.title = newTitle;
  return unit;
}

export function deleteDraftUnit(draft, unitId) {
  draft.units = draft.units.filter((u) => u.id !== unitId);
}

export function moveDraftUnitUp(draft, unitId) {
  const index = draft.units.findIndex((u) => u.id === unitId);
  if (index <= 0) return;
  [draft.units[index - 1], draft.units[index]] = [draft.units[index], draft.units[index - 1]];
}

export function moveDraftUnitDown(draft, unitId) {
  const index = draft.units.findIndex((u) => u.id === unitId);
  if (index === -1 || index >= draft.units.length - 1) return;
  [draft.units[index], draft.units[index + 1]] = [draft.units[index + 1], draft.units[index]];
}

/**
 * Combines two Units into one, in the position of whichever one
 * appears first in the draft — for when a Table of Contents lists two
 * entries that are really one lesson. The combined unit's page range
 * spans both originals (the earlier start, the later end — whichever
 * side is missing a page range, e.g. a manually-added unit, is simply
 * ignored rather than treated as page 0); its title is both originals
 * joined, left for the teacher to rename immediately after if they'd
 * rather keep just one; its concepts are both originals' lists
 * concatenated, de-duplicated case-insensitively by title. The second
 * unit is removed from the draft entirely.
 */
export function mergeUnits(draft, unitIdA, unitIdB) {
  const indexA = draft.units.findIndex((u) => u.id === unitIdA);
  const indexB = draft.units.findIndex((u) => u.id === unitIdB);
  if (indexA === -1 || indexB === -1 || indexA === indexB) return null;

  const [firstIndex, secondIndex] = indexA < indexB ? [indexA, indexB] : [indexB, indexA];
  const first = draft.units[firstIndex];
  const second = draft.units[secondIndex];

  const startPages = [first.startPage, second.startPage].filter((p) => p != null);
  const endPages = [first.endPage, second.endPage].filter((p) => p != null);

  const seenTitles = new Set();
  const mergedConcepts = [...first.concepts, ...second.concepts].filter((concept) => {
    const key = concept.title.trim().toLowerCase();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  const merged = {
    id: generateId(),
    title: `${first.title} & ${second.title}`,
    concepts: mergedConcepts,
    startPage: startPages.length > 0 ? Math.min(...startPages) : null,
    endPage: endPages.length > 0 ? Math.max(...endPages) : null,
  };

  draft.units.splice(firstIndex, 1, merged);
  draft.units.splice(secondIndex, 1);
  return merged;
}

/**
 * Splits one Unit into two, at a given page number — for when a
 * single Table of Contents entry actually covers more ground than one
 * Unit should. `atPage` must fall strictly after the unit's own
 * `startPage` and no later than its `endPage`; anything outside that
 * range is rejected (returns `null`) rather than silently producing
 * an empty or overlapping half. The first half keeps `startPage`
 * through `atPage - 1`; the second half gets `atPage` through the
 * original `endPage`. Both halves start with empty concept lists —
 * splitting is a Stage 4 (Review Units) operation, which always
 * happens before any concept extraction, so there's nothing to divide
 * between them yet. A unit with no page range at all (added by hand,
 * not from a PDF) can't be split by page; use "Add Unit" instead.
 */
export function splitUnit(draft, unitId, atPage) {
  const index = draft.units.findIndex((u) => u.id === unitId);
  if (index === -1) return null;
  const unit = draft.units[index];
  if (unit.startPage == null || unit.endPage == null) return null;
  if (atPage <= unit.startPage || atPage > unit.endPage) return null;

  const firstHalf = {
    id: generateId(),
    title: `${unit.title} (Part 1)`,
    concepts: [],
    startPage: unit.startPage,
    endPage: atPage - 1,
  };
  const secondHalf = {
    id: generateId(),
    title: `${unit.title} (Part 2)`,
    concepts: [],
    startPage: atPage,
    endPage: unit.endPage,
  };

  draft.units.splice(index, 1, firstHalf, secondHalf);
  return [firstHalf, secondHalf];
}

export function addDraftConcept(draft, unitId, title) {
  const unit = draft.units.find((u) => u.id === unitId);
  if (!unit) return null;
  const concept = { id: generateId(), title };
  unit.concepts.push(concept);
  return concept;
}

export function renameDraftConcept(draft, unitId, conceptId, newTitle) {
  const unit = draft.units.find((u) => u.id === unitId);
  const concept = unit?.concepts.find((c) => c.id === conceptId);
  if (concept) concept.title = newTitle;
  return concept;
}

export function deleteDraftConcept(draft, unitId, conceptId) {
  const unit = draft.units.find((u) => u.id === unitId);
  if (!unit) return;
  unit.concepts = unit.concepts.filter((c) => c.id !== conceptId);
}

export function moveDraftConceptUp(draft, unitId, conceptId) {
  const unit = draft.units.find((u) => u.id === unitId);
  if (!unit) return;
  const index = unit.concepts.findIndex((c) => c.id === conceptId);
  if (index <= 0) return;
  [unit.concepts[index - 1], unit.concepts[index]] = [unit.concepts[index], unit.concepts[index - 1]];
}

export function moveDraftConceptDown(draft, unitId, conceptId) {
  const unit = draft.units.find((u) => u.id === unitId);
  if (!unit) return;
  const index = unit.concepts.findIndex((c) => c.id === conceptId);
  if (index === -1 || index >= unit.concepts.length - 1) return;
  [unit.concepts[index], unit.concepts[index + 1]] = [unit.concepts[index + 1], unit.concepts[index]];
}

export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Produces the exact JSON shape services/curriculumLibraryService.js
 * groups by curriculum+version. Every field a curriculum card and its
 * Details screen show (Board, Academic Year, Version, Language,
 * Publisher) is captured here, not back-filled later — a published
 * curriculum never has placeholder metadata.
 */
export function exportPackJson(draft) {
  const id = `${slugify(draft.curriculumName)}-${slugify(draft.gradeName)}-${slugify(draft.subjectName)}`;
  return {
    id,
    curriculum: draft.curriculumName,
    board: draft.board,
    grade: draft.gradeName,
    subject: draft.subjectName,
    academicYear: draft.academicYear,
    versionLabel: draft.versionLabel,
    language: draft.language,
    publisher: draft.publisher,
    units: draft.units.map((unit) => ({
      id: slugify(unit.title),
      title: unit.title,
      concepts: unit.concepts.map((concept) => concept.title),
      startPage: unit.startPage ?? null,
      endPage: unit.endPage ?? null,
    })),
  };
}
