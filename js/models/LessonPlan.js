/**
 * models/LessonPlan.js
 *
 * A teacher's structured lesson plan, built around the "5 Questions"
 * planning framework (see docs/LEARNING_RECORD.md's own sibling
 * reasoning for why a domain gets its own model rather than being
 * squeezed into an existing one): Why? / Self-Others-India? /
 * Assessment? / Fun-Fast-Effective? / Helping-each-other-learn?.
 *
 * Deliberately its OWN entity, not an extension of models/Lesson.js —
 * the Timetable's `Lesson` is a scheduled OCCURRENCE (one dated period,
 * `teachingSlotId`, taught/not-taught status); a LessonPlan is a
 * reusable, structured PLANNING DOCUMENT with its own review lifecycle.
 * Nothing here assumes a LessonPlan is ever attached to a specific
 * Timetable period — `curriculumUnitId`/`conceptIds` are the same kind
 * of optional context reference `Lesson` already uses, resolved live
 * against the same Curriculum tree, never copied.
 *
 * `activities[]` is the one part of this model that matters most: an
 * ordered list of real, structured, first-class objects (see
 * createLessonPlanActivity() below) — never spreadsheet rows or
 * independent text fields. Array position IS order, the same
 * "no separate order field" convention models/ReadingContent.js's own
 * `blocks[]` already established for exactly this reason (see that
 * file's own header comment) — moving, duplicating, or deleting an
 * Activity is array surgery on one list, so its whole structure always
 * moves/duplicates/deletes together, never leaving orphaned pieces
 * behind.
 *
 * Storage: one Firestore document per LessonPlan,
 * `classrooms/{classroomId}/lessonPlans/{lessonPlanId}` (see
 * services/lessonPlanRepository.js) — the same "own subcollection,
 * never embedded in the classroom document" convention already
 * established for Lessons/Resources/Activities, for the identical
 * reason: a growing library of lesson plans (each with real, possibly
 * long text content) is exactly the unbounded growth the classroom
 * document shouldn't have to absorb.
 *
 * Review lifecycle — `reviewHistory[]` is deliberately APPEND-ONLY,
 * never overwritten on resubmission (a real gap identified in this
 * app's own closest precedent, the Goals submit/approve/request-
 * changes flow — see services/studentGoalsService.js — whose
 * `setDoc()`-based resubmission silently loses the prior round's
 * feedback). A teacher revising after "changes requested" must never
 * silently lose what the reviewer originally said.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/** 'draft' -> 'submitted' -> 'approved', or 'submitted' -> 'changes_requested' -> 'draft' (revising) -> 'submitted' again. See services/lessonPlanReviewService.js for the one place these transitions are ever made. */
export const LESSON_PLAN_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  CHANGES_REQUESTED: 'changes_requested',
  APPROVED: 'approved',
});

/**
 * Every meaningful section a reviewer comment (see
 * `activeComments[].sectionKey` / `reviewHistory[].comments[].sectionKey`
 * below) can be addressed to. `activity:{activityId}` is built at
 * comment-creation time, not listed here (an activity's id isn't known
 * until it exists) — see lessonPlanReviewService.js's own
 * buildActivitySectionKey().
 */
export const LESSON_PLAN_SECTION_KEYS = Object.freeze({
  CONTEXT: 'context', // Grade/Subject/Concepts — Phase 4's own Concept-required-for-submission check addresses missing concepts here
  WHY: 'why',
  SELF_OTHERS_INDIA: 'selfOthersIndia',
  ASSESSMENT: 'assessment',
  SPARK: 'spark',
  PAIR_EXPLANATION: 'pairExplanation',
  FINAL_QUESTION: 'finalQuestion',
  TEACHER_LOOK_FORS: 'teacherLookFors',
});

/**
 * One Learning Activity — a first-class structured object, per
 * explicit product direction, never a bare text field. `differentiation`
 * starts `null` (progressive disclosure: the Red/Green/Other Bucket
 * fields don't exist at all until the teacher deliberately reveals
 * them via "+ Add differentiation" — see lessonPlanService.js's
 * addActivityDifferentiation()) rather than three permanently-empty
 * inputs every activity shows whether or not it needs them.
 */
export function createLessonPlanActivity({ id, title = '', teacherAction = '', studentAction = '', differentiation = null } = {}) {
  return {
    id: id || generateId(),
    title,
    teacherAction,
    studentAction,
    differentiation,
  };
}

/** The Red Bucket / Green Bucket / Others differentiation fields for one Activity — only ever created once, by addActivityDifferentiation(), never present from the start. */
export function createLessonPlanDifferentiation({ redBucket = '', greenBucket = '', others = '' } = {}) {
  return { redBucket, greenBucket, others };
}

/** One assessment/evidence item — "multiple assessment/evidence items where required" per explicit product direction, so `assessments` is an array of these rather than one bare string. */
export function createLessonPlanAssessmentItem({ id, description = '' } = {}) {
  return { id: id || generateId(), description };
}

/** One closed round of review — a snapshot of what happened, appended to `reviewHistory[]` and never edited afterward. `comments[]` is that round's own comments, copied in at the moment the round closes (see lessonPlanReviewService.js), so a later resubmission's fresh `activeComments[]` never retroactively rewrites a past round's history. */
export function createLessonPlanReviewRound({ id, status, byUid, at, comments = [] } = {}) {
  return {
    id: id || generateId(),
    status,
    byUid,
    at: at || getCurrentIsoDate(),
    comments,
  };
}

