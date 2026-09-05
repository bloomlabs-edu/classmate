/**
 * services/lessonPlanService.js
 *
 * Content mutation for a LessonPlan's own "5 Questions" sections and,
 * most importantly, its `activities[]` — the ordered list of
 * first-class Activity objects this whole feature is built around
 * (see models/LessonPlan.js's own header comment). Every function here
 * follows the exact same "mutate-then-caller-saves" convention every
 * other service in this app already uses (see
 * services/readingContentService.js's own header comment) — nothing
 * here calls lessonPlanRepository.saveLessonPlan() or
 * workspaceService.save() itself; the caller (the builder UI) does
 * that once, after whichever mutation just ran.
 *
 * Reordering (moveActivityUp/Down) deliberately does NOT bump
 * `updatedAt` — shuffling isn't writing, the identical reasoning
 * services/readingContentService.js's own moveBlockUp/Down already
 * documents for Reading blocks.
 *
 * Duplicating an Activity deep-clones its FULL structure (including
 * `differentiation`, if present) with a fresh id, per explicit product
 * direction: "if an activity is duplicated, its complete structure is
 * duplicated." Deleting an Activity removes that one array entry
 * entirely — "if an activity is deleted, all of its associated content
 * is deleted together" is automatically true here, since there is no
 * separate collection/field anywhere else that could hold orphaned
 * pieces of it. Duplicating deliberately does NOT copy `activeComments`/
 * `reviewHistory` targeting the original — a comment is always about a
 * specific activityId, and the duplicate is a different id, so nothing
 * has to be filtered out; a reviewer's note on the original was never
 * about the copy. Deleting DOES need one explicit line (see
 * deleteActivity() below) — comments live in a different array
 * entirely, so removing the activity alone would silently strand them.
 */

import {
  createLessonPlanActivity,
  createLessonPlanDifferentiation,
  createLessonPlanAssessmentItem,
  createLessonPlanSourceRef,
  getLessonPlanActivityIndex,
  findLessonPlanActivity,
} from '../models/LessonPlan.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { buildActivitySectionKey } from './lessonPlanReviewService.js';

function touch(lessonPlan) {
  lessonPlan.updatedAt = getCurrentIsoDate();
}

// ---------------------------------------------------------------------
// Context (Grade / Subject / Unit / Topic)
// ---------------------------------------------------------------------

/** Merges only the fields actually passed — a caller updating just `topic` never has to know or re-supply the others. */
export function updateContext(lessonPlan, { subjectId, curriculumUnitId, conceptIds, gradeLabel, topic } = {}) {
  if (subjectId !== undefined) lessonPlan.subjectId = subjectId;
  if (curriculumUnitId !== undefined) lessonPlan.curriculumUnitId = curriculumUnitId;
  if (conceptIds !== undefined) lessonPlan.conceptIds = conceptIds;
  if (gradeLabel !== undefined) lessonPlan.gradeLabel = gradeLabel;
  if (topic !== undefined) lessonPlan.topic = topic;
  touch(lessonPlan);
}

// ---------------------------------------------------------------------
// 1. WHY
// ---------------------------------------------------------------------

export function updateWhy(lessonPlan, { lessonObjective, bigQuestion } = {}) {
  if (lessonObjective !== undefined) lessonPlan.lessonObjective = lessonObjective;
  if (bigQuestion !== undefined) lessonPlan.bigQuestion = bigQuestion;
  touch(lessonPlan);
}

export function addSwbatObjective(lessonPlan, text = '') {
  lessonPlan.swbatObjectives.push(text);
  touch(lessonPlan);
}

export function updateSwbatObjective(lessonPlan, index, text) {
  if (index < 0 || index >= lessonPlan.swbatObjectives.length) return;
  lessonPlan.swbatObjectives[index] = text;
  touch(lessonPlan);
}

export function removeSwbatObjective(lessonPlan, index) {
  if (index < 0 || index >= lessonPlan.swbatObjectives.length) return;
  lessonPlan.swbatObjectives.splice(index, 1);
  touch(lessonPlan);
}

// ---------------------------------------------------------------------
// 2. SELF / OTHERS / INDIA
// ---------------------------------------------------------------------

