/**
 * config/commonSubjectsConfig.js
 *
 * The curated, clickable options ui/components/SubjectPicker.js offers
 * before falling back to free text — see that file's own doc comment
 * for why Subjects specifically get this treatment (a genuine common
 * vocabulary across grades and curricula) while Units and Concepts
 * don't (too curriculum-specific for any fixed list to make sense).
 *
 * Deliberately short and generic rather than exhaustive — "Other"
 * exists precisely so this list doesn't need to cover everything.
 *
 * No logic here, only data — same convention as
 * config/resourceTypeConfig.js and config/learningRecordConfig.js.
 */

export const COMMON_SUBJECTS = Object.freeze([
  'Science',
  'Mathematics',
  'English',
  'Social Science',
  'Hindi',
  'Computer Science',
  'Environmental Studies',
  'Art',
]);
