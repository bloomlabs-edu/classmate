/**
 * config/assessmentMarksColorConfig.js
 *
 * Colour-coding for the Assessment Gradebook (see
 * ui/views/AssessmentManagementView.js's renderGradebookStep()).
 *
 * Thresholds are plain percentages of the AssessmentSubject's own
 * maximumMarks — the only "maximum" concept that already exists in
 * this module. Ordered highest-first; getMarksColorClass() returns
 * the first threshold a score's percentage meets or exceeds.
 *
 * These specific values (36 / 70) are not arbitrary — confirmed by
 * direct inspection before changing them: this module's own percent
 * cell (see AssessmentManagementView.js's own renderGradebookStep())
 * already calls getMarksColorClass(percent, 100), reusing this exact
 * same config — so subject cells and the overall percentage column
 * were never independent, and updating these two values updates both
 * consistently, with no separate system needed. For the current
 * /50 subjects, a pass mark of 18 is exactly 36% (18/50), and the
 * green boundary of 35 is exactly 70% (35/50) — expressing the
 * thresholds as percentages, rather than hardcoding 18/35 as
 * absolute numbers, is what makes this genuinely proportional to a
 * different subject maximum in the future, per explicit product
 * requirement, while exactly reproducing 18/35 for today's /50 case.
 */

export const MARKS_COLOR_THRESHOLDS = Object.freeze([
  { minPercent: 70, className: 'gradebook-cell--high' },
  { minPercent: 36, className: 'gradebook-cell--mid' },
  { minPercent: 0, className: 'gradebook-cell--low' },
]);

/**
 * The pass-mark threshold, expressed the same proportional way as
 * MARKS_COLOR_THRESHOLDS above — 36% of a subject's own maximumMarks,
 * not a hardcoded "18". For a /50 subject this is exactly 18.
 */
export const PASS_MARK_PERCENT = 36;

export function getPassMarkForSubject(maximumMarks) {
  if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) return null;
  return Math.round(maximumMarks * (PASS_MARK_PERCENT / 100) * 100) / 100;
}

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

/** Which of the three buckets a mark falls into, by key rather than CSS class — used by the Gradebook's own bucket filter. Returns null for an unscoreable mark, matching getMarksColorClass()'s own contract. */
export function getMarksBucketKey(marks, maximumMarks) {
  const className = getMarksColorClass(marks, maximumMarks);
  if (className === 'gradebook-cell--high') return 'green';
  if (className === 'gradebook-cell--mid') return 'yellow';
  if (className === 'gradebook-cell--low') return 'red';
  return null;
}