/**
 * One reviewer comment, addressed to a specific section (see
 * LESSON_PLAN_SECTION_KEYS) — "attached to meaningful sections/
 * components," per explicit product direction, never only a single
 * generic comment field. `resolvedAt` is set (by either side) once a
 * comment no longer needs action; a resolved comment stays visible in
 * review history, it's just no longer "open."
 *
 * `roundNumber` is set ONCE, at creation (by
 * lessonPlanReviewService.js's requestChanges()/approve() — the only
 * two places a comment is ever created), to whichever round is being
 * formed at that exact moment (`reviewHistory.length + 1`). This is
 * the fix for a real Phase 3 nuance: a comment's round membership must
 * be decided when the comment is born, never re-derived later from
 * "whatever happens to still be open when some later round closes" —
 * that's what let a Round 2 comment get silently re-attached to Round
 * 3 on resubmit. See lessonPlanReviewService.js's own closeCurrentRound()
 * comment for the full before/after.
 */
export function createLessonPlanComment({ id, sectionKey, text, byUid, createdAt, resolvedAt = null, roundNumber = null } = {}) {
  return {
    id: id || generateId(),
    sectionKey,
    text,
    byUid,
    createdAt: createdAt || getCurrentIsoDate(),
    resolvedAt,
    roundNumber,
  };
}

/**
 * Provenance only — lineage, never linkage (see
 * services/lessonPlanService.js's own copy-in functions): editing this
 * plan's own copy must never change the original element, and vice
 * versa; nothing about a LessonPlanSourceRef ever makes the copy
 * read-only or dependent on the original still existing.
 *
 * Two independent origin shapes share this one array/function rather
 * than a second provenance mechanism (Phase 4's own explicit "extend,
 * don't create a parallel system" direction):
 *   - `resourceId` (Phase 1's original shape) — copied from the
 *     Resource library.
 *   - `sourceLessonPlanId`/`sourceActivityId` (Phase 4 addition) —
 *     copied from a Teaching Idea, itself derived from another
 *     APPROVED LessonPlan (see services/teachingIdeasService.js).
 *     `sourceActivityId` is null for a Spark/Question/whole-assessment
 *     copy (nothing to identify below the plan itself); set for an
 *     Activity or one of its differentiation buckets.
 * A given ref only ever populates ONE of `resourceId` /
 * `sourceLessonPlanId` — never both — `elementType` says what kind of
 * element it is either way.
 */
export function createLessonPlanSourceRef({ resourceId = null, sourceLessonPlanId = null, sourceActivityId = null, elementType, copiedAt } = {}) {
  return { resourceId, sourceLessonPlanId, sourceActivityId, elementType, copiedAt: copiedAt || getCurrentIsoDate() };
}

export function createLessonPlan({
  id,
  classroomId,
  createdByUid,
  createdAt,
  updatedAt,

  // Context — the same kind of optional, live-resolved references
  // models/Lesson.js's own curriculumUnitId/conceptIds already use,
  // never copied titles.
  subjectId = null,
  curriculumUnitId = null,
  conceptIds = [],
  gradeLabel = '',
  topic = '',

  // 1. WHY ARE STUDENTS LEARNING WHAT THEY ARE LEARNING TODAY?
  lessonObjective = '',
  swbatObjectives = [],
  bigQuestion = '',

  // 2. WILL IT ADVANCE SELF, OTHERS AND INDIA?
  selfOthersIndia = { self: '', others: '', india: '' },

  // 3. ARE STUDENTS SHOWCASING LEARNING?
  assessments = [],

  // 4. IS IT FUN, FAST, EFFECTIVE?
  spark = { title: '', teacherAction: '', studentAction: '' },
  activities = [],

  // 5. ARE STUDENTS HELPING ME AND OTHERS LEARN?
  pairExplanation = '',
  finalQuestion = '',
  teacherLookFors = '',

  // Lifecycle
  status = LESSON_PLAN_STATUS.DRAFT,
  reviewerUid = null,
  reviewHistory = [],
  activeComments = [],
  sourceElementRefs = [],
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    classroomId,
    createdByUid,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,

    subjectId,
    curriculumUnitId,
    conceptIds,
    gradeLabel,
    topic,

    lessonObjective,
    swbatObjectives,
    bigQuestion,

    selfOthersIndia,

    assessments,

    spark,
    activities,

    pairExplanation,
    finalQuestion,
    teacherLookFors,

    status,
    reviewerUid,
    reviewHistory,
    activeComments,
    sourceElementRefs,
  };
}

/** The index of one Activity by id, or -1 — the one place every activity-array mutation in lessonPlanService.js looks this up, so there's exactly one definition of "found." */
export function getLessonPlanActivityIndex(lessonPlan, activityId) {
  return lessonPlan.activities.findIndex((activity) => activity.id === activityId);
}

/** One Activity by id, or null. */
export function findLessonPlanActivity(lessonPlan, activityId) {
  return lessonPlan.activities.find((activity) => activity.id === activityId) || null;
}
