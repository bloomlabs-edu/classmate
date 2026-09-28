/**
 * services/chapterPlanService.js
 *
 * Creation + content mutation for a ChapterPlan's own PURPOSE/MASTERY/
 * METHODS/subjectSpecific sections and its `resourceLinks[]` — the
 * ChapterPlan equivalent of services/lessonPlanService.js, field-renamed
 * onto models/ChapterPlan.js's own shape. Every mutator here follows the
 * exact same "mutate-then-caller-saves" convention every other service
 * in this app already uses (see services/lessonPlanService.js's own
 * header comment) — nothing here calls
 * repositories/chapterPlanRepository.js itself; the caller (a future
 * Phase 3+ UI) does that once, after whichever mutation just ran.
 *
 * ---------------------------------------------------------------------
 * One deliberate elevation beyond LessonPlan's own precedent
 * ---------------------------------------------------------------------
 *
 * services/lessonPlanService.js's own mutators never check
 * `lessonPlan.status` at all — they trust the Builder UI to only ever
 * call them on an editable plan, with Firestore rules as the actual,
 * final enforcement. Per explicit Phase 2 product direction ("service
 * validation should provide appropriate user-facing errors while rules
 * remain the final security boundary"), every content mutator below
 * DOES check editability first, via assertEditable() — a friendlier,
 * earlier user-facing error than waiting for a rules-layer rejection,
 * never a replacement for it. What these mutators deliberately do NOT
 * check is OWNERSHIP (is the caller actually this plan's own
 * `teacherUid`) — that class of check stays exactly where
 * lessonPlanService.js's own precedent (and this app's Firestore rules)
 * already put it: enforced by the rules themselves, never duplicated
 * here, since a content mutator has no `classroom`/`uid` in hand to
 * check it against without inventing a second authorization path.
 */

import {
  createChapterPlan,
  CURRENT_CHAPTER_PLAN_TEMPLATE_VERSION,
  CHAPTER_PLAN_SPARK_SECTIONS,
  getChapterPlanResourceLinkIndex,
  getChapterPlanSparkRefIndex,
  hasChapterPlanSparkRef,
} from '../models/ChapterPlan.js';
import { createChapterPlanResourceLink } from '../models/ChapterPlanResourceLink.js';
import { createChapterPlanSparkRef } from '../models/ChapterPlanSparkRef.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { isChapterPlanEditable } from './chapterPlanReviewService.js';

function touch(chapterPlan) {
  chapterPlan.updatedAt = getCurrentIsoDate();
}

function assertEditable(chapterPlan) {
  if (!isChapterPlanEditable(chapterPlan)) {
    throw new Error(`This Chapter Plan can't be edited while it's "${chapterPlan.status}". Only a draft or a plan with changes requested can be edited.`);
  }
}

function isBlank(value) {
  return !value || !String(value).trim();
}

// ---------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------

/**
 * Validates and builds a brand-new, DRAFT ChapterPlan — the one place
 * this app decides what's genuinely required to create one. Required:
 * `classroomId`, `teacherUid`, `gradeLabel`, `subjectId`, `chapterName`,
 * and `curriculumUnitId` (you cannot meaningfully create "a plan for a
 * chapter" without picking which chapter/unit it's for — the same way
 * every one of this app's other planning documents requires its own
 * context fields before anything else). `actingUid` must equal
 * `teacherUid` — the same "no submission on behalf of a different uid"
 * rule services/weeklyPlanSubmissionService.js's own create-path
 * already enforces (and this app's Firestore rules re-enforce as the
 * final boundary).
 *
 * Deliberately does NOT require `termId` or `linkedCurriculumUnitId` to
 * be non-null, even though both are named for validation in the Phase 2
 * brief:
 *   - `termId` — no term registry/UI exists anywhere in this app yet
 *     (see models/ChapterPlan.js's own header comment); requiring a
 *     value here would just force every caller to invent one.
 *   - `linkedCurriculumUnitId` — Phase 1's own explicit, approved
 *     design: nullable "by honest design," for a classroom whose Unit
 *     was hand-added rather than linked from a Curriculum Index (see
 *     that model's header comment). Requiring it here would make it
 *     impossible to create a Chapter Plan for exactly the case Phase 1
 *     documented as a real, expected limitation, not a bug.
 * Both are still "validated" in the sense that follows: if given, they
 * pass straight through to models/ChapterPlan.js's own constructor
 * unchanged; nothing here reinterprets, generates, or normalizes either
 * — the same "reference, never derive" principle this app already
 * applies to curriculumUnitId/conceptIds everywhere else.
 *
 * `templateVersion`, if given, must be a non-negative integer; if
 * omitted, defaults to CURRENT_CHAPTER_PLAN_TEMPLATE_VERSION (the same
 * default models/ChapterPlan.js's own constructor already applies —
 * repeated here only so an explicitly-invalid value is caught with a
 * clear error rather than silently stored).
 */
