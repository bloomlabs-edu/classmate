import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpark, SPARK_TYPES } from '../../js/models/Spark.js';
import { getSparkCardDisplay, isSparkConceptRelevant } from '../../js/ui/components/SparkCardDisplay.js';

test('a Spark card shows title, type label, description, and provenance', () => {
  const spark = createSpark({ title: 'Plant Kingdom Ladder', description: 'Sort plants by structure.', sparkType: SPARK_TYPES.ACTIVITY, createdByUid: 'anu', estimatedTime: '15 mins' });
  const display = getSparkCardDisplay(spark);
  assert.equal(display.title, 'Plant Kingdom Ladder');
  assert.equal(display.typeLabel, 'Activity');
  assert.equal(display.description, 'Sort plants by structure.');
  assert.equal(display.meta, 'Created by anu · 15 mins');
});

test('an untitled Spark falls back to a clear placeholder title', () => {
  const spark = createSpark({ title: '', createdByUid: 'anu' });
  assert.equal(getSparkCardDisplay(spark).title, 'Untitled Spark');
});

test('a Spark with no sparkType shows no type label at all (not mandatory)', () => {
  const spark = createSpark({ title: 'x', createdByUid: 'anu' });
  assert.equal(getSparkCardDisplay(spark).typeLabel, null);
});

test('isSparkConceptRelevant: true only when the Spark and the Chapter Plan share at least one concept', () => {
  const spark = createSpark({ title: 'x', createdByUid: 'anu', conceptIds: ['concept-1', 'concept-2'] });
  assert.equal(isSparkConceptRelevant(spark, ['concept-2']), true);
  assert.equal(isSparkConceptRelevant(spark, ['concept-9']), false);
  assert.equal(isSparkConceptRelevant(spark, []), false);
  assert.equal(isSparkConceptRelevant(spark, undefined), false);
});
