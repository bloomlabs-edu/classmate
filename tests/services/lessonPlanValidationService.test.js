import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, LESSON_PLAN_SECTION_KEYS } from '../../js/models/LessonPlan.js';
import * as lessonPlanService from '../../js/services/lessonPlanService.js';
import { getLessonPlanReadiness, getLessonPlanStageCompletion, LESSON_PLAN_STAGES } from '../../js/services/lessonPlanValidationService.js';

// ---------------------------------------------------------------------
// Concept and WHY (Objectives/Big Question) moved to the separate
// Weekly Plan tier (see services/weeklyPlanValidationService.js and
// docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md) — a
// Detailed Lesson Plan's OWN readiness no longer gates on either, even
// though the fields themselves still exist and are still editable here.
// ---------------------------------------------------------------------

test('getLessonPlanReadiness: a brand-new, empty plan is not ready (Activities/Helping still required), and reports one friendly message per genuinely missing item', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const readiness = getLessonPlanReadiness(plan);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.length > 0);
  // Friendly, specific copy — never "Error: field N required."
  assert.ok(readiness.missing.every((item) => !/error|field \d+/i.test(item.message)));
});

test('getLessonPlanReadiness: zero concepts and blank Objectives/Big Question are NOT reported — that moved to the Weekly Plan tier', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.CONTEXT));
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.WHY));
});

test('getLessonPlanReadiness: Spark is deliberately NOT required — blank Spark never blocks, same treatment as Connection/Showcase', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, activity.id, { title: 'Timeline Building', teacherAction: 'Circulate and support.', studentAction: 'Sequence events.' });
  lessonPlanService.updateHelpingEachOtherLearn(plan, {
    pairExplanation: 'Explain the timeline to a partner.',
    finalQuestion: 'What would you have done differently?',
    teacherLookFors: 'Correct sequencing and reasoning.',
  });
  // Spark, Concepts, Objectives, Big Question, Connection, Showcase all deliberately left blank.

  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.SPARK && /spark/i.test(item.message)));
  assert.equal(readiness.ready, true);
});

test('getLessonPlanReadiness: fully completing Activities + Helping makes the plan ready, even with Concept/WHY/Connection/Showcase/Spark all left blank', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, activity.id, { title: 'Timeline Building', teacherAction: 'Circulate and support.', studentAction: 'Sequence events.' });
  lessonPlanService.updateHelpingEachOtherLearn(plan, {
    pairExplanation: 'Explain the timeline to a partner.',
    finalQuestion: 'What would you have done differently?',
    teacherLookFors: 'Correct sequencing and reasoning.',
  });

  const readiness = getLessonPlanReadiness(plan);
  assert.deepEqual(readiness.missing, []);
  assert.equal(readiness.ready, true);
});

test('getLessonPlanReadiness: an Activity missing its Student Action is reported against THAT activity\'s own sectionKey ("activity:{id}"), by position label', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, activity.id, { title: 'Group Debate', teacherAction: 'Facilitate.' });

  const readiness = getLessonPlanReadiness(plan);
  const activityIssue = readiness.missing.find((item) => item.sectionKey === `activity:${activity.id}` && /student action/i.test(item.message));
  assert.ok(activityIssue, 'expected a Student Action message addressed to this specific activity');
  assert.ok(/Activity 1/.test(activityIssue.message));
});

test('getLessonPlanReadiness: zero activities is itself reported as missing, dynamic count never assumed', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(readiness.missing.some((item) => /at least one learning activity/i.test(item.message)));
});

// ---------------------------------------------------------------------
// getLessonPlanStageCompletion — the guided-building Builder's own
// progress indicator and "which stage is the current focus" both
// derive from this, which itself derives from getLessonPlanReadiness()'s
// own missing[] — never a second definition of "done."
// ---------------------------------------------------------------------

test('getLessonPlanStageCompletion: a brand-new, empty plan — Concept/Purpose/Connection/Showcase all start complete (moved to Weekly Plan, or already optional); Experience/Helping start incomplete', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.length, 6);
  const byStage = Object.fromEntries(stages.map((entry) => [entry.stage, entry.complete]));
  assert.equal(byStage[LESSON_PLAN_STAGES.CONCEPT], true);
  assert.equal(byStage[LESSON_PLAN_STAGES.PURPOSE], true);
  assert.equal(byStage[LESSON_PLAN_STAGES.CONNECTION], true); // optional — never blocks, even brand new
  assert.equal(byStage[LESSON_PLAN_STAGES.SHOWCASE], true); // optional — never blocks, even brand new
  assert.equal(byStage[LESSON_PLAN_STAGES.EXPERIENCE], false);
  assert.equal(byStage[LESSON_PLAN_STAGES.HELPING], false);
  assert.deepEqual(
    stages.map((entry) => entry.stage),
    [
      LESSON_PLAN_STAGES.CONCEPT,
      LESSON_PLAN_STAGES.PURPOSE,
      LESSON_PLAN_STAGES.CONNECTION,
      LESSON_PLAN_STAGES.SHOWCASE,
      LESSON_PLAN_STAGES.EXPERIENCE,
      LESSON_PLAN_STAGES.HELPING,
    ]
  );
});

test('getLessonPlanStageCompletion: Experience (Q4) is complete on Activity content alone — Spark blank never blocks it', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, activity.id, { title: 'Timeline', teacherAction: 'Circulate.', studentAction: 'Sequence.' });
  // Spark deliberately left blank.

  const stages = getLessonPlanStageCompletion(plan);
  const byStage = Object.fromEntries(stages.map((entry) => [entry.stage, entry.complete]));
  assert.equal(byStage[LESSON_PLAN_STAGES.EXPERIENCE], true);
  assert.equal(byStage[LESSON_PLAN_STAGES.HELPING], false);
});

