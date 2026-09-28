/**
 * models/Spark.js
 *
 * A small, independently-authored, reusable teaching idea — a hook,
 * activity, discussion prompt, question, experiment, revision
 * strategy, misconception intervention, or similar — extracted from
 * planning and made discoverable to OTHER Fellows without asking them
 * to read anyone's whole plan. Per explicit product direction: "Don't
 * make teachers browse what other teachers wrote. Make them browse
 * what other teachers discovered."
 *
 * ---------------------------------------------------------------------
 * NOT the same thing as three existing, similarly-named concepts
 * ---------------------------------------------------------------------
 *
 * 1. models/LessonPlan.js's own `spark` field (`{title, teacherAction,
 *    studentAction}`) — that is ONE specific slot inside the "5
 *    Questions" framework's Question 4 (Fun/Fast/Effective), belonging
 *    to exactly one LessonPlan. THIS Spark is a standalone, top-level
 *    entity with no owning LessonPlan at all, reusable across any
 *    number of Chapter Plans/classrooms. Sharing the word is a real
 *    naming collision this file's own name doesn't try to hide — see
 *    the Chapter Plan Phase 1 implementation report for the explicit
 *    call-out — but the two are unrelated models with unrelated
 *    lifecycles.
 * 2. `teachingIdeas/{lessonPlanId}` (services/teachingIdeasService.js,
 *    repositories/teachingIdeasRepository.js) — a DERIVED, read-only
 *    projection auto-published the moment a LessonPlan is APPROVED
 *    (`allow update/delete: if false` in firestore.rules); one entry
 *    IS one whole approved LessonPlan's content, never independently
 *    created, never editable. A Spark is the opposite on every count:
 *    independently authored at any time, its own small idea (not a
 *    whole lesson), and editable by its own creator.
 * 3. `sparkType` values like 'activity'/'question'/'assessment' read
 *    similarly to LESSON_PLAN_SECTION_KEYS' own SPARK/PAIR_EXPLANATION
 *    naming, but this enum (SPARK_TYPES below) is this file's own,
 *    never imported from or compared against models/LessonPlan.js.
 *
 * ---------------------------------------------------------------------
 * Storage — top-level, not classroom-scoped
 * ---------------------------------------------------------------------
 *
 * `sparks/{sparkId}`, a top-level collection — never a subcollection of
 * `classrooms/{classroomId}`, for the exact same reason
 * `teachingIdeas`/`weeklyPlanReviewIndex` already are (see those
 * collections' own repository header comments): a classroom-scoped
 * path can't express "discoverable by any Fellow across every
 * classroom in ClassMate" without either scanning classrooms this app
 * has no permission to `list`, or fetching every classroom's own
 * private library just to filter client-side. Precedent for a
 * top-level, cross-classroom-discoverable collection already exists in
 * this app; this isn't a new kind of thing for this codebase.
 *
 * ---------------------------------------------------------------------
 * Fields
 * ---------------------------------------------------------------------
 *
 * `createdByUid` — the Fellow who authored this Spark. Named to match
 * this app's own established convention for "who created this
 * document" (models/LessonPlan.js, models/WeeklyPlanSubmission.js both
 * use `createdByUid`, never a bare `createdBy`) rather than the
 * product brief's own literal wording — an intentional adaptation, not
 * an oversight. Provenance is permanent: nothing in this model or its
 * Firestore rule ever lets a second uid take over authorship of an
 * existing Spark, so "Created by: [Fellow]" always displays correctly
 * even after another Fellow has used it elsewhere.
 *
 * `subjectIds`/`gradeLevels`/`conceptIds` — plural arrays: a Spark
 * (e.g. a general "Think-Pair-Share" discussion strategy) may
 * legitimately apply beyond one single subject/grade/concept, unlike a
 * ChapterPlan, which is always about exactly one. `conceptIds` reuses
 * the exact same Learning Record concept ids Lesson/LessonPlan/
 * ChapterPlan already reference — never a second concept-identifier
 * system.
 *
 * `curriculumUnitIds` — classroom-local models/LearningUnit.js ids this
 * Spark happens to have been created alongside (plural, since a Spark
 * authored once could be tagged against more than one classroom's own
 * local Unit over time) — included per explicit product direction
 * ("curriculumUnitIds where useful"), but NOT the field cross-Fellow
 * discovery should ever key off, for the identical reason
 * models/ChapterPlan.js's own header comment gives: classroom-local ids
 * can't recognize "the same chapter" across classrooms.
 *
 * `linkedCurriculumUnitId` — singular, the actual cross-classroom/
 * cross-Fellow chapter identity (see models/ChapterPlan.js's own
 * identically-named field and models/LearningUnit.js's own
 * `linkedCurriculumUnitId`). THIS is what "Browse Sparks relevant to
 * the current chapter" queries against. Nullable — a Spark authored
 * generically (not tied to any one chapter) simply has no chapter to
 * be discovered by this way, and remains discoverable by
 * subject/grade/concept/type/search instead.
 *
 * `resourceRefs` — plain `{classroomId, resourceId}` pairs pointing at
 * real models/Resource.js documents, the same reference-only, no-
 * per-item-provenance shape models/ChapterPlanResourceLink.js uses
 * (minus that model's own `id`/`addedAt`/`addedBy`, which belong to a
 * link-in-an-array-that-needs-its-own-identity-for-removal; a Spark's
 * own document-level `createdByUid`/`createdAt` already cover
 * provenance for the whole Spark, so a per-ref stamp would be
 * redundant here). Never a duplicate copy of a Resource's own content.
 *
 * `visibility` — SPARK_VISIBILITY.SHARED (default) is the only value
 * anything in this phase reads or writes; PRIVATE is reserved
 * vocabulary for a possible future "still drafting, not ready to
 * share yet" state, exactly the same "reserve the word before the
 * feature exists" precedent config/memberRoles.js's own
 * STUDENT/PARENT/PROGRAM_MANAGER/HEAD_MASTER placeholders already set.
 *
 * `sparkType` — one of SPARK_TYPES below, or `null` (a Spark's type is
 * a useful filter, not a mandatory classification the model itself
 * should force — per explicit "do not make all of these mandatory"
 * product direction).
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/** Suggested Spark types — a filter vocabulary, not an exhaustive or mandatory classification (see this file's own header comment). `OTHER` covers anything not already named here. */
export const SPARK_TYPES = Object.freeze({
  ACTIVITY: 'activity',
  HOOK: 'hook',
  QUESTION: 'question',
  METHOD: 'method',
  ASSESSMENT: 'assessment',
  REVISION: 'revision',
  DIFFERENTIATION: 'differentiation',
  EXPERIMENT: 'experiment',
  DISCUSSION: 'discussion',
  OTHER: 'other',
});

export const SPARK_VISIBILITY = Object.freeze({
  SHARED: 'shared',
  PRIVATE: 'private', // reserved, unused this phase — see this file's own header comment
});

export function createSpark({
  id,
  title = '',
  description = '',

  sparkType = null,
  instructions = '',

  createdByUid,
  createdAt,
  updatedAt,

  subjectIds = [],
  gradeLevels = [],

  conceptIds = [],
  curriculumUnitIds = [],
  linkedCurriculumUnitId = null,

  estimatedTime = '',

  resourceRefs = [],

  visibility = SPARK_VISIBILITY.SHARED,

  tags = [],
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    title,
    description,

    sparkType,
    instructions,

    createdByUid,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,

    subjectIds,
    gradeLevels,

    conceptIds,
    curriculumUnitIds,
    linkedCurriculumUnitId,

    estimatedTime,

    resourceRefs,

    visibility,

    tags,
  };
}

/** A plain `{classroomId, resourceId}` reference, appended to a Spark's own `resourceRefs` — see this file's own header comment on why no per-ref provenance is stored here. */
export function createSparkResourceRef({ classroomId, resourceId }) {
  return { classroomId, resourceId };
}
