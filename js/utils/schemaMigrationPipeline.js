/**
 * utils/schemaMigrationPipeline.js
 *
 * A generic, domain-agnostic sequential migration runner. Knows
 * nothing about Curriculum Indexes, Subjects, or any other specific
 * document shape — just "documents carry a schemaVersion; advance one
 * version at a time until the document is current." Built so any
 * future persisted domain (Assessments, Recognition Wall, Planner,
 * analytics, ...) can adopt the same versioned-migration pattern by
 * writing its own migration steps and calling this, rather than each
 * domain reinventing its own ad-hoc "if field X is missing" checks —
 * exactly the pattern that produced three separate, differently-shaped
 * migration fixes (Learning Management subjects, Curriculum Index
 * subjectId, Curriculum Index parts/units) before this file existed.
 *
 * `migrations` is an array of functions, indexed by the version they
 * migrate *from* — `migrations[0]` takes a document at schemaVersion 0
 * (or missing schemaVersion entirely, treated as 0) and must leave it
 * at schemaVersion 1; `migrations[1]` takes version 1 to version 2;
 * and so on. Each step sets `document.schemaVersion` itself — this
 * runner verifies that happened correctly rather than assuming it, so
 * a step that forgets to bump the version fails loudly instead of
 * looping forever or silently under-migrating.
 *
 * Adding a new schema version later means writing one new function and
 * appending it to the array — every earlier migration step stays
 * exactly as written, never edited to accommodate what comes after it.
 */

export function runSchemaMigrations(document, { migrations, latestVersion }) {
  let currentVersion = document.schemaVersion || 0;
  let migrated = false;

  while (currentVersion < latestVersion) {
    const step = migrations[currentVersion];
    if (!step) {
      throw new Error(
        `No migration step defined to advance schemaVersion ${currentVersion} toward ${latestVersion}. Every version from 0 up to (but not including) the latest needs a corresponding entry in the migrations array.`
      );
    }

    step(document);

    if (document.schemaVersion !== currentVersion + 1) {
      throw new Error(
        `Migration step for schemaVersion ${currentVersion} did not correctly advance schemaVersion to ${currentVersion + 1} (found ${document.schemaVersion} instead) — every migration step must set the next version itself.`
      );
    }

    currentVersion = document.schemaVersion;
    migrated = true;
  }

  return migrated;
}