export function updateSelfOthersIndia(lessonPlan, { self, others, india } = {}) {
  if (self !== undefined) lessonPlan.selfOthersIndia.self = self;
  if (others !== undefined) lessonPlan.selfOthersIndia.others = others;
  if (india !== undefined) lessonPlan.selfOthersIndia.india = india;
  touch(lessonPlan);
}

// ---------------------------------------------------------------------
// 3. ASSESSMENT — a dynamic list of evidence items, never one bare field
// ---------------------------------------------------------------------

export function addAssessmentItem(lessonPlan, description = '') {
  const item = createLessonPlanAssessmentItem({ description });
  lessonPlan.assessments.push(item);
  touch(lessonPlan);
  return item;
}

export function updateAssessmentItem(lessonPlan, itemId, description) {
  const item = lessonPlan.assessments.find((candidate) => candidate.id === itemId);
  if (!item) return;
  item.description = description;
  touch(lessonPlan);
}

export function removeAssessmentItem(lessonPlan, itemId) {
  const before = lessonPlan.assessments.length;
  lessonPlan.assessments = lessonPlan.assessments.filter((item) => item.id !== itemId);
  if (lessonPlan.assessments.length < before) touch(lessonPlan);
}

// ---------------------------------------------------------------------
// 4. FUN, FAST, EFFECTIVE — Spark + dynamic Activities
// ---------------------------------------------------------------------

export function updateSpark(lessonPlan, { title, teacherAction, studentAction } = {}) {
  if (title !== undefined) lessonPlan.spark.title = title;
  if (teacherAction !== undefined) lessonPlan.spark.teacherAction = teacherAction;
  if (studentAction !== undefined) lessonPlan.spark.studentAction = studentAction;
  touch(lessonPlan);
}

/** Appends one new, blank Activity — never a fixed count, per explicit product direction. Returns the new Activity so the caller (the builder UI) can immediately focus/expand it. */
export function addActivity(lessonPlan) {
  const activity = createLessonPlanActivity();
  lessonPlan.activities.push(activity);
  touch(lessonPlan);
  return activity;
}

export function updateActivity(lessonPlan, activityId, { title, teacherAction, studentAction } = {}) {
  const activity = findLessonPlanActivity(lessonPlan, activityId);
  if (!activity) return;
  if (title !== undefined) activity.title = title;
  if (teacherAction !== undefined) activity.teacherAction = teacherAction;
  if (studentAction !== undefined) activity.studentAction = studentAction;
  touch(lessonPlan);
}

/**
 * Removes one Activity entirely — its differentiation (if any) is part
 * of the same array entry, so nothing is left orphaned. Also drops any
 * still-OPEN comment addressed to this activity (whole-activity or a
 * sub-field like `differentiation.greenBucket`) from `activeComments` —
 * an actionable "fix this" note about content that no longer exists is
 * dead weight a teacher/reviewer could never resolve. Deliberately
 * leaves `reviewHistory` completely untouched: a past round's frozen
 * comment snapshot ("in round 1, the reviewer said X about that
 * activity") stays historically true even after the activity is later
 * deleted — see this file's own header comment and models/LessonPlan.js's
 * append-only reviewHistory doc comment.
 */
export function deleteActivity(lessonPlan, activityId) {
  const before = lessonPlan.activities.length;
  lessonPlan.activities = lessonPlan.activities.filter((activity) => activity.id !== activityId);
  if (lessonPlan.activities.length === before) return;

  const targetPrefix = buildActivitySectionKey(activityId);
  lessonPlan.activeComments = lessonPlan.activeComments.filter(
    (comment) => comment.sectionKey !== targetPrefix && !comment.sectionKey.startsWith(`${targetPrefix}:`)
  );
  touch(lessonPlan);
}

/** Duplicates one Activity's COMPLETE structure (title, TA, SA, and differentiation if present) with a fresh id, inserted immediately after the original — "if an activity is duplicated, its complete structure is duplicated," per explicit product direction. Returns the new Activity. */
export function duplicateActivity(lessonPlan, activityId) {
  const index = getLessonPlanActivityIndex(lessonPlan, activityId);
  if (index === -1) return null;
  const original = lessonPlan.activities[index];
  const duplicate = createLessonPlanActivity({
    title: original.title,
    teacherAction: original.teacherAction,
    studentAction: original.studentAction,
    differentiation: original.differentiation ? { ...original.differentiation } : null,
  });
  lessonPlan.activities.splice(index + 1, 0, duplicate);
  touch(lessonPlan);
  return duplicate;
}

