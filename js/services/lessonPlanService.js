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
 * pieces of it.
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

/** Removes one Activity entirely — its differentiation (if any) is part of the same array entry, so nothing is left orphaned. */
export function deleteActivity(lessonPlan, activityId) {
  const before = lessonPlan.activities.length;
  lessonPlan.activities = lessonPlan.activities.filter((activity) => activity.id !== activityId);
  if (lessonPlan.activities.length < before) touch(lessonPlan);
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

/** Records that this plan's Spark/an Activity was copied FROM a repository Resource — provenance only, never a live link (see models/LessonPlan.js's own createLessonPlanSourceRef() doc comment). Call this alongside whatever code actually pushes the copied Spark/Activity in; this function only records where it came from. */
export function recordSourceElement(lessonPlan, { resourceId, elementType }) {
  lessonPlan.sourceElementRefs.push(createLessonPlanSourceRef({ resourceId, elementType }));
  touch(lessonPlan);
}
