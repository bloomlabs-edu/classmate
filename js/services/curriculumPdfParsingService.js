/**
 * services/curriculumPdfParsingService.js
 *
 * Table of Contents Extraction milestone: this file no longer scans a
 * textbook's body content at all. Two rounds of regex fixes against
 * the full ~700,000-character extracted text of a real 288-page
 * textbook each tested correctly in isolation but never resolved a
 * real, repeated failure — the actual problem wasn't the regexes, it
 * was the whole approach. A human building a curriculum from a
 * textbook doesn't read all 288 pages first; they read the Table of
 * Contents, which already states every unit's number, title, and
 * starting page. This file is redesigned around that same idea:
 *
 *   extractTextFromPdf(file) — reads only the first 10 pages of an
 *   uploaded PDF (or fewer, if the PDF has fewer), using pdf.js
 *   (loaded from cdnjs, matching this app's existing "import external
 *   libraries straight from a CDN, no bundler" pattern already used
 *   for Firebase). Still reports the PDF's real total page count
 *   (pdf.numPages is available immediately, with no need to read
 *   every page to know it) — a curriculum built from the Table of
 *   Contents alone still correctly reflects how long the whole book
 *   is, even though only its first 10 pages were ever actually read.
 *
 *   parseTableOfContents(rawText) — a plain, rule-based parser (not
 *   AI, no model, no inference) that finds a "Table of Contents" or
 *   "Contents" heading and reconstructs Unit Number / Title / Starting
 *   Page from the column-block shape a real textbook's ToC table
 *   extracts as (see this function's own doc comment for why a
 *   "table" doesn't extract row-by-row). This is genuinely all that's
 *   needed to build a curriculum's structure — Unit N, its title, and
 *   where it starts.
 *
 * Concept extraction (what's actually taught within a unit) is
 * deliberately out of scope here — see this file's own note on
 * `startPage`/`endPage` below. Once a curriculum's Units exist (from
 * the Table of Contents alone), a future capability can extract just
 * one unit's own page range on demand, rather than the whole book
 * up front. Nothing in this file does that yet; the page ranges
 * computed here exist so that future step has what it needs when it's
 * built.
 */

const PDFJS_VERSION = '6.1.200'; // verified against cdnjs.com/libraries/pdf.js at the time this was written — re-check before assuming it's still current
const PDFJS_BASE_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;

let pdfjsLibPromise = null;

