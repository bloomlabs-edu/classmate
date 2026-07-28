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
 * No AI, no model, no inference — pure pattern matching on line
 * shape, exactly like this app's very first heading-detection
 * attempt, just aimed at the one page that already states the answer
 * directly instead of every page in the book. Verified against a real
 * TN Samacheer Kalvi Grade 8 Science PDF's actual Table of Contents
 * (see this project's own real-PDF test fixture) — this logic is
 * unchanged from where it was first built and tested; only its home
 * file has moved, as part of splitting curriculum import into
 * independent, single-responsibility services.
 *
 * The tricky, load-bearing part, verified against that real
 * textbook's actual Table of Contents: a table extracted from a PDF
 * does not come back row by row ("Unit 1, Measurement, page 1; Unit
 * 2, Force and Pressure, page 12; ..."). It comes back column by
 * column — every unit number, then every column label, then every
 * page number, then (optionally, board-specific) every month of a
 * teaching-pacing column, then every title — because that's the order
 * the fragments happen to sit in the PDF's own content stream, not the
 * order they're visually read in. parseTableOfContents() reconstructs
 * the row-by-row correspondence a human would see just by looking at
 * the table:
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
 * Each unit comes back with only `tocPage` — the printed page number
 * a teacher would recognize from the book itself. This function
 * deliberately does not compute an `endPage`: subtracting one ToC page
 * from the next assumes printed-page differences map one-to-one onto
 * physical PDF page differences, which isn't reliable once a book's
 * front matter (roman-numeral preface pages, unnumbered plates, etc.)
 * throws that mapping off. Finding where each unit actually starts
 * and ends in the real PDF is services/anchorDetectionService.js's
 * job, immediately downstream of this one — it treats every detected
 * heading as its own independently-verified anchor rather than
 * trusting a single computed offset for the whole book.
 *
 * Returns `{ found: boolean, units: [{ number, title, tocPage }], reason?: string }` —
 * `reason` is set whenever `units` comes back empty despite `found`
 * being true, so a failure is diagnosable (behind the debug flag —
 * see services/debugModeService.js — never shown to a normal teacher)
 * instead of silent.
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
    tocPage: pageNumbers[index],
  }));

  return { found: true, units };
}
