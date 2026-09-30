import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createKnowledgeCategory,
  createKnowledgeClassification,
  findKnowledgeCategory,
  getKnowledgeCategoryIndex,
} from '../../js/models/KnowledgeClassification.js';

test('createKnowledgeCategory: defaults and generated id', () => {
  const category = createKnowledgeCategory({ name: 'Natural' });
  assert.ok(category.id);
  assert.equal(category.name, 'Natural');
});

test('createKnowledgeClassification: defaults, generated id/timestamps, empty categories by default', () => {
  const classification = createKnowledgeClassification({
    name: 'Based on causes of occurrence',
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  assert.ok(classification.id);
  assert.equal(classification.name, 'Based on causes of occurrence');
  assert.deepEqual(classification.categories, []);
  assert.ok(classification.createdAt);
  assert.equal(classification.updatedAt, classification.createdAt);
});

test('createKnowledgeClassification: never has a concepts field — a Classification does not own Concepts', () => {
  const classification = createKnowledgeClassification({ name: 'Based on causes of occurrence', authorizingClassroomId: 'classroom-1', createdByUid: 'pm-1' });
  assert.equal('conceptIds' in classification, false);
  assert.equal('concepts' in classification, false);
});

test('createKnowledgeClassification: accepts real Categories (Example B: Natural, Human-made, Socio-natural)', () => {
  const natural = createKnowledgeCategory({ name: 'Natural' });
  const humanMade = createKnowledgeCategory({ name: 'Human-made' });
  const socioNatural = createKnowledgeCategory({ name: 'Socio-natural' });
  const classification = createKnowledgeClassification({
    name: 'Based on causes of occurrence',
    categories: [natural, humanMade, socioNatural],
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  assert.equal(classification.categories.length, 3);
  assert.deepEqual(classification.categories.map((c) => c.name), ['Natural', 'Human-made', 'Socio-natural']);
});

test('findKnowledgeCategory: finds a Category by its own id within the owning Classification, or null', () => {
  const natural = createKnowledgeCategory({ name: 'Natural' });
  const classification = createKnowledgeClassification({ name: 'X', categories: [natural], authorizingClassroomId: 'classroom-1', createdByUid: 'pm-1' });
  assert.deepEqual(findKnowledgeCategory(classification, natural.id), natural);
  assert.equal(findKnowledgeCategory(classification, 'not-a-real-id'), null);
});

test('getKnowledgeCategoryIndex: the array index of a Category by its own id, or -1', () => {
  const natural = createKnowledgeCategory({ name: 'Natural' });
  const humanMade = createKnowledgeCategory({ name: 'Human-made' });
  const classification = createKnowledgeClassification({ name: 'X', categories: [natural, humanMade], authorizingClassroomId: 'classroom-1', createdByUid: 'pm-1' });
  assert.equal(getKnowledgeCategoryIndex(classification, humanMade.id), 1);
  assert.equal(getKnowledgeCategoryIndex(classification, 'not-a-real-id'), -1);
});