/** Swaps an Activity with the one before it. No-op at the top of the list. Not a content edit (see this file's own header comment), so it doesn't bump updatedAt. */
export function moveActivityUp(lessonPlan, activityId) {
  const index = getLessonPlanActivityIndex(lessonPlan, activityId);
  if (index <= 0) return;
  [lessonPlan.activities[index - 1], lessonPlan.activities[index]] = [lessonPlan.activities[index], lessonPlan.activities[index - 1]];
}

/** Swaps an Activity with the one after it. No-op at the bottom of the list. Same "not a content edit" reasoning as moveActivityUp(). */
export function moveActivityDown(lessonPlan, activityId) {
  const index = getLessonPlanActivityIndex(lessonPlan, activityId);
  if (index === -1 || index >= lessonPlan.activities.length - 1) return;
  [lessonPlan.activities[index], lessonPlan.activities[index + 1]] = [lessonPlan.activities[index + 1], lessonPlan.activities[index]];
}

/** Progressive disclosure: reveals the Red Bucket / Green Bucket / Others fields for one Activity — a no-op if they're already visible (never resets existing differentiation text). */
export function addActivityDifferentiation(lessonPlan, activityId) {
  const activity = findLessonPlanActivity(lessonPlan, activityId);
  if (!activity || activity.differentiation) return;
  activity.differentiation = createLessonPlanDifferentiation();
  touch(lessonPlan);
}

/** Collapses differentiation back to `null` for one Activity — the teacher's own explicit "remove differentiation" action, not something any other mutation triggers as a side effect. */
export function removeActivityDifferentiation(lessonPlan, activityId) {
  const activity = findLessonPlanActivity(lessonPlan, activityId);
  if (!activity || !activity.differentiation) return;
  activity.differentiation = null;
  touch(lessonPlan);
}

export function updateActivityDifferentiation(lessonPlan, activityId, { redBucket, greenBucket, others } = {}) {
  const activity = findLessonPlanActivity(lessonPlan, activityId);
  if (!activity || !activity.differentiation) return;
  if (redBucket !== undefined) activity.differentiation.redBucket = redBucket;
  if (greenBucket !== undefined) activity.differentiation.greenBucket = greenBucket;
  if (others !== undefined) activity.differentiation.others = others;
  touch(lessonPlan);
}

// ---------------------------------------------------------------------
// 5. HELPING EACH OTHER LEARN
// ---------------------------------------------------------------------

export function updateHelpingEachOtherLearn(lessonPlan, { pairExplanation, finalQuestion, teacherLookFors } = {}) {
  if (pairExplanation !== undefined) lessonPlan.pairExplanation = pairExplanation;
  if (finalQuestion !== undefined) lessonPlan.finalQuestion = finalQuestion;
  if (teacherLookFors !== undefined) lessonPlan.teacherLookFors = teacherLookFors;
  touch(lessonPlan);
}

// ---------------------------------------------------------------------
// Repository provenance (Phase 4's own copy-in flows call this; kept
// here rather than a separate file since it's one more `sourceElementRefs`
// mutator alongside every other section mutator above)
// ---------------------------------------------------------------------

/** Records that this plan's Spark/an Activity was copied FROM somewhere — a Resource or a Teaching Idea — provenance only, never a live link (see models/LessonPlan.js's own createLessonPlanSourceRef() doc comment). Call this alongside whatever code actually pushes the copied content in; this function only records where it came from. */
export function recordSourceElement(lessonPlan, { resourceId, sourceLessonPlanId, sourceActivityId, elementType }) {
  lessonPlan.sourceElementRefs.push(createLessonPlanSourceRef({ resourceId, sourceLessonPlanId, sourceActivityId, elementType }));
  touch(lessonPlan);
}

