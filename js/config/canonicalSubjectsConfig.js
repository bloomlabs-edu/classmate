/**
 * config/canonicalSubjectsConfig.js
 *
 * The canonical Subject registry — every {id, title} pair a teacher
 * can pick from a suggestion list, in either Curriculum Management's
 * "Subject" field or Learning Management's "Choose Subject" step.
 * This is the *only* thing that makes those two independently-typed
 * fields land on the same id: both screens offer the identical list,
 * so picking "Mathematics" in either one assigns the same
 * `subjectId: "mathematics"`. Nothing compares display strings to
 * decide that — the id is fixed the moment a suggestion is chosen,
 * before any comparison could ever happen.
 *
 * A subject typed as free text instead of chosen from this list gets
 * its own id, deterministically derived from what was actually typed
 * (see services/subjectIdentityService.js's generateCustomSubjectId())
 * — not matched against this list by string comparison, and not
 * "recognized" as one of these canonical subjects under a different
 * spelling. "Maths" typed as custom text and "Mathematics" chosen from
 * this list are, correctly, two different ids unless the teacher
 * picks the same suggestion both times. That's the whole fix: display
 * text was never a reliable key, so the architecture no longer asks
 * it to be one.
 */

export const CANONICAL_SUBJECTS = Object.freeze([
  Object.freeze({ id: 'science', title: 'Science' }),
  Object.freeze({ id: 'mathematics', title: 'Mathematics' }),
  Object.freeze({ id: 'english', title: 'English' }),
  Object.freeze({ id: 'social_science', title: 'Social Science' }),
  Object.freeze({ id: 'hindi', title: 'Hindi' }),
  Object.freeze({ id: 'computer_science', title: 'Computer Science' }),
  Object.freeze({ id: 'environmental_studies', title: 'Environmental Studies' }),
  Object.freeze({ id: 'art', title: 'Art' }),
]);
