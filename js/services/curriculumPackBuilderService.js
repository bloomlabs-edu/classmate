/**
 * services/curriculumPackBuilderService.js
 *
 * Manages a Curriculum Pack while an admin is building it in
 * ui/views/CurriculumManagementView.js's Contribute Curriculum flow —
 * before it's a real, published entry in the Curriculum Library.
 * createDraftPack() captures the full standardized metadata set
 * up front, before any extraction happens — Curriculum Name, Board,
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
 * Table of Contents Extraction milestone: a unit built from a PDF
 * arrives with a page range (`startPage`/`endPage`) but no concepts —
 * see loadUnitsFromTableOfContents() and
 * services/curriculumPdfParsingService.js's parseTableOfContents()
 * for why. A unit added by hand has no page range at all
 * (`startPage`/`endPage` both `null`) — there's no PDF page it came
 * from. Both shapes flow through exportPackJson() the same way, so a
 * published curriculum's units always carry whatever page range
 * information exists for them, ready for whenever concept extraction
 * by page range actually gets built.
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

/** Replaces the draft's units wholesale with the parser's output — used right after a PDF is processed, before any manual editing has happened. */
/**
 * Builds a draft's units directly from a parsed Table of Contents
 * (see services/curriculumPdfParsingService.js's parseTableOfContents())
 * — each unit arrives with a real title and page range but,
 * deliberately, no concepts yet: concept extraction is a separate,
 * later step (see that file's own header comment), not something this
 * milestone does at curriculum-creation time.
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
 * Produces the exact JSON shape services/curriculumLibraryService.js's
 * getPublishedLibrary() groups by curriculum+version — see this
 * project's Curriculum Library Data Integrity milestone. Every field
 * a curriculum card and its Details screen show (Board, Academic
 * Year, Version, Language, Publisher) is captured here, not
 * back-filled later — a published curriculum never has placeholder
 * metadata.
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
