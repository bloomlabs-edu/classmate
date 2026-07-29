/**
 * services/curriculumIndexSession.js
 *
 * Two-Phase Curriculum Import redesign — Phase 1's orchestrator.
 * Owns exactly the Phase 1 workflow: accept text that may contain a
 * list of units (from any uploaded file, or pasted directly) ->
 * extract Units -> let a teacher review and edit them -> save. The
 * upload path isn't restricted to PDFs — see extractUnitsFromFile()
 * below for how a non-PDF file gets read as plain text instead, same
 * destination either way. Nothing here ever touches a full textbook
 * PDF beyond its first few pages, never runs Anchor Detection, and
 * never extracts a single Concept — those are exclusively Phase 2/3
 * concerns (see services/textbookImportService.js once that exists),
 * deliberately out of reach from this file so Phase 1 stays small,
 * deterministic, and easy for a teacher to finish and trust on its
 * own.
 *
 * ui/views/CurriculumManagementView.js calls only this orchestrator's
 * methods — never services/unitExtractionService.js,
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
    return runUnitExtraction(fullText);
  }

  /** Input path 2: pasted text — skips PDF handling entirely, straight into the same extractor. */
  async function extractUnitsFromPastedText(text) {
    return runUnitExtraction(text);
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
    return runUnitExtraction(text);
  }

  function isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  function runUnitExtraction(rawText) {
    const extractedUnits = unitExtractionService.extractUnits(rawText);
    if (extractedUnits.length > 0) {
      index.units = extractedUnits.map((unit) => ({
        id: generateId(),
        number: unit.number,
        title: unit.title,
        printedPage: unit.printedPage,
      }));
    }
    return { units: extractedUnits };
  }

  // Reused as-is from curriculumReviewService.js — its unit mutation
  // functions only ever touch `id`/`title`/array position, so they
  // work identically for a Curriculum Index's units even though the
  // extra fields differ from a Textbook's.
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

  /** A manually-added unit has no printed page at all — there's no source row it came from. */
  function addUnit(title) {
    const unit = { id: generateId(), number: null, title, printedPage: null };
    index.units.push(unit);
    return unit;
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
    extractUnitsFromFile,
    renameUnit,
    deleteUnit,
    moveUnitUp,
    moveUnitDown,
    addUnit,
    saveIndex,
  };
}
