import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLesson } from '../../js/models/Lesson.js';
import { createLessonPlanObjective } from '../../js/models/LessonPlan.js';
import { getWeeklyPlanReadiness, isWeeklyPlanComplete, WEEKLY_PLAN_SECTION_KEYS } from '../../js/services/weeklyPlanValidationService.js';

test('getWeeklyPlanReadiness: a brand-new lesson (no concepts, no objectives, no big question) is not ready', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: [] });
  const readiness = getWeeklyPlanReadiness(lesson);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.some((item) => item.sectionKey === WEEKLY_PLAN_SECTION_KEYS.CONCEPTS));
  assert.ok(readiness.missing.some((item) => item.sectionKey === WEEKLY_PLAN_SECTION_KEYS.WHY && /objective/i.test(item.message)));
  assert.ok(readiness.missing.some((item) => item.sectionKey === WEEKLY_PLAN_SECTION_KEYS.WHY && /big question/i.test(item.message)));
  assert.equal(isWeeklyPlanComplete(lesson), false);
});

test('getWeeklyPlanReadiness: concepts alone, with no objective/big question, is still not ready', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['concept-1'] });
  const readiness = getWeeklyPlanReadiness(lesson);
  assert.equal(readiness.ready, false);
  assert.ok(!readiness.missing.some((item) => item.sectionKey === WEEKLY_PLAN_SECTION_KEYS.CONCEPTS));
  assert.ok(readiness.missing.some((item) => item.sectionKey === WEEKLY_PLAN_SECTION_KEYS.WHY));
});

test('getWeeklyPlanReadiness: a blank-text objective does not satisfy "at least one objective" — same non-blank rule as LessonPlan', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['concept-1'], objectives: [createLessonPlanObjective({ text: '   ' })], bigQuestion: 'Why?' });
  const readiness = getWeeklyPlanReadiness(lesson);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.some((item) => item.sectionKey === WEEKLY_PLAN_SECTION_KEYS.WHY && /objective/i.test(item.message)));
});

test('getWeeklyPlanReadiness: concepts + one real objective + a Big Question is complete — Weekly Plan needs nothing else', () => {
  const lesson = createLesson({
    classroomId: 'c1',
    conceptIds: ['concept-1'],
    objectives: [createLessonPlanObjective({ text: 'Explain the causes of the revolt.' })],
    bigQuestion: 'Why did Kattabomman resist British rule?',
  });
  const readiness = getWeeklyPlanReadiness(lesson);
  assert.deepEqual(readiness.missing, []);
  assert.equal(readiness.ready, true);
  assert.equal(isWeeklyPlanComplete(lesson), true);
});

test('getWeeklyPlanReadiness: multiple concepts/objectives are all fine, not just exactly one', () => {
  const lesson = createLesson({
    classroomId: 'c1',
    conceptIds: ['concept-1', 'concept-2'],
    objectives: [createLessonPlanObjective({ text: 'First objective.' }), createLessonPlanObjective({ text: 'Second objective.' })],
    bigQuestion: 'Why?',
  });
  assert.equal(isWeeklyPlanComplete(lesson), true);
});
