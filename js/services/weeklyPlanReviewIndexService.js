/**
 * services/weeklyPlanReviewIndexService.js
 *
 * Pure logic for the Weekly Plan Review Index — deliberately Firestore-
 * free (no import of repositories/weeklyPlanReviewIndexRepository.js
 * here), same "stays directly unit-testable" convention
 * services/teachingIdeasService.js's own header comment already
 * documents for the identical reason: every function here takes plain
 * data in and returns plain data out; a caller that needs both pure
 * logic and the actual Firestore write imports both itself (see
 * ui/views/LessonPlanBuilderView.js's submitForReview() and
 * ui/views/LessonPlanReviewView.js's onRequestChanges()/onApprove(),
 * the three places a LessonPlan's status actually changes).
 *
 * Reference-only, by design: `buildReviewIndexEntry()` below never
 * includes `activities`, `objectives`, `assessments`, `spark`,
 * `pairExplanation`/`finalQuestion`/`teacherLookFors`, `reviewHistory`,
 * or `activeComments` — none of a LessonPlan's own content or comments
 * ever gets duplicated here. `submissionLabel` is the one derived value
 * this index DOES carry (a plain 'Submitted'/'Resubmitted' string, never
 * the reviewHistory it's derived from) — see this file's own
 * buildReviewIndexEntry() comment for why that one small exception is
 * necessary and safe.
 */

import { LESSON_PLAN_STATUS } from '../models/LessonPlan.js';
import { getSubmissionLabel } from './lessonPlanReviewService.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/**
 * The one reference-only document a Program Manager's Weekly Plans queue
 * needs to discover and display this LessonPlan — never a copy of its
 * content. `teacherDisplayName` is denormalized (same convention
 * services/teachingIdeasService.js's own buildTeachingIdeaProjection()
 * already uses) purely to avoid an extra classroom fetch per row in the
 * common case; the queue view still has the real classroom object in
 * hand (a Program Manager is a real classroom.members entry — see
 * config/memberRoles.js's own PROGRAM_MANAGER comment — so nothing here
 * is the *only* source of that name, just the cheaper one).
 *
 * `submissionLabel` (`'Submitted'` or `'Resubmitted'`) is computed here,
 * at write time, from the real `lessonPlan.reviewHistory` via the
 * existing services/lessonPlanReviewService.js's own getSubmissionLabel()
 * — reused, never reimplemented — specifically so the queue can show
 * that distinction (explicitly requested) without this index ever
 * storing the reviewHistory itself.
 */
export function buildReviewIndexEntry(classroom, lessonPlan) {
  return {
    lessonPlanId: lessonPlan.id,
    classroomId: classroom.id,
    createdByUid: lessonPlan.createdByUid,
    teacherDisplayName: classroom.members?.[lessonPlan.createdByUid]?.displayName || 'A teacher',
    subjectId: lessonPlan.subjectId,
    scheduledDate: lessonPlan.scheduledDate,
    status: lessonPlan.status,
    submissionLabel: getSubmissionLabel(lessonPlan),
    updatedAt: lessonPlan.updatedAt || getCurrentIsoDate(),
  };
}

/**
 * Only SUBMITTED entries are ever a Program Manager's own work item —
 * CHANGES_REQUESTED is the FELLOW's own turn to act, not the PM's (see
 * ui/views/ProgramManagerWeeklyPlansView.js's own header comment); DRAFT
 * and APPROVED entries are simply not awaiting anyone's review right
 * now. `getSubmissionLabel()`'s own 'Submitted'/'Resubmitted' distinction
 * (already persisted as `submissionLabel`, see buildReviewIndexEntry()
 * above) is what actually distinguishes a first submission from a
 * resubmission within this one filtered set — no second status value is
 * introduced here.
 */
export function filterEntriesNeedingReview(entries) {
  return entries.filter((entry) => entry.status === LESSON_PLAN_STATUS.SUBMITTED);
}

/** Newest-updated first — matches ui/views/LessonPlanReviewQueueView.js's own existing same-classroom queue ordering exactly, just applied across classrooms too. */
export function sortReviewIndexEntries(entries) {
  return [...entries].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
