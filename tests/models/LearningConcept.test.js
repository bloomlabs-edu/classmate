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

// ---------------------------------------------------------------------
// learningHubConcept — the optional, purely additive mapping to the
// Learning Hub RepositoryConcept (the canonical cross-product Concept
// identity, per the joint cross-repo identity audit). This model's own
// `id` stays the ClassMate-local identity; `learningHubConcept.conceptId`
// is a one-hop, opaque reference, never used to reinterpret `id`.
// ---------------------------------------------------------------------

test('createLearningConcept: learningHubConcept defaults to null, not undefined', () => {
  const concept = createLearningConcept({ title: 'Forces' });
  assert.equal(concept.learningHubConcept, null);
  assert.notEqual(concept.learningHubConcept, undefined);
});

test('createLearningConcept: a concept created before this field existed behaves identically — learningHubConcept simply null, everything else unaffected', () => {
  // Simulates a pre-existing caller (or a concept loaded from Firestore
  // before this field was introduced) that never knew this field existed.
  const concept = createLearningConcept({ title: 'Friction', status: 'taught' });
  assert.equal(concept.learningHubConcept, null);
  assert.equal(concept.status, 'taught');
  assert.deepEqual(concept.resourceLinks, []);
  assert.equal(concept.description, null);
});

test('createLearningConcept: a supplied learningHubConcept mapping is preserved as-is', () => {
  const concept = createLearningConcept({
    title: 'Forces',
    learningHubConcept: { conceptId: 'hub-concept-42', title: 'Forces and Motion' },
  });
  assert.deepEqual(concept.learningHubConcept, { conceptId: 'hub-concept-42', title: 'Forces and Motion' });
});

test('createLearningConcept: the cached learningHubConcept.title is independent of this concept\'s own title — no identity coupling', () => {
  const concept = createLearningConcept({
    title: 'Forces',
    learningHubConcept: { conceptId: 'hub-concept-42', title: 'A Totally Different Hub Title' },
  });
  assert.equal(concept.title, 'Forces');
  assert.equal(concept.learningHubConcept.title, 'A Totally Different Hub Title');
  assert.equal(concept.learningHubConcept.conceptId, 'hub-concept-42');
});
