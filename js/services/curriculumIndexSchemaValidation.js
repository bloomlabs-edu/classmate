/**
 * services/curriculumIndexSchemaValidation.js
 *
 * Defines what a *valid* Curriculum Index looks like right now,
 * independent of schemaVersion — the deliberate sibling of
 * services/curriculumIndexMigrationService.js, not a replacement for
 * it. See utils/schemaValidationPipeline.js's own header comment for
 * the full reasoning on why these are two distinct concerns.
 *
 * This exists specifically to catch a document whose schemaVersion
 * claims "current" but doesn't actually have the fields that implies
 * — a case the migration pipeline structurally cannot catch on its
 * own, since it trusts schemaVersion by design and stops advancing
 * once a document reads as already current. Migration remains
 * unchanged and schemaVersion remains fully authoritative for version
 * transitions; this file only ever asks "is the shape right, here and
 * now," never "what version is this."
 *
 * Deliberately not calling back into
 * curriculumIndexMigrationService.js's migration steps to perform
 * repairs, even where the repair looks similar (e.g. both end up
 * setting `parts = []` for a missing array) — that would blur exactly
 * the boundary this was built to keep distinct. This file owns its
 * own repair logic, independently.
 */

import { validateAndRepairSchema } from '../utils/schemaValidationPipeline.js';
import { resolveHistoricalSubjectId } from './subjectIdMigrationService.js';

const VALIDATORS = [
  {
    check: (index) => Array.isArray(index.parts),
    repair: (index) => {
      index.parts = [];
    },
  },
  {
    check: (index) => Array.isArray(index.units),
    repair: (index) => {
      index.units = [];
    },
  },
  {
    check: (index) => typeof index.curriculum?.subjectId === 'string' && index.curriculum.subjectId.length > 0,
    repair: (index) => {
      index.curriculum.subjectId = resolveHistoricalSubjectId(index.curriculum.subject);
    },
  },
];

/**
 * Validates a Curriculum Index against the current schema's real
 * structural requirements and repairs anything that violates them —
 * called after migration, as its own separate step, by
 * services/curriculumIndexRepository.js's getIndex(), listIndexes(),
 * and createIndex(). Returns whether anything was actually repaired,
 * so the repository knows whether the document needs saving again.
 */
export function validateAndRepairCurriculumIndex(index) {
  return validateAndRepairSchema(index, VALIDATORS);
}