export function createChapterPlanDraft({
  actingUid,
  classroomId,
  teacherUid,
  gradeLabel,
  subjectId,
  termId = null,
  curriculumUnitId,
  linkedCurriculumUnitId = null,
  chapterName,
  numberOfLessonsDays = null,
  templateVersion,
} = {}) {
  if (isBlank(classroomId)) throw new Error('A Chapter Plan needs a classroomId.');
  if (isBlank(teacherUid)) throw new Error('A Chapter Plan needs a teacherUid — which Fellow this plan belongs to.');
  if (actingUid !== teacherUid) {
    throw new Error('Not authorized to create a Chapter Plan on behalf of a different Fellow — teacherUid must match the acting Fellow.');
  }
  if (isBlank(gradeLabel)) throw new Error('A Chapter Plan needs a gradeLabel.');
  if (isBlank(subjectId)) throw new Error('A Chapter Plan needs a subjectId.');
  if (isBlank(chapterName)) throw new Error('A Chapter Plan needs a chapterName.');
  if (isBlank(curriculumUnitId)) throw new Error('A Chapter Plan needs a curriculumUnitId — which chapter/unit this plan is for.');
  if (templateVersion !== undefined && (!Number.isInteger(templateVersion) || templateVersion < 0)) {
    throw new Error('templateVersion must be a non-negative integer.');
  }

  return createChapterPlan({
    classroomId,
    teacherUid,
    createdByUid: teacherUid,
    gradeLabel,
    subjectId,
    termId,
    curriculumUnitId,
    linkedCurriculumUnitId,
    chapterName,
    numberOfLessonsDays,
    templateVersion: templateVersion === undefined ? CURRENT_CHAPTER_PLAN_TEMPLATE_VERSION : templateVersion,
  });
}

// ---------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------

/** Merges only the fields actually passed — same convention as lessonPlanService.js's own updateContext(). Deliberately does NOT accept `classroomId`/`teacherUid`/`createdByUid` — those are this plan's own fixed identity, never repointed by a content edit (repointing "whose plan this is" is not an editing operation this app has any concept of, for any planning document). */
export function updateContext(chapterPlan, { gradeLabel, subjectId, termId, curriculumUnitId, linkedCurriculumUnitId, conceptIds, chapterName, numberOfLessonsDays } = {}) {
  assertEditable(chapterPlan);
  if (gradeLabel !== undefined) chapterPlan.gradeLabel = gradeLabel;
  if (subjectId !== undefined) chapterPlan.subjectId = subjectId;
  if (termId !== undefined) chapterPlan.termId = termId;
  if (curriculumUnitId !== undefined) chapterPlan.curriculumUnitId = curriculumUnitId;
  if (linkedCurriculumUnitId !== undefined) chapterPlan.linkedCurriculumUnitId = linkedCurriculumUnitId;
  if (conceptIds !== undefined) chapterPlan.conceptIds = conceptIds;
  if (chapterName !== undefined) chapterPlan.chapterName = chapterName;
  if (numberOfLessonsDays !== undefined) chapterPlan.numberOfLessonsDays = numberOfLessonsDays;
  touch(chapterPlan);
}

// ---------------------------------------------------------------------
// PURPOSE AND INTEGRATION
// ---------------------------------------------------------------------

/** Merges only the fields actually passed. `essentialQuestions`/`objectives`, when given, replace the whole array — same "caller supplies the full current list" convention services/lessonPlanService.js's own updateSelfOthersIndia()/updateHelpingEachOtherLearn() already use for their own non-Activity-shaped fields; no separate id-based add/update/remove is needed for a plain string array with no per-item identity to preserve. */
export function updatePurpose(chapterPlan, { whatsWorthLearning, whyDoesLearningMatter, importantConcepts, supplementaryResources, essentialQuestions, objectives } = {}) {
  assertEditable(chapterPlan);
  if (whatsWorthLearning !== undefined) chapterPlan.purpose.whatsWorthLearning = whatsWorthLearning;
  if (whyDoesLearningMatter !== undefined) chapterPlan.purpose.whyDoesLearningMatter = whyDoesLearningMatter;
  if (importantConcepts !== undefined) chapterPlan.purpose.importantConcepts = importantConcepts;
  if (supplementaryResources !== undefined) chapterPlan.purpose.supplementaryResources = supplementaryResources;
  if (essentialQuestions !== undefined) chapterPlan.purpose.essentialQuestions = essentialQuestions;
  if (objectives !== undefined) chapterPlan.purpose.objectives = objectives;
  touch(chapterPlan);
}

