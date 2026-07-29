/**
 * services/curriculumImportSession.js
 *
 * Curriculum Import Pipeline — the orchestrator. Owns the workflow's
 * state machine and calls every domain service in sequence; nothing
 * else does. ui/views/CurriculumManagementView.js creates one of
 * these per import, calls its methods in response to teacher actions,
 * and re-renders from `getDraft()` afterward — it never calls
 * pdfExtractionService, unitExtractionService, anchorDetectionService,
 * curriculumReviewService, or draftCurriculumService directly. Every
 * one of those stays pure and unaware of the others; this file is the
 * only thing that knows the whole sequence.
 *
 * Vertical Slice milestone: this file currently implements exactly
 * Upload -> Extract -> Detect Table of Contents -> Detect Anchors ->
 * Review Units -> Save Draft, per explicit instruction to get one
 * real, usable slice working end-to-end before adding Concept
 * Extraction or Publish. Those stages are not stubbed out here as
 * placeholders — they simply don't exist yet, the same way this file
 * doesn't pretend to support them.
 *
 * Two things live only in this session's own closure, deliberately
 * never persisted:
 *   - `pdfHandle`, the live pdf.js document proxy — re-derived fresh
 *     from the draft's stored PDF `Blob` every time a draft is opened
 *     or resumed (see openExistingDraft() below), not something
 *     draftCurriculumService.js ever stores itself.
 *   - Nothing else — every other piece of state lives on the plain
 *     `draft` object, which is exactly what gets persisted.
 */

import * as draftCurriculumService from './draftCurriculumService.js';
import * as pdfExtractionService from './pdfExtractionService.js';
import * as unitExtractionService from './unitExtractionService.js';
import * as anchorDetectionService from './anchorDetectionService.js';
import * as curriculumReviewService from './curriculumReviewService.js';
import { generateId } from '../utils/idGenerator.js';

const TOC_SCAN_PAGE_COUNT = 15;

