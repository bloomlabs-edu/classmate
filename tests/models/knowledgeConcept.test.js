import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeConcept } from '../../js/models/KnowledgeConcept.js';

test('createKnowledgeConcept: defaults and generated id/timestamps', () => {
  const concept = createKnowledgeConcept({ title: 'Flood', authorizingClassroomId: 'classroom-1', createdByUid: 'pm-1' });
  assert.ok(concept.id);
  assert.equal(concept.title, 'Flood');
  assert.equal(concept.description, null);
  assert.equal(concept.sourceCurriculumUnitId, null);
  assert.equal(concept.authorizingClassroomId, 'classroom-1');
  assert.equal(concept.createdByUid, 'pm-1');
  assert.ok(concept.createdAt);
  assert.equal(concept.updatedAt, concept.createdAt);
});

test('createKnowledgeConcept: never has a parentId, categoryId, or classificationId field, by design', () => {
  const concept = createKnowledgeConcept({ title: 'Flood', authorizingClassroomId: 'classroom-1', createdByUid: 'pm-1' });
  assert.equal('parentId' in concept, false);
  assert.equal('categoryId' in concept, false);
  assert.equal('classificationId' in concept, false);
});

test('createKnowledgeConcept: sourceCurriculumUnitId is optional provenance, settable independent of authorizingClassroomId', () => {
  const concept = createKnowledgeConcept({
    title: 'Heavy rainfall',
    sourceCurriculumUnitId: 'unit-42',
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  assert.equal(concept.sourceCurriculumUnitId, 'unit-42');
});

test('createKnowledgeConcept: an explicit id/description/timestamps are preserved, not regenerated', () => {
  const concept = createKnowledgeConcept({
    id: 'concept-flood',
    title: 'Flood',
    description: 'Overflow of water onto normally dry land.',
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(concept.id, 'concept-flood');
  assert.equal(concept.description, 'Overflow of water onto normally dry land.');
  assert.equal(concept.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(concept.updatedAt, '2026-01-02T00:00:00.000Z');
});