// ---------------------------------------------------------------------
// MASTERY
// ---------------------------------------------------------------------

export function updateMastery(chapterPlan, { endOfChapterShowcase, bookBackQuestionTypes, lsrwScope, vocabularyAndAnchorCharts } = {}) {
  assertEditable(chapterPlan);
  if (endOfChapterShowcase !== undefined) chapterPlan.mastery.endOfChapterShowcase = endOfChapterShowcase;
  if (bookBackQuestionTypes !== undefined) chapterPlan.mastery.bookBackQuestionTypes = bookBackQuestionTypes;
  if (lsrwScope !== undefined) chapterPlan.mastery.lsrwScope = lsrwScope;
  if (vocabularyAndAnchorCharts !== undefined) chapterPlan.mastery.vocabularyAndAnchorCharts = vocabularyAndAnchorCharts;
  touch(chapterPlan);
}

// ---------------------------------------------------------------------
// METHODS
// ---------------------------------------------------------------------

export function updateMethods(chapterPlan, { keyMethods, simplifiedText, revisionIdeas, resources } = {}) {
  assertEditable(chapterPlan);
  if (keyMethods !== undefined) chapterPlan.methods.keyMethods = keyMethods;
  if (simplifiedText !== undefined) chapterPlan.methods.simplifiedText = simplifiedText;
  if (revisionIdeas !== undefined) chapterPlan.methods.revisionIdeas = revisionIdeas;
  if (resources !== undefined) chapterPlan.methods.resources = resources;
  touch(chapterPlan);
}

// ---------------------------------------------------------------------
// Subject-specific — cpaIdeas (Mathematics), grammarMiniLesson
// (Literacy/English), or whatever else a future template config adds.
// Deliberately a free-merge, not a fixed field list — this file has no
// opinion on which subject gets which key; that's
// config/chapterPlanTemplateConfig.js's job (a later phase, not built
// yet — see the Phase 1 report's own note on this).
// ---------------------------------------------------------------------

/** Merges only the keys actually passed into `subjectSpecific` — never clears keys the caller didn't mention, so switching which fields are shown in the UI never silently discards ones the teacher already filled in under a different subject. */
export function updateSubjectSpecific(chapterPlan, updates = {}) {
  assertEditable(chapterPlan);
  chapterPlan.subjectSpecific = { ...chapterPlan.subjectSpecific, ...updates };
  touch(chapterPlan);
}

// ---------------------------------------------------------------------
// Resource links — see models/ChapterPlanResourceLink.js. A lightweight
// association operation only: this never creates, fetches, or mutates
// the underlying Resource itself (see services/resourceService.js/
// repositories/resourceRepository.js for that entity's own lifecycle) —
// exactly the "keep it as a lightweight association operation, do not
// create a second Resource system" Phase 2 direction.
// ---------------------------------------------------------------------

/** Appends one new resource reference — never a fixed count, same convention as lessonPlanService.js's own addLearningResource(). `classroomId` may be a DIFFERENT classroom than this plan's own (see models/ChapterPlanResourceLink.js's header comment) — nothing here checks or cares which; Firestore rules alone decide what that reference can or can't be used for. Returns the new link so the caller can immediately show it. */
export function addResourceLink(chapterPlan, { classroomId, resourceId, resourceType, addedBy = null } = {}) {
  assertEditable(chapterPlan);
  if (isBlank(classroomId) || isBlank(resourceId)) {
    throw new Error('A resource link needs both classroomId and resourceId.');
  }
  const link = createChapterPlanResourceLink({ classroomId, resourceId, resourceType, addedBy });
  chapterPlan.resourceLinks.push(link);
  touch(chapterPlan);
  return link;
}

/** Removes one resource reference by its own link id — never touches the underlying Resource document (see models/ChapterPlanResourceLink.js's own "cascades with its owner, never with the Resource" reasoning). A no-op if the link is already gone. */
export function removeResourceLink(chapterPlan, resourceLinkId) {
  assertEditable(chapterPlan);
  const before = chapterPlan.resourceLinks.length;
  chapterPlan.resourceLinks = chapterPlan.resourceLinks.filter((link) => link.id !== resourceLinkId);
  if (chapterPlan.resourceLinks.length < before) touch(chapterPlan);
}

