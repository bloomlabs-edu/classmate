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
