import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeClassificationMembership } from '../../js/models/KnowledgeClassificationMembership.js';

test('createKnowledgeClassificationMembership: Example B — Flood -> Natural -> within "Based on causes of occurrence"', () => {
  const membership = createKnowledgeClassificationMembership({
    conceptId: 'concept-flood',
    classificationId: 'classification-causes-of-occurrence',
    categoryId: 'category-natural',
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  assert.ok(membership.id);
  assert.equal(membership.conceptId, 'concept-flood');
  assert.equal(membership.classificationId, 'classification-causes-of-occurrence');
  assert.equal(membership.categoryId, 'category-natural');
  assert.ok(membership.createdAt);
});

test('createKnowledgeClassificationMembership: a Concept may hold independent memberships across two different Classifications', () => {
  const membershipByCause = createKnowledgeClassificationMembership({
    conceptId: 'concept-flood',
    classificationId: 'classification-causes-of-occurrence',
    categoryId: 'category-natural',
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  const membershipByOrigin = createKnowledgeClassificationMembership({
    conceptId: 'concept-flood',
    classificationId: 'classification-based-on-origin',
    categoryId: 'category-riverine',
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  assert.notEqual(membershipByCause.id, membershipByOrigin.id);
  assert.equal(membershipByCause.conceptId, membershipByOrigin.conceptId);
  assert.notEqual(membershipByCause.classificationId, membershipByOrigin.classificationId);
});

test('createKnowledgeClassificationMembership: never has a title/name/description — it is a pure join record, not a Concept or Category itself', () => {
  const membership = createKnowledgeClassificationMembership({
    conceptId: 'concept-flood',
    classificationId: 'classification-causes-of-occurrence',
    categoryId: 'category-natural',
    authorizingClassroomId: 'classroom-1',
    createdByUid: 'pm-1',
  });
  assert.equal('title' in membership, false);
  assert.equal('name' in membership, false);
});
