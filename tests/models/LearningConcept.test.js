import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningConcept } from '../../js/models/LearningConcept.js';

test('createLearningConcept: description defaults to null (Phase 5 addition), not undefined', () => {
  const concept = createLearningConcept({ title: 'Forces' });
  assert.equal(concept.description, null);
  assert.notEqual(concept.description, undefined);
});

test('createLearningConcept: an existing concept created before this field existed behaves identically — description simply null', () => {
  // Simulates a pre-Phase-5 caller that never knew this field existed.
  const concept = createLearningConcept({ title: 'Friction', status: 'taught' });
  assert.equal(concept.description, null);
  assert.equal(concept.status, 'taught');
  assert.deepEqual(concept.resourceLinks, []);
});

test('createLearningConcept: a supplied description is preserved as-is', () => {
  const concept = createLearningConcept({ title: 'Forces', description: 'A force is a push or pull.' });
  assert.equal(concept.description, 'A force is a push or pull.');
});
