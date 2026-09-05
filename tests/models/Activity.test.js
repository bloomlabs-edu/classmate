import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivity } from '../../js/models/Activity.js';

test('createActivity: defaults activityType to native and scoreMax to null', () => {
  const activity = createActivity({ conceptId: 'concept-1', title: 'Plant Kingdom Worksheet' });
  assert.equal(activity.activityType, 'native');
  assert.equal(activity.scoreMax, null);
  assert.equal(activity.destination, null);
  assert.equal(activity.externalProvider, null);
});

test('createActivity: requires no title-based identity -- id is a generated, stable value distinct from title', () => {
  const activity = createActivity({ conceptId: 'concept-1', title: 'Migration Quiz' });
  assert.ok(activity.id);
  assert.notEqual(activity.id, activity.title);
});

test('createActivity: an external activity stores its provider and destination as opaque values', () => {
  const activity = createActivity({
    conceptId: 'concept-1',
    title: 'Migration Quiz',
    activityType: 'external',
    externalProvider: 'kahoot',
    destination: 'https://kahoot.it/some-game',
    scoreMax: 10,
  });
  assert.equal(activity.activityType, 'external');
  assert.equal(activity.externalProvider, 'kahoot');
  assert.equal(activity.destination, 'https://kahoot.it/some-game');
  assert.equal(activity.scoreMax, 10);
});

test('createActivity: a learning_hub activity stores an opaque destination the same way, with no special-casing', () => {
  const activity = createActivity({
    conceptId: 'concept-1',
    title: 'Migration Practice',
    activityType: 'learning_hub',
    destination: 'reading:experience-42',
  });
  assert.equal(activity.activityType, 'learning_hub');
  assert.equal(activity.externalProvider, null);
  assert.equal(activity.destination, 'reading:experience-42');
});

test('createActivity: updatedAt defaults to createdAt on creation, same convention as models/Resource.js', () => {
  const activity = createActivity({ conceptId: 'concept-1', title: 'x' });
  assert.equal(activity.updatedAt, activity.createdAt);
});
