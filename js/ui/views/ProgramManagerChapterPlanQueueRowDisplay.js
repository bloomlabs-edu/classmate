/**
 * ui/views/ProgramManagerChapterPlanQueueRowDisplay.js
 *
 * The PM Chapter Plan queue row's own display logic — pure, no DOM, no
 * Firestore import, split into its own file for the exact reason
 * ui/views/ChapterPlanRowDisplay.js's own header comment documents:
 * ui/views/ProgramManagerChapterPlanQueueView.js itself imports
 * repositories/chapterPlanReviewIndexRepository.js, which transitively
 * pulls in the Firebase SDK from a `https://` URL Node's own ESM loader
 * can't resolve outside a browser — this logic lives here instead so
 * tests/ui/programManagerChapterPlanQueueRowDisplay.test.js can
 * exercise it directly.
 */

import { getChapterPlanTemplateConfig } from '../../config/chapterPlanTemplateConfig.js';
import { formatDate } from '../../utils/dateHelpers.js';

function getClassroomName(classroom) {
  return classroom?.name || 'A classroom';
}

/** Every real display field one queue row needs, derived purely from an already-fetched chapterPlanReviewIndex entry (and, optionally, the classroom it names) — no canonical ChapterPlan fetch per row, per this feature's own "thin index, not a second source of truth" design. */
export function getChapterPlanQueueRowDisplay(entry, classroom) {
  const subjectLabel = getChapterPlanTemplateConfig(entry.subjectId).label;
  const metaParts = [getClassroomName(classroom), subjectLabel, entry.gradeLabel, entry.termId].filter(Boolean);
  return {
    authorName: entry.teacherDisplayName || 'A teacher',
    meta: metaParts.join(' · '),
    chapterName: entry.chapterName || 'Untitled Chapter Plan',
    statusLabel: entry.submissionLabel || 'Submitted',
    submittedDateLabel: entry.updatedAt ? formatDate(entry.updatedAt) : null,
  };
}
