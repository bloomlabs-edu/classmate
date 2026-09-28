/**
 * services/sparkService.js
 *
 * Business logic for Spark (see models/Spark.js) — an independently
 * authored, reusable teaching idea, NOT an extracted
 * `LessonPlan.spark` field, NOT a Teaching Idea projection, and NOT a
 * Chapter Plan sub-object (see that model's own header comment for the
 * full disambiguation).
 *
 * Deliberately Firestore-free, same "stays directly unit-testable"
 * convention services/lessonPlanReviewService.js/
 * services/weeklyPlanSubmissionService.js/services/teachingIdeasService.js
 * all already establish for the identical reason: every function here
 * takes plain data in and returns plain data out, so this file can be
 * exercised by the plain `node --test` suite with no browser/URL-import
 * shim — importing repositories/sparkRepository.js at module scope
 * (which itself imports the Firebase SDK from a `https://` URL) would
 * make this ENTIRE file fail to even load outside a browser, per
 * Node's ESM loader (`ERR_UNSUPPORTED_ESM_URL_SCHEME`), taking every
 * pure function in it down too — confirmed by testing directly rather
 * than assumed. A caller that needs both this file's pure logic AND the
 * actual Firestore read/write imports both itself and combines them —
 * e.g.:
 *
 *   const spark = sparkService.createSpark({ title, createdByUid, ... });
 *   await sparkRepository.saveSpark(spark);
 *
 *   const fetched = await sparkRepository.getSparksForLinkedCurriculumUnitId(id);
 *   const relevant = sparkService.filterSparks(fetched, { subjectId, conceptId });
 *
 * — two small, independently-testable steps, never a single opaque
 * convenience function that hides which part is the real Firestore
 * query and which part is plain array logic (see
 * services/teachingIdeasService.js's own identical header-comment
 * reasoning for extractElementsForDiscovery() vs
 * repositories/teachingIdeasRepository.js).
 *
 * ---------------------------------------------------------------------
 * Creator-only, no exceptions — enforced here AND by firestore.rules
 * ---------------------------------------------------------------------
 *
 * canModifySpark()/assertCanModifySpark() below are the one business
 * rule every mutation in this file (and every future caller) must
 * check first — a friendly, immediate, user-facing error, never a
 * replacement for firestore.rules' own `sparks` block (the actual
 * security boundary; see that block's own comment). There is no PM
 * override and no collaborative co-editing anywhere in this file, per
 * explicit product direction — a Spark's provenance ("Created by:
 * [Fellow]") must stay trustworthy for every OTHER Fellow who ever
 * reuses it, and this is the one thing that guarantees it.
 * updateSpark() below deliberately does not even ACCEPT
 * `createdByUid`/`createdAt`/`id` as updatable fields — not merely
 * validated away, but never destructured from the input at all, so
 * there is no code path here that could even attempt to reassign them.
 */

import { createSpark as buildSpark, createSparkResourceRef } from '../models/Spark.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

function isBlank(value) {
  return !value || !String(value).trim();
}

/** Whether `uid` may update/delete this Spark — creator only, no exceptions. Exported (not just an internal assertion) so a future UI can use it to show/hide edit controls, the same "boolean predicate + separate assert" shape services/chapterPlanReviewService.js's own canReviewChapterPlan()/canApproveChapterPlan() already establish. */
export function canModifySpark(spark, uid) {
  return Boolean(uid) && spark.createdByUid === uid;
}

function assertCanModifySpark(spark, uid) {
  if (!canModifySpark(spark, uid)) {
    throw new Error('Not authorized — only the Fellow who created this Spark may change it.');
  }
}

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------

/**
 * Validates and builds a brand-new Spark (not yet persisted — see this
 * file's own header comment on why the actual
 * repositories/sparkRepository.js's own saveSpark() call is the
 * caller's job). Required: `title` and `createdByUid` — a Spark with
 * no title is useless to browse, and provenance ("Created by:
 * [Fellow]") must exist from the moment of creation, never backfilled
 * later. Every other field is genuinely optional, per explicit product
 * direction ("do not make all of these mandatory" — see
 * models/Spark.js's own header comment on `sparkType` for the same
 * principle applied to every other optional field here).
 */
export function createSpark({
  title,
  description,
  sparkType,
  instructions,
  createdByUid,
  subjectIds,
  gradeLevels,
  conceptIds,
  curriculumUnitIds,
  linkedCurriculumUnitId,
  estimatedTime,
  resourceRefs,
  visibility,
  tags,
} = {}) {
  if (isBlank(title)) throw new Error('A Spark needs a title.');
  if (isBlank(createdByUid)) throw new Error('A Spark needs createdByUid — which Fellow authored it.');

  return buildSpark({
    title,
    description,
    sparkType,
    instructions,
    createdByUid,
    subjectIds,
    gradeLevels,
    conceptIds,
    curriculumUnitIds,
    linkedCurriculumUnitId,
    estimatedTime,
    resourceRefs,
    visibility,
    tags,
  });
}

