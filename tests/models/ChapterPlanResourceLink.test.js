import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChapterPlanResourceLink } from '../../js/models/ChapterPlanResourceLink.js';

test('createChapterPlanResourceLink: carries classroomId + resourceId as a reference, defaults addedBy to null and addedAt to now', () => {
  const link = createChapterPlanResourceLink({ classroomId: 'classroom-a', resourceId: 'resource-1', resourceType: 'external_link' });
  assert.ok(link.id);
  assert.equal(link.classroomId, 'classroom-a');
  assert.equal(link.resourceId, 'resource-1');
  assert.equal(link.resourceType, 'external_link');
  assert.equal(link.addedBy, null);
  assert.ok(link.addedAt);
});

test('createChapterPlanResourceLink: classroomId may point at a DIFFERENT classroom than the ChapterPlan that holds this link — that is the whole point of storing it explicitly', () => {
  const link = createChapterPlanResourceLink({ classroomId: 'classroom-b', resourceId: 'resource-owned-by-anu', addedBy: 'rejeesh' });
  // Nothing about this link's own shape ties it to any particular
  // owning ChapterPlan's classroomId — it is a self-contained pointer
  // to `classrooms/classroom-b/resources/resource-owned-by-anu`,
  // regardless of which classroom's ChapterPlan document embeds it.
  assert.equal(link.classroomId, 'classroom-b');
  assert.equal(link.addedBy, 'rejeesh');
});

test('createChapterPlanResourceLink: never carries any of the Resource\'s own content fields — reference only, never a duplicate', () => {
  const link = createChapterPlanResourceLink({ classroomId: 'classroom-a', resourceId: 'resource-1' });
  assert.equal(link.title, undefined);
  assert.equal(link.content, undefined);
  assert.equal(link.status, undefined);
  assert.equal(link.audience, undefined);
});

test('createChapterPlanResourceLink: two links to the same underlying resourceId are independent link records with distinct ids', () => {
  const linkOne = createChapterPlanResourceLink({ classroomId: 'classroom-a', resourceId: 'resource-1' });
  const linkTwo = createChapterPlanResourceLink({ classroomId: 'classroom-a', resourceId: 'resource-1' });
  assert.notEqual(linkOne.id, linkTwo.id);
  assert.equal(linkOne.resourceId, linkTwo.resourceId);
});
