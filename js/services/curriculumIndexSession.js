/**
 * services/curriculumIndexSession.js
 *
 * Two-Phase Curriculum Import redesign — Phase 1's orchestrator.
 * Owns exactly the Phase 1 workflow: accept text that may contain a
 * list of units -> extract Units -> let a teacher review and edit
 * them -> save. Two separate, user-facing import modes feed into this
 * one shared pipeline: "AI-Ready Import" (recommended — strict,
 * deterministic, for ClassMate's own canonical format; see
 * extractUnitsFromCanonicalText() and
 * services/canonicalUnitExtractionService.js) and "Import from
 * Textbook" (experimental — tolerant, best-effort, for a raw copied
 * Table of Contents; see runSmartExtraction() and
 * services/unitExtractionService.js). Neither replaces the other —
 * they're two different answers to "where is a teacher's content
 * coming from," not two implementations competing to win. Nothing
 * here ever touches a full textbook PDF beyond its first few pages,
 * never runs Anchor Detection, and never extracts a single Concept —
 * those are exclusively Phase 2/3 concerns (see
 * services/textbookImportService.js once that exists), deliberately
 * out of reach from this file so Phase 1 stays small, deterministic,
 * and easy for a teacher to finish and trust on its own.
 *
 * ui/views/CurriculumManagementView.js calls only this orchestrator's
 * methods — never services/unitExtractionService.js,
 * services/canonicalUnitExtractionService.js,
 * services/pdfExtractionService.js, services/curriculumReviewService.js,
 * or services/curriculumIndexRepository.js directly. Every one of
 * those stays pure/storage-only and unaware of the others; this file
 * is the only thing that knows the whole Phase 1 sequence.
 *
 * services/unitExtractionService.js's extractUnits() already returns
 * units with a `printedPage` field directly — no field renaming
 * happens at this boundary anymore (the earlier
 * tableOfContentsService.js this replaced returned `tocPage`
 * internally and relied on this file to rename it; the new engine's
 * whole premise is "just extract what a teacher would actually call
 * it," so there's nothing left to translate).
 */

import * as curriculumIndexRepository from './curriculumIndexRepository.js';
import * as pdfExtractionService from './pdfExtractionService.js';
import * as unitExtractionService from './unitExtractionService.js';
import * as canonicalUnitExtractionService from './canonicalUnitExtractionService.js';
import * as curriculumReviewService from './curriculumReviewService.js';
import { generateId } from '../utils/idGenerator.js';

const TOC_SCAN_PAGE_COUNT = 15;

