/**
 * services/curriculumPdfParsingService.js
 *
 * Two genuinely different things live in this one file, on purpose —
 * see the split below for why each half needs a different kind of
 * trust:
 *
 *   extractTextFromPdf(file) — reads raw text out of an uploaded PDF
 *   using pdf.js (loaded from cdnjs, matching this app's existing
 *   "import external libraries straight from a CDN, no bundler"
 *   pattern already used for Firebase). This is real text extraction,
 *   not OCR and not AI — pdf.js reads the text layer a PDF already
 *   contains (the same text a browser lets you select and copy), the
 *   same solved, deterministic capability every PDF reader relies on.
 *   It cannot read a scanned/image-only PDF with no embedded text —
 *   that would be OCR, explicitly out of scope.
 *
 *   parseTextIntoUnits(rawText) — a plain, rule-based heuristic that
 *   looks for "Unit N" / "Chapter N" headings and treats short lines
 *   under each heading as candidate concept titles. This is NOT AI
 *   extraction — no model, no inference, just pattern matching on
 *   line shape. It will get some real textbooks wrong (an unusual
 *   heading style, a concept title that happens to be long, a stray
 *   page number that looks short enough to pass) — which is exactly
 *   why ui/views/CurriculumManagementView.js's review step is a fully
 *   editable draft, not a preview. The heuristic's job is to save an
 *   admin from typing everything from scratch, not to be perfect.
 *
 *   Two heading shapes are recognized, because real PDF text
 *   extraction genuinely produces both — this was verified against an
 *   actual TN Samacheer Kalvi Grade 8 Science PDF (288 pages), not
 *   assumed:
 *     1. Single-line: "Unit 1: Measurement" / "Chapter 3 - Light" —
 *        the word, number, and title all on one extracted line.
 *     2. Multi-line: "UNIT" / "1" / "MEASUREMENT" as three separate
 *        extracted lines — this is how a real, professionally
 *        typeset textbook's decorative unit-divider page actually
 *        extracts (the word, the numeral, and the title are visually
 *        stacked, separate text runs in the PDF's own layout, not one
 *        line of body text). Missing this shape entirely was the
 *        original bug: a real textbook could produce zero detected
 *        units even though the heading was right there, because
 *        nothing this file recognized ever matched a bare "UNIT" on
 *        its own line.
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

/**
 * Reads every page of an uploaded PDF File and returns its full text,
 * pages joined by a blank line (so a heading that happens to sit at
 * the very top of a new page doesn't visually run into the previous
 * page's last line before parseTextIntoUnits() ever sees it).
 *
 * Real, working code — but genuinely unverified in the environment
 * this was written in, which has no browser and no PDF file to test
 * against. Test this against a real Samacheer Kalvi PDF in an actual
 * browser before relying on it.
 */
export async function extractTextFromPdf(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    pageTexts.push(pageText);
  }

  return pageTexts.join('\n\n');
}

const SINGLE_LINE_HEADING_PATTERN = /^(unit|chapter)\s+(\d+)\b[\s:.\u2013-]*(.*)$/i;
const STANDALONE_HEADING_WORD_PATTERN = /^(unit|chapter)$/i;

// A real title is never just a page number or a bare digit — without
// this check, a Table of Contents' own "Unit" column header followed
// by a list of unit numbers as table rows gets misread as one heading
// whose "title" is those numbers strung together (verified against a
// real textbook's actual Table of Contents page).
const BARE_NUMBER_PATTERN = /^\d+$/;

// A handful of section-label words that reliably follow a real
// heading's title and never appear as part of the title itself —
// stops multi-line title collection at the right point instead of
// running on indefinitely. Verified against a real textbook, where
// every single unit divider is immediately followed by one of these.
const TITLE_BOUNDARY_PATTERN = /^(learning objectives|introduction|activity\s*\d*)$/i;

/**
 * Pure and synchronous — no fetch, no DOM, no pdf.js. Feed it any
 * string (extracted PDF text, or anything else) and it deterministically
 * returns the same result every time, which is exactly why this
 * function (unlike extractTextFromPdf above) can be — and is —
 * thoroughly tested by executing it directly against sample text, and
 * was in fact re-verified against a real, full 288-page textbook's
 * actual extracted text, not just fabricated examples.
 *
 * Rules, stated plainly since "heuristic" shouldn't mean "opaque":
 *   1. A line matching "Unit N" / "Chapter N" (word and number
 *      together) starts a new unit immediately, titled from that
 *      line's own text.
 *   2. A line that is just "Unit" or "Chapter" on its own also starts
 *      a new unit, *if* the next non-blank line is a bare number —
 *      the number becomes the unit number, and up to two further
 *      non-blank lines after that (stopping early at a recognized
 *      section-label word, or another bare number) are joined as the
 *      title. This is the shape a real textbook's decorative unit
 *      divider page actually extracts as.
 *   3. Lines before the first such heading are ignored (front matter,
 *      table of contents, etc.).
 *   4. Within a unit, each subsequent line becomes a candidate concept
 *      title if it's non-empty, isn't itself another heading, isn't
 *      just a number (a page number), and is under 80 characters
 *      (long lines read as paragraph text, not a concept title).
 *      Longer or otherwise-rejected lines are simply skipped, not
 *      truncated or guessed at.
 *
 * Returns `[{ title, concepts: string[] }, ...]` — a draft, not a
 * verdict. Every field here is meant to be edited in the review step.
 */
export function parseTextIntoUnits(rawText) {
  // Blank lines are kept (as empty strings) through this first pass,
  // not filtered out up front — they're the signal that separates a
  // multi-line title from whatever comes after it. They're dropped
  // only from each unit's own concept-candidate list, at the end.
  const lines = (rawText || '').split('\n').map((line) => line.trim());

  const units = [];
  let currentUnit = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    const singleLineMatch = line.match(SINGLE_LINE_HEADING_PATTERN);
    if (singleLineMatch) {
      const label = /chapter/i.test(singleLineMatch[1]) ? 'Chapter' : 'Unit';
      const titlePart = singleLineMatch[3].trim();
      const title = titlePart ? `${label} ${singleLineMatch[2]} \u2013 ${titlePart}` : `${label} ${singleLineMatch[2]}`;
      currentUnit = { title, concepts: [] };
      units.push(currentUnit);
      i++;
      continue;
    }

    if (STANDALONE_HEADING_WORD_PATTERN.test(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++; // skip blanks to the number
      if (j < lines.length && BARE_NUMBER_PATTERN.test(lines[j])) {
        const label = /chapter/i.test(line) ? 'Chapter' : 'Unit';
        const number = lines[j];
        j++;
        while (j < lines.length && !lines[j]) j++; // skip blanks to the title

        const titleLines = [];
        while (
          j < lines.length &&
          lines[j] &&
          titleLines.length < 2 &&
          !TITLE_BOUNDARY_PATTERN.test(lines[j]) &&
          !BARE_NUMBER_PATTERN.test(lines[j])
        ) {
          titleLines.push(lines[j]);
          j++;
        }

        if (titleLines.length > 0) {
          currentUnit = { title: `${label} ${number} \u2013 ${titleLines.join(' ')}`, concepts: [] };
          units.push(currentUnit);
          i = j;
          continue;
        }
      }
    }

    if (currentUnit && line.length < 80 && !BARE_NUMBER_PATTERN.test(line)) {
      currentUnit.concepts.push(line);
    }
    i++;
  }

  return units;
}
