import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, createLessonPlanActivity, createLessonPlanComment, LESSON_PLAN_STATUS, getLessonPlanActivityIndex, findLessonPlanActivity } from '../../js/models/LessonPlan.js';
import * as lessonPlanService from '../../js/services/lessonPlanService.js';
import { buildActivitySectionKey } from '../../js/services/lessonPlanReviewService.js';

test('createLessonPlan: defaults every dynamic list to empty, status to draft, never undefined anywhere Firestore would reject it', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'u1' });
  assert.deepEqual(plan.activities, []);
  assert.deepEqual(plan.assessments, []);
  assert.deepEqual(plan.swbatObjectives, []);
  assert.deepEqual(plan.conceptIds, []);
  assert.deepEqual(plan.reviewHistory, []);
  assert.deepEqual(plan.activeComments, []);
  assert.deepEqual(plan.sourceElementRefs, []);
  assert.equal(plan.status, LESSON_PLAN_STATUS.DRAFT);
  assert.equal(plan.reviewerUid, null);
  assert.notEqual(plan.updatedAt, undefined);
  assert.deepEqual(plan.selfOthersIndia, { self: '', others: '', india: '' });
  assert.deepEqual(plan.spark, { title: '', teacherAction: '', studentAction: '' });
});

test('createLessonPlanActivity: differentiation defaults to null — progressive disclosure, never three permanently-empty inputs', () => {
  const activity = createLessonPlanActivity({ title: 'Map Reading' });
  assert.equal(activity.differentiation, null);
  assert.equal(activity.title, 'Map Reading');
  assert.ok(activity.id);
});

// ---------------------------------------------------------------------
// Activities — first-class objects: add / duplicate / reorder / delete
// ---------------------------------------------------------------------

test('addActivity: appends a new, blank Activity — never a fixed count', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.addActivity(plan);
  lessonPlanService.addActivity(plan);
  lessonPlanService.addActivity(plan);
  assert.equal(plan.activities.length, 3);
});

test('duplicateActivity: duplicates the COMPLETE structure, including differentiation, with a fresh id, inserted immediately after the original', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const original = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, original.id, { title: 'Group Debate', teacherAction: 'Facilitate', studentAction: 'Argue a position' });
  lessonPlanService.addActivityDifferentiation(plan, original.id);
  lessonPlanService.updateActivityDifferentiation(plan, original.id, { redBucket: 'Sentence starters', greenBucket: 'Lead the debate', others: '' });

  const duplicate = lessonPlanService.duplicateActivity(plan, original.id);

  assert.notEqual(duplicate.id, original.id);
  assert.equal(duplicate.title, 'Group Debate');
  assert.equal(duplicate.teacherAction, 'Facilitate');
  assert.deepEqual(duplicate.differentiation, { redBucket: 'Sentence starters', greenBucket: 'Lead the debate', others: '' });
  assert.equal(getLessonPlanActivityIndex(plan, duplicate.id), getLessonPlanActivityIndex(plan, original.id) + 1);

  // Mutating the duplicate's differentiation must never leak back into
  // the original — this must be a deep clone, not a shared reference.
  lessonPlanService.updateActivityDifferentiation(plan, duplicate.id, { redBucket: 'Changed' });
  assert.equal(findLessonPlanActivity(plan, original.id).differentiation.redBucket, 'Sentence starters');
});

test('deleteActivity: removes exactly that one Activity, including its differentiation — nothing else in the list is touched', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const a = lessonPlanService.addActivity(plan);
  const b = lessonPlanService.addActivity(plan);
  const c = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, b.id, { title: 'Keep me' });

  lessonPlanService.deleteActivity(plan, a.id);

  assert.equal(plan.activities.length, 2);
  assert.equal(findLessonPlanActivity(plan, a.id), null);
  assert.equal(findLessonPlanActivity(plan, b.id).title, 'Keep me');
  assert.ok(findLessonPlanActivity(plan, c.id));
});

test('moveActivityUp/moveActivityDown: swap order, no-op at the boundaries, and do NOT bump updatedAt (reordering isn\'t a content edit)', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const a = lessonPlanService.addActivity(plan);
  const b = lessonPlanService.addActivity(plan);
  const beforeUpdatedAt = plan.updatedAt;

  lessonPlanService.moveActivityDown(plan, a.id);
  assert.deepEqual(plan.activities.map((activity) => activity.id), [b.id, a.id]);
  assert.equal(plan.updatedAt, beforeUpdatedAt);

  // No-op past the boundary — order stays exactly as is.
  lessonPlanService.moveActivityDown(plan, a.id);
  assert.deepEqual(plan.activities.map((activity) => activity.id), [b.id, a.id]);

  lessonPlanService.moveActivityUp(plan, a.id);
  assert.deepEqual(plan.activities.map((activity) => activity.id), [a.id, b.id]);

  lessonPlanService.moveActivityUp(plan, a.id);
  assert.deepEqual(plan.activities.map((activity) => activity.id), [a.id, b.id]);
});

test('updateActivity: a real content edit DOES bump updatedAt, unlike reordering', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  // An old fixed baseline, not "whatever the clock said a moment ago"
  // — two synchronous calls can land in the same millisecond, which
  // would make a real-clock comparison here flaky rather than wrong.
  plan.updatedAt = '2020-01-01T00:00:00.000Z';
  lessonPlanService.updateActivity(plan, activity.id, { title: 'New title' });
  assert.notEqual(plan.updatedAt, '2020-01-01T00:00:00.000Z');
});

