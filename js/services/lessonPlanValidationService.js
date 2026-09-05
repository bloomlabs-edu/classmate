/**
 * services/lessonPlanValidationService.js
 *
 * Whether a LessonPlan is ready to submit for review — understanding
 * the required CONTENT STRUCTURE (per the "5 Questions" framework
 * this whole feature is built around), never a bare field count. Pure
 * and dependency-free (no Firestore import), matching this app's own
 * established "stays directly unit-testable" convention (see
 * services/timetableDisplayService.js's own header comment for the
 * same reasoning applied elsewhere).
 *
 * Messaging is deliberately specific and encouraging, per explicit
 * product direction — "Your lesson is almost ready. Add a Student
 * Action to the Spark," never "Error: field 17 required." Each
 * missing item carries the same `sectionKey` (see models/LessonPlan.js's
 * own LESSON_PLAN_SECTION_KEYS / buildActivitySectionKey()) a reviewer
 * comment would use, so the builder UI can point at exactly the same
 * spot for both "here's what's missing" and "here's what the reviewer
 * said" — one addressing scheme, not two.
 */

import { LESSON_PLAN_SECTION_KEYS } from '../models/LessonPlan.js';
import { buildActivitySectionKey } from './lessonPlanReviewService.js';

function isBlank(value) {
  return !value || !String(value).trim();
}

/**
 * `{ ready, missing: [{ sectionKey, message }] }` — `ready` is simply
 * `missing.length === 0`, never computed separately, so the two can
 * never disagree with each other.
 */
export function getLessonPlanReadiness(lessonPlan) {
  const missing = [];

  // CONCEPT (Phase 4) — required before submission, per explicit product
  // direction, even though concept selection itself stays optional/
  // flexible while the teacher is still building the lesson (this is a
  // submit-time gate, not a field the Builder blocks editing without —
  // see ui/views/LessonPlanBuilderView.js's own Concepts field, which
  // never disables itself based on readiness). Without at least one
  // concept, an approved lesson would have nothing for Teaching Ideas
  // discovery (services/teachingIdeasService.js) to key off.
  if (lessonPlan.conceptIds.length === 0) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.CONTEXT, message: 'Add at least one Concept before submitting this lesson for review.' });
  }

  // 1. WHY
  if (isBlank(lessonPlan.lessonObjective)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.WHY, message: 'Add a lesson objective.' });
  }
  if (isBlank(lessonPlan.bigQuestion)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.WHY, message: 'Add a Big Question.' });
  }
  if (!lessonPlan.swbatObjectives.some((objective) => !isBlank(objective))) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.WHY, message: 'Add at least one SWBAT objective.' });
  }

  // 2. SELF / OTHERS / INDIA
  const { self, others, india } = lessonPlan.selfOthersIndia;
  if (isBlank(self) && isBlank(others) && isBlank(india)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA, message: 'Add at least one of Self, Others, or India.' });
  }

  // 3. ASSESSMENT
  if (!lessonPlan.assessments.some((item) => !isBlank(item.description))) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.ASSESSMENT, message: 'Add at least one assessment or evidence item.' });
  }

  // 4. FUN, FAST, EFFECTIVE — Spark
  if (isBlank(lessonPlan.spark.title)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.SPARK, message: 'Add a title for the Spark.' });
  }
  if (isBlank(lessonPlan.spark.teacherAction)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.SPARK, message: 'Add a Teacher Action to the Spark.' });
  }
  if (isBlank(lessonPlan.spark.studentAction)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.SPARK, message: 'Add a Student Action to the Spark.' });
  }

  // 4. FUN, FAST, EFFECTIVE — Activities (dynamic count, never assumed)
  if (lessonPlan.activities.length === 0) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.SPARK, message: 'Add at least one Learning Activity.' });
  }
  lessonPlan.activities.forEach((activity, index) => {
    const sectionKey = buildActivitySectionKey(activity.id);
    const label = `Activity ${index + 1}`;
    if (isBlank(activity.title)) missing.push({ sectionKey, message: `Add a title to ${label}.` });
    if (isBlank(activity.teacherAction)) missing.push({ sectionKey, message: `Add a Teacher Action to ${label}.` });
    if (isBlank(activity.studentAction)) missing.push({ sectionKey, message: `Add a Student Action to ${label}.` });
  });

  // 5. HELPING EACH OTHER LEARN
  if (isBlank(lessonPlan.pairExplanation)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.PAIR_EXPLANATION, message: 'Add how students will explain to a pair.' });
  }
  if (isBlank(lessonPlan.finalQuestion)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.FINAL_QUESTION, message: 'Add a final question.' });
  }
  if (isBlank(lessonPlan.teacherLookFors)) {
    missing.push({ sectionKey: LESSON_PLAN_SECTION_KEYS.TEACHER_LOOK_FORS, message: 'Add what you’ll look for as the teacher.' });
  }

  return { ready: missing.length === 0, missing };
}
