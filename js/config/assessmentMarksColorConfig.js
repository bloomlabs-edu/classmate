/**
 * config/assessmentMarksColorConfig.js
 *
 * Colour-coding for the Assessment Gradebook (see
 * ui/views/AssessmentManagementView.js's renderGradebookStep()).
 *
 * ROOT-CAUSE FIX (this round): this file used to classify Red/Yellow/
 * Green from a STATIC, hardcoded MARKS_COLOR_THRESHOLDS array
 * (`{ minPercent: 36, ... }`) that was completely disconnected from a
 * specific Assessment's own edited `passMarkPercent` — so an
 * Assessment whose teacher had explicitly set Pass Mark to 35% would
 * still classify a 35% mark as Red, because 35 < the OLD hardcoded 36
 * threshold, even though "35% meets this Assessment's own Pass Mark"
 * is exactly a passing, Yellow score. MARKS_COLOR_THRESHOLDS has been
 * removed entirely; the Red/Yellow boundary is now always the
 * CALLER'S passed-in `passMarkPercent` (defaulting to PASS_MARK_PERCENT
 * below for a never-edited Assessment), never a second, independent
 * hardcoded value that could drift out of sync with it again.
 *
 * THE CONFIRMED BUSINESS RULE (three bands, percentage-based, of the
 * AssessmentSubject's own maximumMarks — never raw marks compared
 * directly to a percentage):
 *
 *   RED    ("Needs Help"):  percent <  passMarkPercent
 *   YELLOW ("Developing"):  passMarkPercent <= percent < GREEN_THRESHOLD_PERCENT
 *   GREEN  ("Strong"):      percent >= GREEN_THRESHOLD_PERCENT
 *
 * Pass/Fail and bucket colour are two SEPARATE, explicit comparisons
 * against the same `passMarkPercent` — Pass/Fail is never derived by
 * checking bucket colour, and bucket colour is never derived from a
 * generic pass/fail boolean (see services/assessmentService.js's own
 * getStudentOutcome(), which makes the identical `percent >=
 * passMarkPercent` comparison independently, for the identical
 * reason: two call sites computing the same fact from the same two
 * numbers, never one deriving it from the other's already-classified
 * result).
 *
 * GREEN_THRESHOLD_PERCENT (70) is fixed and INDEPENDENT of
 * passMarkPercent — raising or lowering an Assessment's own Pass Mark
 * only ever moves the Red/Yellow boundary, never the Green one.
 */

/** The one fixed, Pass-Mark-independent boundary — Green always starts here, regardless of what any Assessment's own Pass Mark is set to. */
export const GREEN_THRESHOLD_PERCENT = 70;

/**
 * The system-wide default Pass Mark — used only when an Assessment has
 * never had its own `passMarkPercent` explicitly edited (see
 * models/Assessment.js's own header comment, and
 * services/assessmentService.js's own getPassMarkPercent()).
 */
export const PASS_MARK_PERCENT = 36;

/**
 * `passMarkPercent` — optional override for a specific Assessment's own
 * edited Pass Mark (see models/Assessment.js's own `passMarkPercent`
 * field); defaults to the system-wide PASS_MARK_PERCENT so every
 * existing call site (and every Assessment that has never had its Pass
 * Mark edited) keeps behaving exactly as before.
 */
export function getPassMarkForSubject(maximumMarks, passMarkPercent = PASS_MARK_PERCENT) {
  if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) return null;
  return Math.round(maximumMarks * (passMarkPercent / 100) * 100) / 100;
}

/**
 * `marks` may be null (blank — no colour at all, distinct from a
 * genuine 0) or a number. `maximumMarks` must be a positive number;
 * returns null for anything that can't be meaningfully coloured.
 * `passMarkPercent` — see this file's own header comment for the full
 * rule; defaults to the system-wide PASS_MARK_PERCENT for a caller
 * that hasn't resolved a specific Assessment's own value (e.g. an
 * unscoped test or a future non-Assessment context).
 */
export function getMarksColorClass(marks, maximumMarks, passMarkPercent = PASS_MARK_PERCENT) {
  if (marks === null || marks === undefined) return null;
  if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) return null;

  const percent = (marks / maximumMarks) * 100;
  if (percent >= GREEN_THRESHOLD_PERCENT) return 'gradebook-cell--high';
  if (percent >= passMarkPercent) return 'gradebook-cell--mid';
  return 'gradebook-cell--low';
}

/** Which of the three buckets a mark falls into, by key rather than CSS class — used by the Gradebook's own bucket filter. Returns null for an unscoreable mark, matching getMarksColorClass()'s own contract. */
export function getMarksBucketKey(marks, maximumMarks, passMarkPercent = PASS_MARK_PERCENT) {
  const className = getMarksColorClass(marks, maximumMarks, passMarkPercent);
  if (className === 'gradebook-cell--high') return 'green';
  if (className === 'gradebook-cell--mid') return 'yellow';
  if (className === 'gradebook-cell--low') return 'red';
  return null;
}

/**
 * Human labels for an assessment-PERFORMANCE bucket — distinct wording
 * from config/bucketConfig.js's own BUCKET_LABELS (which name the
 * teacher-assigned Learning Bucket, a separate concept — see
 * ui/components/StudentNameElement.js's own `performanceBucketKey`
 * header comment). These exact words ("Needs Help" / "Developing" /
 * "Strong") already appear as the bucket legend's own description text
 * in both ui/views/ScorecardView.js's renderLegend() and
 * ui/views/AssessmentManagementView.js's renderBucketLegend() — this
 * just gives that same established wording a shared, reusable home
 * rather than a third place inventing it again.
 */
export const PERFORMANCE_BUCKET_LABELS = Object.freeze({
  green: 'Strong',
  yellow: 'Developing',
  red: 'Needs Help',
});

export const NOT_ASSESSED_LABEL = 'Not Assessed';

/** `bucketKey` — see getMarksBucketKey()'s own return contract; null (or any other unrecognised key) always reads as "Not Assessed", never silently as Red. */
export function getPerformanceBucketLabel(bucketKey) {
  return bucketKey ? PERFORMANCE_BUCKET_LABELS[bucketKey] || NOT_ASSESSED_LABEL : NOT_ASSESSED_LABEL;
}
