import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as assignmentConfigService from '../../js/services/assignmentConfigService.js';

function buildClassroom() {
  return { assignmentConfig: { categories: [] } };
}

test('addCategory creates a category seeded with a default "Completion" aspect', () => {
  const classroom = buildClassroom();
  const category = assignmentConfigService.addCategory(classroom, 'Worksheets');
  assert.equal(category.name, 'Worksheets');
  assert.equal(category.aspects.length, 1);
  assert.equal(category.aspects[0].name, 'Completion');
  assert.deepEqual(assignmentConfigService.listCategories(classroom), [category]);
});

test('renameCategory changes only the name, never the id or aspects', () => {
  const classroom = buildClassroom();
  const category = assignmentConfigService.addCategory(classroom, 'Worksheets');
  const originalId = category.id;
  const originalAspects = category.aspects;

  assignmentConfigService.renameCategory(classroom, category.id, 'Case Studies');

  const renamed = assignmentConfigService.getCategoryById(classroom, originalId);
  assert.equal(renamed.name, 'Case Studies');
  assert.equal(renamed.id, originalId);
  assert.equal(renamed.aspects, originalAspects);
});

test('renameCategory on an unknown id is a safe no-op (returns null, mutates nothing)', () => {
  const classroom = buildClassroom();
  assignmentConfigService.addCategory(classroom, 'Worksheets');
  const result = assignmentConfigService.renameCategory(classroom, 'nonexistent', 'New Name');
  assert.equal(result, null);
  assert.equal(assignmentConfigService.listCategories(classroom).length, 1);
});

test('removeCategory removes only that category, leaving others untouched', () => {
  const classroom = buildClassroom();
  const a = assignmentConfigService.addCategory(classroom, 'Worksheets');
  const b = assignmentConfigService.addCategory(classroom, 'Projects');

  assignmentConfigService.removeCategory(classroom, a.id);

  const remaining = assignmentConfigService.listCategories(classroom);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, b.id);
});

test('addAspect/renameAspect/removeAspect manage a category\'s own aspect list independently of other categories', () => {
  const classroom = buildClassroom();
  const worksheets = assignmentConfigService.addCategory(classroom, 'Worksheets');
  const projects = assignmentConfigService.addCategory(classroom, 'Projects');

  const accuracy = assignmentConfigService.addAspect(worksheets, 'Accuracy');
  assert.equal(assignmentConfigService.listAspects(worksheets).length, 2); // default Completion + new Accuracy
  assert.equal(assignmentConfigService.listAspects(projects).length, 1); // unaffected

  assignmentConfigService.renameAspect(worksheets, accuracy.id, 'Neatness');
  assert.equal(assignmentConfigService.getAspectById(worksheets, accuracy.id).name, 'Neatness');

  assignmentConfigService.removeAspect(worksheets, accuracy.id);
  assert.equal(assignmentConfigService.listAspects(worksheets).length, 1);
  assert.equal(assignmentConfigService.getAspectById(worksheets, accuracy.id), null);
});

test('removing a category never mutates classroom.assignments directly — that is the caller\'s own cascade responsibility (see assignmentService.deleteAllAssignmentsForCategory)', () => {
  const classroom = buildClassroom();
  const category = assignmentConfigService.addCategory(classroom, 'Worksheets');
  classroom.assignments = [{ id: 'a1', categoryId: category.id, records: [{ studentId: 's1' }] }];

  assignmentConfigService.removeCategory(classroom, category.id);

  assert.equal(classroom.assignments.length, 1, 'assignmentConfigService itself must never silently touch classroom.assignments');
});
