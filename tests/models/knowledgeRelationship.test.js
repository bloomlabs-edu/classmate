import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RELATIONSHIP_TYPES,
  createKnowledgeRelationship,
  getRelationshipForwardLabel,
  getReverseRelationshipLabel,
} from '../../js/models/KnowledgeRelationship.js';

test('RELATIONSHIP_TYPES: exactly the 9 v1 types, no more, no less', () => {
  assert.deepEqual(Object.values(RELATIONSHIP_TYPES).sort(), [
    'CAUSES',
    'CONTRASTS_WITH',
    'EXAMPLE_OF',
    'HAS_ASPECT',
    'HAS_PROPERTY',
    'IS_A',
    'PART_OF',
    'PREREQUISITE_FOR',
    'RELATED_TO',
  ]);
});

test('createKnowledgeRelationship: defaults and generated id/timestamps', () => {
  const relationship = createKnowledgeRelationship({
    fromConceptId: 'concept-heavy-rainfall',
    toConceptId: 'concept-flood',
    type: RELATIONSHIP_TYPES.CAUSES,
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  assert.ok(relationship.id);
  assert.equal(relationship.fromConceptId, 'concept-heavy-rainfall');
  assert.equal(relationship.toConceptId, 'concept-flood');
  assert.equal(relationship.type, 'CAUSES');
  assert.ok(relationship.createdAt);
  assert.equal(relationship.updatedAt, relationship.createdAt);
});

test('getRelationshipForwardLabel/getReverseRelationshipLabel: every one of the 9 types has both a forward and a reverse label', () => {
  Object.values(RELATIONSHIP_TYPES).forEach((type) => {
    const forward = getRelationshipForwardLabel(type);
    const reverse = getReverseRelationshipLabel(type);
    assert.equal(typeof forward, 'string');
    assert.ok(forward.length > 0);
    assert.equal(typeof reverse, 'string');
    assert.ok(reverse.length > 0);
  });
});

test('getRelationshipForwardLabel/getReverseRelationshipLabel: CAUSES reads correctly from both directions', () => {
  assert.equal(getRelationshipForwardLabel(RELATIONSHIP_TYPES.CAUSES), 'causes');
  assert.equal(getReverseRelationshipLabel(RELATIONSHIP_TYPES.CAUSES), 'is caused by');
});

test('getRelationshipForwardLabel/getReverseRelationshipLabel: RELATED_TO and CONTRASTS_WITH are symmetric', () => {
  assert.equal(getRelationshipForwardLabel(RELATIONSHIP_TYPES.RELATED_TO), getReverseRelationshipLabel(RELATIONSHIP_TYPES.RELATED_TO));
  assert.equal(getRelationshipForwardLabel(RELATIONSHIP_TYPES.CONTRASTS_WITH), getReverseRelationshipLabel(RELATIONSHIP_TYPES.CONTRASTS_WITH));
});

test('getRelationshipForwardLabel/getReverseRelationshipLabel: an unrecognized type falls back to the raw value, never blank', () => {
  assert.equal(getRelationshipForwardLabel('NOT_A_REAL_TYPE'), 'NOT_A_REAL_TYPE');
  assert.equal(getReverseRelationshipLabel('NOT_A_REAL_TYPE'), 'NOT_A_REAL_TYPE');
});

test('reverse relationships are never persisted as a separate stored field — createKnowledgeRelationship has no inverse/reverse field at all', () => {
  const relationship = createKnowledgeRelationship({
    fromConceptId: 'concept-heavy-rainfall',
    toConceptId: 'concept-flood',
    type: RELATIONSHIP_TYPES.CAUSES,
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  assert.equal('reverseType' in relationship, false);
  assert.equal('inverseOf' in relationship, false);
});
