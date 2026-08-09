/**
 * config/assessmentMarksColorConfig.js
 *
 * Colour-coding for the Assessment Gradebook (see
 * ui/views/AssessmentManagementView.js's renderGradebookStep()).
 *
 * No maximum-mark/threshold logic existed anywhere in Assessment
 * Management before this — confirmed by inspecting
 * models/AssessmentSubject.js (maximumMarks exists, but nothing reads
 * it for colour) and every existing marks-entry row
 * (renderEditableStudentRow() / renderReadOnlyStudentRow()) in
 * ui/views/AssessmentManagementView.js. This file is a new, isolated
 * threshold configuration, added specifically so gradebook cell
 * colours don't get scattered as hard-coded values throughout the
 * grid rendering code.
 *
 * Thresholds are plain percentages of the AssessmentSubject's own
 * maximumMarks — the only "maximum" concept that already exists in
 * this module. Ordered highest-first; getMarksColorClass() returns
 * the first threshold a score's percentage meets or exceeds.
 */

export const MARKS_COLOR_THRESHOLDS = Object.freeze([
  { minPercent: 75, className: 'gradebook-cell--high' },
  { minPercent: 50, className: 'gradebook-cell--mid' },
  { minPercent: 0, className: 'gradebook-cell--low' },
]);

/**
 * `marks` may be null (blank — no colour at all, distinct from a
 * genuine 0) or a number. `maximumMarks` must be a positive number;
 * returns null for anything that can't be meaningfully coloured.
 */
export function getMarksColorClass(marks, maximumMarks) {
  if (marks === null || marks === undefined) return null;
  if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) return null;

  const percent = (marks / maximumMarks) * 100;
  const threshold = MARKS_COLOR_THRESHOLDS.find((t) => percent >= t.minPercent);
  return threshold ? threshold.className : null;
}
