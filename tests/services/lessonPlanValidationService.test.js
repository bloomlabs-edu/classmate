import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, LESSON_PLAN_SECTION_KEYS } from '../../js/models/LessonPlan.js';
import * as lessonPlanService from '../../js/services/lessonPlanService.js';
import { getLessonPlanReadiness } from '../../js/services/lessonPlanValidationService.js';

test('getLessonPlanReadiness: a brand-new, empty plan is not ready, and reports one friendly message per genuinely missing item', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const readiness = getLessonPlanReadiness(plan);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.length > 0);
  // Friendly, specific copy — never "Error: field N required."
  assert.ok(readiness.missing.every((item) => !/error|field \d+/i.test(item.message)));
});

test('getLessonPlanReadiness: WHY section reports each of objective / big question / SWBAT independently', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const readiness = getLessonPlanReadiness(plan);
  const whyMessages = readiness.missing.filter((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.WHY).map((item) => item.message);
  assert.ok(whyMessages.some((message) => /lesson objective/i.test(message)));
  assert.ok(whyMessages.some((message) => /big question/i.test(message)));
  assert.ok(whyMessages.some((message) => /swbat/i.test(message)));
});

test('getLessonPlanReadiness: fully completing every section (Concept + Spark + one Activity + Helping Each Other Learn + Why + Self/Others/India + Assessment) makes the plan ready', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });

  lessonPlanService.updateContext(plan, { conceptIds: ['concept-1'] });
  lessonPlanService.updateWhy(plan, { lessonObjective: 'Understand the causes of the revolt.', bigQuestion: 'Why did Kattabomman resist British rule?' });
  lessonPlanService.addSwbatObjective(plan, 'Identify at least two causes of the revolt.');
  lessonPlanService.updateSelfOthersIndia(plan, { self: 'Standing up for what is right.' });
  lessonPlanService.addAssessmentItem(plan, 'Exit ticket with 2 causes.');
  lessonPlanService.updateSpark(plan, { title: 'Mystery Object', teacherAction: 'Show the object.', studentAction: 'Guess its significance.' });
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
// Phase 4 — a Concept is required before submission (product decision:
// concept selection stays optional/flexible WHILE building; this is a
// submit-time gate only, enforced here in readiness, never blocking
// the Builder from being edited without one).
// ---------------------------------------------------------------------

test('getLessonPlanReadiness: a lesson plan with zero concepts is not ready, with the exact specified teacher-facing message', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const readiness = getLessonPlanReadiness(plan);
  const conceptIssue = readiness.missing.find((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.CONTEXT);
  assert.ok(conceptIssue, 'expected a missing-concept readiness item');
  assert.equal(conceptIssue.message, 'Add at least one Concept before submitting this lesson for review.');
});

test('getLessonPlanReadiness: adding even one concept clears the missing-concept item (multiple concepts are also fine, not just exactly one)', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.updateContext(plan, { conceptIds: ['concept-1'] });
  let readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.CONTEXT));

  lessonPlanService.updateContext(plan, { conceptIds: ['concept-1', 'concept-2'] });
  readiness = getLessonPlanReadiness(plan);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === LESSON_PLAN_SECTION_KEYS.CONTEXT));
});
