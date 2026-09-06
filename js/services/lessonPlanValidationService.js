/**
 * services/lessonPlanValidationService.js
 *
 * Whether a LessonPlan (the separate, optional DETAILED tier — see
 * docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md) is ready
 * to submit for review — understanding the required CONTENT STRUCTURE
 * (per the "5 Questions" framework this whole feature is built
 * around), never a bare field count. Pure and dependency-free (no
 * Firestore import), matching this app's own established "stays
 * directly unit-testable" convention (see
 * services/timetableDisplayService.js's own header comment for the
 * same reasoning applied elsewhere).
 *
 * Deliberately does NOT check Concept/Objectives/Big Question anymore
 * — those moved to the separate, lighter Weekly Plan tier (see
 * services/weeklyPlanValidationService.js's own getWeeklyPlanReadiness(),
 * which gates a Lesson, not a LessonPlan). This function only ever
 * gates what's genuinely specific to the DETAILED plan: Activities and
 * Helping (Pair Explanation/Final Question/Teacher Look-Fors) are
 * required; Connection, Showcase, and Spark are optional enrichment.
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

  // CONCEPT and 1. WHY — MOVED to the separate Weekly Plan tier, per
  // docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md. A
  // Detailed Lesson Plan is only ever created (via
  // services/timetableLessonService.js's own
  // buildDetailedLessonPlanFromLesson()) from a Lesson whose own
  // services/weeklyPlanValidationService.js's getWeeklyPlanReadiness()
  // already required a Concept, at least one real Objective, and a Big
  // Question — so re-checking them here would just be re-validating an
  // invariant the Weekly Plan tier already owns. This is a deliberate
  // narrowing of what THIS function gates, not a removed requirement:
  // Concept/Objectives/Big Question still exist as real, editable
  // content on this document (see ui/views/LessonPlanBuilderView.js's
  // own Concepts/Purpose stages) — they simply no longer block THIS
  // submission gate, the same treatment Self/Others/India and
  // Assessment already have below.

  // 2. SELF / OTHERS / INDIA — deliberately NOT required, per explicit
  // product direction: this is an optional reflection/planning
  // section on the Detailed Lesson Plan, not a gate. Never pushes a
  // missing-item here, regardless of whether Self/Others/India are
  // all blank, partially filled, or fully filled — so
  // getLessonPlanStageCompletion()'s own CONNECTION stage is always
  // complete, and the guided Builder never blocks progression on it.
  // The fields themselves, their labels, and their save behavior are
  // completely unchanged — only this submission-readiness gate is
  // gone.

  // 3. ASSESSMENT — deliberately NOT required, per explicit product
  // direction, same treatment as Self/Others/India above: "are
  // students showcasing learning" is an optional planning section on
  // the Detailed Lesson Plan, not a gate. Never pushes a missing-item
  // here regardless of whether zero, one, or several assessment/
  // evidence items exist — so getLessonPlanStageCompletion()'s own
  // SHOWCASE stage is always complete, and the guided Builder never
  // blocks progression on it. Adding/editing/removing items and "From
  // Teaching Ideas" are all still exactly as they were — only this
  // submission-readiness gate is gone.

  // 4. FUN, FAST, EFFECTIVE — Spark is deliberately NOT required, per
  // explicit product direction: it's an enrichment layer on top of
  // Activities ("make it memorable"), not a structural requirement,
  // same treatment as Self/Others/India and Assessment above. Never
  // pushes a missing-item here regardless of whether Spark is blank or
  // fully filled in.

  // 4. FUN, FAST, EFFECTIVE — Activities (dynamic count, never assumed) —
  // still required: real, observation-grade instructional detail a
  // Detailed Lesson Plan exists to capture.
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
 * submission readiness, so neither has a "completion" this function
 * needs to define. Grouped exactly along the same sectionKeys
 * getLessonPlanReadiness() already checks — see stageForMissingItem()
 * below — so the Builder's progress indicator and "what's the next
 * incomplete stage" logic never invent a second definition of "done."
 *
 * CONCEPT and PURPOSE are now ALWAYS complete (getLessonPlanReadiness()
 * no longer checks either — see that function's own doc comment on why
 * this moved to the separate Weekly Plan tier) — kept as real, visible
 * stages here (not deleted) because a Detailed Lesson Plan still shows
 * and lets a teacher edit its own Concepts/Objectives/Big Question,
 * just never blocked on them. In practice they arrive already filled
 * in (seeded from the originating Lesson), so they read as
 * already-done from the very first render — the same "complete from
 * the start" treatment CONNECTION/SHOWCASE already have below.
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
 * Showcase is Assessment alone (Q3); Experience is every Activity
 * alone now (Q4, "is it fun/fast/effective" — Spark no longer gates
 * anything, same treatment as Self/Others/India/Assessment); Helping
 * bundles Pair Explanation + Final Question + Teacher Look-Fors (Q5's
 * own three fields, unchanged, just co-located under their real
 * question rather than split across two other stages). The CONTEXT/WHY
 * branches below are unreachable in practice (getLessonPlanReadiness()
 * never produces those sectionKeys anymore) but kept, harmlessly, as a
 * defensive mapping rather than deleted outright. The underlying
 * fields, labels, and `LESSON_PLAN_SECTION_KEYS` themselves are
 * completely unchanged — this only changes which UI stage each one's
 * completion counts toward.
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
