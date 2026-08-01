/**
 * services/curriculumIndexMigrationService.js
 *
 * The versioned migration pipeline for Curriculum Index documents,
 * built on utils/schemaMigrationPipeline.js's generic runner. Replaces
 * the earlier one-off `migrateCurriculumIndex` (which only knew how to
 * backfill `subjectId`) after a real, reproduced bug showed a second,
 * unrelated field could *also* be missing on old documents
 * (`parts`/`units` — see the investigation that led here). Rather than
 * add a second scattered check for that too, this is a proper
 * migration chain: every schema change from now on is one more
 * function appended to MIGRATIONS, never an edit to an earlier one.
 *
 *   schemaVersion 0 (or missing entirely) -> 1: parts/units guaranteed present
 *   schemaVersion 1 -> 2: curriculum.subjectId guaranteed present
 *
 * `LATEST_SCHEMA_VERSION` is exported so
 * services/curriculumIndexRepository.js's createIndex() can stamp a
 * brand-new document with it directly — a document that starts life
 * already at the latest version needs no migration at all the first
 * time it's read back, which is the actual meaning of "every
 * Curriculum Index conforms to the latest schema before any UI
 * receives it": true from the moment of creation, not only after a
 * repair pass.
 *
 * Migration steps live here, not in
 * services/subjectIdMigrationService.js, since this pipeline now owns
 * *every* structural fix a Curriculum Index has ever needed, not just
 * the subjectId one — but the subjectId step reuses that file's own
 * resolveHistoricalSubjectId() rather than duplicating the
 * historical-spelling judgment call in two places.
 */

import { runSchemaMigrations } from '../utils/schemaMigrationPipeline.js';
import { resolveHistoricalSubjectId } from './subjectIdMigrationService.js';

export const LATEST_SCHEMA_VERSION = 2;

/** v0 -> v1: guarantees parts/units exist, as empty arrays if genuinely absent. This is the actual fix for the reproduced crash — documents predating the point where createIndex() guaranteed these together are now repaired at the boundary, not defended against in every view that reads them. */
function migrateToV1(index) {
  if (!Array.isArray(index.parts)) index.parts = [];
  if (!Array.isArray(index.units)) index.units = [];
  index.schemaVersion = 1;
}

/** v1 -> v2: guarantees curriculum.subjectId exists, using the same historical-spelling judgment call already established for Learning Management Subjects. Never touches curriculum.subject (the display title) itself. */
function migrateToV2(index) {
  if (!index.curriculum.subjectId) {
    index.curriculum.subjectId = resolveHistoricalSubjectId(index.curriculum.subject);
  }
  index.schemaVersion = 2;
}

// Indexed by the version each step migrates *from* — MIGRATIONS[0] is
// the v0->v1 step, MIGRATIONS[1] is v1->v2, and so on. Add a new
// version by appending one more function here and bumping
// LATEST_SCHEMA_VERSION; never edit an existing entry to accommodate
// a later one.
const MIGRATIONS = [migrateToV1, migrateToV2];

/**
 * Advances one Curriculum Index document through every migration step
 * it hasn't already been through, in order, until it's fully current.
 * Idempotent: a document already at LATEST_SCHEMA_VERSION runs zero
 * steps and this returns false. Called from
 * services/curriculumIndexRepository.js's getIndex() and
 * listIndexes() — the two places every Curriculum Index this app ever
 * reads passes through — so views and services never need to check
 * for or migrate a missing field themselves.
 */
export function migrateCurriculumIndex(index) {
  return runSchemaMigrations(index, { migrations: MIGRATIONS, latestVersion: LATEST_SCHEMA_VERSION });
}
