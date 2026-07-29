/**
 * services/unitExtractionService.js
 *
 * Unit Extraction Engine. Replaces the earlier
 * the earlier tableOfContentsService.js entirely — that file tried to identify
 * *which format* a Table of Contents used (a structured table, a
 * numbered list, a Chapter-style divider, ...) and pick a matching
 * strategy. This file does something deliberately simpler and more
 * general: the input is just text that may contain a list of units,
 * and the job is to pull `{ number, title, printedPage }` out of
 * whatever rows are actually there — tolerant of headers, extra
 * columns (Month, Semester, Notes, ...), inconsistent spacing, tabs,
 * dotted leaders, and messy OCR/copy-paste output — rather than
 * requiring the input to match one of a fixed set of recognized
 * shapes first.
 *
 * No "Contents" heading is required or searched for. No confidence
 * score, no named strategy, no "found"/"reason" — extractUnits()
 * either finds real rows or it doesn't; a caller sees an empty array
 * either way and falls back to manual entry (see
 * services/curriculumIndexSession.js). High recall is the explicit
 * priority over perfect precision: the Review Units screen is where
 * a teacher fixes whatever this gets wrong, so an occasional false
 * positive here is a far better outcome than a real unit going
 * missing because the input didn't match some fixed set of
 * recognized formats.
 *
 * Two extraction passes run, in order, and their results are
 * combined — not chosen between:
 *
 *   1. Same-line rows: any line that reads as "number, title, page"
 *      or just "title, page" on its own, in any reasonable spacing —
 *      "1. Measurement .......... 1", "1) Measurement - 1",
 *      "1 Measurement 1", tab-separated, or even glued together with
 *      no separator at all ("2Force and Pressure 20") when a title
 *      starting uppercase makes that unambiguous. This is the common
 *      case for a numbered list or a plain pasted list of lines.
 *
 *   2. Column-major reconstruction: for a table that extracted with
 *      every unit number in one block, then every page number in
 *      another, then every title in a third (this is genuinely how a
 *      real textbook's Table of Contents table extracts from a PDF —
 *      verified against a real TN Samacheer Kalvi Grade 8 Science
 *      PDF, see this file's own real-book test fixture — because a
 *      PDF's content stream just isn't guaranteed to store a table
 *      row by row), this reconstructs the row-by-row correspondence:
 *      finds the block of consecutive numbers most likely to be real
 *      unit numbers (the strongest, most general signal being an
 *      exact sequential run starting at 1 — an actual list of unit
 *      numbers counts up predictably; unrelated numbers scattered
 *      through surrounding text don't), then the nearest later block
 *      of increasing numbers as pages, then the nearest later block
 *      of ordinary text as titles. "Nearest" (positional proximity),
 *      not merely "longest," is what keeps this from being confused
 *      by an unrelated stretch of body text elsewhere in the same
 *      scanned pages that happens to be a similar length — verified
 *      against exactly that failure mode using the real book's own
 *      first 15 pages, which include real unit 1 body content right
 *      after its actual Table of Contents.
 *
 * Column and row labels (Unit, Chapter, Title, Page No, Month,
 * Semester N, Notes, ...) are recognized and skipped rather than
 * mistaken for real data — this is what "ignoring unrelated columns"
 * actually means here: a label line breaks a block the same way a
 * blank line does, so two real data blocks never accidentally merge
 * into one just because a label sat between them.
 */

// Recognized as boilerplate, never real unit data — skipped
// everywhere, including as a break between two real data blocks so
// they never merge into one.
const LABEL_LINE_PATTERN =
  /^(unit|chapter|title|page\s*no\.?|pages?|month|semester\s*\d*|term\s*\d*|notes?|contents|table of contents|s\.?\s*no\.?|index|syllabus|sr\.?\s*no\.?|sl\.?\s*no\.?|year|week|duration|remarks?|activity|problem|exercise|example|solution|note|summary|question|figure|table|worksheet)$/i;

const MONTH_NAMES = new Set([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]);

