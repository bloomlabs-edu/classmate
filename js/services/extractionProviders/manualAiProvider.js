/**
 * services/extractionProviders/manualAiProvider.js
 *
 * The first ExtractionProvider implementation (see
 * extractionProviderRegistry.js for the contract every provider
 * follows). A teacher copies a generated prompt into their own AI
 * assistant of choice (Claude, ChatGPT, Gemini, or any other), then
 * pastes the result back here to be parsed — this app has no
 * server-side AI integration anywhere, so this is the honest, correct
 * shape for extraction today, not a placeholder standing in for a
 * missing automated call.
 *
 * `requiresManualInput: true` is the one thing that distinguishes
 * this provider's shape from a future automated one (a future
 * openai/claude/gemini provider would set this `false`, call its own
 * API inside extract(), and never need a pasted-text step at all) —
 * see this file's own extract() for exactly where that branch
 * matters.
 */

import { parseConceptImportFormat } from '../conceptImportFormatService.js';

export const id = 'manual-ai';
export const label = 'Manual (Copy/Paste to AI Assistant)';
export const requiresManualInput = true;

/**
 * Builds the exact prompt text a teacher copies into their own AI
 * assistant. `unitContext` is
 * `{ curriculumName, grade, subject, unitTitle, startPage, endPage, pageText }`
 * — `pageText` is that Unit's own extracted PDF text (see
 * services/unitSegmentationService.js), embedded directly in the
 * prompt so the teacher never has to separately attach or describe
 * which pages they mean.
 */
export function buildPrompt({ curriculumName, grade, subject, unitTitle, startPage, endPage, pageText }) {
  return [
    'Convert the following textbook pages into this exact format. Output ONLY this format \u2014 no markdown, no JSON, no explanations, no additional commentary before or after.',
    '',
    'Format:',
    'CURRICULUM: <curriculum name>',
    'GRADE: <grade>',
    'SUBJECT: <subject>',
    '',
    'UNIT: <unit title>',
    'START_PAGE: <start page>',
    'END_PAGE: <end page>',
    '',
    '<number>|<concept title>|<start page>-<end page>',
    '(one line per concept, in the order they appear in the textbook \u2014 do not reorder by importance, do not nest or create sub-concepts)',
    '',
    'A concept represents one teachable idea with one central learning focus (e.g. "Force", "Pressure", "Atmospheric Pressure") \u2014 never a lesson-plan or activity description (e.g. "Understanding Force Through Activities", "Complete the Worksheet").',
    '',
    'Example output:',
    'CURRICULUM: Samacheer Kalvi',
    'GRADE: 8',
    'SUBJECT: Science',
    '',
    'UNIT: Force and Pressure',
    'START_PAGE: 42',
    'END_PAGE: 56',
    '',
    '1|Force|42-43',
    '2|Effects of Force|44-46',
    '3|Pressure|47-49',
    '4|Factors Affecting Pressure|50-53',
    '5|Applications of Pressure|54-56',
    '',
    '---',
    '',
    `CURRICULUM: ${curriculumName}`,
    `GRADE: ${grade}`,
    `SUBJECT: ${subject}`,
    '',
    `UNIT: ${unitTitle}`,
    `START_PAGE: ${startPage}`,
    `END_PAGE: ${endPage}`,
    '',
    'Textbook pages:',
    '',
    pageText,
  ].join('\n');
}

/**
 * Parses a teacher's pasted response. `pastedText` is required for
 * this provider (see requiresManualInput above) \u2014 a future
 * automated provider's own extract() would ignore any `pastedText`
 * entirely and call its own API instead, but still return this exact
 * same `{ concepts, errors, metadata }` shape, so every caller
 * downstream (see the Concept Review stage) stays provider-agnostic.
 *
 * `metadata` (the parsed CURRICULUM:/GRADE:/SUBJECT:/UNIT:/START_PAGE:/
 * END_PAGE: header) is returned, not discarded, specifically so a
 * caller can validate a teacher actually pasted the response for
 * *this* Unit \u2014 e.g. confirming metadata.unit roughly matches
 * unitContext.unitTitle \u2014 catching a wrong-Unit paste before it's
 * imported, not after.
 */
export async function extract(unitContext, { pastedText } = {}) {
  if (!pastedText || !pastedText.trim()) {
    throw new Error('ManualAIProvider.extract() requires pastedText \u2014 this provider has no automated call of its own.');
  }

  return parseConceptImportFormat(pastedText);
}
