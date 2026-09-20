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
 * the Timetable's `Lesson` is the lightweight WEEKLY PLAN for a
 * scheduled OCCURRENCE (one dated period, `teachingSlotId`, concepts,
 * its own `objectives[]`/`bigQuestion`, taught/not-taught status); a
 * LessonPlan is the separate, OPTIONAL, structured DETAILED PLANNING
 * DOCUMENT with its own review lifecycle — created lazily, only when a
 * teacher chooses to prepare one (see
 * services/timetableLessonService.js's own buildDetailedLessonPlanFromLesson()),
 * never merely because a period exists. See
 * docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md for the
 * full Weekly Plan <-> Detailed Lesson Plan relationship.
 *
 * *Is* a LessonPlan ever attached to a specific Timetable period?
 * Yes — via `scheduledDate`/`scheduledPeriodNumber` below, a live-
 * resolved reference exactly like `curriculumUnitId`/`conceptIds`
 * already are (resolved against the same Curriculum tree / Timetable,
 * never copied). A LessonPlan created via buildDetailedLessonPlanFromLesson()
 * is additionally cross-referenced from its originating Lesson (see
 * `Lesson.lessonPlanId`) — but a LessonPlan can still exist unattached
 * to any Lesson at all (the older, free-standing "+ New Lesson Plan"
 * flow in ui/views/LessonPlansListView.js), so nothing here assumes
 * that link is always present either.
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

/**
 * 'draft' -> 'submitted' -> 'approved', or 'submitted' ->
 * 'changes_requested' -> 'draft' (revising) -> 'submitted' again. See
 * services/lessonPlanReviewService.js for the one place these
 * transitions are ever made.
 *
 * There is deliberately NO separate 'published' value here — publishing
 * (see services/teachingIdeasService.js/repositories/teachingIdeasRepository.js)
 * already happens automatically the moment a plan is approved (see
 * ui/views/LessonPlanReviewView.js's own onApprove handler), so "is this
 * plan published" is a DERIVED fact (status === APPROVED and a
 * `teachingIdeas/{id}` document actually exists for it), never a second,
 * independently-settable status a client could set out of step with
 * reality. Adding a stored 'published' status here would let the two
 * disagree; checking the real teachingIdeas document never can.
 */
export const LESSON_PLAN_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  CHANGES_REQUESTED: 'changes_requested',
  APPROVED: 'approved',
});

/**
 * A supplementary Learning Resource attached to a LessonPlan — a
 * Graphic Organizer, Anchor Chart, Video, Reference Document, or
 * anything else a teacher wants alongside the plan itself. Deliberately
 * its own small model, not a reuse of models/Resource.js: that model is
 * a completely different domain (a reusable, cross-Concept Learning Hub
 * asset library, with its own editor per type and its own Firestore
 * subcollection) — a LessonPlanResource is a lightweight, single-lesson-
 * scoped attachment with no lifecycle of its own beyond the plan it
 * belongs to, the same "don't force a mismatched model just because a
 * similarly-named one exists" judgment this app already applies
 * elsewhere (see models/LearningSubject.js's own header comment on why
 * it's distinct from NotebookSubject).
 *
 * `sectionKey` reuses the EXACT SAME addressing scheme reviewer comments
 * already use (see LESSON_PLAN_SECTION_KEYS and
 * services/lessonPlanReviewService.js's own buildActivitySectionKey()) —
 * `null` for "Whole Lesson / General", `'spark'` for Spark,
 * `'pairExplanation'` for Pair Explanation, or `activity:{activityId}`
 * for a specific Activity, resolved dynamically against `plan.activities`
 * at render time, never a hardcoded list of "Activity 1..4". This is
 * deliberately the SAME field shape a comment's own `sectionKey` uses,
 * not a second, parallel addressing scheme.
 *
 * `url` covers both "an external URL" and, honestly, the entire
 * "uploaded file" case too, for now: this repository has no Firebase
 * Storage (or any other binary file storage) integration to reuse (
 * confirmed by inspection before implementing), and building one is a
 * genuine, separate infrastructure decision, not something to invent
 * silently as a side effect of this feature. A resource created today
 * always has a real URL a teacher supplies; true file upload is a
 * documented, intentionally-unbuilt gap, not a hidden shortcut.
 */
export const LESSON_RESOURCE_TYPES = Object.freeze({
  GRAPHIC_ORGANIZER: 'graphic_organizer',
  ANCHOR_CHART: 'anchor_chart',
  VIDEO: 'video',
  REFERENCE_DOCUMENT: 'reference_document',
  OTHER: 'other',
});

