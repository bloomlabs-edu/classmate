/**
 * models/ChapterPlan.js
 *
 * Long-range planning for an entire curriculum chapter/unit — "what is
 * worth learning in this chapter, why does it matter, what should
 * mastery look like, and what methods/resources could support it?"
 * Deliberately its OWN entity, modeled after models/LessonPlan.js's
 * architecture (rich content + a full DRAFT/SUBMITTED/
 * CHANGES_REQUESTED/APPROVED review lifecycle with append-only
 * `reviewHistory[]`/`activeComments[]`), NOT after
 * models/WeeklyPlanSubmission.js's thin status-only envelope — a
 * Chapter Plan carries real, long-form content of its own and needs
 * the same kind of review conversation a LessonPlan does, which
 * WeeklyPlanSubmission deliberately does not.
 *
 * `CHAPTER_PLAN_STATUS` is its OWN enum object, never imported from
 * LESSON_PLAN_STATUS/WEEKLY_PLAN_SUBMISSION_STATUS even though the four
 * string values read the same — same explicit product direction those
 * two files already establish: every planning tier's review lifecycle
 * is tracked independently, so a future change to one can never
 * silently affect another. config/memberRoles.js mirrors this with its
 * own REVIEW_CHAPTER_PLAN/APPROVE_CHAPTER_PLAN permission pair.
 *
 * Storage: one Firestore document per ChapterPlan,
 * `classrooms/{classroomId}/chapterPlans/{chapterPlanId}` (see
 * repositories/chapterPlanRepository.js) — the same "own subcollection,
 * membership-of-the-classroom-document controls access" convention
 * every other classroom-scoped library in this app already uses
 * (LessonPlans, Resources, Activities).
 *
 * ---------------------------------------------------------------------
 * Curriculum identity — TWO fields, deliberately, not one
 * ---------------------------------------------------------------------
 *
 * `curriculumUnitId` — a classroom-LOCAL reference: the `id` of this
 * classroom's own models/LearningUnit.js document (see
 * services/curriculumLinkingService.js). Same "reference, never a
 * copy" convention Lesson/LessonPlan already use for this exact field.
 *
 * `linkedCurriculumUnitId` — the STABLE, CROSS-CLASSROOM identity: a
 * copy of that same LearningUnit's own `linkedCurriculumUnitId` (see
 * models/LearningUnit.js's own header comment), which points at the
 * shared Curriculum Index Unit every classroom that assigned the same
 * curriculum independently copied their own LearningUnit from. Because
 * `curriculumUnitId`/`LearningUnit.id` is minted fresh per classroom,
 * it can NEVER be used to recognize "Rejeesh's classroom and Anu's
 * classroom are planning the same Grade 8 Science Plant Kingdom
 * chapter" — only `linkedCurriculumUnitId` can. This is therefore the
 * one field Sparks/Chapter-Plan cross-Fellow discovery must key off of
 * (see models/Spark.js's own identical field). Nullable: a classroom
 * whose Unit was hand-added rather than linked from a Curriculum Index
 * has no cross-classroom identity to offer, and a Chapter Plan for it
 * is simply not cross-Fellow-discoverable — an honest limitation, not
 * a bug to work around here.
 *
 * ---------------------------------------------------------------------
 * Content sections
 * ---------------------------------------------------------------------
 *
 * `purpose`/`mastery`/`methods` mirror the four supplied subject
 * templates' own section names and fields verbatim (PURPOSE AND
 * INTEGRATION / MASTERY / METHODS) — preserving the templates'
 * information architecture, per explicit product direction, rather
 * than inventing new terminology. Every field in them is free-form
 * long-form text, matching what the source templates actually are
 * (narrative planning prose, not structured data) — EXCEPT
 * `purpose.essentialQuestions`/`purpose.objectives`, kept as plain
 * string arrays (one array entry per question/objective) since the
 * templates present those as short lists, not paragraphs, and a
 * teacher naturally adds/removes them one at a time. Deliberately NOT
 * first-class `{id, text}` objects the way LessonPlan.objectives[] is
 * — that structure exists there specifically to support future
 * per-objective completion tracking (see that model's own comment),
 * which nothing about Chapter-Plan-level objectives asks for yet; a
 * plain string array is the minimum structure this actually needs.
 *
 * `methods.resources` is deliberately a plain narrative text field —
 * the templates' own "Resources" line (worksheets/GO's/experiment
 * GO's described in prose) — NOT the shared Resource-repository
 * integration. That integration lives entirely in the separate
 * `resourceLinks[]` field below, which references real
 * models/Resource.js documents rather than describing them in text;
 * the two deliberately coexist rather than one replacing the other,
 * exactly the way a LessonPlan's own narrative fields and its separate
 * `resources[]` (LessonPlanResource) attachments coexist.
 *
 * `subjectSpecific` holds ONLY the fields the supplied templates
 * actually call for beyond the common structure — `cpaIdeas`
 * (Mathematics) or `grammarMiniLesson` (Literacy/English) — and is
 * `{}` for Science/Social Science, which the templates add nothing
 * extra to. Per explicit product direction, this file does not force
 * every ChapterPlan to carry both keys with one always empty; a
 * subject's own template config (a later phase) decides which key(s)
 * apply and populates only those.
 *
 * ---------------------------------------------------------------------
 * Resource references — one Resource, multiple associations
 * ---------------------------------------------------------------------
 *
 * `resourceLinks` is an array of models/ChapterPlanResourceLink.js —
 * lightweight references to real, independently-owned
 * `classrooms/{classroomId}/resources/{resourceId}` documents (see
 * models/Resource.js), the same "link objects carry the association,
 * the Resource itself knows nothing about who links to it" pattern
 * models/ConceptResourceLink.js already established for Concepts.
 * Never a duplicate copy of a Resource's own content. A Chapter Plan
 * may reference a Resource that belongs to a DIFFERENT classroom
 * (another Fellow's) — see that model's own header comment for why
 * each link therefore carries its own `classroomId`, unlike
 * ConceptResourceLink, which never needs one because a Concept only
 * ever links Resources from its own classroom.
 *
 * `conceptIds` — the same existing models/Lesson.js/LessonPlan.js
 * reference-only convention, reused verbatim (never a second concept-
 * identifier system): which Learning Record concepts this chapter's
 * plan is actually about. This is the join key later phases' Spark/
 * Resource discovery ("relevant to the current concept(s)") will
 * query against — see models/Spark.js's own identical field.
 *
 * ---------------------------------------------------------------------
 * Spark references — one Spark, multiple references, never copied
 * ---------------------------------------------------------------------
 *
 * `sparkRefs` is an array of models/ChapterPlanSparkRef.js — the exact
 * same "link objects carry the association, the thing pointed to knows
 * nothing about who references it" pattern `resourceLinks` above
 * already uses for Resources, applied to Spark (see models/Spark.js).
 * A reference NEVER carries the Spark's own title/description/
 * instructions/sparkType — per explicit product direction ("Chapter
 * Plans reference Sparks; they never copy Spark content"), resolving a
 * ref to what the Spark actually says always means a real fetch (see
 * repositories/sparkRepository.js's own getSparkById()), never reading
 * a cached copy off this ref. A referenced Spark may belong to (be
 * authored by) a different Fellow entirely — referencing it grants no
 * ownership or edit rights over it whatsoever (see
 * services/chapterPlanService.js's own addSparkRef()); this is a
 * read-only pointer, full stop.
 *
 * `section` on each ref is addressed against CHAPTER_PLAN_SPARK_SECTIONS
 * below — a controlled set, never arbitrary free text, the same
 * "controlled addressing scheme" convention CHAPTER_PLAN_SECTION_KEYS
 * above and LessonPlan's own LESSON_PLAN_SECTION_KEYS already
 * establish. Limited, per explicit Phase 3 scope, to the three sections
 * of this template where a reusable teaching idea genuinely applies —
 * `methods.keyMethods`, `methods.revisionIdeas`, and `subjectSpecific`
 * (CPA Ideas / Grammar Mini Lesson) — deliberately NOT every section
 * this model has (PURPOSE's narrative fields and MASTERY's showcase/
 * vocabulary fields are answering "what" and "how will we know,"
 * neither of which is "here's a reusable teaching method," so extending
 * Spark referencing there was not invented without a real template
 * fields to hang it on).
 *
 * A Spark MAY be referenced in more than one section of the SAME plan
 * (e.g. used for both `keyMethods` and `revisionIdeas`) — only an exact
 * duplicate (same `sparkId` AND same `section`) within one plan is
 * prevented (see services/chapterPlanService.js's own addSparkRef()).
 * Removing a ref (services/chapterPlanService.js's own
 * removeSparkRef()) only ever removes that one association — never the
 * canonical Spark, which may still be referenced elsewhere (this same
 * plan's other sections, or any other Fellow's own Chapter Plan).
 *
 * ---------------------------------------------------------------------
 * Review lifecycle
 * ---------------------------------------------------------------------
 *
 * `reviewHistory[]` is APPEND-ONLY, exactly like LessonPlan's own (see
 * that model's header comment for the Goals-flow regression this
 * fixes) — a teacher revising after CHANGES_REQUESTED must never
 * silently lose what a reviewer originally said. Every transition
 * (submit/resubmit, requestChanges, approve) is made in exactly one
 * place — a future services/chapterPlanReviewService.js, mirroring
 * services/lessonPlanReviewService.js's own transition table — not
 * built in this phase; this model only defines the shape those
 * transitions read and write.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/**
 * 'draft' -> 'submitted' -> 'approved', or 'submitted' ->
 * 'changes_requested' -> 'draft' (revising) -> 'submitted' again — the
 * exact same shape as LESSON_PLAN_STATUS (models/LessonPlan.js), kept
 * as its own separate object per this file's own header comment.
 */
