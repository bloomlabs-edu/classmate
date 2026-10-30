/**
 * tests/ui/workRequestReviewRollback.test.js
 *
 * Regression coverage for the targeted fix to
 * ui/views/WorkRequestRosterView.js's own review-modal save handler —
 * the pre-commit review (2026-10-29) found that a fire-and-forget
 * `workspaceService.save(classroom)` call there could leave the
 * in-memory classroom reporting a successful review (and award
 * criteria/criterion add) even when the actual Firestore write failed,
 * with no rollback and no error shown to the teacher.
 *
 * `openReviewModal()` itself is a private, DOM-building function not
 * exported from that view (it calls `document.createElement`/
 * `document.body.appendChild`, same as every other overlay in this
 * app) — exercising the real button-click -> fetch-failure -> DOM
 * error-text path end-to-end would require a real browser (Playwright)
 * or a jsdom harness, neither of which exists in this repo's plain
 * `node:test` unit-test lane (see scripts/runUnitTests.mjs's own
 * documented Playwright/emulator exclusions). Importing the view
 * module itself here isn't viable either way: it transitively imports
 * js/config/appConfig.js, which reads `window` at module-load time and
 * throws immediately outside a real browser — confirmed directly while
 * writing this file. `restoreObject()` — the exact rollback primitive
 * the fix's save handler calls on a caught save failure — was
 * therefore extracted to the dependency-free utils/objectRollback.js
 * specifically so it's importable here with no DOM and no stub loader.
 * These tests prove the mechanism the fix relies on is correct: apply
 * the exact same mutation `submitNotebookReview()`/`editNotebookReview()`
 * perform, then call `restoreObject()` exactly as the real handler's
 * catch block does, and confirm the result is a byte-for-byte no-op —
 * the same sequence a real failed save triggers, just without a DOM
 * around it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudent } from '../../js/models/Student.js';
import { createTeam } from '../../js/models/Team.js';
import * as workRequestService from '../../js/services/workRequestService.js';
import * as notebookConfigService from '../../js/services/notebookConfigService.js';
import * as notebookReviewService from '../../js/services/notebookReviewService.js';
import * as timelineService from '../../js/services/timelineService.js';
import { restoreObject } from '../../js/utils/objectRollback.js';

function freshClassroom() {
  const student = createStudent({ id: 'stu1', name: 'Ann' });
  const team = createTeam({ id: 'team1', name: 'Team A', students: [student] });
  return {
    id: 'c1',
    teams: [team],
    workRequests: [],
    notebookConfig: { subjects: [], notebookTypes: [], reviewCriteria: [] },
  };
}

function getStudent(classroom) {
  return classroom.teams[0].students[0];
}

function createSubmittedRequest(classroom, { dueDate, submittedDateKey }) {
  const request = workRequestService.createNewWorkRequest(classroom, { title: 'Science Notebook', subjectId: 'sci', notebookTypeId: 'hw', dueDate });
  const studentId = getStudent(classroom).id;
  workRequestService.advanceStatus(request, studentId);
  const entry = workRequestService.getEntryForStudent(request, studentId);
  entry.updatedAt = `${submittedDateKey}T10:00:00.000Z`;
  entry.history[entry.history.length - 1].date = entry.updatedAt;
  return { request, studentId, entry };
}

// ---------------------------------------------------------------------
// restoreObject() itself — the generic rollback primitive
// ---------------------------------------------------------------------

test('restoreObject: restores a mutated object to an exact prior JSON snapshot, in place (same reference)', () => {
  const target = { a: 1, b: 2 };
  const snapshot = JSON.parse(JSON.stringify(target));

  target.a = 999;
  target.c = 'new field added after the snapshot';

  const result = restoreObject(target, snapshot);

  assert.strictEqual(result, undefined); // mutates in place, doesn't return a new object
  assert.equal(target.a, 1);
  assert.equal(target.b, 2);
  assert.equal('c' in target, false); // a field added AFTER the snapshot is removed entirely, not left dangling
});

test('restoreObject: correctly reverts an array field that was pushed to (e.g. entry.history/entry.reviews/student.history)', () => {
  const target = { history: [{ kind: 'points', delta: 1 }] };
  const snapshot = JSON.parse(JSON.stringify(target));

  target.history.push({ kind: 'points', delta: 5 }); // simulates a second award being appended

  restoreObject(target, snapshot);

  assert.equal(target.history.length, 1);
  assert.deepEqual(target.history, snapshot.history);
});

test('restoreObject: reverts a field that did not exist at all before the mutation (e.g. entry.reviews on its very first review)', () => {
  const target = { status: 'submitted' };
  const snapshot = JSON.parse(JSON.stringify(target));

  target.status = 'reviewed';
  target.reviews = [{ id: 'r1', totalPoints: 2 }]; // the field itself is newly created by the mutation

  restoreObject(target, snapshot);

  assert.equal(target.status, 'submitted');
  assert.equal('reviews' in target, false);
});

// ---------------------------------------------------------------------
// End-to-end: the exact sequence the review modal's save handler
// performs — snapshot, mutate via the real service, "fail," roll back
// — proves a failed save is a complete, byte-for-byte no-op on both
// the WorkRequestEntry and the student.
// ---------------------------------------------------------------------

test('simulated persistence failure on FIRST review (submitNotebookReview): rollback restores entry status/history/reviews and student history/score to exactly their pre-operation state', () => {
  const classroom = freshClassroom();
  const { request, studentId, entry } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const student = getStudent(classroom);
  const neat = notebookConfigService.listReviewCriteria(classroom).find((c) => c.label === 'Neat handwriting').id;

  // Exactly what openReviewModal()'s saveButton handler does, in order:
  // snapshot BEFORE mutating, then mutate via the real service.
  const entrySnapshot = JSON.parse(JSON.stringify(entry));
  const studentSnapshot = JSON.parse(JSON.stringify(student));

  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] });
  assert.ok(review); // the mutation genuinely happened
  assert.equal(entry.status, 'reviewed');
  assert.equal(timelineService.getNetPoints(student), 2); // Timely + Neat

  // Simulate workspaceService.saveExplicitly(classroom) rejecting —
  // the real handler's catch block calls exactly this.
  restoreObject(entry, entrySnapshot);
  restoreObject(student, studentSnapshot);

  assert.deepEqual(entry, entrySnapshot);
  assert.deepEqual(student, studentSnapshot);
  assert.equal(entry.status, 'submitted'); // reverted — never left falsely "Reviewed"
  assert.equal(entry.reviews, undefined); // the review record is gone, not just "marked invalid"
  assert.equal(timelineService.getNetPoints(student), 0); // the points are gone too — no stray ledger entry survives
});

test('simulated persistence failure on EDITING an already-saved review: rollback restores the entry/student to the state of the ORIGINAL (successfully saved) review, not an empty state', () => {
  const classroom = freshClassroom();
  const { request, studentId, entry } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const student = getStudent(classroom);
  const neat = notebookConfigService.listReviewCriteria(classroom).find((c) => c.label === 'Neat handwriting').id;
  const organization = notebookConfigService.listReviewCriteria(classroom).find((c) => c.label === 'Organization').id;

  // The original review "successfully saved" (no save simulated here —
  // this step isn't rolled back, matching a real prior successful save).
  const original = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] });
  assert.equal(original.totalPoints, 2); // Timely + Neat

  // Now the teacher opens "Edit Review" and adds Organization — snapshot
  // BEFORE this second mutation, exactly like the real handler.
  const entrySnapshot = JSON.parse(JSON.stringify(entry));
  const studentSnapshot = JSON.parse(JSON.stringify(student));

  const corrected = notebookReviewService.editNotebookReview(classroom, request, studentId, { criterionIds: [neat, organization] });
  assert.equal(corrected.totalPoints, 3);
  assert.equal(timelineService.getNetPoints(student), 3);

  // Simulate the save failing on this EDIT specifically.
  restoreObject(entry, entrySnapshot);
  restoreObject(student, studentSnapshot);

  assert.deepEqual(entry, entrySnapshot);
  assert.deepEqual(student, studentSnapshot);
  assert.equal(entry.reviews.length, 1); // back to just the original review — the correction attempt is gone
  assert.equal(entry.reviews[0].id, original.id);
  assert.equal(timelineService.getNetPoints(student), 2); // back to the ORIGINAL successfully-saved total, not 0 and not the failed correction's 3
});

// ---------------------------------------------------------------------
// Successful-save counterpart — confirms the normal flow is untouched:
// when nothing fails, nothing is rolled back and the award stands.
// ---------------------------------------------------------------------

test('successful save (no failure simulated): the mutation stands exactly as applied — restoreObject() is simply never called', () => {
  const classroom = freshClassroom();
  const { request, studentId, entry } = createSubmittedRequest(classroom, { dueDate: '2026-12-01', submittedDateKey: '2026-11-28' });
  const student = getStudent(classroom);
  const neat = notebookConfigService.listReviewCriteria(classroom).find((c) => c.label === 'Neat handwriting').id;

  const entrySnapshot = JSON.parse(JSON.stringify(entry)); // taken, but never used for rollback on this path
  const review = notebookReviewService.submitNotebookReview(classroom, request, studentId, { criterionIds: [neat] });
  assert.ok(review);

  // No restoreObject() call here — this is the "save succeeded" path.
  assert.equal(entry.status, 'reviewed');
  assert.notDeepEqual(entry, entrySnapshot); // genuinely different from the pre-operation snapshot — the award really stuck
  assert.equal(timelineService.getNetPoints(student), 2);
  assert.equal(entry.reviews.length, 1);
});

test('rollback of a custom-criterion addition (addCustomReviewCriterion + removeReviewCriterion, the real roll-back path the Add-criterion handler uses): the catalog is restored to exactly its prior state', () => {
  const classroom = freshClassroom();
  const criteriaBefore = JSON.parse(JSON.stringify(notebookConfigService.listReviewCriteria(classroom)));

  const created = notebookConfigService.addCustomReviewCriterion(classroom, 'Correctly labelled diagrams');
  assert.ok(created);
  assert.equal(notebookConfigService.listReviewCriteria(classroom).length, criteriaBefore.length + 1);

  // Simulate the save failing — the real handler calls removeReviewCriterion(), not restoreObject(), for this specific rollback.
  const removed = notebookConfigService.removeReviewCriterion(classroom, created.id);

  assert.equal(removed, true);
  assert.deepEqual(notebookConfigService.listReviewCriteria(classroom), criteriaBefore);
});
