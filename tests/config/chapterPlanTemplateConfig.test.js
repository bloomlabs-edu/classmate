import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getChapterPlanTemplateConfig, CHAPTER_PLAN_SUBJECT_TEMPLATES } from '../../js/config/chapterPlanTemplateConfig.js';

test('Mathematics config exposes CPA Ideas as its one subject-specific field, and no Simplified Text', () => {
  const config = getChapterPlanTemplateConfig('mathematics');
  assert.equal(config.subjectSpecificFields.length, 1);
  assert.equal(config.subjectSpecificFields[0].key, 'cpaIdeas');
  assert.equal(config.subjectSpecificFields[0].label, 'CPA Ideas');
  assert.equal(config.showSimplifiedText, false);
});

test('English/Literacy config exposes Grammar Mini Lesson as its one subject-specific field, and DOES show Simplified Text', () => {
  const config = getChapterPlanTemplateConfig('english');
  assert.equal(config.subjectSpecificFields.length, 1);
  assert.equal(config.subjectSpecificFields[0].key, 'grammarMiniLesson');
  assert.equal(config.subjectSpecificFields[0].label, 'Grammar Mini Lesson');
  assert.equal(config.showSimplifiedText, true);
});

test('Science and Social Science configs expose no subject-specific fields and no Simplified Text — common framework only', () => {
  const science = getChapterPlanTemplateConfig('science');
  const socialScience = getChapterPlanTemplateConfig('social_science');
  assert.deepEqual(science.subjectSpecificFields, []);
  assert.deepEqual(socialScience.subjectSpecificFields, []);
  assert.equal(science.showSimplifiedText, false);
  assert.equal(socialScience.showSimplifiedText, false);
});

test('an unrecognized subjectId falls back to the generic template, never throws', () => {
  const config = getChapterPlanTemplateConfig('hindi');
  assert.deepEqual(config.subjectSpecificFields, []);
  assert.equal(config.showSimplifiedText, false);
  assert.doesNotThrow(() => getChapterPlanTemplateConfig(undefined));
  assert.doesNotThrow(() => getChapterPlanTemplateConfig(null));
});

test('exactly the four canonical subjects are configured', () => {
  assert.deepEqual(Object.keys(CHAPTER_PLAN_SUBJECT_TEMPLATES).sort(), ['english', 'mathematics', 'science', 'social_science']);
});

test('every template carries placeholderHints for supplementaryResources and resources', () => {
  Object.values(CHAPTER_PLAN_SUBJECT_TEMPLATES).forEach((template) => {
    assert.ok(template.placeholderHints.supplementaryResources);
    assert.ok(template.placeholderHints.resources);
  });
});
