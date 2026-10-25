/**
 * services/worksheetCodeService.js
 *
 * Generates models/Assignment.js's own `code` field (e.g.
 * "WS-SCI-U12-01") automatically — a teacher never types one. See that
 * model's own `code` field comment for why this is a DISPLAY identifier
 * only, generated once at creation and never regenerated, sitting
 * alongside (never replacing) the assignment's own stable internal
 * `id`.
 *
 * MODEL DECISION (per explicit task instruction to "choose the least
 * disruptive model... and document the decision"): a code identifies
 * ONE CLASSROOM ASSIGNMENT, not a reusable worksheet resource shared
 * across classrooms. Reasoning: models/Assignment.js records already
 * live per-classroom (`classroom.assignments`), with no existing
 * cross-classroom worksheet-resource registry anywhere in this
 * codebase (confirmed by inspection — the only cross-classroom-reusable
 * content is Curriculum Library material, a completely different
 * system with its own id scheme, never referenced by Assignment). Every
 * existing per-classroom reference convention this model already uses
 * (`subjectId`, `conceptIds` — see that model's own header comment)
 * resolves live against THIS classroom's own data. Introducing a
 * second, cross-classroom resource layer just for a display code would
 * be strictly more disruptive than this: a new collection, a new
 * reference direction, and a new reconciliation question ("what happens
 * when two classrooms' own copies of the 'same' resource diverge?")
 * that nothing in the existing architecture needs answered. A
 * per-classroom code, scoped and sequenced within this classroom's own
 * Subject/Unit, is the direct, minimal extension of the model that
 * already exists.
 *
 * SUBJECT ABBREVIATION — reuses services/subjectIdentityService.js's
 * own canonical subject registry (config/canonicalSubjectsConfig.js)
 * rather than inventing a new abbreviation table: a Subject chosen from
 * that canonical list derives its abbreviation from its own stable
 * `subjectId` (e.g. "science" -> "SCI"), so two classrooms' own
 * "Science" subjects always abbreviate identically. A free-typed,
 * non-canonical Subject (or no Subject at all) falls back to its own
 * display title (or the Assignment's own category name, or a final
 * generic fallback) — never blocking code generation on a Subject
 * being picked, since Subject itself is optional on Assignment.
 */

import { getSubjectById, getUnitById } from './learningRecordService.js';

const CODE_PREFIX = 'WS';
const FALLBACK_ABBREVIATION = 'GEN';

function abbreviate(text) {
  const letters = (text || '').replace(/[^a-zA-Z]/g, '');
  return letters.length > 0 ? letters.slice(0, 3).toUpperCase() : FALLBACK_ABBREVIATION;
}

function resolveSubjectAbbreviation(classroom, subjectId) {
  const subject = subjectId ? getSubjectById(classroom, subjectId) : null;
  if (!subject) return null;
  // `subject.subjectId` is the canonical subject-TYPE id (e.g.
  // "science"), stable across every classroom that picked the same
  // canonical suggestion — see models/LearningSubject.js's own header
  // comment. Abbreviating that (not the free-text `title`) is what
  // keeps two classrooms' own "Science" subjects landing on the same
  // "SCI" prefix even if one teacher typed "Science" and another
  // "science" with different casing.
  return abbreviate(subject.subjectId || subject.title);
}

function resolveUnitPart(classroom, unitId) {
  const unit = unitId ? getUnitById(classroom, unitId) : null;
  if (!unit || unit.number == null) return null;
  return `U${unit.number}`;
}

/**
 * The next available code for this exact (Subject, Unit) scope (or
 * Category, when no Subject is set — see header comment) — scanning
 * every existing Assignment classroom-wide whose own `code` already
 * starts with this scope's own prefix, so a deleted-then-recreated
 * Assignment, or one created out of order, can never collide with an
 * existing code (see models/Assignment.js's own "code is generated
 * once, never regenerated" rule for why this must stay collision-safe
 * even as Assignments come and go in any order).
 */
export function generateWorksheetCode(classroom, { subjectId = null, unitId = null, categoryName = null } = {}) {
  const subjectAbbreviation = resolveSubjectAbbreviation(classroom, subjectId);
  const unitPart = subjectAbbreviation ? resolveUnitPart(classroom, unitId) : null;
  const abbreviation = subjectAbbreviation || abbreviate(categoryName);

  const prefix = [CODE_PREFIX, abbreviation, unitPart].filter(Boolean).join('-');

  const existingSequences = (classroom.assignments || [])
    .map((assignment) => assignment.code)
    .filter((code) => typeof code === 'string' && code.startsWith(`${prefix}-`))
    .map((code) => Number.parseInt(code.slice(prefix.length + 1), 10))
    .filter((n) => Number.isInteger(n));

  const nextSequence = existingSequences.length > 0 ? Math.max(...existingSequences) + 1 : 1;
  return `${prefix}-${String(nextSequence).padStart(2, '0')}`;
}
