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
 *   2. Search a small window of candidate pages around that guess,
 *      running Anchor Verification (see below) against each one.
 *   3. Classify: exactly one verified page -> confirmed, real
 *      evidence. Zero matches -> widen the window once, retry; still
 *      zero -> needs_review with no candidates. More than one match
 *      -> needs_review with every matching page offered as a choice
 *      (a title recurring elsewhere, most commonly in a
 *      cross-reference, is the usual cause).
 *
 * Anchor Verification — a deliberately separate step from Table of
 * Contents parsing, not a replacement for it. A predicted page is a
 * *guess*; verification is what turns a guess into evidence. Given a
 * candidate page, it opens that page plus a small window around it
 * (today: the very next page too, in case a heading sits right at a
 * page boundary) and looks for strong, independent textual signals
 * that this genuinely is where the unit starts — not just one strict
 * pattern, several:
 *   - The full multi-line divider shape ("UNIT" / "3" / "LIGHT" as
 *     three separate lines) already verified against a real textbook
 *     — still the strongest signal by itself.
 *   - An inline heading on one line ("Unit 3", "Chapter 3" — number
 *     attached, no title required alongside it) — a different, valid
 *     way a real heading can render that the divider-only check above
 *     would otherwise miss entirely.
 *   - The expected title text itself ("LIGHT") appearing prominently
 *     on the page — weaker alone (a title can legitimately be
 *     mentioned in passing on an unrelated page), but real
 *     corroborating evidence alongside either signal above.
 * These combine into a confidence score, not a bare yes/no — see
 * verifyAnchorPage() below for the exact weights.
 *
 * This step is deliberately structured as one swappable function,
 * verifyAnchorPage(), the same pattern
 * services/conceptExtractionService.js's extractConcepts() already
 * uses: today's implementation is entirely text-based (pattern
 * matching on extracted text, no AI, no model), but nothing else in
 * this file needs to change if a future version instead rendered the
 * candidate page as an image and used a visual check — only this one
 * function's internals would.
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
const VERIFICATION_WINDOW_PAGES = 1; // how many extra pages past the candidate itself get pulled in as context — see verifyAnchorPage()
const VERIFICATION_CONFIDENCE_THRESHOLD = 0.5; // a candidate page needs at least this much combined signal weight to count as verified

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
    const result = await verifyAnchorPage(pdfHandle, page, tocUnit, totalPages);
    if (result.isMatch) matches.push(page);
  }
  return matches;
}

/**
 * The swappable verification strategy — see this file's own header
 * comment. Today: entirely text-based, opening the candidate page
 * plus a small window of extra pages around it (see
 * VERIFICATION_WINDOW_PAGES) and scoring several independent textual
 * signals rather than trusting one strict pattern alone. A future
 * visual verifier would keep this exact same function signature
 * (`(pdfHandle, page, tocUnit, totalPages) -> { isMatch, confidence, signals }`)
 * and nothing calling it would need to change.
 */
async function verifyAnchorPage(pdfHandle, page, tocUnit, totalPages) {
  const windowEnd = Math.min(totalPages, page + VERIFICATION_WINDOW_PAGES);
  const { pageTexts } = await pdfExtractionService.extractPageRange(pdfHandle, page, windowEnd);
  const ownLines = pageTexts[0].split('\n').map((line) => line.trim());
  const extraLines = pageTexts.slice(1).flatMap((text) => text.split('\n').map((line) => line.trim()));
  // The signal's own anchor point (where "UNIT" appears, where "Unit 3"
  // appears, where the bare title appears) must be found within the
  // candidate page's own text — never in the extra window pages.
  // Otherwise checking page P (window P, P+1) and page P+1 (window
  // P+1, P+2) both independently "see" whatever heading actually sits
  // on P+1, and both wrongly report a match for the same real anchor.
  // The extra window pages exist only so title continuation logic can
  // read a little further when a heading happens to sit right at the
  // very end of a page — never as a second, independent place to
  // start looking.
  const lines = [...ownLines, ...extraLines];

  const signals = [];
  let confidence = 0;

  if (hasDividerStyleHeading(lines, tocUnit, ownLines.length)) {
    signals.push('divider_style_heading');
    confidence += 0.7;
  }
  if (hasInlineHeading(ownLines, tocUnit)) {
    signals.push('inline_heading');
    confidence += 0.6;
  }
  if (hasTitleTextPresent(ownLines, tocUnit)) {
    signals.push('title_text_present');
    confidence += 0.3;
  }

  confidence = Math.min(1, confidence);
  return { isMatch: confidence >= VERIFICATION_CONFIDENCE_THRESHOLD, confidence, signals };
}

// Signal 1 (strongest): the multi-line divider shape already verified
// against a real textbook (see services/unitExtractionService.js's
// own header comment for why a heading extracts as three separate
// lines, not one) — "UNIT" / matching number / matching title, each
// its own line. The title match is deliberately tolerant
// (case-insensitive, ignoring surrounding whitespace) rather than
// exact, since a heading's own casing or spacing can differ slightly
// from how the same title appears in the Contents table.
function hasDividerStyleHeading(lines, tocUnit, ownLineCount = lines.length) {
  const expectedTitle = tocUnit.title.trim().toLowerCase();

  for (let i = 0; i < ownLineCount; i++) {
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

// Signal 2: an inline heading — "Unit 3" or "Chapter 3" with the
// number attached on one line, no separate title line required
// alongside it. A real, different way a heading can render that the
// divider-only check above would otherwise never match — a book
// whose in-body chapter openings use this style, even if its Table of
// Contents itself used a completely different layout, is exactly the
// case this signal exists for.
const INLINE_HEADING_PATTERN = /^(unit|chapter)\s+(\d+)\b/i;

function hasInlineHeading(lines, tocUnit) {
  return lines.some((line) => {
    const match = line.match(INLINE_HEADING_PATTERN);
    return match && Number(match[2]) === tocUnit.number;
  });
}

// Signal 3 (corroborating only, never sufficient alone): the expected
// title text appears somewhere on the page, prominently enough to
// plausibly be a heading rather than an incidental mention — a
// standalone line, mostly uppercase or title-cased, reasonably short.
// Deliberately weighted lower than either heading signal above: a
// title can legitimately be mentioned in passing ("as we saw in the
// Light chapter...") on a page that isn't actually where that unit
// starts, so this alone never crosses the verification threshold.
function hasTitleTextPresent(lines, tocUnit) {
  const expectedTitle = tocUnit.title.trim().toLowerCase();
  if (!expectedTitle) return false;

  return lines.some((line) => {
    if (!line || line.length > 60) return false;
    const isShoutyOrTitleCased = line === line.toUpperCase() || /^[A-Z][a-z]/.test(line);
    return isShoutyOrTitleCased && line.trim().toLowerCase() === expectedTitle;
  });
}
