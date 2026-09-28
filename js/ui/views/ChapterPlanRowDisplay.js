/**
 * ui/views/ChapterPlanRowDisplay.js
 *
 * The Chapter Plans list row's own display logic — pure, no DOM, no
 * Firestore import, split into its own file for exactly the reason
 * ui/views/NotebookCheckpointsScoreCell.js's own header comment already
 * documents: ui/views/ChapterPlansListView.js itself imports
 * repositories/chapterPlanRepository.js, which transitively pulls in
 * the Firebase SDK from a `https://` URL Node's own ESM loader can't
 * resolve outside a browser — so this logic has to live somewhere that
 * DOESN'T import that view, or it could never be exercised by the
 * plain `node --test` suite at all (see tests/ui/chapterPlanRowDisplay.test.js).
 */

import { CHAPTER_PLAN_STATUS } from '../../models/ChapterPlan.js';
import { getChapterPlanTemplateConfig } from '../../config/chapterPlanTemplateConfig.js';

export const CHAPTER_PLAN_STATUS_LABELS = Object.freeze({
  [CHAPTER_PLAN_STATUS.DRAFT]: 'Draft',
  [CHAPTER_PLAN_STATUS.SUBMITTED]: 'Submitted',
  [CHAPTER_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [CHAPTER_PLAN_STATUS.APPROVED]: 'Approved',
});

/** The exact row text one Chapter Plan card shows: title, subject/grade/term meta, and status label. */
export function getChapterPlanRowDisplay(plan) {
  const subjectLabel = getChapterPlanTemplateConfig(plan.subjectId).label;
  const metaParts = [subjectLabel, plan.gradeLabel, plan.termId].filter(Boolean);
  return {
    title: plan.chapterName || 'Untitled Chapter Plan',
    meta: metaParts.join(' · '),
    statusLabel: CHAPTER_PLAN_STATUS_LABELS[plan.status] || plan.status,
  };
}
