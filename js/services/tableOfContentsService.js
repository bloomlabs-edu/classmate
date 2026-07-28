/**
 * services/tableOfContentsService.js
 *
 * Curriculum Import Pipeline redesign: one responsibility — turn "the
 * first ~10-15 pages of a textbook's extracted text" into Unit
 * Number, Title, and Starting Page. Nothing here reads a PDF (see
 * services/pdfExtractionService.js for that) and nothing here
 * extracts concepts (see services/conceptExtractionService.js) — this
 * file only understands one page: the Contents page.
 *
 * Multi-Strategy Table of Contents milestone: a real Table of
 * Contents isn't laid out one single way across every textbook. This
 * file is a *pipeline* of independent strategies, tried in order from
 * highest to lowest confidence, not one parser with one assumed
 * shape:
 *
 *   1. Structured Unit table — the original, still-exact parser
 *      (Unit column, Title column, Page column, each its own
 *      column-major block — see tryStructuredTableStrategy()'s own
 *      comment for why a PDF table doesn't extract row-by-row).
 *      Verified against a real TN Samacheer Kalvi Grade 8 Science PDF
 *      — this exact strategy, unchanged, is why that book still
 *      works.
 *   2. Numbered TOC — "1. Measurement .......... 1" or "1 Measurement
 *      1", one entry per line, tolerant of dotted leaders or plain
 *      spacing.
 *   3. Chapter-style — the same two shapes as strategies 1 and 2, but
 *      recognizing "Chapter" instead of "Unit"/a bare number.
 *   4. Generic detector — no assumed keyword or column structure at
 *      all; looks for the general shape of a Contents entry (text,
 *      then a page number, several in a row, page numbers mostly
 *      increasing) and reports a genuine confidence score rather than
 *      a pass/fail.
 *
 * Each strategy is a pure function returning
 * `{ strategy, confidence, units }` — same shape regardless of which
 * one ran, so this file's own orchestration (and any future strategy
 * added later) never needs special-case handling per strategy.
 * parseTableOfContents() tries them in order and stops at the first
 * one confident enough to trust outright; if none clears that bar, it
 * still returns whichever strategy found *something*, rather than
 * failing outright — a teacher reviewing a handful of
 * lower-confidence candidate units on the Review Units screen is a
 * far better experience than an error message, and Review Units
 * already lets a teacher rename, delete, or add units freely. An
 * error is only ever returned when every single strategy found
 * nothing at all.
 *
 * No AI, no model, no inference in any strategy — pure pattern
 * matching on line shape throughout, exactly like this app's very
 * first heading-detection attempt, just aimed at the one page that
 * already states the answer directly instead of every page in the
 * book.
 */

const MONTH_NAMES = new Set([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]);

function isBareInteger(line) {
  return /^\d+$/.test(line);
}

function isKnownColumnLabel(line) {
  return /^(unit|title|page\s*no\.?|page|month|chapter)$/i.test(line);
}

function isMonthName(line) {
  return MONTH_NAMES.has(line.toLowerCase());
}

function findContentsHeadingIndex(lines) {
  let index = lines.findIndex((line) => /^table of contents$/i.test(line));
  if (index === -1) index = lines.findIndex((line) => /^contents$/i.test(line));
  return index;
}

// ---- Strategy 1 (and its Strategy 3a reuse) — structured table -----

/**
 * The original parser, unchanged in every detail — verified against a
 * real textbook's actual Table of Contents. Generalized only to take
 * *which* column-header word to look for ("unit" or "chapter"), so
 * Strategy 3 can reuse this exact same logic for a "Chapter | Title |
 * Page" table without duplicating it.
 *
 * The tricky, load-bearing part, verified against that real
 * textbook: a table extracted from a PDF does not come back row by
 * row. It comes back column by column — every unit number, then every
 * column label, then every page number, then (optionally,
 * board-specific) every month of a teaching-pacing column, then every
 * title — because that's the order the fragments happen to sit in the
 * PDF's own content stream, not the order they're visually read in.
 * This reconstructs the row-by-row correspondence a human would see
 * just by looking at the table.
 */
