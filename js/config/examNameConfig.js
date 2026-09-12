/**
 * config/examNameConfig.js
 *
 * The predefined Exam Name registry — mirrors config/canonicalSubjectsConfig.js's
 * own "suggestion list of stable, reviewed values, plus a free-typed
 * escape hatch" shape, for the exact same reason: most exams a teacher
 * creates are one of a small, well-known set (the school's own term
 * structure), so offering that set directly beats re-typing "Quarterly
 * Examinations" correctly (and consistently) every single time.
 *
 * Deliberately plain strings, not `{id, title}` pairs like
 * CANONICAL_SUBJECTS — an exam's own `title` field
 * (models/ScheduledEvent.js) IS its display text; there is no separate
 * stable id anything else needs to key off (unlike Subject, where
 * `subjectId` has to stay stable across a differently-worded display
 * title). Picking one of these strings just sets `draft.title` to it
 * directly.
 *
 * `EXAM_NAME_CUSTOM_VALUE` is the sentinel `<option value>` the exam
 * form's own select uses for "Other" — never stored as a real title
 * itself, exactly like subjectSelect's own `'__custom__'` sentinel in
 * ui/views/TimetableView.js's openExamFormOverlay().
 */

export const EXAM_NAMES = Object.freeze([
  '1st Mid Term Examinations',
  '2nd Mid Term Examinations',
  '3rd Mid Term Examinations',
  'Quarterly Examinations',
  'Half Yearly Examinations',
  'Final Examinations',
]);

export const EXAM_NAME_CUSTOM_VALUE = '__custom__';