// ---------------------------------------------------------------------
// Update — creator only; provenance fields not even accepted as input.
// Mutates `spark` in place and returns it — same "mutate now, caller
// saves" convention services/lessonPlanService.js/
// services/chapterPlanService.js already use; persisting the result
// via repositories/sparkRepository.js's own saveSpark() is the caller's
// job.
// ---------------------------------------------------------------------

/** Merges only the fields actually passed. */
export function updateSpark(spark, uid, { title, description, sparkType, instructions, subjectIds, gradeLevels, conceptIds, curriculumUnitIds, linkedCurriculumUnitId, estimatedTime, visibility, tags } = {}) {
  assertCanModifySpark(spark, uid);

  if (title !== undefined) spark.title = title;
  if (description !== undefined) spark.description = description;
  if (sparkType !== undefined) spark.sparkType = sparkType;
  if (instructions !== undefined) spark.instructions = instructions;
  if (subjectIds !== undefined) spark.subjectIds = subjectIds;
  if (gradeLevels !== undefined) spark.gradeLevels = gradeLevels;
  if (conceptIds !== undefined) spark.conceptIds = conceptIds;
  if (curriculumUnitIds !== undefined) spark.curriculumUnitIds = curriculumUnitIds;
  if (linkedCurriculumUnitId !== undefined) spark.linkedCurriculumUnitId = linkedCurriculumUnitId;
  if (estimatedTime !== undefined) spark.estimatedTime = estimatedTime;
  if (visibility !== undefined) spark.visibility = visibility;
  if (tags !== undefined) spark.tags = tags;

  spark.updatedAt = getCurrentIsoDate();
  return spark;
}

/** Appends one resource reference — creator only. `classroomId` may be a DIFFERENT classroom than any of the creator's own (see models/ChapterPlanResourceLink.js's identical reasoning, reused here for Spark's own `resourceRefs`) — this never grants any write access to that Resource, only stores the pointer. */
export function addSparkResourceRef(spark, uid, { classroomId, resourceId } = {}) {
  assertCanModifySpark(spark, uid);
  if (isBlank(classroomId) || isBlank(resourceId)) {
    throw new Error('A Spark resource reference needs both classroomId and resourceId.');
  }
  const ref = createSparkResourceRef({ classroomId, resourceId });
  spark.resourceRefs.push(ref);
  spark.updatedAt = getCurrentIsoDate();
  return ref;
}

/** Removes one resource reference — creator only. Matches by (classroomId, resourceId) pair, since a plain ref (see models/Spark.js's own createSparkResourceRef()) carries no id of its own to key on. */
export function removeSparkResourceRef(spark, uid, { classroomId, resourceId } = {}) {
  assertCanModifySpark(spark, uid);
  const before = spark.resourceRefs.length;
  spark.resourceRefs = spark.resourceRefs.filter((ref) => !(ref.classroomId === classroomId && ref.resourceId === resourceId));
  if (spark.resourceRefs.length < before) spark.updatedAt = getCurrentIsoDate();
}

// ---------------------------------------------------------------------
// Delete — creator only. There is no content to mutate for a delete, so
// this is purely the authorization gate; the caller follows a passing
// check with repositories/sparkRepository.js's own deleteSpark(spark.id).
// ---------------------------------------------------------------------

export function assertCanDeleteSpark(spark, uid) {
  assertCanModifySpark(spark, uid);
}

// ---------------------------------------------------------------------
// Discovery — pure filtering only; see this file's own header comment
// for how a caller composes this with
// repositories/sparkRepository.js's own getSparksForLinkedCurriculumUnitId()
// to get the actual "Browse Sparks for this chapter" result.
// ---------------------------------------------------------------------

function matchesSearchText(text, needle) {
  return String(text ?? '').toLowerCase().includes(needle);
}

/** Pure filtering over an already-fetched Spark list — same reasoning services/teachingIdeasService.js's own filterElements() doc comment already gives. Composable: pass every filter you have, or just one. */
export function filterSparks(sparks, { sparkType, subjectId, gradeLevel, conceptId, searchText } = {}) {
  let result = sparks;
  if (sparkType) result = result.filter((spark) => spark.sparkType === sparkType);
  if (subjectId) result = result.filter((spark) => (spark.subjectIds || []).includes(subjectId));
  if (gradeLevel) result = result.filter((spark) => (spark.gradeLevels || []).includes(gradeLevel));
  if (conceptId) result = result.filter((spark) => (spark.conceptIds || []).includes(conceptId));
  if (searchText && searchText.trim()) {
    const needle = searchText.trim().toLowerCase();
    result = result.filter(
      (spark) =>
        matchesSearchText(spark.title, needle) ||
        matchesSearchText(spark.description, needle) ||
        matchesSearchText(spark.instructions, needle) ||
        (spark.tags || []).some((tag) => matchesSearchText(tag, needle))
    );
  }
  return result;
}