export function createLessonPlanResource({
  id,
  title = '',
  type = LESSON_RESOURCE_TYPES.OTHER,
  url = '',
  description = '',
  sectionKey = null,
  createdAt,
  updatedAt,
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    title,
    type,
    url,
    description,
    sectionKey,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}

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
 * One individual Lesson Objective — a first-class structured object,
 * per explicit product direction: "each individual lesson objective
 * [should become] a separate first-class domain object so that its
 * completion/progress can eventually be tracked independently." Array
 * position IS order — no separate `order` field — the same convention
 * `activities[]`/`assessments[]` below already establish for exactly
 * the same reason (see this file's own header comment): reordering is
 * array surgery on one list, so order can never drift out of sync with
 * a redundant integer.
 *
 * Deliberately its own domain concept, NOT a LearningConcept
 * (models/LearningConcept.js) and NOT merged into one — a Concept is
 * knowledge/content that exists independently of any one lesson and
 * can appear across many; a LessonObjective is what students are
 * expected to learn in THIS particular lesson. An objective may one
 * day reference a concept (a `conceptId` field would be a natural,
 * additive extension), but the two are never the same entity.
 *
 * Deliberately holds no student-specific progress of its own — a
 * future per-student `StudentObjectiveProgress` belongs on the
 * STUDENT, keyed by this objective's own `id`, mirroring
 * models/StudentConceptRecord.js's own established pattern exactly
 * (`student.learningRecord[conceptId]` there; a future
 * `student.objectiveRecord[objectiveId]` here) — never a field on this
 * object itself. This object's only job is to exist, have a stable id,
 * and hold its own text.
 */
export function createLessonPlanObjective({ id, text = '' } = {}) {
  return {
    id: id || generateId(),
    text,
  };
}

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

  // Scheduling — a durable (date, period number) REFERENCE into the
  // classroom's own recurring Timetable (see services/timetableService.js),
  // resolved live at read time, exactly like curriculumUnitId/conceptIds
  // above never copy their own title/subject either. Deliberately NOT a
  // teachingSlotId (models/TeachingSlot.js's own concrete occurrences
  // are regenerated on demand and have no stable identity across
  // renders) and NOT subject/time/teacher fields copied onto this plan
  // — those stay the Timetable's own job to answer, every time, so a
  // later Timetable edit is reflected automatically rather than this
  // plan quietly going stale. Both fields are set/cleared together,
  // never one without the other (see services/lessonPlanService.js's
  // own updateSchedule()) — a lone periodNumber with no date, or vice
  // versa, is not a valid state this model ever represents.
  scheduledDate = null, // "YYYY-MM-DD", or null if not scheduled
  scheduledPeriodNumber = null, // 1-based, matches models/Timetable.js's own TimetablePeriod.periodNumber

  // 1. WHY ARE STUDENTS LEARNING WHAT THEY ARE LEARNING TODAY?
  objectives = [],
  bigQuestion = '',

  // LEGACY — `lessonObjective`/`swbatObjectives` are the pre-Objectives
  // shape of Q1 (a single free-text field, at one point also holding a
  // separately-structured SWBAT string list). Never deleted, never
  // written to by any current UI — kept only so old data is never
  // silently discarded (see services/lessonPlanService.js's own
  // migrateLegacyObjectives(), which reads these ONCE to populate
  // `objectives` above, the first time an old plan is opened).
  lessonObjective = '',
  swbatObjectives = [],

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

  // Learning Resources — optional, supplementary materials attached to
  // this plan (see createLessonPlanResource() above). Entirely separate
  // from the 5-Questions readiness/submission logic — never required to
  // submit or approve a plan.
  resources = [],

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

    scheduledDate,
    scheduledPeriodNumber,

    objectives,
    bigQuestion,

    lessonObjective,
    swbatObjectives,

    selfOthersIndia,

    assessments,

    spark,
    activities,

    pairExplanation,
    finalQuestion,
    teacherLookFors,

    resources,

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

/** Same shape as getLessonPlanActivityIndex() above, for objectives — the one place every objectives-array mutation in lessonPlanService.js looks this up. */
export function getLessonPlanObjectiveIndex(lessonPlan, objectiveId) {
  return lessonPlan.objectives.findIndex((objective) => objective.id === objectiveId);
}

/** One LessonPlanObjective by id, or null. */
export function findLessonPlanObjective(lessonPlan, objectiveId) {
  return lessonPlan.objectives.find((objective) => objective.id === objectiveId) || null;
}

/** Same shape as getLessonPlanActivityIndex() above, for Learning Resources — the one place every resources-array mutation in lessonPlanService.js looks this up. */
export function getLessonPlanResourceIndex(lessonPlan, resourceId) {
  return (lessonPlan.resources || []).findIndex((resource) => resource.id === resourceId);
}

/** One LessonPlanResource by id, or null. */
export function findLessonPlanResource(lessonPlan, resourceId) {
  return (lessonPlan.resources || []).find((resource) => resource.id === resourceId) || null;
}
