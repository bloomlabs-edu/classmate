/**
 * services/weeklyPlanValidationService.js
 *
 * Whether a Lesson's WEEKLY PLAN content is complete — the lightweight
 * tier described in docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md:
 * a concept, at least one real objective, and a Big Question. This is
 * deliberately a SEPARATE, independent readiness computation from
 * services/lessonPlanValidationService.js's own getLessonPlanReadiness()
 * — the whole point of the Weekly Plan / Detailed Lesson Plan split is
 * that these two are different questions about different documents
 * (Lesson vs LessonPlan), never one cumulative checklist. Pure and
 * dependency-free, matching that file's own "stays directly
 * unit-testable" convention.
 *
 * `missing` mirrors getLessonPlanReadiness()'s own `{ sectionKey,
 * message }` shape for consistency, even though nothing today attaches
 * reviewer comments to a Lesson — sectionKey values here are this
 * file's own (see WEEKLY_PLAN_SECTION_KEYS below), not
 * models/LessonPlan.js's LESSON_PLAN_SECTION_KEYS, since a Lesson's
 * "Concepts"/"Why" sections are not the same document.
 */

export const WEEKLY_PLAN_SECTION_KEYS = Object.freeze({
  CONCEPTS: 'concepts',
  WHY: 'why',
});

function isBlank(value) {
  return !value || !String(value).trim();
}

/**
 * `{ ready, missing: [{ sectionKey, message }] }` — `ready` is simply
 * `missing.length === 0`, same invariant getLessonPlanReadiness() keeps
 * for itself.
 */
export function getWeeklyPlanReadiness(lesson) {
  const missing = [];

  if (lesson.conceptIds.length === 0) {
    missing.push({ sectionKey: WEEKLY_PLAN_SECTION_KEYS.CONCEPTS, message: 'Add at least one Concept.' });
  }

  if (!lesson.objectives.some((objective) => !isBlank(objective.text))) {
    missing.push({ sectionKey: WEEKLY_PLAN_SECTION_KEYS.WHY, message: 'Add at least one objective.' });
  }
  if (isBlank(lesson.bigQuestion)) {
    missing.push({ sectionKey: WEEKLY_PLAN_SECTION_KEYS.WHY, message: 'Add a Big Question.' });
  }

  return { ready: missing.length === 0, missing };
}

/** Pure convenience wrapper — the Timetable's Period Detail panel just wants a boolean to decide whether "Build Detailed Lesson Plan" is enabled yet. */
export function isWeeklyPlanComplete(lesson) {
  return getWeeklyPlanReadiness(lesson).ready;
}

/**
 * "Has this Fellow started this period's Weekly Plan at all" — an ANY,
 * not ALL, check, deliberately the opposite shape from
 * getWeeklyPlanReadiness() above. Used only to distinguish the PM
 * dashboard's derived "Not started" from "Draft" BEFORE any
 * models/WeeklyPlanSubmission.js document exists (see
 * services/weeklyPlanSubmissionService.js's own
 * getWeekPlanDisplayStatus()) — once a real submission document
 * exists, its own stored `status` is used instead and this function is
 * no longer consulted for that period. Never used to gate submission
 * itself: a Fellow may submit a Weekly Plan with only some periods
 * touched, per explicit product direction (inform, never silently
 * lock — the same philosophy already established for the Lesson Plan
 * Builder's own readiness checks).
 */
export function hasMeaningfulWeeklyPlanContent(lesson) {
  if (!lesson) return false;
  return Boolean(
    lesson.curriculumUnitId ||
      (lesson.conceptIds && lesson.conceptIds.length > 0) ||
      (lesson.objectives || []).some((objective) => !isBlank(objective.text)) ||
      !isBlank(lesson.bigQuestion) ||
      !isBlank(lesson.planSummary) ||
      !isBlank(lesson.assessmentNote)
  );
}
