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
 * Reads every page of an uploaded PDF File and returns per-page text
 * plus the full joined text — see this file's own
 * services/curriculumPdfParsingService.js header comment on why the
 * caller (ui/views/CurriculumManagementView.js) shows this raw
 * extraction result to an admin *before* any parsing runs, rather
 * than jumping straight to "found N units" or "found nothing": after
 * two rounds of parser fixes that each tested correctly in isolation
 * but didn't resolve a real user's repeated failure, the actual
 * priority became confirming what pdf.js extracted at all, not
 * guessing at another heuristic. Nothing about the parsing logic
 * changed here — this is strictly visibility into what already
 * happens, surfaced earlier than before.
 *
 * pdf.js's getTextContent() returns a flat list of text fragments per
 * page with no line breaks of its own — line structure has to be
 * reconstructed from each fragment's vertical position
 * (`item.transform[5]`, its Y-coordinate on the page). This matters a
 * great deal here: a real textbook's decorative unit-divider page
 * typically has "UNIT", the number, and the title as three visually
 * stacked fragments — three different Y-coordinates, three lines once
 * reconstructed — and parseTextIntoUnits() below depends entirely on
 * that line structure to recognize a heading. An earlier version of
 * this function joined every fragment on a page with a single space
 * regardless of position, which silently destroyed that structure —
 * the heading was never garbled, it simply never existed as separate
 * lines by the time the heuristic saw it. Verified against a real
 * TN Samacheer Kalvi Grade 8 Science PDF's actual heading shape (see
 * parseTextIntoUnits() below and its accompanying real-PDF test
 * fixture) — genuinely unverified beyond that, though, since this
 * sandbox has no browser or pdf.js to run the *upload* half of this
 * file against. Test this specific function against a real PDF in an
 * actual browser before assuming it's fully correct — which is
 * precisely why the new diagnostics screen exists: to make that
 * verification visible to whoever actually can run it, instead of
 * requiring a round trip through me to find out what happened.
 *
 * Returns `{ pageTexts: string[], fullText: string }` — `pageTexts`
 * is one entry per PDF page, in order; `fullText` is every page
 * joined by a blank line (so a heading sitting at the very top of a
 * new page doesn't visually run into the previous page's last line
 * before parseTextIntoUnits() ever sees it) — this is the exact same
 * string the parser has always received, unchanged.
 */
export async function extractTextFromPdf(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(reconstructLinesFromTextItems(content.items));
  }

  return { pageTexts, fullText: pageTexts.join('\n\n') };
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
function parseUnitsFromLines(rawText) {
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

// A second, independent detection strategy that assumes *nothing*
// about line breaks at all — it runs on the text with all whitespace
// collapsed to single spaces, and looks for the literal word sequence
// "UNIT"/"CHAPTER", a number, then a run of capitalized words, stopping
// at a recognized boundary (another heading, a decimal-numbered
// subsection like "1.1", a known section-label word, or the end of the
// text). This exists specifically as a safety net for
// parseUnitsFromLines() above: line-break reconstruction from a real
// PDF (see extractTextFromPdf()'s own doc comment) is inherently an
// approximation, and if it goes wrong in some way this sandbox has no
// browser available to predict, a teacher shouldn't be left with zero
// detected units when the actual heading text was sitting right there
// in the extracted text the whole time. Verified to correctly find all
// 23 real units in a real Samacheer Kalvi Grade 8 Science PDF even
// when every line break is stripped out entirely — see this file's
// accompanying real-PDF test fixture.
//
// Trade-off, stated plainly: this strategy can't tell where a title
// ends and body text begins as precisely as line-based detection can,
// and it doesn't attempt to find concept candidates at all (a unit
// found this way starts with an empty concept list) — a flattened
// blob of text has no short-line signal left to work with. That's a
// deliberate, acceptable cost for units existing instead of not
// existing; adding concepts manually in the review step remains
// exactly as easy as it always has been.
const FLATTENED_HEADING_PATTERN =
  /\b(unit|chapter)\s+(\d{1,2})\s+([A-Z][A-Z .,'&-]{1,60}?)(?=\s+(?:learning objectives|introduction|activity\s*\d*|unit\b|chapter\b|\d{1,2}\.\d|$))/gi;

function parseUnitsFromFlattenedText(rawText) {
  const flattened = (rawText || '').replace(/\s+/g, ' ').trim();
  const units = [];

  for (const match of flattened.matchAll(FLATTENED_HEADING_PATTERN)) {
    const label = /chapter/i.test(match[1]) ? 'Chapter' : 'Unit';
    const number = match[2];
    const title = match[3].trim();
    units.push({ title: `${label} ${number} \u2013 ${title}`, concepts: [] });
  }

  return units;
}

/**
 * The one entry point ui/views/CurriculumManagementView.js actually
 * calls. Tries the higher-quality, line-based detection first (real
 * concept candidates, more precise title boundaries) — only falls
 * back to the line-break-independent strategy above if that finds
 * nothing at all, so a well-behaved extraction never loses any
 * quality it would otherwise have had.
 */
export function parseTextIntoUnits(rawText) {
  const unitsFromLines = parseUnitsFromLines(rawText);
  if (unitsFromLines.length > 0) return unitsFromLines;
  return parseUnitsFromFlattenedText(rawText);
}

/**
 * Every regular expression parseTextIntoUnits() actually uses,
 * exposed by name for display only — see
 * ui/views/CurriculumManagementView.js's "parsing found nothing"
 * diagnostics screen. Nothing here is a copy; these are literally the
 * same RegExp objects the parser runs, so what an admin sees on
 * screen can never drift from what actually executed.
 */
export const DIAGNOSTIC_PATTERNS = {
  'Single-line heading (e.g. "Unit 1: Measurement")': SINGLE_LINE_HEADING_PATTERN,
  'Standalone heading word (e.g. "UNIT" on its own line)': STANDALONE_HEADING_WORD_PATTERN,
  'Title-line boundary (stops multi-line title collection)': TITLE_BOUNDARY_PATTERN,
  'Flattened-text fallback (line-break independent)': FLATTENED_HEADING_PATTERN,
};

/**
 * Diagnostic only — never used by parseTextIntoUnits() itself. When
 * parsing finds zero units, this answers the next question an admin
 * actually has: "the word 'unit' is clearly in this book somewhere,
 * so why didn't anything match?" Returns up to `limit` lines
 * (case-insensitively) containing "unit" or "chapter" as a whole
 * word, each with a couple of lines of surrounding context, so a near
 * miss is visible instead of an admin having to guess why the exact
 * regexes above didn't fire.
 */
export function findHeadingCandidateLines(rawText, limit = 20) {
  const lines = (rawText || '').split('\n').map((line) => line.trim());
  const candidates = [];

  for (let i = 0; i < lines.length && candidates.length < limit; i++) {
    if (!/\b(unit|chapter)\b/i.test(lines[i])) continue;
    const context = [lines[i - 1], lines[i], lines[i + 1]].filter((line) => line !== undefined);
    candidates.push({ lineNumber: i + 1, line: lines[i], context: context.join(' \u2502 ') });
  }

  return candidates;
}
