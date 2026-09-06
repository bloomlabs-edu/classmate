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
import { buildActivitySectionKey, getActivityIdFromSectionKey } from './lessonPlanReviewService.js';

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

/**
 * The guided-building STAGES ui/views/LessonPlanBuilderView.js's own
 * progressive-disclosure UI walks through, in order — Subject and
 * Schedule aren't listed here at all, since neither is gated by
 * submission readiness (Concept is the earliest real requirement
 * above), so neither has a "completion" this function needs to
 * define. Grouped exactly along the same sectionKeys
 * getLessonPlanReadiness() already checks — see stageForMissingItem()
 * below — so the Builder's progress indicator and "what's the next
 * incomplete stage" logic never invent a second definition of "done."
 *
 * PURPOSE/CONNECTION/SHOWCASE/EXPERIENCE/HELPING are exactly the real
 * "5 Questions" lesson-planning framework this whole feature is named
 * after (see models/LessonPlan.js's own header comment) — CONCEPT is
 * the one stage that isn't literally one of the 5 Questions, but a
 * required prerequisite before Question 1 can mean anything (a lesson
 * has to be ABOUT some concept first).
 */
export const LESSON_PLAN_STAGES = Object.freeze({
  CONCEPT: 'concept',
  PURPOSE: 'purpose', // Q1: Why are students learning what they're learning today?
  CONNECTION: 'connection', // Q2: Will it advance Self, Others, and India?
  SHOWCASE: 'showcase', // Q3: Are students showcasing learning and applying it in and beyond class?
  EXPERIENCE: 'experience', // Q4: Is it fun, fast, effective?
  HELPING: 'helping', // Q5: Are students helping me and others learn?
});

/**
 * Which guided stage one getLessonPlanReadiness() `missing` entry
 * belongs to — a direct, 1:1 mapping onto the real 5 Questions
 * framework (see LESSON_PLAN_STAGES's own doc comment just above):
 * Showcase is Assessment alone (Q3); Experience is Spark + every
 * Activity alone (Q4, "is it fun/fast/effective" — never anything
 * about helping others learn); Helping bundles Pair Explanation +
 * Final Question + Teacher Look-Fors (Q5's own three fields,
 * unchanged, just co-located under their real question rather than
 * split across two other stages). The underlying fields, labels, and
 * `LESSON_PLAN_SECTION_KEYS` themselves are completely unchanged —
 * this only changes which UI stage each one's completion counts
 * toward.
 */
function stageForMissingItem({ sectionKey }) {
  if (sectionKey === LESSON_PLAN_SECTION_KEYS.CONTEXT) return LESSON_PLAN_STAGES.CONCEPT;
  if (sectionKey === LESSON_PLAN_SECTION_KEYS.WHY) return LESSON_PLAN_STAGES.PURPOSE;
  if (sectionKey === LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA) return LESSON_PLAN_STAGES.CONNECTION;
  if (sectionKey === LESSON_PLAN_SECTION_KEYS.ASSESSMENT) return LESSON_PLAN_STAGES.SHOWCASE;
  if (sectionKey === LESSON_PLAN_SECTION_KEYS.SPARK || getActivityIdFromSectionKey(sectionKey)) {
    return LESSON_PLAN_STAGES.EXPERIENCE;
  }
  if (
    sectionKey === LESSON_PLAN_SECTION_KEYS.PAIR_EXPLANATION ||
    sectionKey === LESSON_PLAN_SECTION_KEYS.FINAL_QUESTION ||
    sectionKey === LESSON_PLAN_SECTION_KEYS.TEACHER_LOOK_FORS
  ) {
    return LESSON_PLAN_STAGES.HELPING;
  }
  return null; // never crash on an unrecognized key — just doesn't count toward any stage's completion
}

/**
 * `[{ stage, complete }]`, one entry per LESSON_PLAN_STAGES value, in
 * that same order — reuses getLessonPlanReadiness()'s own `missing[]`
 * as the sole source of truth for "complete": a stage is complete iff
 * NONE of its own sectionKeys appear in `missing`. Never a bare
 * boolean/percentage on its own — the Builder derives both its
 * progress indicator (fraction complete) and its "which stage is the
 * current guided focus" (first entry with complete: false) from this
 * one array, so the two can never disagree with each other.
 */
export function getLessonPlanStageCompletion(lessonPlan) {
  const { missing } = getLessonPlanReadiness(lessonPlan);
  const incompleteStages = new Set(missing.map(stageForMissingItem).filter(Boolean));
  return Object.values(LESSON_PLAN_STAGES).map((stage) => ({ stage, complete: !incompleteStages.has(stage) }));
}
