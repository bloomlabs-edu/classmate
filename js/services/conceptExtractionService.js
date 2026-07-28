/**
 * services/conceptExtractionService.js
 *
 * Curriculum Import Pipeline redesign: one responsibility — given one
 * Unit's own text (see services/unitSegmentationService.js), produce
 * candidate concept titles for a teacher to review. Explicit design
 * instruction this file exists to honor: "don't invest heavily in
 * regex heuristics — build the service so the implementation is
 * swappable. Today: regex. Tomorrow: LLM, or hybrid. The interface
 * never changes."
 *
 * `extractConcepts(unitText)` is the *entire* public surface of this
 * file — one function, one input, one output shape
 * (`Promise<string[]>`), on purpose. Nothing else in the app should
 * ever import anything from here except this one function; whatever
 * strategy sits behind it — regex, an LLM call, embeddings, a hybrid
 * of several — is invisible to every caller, and swapping it out
 * later means changing the one line below where the current strategy
 * is selected, not touching any caller.
 *
 * Today's strategy is real, working pattern matching, not a
 * placeholder — but deliberately simple, per that same instruction.
 * It runs against one Unit's own ~10 pages of text (not a whole
 * 288-page book, which is exactly what makes this both a
 * dramatically easier problem than the earlier whole-book approach
 * and genuinely useful even at this simplicity: short, non-boilerplate
 * lines within a single Unit's own content are a reasonable proxy for
 * "things this Unit teaches," precisely because there's so much less
 * unrelated material for a short line to accidentally resemble.
 * "Heavily invested" heuristics (multi-strategy fallbacks, elaborate
 * boundary detection) intentionally do not belong here — a future
 * LLM-backed strategy is expected to replace this one outright, not
 * grow alongside it.
 */

/**
 * The one entry point every caller should ever use. Swap the line
 * below to change strategy — no caller anywhere else in the app
 * needs to change when this does.
 */
export async function extractConcepts(unitText) {
  return extractConceptsViaRegex(unitText);
}

// A handful of section-label words that are common boilerplate within
// a Unit's own front matter, not something it actually teaches —
// verified against a real textbook, where these appear at the start
// of essentially every Unit.
const BOILERPLATE_LINE_PATTERN = /^(learning objectives|introduction|points to remember|activity\s*\d*|summary|glossary|exercises?|evaluation)$/i;

const MAX_CONCEPT_LINE_LENGTH = 60;

// A genuine concept title never trails off on a dangling function
// word the way a sentence wrapped mid-line does — this single check
// is cheap (one more pattern, not a new strategy) but removes a
// meaningful share of the sentence-fragment noise a real textbook's
// wrapped body paragraphs otherwise produce.
const DANGLING_WORD_ENDING_PATTERN = /\b(of|the|and|in|a|an|is|are|to|for|with|which|this|that|its|their|by|as|or|at|from|on)$/i;

function extractConceptsViaRegex(unitText) {
  const lines = (unitText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set();
  const concepts = [];

  for (const line of lines) {
    if (line.length > MAX_CONCEPT_LINE_LENGTH) continue; // reads as paragraph text, not a concept title
    if (/^\d+$/.test(line)) continue; // a bare page number
    if (BOILERPLATE_LINE_PATTERN.test(line)) continue;
    if (!/^[A-Z]/.test(line)) continue; // a real concept title reads like a heading, not a sentence fragment
    if (/[.:;,]$/.test(line)) continue; // ends like a sentence, not a title
    if (/\d/.test(line)) continue; // numbered sub-section labels ("3.1 Mirrors") aren't concept titles themselves
    if (DANGLING_WORD_ENDING_PATTERN.test(line)) continue; // a sentence wrapped mid-line, not a title

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push(line);
  }

  return concepts;
}