function isLabelLine(line) {
  return LABEL_LINE_PATTERN.test(line.trim());
}
function isMonthLine(line) {
  return MONTH_NAMES.has(line.trim().toLowerCase());
}
function isBareInteger(line) {
  return /^\d{1,4}$/.test(line.trim());
}
function isBreakLine(line) {
  return isLabelLine(line) || isMonthLine(line);
}
function isTextyLine(line) {
  return !isBareInteger(line) && !isBreakLine(line);
}

// ---- Pass 1: same-line rows -------------------------------------------

// A real separator present (space, dot leader, dash, colon, tab —
// \s already matches tabs) tolerates any case for the title that
// follows. With zero separator at all, the title must start
// uppercase — this is what distinguishes a genuine glued-together row
// ("2Force and Pressure 20") from an unrelated compound word or
// ordinal a bare number happens to be glued to in running text/footer
// artifacts ("8th_Science_Index.indd 1" — verified as a real false
// positive this exact rule exists to reject, found by testing against
// the real book's actual extracted text, not a hypothetical).
// A single pattern capturing whatever sits between the number and the
// title as its own group, whatever mix of punctuation and whitespace
// it is (including nothing at all) — disambiguation happens in code,
// in matchNumberedRow() below, rather than trying to encode "gap
// present vs. absent" as two separate regexes (which couldn't
// correctly cover every real combination: "1 Measurement" (space
// only), "1. Measurement" (dot then space), "3.Light" (dot, no
// space), and "2Force and Pressure" (nothing at all) all need the
// same underlying match, just judged differently once matched).
const NUMBERED_ROW_PATTERN = /^(?:unit|chapter)?\s*\(?\s*(\d{1,3})\)?([-.):\s]*)([A-Za-z].*?)[\s._\-]+(\d{1,4})\s*$/i;
// No leading number at all — just "Title .... Page" — for a divider
// page whose title sits on its own line, separate from a preceding
// standalone "Unit N"/"Chapter N" line (see below).
const TITLE_PAGE_PATTERN = /^([A-Za-z][A-Za-z0-9 ,'&()\/\-]{2,70}?)[\s._\-]{1,}(\d{1,4})\s*$/;
// A bare "Unit N" / "Chapter N" line with nothing else on it — supplies
// the number for whichever title-only row follows it next.
const STANDALONE_NUMBER_HEADING_PATTERN = /^(?:unit|chapter)\s+(\d{1,3})$/i;

function matchNumberedRow(line) {
  const match = line.match(NUMBERED_ROW_PATTERN);
  if (!match) return null;
  const gap = match[2];
  const titleStart = match[3];
  // No real separator at all between the number and the title — only
  // trust this if the title starts uppercase, the way a real title
  // would. Without this check, a bare number glued to an ordinary
  // lowercase word (an ordinal like "8th", or "8th_Science_Index.indd"
  // in a real PDF's own page-generation footer — verified as an
  // actual false positive this exact check exists to reject) would be
  // misread as a real "number + title" row.
  if (gap.length === 0 && !/^[A-Z]/.test(titleStart)) return null;
  return { number: Number(match[1]), rawTitle: titleStart, printedPage: Number(match[4]) };
}

function extractSameLineRows(lines) {
  const results = [];
  const consumed = new Array(lines.length).fill(false);
  let pendingStandaloneNumber = null;

  lines.forEach((line, i) => {
    const standalone = line.match(STANDALONE_NUMBER_HEADING_PATTERN);
    if (standalone) {
      pendingStandaloneNumber = Number(standalone[1]);
      consumed[i] = true;
      return;
    }

    const numbered = matchNumberedRow(line);
    if (numbered) {
      const title = numbered.rawTitle.trim().replace(/^[-.:)\s]+/, '').trim();
      if (title && !isLabelLine(title)) {
        results.push({ number: numbered.number, title, printedPage: numbered.printedPage });
        consumed[i] = true;
        pendingStandaloneNumber = null;
        return;
      }
    }

    const titleOnly = line.match(TITLE_PAGE_PATTERN);
    if (titleOnly && !isLabelLine(titleOnly[1])) {
      results.push({ number: pendingStandaloneNumber, title: titleOnly[1].trim(), printedPage: Number(titleOnly[2]) });
      consumed[i] = true;
      pendingStandaloneNumber = null;
    }
  });

  return { results, consumed };
}

// ---- Pass 2: column-major reconstruction ------------------------------

function findRuns(lines, predicate) {
  const runs = [];
  let current = [];
  let currentStart = -1;
  lines.forEach((line, i) => {
    if (predicate(line)) {
      if (current.length === 0) currentStart = i;
      current.push(line);
    } else if (current.length > 0) {
      runs.push({ values: current, start: currentStart, end: currentStart + current.length - 1 });
      current = [];
    }
  });
  if (current.length > 0) runs.push({ values: current, start: currentStart, end: currentStart + current.length - 1 });
  return runs;
}

function isSequentialFromOne(run) {
  return run.every((v, i) => Number(v) === i + 1);
}
function isMonotonicIncreasing(run) {
  for (let i = 1; i < run.length; i++) {
    if (Number(run[i]) < Number(run[i - 1])) return false;
  }
  return true;
}

function extractColumnMajorRows(remainingLines) {
  const integerRuns = findRuns(remainingLines, isBareInteger).filter((r) => r.values.length >= 2);
  const textRuns = findRuns(remainingLines, isTextyLine).filter((r) => r.values.length >= 2);

  const sequentialRuns = integerRuns.filter((r) => isSequentialFromOne(r.values));
  const unitNumberRun =
    sequentialRuns.length > 0
      ? sequentialRuns.reduce((best, r) => (r.values.length > best.values.length ? r : best), sequentialRuns[0])
      : integerRuns.reduce((best, r) => (!best || r.values.length > best.values.length ? r : best), null);
  if (!unitNumberRun) return [];
  const targetLength = unitNumberRun.values.length;

  const pageRun = integerRuns
    .filter((r) => r !== unitNumberRun && isMonotonicIncreasing(r.values) && r.start > unitNumberRun.end)
    .reduce((best, r) => {
      const diff = Math.abs(r.values.length - targetLength);
      const bestDiff = best ? Math.abs(best.values.length - targetLength) : Infinity;
      return diff < bestDiff ? r : best;
    }, null);
  if (!pageRun) return [];

  const titleRun = textRuns
    .filter((r) => r.start > pageRun.end)
    .reduce((best, r) => {
      if (!best) return r;
      const proximity = r.start - pageRun.end;
      const bestProximity = best.start - pageRun.end;
      if (proximity !== bestProximity) return proximity < bestProximity ? r : best;
      const diff = r.values.length >= targetLength ? r.values.length - targetLength : (targetLength - r.values.length) * 10;
      const bestDiff = best.values.length >= targetLength ? best.values.length - targetLength : (targetLength - best.values.length) * 10;
      return diff < bestDiff ? r : best;
    }, null);
  if (!titleRun) return [];

  const count = Math.min(unitNumberRun.values.length, pageRun.values.length, titleRun.values.length);
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push({ number: Number(unitNumberRun.values[i]), title: titleRun.values[i], printedPage: Number(pageRun.values[i]) });
  }
  return results;
}

// ---- Entry point --------------------------------------------------------

/**
 * The one function this file exports. Runs both passes and returns
 * everything either one found — same-line rows first, then whatever
 * the column-major fallback reconstructs from the lines the first
 * pass didn't already consume. Returns `[]` when nothing in the given
 * text looks like a real row at all; the caller (see
 * services/curriculumIndexSession.js) treats that the same as any
 * other failed extraction, falling back to manual entry.
 */
export function extractUnits(rawText) {
  const lines = (rawText || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const { results: sameLineResults, consumed } = extractSameLineRows(lines);
  const remainingLines = lines.filter((_, i) => !consumed[i]);
  const columnResults = extractColumnMajorRows(remainingLines);
  return [...sameLineResults, ...columnResults];
}