export function createCurriculumIndexSession() {
  let index = null;

  function getIndex() {
    return index;
  }

  /** Stage: a new Curriculum Index begins. Persisted immediately, so it exists to resume even if nothing else is done yet. */
  async function startIndex({ curriculum }) {
    index = await curriculumIndexRepository.createIndex({ curriculum });
    return index;
  }

  async function openExistingIndex(indexId) {
    index = await curriculumIndexRepository.getIndex(indexId);
    if (!index) throw new Error(`No Curriculum Index found for id "${indexId}"`);
    return index;
  }

  /**
   * Input path 1: a PDF containing a Table of Contents. Reads only
   * the first pages — a real Table of Contents lives well within
   * them — never the rest of the file. A teacher uploading a TOC PDF
   * is uploading a page or two, not a whole textbook.
   */
  async function extractUnitsFromPdf(file) {
    const pdfHandle = await pdfExtractionService.loadPdfDocument(file);
    const pagesToRead = Math.min(TOC_SCAN_PAGE_COUNT, pdfExtractionService.getTotalPageCount(pdfHandle));
    const { fullText } = await pdfExtractionService.extractPageRange(pdfHandle, 1, pagesToRead);
    return runSmartExtraction(fullText);
  }

  /** Input path 2: pasted text — skips PDF handling entirely, straight into the same extractor. */
  async function extractUnitsFromPastedText(text) {
    return runSmartExtraction(text);
  }

  /**
   * The upload input accepts any file, not just PDFs — a teacher's
   * list of units might just as easily exist as a plain text file, or
   * a document exported to text, as it does a PDF. This is the one
   * entry point the "Upload" button actually calls: it looks at the
   * file itself (extension and/or MIME type — a file's `.type` isn't
   * always set reliably, so both are checked) to decide whether to
   * route through pdf.js or read it as plain text directly, and
   * either way ends up feeding the exact same
   * services/unitExtractionService.js engine. A binary format this
   * can't meaningfully read as text (a Word .doc, an image) will
   * still be attempted as plain text rather than rejected outright —
   * worst case nothing is extracted and the teacher sees the same
   * "couldn't extract automatically, continue to manual entry" screen
   * every other unrecognized input already falls back to, not a
   * crash.
   */
  async function extractUnitsFromFile(file) {
    if (isPdfFile(file)) {
      return extractUnitsFromPdf(file);
    }
    const text = await file.text();
    return runSmartExtraction(text);
  }

  function isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  /**
   * Shared by both import modes — AI-Ready Import (canonical, exact)
   * and Import from Textbook (tolerant, best-effort) — since both
   * ultimately produce the exact same shape: a flat list of
   * `{ number, title, printedPage, partName }`. Everything from here
   * on (grouping into real Part entities, building the persisted
   * unit shape) is a single shared path, so the two modes can never
   * drift into behaving differently once extraction itself is done.
   */
  function applyExtractedUnits(extractedUnits) {
    if (extractedUnits.length === 0) return;
    // Group by `partName` (defaults to "General") into real Part
    // entities, each created once — the hybrid model's whole point:
    // a Part's identity lives here, exactly once, not repeated on
    // every one of its units.
    const partIdByName = new Map();
    const parts = [];
    function partIdFor(partName) {
      const key = partName || 'General';
      if (!partIdByName.has(key)) {
        const part = { id: generateId(), name: key };
        parts.push(part);
        partIdByName.set(key, part.id);
      }
      return partIdByName.get(key);
    }

    index.parts = parts;
    index.units = extractedUnits.map((unit) => ({
      id: generateId(),
      number: unit.number,
      title: unit.title,
      printedPage: unit.printedPage,
      partId: partIdFor(unit.partName),
      concepts: [],
    }));
  }

  /** Import from Textbook (experimental, best-effort) — services/unitExtractionService.js's tolerant engine. */
  function runSmartExtraction(rawText) {
    const extractedUnits = unitExtractionService.extractUnits(rawText);
    applyExtractedUnits(extractedUnits);
    return { units: extractedUnits };
  }

  /**
   * AI-Ready Import (recommended) — services/canonicalUnitExtractionService.js's
   * strict, deterministic parser for ClassMate's own canonical
   * format. Unlike the tolerant path, this can also report malformed
   * lines: every successfully parsed unit is still applied, and every
   * line that didn't parse is returned alongside it with its own line
   * number and original text — the import never silently drops a line
   * and never fails outright just because one line didn't parse.
   */
  function extractUnitsFromCanonicalText(rawText) {
    const { units: extractedUnits, errors } = canonicalUnitExtractionService.parseCanonicalFormat(rawText);
    applyExtractedUnits(extractedUnits);
    return { units: extractedUnits, errors };
  }


  // Reused as-is from curriculumReviewService.js — its unit mutation
  // functions only ever touch `id`/`title`/array position (plus, now,
  // a same-`partId` check for reordering specifically), so they work
  // identically for a Curriculum Index's units even though the extra
  // fields differ from a Textbook's.
  function renameUnit(unitId, newTitle) {
    curriculumReviewService.renameDraftUnit(index, unitId, newTitle);
  }

  function deleteUnit(unitId) {
    curriculumReviewService.deleteDraftUnit(index, unitId);
  }

  function moveUnitUp(unitId) {
    curriculumReviewService.moveDraftUnitUp(index, unitId);
  }

  function moveUnitDown(unitId) {
    curriculumReviewService.moveDraftUnitDown(index, unitId);
  }

  /** The single source of truth for reassigning a unit to a different Part — used by both the Part dropdown and drag-and-drop, never anything else. */
  function moveUnitToPart(unitId, targetPartId, targetIndex) {
    curriculumReviewService.moveDraftUnitToPart(index, unitId, targetPartId, targetIndex);
  }

  // Concepts — reused as-is from curriculumReviewService.js, the same
  // way renameUnit/deleteUnit/moveUnitUp/moveUnitDown above already
  // reuse its Unit-level equivalents. These functions already used
  // `{ id, title }` objects (not plain strings) before this Curriculum
  // Index ever adopted Concepts, so the shape matches exactly.
  function addConcept(unitId, title) {
    return curriculumReviewService.addDraftConcept(index, unitId, title);
  }

  function renameConcept(unitId, conceptId, newTitle) {
    return curriculumReviewService.renameDraftConcept(index, unitId, conceptId, newTitle);
  }

  function deleteConcept(unitId, conceptId) {
    curriculumReviewService.deleteDraftConcept(index, unitId, conceptId);
  }

  function moveConceptUp(unitId, conceptId) {
    curriculumReviewService.moveDraftConceptUp(index, unitId, conceptId);
  }

  function moveConceptDown(unitId, conceptId) {
    curriculumReviewService.moveDraftConceptDown(index, unitId, conceptId);
  }

  /**
   * A manually-added unit has no printed page at all — there's no
   * source row it came from. Requires a Part to belong to; if none is
   * given and the Index has no Parts yet at all, a "General" Part is
   * created on the spot — the same default a real extraction would
   * have produced, so a fully manual Curriculum Index (no PDF, no
   * pasted text) never has to think about Parts either, unless it
   * wants to.
   */
  function addUnit(title, partId) {
    let targetPartId = partId;
    if (!targetPartId) {
      targetPartId = index.parts.length > 0 ? index.parts[0].id : addPart('General').id;
    }
    // Next in sequence, not left null — a manually-added unit still
    // needs a real, displayable number (see this project's own
    // Curriculum Builder redesign discussion for why this field is
    // now shown consistently everywhere a unit appears).
    const highestNumber = index.units.reduce((max, u) => (typeof u.number === 'number' && u.number > max ? u.number : max), 0);
    const unit = { id: generateId(), number: highestNumber + 1, title, printedPage: null, partId: targetPartId, concepts: [] };
    index.units.push(unit);
    return unit;
  }

  /** Creating a new Part is a first-class operation — most curricula won't need a second one, but the data model never treats "General" as anything other than an ordinary Part. */
  function addPart(name) {
    const part = { id: generateId(), name };
    index.parts.push(part);
    return part;
  }

  function renamePart(partId, newName) {
    const part = index.parts.find((p) => p.id === partId);
    if (part) part.name = newName;
    return part;
  }

  /** Deleting a Part removes its units with it — there's no meaningful "orphaned unit with no Part" state in this model. */
  function deletePart(partId) {
    index.units = index.units.filter((unit) => unit.partId !== partId);
    index.parts = index.parts.filter((part) => part.id !== partId);
  }

  /** Marks the Curriculum Index as reviewed and confirmed, ready to be attached to a Textbook later. Saving again after Phase 2 has started must never regress the status backward. */
  async function saveIndex() {
    if (index.status === 'draft') {
      index.status = 'units_confirmed';
    }
    await curriculumIndexRepository.saveIndex(index);
    return index;
  }

  return {
    getIndex,
    startIndex,
    openExistingIndex,
    extractUnitsFromPdf,
    extractUnitsFromPastedText,
    extractUnitsFromCanonicalText,
    extractUnitsFromFile,
    renameUnit,
    deleteUnit,
    moveUnitUp,
    moveUnitDown,
    moveUnitToPart,
    addConcept,
    renameConcept,
    deleteConcept,
    moveConceptUp,
    moveConceptDown,
    addUnit,
    addPart,
    renamePart,
    deletePart,
    saveIndex,
  };
}
