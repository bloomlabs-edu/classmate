import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnglishLiteracyCircleGoalCategories,
  buildEnglishLiteracyCircleConfiguration,
  ENGLISH_LITERACY_CIRCLE_GOAL_CATEGORIES,
} from '../../js/config/englishLiteracyCircleDefaults.js';

test('buildEnglishLiteracyCircleGoalCategories: returns the four LSRW categories', () => {
  const categories = buildEnglishLiteracyCircleGoalCategories();
  const names = categories.map((c) => c.name);

  assert.deepEqual(names, ['Listening', 'Speaking', 'Reading', 'Writing']);
  categories.forEach((category) => {
    assert.ok(Array.isArray(category.suggestedGoals));
    assert.ok(category.suggestedGoals.length > 0);
  });
});

test('buildEnglishLiteracyCircleGoalCategories: returns a fresh copy every time, never a shared reference', () => {
  const first = buildEnglishLiteracyCircleGoalCategories();
  first[0].name = 'Mutated';
  first[0].suggestedGoals.push('mutated goal');

  const second = buildEnglishLiteracyCircleGoalCategories();
  assert.equal(second[0].name, 'Listening');
  assert.ok(!second[0].suggestedGoals.includes('mutated goal'));
});

test('buildEnglishLiteracyCircleConfiguration: shape matches LearningProgramme.configuration', () => {
  const configuration = buildEnglishLiteracyCircleConfiguration();

  assert.deepEqual(configuration.defaultComponents, []);
  assert.deepEqual(configuration.extensions, []);
  assert.deepEqual(configuration.settings, {});
  assert.equal(configuration.goalFramework.categories.length, 4);
});

test('LSRW is not hardcoded into the module structure — it is plain exported data', () => {
  assert.ok(Array.isArray(ENGLISH_LITERACY_CIRCLE_GOAL_CATEGORIES));
});