export function createCurriculumImportSession() {
  let draft = null;
  let pdfHandle = null;

  function getDraft() {
    return draft;
  }

  /** Stage 1 -> 2: a new import begins. Creates and persists the draft immediately, so it exists to resume even if nothing else ever completes. */
  async function startImport({ metadata, pdfFile, pdfFileName }) {
    draft = await draftCurriculumService.createDraft({ metadata, pdfFile, pdfFileName });
    pdfHandle = await pdfExtractionService.loadPdfDocument(pdfFile);
    draft.totalPageCount = pdfExtractionService.getTotalPageCount(pdfHandle);
    await draftCurriculumService.saveDraft(draft);
    return draft;
  }

  /** Resuming a draft from a "Resume a Draft" list — re-opens the stored PDF Blob to get a live handle again; nothing about this differs from a fresh upload from this point on. */
  async function openExistingDraft(draftId) {
    draft = await draftCurriculumService.getDraft(draftId);
    if (!draft) throw new Error(`No draft found for id "${draftId}"`);
    pdfHandle = await pdfExtractionService.loadPdfDocument(draft.pdfFile);
    return draft;
  }

  /**
   * Stage 3 -> 3.5: reads only the first pages (Table of Contents
   * detection), then searches the rest of the book only for each
   * unit's own anchor — never a whole-book scan. Builds the draft's
   * final unit list, including each confirmed unit's resolved page
   * range; an ambiguous unit's `pdfEndPage` is left `null` until its
   * anchor is resolved (see resolveAnchor() below), since a unit
   * whose own start isn't known yet can't have a meaningful end
   * either.
   */
  async function detectStructure() {
    const { fullText: tocScanText } = await pdfExtractionService.extractPageRange(pdfHandle, 1, TOC_SCAN_PAGE_COUNT);
    const extractedUnits = unitExtractionService.extractUnits(tocScanText);

    if (extractedUnits.length === 0) {
      draft.tocDetectionFailed = true;
      draft.tocDetectionReason = null;
      await draftCurriculumService.saveDraft(draft);
      return draft;
    }

    // anchorDetectionService.js is reused as-is (unchanged) and still
    // expects each unit's printed page under the name `tocPage` — a
    // small local adapter here, not a change to that file, since this
    // whole orchestrator is due to be reworked into
    // textbookImportService.js properly at the start of Milestone 2.
    const unitsForAnchorDetection = extractedUnits.map((unit) => ({
      number: unit.number,
      title: unit.title,
      tocPage: unit.printedPage,
    }));

    const { anchors } = await anchorDetectionService.detectAnchors(pdfHandle, unitsForAnchorDetection);
    draft.units = buildUnitsFromAnchors(anchors, draft.totalPageCount);
    draft.tocDetectionFailed = false;
    await draftCurriculumService.saveDraft(draft);
    return draft;
  }

  /**
   * The teacher's answer for one ambiguous unit — a chosen page,
   * whether from the candidates anchorDetectionService offered or
   * typed in directly. Resolving one unit never depends on any other
   * unit also being resolved; every other unit's status is untouched.
   */
  async function resolveAnchor(unitId, chosenPage) {
    const unit = draft.units.find((u) => u.id === unitId);
    if (!unit) return;
    unit.pdfPage = chosenPage;
    unit.status = 'anchor_confirmed';
    unit.anchorCandidates = null;
    recomputeEndPages(draft.units, draft.totalPageCount);
    await draftCurriculumService.saveDraft(draft);
  }

  function renameUnit(unitId, newTitle) {
    curriculumReviewService.renameDraftUnit(draft, unitId, newTitle);
  }

  function deleteUnit(unitId) {
    curriculumReviewService.deleteDraftUnit(draft, unitId);
    recomputeEndPages(draft.units, draft.totalPageCount);
  }

  function moveUnitUp(unitId) {
    curriculumReviewService.moveDraftUnitUp(draft, unitId);
    recomputeEndPages(draft.units, draft.totalPageCount);
  }

  function moveUnitDown(unitId) {
    curriculumReviewService.moveDraftUnitDown(draft, unitId);
    recomputeEndPages(draft.units, draft.totalPageCount);
  }

  function addUnit(title) {
    const unit = curriculumReviewService.addDraftUnit(draft, title);
    unit.number = null;
    unit.tocPage = null;
    unit.pdfPage = null;
    unit.pdfEndPage = null;
    unit.anchorCandidates = null;
    unit.status = 'anchor_confirmed'; // a manually-added unit has nothing to confirm — it's already exactly what the teacher typed
    return unit;
  }

  /** Stage 5's "Save the draft" — persists whatever the teacher has done in Review Units so far, resumable later from exactly this point. */
  async function saveDraft() {
    await draftCurriculumService.saveDraft(draft);
    return draft;
  }

  return {
    getDraft,
    startImport,
    openExistingDraft,
    detectStructure,
    resolveAnchor,
    renameUnit,
    deleteUnit,
    moveUnitUp,
    moveUnitDown,
    addUnit,
    saveDraft,
  };
}

function buildUnitsFromAnchors(anchors, totalPageCount) {
  const units = anchors.map((anchor) => ({
    id: generateId(),
    number: anchor.number,
    title: anchor.title,
    concepts: [],
    tocPage: anchor.tocPage,
    pdfPage: anchor.pdfPage,
    pdfEndPage: null, // resolved below, once every confirmed unit's own pdfPage is known
    anchorCandidates: anchor.status === 'needs_review' ? anchor.candidates : null,
    status: anchor.status === 'confirmed' ? 'anchor_confirmed' : 'anchor_needs_review',
  }));
  recomputeEndPages(units, totalPageCount);
  return units;
}

/**
 * A confirmed unit's `pdfEndPage` is the page immediately before the
 * next *confirmed* unit's own `pdfPage` — an ambiguous unit in between
 * is simply skipped when looking for "the next one," since its own
 * position isn't known yet and its neighbors' ranges shouldn't be
 * distorted by a guess. The last confirmed unit's `pdfEndPage`
 * resolves against the PDF's real total page count. Called after
 * every structural change (an anchor resolved, a unit renamed away,
 * reordered, merged, or split) so page ranges never go stale.
 */
function recomputeEndPages(units, totalPageCount) {
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.status !== 'anchor_confirmed' || unit.pdfPage == null) continue;

    const nextConfirmed = units.slice(i + 1).find((u) => u.status === 'anchor_confirmed' && u.pdfPage != null);
    unit.pdfEndPage = nextConfirmed ? nextConfirmed.pdfPage - 1 : totalPageCount;
  }
}
