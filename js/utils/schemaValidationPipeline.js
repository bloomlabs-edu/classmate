/**
 * utils/schemaValidationPipeline.js
 *
 * A generic, domain-agnostic validate-and-repair runner — the
 * deliberate sibling of utils/schemaMigrationPipeline.js, not a
 * replacement for it. The two answer genuinely different questions:
 *
 *   Migration:  "What schemaVersion is this document at, and what
 *                step advances it to the next version?" schemaVersion
 *                is the authoritative signal here — it decides which
 *                step runs, and stays authoritative for that job.
 *
 *   Validation: "Regardless of what schemaVersion claims, does this
 *                document actually have the shape the current schema
 *                requires, right now?" schemaVersion is never
 *                consulted here at all — every validator's `check`
 *                inspects the document's real fields directly. This
 *                is what catches a document whose schemaVersion says
 *                "current" but which doesn't actually conform (from a
 *                bug, a manual edit, or any other way the two could
 *                drift apart) — a case migration alone structurally
 *                cannot catch, since migration trusts schemaVersion by
 *                design and stops looking once it reads "current."
 *
 * `validators` is an array of { check(document) => boolean,
 * repair(document) => void } pairs. Each one owns exactly one
 * structural invariant of the *current* schema — not a historical
 * transition, not a version number, just "is this field the shape it
 * should be." Deliberately not the same code as any migration step,
 * even where the repair looks similar — this file has no idea what a
 * "schemaVersion 1" or "version 2" even means, and never rewinds or
 * reruns a historical migration to fix something found here.
 */

export function validateAndRepairSchema(document, validators) {
  let repaired = false;

  for (const validator of validators) {
    if (validator.check(document)) continue;
    validator.repair(document);
    repaired = true;
  }

  return repaired;
}