export const CHAPTER_PLAN_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  CHANGES_REQUESTED: 'changes_requested',
  APPROVED: 'approved',
});

/**
 * The current organisational Chapter Plan template's own version
 * number. Stored on every ChapterPlan as `templateVersion` (see
 * createChapterPlan() below) so a future change to the four subject
 * templates' own fields never silently reinterprets an
 * already-created plan's content under a different schema — an
 * existing plan keeps whatever version it was created under; only a
 * NEW plan (or an explicit, future migration) ever gets a newer one.
 */
export const CURRENT_CHAPTER_PLAN_TEMPLATE_VERSION = 1;

/**
 * Every meaningful section a reviewer comment (see
 * `activeComments[].sectionKey`/`reviewHistory[].comments[].sectionKey`
 * below) can be addressed to — the same addressing-scheme convention
 * LESSON_PLAN_SECTION_KEYS (models/LessonPlan.js) already establishes,
 * re-scoped to this template's own section names.
 */
export const CHAPTER_PLAN_SECTION_KEYS = Object.freeze({
  CONTEXT: 'context', // Classroom/Grade/Subject/Term/Chapter
  PURPOSE: 'purpose',
  MASTERY: 'mastery',
  METHODS: 'methods',
  SUBJECT_SPECIFIC: 'subjectSpecific',
});

