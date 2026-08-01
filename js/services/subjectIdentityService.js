/**
 * services/subjectIdentityService.js
 *
 * The one place a Subject's canonical `subjectId` is ever assigned —
 * at the moment a teacher chooses or types a subject name, in either
 * Curriculum Management or Learning Management. After that moment,
 * nothing anywhere in the app compares subject text again; every
 * linking or filtering operation (see
 * services/curriculumLinkingService.js's
 * findAvailableCurriculumIndexesForSubject()) compares `subjectId`
 * values that were already decided here, once, at creation time.
 *
 * Two ways an id gets assigned:
 *
 * 1. Chosen from config/canonicalSubjectsConfig.js's own list — the
 *    id is exactly whatever that entry's `id` already is. This is the
 *    only way two independently-created things (a Curriculum Index's
 *    subject and a Learning Management Subject) reliably end up with
 *    the same id: both screens present the identical canonical list,
 *    so picking "Mathematics" in either one assigns
 *    `subjectId: "mathematics"` in both. See getCanonicalSubjects().
 *
 * 2. Typed as free text ("Custom Subject" / "e.g. Science" with
 *    something not on the list) — generateCustomSubjectId() derives
 *    an id purely from what was typed, deterministically, so typing
 *    the exact same text twice produces the exact same id. This is
 *    NOT an attempt to recognize that "Maths" and "Mathematics" mean
 *    the same thing — it deliberately does no such recognition. Two
 *    different spellings of the same subject typed as free text get
 *    two different ids, correctly, because nothing here is allowed to
 *    guess that they're related. The canonical list above is the only
 *    sanctioned way to get a shared id across screens.
 */

import { CANONICAL_SUBJECTS } from '../config/canonicalSubjectsConfig.js';

/** Every canonical subject, for rendering a suggestion list. Pure data passthrough — callers pick one of these entries directly, they don't search or match against it. */
export function getCanonicalSubjects() {
  return CANONICAL_SUBJECTS;
}

/** The canonical entry for a given id, or null. Used to display a canonical subject's own default title, e.g. when rendering a suggestion row. */
export function getCanonicalSubjectById(subjectId) {
  return CANONICAL_SUBJECTS.find((s) => s.id === subjectId) || null;
}

/**
 * Deterministic, one-way: the same typed text always produces the
 * same id, so a teacher typing "French" as a custom subject in two
 * different places still ends up with matching ids for that specific
 * spelling — without maintaining any table of what's "the same as"
 * what. Strips to lowercase alphanumerics joined by underscores; falls
 * back to a generated id only if the text contains nothing usable
 * (e.g. typed entirely in a script this can't transliterate).
 */
export function generateCustomSubjectId(freeTypedTitle) {
  const slug = freeTypedTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || `custom_${Math.random().toString(36).slice(2, 10)}`;
}
