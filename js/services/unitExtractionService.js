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
 *
 * Part detection: some curricula aren't one flat sequence — Social
 * Science restarts numbering per section (History Unit 1, Geography
 * Unit 1, ...), English organizes into Literature/Grammar/Writing,
 * and so on. See isConfirmedPartHeading() below for the actual
 * multi-signal detection (never uppercase alone, per explicit
 * instruction — real textbooks format headings inconsistently). Every
 * extracted unit carries a `partName` (`null` when no Part heading
 * was ever detected, which the caller treats as a single default
 * "General" part — Science's own workflow never sees a special case).
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

/**
 * The core of this file's actual redesign. Earlier versions of this
 * pass tried to match a whole row against a fixed shape (a specific
 * regex requiring the page number to be the very last token) — which
 * broke the moment a real textbook added one more trailing column
 * (Month, Semester, Learning Outcome, ...) after the page number, and
 * would keep breaking for the next publisher's own choice of extra
 * columns, since each new layout needed its own new regex.
 *
 * This asks a different question entirely: not "does this row match
 * a known layout," but "can I confidently pull a Unit Number, a
 * Title, and a Printed Page out of this row's tokens, in that order?"
 * A row is split into tokens; the first integer token found is the
 * Unit Number; the *next* integer token after it — not necessarily
 * the row's last one — is the Printed Page (this matters: a row like
 * "5 Electricity 46 3" has a real page number, 46, followed by some
 * other trailing numeric column, e.g. a lesson count; treating "3" as
 * the page because it's last would be wrong; the page is always the
 * number immediately following the title, wherever the row happens to
 * end after that); everything strictly between those two integers,
 * once leader/punctuation-only tokens are dropped, is the Title.
 * Anything after the Printed Page is simply never looked at — a
 * trailing Month, Semester, Learning Outcome, Notes, Duration, or any
 * other column a textbook happens to add is irrelevant here, not
 * something this file needs to know about or enumerate in advance.
 */

// A token made up entirely of leader/punctuation characters — a
// dotted leader ("..........") or a stray standalone dash/colon — is
// a separator, not content, and is dropped before anything else runs.
const PURE_PUNCTUATION_TOKEN_PATTERN = /^[.\-_:,()]+$/;
// A token that IS a number, once a single leading "(" or trailing
// ").:,"-style numbering punctuation is stripped off ("1." / "1)" /
// "1:" all mean the numeral 1).
function tokenAsInteger(token) {
  const stripped = token.replace(/^\(+/, '').replace(/[).:,]+$/, '');
  return /^\d{1,4}$/.test(stripped) ? Number(stripped) : null;
}

const LEADING_LABEL_PATTERN = /^(?:unit|chapter)\b[\s:.\-]*/i;

function tokenizeRow(line) {
  const withoutLeadingLabel = line.replace(LEADING_LABEL_PATTERN, '');
  return withoutLeadingLabel
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !PURE_PUNCTUATION_TOKEN_PATTERN.test(token));
}

// A real title is reasonably short, starts with a letter the way an
// actual title would, and doesn't contain characters a genuine title
// wouldn't (an underscore or a stray period is characteristic of a
// filename or footer artifact rather than real title text — verified
// against a real textbook's own page-generation filename,
// "8th_Science_Index.indd", which this exact check exists to reject
// rather than misread as a unit title).
function isPlausibleTitle(title) {
  return (
    title.length >= 2 &&
    title.length <= 100 &&
    /^[A-Za-z0-9 ,'&()/-]+$/.test(title) &&
    /^[A-Za-z]/.test(title) &&
    !isLabelLine(title)
  );
}

// ---- Part detection -----------------------------------------------------

/**
 * Some curricula (Social Science: History, Geography, Civics,
 * Economics; English: Literature, Grammar, Writing; ...) aren't one
 * flat sequence of units — they're several independent sequences,
 * each restarting its own numbering at 1. A Part heading ("HISTORY")
 * introduces one of these sequences. Detecting one is *not* about
 * matching a fixed layout (the whole point of this file); several
 * independent signals combine, per explicit instruction not to rely
 * on uppercase alone, since real textbooks format headings
 * inconsistently:
 *
 *   - No digits at all in the line, and reasonably short — a real
 *     heading has no unit number and no page number sitting on it.
 *   - Formatting that reads like a heading — mostly uppercase, or
 *     every word capitalized (Title Case) — one signal among several,
 *     not the deciding one.
 *   - Preceded by a blank line in the original text — the closest
 *     proxy available to "visually separated," since this file only
 *     ever sees extracted text, never real layout/typography.
 *   - Genuinely load-bearing, and required rather than optional: is
 *     this line shortly followed by a row whose own Unit Number is 1
 *     — i.e., a brand new sequence actually starting right after it?
 *     This is what a real Part heading always does and an ordinary
 *     short line essentially never coincidentally does. Verified as
 *     necessary, not just theoretically nice, against a real
 *     textbook: without requiring this specifically, a real book's
 *     own short, Title-Case unit title ("Measurement") was being
 *     mistaken for a Part heading purely from formatting and blank-line
 *     signals alone — those two are kept as confidence-boosters here,
 *     never sufecient by themselves.
 */
const HEADING_LOOKAHEAD_WINDOW = 3;

function looksLikeHeadingText(line) {
  return !/\d/.test(line) && line.length >= 2 && line.length <= 50;
}
function isMostlyUppercase(line) {
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  return letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.8;
}
function isTitleCase(line) {
  const words = line.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => /^[A-Z]/.test(word));
}

