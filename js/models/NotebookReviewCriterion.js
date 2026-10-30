/**
 * models/NotebookReviewCriterion.js
 *
 * One reusable, teacher-managed criterion a Notebook review can check
 * off — stored as the catalog at `classroom.notebookConfig.reviewCriteria`
 * (see services/notebookConfigService.js), the exact same "flat array on
 * notebookConfig, self-generated id" convention NotebookSubject/
 * NotebookType already use. A criterion is a reusable DEFINITION, never
 * recreated per notebook — what gets recorded per submission is a
 * models/NotebookReview.js `criteriaAwarded` entry that snapshots this
 * criterion's own `id`/`label` at award time, so renaming or removing a
 * criterion later never rewrites a past award's own meaning (the same
 * "references preserve relationships, snapshots preserve history"
 * principle models/WorkRequest.js's own curriculum snapshot fields
 * already follow).
 *
 * Every criterion is worth exactly one point when checked, zero when
 * not — there is no per-criterion point VALUE to configure, per the
 * product rule ("each checked criterion earns exactly one point").
 *
 * `isSystemDetermined` — true for exactly one seeded criterion ("Timely
 * submission"). Its checked/unchecked state is never teacher-chosen —
 * services/notebookReviewService.js computes it directly from the
 * submission date vs. the WorkRequest's own due date, and a caller's
 * own requested criterion ids are never trusted for this one id, even
 * if supplied — see that service's own header comment. This flag also
 * blocks removal from the catalog (removeReviewCriterion()) and is
 * never settable on a custom, teacher-added criterion.
 */

import { generateId } from '../utils/idGenerator.js';

export const TIMELY_SUBMISSION_CRITERION_KEY = 'timely_submission';

/**
 * Seeded once per classroom, lazily, the first time
 * services/notebookConfigService.js's own ensureReviewCriteria() runs
 * for it — never a migration, since a classroom with no
 * `reviewCriteria` at all yet (every classroom that predates this
 * feature) is a real, valid, un-migrated state.
 */
export const DEFAULT_NOTEBOOK_REVIEW_CRITERIA = Object.freeze([
  Object.freeze({ key: TIMELY_SUBMISSION_CRITERION_KEY, label: 'Timely submission', isSystemDetermined: true }),
  Object.freeze({ key: 'neat_handwriting', label: 'Neat handwriting', isSystemDetermined: false }),
  Object.freeze({ key: 'organization', label: 'Organization', isSystemDetermined: false }),
  Object.freeze({ key: 'punctuation_sentence_rules', label: 'Punctuation and sentence rules', isSystemDetermined: false }),
]);

export function createNotebookReviewCriterion({ id, label, isSystemDetermined = false, isCustom = false, createdAt } = {}) {
  return {
    id: id || generateId(),
    label,
    isSystemDetermined,
    isCustom,
    createdAt: createdAt || null,
  };
}