/**
 * The controlled set of sections a Spark reference (see
 * models/ChapterPlanSparkRef.js, `sparkRefs` below) may be addressed
 * to — see this file's own header comment ("Spark references") for
 * why exactly these three and no others. Values match the equivalent
 * keys inside `methods`/`subjectSpecific` above verbatim, so a caller
 * never has to translate between "which section is this ref for" and
 * "which field does that section actually mean."
 */
export const CHAPTER_PLAN_SPARK_SECTIONS = Object.freeze({
  KEY_METHODS: 'keyMethods',
  REVISION_IDEAS: 'revisionIdeas',
  SUBJECT_SPECIFIC: 'subjectSpecific',
});

/** One closed round of review — same shape/semantics as createLessonPlanReviewRound() (models/LessonPlan.js), re-scoped to this model's own review lifecycle. Appended to `reviewHistory[]` and never edited afterward. */
export function createChapterPlanReviewRound({ id, status, byUid, at, comments = [] } = {}) {
  return {
    id: id || generateId(),
    status,
    byUid,
    at: at || getCurrentIsoDate(),
    comments,
  };
}

/** One reviewer comment, addressed to a specific section (see CHAPTER_PLAN_SECTION_KEYS) — same shape/semantics as createLessonPlanComment() (models/LessonPlan.js). `roundNumber` is set once, at creation, by whichever service call is forming that round. */
export function createChapterPlanComment({ id, sectionKey, text, byUid, createdAt, resolvedAt = null, roundNumber = null } = {}) {
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

export function createChapterPlan({
  id,
  classroomId,
  teacherUid,
  createdByUid,
  createdAt,
  updatedAt,

  // Context — same "reference, never copy" convention Lesson/LessonPlan
  // already use for subjectId/curriculumUnitId/conceptIds/gradeLabel;
  // termId is new (no term registry exists yet anywhere in this app),
  // kept as a plain optional string for the same reason.
  gradeLabel = '',
  subjectId = null,
  termId = null,
  curriculumUnitId = null, // classroom-local LearningUnit.id
  linkedCurriculumUnitId = null, // cross-classroom/cross-Fellow chapter identity — see this file's header comment
  conceptIds = [],
  chapterName = '',
  numberOfLessonsDays = null,

  // PURPOSE AND INTEGRATION
  purpose = {
    whatsWorthLearning: '',
    whyDoesLearningMatter: '',
    importantConcepts: '',
    supplementaryResources: '',
    essentialQuestions: [],
    objectives: [],
  },

  // MASTERY
  mastery = {
    endOfChapterShowcase: '',
    bookBackQuestionTypes: '',
    lsrwScope: '',
    vocabularyAndAnchorCharts: '',
  },

  // METHODS
  methods = {
    keyMethods: '',
    simplifiedText: '',
    revisionIdeas: '',
    resources: '',
  },

  // Subject-specific fields the common template doesn't cover — see
  // this file's own header comment. `{}` for Science/Social Science.
  subjectSpecific = {},

  // Shared Resource references — see models/ChapterPlanResourceLink.js.
  resourceLinks = [],

  // Shared Spark references — see models/ChapterPlanSparkRef.js.
  sparkRefs = [],

  templateVersion = CURRENT_CHAPTER_PLAN_TEMPLATE_VERSION,

  // Lifecycle
  status = CHAPTER_PLAN_STATUS.DRAFT,
  reviewerUid = null,
  reviewHistory = [],
  activeComments = [],
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    classroomId,
    teacherUid,
    createdByUid: createdByUid || teacherUid,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,

    gradeLabel,
    subjectId,
    termId,
    curriculumUnitId,
    linkedCurriculumUnitId,
    conceptIds,
    chapterName,
    numberOfLessonsDays,

    purpose,
    mastery,
    methods,
    subjectSpecific,

    resourceLinks,
    sparkRefs,

    templateVersion,

    status,
    reviewerUid,
    reviewHistory,
    activeComments,
  };
}

/** The index of one resource link by its own id, or -1 — the one place every resourceLinks-array mutation should look this up, mirroring getLessonPlanResourceIndex() (models/LessonPlan.js). */
export function getChapterPlanResourceLinkIndex(chapterPlan, resourceLinkId) {
  return (chapterPlan.resourceLinks || []).findIndex((link) => link.id === resourceLinkId);
}

/** One ChapterPlanResourceLink by its own id, or null. */
export function findChapterPlanResourceLink(chapterPlan, resourceLinkId) {
  return (chapterPlan.resourceLinks || []).find((link) => link.id === resourceLinkId) || null;
}

/** The index of one Spark ref by its own id, or -1 — same shape as getChapterPlanResourceLinkIndex() above, for `sparkRefs`. */
export function getChapterPlanSparkRefIndex(chapterPlan, sparkRefId) {
  return (chapterPlan.sparkRefs || []).findIndex((ref) => ref.id === sparkRefId);
}

/** One ChapterPlanSparkRef by its own id, or null. */
export function findChapterPlanSparkRef(chapterPlan, sparkRefId) {
  return (chapterPlan.sparkRefs || []).find((ref) => ref.id === sparkRefId) || null;
}

/** Whether `sparkId` is already referenced in this exact `section` — the one check that prevents a duplicate reference (see services/chapterPlanService.js's own addSparkRef()). A Spark referenced in a DIFFERENT section of the same plan is not a duplicate — see this file's own header comment on why that's allowed. */
export function hasChapterPlanSparkRef(chapterPlan, sparkId, section) {
  return (chapterPlan.sparkRefs || []).some((ref) => ref.sparkId === sparkId && ref.section === section);
}