/** One resource link by its own id, or null — a thin read helper for a caller that already has the plan in hand and just wants to look one link up, mirroring models/ChapterPlan.js's own findChapterPlanResourceLink() (re-exported here isn't necessary — callers may import that directly from the model — this wrapper exists only for symmetry with getChapterPlanResourceLinkIndex() below, used internally by removeResourceLink()'s own no-op check). */
export function findResourceLink(chapterPlan, resourceLinkId) {
  const index = getChapterPlanResourceLinkIndex(chapterPlan, resourceLinkId);
  return index === -1 ? null : chapterPlan.resourceLinks[index];
}

// ---------------------------------------------------------------------
// Spark references — see models/ChapterPlanSparkRef.js. Same
// "lightweight association operation" shape as the resource-link
// mutators above: never creates, fetches, or mutates the underlying
// Spark itself (see services/sparkService.js for that entity's own,
// entirely separate, creator-only lifecycle) — a reference here grants
// no ownership or edit rights over the Spark whatsoever, and adding one
// never touches the Spark document in any way.
// ---------------------------------------------------------------------

/** Every controlled section a Spark may be referenced against — re-exported from the model purely so a caller (a future UI) never has to import both models/ChapterPlan.js and services/chapterPlanService.js just to get this one enum. */
export { CHAPTER_PLAN_SPARK_SECTIONS };

function assertValidSparkSection(section) {
  if (!Object.values(CHAPTER_PLAN_SPARK_SECTIONS).includes(section)) {
    throw new Error(`"${section}" is not a section a Spark can be referenced against — must be one of: ${Object.values(CHAPTER_PLAN_SPARK_SECTIONS).join(', ')}.`);
  }
}

/**
 * Appends one new Spark reference — never a fixed count, same
 * convention as addResourceLink() above. `sparkId` may belong to (be
 * authored by) a DIFFERENT Fellow entirely — nothing here checks or
 * cares who created it; referencing it here never grants any ownership
 * or edit rights over that Spark, and this function never reads,
 * writes, or otherwise touches the Spark document itself, only this
 * plan's own `sparkRefs` array. Rejects a section outside
 * CHAPTER_PLAN_SPARK_SECTIONS, and rejects an exact duplicate
 * (same sparkId + same section already referenced — see
 * models/ChapterPlan.js's own hasChapterPlanSparkRef()); the SAME
 * sparkId in a DIFFERENT section is not a duplicate and is allowed, per
 * explicit product direction. Returns the new ref so the caller can
 * immediately show "Used in this Chapter Plan."
 */
export function addSparkRef(chapterPlan, { sparkId, section, addedBy = null } = {}) {
  assertEditable(chapterPlan);
  if (isBlank(sparkId)) throw new Error('A Spark reference needs a sparkId.');
  assertValidSparkSection(section);
  if (hasChapterPlanSparkRef(chapterPlan, sparkId, section)) {
    throw new Error('This Spark is already referenced in this section.');
  }
  const ref = createChapterPlanSparkRef({ sparkId, section, addedBy });
  chapterPlan.sparkRefs.push(ref);
  touch(chapterPlan);
  return ref;
}

/** Removes one Spark reference by its own ref id — removes ONLY this association; the canonical Spark document is never touched, deleted, or otherwise affected (see models/ChapterPlanSparkRef.js's own "cascades with its owner, never with the Spark" reasoning), and stays exactly as usable as before for this plan's other sections or any other Fellow's own Chapter Plan. A no-op if the ref is already gone. */
export function removeSparkRef(chapterPlan, sparkRefId) {
  assertEditable(chapterPlan);
  const before = chapterPlan.sparkRefs.length;
  chapterPlan.sparkRefs = chapterPlan.sparkRefs.filter((ref) => ref.id !== sparkRefId);
  if (chapterPlan.sparkRefs.length < before) touch(chapterPlan);
}

/** One Spark reference by its own id, or null — mirrors findResourceLink() above. */
export function findSparkRef(chapterPlan, sparkRefId) {
  const index = getChapterPlanSparkRefIndex(chapterPlan, sparkRefId);
  return index === -1 ? null : chapterPlan.sparkRefs[index];
}

/** Every Spark reference for one section, in the order they were added — the one query the Editor's own "Used in this Chapter Plan" list per section needs. */
export function getSparkRefsForSection(chapterPlan, section) {
  return (chapterPlan.sparkRefs || []).filter((ref) => ref.section === section);
}
