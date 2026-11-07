/**
 * tests/services/notebookConfigService.reviewCriteria.test.js
 *
 * services/notebookConfigService.js's own review-criteria catalog
 * additions (ensureReviewCriteria/listReviewCriteria/
 * addCustomReviewCriterion/removeReviewCriterion) — the teacher-managed,
 * reusable checklist services/notebookReviewService.js scores against.
 * Named separately from a hypothetical full notebookConfigService.test.js
 * (which does not exist yet — see tests/services/workRequestService's own
 * absence, noted in this feature's own investigation) so this feature's
 * own test coverage is clearly scoped and doesn't block on writing full
 * coverage for the rest of that service's pre-existing surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as notebookConfigService from '../../js/services/notebookConfigService.js';

function freshClassroom() {
  return { id: 'c1', notebookConfig: { subjects: [], notebookTypes: [], reviewCriteria: [] } };
}

test('ensureReviewCriteria: seeds exactly the 4 default criteria for a classroom with an empty reviewCriteria array', () => {
  const classroom = freshClassroom();
  const criteria = notebookConfigService.ensureReviewCriteria(classroom);
  assert.equal(criteria.length, 4);
  assert.equal(classroom.notebookConfig.reviewCriteria.length, 4);
});

test('ensureReviewCriteria: also seeds correctly when reviewCriteria is entirely MISSING (legacy classroom predating this feature)', () => {
  const classroom = { id: 'c1', notebookConfig: { subjects: [], notebookTypes: [] } };
  const criteria = notebookConfigService.ensureReviewCriteria(classroom);
  assert.equal(criteria.length, 4);
});

test('ensureReviewCriteria: exactly one seeded criterion is system-determined ("Timely submission")', () => {
  const classroom = freshClassroom();
  const criteria = notebookConfigService.ensureReviewCriteria(classroom);
  const systemDetermined = criteria.filter((c) => c.isSystemDetermined);
  assert.equal(systemDetermined.length, 1);
  assert.equal(systemDetermined[0].label, 'Timely submission');
});

test('ensureReviewCriteria: idempotent — calling it again after a teacher has already customized the catalog (e.g. removed a default) never re-seeds or duplicates', () => {
  const classroom = freshClassroom();
  notebookConfigService.ensureReviewCriteria(classroom);
  const nonSystem = notebookConfigService.listReviewCriteria(classroom).find((c) => !c.isSystemDetermined);
  notebookConfigService.removeReviewCriterion(classroom, nonSystem.id);
  assert.equal(classroom.notebookConfig.reviewCriteria.length, 3);

  notebookConfigService.ensureReviewCriteria(classroom);
  assert.equal(classroom.notebookConfig.reviewCriteria.length, 3); // still 3, not re-seeded back to 4
});

test('addCustomReviewCriterion: adds a new, reusable criterion with isCustom true', () => {
  const classroom = freshClassroom();
  const criterion = notebookConfigService.addCustomReviewCriterion(classroom, 'Correctly labelled diagrams');
  assert.ok(criterion);
  assert.equal(criterion.label, 'Correctly labelled diagrams');
  assert.equal(criterion.isCustom, true);
  assert.equal(criterion.isSystemDetermined, false);
  assert.equal(notebookConfigService.listReviewCriteria(classroom).length, 5); // 4 defaults + this one
});

test('addCustomReviewCriterion: trims whitespace and rejects an empty/whitespace-only label', () => {
  const classroom = freshClassroom();
  assert.equal(notebookConfigService.addCustomReviewCriterion(classroom, '   '), null);
  assert.equal(notebookConfigService.addCustomReviewCriterion(classroom, ''), null);

  const criterion = notebookConfigService.addCustomReviewCriterion(classroom, '  Page numbering  ');
  assert.equal(criterion.label, 'Page numbering');
});

test('addCustomReviewCriterion: rejects a case-insensitive duplicate of an EXISTING label (default or custom)', () => {
  const classroom = freshClassroom();
  assert.equal(notebookConfigService.addCustomReviewCriterion(classroom, 'neat handwriting'), null); // duplicates a default, different case

  const created = notebookConfigService.addCustomReviewCriterion(classroom, 'Complete answers');
  assert.ok(created);
  assert.equal(notebookConfigService.addCustomReviewCriterion(classroom, 'complete answers'), null); // duplicates the custom one just added, different case
});

test('addCustomReviewCriterion: the SAME criterion is reused across multiple notebooks/reviews — adding it once makes it available to every future review, never recreated per notebook', () => {
  const classroom = freshClassroom();
  const created = notebookConfigService.addCustomReviewCriterion(classroom, 'Complete answers');
  const criteriaFirstRead = notebookConfigService.listReviewCriteria(classroom);
  const criteriaSecondRead = notebookConfigService.listReviewCriteria(classroom);
  assert.ok(criteriaFirstRead.some((c) => c.id === created.id));
  assert.ok(criteriaSecondRead.some((c) => c.id === created.id));
  assert.equal(criteriaFirstRead.length, criteriaSecondRead.length);
});

test('removeReviewCriterion: removes a custom criterion', () => {
  const classroom = freshClassroom();
  const created = notebookConfigService.addCustomReviewCriterion(classroom, 'Page numbering');
  const removed = notebookConfigService.removeReviewCriterion(classroom, created.id);
  assert.equal(removed, true);
  assert.equal(notebookConfigService.listReviewCriteria(classroom).some((c) => c.id === created.id), false);
});

test('removeReviewCriterion: refuses to remove the system-determined "Timely submission" criterion', () => {
  const classroom = freshClassroom();
  const criteria = notebookConfigService.ensureReviewCriteria(classroom);
  const timely = criteria.find((c) => c.isSystemDetermined);

  const removed = notebookConfigService.removeReviewCriterion(classroom, timely.id);
  assert.equal(removed, false);
  assert.equal(notebookConfigService.listReviewCriteria(classroom).some((c) => c.id === timely.id), true);
});

test('getReviewCriterionById: resolves an existing criterion, null for an unknown id', () => {
  const classroom = freshClassroom();
  const created = notebookConfigService.addCustomReviewCriterion(classroom, 'Page numbering');
  assert.equal(notebookConfigService.getReviewCriterionById(classroom, created.id).label, 'Page numbering');
  assert.equal(notebookConfigService.getReviewCriterionById(classroom, 'no-such-id'), null);
});
