/**
 * services/anchorDetectionService.js
 *
 * Curriculum Import Pipeline redesign, Stage 3.5 — between Table of
 * Contents detection and Review Units. A Table of Contents states
 * printed page numbers ("Light starts on page 22"), but a printed
 * page number is not the same thing as a PDF's own physical page
 * index — front matter (roman-numeral preface pages, unnumbered
 * plates) shifts them apart, and not always by the same amount for
 * every unit. This file's one job: for each unit the Table of
 * Contents named, find where its real heading actually sits in the
 * PDF, and record that as an anchor — evidence, not an assumption.
 *
 * Deliberately does not compute or rely on one global offset for the
 * whole book. Each unit is verified on its own: even if 22 of 23
 * units share a clean, consistent offset, the 23rd is still confirmed
 * by actually finding its heading, not inferred from its neighbors.
 * This is what lets a teacher never think about "PDF pages vs.
 * printed pages" at all — the handful of units (often zero) that
 * couldn't be confirmed automatically are the only ones that ever
 * need a look, and even then only for that one unit, never a global
 * "what's the offset for the whole book" prompt.
 *
 * Search strategy, per unit, in Table of Contents order:
 *   1. Guess a starting point. The very first unit searches forward
 *      from its own `tocPage` (never backward — front matter only
 *      ever adds pages, it doesn't remove them). Every later unit
 *      uses the previous *confirmed* unit's own discovered offset as
 *      its first guess, which converges fast once even one unit is
 *      confirmed, without ever assuming that offset must hold for
 *      units it hasn't checked yet.
 *   2. Search a small window of candidate pages around that guess for
 *      the actual multi-line "UNIT / number / TITLE" heading shape
 *      already verified against this app's real test PDF (see
 *      isHeadingForUnit() below) — not a lighter check, the same
 *      pattern matching used everywhere else in this app.
 *   3. Classify: exactly one matching page -> confirmed, real
 *      evidence. Zero matches -> widen the window once, retry; still
 *      zero -> needs_review with no candidates. More than one match
 *      -> needs_review with every matching page offered as a choice
 *      (a title recurring elsewhere, most commonly in a
 *      cross-reference, is the usual cause).
 *
 * Returns
 *   {
 *     anchors: [{ number, title, tocPage, pdfPage, status: 'confirmed' }
 *             | { number, title, tocPage, pdfPage: null, status: 'needs_review', candidates: number[] }],
 *     needsReview: number[],   // just the unit numbers still needing a teacher's input
 *   }
 * — never throws for an individual unit's ambiguity; ambiguity is
 * data (`status`, `candidates`), not a failure of the whole batch, so
 * one unresolved unit never blocks every other confirmed one.
 */

import * as pdfExtractionService from './pdfExtractionService.js';

const INITIAL_WINDOW_SIZE = 5; // pages searched on either side of the first guess
const WIDENED_WINDOW_SIZE = 12; // one retry, wider, before giving up and asking the teacher
const MAX_FORWARD_SEARCH_FOR_FIRST_UNIT = 15; // how far past its own tocPage the very first unit will search

export async function detectAnchors(pdfHandle, tocUnits) {
  const anchors = [];
  let lastConfirmedOffset = null; // pdfPage - tocPage, from the most recent unit actually confirmed

  for (const tocUnit of tocUnits) {
    const anchor = await detectOneAnchor(pdfHandle, tocUnit, lastConfirmedOffset);
    anchors.push(anchor);
    if (anchor.status === 'confirmed') {
      lastConfirmedOffset = anchor.pdfPage - anchor.tocPage;
    }
  }

  return {
    anchors,
    needsReview: anchors.filter((a) => a.status === 'needs_review').map((a) => a.number),
  };
}

async function detectOneAnchor(pdfHandle, tocUnit, lastConfirmedOffset) {
  const totalPages = pdfExtractionService.getTotalPageCount(pdfHandle);
  const guess = lastConfirmedOffset === null ? tocUnit.tocPage : tocUnit.tocPage + lastConfirmedOffset;

  let matches = await searchWindow(pdfHandle, tocUnit, guess, INITIAL_WINDOW_SIZE, lastConfirmedOffset === null, totalPages);
  if (matches.length === 0) {
    matches = await searchWindow(pdfHandle, tocUnit, guess, WIDENED_WINDOW_SIZE, lastConfirmedOffset === null, totalPages);
  }

  if (matches.length === 1) {
    return { number: tocUnit.number, title: tocUnit.title, tocPage: tocUnit.tocPage, pdfPage: matches[0], status: 'confirmed' };
  }

  return {
    number: tocUnit.number,
    title: tocUnit.title,
    tocPage: tocUnit.tocPage,
    pdfPage: null,
    status: 'needs_review',
    candidates: matches,
  };
}

async function searchWindow(pdfHandle, tocUnit, guess, windowSize, isFirstUnit, totalPages) {
  const lowerBound = isFirstUnit ? Math.max(1, tocUnit.tocPage) : Math.max(1, guess - windowSize);
  const upperBound = isFirstUnit ? Math.min(totalPages, tocUnit.tocPage + MAX_FORWARD_SEARCH_FOR_FIRST_UNIT) : Math.min(totalPages, guess + windowSize);

  const matches = [];
  for (let page = lowerBound; page <= upperBound; page++) {
    const { fullText } = await pdfExtractionService.extractPageRange(pdfHandle, page, page);
    if (isHeadingForUnit(fullText, tocUnit)) {
      matches.push(page);
    }
  }
  return matches;
}

// The same multi-line "UNIT" / number / TITLE shape already verified
// against a real textbook (see services/tableOfContentsService.js's
// own header comment for why a heading extracts as three separate
// lines, not one) — except now checking for a *specific*, already-known
// unit rather than discovering an unknown one. The title match is
// deliberately tolerant (case-insensitive, ignoring surrounding
// whitespace) rather than exact, since a heading's own casing or
// spacing can differ slightly from how the same title appears in the
// Contents table.
function isHeadingForUnit(pageText, tocUnit) {
  const lines = pageText.split('\n').map((line) => line.trim());
  const expectedTitle = tocUnit.title.trim().toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    if (!/^(unit|chapter)$/i.test(lines[i])) continue;

    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    if (!(j < lines.length && Number(lines[j]) === tocUnit.number)) continue;

    j++;
    while (j < lines.length && !lines[j]) j++;
    const titleLines = [];
    while (j < lines.length && lines[j] && titleLines.length < 2 && !/^\d+$/.test(lines[j])) {
      titleLines.push(lines[j]);
      j++;
    }
    const candidateTitle = titleLines.join(' ').trim().toLowerCase();
    if (!candidateTitle) continue; // no real title was collected here — e.g. the Contents table's own "Unit" column header followed immediately by its list of unit numbers, which otherwise resembles the start of a real heading
    if (candidateTitle === expectedTitle || candidateTitle.startsWith(expectedTitle) || expectedTitle.startsWith(candidateTitle)) {
      return true;
    }
  }

  return false;
}
