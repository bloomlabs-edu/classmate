/**
 * tests/services/badgeServiceWorkItemMeta.test.js
 *
 * services/badgeService.js's awardBadge() own, purely-additive `meta`
 * parameter (Recognition, comments, and testimonials feature) —
 * confirms every pre-existing call shape is completely unaffected, and
 * that the new optional third argument attaches to the timeline entry
 * exactly as intended.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as badgeService from '../../js/services/badgeService.js';
import { createStudent } from '../../js/models/Student.js';

test('awardBadge: calling with no third argument (every pre-existing call site) produces the exact same entry shape as before', () => {
  const student = createStudent({ id: 's1' });
  badgeService.awardBadge(student, 'Helpful');

  const entry = student.history[0];
  assert.deepEqual(Object.keys(entry).sort(), ['delta', 'id', 'kind', 'label', 'recordedAt'].sort());
  assert.equal(entry.kind, 'badge');
  assert.equal(entry.label, 'Helpful');
});

test('awardBadge: an explicit workItemRef/commentId in meta rides along on the timeline entry', () => {
  const student = createStudent({ id: 's1' });
  const workItemRef = { type: 'notebook', subjectId: 'x', notebookTypeId: 'y', dateKey: 'z' };
  badgeService.awardBadge(student, 'Helpful', { workItemRef, commentId: 'comment-1' });

  const entry = student.history[0];
  assert.deepEqual(entry.workItemRef, workItemRef);
  assert.equal(entry.commentId, 'comment-1');
});

test('awardBadge: still refuses a duplicate badge regardless of meta', () => {
  const student = createStudent({ id: 's1' });
  badgeService.awardBadge(student, 'Helpful');
  const second = badgeService.awardBadge(student, 'Helpful', { workItemRef: { type: 'notebook' } });

  assert.equal(second, false);
  assert.equal(student.history.filter((e) => e.kind === 'badge').length, 1);
});