// ---------------------------------------------------------------------
// Teaching Ideas copy-in (Phase 4) — each function does exactly two
// things, always together: push the copied content in as ordinary,
// freely-editable lesson content (a fresh id where one applies, same
// as duplicateActivity()'s own convention), and record where it came
// from via recordSourceElement() above. Content and provenance are
// always written in the same call so a caller can never do one without
// the other. None of these read the source LessonPlan itself — the
// caller (the Builder's "From Teaching Ideas" picker) already has the
// copied content in hand from services/teachingIdeasService.js; this
// file only ever deals with the DESTINATION plan.
// ---------------------------------------------------------------------

/** Copies a Teaching Idea Activity in as a brand-new Activity (own id, deep-cloned differentiation) — behaves exactly like a hand-authored Activity from the moment it lands; see duplicateActivity()'s own identical deep-clone reasoning above. */
export function addActivityFromTeachingIdea(lessonPlan, { title, teacherAction, studentAction, differentiation }, { sourceLessonPlanId, sourceActivityId }) {
  const activity = createLessonPlanActivity({
    title,
    teacherAction,
    studentAction,
    differentiation: differentiation ? { ...differentiation } : null,
  });
  lessonPlan.activities.push(activity);
  recordSourceElement(lessonPlan, { sourceLessonPlanId, sourceActivityId, elementType: 'activity' });
  return activity;
}

/** Copies a Teaching Idea Spark in, overwriting this plan's own Spark fields — a plan has exactly one Spark, so "copy in" means "replace," the same way a teacher retyping it by hand would. */
export function applySparkFromTeachingIdea(lessonPlan, { title, teacherAction, studentAction }, { sourceLessonPlanId }) {
  lessonPlan.spark = { title, teacherAction, studentAction };
  recordSourceElement(lessonPlan, { sourceLessonPlanId, sourceActivityId: null, elementType: 'spark' });
  touch(lessonPlan);
}

/** Copies a Teaching Idea assessment/evidence description in as a new dynamic list item — same shape as addAssessmentItem() above, plus provenance. */
export function addAssessmentItemFromTeachingIdea(lessonPlan, description, { sourceLessonPlanId }) {
  const item = addAssessmentItem(lessonPlan, description);
  recordSourceElement(lessonPlan, { sourceLessonPlanId, sourceActivityId: null, elementType: 'assessment' });
  return item;
}

/** Copies a Teaching Idea Question in — `field` is 'bigQuestion' or 'finalQuestion' (the only two single-question fields this model has; see models/LessonPlan.js's own LESSON_PLAN_SECTION_KEYS). Replaces that one field, same "a plan has exactly one, so copy-in means replace" reasoning as the Spark above. */
export function applyQuestionFromTeachingIdea(lessonPlan, field, text, { sourceLessonPlanId }) {
  if (field === 'bigQuestion') lessonPlan.bigQuestion = text;
  else if (field === 'finalQuestion') lessonPlan.finalQuestion = text;
  recordSourceElement(lessonPlan, { sourceLessonPlanId, sourceActivityId: null, elementType: 'question' });
  touch(lessonPlan);
}

/**
 * Copies a Teaching Idea differentiation strategy into ONE bucket
 * (`bucket` is 'redBucket'/'greenBucket'/'others') of a specific
 * Activity ALREADY in this plan — per explicit Phase 4 product
 * direction, a differentiation strategy is independently reusable,
 * never tied to copying its sibling buckets along with it. Reveals
 * the differentiation fields first if this Activity doesn't have them
 * yet (same progressive-disclosure entry point addActivityDifferentiation()
 * already establishes), then sets only the one requested bucket —
 * the other two stay exactly as they were (blank, or whatever the
 * teacher already wrote).
 */
export function applyDifferentiationBucketFromTeachingIdea(lessonPlan, activityId, bucket, text, { sourceLessonPlanId, sourceActivityId }) {
  const activity = findLessonPlanActivity(lessonPlan, activityId);
  if (!activity) return;
  if (!activity.differentiation) activity.differentiation = createLessonPlanDifferentiation();
  activity.differentiation[bucket] = text;
  recordSourceElement(lessonPlan, { sourceLessonPlanId, sourceActivityId, elementType: 'differentiation' });
  touch(lessonPlan);
}
