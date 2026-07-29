/**
 * services/unitSegmentationService.js
 *
 * Curriculum Import Pipeline redesign: one responsibility — given an
 * already-open PDF handle (see services/pdfExtractionService.js) and
 * one reviewed Unit's page range, extract exactly that Unit's own
 * text. Nothing here decides *which* pages belong to a Unit (that's
 * services/unitExtractionService.js's job, already done by the time
 * this file runs) and nothing here looks for concepts (that's
 * services/conceptExtractionService.js's, next).
 *
 * Deliberately one Unit at a time, not the whole book's worth of
 * Units up front — see this project's own "on demand, not eager"
 * decision: a teacher who reviews Unit 1 and closes the browser
 * should never have paid the cost of re-extracting the other 22
 * Units' pages for nothing.
 */

import * as pdfExtractionService from './pdfExtractionService.js';

/**
 * Extracts one reviewed Unit's own text from the PDF, using its
 * page range — this is the entire operation. `unit` is expected to
 * be `{ id, title, startPage, endPage }` (see
 * services/curriculumReviewService.js for how a Table of Contents
 * unit becomes this shape once a teacher has reviewed it in Stage 4).
 *
 * Returns `{ unitId, title, startPage, endPage, text }`.
 */
export async function segmentUnit(pdfHandle, unit) {
  const { fullText } = await pdfExtractionService.extractPageRange(pdfHandle, unit.startPage, unit.endPage);
  return {
    unitId: unit.id,
    title: unit.title,
    startPage: unit.startPage,
    endPage: unit.endPage,
    text: fullText,
  };
}
