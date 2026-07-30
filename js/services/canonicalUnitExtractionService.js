/**
 * services/canonicalUnitExtractionService.js
 *
 * The strict, deterministic counterpart to unitExtractionService.js's
 * tolerant, best-effort engine. Powers "AI-Ready Import" — the
 * recommended path, for text already converted into ClassMate's own
 * canonical format (by Claude, ChatGPT, Gemini, or any other tool,
 * or typed by hand). unitExtractionService.js remains "Import from
 * Textbook" — experimental, best-effort, for a raw copied Table of
 * Contents — these are two separate, user-facing import workflows,
 * not competing implementations of the same idea; neither replaces
 * the other. See ui/views/CurriculumManagementView.js for how a
 * teacher chooses between them.
 *
 * The canonical format itself:
 *
 *   CURRICULUM: Grade 8 Social Science
 *
 *   PART: History
 *   1|Advent of the Europeans|1
 *   2|From Trade to Territory|11
 *
 *   PART: Geography
 *   1|Rocks and Soils|85
 *
 * The whole point of this format is that recognizing it requires no
 * heuristics at all — every line is either a `PART:` line, a
 * `CURRICULUM:` line, blank, a valid `number|title|page` line, or
 * malformed. There is no "does this look like a heading" judgment
 * call anywhere in this file, unlike the tolerant engine, because the
 * format itself was designed to remove the need for one.
 *
 * `CURRICULUM:` is accepted and ignored — the app already collects
 * curriculum name/board/grade/subject through its own metadata form
 * before any text is pasted, so this line carries no information the
 * parser needs. It exists purely so a teacher (or an AI regenerating
 * the file) can tell what a saved canonical file is about at a
 * glance, without needing ClassMate open — free documentation,
 * costing nothing to ignore.
 *
 * Malformed lines are never silently dropped and never fail the
 * whole import — every successfully parsed unit is still returned,
 * and every line that didn't parse is reported back with its own
 * line number and original text, so a teacher can decide whether to
 * continue or fix their input and re-paste. This matters especially
 * because so much canonical-format text will itself be AI-generated,
 * and AI output is not infallible — a dropped field, a stray comma
 * used instead of a pipe, is exactly the kind of small mistake this
 * exists to catch and name precisely, not swallow.
 */

const PART_LINE_PATTERN = /^part\s*:\s*(.*)$/i;
const CURRICULUM_LINE_PATTERN = /^curriculum\s*:/i;

/**
 * Parses canonical-format text. Returns:
 *   {
 *     units: [{ number, title, printedPage, partName }],
 *     errors: [{ lineNumber, rawLine }],
 *   }
 * `partName` defaults to "General" for any unit line appearing before
 * the first `PART:` line, or when the text has no `PART:` line at
 * all — Science's own workflow never needs to write one.
 */
export function parseCanonicalFormat(rawText) {
  const rawLines = (rawText || '').split('\n');
  const units = [];
  const errors = [];
  let currentPartName = 'General';

  rawLines.forEach((rawLine, i) => {
    const lineNumber = i + 1;
    const line = rawLine.trim();
    if (!line) return; // blank lines are never errors

    if (CURRICULUM_LINE_PATTERN.test(line)) return; // accepted and ignored — documentation only

    const partMatch = line.match(PART_LINE_PATTERN);
    if (partMatch) {
      currentPartName = partMatch[1].trim();
      return;
    }

    const fields = line.split('|');
    if (fields.length === 3) {
      const number = Number(fields[0].trim());
      const title = fields[1].trim();
      const printedPage = Number(fields[2].trim());
      const isValidNumber = /^\d+$/.test(fields[0].trim());
      const isValidPage = /^\d+$/.test(fields[2].trim());
      if (isValidNumber && title && isValidPage) {
        units.push({ number, title, printedPage, partName: currentPartName });
        return;
      }
    }

    errors.push({ lineNumber, rawLine: line });
  });

  return { units, errors };
}