test('getLessonPlanStageCompletion: Experience (Q4) stays incomplete with zero activities, even if Spark is fully filled in', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.updateSpark(plan, { title: 'Mystery Object', teacherAction: 'Show it.', studentAction: 'Guess.' });
  // Activities deliberately left empty.

  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.EXPERIENCE).complete, false);
});

test('getLessonPlanStageCompletion: a fully-completed plan (Activities + Helping only) has every stage complete, matching getLessonPlanReadiness().ready', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, activity.id, { title: 'Timeline', teacherAction: 'Circulate.', studentAction: 'Sequence.' });
  lessonPlanService.updateHelpingEachOtherLearn(plan, { pairExplanation: 'Explain to a partner.', finalQuestion: 'What next?', teacherLookFors: 'Correct sequencing.' });

  const stages = getLessonPlanStageCompletion(plan);
  assert.ok(stages.every((entry) => entry.complete === true));
  assert.equal(getLessonPlanReadiness(plan).ready, true);
});

test('getLessonPlanStageCompletion: Showcase (Q3 — Assessment) is its own stage, and stays complete regardless of content, independently of Spark/Activities/Helping', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.addAssessmentItem(plan, 'Exit ticket.');
  // Spark/Activities/Helping deliberately left blank.

  const stages = getLessonPlanStageCompletion(plan);
  const byStage = Object.fromEntries(stages.map((entry) => [entry.stage, entry.complete]));
  assert.equal(byStage[LESSON_PLAN_STAGES.SHOWCASE], true);
  assert.equal(byStage[LESSON_PLAN_STAGES.EXPERIENCE], false);
});

// ---------------------------------------------------------------------
// Assessment / evidence items — optional planning section on the
// Detailed Lesson Plan (explicit product direction, same treatment as
// Self/Others/India above): leaving it with zero items, or filling in
// one or several, must never block progression to the next guided
// stage or the Submit gate.
// ---------------------------------------------------------------------

test('Assessment: zero items never blocks — no missing item, Showcase stage complete', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.ASSESSMENT));

  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.SHOWCASE).complete, true);
});

test('Assessment: one item never blocks (still works exactly as before)', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.addAssessmentItem(plan, 'Exit ticket with 2 causes.');
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.ASSESSMENT));
  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.SHOWCASE).complete, true);
});

test('Assessment: multiple items never blocks either, and add/edit/remove still work exactly as before', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const first = lessonPlanService.addAssessmentItem(plan, 'Exit ticket.');
  lessonPlanService.addAssessmentItem(plan, 'Peer check.');
  lessonPlanService.updateAssessmentItem(plan, first.id, 'Exit ticket with 2 causes.');
  assert.equal(plan.assessments.length, 2);
  assert.equal(plan.assessments[0].description, 'Exit ticket with 2 causes.');

  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.ASSESSMENT));
  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.SHOWCASE).complete, true);

  lessonPlanService.removeAssessmentItem(plan, first.id);
  assert.equal(plan.assessments.length, 1);
});

test('Assessment: an item that exists but is blank text is still tolerated (never required) — readiness never depends on assessment content anymore', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.addAssessmentItem(plan, '   ');
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.ASSESSMENT));
});

test('getLessonPlanStageCompletion: Helping (Q5) stays incomplete unless Pair Explanation, Final Question, AND Teacher Look-Fors are all filled', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.updateHelpingEachOtherLearn(plan, { pairExplanation: 'Explain to a partner.', finalQuestion: '', teacherLookFors: '' });

  let stages = getLessonPlanStageCompletion(plan);
  let helping = stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.HELPING);
  assert.equal(helping.complete, false);

  lessonPlanService.updateHelpingEachOtherLearn(plan, { finalQuestion: 'What next?', teacherLookFors: 'Correct sequencing.' });
  stages = getLessonPlanStageCompletion(plan);
  helping = stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.HELPING);
  assert.equal(helping.complete, true);
});

// ---------------------------------------------------------------------
// Self / Others / India — optional reflection section on the Detailed
// Lesson Plan (explicit product direction): leaving all three blank,
// or filling in only one of the three, must never block progression
// to the next guided stage or the Submit gate. Covers every
// combination the Builder's own guided flow can actually produce.
// ---------------------------------------------------------------------

test('Self/Others/India: all three blank never blocks — no missing item, Connection stage complete', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA));

  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.CONNECTION).complete, true);
});

test('Self/Others/India: only Self filled never blocks', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.updateSelfOthersIndia(plan, { self: 'Standing up for what is right.' });
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA));
  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.CONNECTION).complete, true);
});

test('Self/Others/India: only Others filled never blocks', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.updateSelfOthersIndia(plan, { others: 'Understanding a classmate\'s perspective.' });
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA));
  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.CONNECTION).complete, true);
});

test('Self/Others/India: only India filled never blocks', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.updateSelfOthersIndia(plan, { india: 'Connecting the revolt to the wider freedom struggle.' });
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA));
  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.CONNECTION).complete, true);
});

test('Self/Others/India: all three filled never blocks either (was always fine, confirmed unaffected)', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.updateSelfOthersIndia(plan, {
    self: 'Standing up for what is right.',
    others: 'Understanding a classmate\'s perspective.',
    india: 'Connecting the revolt to the wider freedom struggle.',
  });
  const readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA));
  const stages = getLessonPlanStageCompletion(plan);
  assert.equal(stages.find((entry) => entry.stage === LESSON_PLAN_STAGES.CONNECTION).complete, true);
});
