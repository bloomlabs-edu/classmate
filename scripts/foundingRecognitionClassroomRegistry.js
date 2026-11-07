/**
 * scripts/foundingRecognitionClassroomRegistry.js
 *
 * THE OPTION B CLASSROOM CLASSIFICATION REGISTRY — a small, version-
 * controlled, human-maintained record of which real classrooms have
 * actually been reviewed and confirmed as real vs. test/sandbox data,
 * keyed by stable classroom ID (never by name — see this file's own
 * header below). This file, and foundingRecognitionClassroomRegistry.json
 * next to it, are the ONLY place this classification lives. There is
 * deliberately NO Firestore collection, NO field on the Classroom
 * model, and NO production dependency introduced for this — a plain,
 * git-tracked JSON file gives every property actually needed here:
 *   - Auditability: every change to who-reviewed-what-and-when is a
 *     normal, reviewable git commit/diff, with no separate audit-log
 *     mechanism to build or trust.
 *   - No schema change: `js/models/Classroom.js` and the live
 *     Firestore `classrooms` collection are completely untouched.
 *   - No write path to production: this file is read, never written
 *     by any code in this repository — an administrator edits it by
 *     hand (or via a future, separately-authorized tool) and commits
 *     the change like any other code review.
 *
 * DELIBERATELY NEVER IMPORTED FROM `js/` — this is the one rule that
 * makes this design safe to put real reviewer identities in. Every
 * file under `js/` is, in this app, a plain static asset a browser
 * fetches directly (there is no bundler / tree-shaking step in this
 * codebase — see js/main.js's own module graph), so anything a `js/`
 * file statically imports becomes fetchable by any browser that can
 * reach the hosting site, authenticated or not. This registry contains
 * per-classroom reviewer names/emails and review rationale — real,
 * if modest, administrative metadata that has no business being
 * publicly fetchable just because one function in
 * services/notebookFoundingRecognitionService.js happens to need the
 * classification it implies. That service file therefore NEVER imports
 * this module (confirmed by its own header comment and by
 * ToolSearch/grep over js/ finding no reference to this filename
 * anywhere under that directory) — it only ever receives a plain
 * `classification` string (+ optional `classificationDetail` object)
 * as a parameter, computed by whichever Node-only caller (this
 * repository's scripts/, never `js/`) actually loaded this registry.
 *
 * STABLE IDS, NEVER NAMES — every key in foundingRecognitionClassroomRegistry.json's
 * own `entries` map is a classroom's own Firestore document id.
 * Classroom names are free-text, teacher-editable, and already
 * confirmed (via the organisation-wide audit this feature was built
 * from) to collide across genuinely different real classrooms and to
 * be ambiguous on their own ("Trial Bay Public School" is a real name
 * containing "Trial"); keying on name would silently misclassify the
 * wrong classroom the moment either of those happens. A classroom id
 * is stable for the document's entire lifetime and never reused.
 *
 * SAFE DEFAULTS — getClassroomClassification() below NEVER guesses:
 * an id absent from `entries`, an entry with no `classification`
 * field, or an entry whose `classification` value isn't EXACTLY one of
 * the three valid strings (imported from the service, the single
 * source of truth for those literals) all resolve to `NEEDS_REVIEW`,
 * identically. There is no partial-credit or "probably fine" state.
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { FOUNDING_RECOGNITION_CLASSIFICATIONS } from '../js/services/notebookFoundingRecognitionService.js';

const require = createRequire(import.meta.url);
const REGISTRY_JSON_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'foundingRecognitionClassroomRegistry.json');

const VALID_CLASSIFICATIONS = new Set(Object.values(FOUNDING_RECOGNITION_CLASSIFICATIONS));

/**
 * Reads the registry file fresh from disk every call (it is tiny, and
 * this avoids ever serving a stale in-memory copy across a long-running
 * process) and returns its `entries` map, defaulting to `{}` if the
 * file is missing, unreadable, or malformed at the top level — a
 * broken registry file must never crash the caller; it must simply
 * behave as though nothing has been reviewed yet (every classroom
 * resolves to NEEDS_REVIEW), the same safe-by-default principle this
 * entire registry is built on.
 */
export function loadFoundingRecognitionClassroomRegistry() {
  try {
    delete require.cache[require.resolve(REGISTRY_JSON_PATH)];
    const raw = require(REGISTRY_JSON_PATH);
    return raw && typeof raw.entries === 'object' && raw.entries !== null ? raw.entries : {};
  } catch (error) {
    return {};
  }
}

/** The raw registry entry for one classroom id, or null if absent -- never used directly for gating; see getClassroomClassification()/getClassroomClassificationDetail() below for the safe, validated reads. */
function getRawEntry(registry, classroomId) {
  return registry && typeof registry === 'object' ? registry[classroomId] ?? null : null;
}

/**
 * The one function anything gating on classification should call.
 * Returns exactly one of FOUNDING_RECOGNITION_CLASSIFICATIONS' three
 * values, NEVER anything else -- an unknown classroom id, a missing
 * `classification` field, or any value other than the two confirmed
 * states all resolve to NEEDS_REVIEW, identically and silently (no
 * guessing, no throwing -- a malformed entry is exactly as unreviewed
 * as no entry at all).
 */
export function getClassroomClassification(registry, classroomId) {
  const entry = getRawEntry(registry, classroomId);
  if (!entry || !VALID_CLASSIFICATIONS.has(entry.classification)) return FOUNDING_RECOGNITION_CLASSIFICATIONS.NEEDS_REVIEW;
  return entry.classification;
}

/** The classification plus its own human-reviewed reason/reviewer/timestamp, for display in a report -- the detail fields are null whenever the entry is absent or malformed, never fabricated. */
export function getClassroomClassificationDetail(registry, classroomId) {
  const entry = getRawEntry(registry, classroomId);
  const classification = getClassroomClassification(registry, classroomId);
  return {
    classification,
    reason: entry && typeof entry.reason === 'string' ? entry.reason : null,
    reviewedBy: entry && typeof entry.reviewedBy === 'string' ? entry.reviewedBy : null,
    reviewedAt: entry && typeof entry.reviewedAt === 'string' ? entry.reviewedAt : null,
  };
}

export { FOUNDING_RECOGNITION_CLASSIFICATIONS };
