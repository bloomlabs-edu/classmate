/**
 * config/gradeOptionsConfig.js
 *
 * The default Grade suggestions offered in a SearchableSelect (see
 * ui/components/SearchableSelect.js) — Grade 1 through Grade 12.
 * Custom grades outside this list remain fully supported; this is a
 * starting suggestion list, not an enforced enum. Pure data, no
 * logic, matching the same convention as
 * config/canonicalSubjectsConfig.js and config/assessmentTypesConfig.js.
 */

export const GRADE_OPTIONS = Object.freeze(
  Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)
);