function tryStructuredTableStrategy(lines, headingIndex, labelWord) {
  const strategyName = `structured_${labelWord}_table`;
  let i = headingIndex + 1;
  const skipBlanks = () => {
    while (i < lines.length && !lines[i]) i++;
  };

  skipBlanks();
  if (!new RegExp(`^${labelWord}$`, 'i').test(lines[i] || '')) {
    return { strategy: strategyName, confidence: 0, units: [] };
  }
  i++;
  skipBlanks();

  const entryNumbers = [];
  while (i < lines.length && isBareInteger(lines[i])) {
    entryNumbers.push(Number(lines[i]));
    i++;
  }
  if (entryNumbers.length === 0) {
    return { strategy: strategyName, confidence: 0, units: [] };
  }

  skipBlanks();
  while (i < lines.length && (isKnownColumnLabel(lines[i]) || !lines[i])) i++;

  const pageNumbers = [];
  while (i < lines.length && isBareInteger(lines[i])) {
    pageNumbers.push(Number(lines[i]));
    i++;
  }

  skipBlanks();
  if (i < lines.length && isMonthName(lines[i])) {
    while (i < lines.length && (isMonthName(lines[i]) || !lines[i])) i++;
  }
  skipBlanks();

  const titles = [];
  while (i < lines.length && lines[i] && !isBareInteger(lines[i]) && !isMonthName(lines[i])) {
    titles.push(lines[i]);
    i++;
  }

  if (pageNumbers.length < entryNumbers.length || titles.length < entryNumbers.length) {
    return { strategy: strategyName, confidence: 0, units: [] };
  }

  const units = entryNumbers.map((number, index) => ({
    number,
    title: titles[index],
    tocPage: pageNumbers[index],
  }));

  return { strategy: strategyName, confidence: 0.98, units };
}

// ---- Strategy 2 — numbered TOC, one entry per line ------------------

// Matches "1. Measurement .............. 1" — a run of 2+ dots is an
// unambiguous dotted leader, the most common way a numbered TOC lines
// up its page numbers.
const DOTTED_LEADER_ENTRY_PATTERN = /^(\d+)\.?\s+(.+?)\s*\.{2,}\s*(\d+)$/;
// Matches "1 Measurement 1" or "1. Measurement 18" — no dots, just
// whitespace separating title from page number. More permissive, so
// it's only trusted once several consecutive, sequentially-numbered
// entries agree with each other (see tryNumberedTocStrategy() below).
const PLAIN_SPACED_ENTRY_PATTERN = /^(\d+)\.?\s+([A-Za-z][A-Za-z0-9 ,'&\-]{2,60}?)\s+(\d+)$/;

function matchNumberedEntry(line) {
  const dotted = line.match(DOTTED_LEADER_ENTRY_PATTERN);
  if (dotted) return { number: Number(dotted[1]), title: dotted[2].trim(), tocPage: Number(dotted[3]) };
  const plain = line.match(PLAIN_SPACED_ENTRY_PATTERN);
  if (plain) return { number: Number(plain[1]), title: plain[2].trim(), tocPage: Number(plain[3]) };
  return null;
}

/**
 * Looks for a numbered list — "1. Measurement .... 1", "2. Force and
 * Pressure .... 18", one full entry per extracted line, rather than
 * the column-major table Strategy 1 expects. Requires the entry
 * numbers found to be sequential starting from 1 — a real numbered
 * ToC always starts at its first real entry, and requiring the
 * sequence to actually be a sequence (not just "some lines that
 * happen to start with a digit") is what keeps this strategy from
 * matching unrelated numbered content elsewhere on the page.
 */
function tryNumberedTocStrategy(lines, headingIndex) {
  const units = [];
  let expectedNumber = 1;
  let lastPage = 0;

  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = matchNumberedEntry(line);
    if (match && match.number === expectedNumber && match.tocPage >= lastPage) {
      units.push(match);
      expectedNumber++;
      lastPage = match.tocPage;
    } else if (units.length > 0) {
      break; // the sequence stopped — whatever comes after isn't more of this same list
    }
  }

  if (units.length < 2) {
    return { strategy: 'numbered_toc', confidence: 0, units: [] };
  }

  // More entries found is stronger evidence this really is the ToC,
  // not a coincidental short run — caps well below Strategy 1's
  // near-certain 0.98, since a handful of number-led lines is
  // genuinely less specific evidence than a fully structured table.
  const confidence = Math.min(0.9, 0.55 + units.length * 0.03);
  return { strategy: 'numbered_toc', confidence, units };
}

// ---- Strategy 3 — Chapter-style -------------------------------------

const CHAPTER_HEADING_PATTERN = /^chapter\s+(\d+)$/i;

/**
 * Two Chapter-flavored shapes, tried in order: the same structured
 * table Strategy 1 recognizes, just with "Chapter" as the column
 * label instead of "Unit" (reusing that exact logic, not a
 * reimplementation of it); and a "Chapter N" divider line followed by
 * its title (with the page number either on that same title line via
 * a dotted leader/plain spacing, or on the very next line by itself).
 */
function tryChapterStyleStrategy(lines, headingIndex) {
  const structuredResult = tryStructuredTableStrategy(lines, headingIndex, 'chapter');
  if (structuredResult.units.length > 0) return structuredResult;

  const units = [];
  let expectedNumber = 1;
  let lastPage = 0;

  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const chapterMatch = line.match(CHAPTER_HEADING_PATTERN);
    if (!chapterMatch || Number(chapterMatch[1]) !== expectedNumber) {
      if (units.length > 0 && !chapterMatch) continue; // skip blank/unrelated lines between entries, but don't break the run over them
      if (units.length > 0) break;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    if (j >= lines.length) break;

    const titleLine = lines[j];
    const inlineMatch = matchNumberedEntry(`${expectedNumber}. ${titleLine}`); // reuse the same title/page separator tolerance as Strategy 2, prefixed with the expected number so the shared matcher can be reused as-is
    if (inlineMatch && inlineMatch.tocPage >= lastPage) {
      units.push({ number: expectedNumber, title: inlineMatch.title, tocPage: inlineMatch.tocPage });
      lastPage = inlineMatch.tocPage;
      expectedNumber++;
      i = j;
      continue;
    }

    // The title itself carried no page number — check the line right after it for a bare one.
    let k = j + 1;
    while (k < lines.length && !lines[k]) k++;
    if (k < lines.length && isBareInteger(lines[k]) && Number(lines[k]) >= lastPage) {
      const page = Number(lines[k]);
      units.push({ number: expectedNumber, title: titleLine.trim(), tocPage: page });
      lastPage = page;
      expectedNumber++;
      i = k;
    } else if (units.length > 0) {
      break;
    }
  }

  if (units.length < 2) {
    return { strategy: 'chapter_style', confidence: 0, units: [] };
  }

  const confidence = Math.min(0.88, 0.5 + units.length * 0.03);
  return { strategy: 'chapter_style', confidence, units };
}

// ---- Strategy 4 — generic detector -----------------------------------

// No assumed leading number or keyword at all — just "meaningful text,
// then a page number," the shape shared by essentially every Contents
// entry regardless of a book's specific formatting conventions.
const GENERIC_ENTRY_PATTERN = /^([A-Za-z][A-Za-z0-9 ,'&\-]{2,70}?)[\s.]{2,}(\d+)$/;

/**
 * The fallback of last resort — no keyword, no required numbering, no
 * assumed column structure. Scans every remaining line for something
 * shaped like a Contents entry (real text, then a page number,
 * clearly separated) and keeps a consecutive run of them whose page
 * numbers are, allowing a little real-world noise, generally
 * increasing. Reports a genuine confidence score rather than a
 * pass/fail — this is deliberately the least specific evidence any
 * strategy here relies on, so it should never be mistaken for a
 * confident match the way Strategy 1's structured table is.
 */
function tryGenericDetectorStrategy(lines, headingIndex) {
  const candidates = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(GENERIC_ENTRY_PATTERN);
    if (match) candidates.push({ title: match[1].trim(), tocPage: Number(match[2]) });
  }

  if (candidates.length < 3) {
    return { strategy: 'generic_detector', confidence: 0, units: [] };
  }

  let increasingPairs = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].tocPage >= candidates[i - 1].tocPage) increasingPairs++;
  }
  const increasingRatio = increasingPairs / (candidates.length - 1);
  if (increasingRatio < 0.7) {
    return { strategy: 'generic_detector', confidence: 0, units: [] };
  }

  const units = candidates.map((candidate, index) => ({ number: index + 1, title: candidate.title, tocPage: candidate.tocPage }));
  const confidence = Math.min(0.7, 0.35 + candidates.length * 0.02) * increasingRatio;
  return { strategy: 'generic_detector', confidence, units };
}