function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(/* webpackIgnore: true */ `${PDFJS_BASE_URL}pdf.min.mjs`).then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE_URL}pdf.worker.min.mjs`;
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}

// The Table of Contents lives well within the first few pages of
// every real textbook this has been checked against — 10 pages is a
// deliberately generous margin, not a tight fit. Reading only this
// many pages, out of a real 288-page book, is the entire point of
// this milestone: a curriculum's structure comes from its Table of
// Contents, not from scanning the whole document.
const MAX_PAGES_TO_READ = 10;

/**
 * Reads only the first `MAX_PAGES_TO_READ` pages of an uploaded PDF
 * File (or all of it, if it has fewer) and returns per-page text plus
 * the joined text of just those pages — see this file's own header
 * comment for why reading the whole document was never actually
 * necessary. `totalPageCount` still reflects the PDF's real length
 * (`pdf.numPages`, available immediately once the document loads, at
 * no extra cost) even though only its first pages were read; a unit's
 * own `endPage` (see parseTableOfContents() below) is resolved against
 * this real total for whichever unit happens to be last in the book.
 *
 * pdf.js's getTextContent() returns a flat list of text fragments per
 * page with no line breaks of its own — line structure has to be
 * reconstructed from each fragment's vertical position
 * (`item.transform[5]`, its Y-coordinate on the page): a real Table of
 * Contents page's "Unit" column, "Title" column, and "Page No." column
 * are each their own visually-stacked block of fragments, and
 * parseTableOfContents() depends on that line structure to tell one
 * column's data from another. Verified against a real TN Samacheer
 * Kalvi Grade 8 Science PDF's actual Table of Contents shape (see
 * parseTableOfContents() below and its accompanying real-PDF test
 * fixture) — genuinely unverified beyond that, though, since this
 * sandbox has no browser or pdf.js to run the *upload* half of this
 * file against. Test this specific function against a real PDF in an
 * actual browser before assuming it's fully correct.
 *
 * Returns `{ pageTexts, fullText, totalPageCount, pagesRead }`.
 */
export async function extractTextFromPdf(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pagesToRead = Math.min(MAX_PAGES_TO_READ, pdf.numPages);
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(reconstructLinesFromTextItems(content.items));
  }

  return {
    pageTexts,
    fullText: pageTexts.join('\n\n'),
    totalPageCount: pdf.numPages,
    pagesRead: pageTexts.length,
  };
}

// A new line, in a PDF's own coordinate space, is a fragment whose Y
// position differs meaningfully from the fragment before it — not
// zero difference, since ordinary kerning/rendering can produce tiny
// sub-pixel variance even within one visual line. 2pt is a
// deliberately small, conservative threshold: real line spacing in a
// printed textbook is many times that, while numerals and general
// body text won't drift on their own that much within one line.
const NEW_LINE_Y_THRESHOLD = 2;

function reconstructLinesFromTextItems(items) {
  let text = '';
  let lastY = null;

  for (const item of items) {
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    const isNewLine = lastY !== null && y !== null && Math.abs(y - lastY) > NEW_LINE_Y_THRESHOLD;

    if (isNewLine) {
      text += '\n';
    } else if (text && !text.endsWith('\n')) {
      text += ' ';
    }

    text += item.str;
    if (y !== null) lastY = y;
  }

  return text;
}

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

/**
 * Finds a "Table of Contents" (or bare "Contents") heading in the
 * given text and reconstructs Unit Number / Title / Starting Page
 * from it — the one thing this file actually does now. No AI, no
 * inference: pure pattern matching on line shape, exactly like the
 * body-scanning approach this replaces, just aimed at the one page
 * that already states the answer directly instead of every page in
 * the book.
 *
 * The tricky, load-bearing part, verified against a real textbook's
 * actual Table of Contents: a table extracted from a PDF does not
 * come back row by row ("Unit 1, Measurement, page 1; Unit 2, Force
 * and Pressure, page 12; ..."). It comes back column by column — every
 * unit number, then every column label, then every page number, then
 * (optionally, board-specific) every month of a teaching-pacing
 * column, then every title — because that's the order the fragments
 * happen to sit in the PDF's own content stream, not the order they're
 * visually read in. This function reconstructs the row-by-row
 * correspondence a human would see just by looking at the table:
 *   1. Find the heading, then a "Unit" column label right after it.
 *   2. Collect the consecutive integers that follow — this is exactly
 *      how many real units the book has.
 *   3. Skip past any further column-header labels (Title, Page No,
 *      Month, etc.) — these don't carry data themselves.
 *   4. Collect the next block of consecutive integers — page numbers,
 *      the only numeric column left once Unit's own numbers are
 *      already spoken for.
 *   5. If a block of real month names immediately follows, skip it
 *      whole — a teaching-pacing column some boards include, not
 *      curriculum structure.
 *   6. Collect the next block of non-numeric, non-month lines — unit
 *      titles, in order.
 *   7. Zip the first N of each list together, where N is however many
 *      unit numbers were found in step 2 — a real Table of Contents
 *      commonly lists a few extra rows after the last real unit
 *      (Glossary, an e-book note, an assessment note) that have a
 *      title and a page number but no unit number of their own; these
 *      are correctly left out, not a parsing failure.
 *
 * Each unit's `endPage` is the page immediately before the next unit's
 * `startPage` — except the very last unit, whose `endPage` is left
 * `null` here and resolved by the caller against the PDF's real total
 * page count (see extractTextFromPdf()'s `totalPageCount`), since this
 * function only ever sees the first 10 pages and has no way to know
 * how long the whole book actually is.
 *
 * Returns `{ found: boolean, units: [...], reason?: string }` —
 * `reason` is set whenever `units` comes back empty despite `found`
 * being true, so a failure is diagnosable (see
 * ui/views/CurriculumManagementView.js's Table of Contents diagnostics
 * screen) instead of silent.
 */
export function parseTableOfContents(rawText) {
  const lines = (rawText || '').split('\n').map((line) => line.trim());

  let startIndex = lines.findIndex((line) => /^table of contents$/i.test(line));
  if (startIndex === -1) startIndex = lines.findIndex((line) => /^contents$/i.test(line));
  if (startIndex === -1) {
    return { found: false, units: [] };
  }

  let i = startIndex + 1;
  const skipBlanks = () => {
    while (i < lines.length && !lines[i]) i++;
  };

  skipBlanks();
  if (!/^unit$/i.test(lines[i] || '')) {
    return { found: true, units: [], reason: 'Found a Contents heading, but no "Unit" column label right after it.' };
  }
  i++;
  skipBlanks();

  const unitNumbers = [];
  while (i < lines.length && isBareInteger(lines[i])) {
    unitNumbers.push(Number(lines[i]));
    i++;
  }
  if (unitNumbers.length === 0) {
    return { found: true, units: [], reason: 'Found the "Unit" column label, but no unit numbers followed it.' };
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

  if (pageNumbers.length < unitNumbers.length || titles.length < unitNumbers.length) {
    return {
      found: true,
      units: [],
      reason: `Found ${unitNumbers.length} unit number${unitNumbers.length === 1 ? '' : 's'}, but only ${pageNumbers.length} page number${pageNumbers.length === 1 ? '' : 's'} and ${titles.length} title${titles.length === 1 ? '' : 's'} \u2014 couldn't confidently match them up.`,
    };
  }

  const units = unitNumbers.map((number, index) => ({
    number,
    title: titles[index],
    startPage: pageNumbers[index],
    endPage: index + 1 < unitNumbers.length ? pageNumbers[index + 1] - 1 : null,
  }));

  return { found: true, units };
}
