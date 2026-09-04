import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, createLessonPlanActivity, LESSON_PLAN_STATUS, getLessonPlanActivityIndex, findLessonPlanActivity } from '../../js/models/LessonPlan.js';
import * as lessonPlanService from '../../js/services/lessonPlanService.js';

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