// ---- Orchestration ----------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.75;

const STRATEGIES = [
  (lines, headingIndex) => tryStructuredTableStrategy(lines, headingIndex, 'unit'),
  tryNumberedTocStrategy,
  tryChapterStyleStrategy,
  tryGenericDetectorStrategy,
];

/**
 * Tries every strategy above, in order from highest to lowest
 * confidence, stopping at the first one confident enough to trust
 * outright. If none clears that bar, still returns whichever strategy
 * found the most units — a teacher confirming or editing a handful of
 * lower-confidence candidates on the Review Units screen is a far
 * better experience than an error message, and Review Units already
 * supports renaming, deleting, and adding units freely. Only returns
 * an empty result (an actual failure) when every single strategy
 * found nothing at all.
 *
 * Returns `{ found, units, strategy?, confidence?, reason? }` — the
 * same shape every prior version of this function returned, plus
 * `strategy`/`confidence` for whichever one actually produced the
 * result (useful behind the debug flag — see
 * services/debugModeService.js — never shown to a normal teacher).
 */
export function parseTableOfContents(rawText) {
  const lines = (rawText || '').split('\n').map((line) => line.trim());

  const headingIndex = findContentsHeadingIndex(lines);
  if (headingIndex === -1) {
    return { found: false, units: [] };
  }

  let bestResult = null;
  for (const strategy of STRATEGIES) {
    const result = strategy(lines, headingIndex);
    if (result.units.length > 0 && (!bestResult || result.confidence > bestResult.confidence)) {
      bestResult = result;
    }
    if (result.confidence >= CONFIDENCE_THRESHOLD) {
      return { found: true, units: result.units, strategy: result.strategy, confidence: result.confidence };
    }
  }

  if (bestResult) {
    return { found: true, units: bestResult.units, strategy: bestResult.strategy, confidence: bestResult.confidence };
  }

  return {
    found: true,
    units: [],
    reason: 'Found a Contents heading, but none of the recognized Table of Contents formats matched what follows it.',
  };
}
