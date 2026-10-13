import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssignmentCheckpoint } from '../../js/models/AssignmentCheckpoint.js';

test('createAssignmentCheckpoint: defaults mirror Checkpoint.js exactly, scoped by assignmentId instead of subjectId/notebookTypeId', () => {
  const checkpoint = createAssignmentCheckpoint({ assignmentId: 'assign-1', title: 'Draft', givenDate: '2026-09-01' });

  assert.ok(checkpoint.id);
  assert.equal(checkpoint.assignmentId, 'assign-1');
  assert.equal(checkpoint.title, 'Draft');
  assert.equal(checkpoint.description, '');
  assert.equal(checkpoint.givenDate, '2026-09-01');
  assert.equal(checkpoint.dueDate, '');
  assert.equal(checkpoint.order, 0);
  assert.ok(checkpoint.createdAt);
  assert.deepEqual(checkpoint.records, []);
});

test('createAssignmentCheckpoint: has no conceptIds field — concept linking stays at the parent Assignment level only', () => {
  const checkpoint = createAssignmentCheckpoint({ assignmentId: 'assign-1', title: 'Draft', givenDate: '2026-09-01' });
  assert.equal('conceptIds' in checkpoint, false);
});

test('createAssignmentCheckpoint: honors an explicit id instead of generating one', () => {
  const checkpoint = createAssignmentCheckpoint({ id: 'cp-fixed-1', assignmentId: 'assign-1', title: 'Draft', givenDate: '2026-09-01' });
  assert.equal(checkpoint.id, 'cp-fixed-1');
});
