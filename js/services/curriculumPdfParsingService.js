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
 *   looks for lines matching "Unit N" / "Chapter N" as headings and
 *   treats short lines under each heading as candidate concept
 *   titles. This is NOT AI extraction — no model, no inference, just
 *   pattern matching on line shape. It will get some real textbooks
 *   wrong (an unusual heading style, a concept title that happens to
 *   be long, a stray page number that looks short enough to pass) —
 *   which is exactly why ui/views/CurriculumManagementView.js's review
 *   step is a fully editable draft, not a preview. The heuristic's job
 *   is to save an admin from typing everything from scratch, not to
 *   be perfect.
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

const UNIT_HEADING_PATTERN = /^(unit|chapter)\s+\d+/i;

/**
 * Pure and synchronous — no fetch, no DOM, no pdf.js. Feed it any
 * string (extracted PDF text, or anything else) and it deterministically
 * returns the same result every time, which is exactly why this
 * function (unlike extractTextFromPdf above) can be — and is —
 * thoroughly tested by executing it directly against sample text.
 *
 * Rules, stated plainly since "heuristic" shouldn't mean "opaque":
 *   1. Every line matching /^(unit|chapter)\s+\d+/i (case-insensitive)
 *      starts a new unit, titled with that line's own text, exactly
 *      as written in the source.
 *   2. Lines before the first such heading are ignored (front matter,
 *      table of contents, etc.).
 *   3. Within a unit, each subsequent line becomes a candidate concept
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
  const lines = (rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const units = [];
  let currentUnit = null;

  lines.forEach((line) => {
    if (UNIT_HEADING_PATTERN.test(line)) {
      currentUnit = { title: line, concepts: [] };
      units.push(currentUnit);
      return;
    }

    if (!currentUnit) return; // nothing before the first heading is kept
    if (/^\d+$/.test(line)) return; // bare page number
    if (line.length >= 80) return; // reads as paragraph text, not a title

    currentUnit.concepts.push(line);
  });

  return units;
}
