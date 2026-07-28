/**
 * services/curriculumPackBuilderService.js
 *
 * Manages a Curriculum Pack while an admin is building it in
 * ui/views/CurriculumManagementView.js — before it's a real file on
 * disk. A draft's units/concepts are plain objects with ids (for
 * stable UI keys while editing), unlike the final exported JSON,
 * where a unit's concepts are a plain string array — exactly matching
 * the shape services/curriculumLibraryService.js and
 * data/curriculum/*.json already use. exportPackJson() is the one
 * place that difference gets flattened out.
 *
 * Same mutate-in-place convention as every other service in this
 * app's editing screens: functions here mutate the draft object
 * directly; ui/views/CurriculumManagementView.js re-renders after
 * calling them.
 *
 * This file has no idea a PDF or a heuristic parser exists —
 * loadExtractedUnitsIntoDraft() takes the exact same
 * `{ title, concepts: string[] }[]` shape
 * services/curriculumPdfParsingService.js's parseTextIntoUnits()
 * returns, but nothing stops a future "Paste Text" or manually-typed
 * source from producing that same shape and using this same function.
 */

import { generateId } from '../utils/idGenerator.js';

export function createDraftPack({ curriculumName, gradeName, subjectName }) {
  return {
    curriculumName,
    gradeName,
    subjectName,
    units: [],
  };
}

/** Replaces the draft's units wholesale with the parser's output — used right after a PDF is processed, before any manual editing has happened. */
export function loadExtractedUnitsIntoDraft(draft, extractedUnits) {
  draft.units = extractedUnits.map((unit) => ({
    id: generateId(),
    title: unit.title,
    concepts: unit.concepts.map((title) => ({ id: generateId(), title })),
  }));
}

export function addDraftUnit(draft, title) {
  const unit = { id: generateId(), title, concepts: [] };
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

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Produces the exact JSON shape data/curriculum/*.json pack files
 * already use — services/curriculumLibraryService.js's getPack() and
 * materializeUnitAndConcept() read this shape directly, with no
 * awareness this builder exists.
 */
export function exportPackJson(draft) {
  const id = `${slugify(draft.curriculumName)}-${slugify(draft.gradeName)}-${slugify(draft.subjectName)}`;
  return {
    id,
    curriculum: draft.curriculumName,
    grade: draft.gradeName,
    subject: draft.subjectName,
    units: draft.units.map((unit) => ({
      id: slugify(unit.title),
      title: unit.title,
      concepts: unit.concepts.map((concept) => concept.title),
    })),
  };
}

/**
 * The manifest.json entry an admin needs to add by hand — see
 * ui/views/CurriculumManagementView.js's Save step for why this is a
 * copyable snippet rather than a live write: a static site has no
 * server to write a new file to at runtime. If the curriculum/grade
 * already exists in the live manifest, only the `subjects` array
 * entry needs merging in, not this whole structure — the Save screen
 * says so explicitly.
 */
export function exportManifestSnippet(draft, packFileName) {
  return {
    id: slugify(draft.curriculumName),
    name: draft.curriculumName,
    grades: [
      {
        id: slugify(draft.gradeName),
        name: draft.gradeName,
        subjects: [
          {
            id: slugify(draft.subjectName),
            name: draft.subjectName,
            packFile: packFileName,
          },
        ],
      },
    ],
  };
}