test('addActivityDifferentiation: reveals Red/Green/Other Bucket fields once; a second call is a no-op that never resets existing text', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);

  lessonPlanService.addActivityDifferentiation(plan, activity.id);
  lessonPlanService.updateActivityDifferentiation(plan, activity.id, { redBucket: 'Extra scaffolding' });

  lessonPlanService.addActivityDifferentiation(plan, activity.id); // should be a no-op
  assert.equal(findLessonPlanActivity(plan, activity.id).differentiation.redBucket, 'Extra scaffolding');
});

test('removeActivityDifferentiation: collapses differentiation back to null — the teacher\'s own explicit "remove" action', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.addActivityDifferentiation(plan, activity.id);
  lessonPlanService.removeActivityDifferentiation(plan, activity.id);
  assert.equal(findLessonPlanActivity(plan, activity.id).differentiation, null);
});

// ---------------------------------------------------------------------
// Phase 3 — Activity comments stay attached to the ACTIVITY ID, never
// a positional "Activity N" label, and never leak between a duplicate
// and its original.
// ---------------------------------------------------------------------

test('a comment addressed to an activity survives that activity being reordered — sectionKey is id-based, not position-based', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const a = lessonPlanService.addActivity(plan);
  const b = lessonPlanService.addActivity(plan);
  plan.activeComments.push(createLessonPlanComment({ sectionKey: buildActivitySectionKey(b.id), text: 'Make the Student Action more observable.', byUid: 'pm-1' }));

  // b starts at position 2 (index 1); move it to position 1.
  lessonPlanService.moveActivityUp(plan, b.id);
  assert.deepEqual(plan.activities.map((activity) => activity.id), [b.id, a.id]);

  const comment = plan.activeComments.find((c) => c.sectionKey === buildActivitySectionKey(b.id));
  assert.ok(comment, 'comment must still be addressed to b\'s own id after reordering');
  assert.equal(comment.text, 'Make the Student Action more observable.');
});

test('duplicating an activity does NOT copy the original\'s comments onto the new activity', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const original = lessonPlanService.addActivity(plan);
  plan.activeComments.push(createLessonPlanComment({ sectionKey: buildActivitySectionKey(original.id), text: 'Fix the Teacher Action.', byUid: 'pm-1' }));

  const duplicate = lessonPlanService.duplicateActivity(plan, original.id);

  const commentsOnDuplicate = plan.activeComments.filter((c) => c.sectionKey === buildActivitySectionKey(duplicate.id));
  assert.equal(commentsOnDuplicate.length, 0);
  // The original's own comment must still be exactly where it was.
  const commentsOnOriginal = plan.activeComments.filter((c) => c.sectionKey === buildActivitySectionKey(original.id));
  assert.equal(commentsOnOriginal.length, 1);
});

test('deleting an activity removes its OPEN comments (whole-activity and sub-field) from activeComments, but never touches reviewHistory', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  const otherActivity = lessonPlanService.addActivity(plan);
  plan.activeComments.push(
    createLessonPlanComment({ sectionKey: buildActivitySectionKey(activity.id), text: 'Whole-activity note.', byUid: 'pm-1' }),
    createLessonPlanComment({ sectionKey: buildActivitySectionKey(activity.id, 'differentiation.greenBucket'), text: 'Clarify the Green Bucket.', byUid: 'pm-1' }),
    createLessonPlanComment({ sectionKey: buildActivitySectionKey(otherActivity.id), text: 'Unrelated note on a different activity.', byUid: 'pm-1' })
  );
  // Simulate a frozen historical round that also mentions this activity —
  // this must survive the delete completely untouched.
  plan.reviewHistory.push({
    id: 'round-1',
    status: 'changes_requested',
    byUid: 'pm-1',
    at: '2026-01-01T00:00:00.000Z',
    comments: [createLessonPlanComment({ sectionKey: buildActivitySectionKey(activity.id), text: 'Historical note.', byUid: 'pm-1' })],
  });

  lessonPlanService.deleteActivity(plan, activity.id);

  assert.equal(plan.activeComments.length, 1);
  assert.equal(plan.activeComments[0].sectionKey, buildActivitySectionKey(otherActivity.id));
  // reviewHistory is append-only — untouched even though it references a now-deleted activity.
  assert.equal(plan.reviewHistory[0].comments[0].text, 'Historical note.');
});

// ---------------------------------------------------------------------
// Assessments / SWBAT — dynamic lists, never a single bare field
// ---------------------------------------------------------------------

test('addAssessmentItem/updateAssessmentItem/removeAssessmentItem: a dynamic list of evidence items', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const item = lessonPlanService.addAssessmentItem(plan, 'Exit ticket');
  assert.equal(plan.assessments.length, 1);
  lessonPlanService.updateAssessmentItem(plan, item.id, 'Exit ticket + peer check');
  assert.equal(plan.assessments[0].description, 'Exit ticket + peer check');
  lessonPlanService.removeAssessmentItem(plan, item.id);
  assert.equal(plan.assessments.length, 0);
});

test('addSwbatObjective/updateSwbatObjective/removeSwbatObjective: a dynamic list of SWBAT strings', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.addSwbatObjective(plan, 'Identify the causes of the revolt');
  lessonPlanService.addSwbatObjective(plan, 'Explain Kattabomman\'s role');
  assert.equal(plan.swbatObjectives.length, 2);
  lessonPlanService.updateSwbatObjective(plan, 0, 'Identify at least two causes of the revolt');
  assert.equal(plan.swbatObjectives[0], 'Identify at least two causes of the revolt');
  lessonPlanService.removeSwbatObjective(plan, 1);
  assert.equal(plan.swbatObjectives.length, 1);
});
