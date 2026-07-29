/**
 * services/curriculumIndexSession.js
 *
 * Two-Phase Curriculum Import redesign — Phase 1's orchestrator.
 * Owns exactly the Phase 1 workflow: accept a Table of Contents
 * (PDF or pasted text) -> extract Units -> let a teacher review and
 * edit them -> save. Nothing here ever touches a full textbook PDF
 * beyond its first few pages (to find the Contents page), never runs
 * Anchor Detection, and never extracts a single Concept — those are
 * exclusively Phase 2/3 concerns (see services/textbookImportService.js
 * once that exists), deliberately out of reach from this file so
 * Phase 1 stays small, deterministic, and easy for a teacher to
 * finish and trust on its own.
 *
 * ui/views/CurriculumManagementView.js calls only this orchestrator's
 * methods — never services/tableOfContentsService.js,
 * services/pdfExtractionService.js, services/curriculumReviewService.js,
 * or services/curriculumIndexRepository.js directly. Every one of
 * those stays pure/storage-only and unaware of the others; this file
 * is the only thing that knows the whole Phase 1 sequence.
 *
 * Field naming, per explicit product decision:
 * tableOfContentsService.parseTableOfContents() keeps returning
 * `tocPage` (an internal detail of how that parser talks about
 * itself) — this file converts it to `printedPage` on the way into
 * the persisted Curriculum Index, since that's the name a teacher
 * actually sees.
 */

import * as curriculumIndexRepository from './curriculumIndexRepository.js';
import * as pdfExtractionService from './pdfExtractionService.js';
import * as tableOfContentsService from './tableOfContentsService.js';
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
   * Input path 1: a TOC PDF. Reads only the first pages (the Contents
   * page lives well within them — see
   * services/tableOfContentsService.js's own header comment), never
   * the rest of the file. A teacher uploading a TOC PDF is uploading
   * a page or two, not a whole textbook — this still only ever reads
   * what it needs to.
   */
  async function extractUnitsFromPdf(file) {
    const pdfHandle = await pdfExtractionService.loadPdfDocument(file);
    const pagesToRead = Math.min(TOC_SCAN_PAGE_COUNT, pdfExtractionService.getTotalPageCount(pdfHandle));
    const { fullText } = await pdfExtractionService.extractPageRange(pdfHandle, 1, pagesToRead);
    return runTableOfContentsExtraction(fullText);
  }

  /** Input path 2: pasted TOC text — skips PDF handling entirely, straight into the same parser. */
  async function extractUnitsFromPastedText(text) {
    return runTableOfContentsExtraction(text);
  }

  function runTableOfContentsExtraction(rawText) {
    const result = tableOfContentsService.parseTableOfContents(rawText);
    if (result.units.length > 0) {
      index.units = result.units.map((tocUnit) => ({
        id: generateId(),
        number: tocUnit.number,
        title: tocUnit.title,
        printedPage: tocUnit.tocPage,
      }));
    }
    return result;
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

  /** A manually-added unit has no printed page at all — there's no Contents entry it came from. */
  function addUnit(title) {
    const unit = { id: generateId(), number: null, title, printedPage: null };
    index.units.push(unit);
    return unit;
  }

  /** Marks the Curriculum Index as reviewed and confirmed, ready to be attached to a Textbook later (Milestone 2). */
  async function saveIndex() {
    index.status = 'saved';
    await curriculumIndexRepository.saveIndex(index);
    return index;
  }

  return {
    getIndex,
    startIndex,
    openExistingIndex,
    extractUnitsFromPdf,
    extractUnitsFromPastedText,
    renameUnit,
    deleteUnit,
    moveUnitUp,
    moveUnitDown,
    addUnit,
    saveIndex,
  };
}
