/**
 * services/conceptImportFormatService.js
 *
 * The strict, deterministic parser for the Concept Import Format —
 * the Concept Extraction stage's counterpart to
 * canonicalUnitExtractionService.js's own parser for Units, and
 * deliberately built to the same philosophy: recognizing this format
 * requires no heuristics at all. Every line is either a known header
 * line, blank, a valid `number|title|startPage-endPage` line, or
 * malformed — there is no "does this look like a concept" judgment
 * call anywhere in this file.
 *
 * The format itself:
 *
 *   CURRICULUM: Samacheer Kalvi
 *   GRADE: 8
 *   SUBJECT: Science
 *
 *   UNIT: Force and Pressure
 *   START_PAGE: 42
 *   END_PAGE: 56
 *
 *   1|Force|42-43
 *   2|Effects of Force|44-46
 *   3|Pressure|47-49
 *
 * Header fields are parsed and returned, not just skipped — they
 * exist so the caller (see services/extractionProviders/manualAiProvider.js)
 * can sanity-check that a teacher pasted the result for the Unit they
 * actually extracted from, not a different Unit's output pasted by
 * mistake. They carry no information the parser itself needs to make
 * a concept line valid.
 *
 * Malformed lines are never silently dropped and never fail the whole
 * parse — every successfully parsed concept is still returned, and
 * every line that didn't parse is reported back with its own line
 * number and original text, so a teacher can decide whether to
 * continue or fix their input and re-paste. Same reasoning as
 * canonicalUnitExtractionService.js's own header comment: AI output
 * is not infallible, and a dropped field or a stray comma used
 * instead of a pipe is exactly the kind of small mistake this exists
 * to catch and name precisely, not swallow.
 */

const HEADER_LINE_PATTERNS = {
  curriculum: /^curriculum\s*:\s*(.*)$/i,
  grade: /^grade\s*:\s*(.*)$/i,
  subject: /^subject\s*:\s*(.*)$/i,
  unit: /^unit\s*:\s*(.*)$/i,
  startPage: /^start_page\s*:\s*(.*)$/i,
  endPage: /^end_page\s*:\s*(.*)$/i,
};

const PAGE_RANGE_PATTERN = /^(\d+)-(\d+)$/;

/**
 * Parses Concept Import Format text. Returns:
 *   {
 *     metadata: { curriculum, grade, subject, unit, startPage, endPage },
 *     concepts: [{ number, title, startPage, endPage }],
 *     errors: [{ lineNumber, rawLine }],
 *   }
 * `metadata` fields default to `null` if their header line is
 * missing — this parser never invents a value, and never requires
 * every header field to be present to still parse the concept lines
 * beneath it; a teacher who deleted the header entirely while editing
 * still gets every concept line parsed correctly.
 */
export function parseConceptImportFormat(rawText) {
  const rawLines = (rawText || '').split('\n');
  const metadata = { curriculum: null, grade: null, subject: null, unit: null, startPage: null, endPage: null };
  const concepts = [];
  const errors = [];

  rawLines.forEach((rawLine, i) => {
    const lineNumber = i + 1;
    const line = rawLine.trim();
    if (!line) return; // blank lines are never errors

    for (const [field, pattern] of Object.entries(HEADER_LINE_PATTERNS)) {
      const match = line.match(pattern);
      if (match) {
        metadata[field] = match[1].trim();
        return;
      }
    }

    const fields = line.split('|');
    if (fields.length === 3) {
      const numberField = fields[0].trim();
      const title = fields[1].trim();
      const pageRangeField = fields[2].trim();
      const isValidNumber = /^\d+$/.test(numberField);
      const pageRangeMatch = pageRangeField.match(PAGE_RANGE_PATTERN);

      if (isValidNumber && title && pageRangeMatch) {
        concepts.push({
          number: Number(numberField),
          title,
          startPage: Number(pageRangeMatch[1]),
          endPage: Number(pageRangeMatch[2]),
        });
        return;
      }
    }

    errors.push({ lineNumber, rawLine: line });
  });

  // startPage/endPage in metadata are page numbers, not a title —
  // convert from string to number the same way concept lines' own
  // page fields are, for consistency, but only if a value was
  // actually present.
  if (metadata.startPage !== null) metadata.startPage = Number(metadata.startPage);
  if (metadata.endPage !== null) metadata.endPage = Number(metadata.endPage);

  return { metadata, concepts, errors };
}
