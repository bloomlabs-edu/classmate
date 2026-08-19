import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgrammeMembership } from '../../js/models/ProgrammeMembership.js';

test('createProgrammeMembership: defaults to active, no leftAt', () => {
  const membership = createProgrammeMembership({ studentId: 'student-1' });

  assert.equal(membership.studentId, 'student-1');
  assert.equal(membership.status, 'active');
  assert.equal(membership.leftAt, null);
  assert.ok(membership.joinedAt);
  assert.ok(membership.id);
});

test('createProgrammeMembership: never copies student profile data — only studentId is stored', () => {
  const membership = createProgrammeMembership({ studentId: 'student-1' });
  const keys = Object.keys(membership);

  assert.deepEqual(keys.sort(), ['id', 'joinedAt', 'leftAt', 'status', 'studentId'].sort());
});