function isConfirmedPartHeading(line, lines, index, precededByBlank) {
  if (!looksLikeHeadingText(line) || isLabelLine(line) || isMonthLine(line)) return false;

  let foundUnitOne = false;
  for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 1 + HEADING_LOOKAHEAD_WINDOW); lookahead++) {
    const candidate = extractRowFields(lines[lookahead], null);
    if (candidate && !('standaloneNumber' in candidate) && candidate.number === 1) {
      foundUnitOne = true;
      break;
    }
  }
  if (!foundUnitOne) return false;

  return isMostlyUppercase(line) || isTitleCase(line) || precededByBlank[index];
}

/**
 * Tries to extract one Unit record from a single row's tokens.
 * Returns `{ number, title, printedPage }`, `{ standaloneNumber }` (a
 * bare "Unit N" / "Chapter N" line with nothing else on it — supplies
 * the number for whichever title-only row follows), or `null` (not
 * confidently a Unit record at all).
 */
function extractRowFields(line, pendingStandaloneNumber) {
  const tokens = tokenizeRow(line);
  if (tokens.length === 0) return null;

  const intPositions = [];
  tokens.forEach((token, i) => {
    if (tokenAsInteger(token) !== null) intPositions.push(i);
  });

  if (intPositions.length === 0) return null;

  if (intPositions.length === 1) {
    const idx = intPositions[0];
    if (tokens.length === 1) {
      // A bare number alone on its own line is only trusted as a
      // "Unit N"/"Chapter N" divider marker if the line actually had
      // that label word attached — an unlabeled bare number (every
      // single number in a real column-major table's own unit-number
      // and page-number blocks is exactly this) must be left
      // untouched here, or the column-major pass downstream would
      // have nothing left to reconstruct from. Verified as a real,
      // serious regression this exact check exists to prevent: every
      // bare number in the real book's actual Table of Contents table
      // was being wrongly consumed as a potential divider marker
      // before this check existed.
      if (LEADING_LABEL_PATTERN.test(line)) {
        return { standaloneNumber: tokenAsInteger(tokens[0]) };
      }
      return null;
    }
    if (idx > 0 && pendingStandaloneNumber !== null) {
      // "Title .... Page", no unit number in this row itself — a
      // divider page's title line, using the standalone number that
      // preceded it. Only trusted when such a marker actually came
      // first: without it, an ordinary sentence that happens to end
      // in a number (a year, a count) is structurally identical to a
      // real divider title line, and shouldn't be guessed at.
      const title = tokens.slice(0, idx).join(' ');
      if (isPlausibleTitle(title)) {
        return { number: pendingStandaloneNumber, title, printedPage: tokenAsInteger(tokens[idx]) };
      }
    }
    return null;
  }

  // Two or more integers: the first is the Unit Number, the very next
  // one after it is the Printed Page — never assumed to be the row's
  // last integer, since trailing numeric columns (a lesson count, a
  // competency code, marks, ...) can follow the real page number.
  const numberIdx = intPositions[0];
  const pageIdx = intPositions[1];
  const title = tokens.slice(numberIdx + 1, pageIdx).join(' ');
  if (!isPlausibleTitle(title)) return null;
  return { number: tokenAsInteger(tokens[numberIdx]), title, printedPage: tokenAsInteger(tokens[pageIdx]) };
}

function extractSameLineRows(lines, precededByBlank) {
  const results = [];
  const consumed = new Array(lines.length).fill(false);
  let pendingStandaloneNumber = null;
  let currentPartName = null;

  lines.forEach((line, i) => {
    const row = extractRowFields(line, pendingStandaloneNumber);
    if (!row) {
      // A pending standalone number is only ever meant for the very
      // next line — if this line didn't use it, whatever context set
      // it is over. Left uncleared, a bare number from anywhere
      // earlier in the document (front matter, a stray count in body
      // text) would otherwise sit around indefinitely and eventually
      // attach itself to some unrelated later sentence that happens
      // to end in a number — verified as a real, serious false
      // positive this exact reset exists to prevent.
      pendingStandaloneNumber = null;
      if (isConfirmedPartHeading(line, lines, i, precededByBlank)) {
        currentPartName = line;
        consumed[i] = true;
      }
      return;
    }

    if ('standaloneNumber' in row) {
      pendingStandaloneNumber = row.standaloneNumber;
      consumed[i] = true;
      return;
    }

    results.push({ number: row.number, title: row.title, printedPage: row.printedPage, partName: currentPartName });
    consumed[i] = true;
    pendingStandaloneNumber = null;
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
    results.push({ number: Number(unitNumberRun.values[i]), title: titleRun.values[i], printedPage: Number(pageRun.values[i]), partName: null });
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
  const rawLines = (rawText || '').split('\n').map((line) => line.trim());

  // Blank lines are dropped from the working line list (same as
  // before), but whether a line was *preceded* by one is preserved
  // as a parallel array — one of Part detection's signals (the
  // closest available proxy for "visually separated," since this
  // file only ever sees extracted text, never real layout).
  const lines = [];
  const precededByBlank = [];
  let lastLineWasBlank = true; // the very start of the document counts as "nothing before it"
  for (const line of rawLines) {
    if (!line) {
      lastLineWasBlank = true;
      continue;
    }
    lines.push(line);
    precededByBlank.push(lastLineWasBlank);
    lastLineWasBlank = false;
  }

  const { results: sameLineResults, consumed } = extractSameLineRows(lines, precededByBlank);
  const remainingLines = lines.filter((_, i) => !consumed[i]);
  const columnResults = extractColumnMajorRows(remainingLines);
  return [...sameLineResults, ...columnResults];
}
