import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLesson } from '../../js/models/Lesson.js';
import { createLessonPlanObjective } from '../../js/models/LessonPlan.js';
import { getWeeklyPlanReadiness, isWeeklyPlanComplete, hasMeaningfulWeeklyPlanContent, WEEKLY_PLAN_SECTION_KEYS } from '../../js/services/weeklyPlanValidationService.js';

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

// ---------------------------------------------------------------------
// hasMeaningfulWeeklyPlanContent — an ANY check, deliberately the
// opposite shape from getWeeklyPlanReadiness()'s ALL check. Used only
// to derive the PM dashboard's "Not started" vs "Draft" — see
// services/weeklyPlanSubmissionService.js's own getWeekPlanDisplayStatus().
// ---------------------------------------------------------------------

test('hasMeaningfulWeeklyPlanContent: a completely untouched lesson has none', () => {
  const lesson = createLesson({ classroomId: 'c1' });
  assert.equal(hasMeaningfulWeeklyPlanContent(lesson), false);
});

test('hasMeaningfulWeeklyPlanContent: null lesson has none', () => {
  assert.equal(hasMeaningfulWeeklyPlanContent(null), false);
});

test('hasMeaningfulWeeklyPlanContent: a unit alone (no objectives/big question yet) already counts', () => {
  const lesson = createLesson({ classroomId: 'c1', curriculumUnitId: 'unit-1' });
  assert.equal(hasMeaningfulWeeklyPlanContent(lesson), true);
});

test('hasMeaningfulWeeklyPlanContent: only a Plan note (no unit/objective/big question) already counts', () => {
  const lesson = createLesson({ classroomId: 'c1', planSummary: 'Quick recap then group work.' });
  assert.equal(hasMeaningfulWeeklyPlanContent(lesson), true);
});

test('hasMeaningfulWeeklyPlanContent: only an Assessment note already counts', () => {
  const lesson = createLesson({ classroomId: 'c1', assessmentNote: 'Exit ticket with 3 questions.' });
  assert.equal(hasMeaningfulWeeklyPlanContent(lesson), true);
});

test('hasMeaningfulWeeklyPlanContent: blank-only strings do not count', () => {
  const lesson = createLesson({ classroomId: 'c1', bigQuestion: '   ', planSummary: '  ', assessmentNote: '' });
  assert.equal(hasMeaningfulWeeklyPlanContent(lesson), false);
});

test('hasMeaningfulWeeklyPlanContent: does NOT require every field, unlike getWeeklyPlanReadiness', () => {
  const lesson = createLesson({ classroomId: 'c1', bigQuestion: 'Why?' });
  assert.equal(isWeeklyPlanComplete(lesson), false); // still not "ready" (no concepts/objective)
  assert.equal(hasMeaningfulWeeklyPlanContent(lesson), true); // but has started
});
