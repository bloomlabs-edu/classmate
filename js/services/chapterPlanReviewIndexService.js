/**
 * services/chapterPlanReviewIndexService.js
 *
 * The Chapter Plan Review Index — a direct, field-renamed port of
 * services/weeklyPlanReviewIndexService.js's own shape and reasoning,
 * re-scoped to models/ChapterPlan.js. Reference-only, never a copy of a
 * ChapterPlan's own content (no purpose/mastery/methods/subjectSpecific/
 * resourceLinks/reviewHistory/activeComments ever appear here).
 *
 * Deliberately Firestore-free — mirrors
 * services/weeklyPlanReviewIndexService.js's OWN real shape exactly:
 * that file has no import of
 * repositories/weeklyPlanReviewIndexRepository.js at all, and neither
 * does this one, on purpose. Importing
 * repositories/chapterPlanReviewIndexRepository.js at module scope
 * (which itself imports the Firebase SDK from a `https://` URL) would
 * make this ENTIRE file fail to even load outside a browser, per
 * Node's ESM loader (`ERR_UNSUPPORTED_ESM_URL_SCHEME`) — confirmed by
 * testing directly (see services/sparkService.js's own header comment
 * for the identical finding). A caller (a future Phase 3+ UI) composes
 * this file's pure buildChapterPlanReviewIndexEntry() with
 * repositories/chapterPlanReviewIndexRepository.js's own
 * upsertChapterPlanReviewIndexEntry() itself — two separate calls,
 * immediately after persisting the mutated ChapterPlan via
 * repositories/chapterPlanRepository.js's own saveChapterPlan() — e.g.:
 *
 *   chapterPlanReviewService.submitChapterPlan(chapterPlan, { byUid });
 *   await chapterPlanRepository.saveChapterPlan(classroomId, chapterPlan);
 *   await chapterPlanReviewIndexRepository.upsertChapterPlanReviewIndexEntry(
 *     chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom, chapterPlan)
 *   );
 *
 * — called after EVERY review-lifecycle transition that changes what a
 * PM's queue should show (submit, resubmit, requestChapterPlanChanges,
 * approveChapterPlan), never after a plain content edit (a DRAFT plan
 * being edited doesn't change anything the queue cares about), and
 * never as a delete — an index entry for an APPROVED plan is
 * overwritten to reflect that, never removed, matching
 * firestore.rules' own `chapterPlanReviewIndex` block
 * (`allow delete: if false`).
 *
 * The canonical ChapterPlan document
 * (`classrooms/{classroomId}/chapterPlans/{chapterPlanId}`) remains the
 * ONE authoritative source for both content and status — this index is
 * a discovery aid only. Nothing in this file, or any caller of it,
 * should ever branch review logic (can this be approved? what does it
 * say?) on an index entry instead of the real ChapterPlan.
 */

import { getSubmissionLabel } from './chapterPlanReviewService.js';
import { CHAPTER_PLAN_STATUS } from '../models/ChapterPlan.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/**
 * The one reference-only document a Program Manager's future Chapter
 * Plans queue needs to discover and display this plan — never a copy of
 * its content. `teacherDisplayName` is denormalized purely to avoid an
 * extra classroom fetch per row in the common case, the same convention
 * services/weeklyPlanReviewIndexService.js's own buildReviewIndexEntry()
 * already uses. `submissionLabel` is computed here, at write time, from
 * the real `chapterPlan.reviewHistory` via
 * services/chapterPlanReviewService.js's own getSubmissionLabel() —
 * reused, never reimplemented — so the queue can show "Submitted" vs
 * "Resubmitted" without this index ever storing the reviewHistory
 * itself.
 *
 * Phase 4 addition: `gradeLabel`/`termId` — the PM queue's own required
 * display columns (grade, term), copied straight through from the real
 * plan the same reference-only way every other field here already is
 * (never re-derived, never a second identity system). Still nothing
 * about a plan's actual CONTENT (purpose/mastery/methods/subjectSpecific/
 * resourceLinks/sparkRefs/reviewHistory/activeComments) appears here —
 * only the fields a queue row needs to be useful before opening the
 * real thing.
 */
export function buildChapterPlanReviewIndexEntry(classroom, chapterPlan) {
  return {
    chapterPlanId: chapterPlan.id,
    classroomId: classroom.id,
    createdByUid: chapterPlan.createdByUid,
    teacherDisplayName: classroom.members?.[chapterPlan.createdByUid]?.displayName || 'A teacher',
    subjectId: chapterPlan.subjectId,
    chapterName: chapterPlan.chapterName,
    gradeLabel: chapterPlan.gradeLabel,
    termId: chapterPlan.termId,
    status: chapterPlan.status,
    submissionLabel: getSubmissionLabel(chapterPlan),
    updatedAt: chapterPlan.updatedAt || getCurrentIsoDate(),
  };
}

/** Only SUBMITTED entries are ever a Program Manager's own work item — same reasoning services/weeklyPlanReviewIndexService.js's own filterEntriesNeedingReview() already documents (CHANGES_REQUESTED is the Fellow's own turn to act; DRAFT/APPROVED aren't awaiting anyone). */
export function filterChapterPlanEntriesNeedingReview(entries) {
  return entries.filter((entry) => entry.status === CHAPTER_PLAN_STATUS.SUBMITTED);
}

/** Newest-updated first — same ordering convention every sibling review queue in this app already uses. */
export function sortChapterPlanReviewIndexEntries(entries) {
  return [...entries].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/**
 * Whether an already-fetched index `entry` has drifted out of sync with
 * the REAL ChapterPlan it claims to describe — the one check a caller
 * should make before trusting an entry for anything beyond "should this
 * row even render." This is what "tolerate/recover from an absent or
 * stale index" actually means here: a caller that finds `stale: true`
 * (or no entry at all — `entry` may be `null`/`undefined`) should treat
 * the real `chapterPlan` (already in hand — this function takes it as
 * an argument, never fetches anything itself) as truth, and either
 * render from it directly or re-sync the index (build a fresh entry and
 * upsert it — see this file's own header comment for that composition),
 * never surface or act on stale/missing index values. Any real review
 * action (request changes, approve) always operates on the canonical
 * ChapterPlan document directly (see
 * services/chapterPlanReviewService.js), never on this index — a
 * missing or stale entry is a queue-display gap, never a blocker to
 * anything a Fellow or reviewer actually needs to do.
 */
export function isChapterPlanReviewIndexEntryStale(entry, chapterPlan) {
  if (!entry) return true;
  return entry.status !== chapterPlan.status || entry.createdByUid !== chapterPlan.createdByUid || entry.updatedAt !== chapterPlan.updatedAt;
}
