import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, createLessonPlanActivity, createLessonPlanComment, LESSON_PLAN_STATUS, getLessonPlanActivityIndex, findLessonPlanActivity, getLessonPlanObjectiveIndex, findLessonPlanObjective } from '../../js/models/LessonPlan.js';
import * as lessonPlanService from '../../js/services/lessonPlanService.js';
import { buildActivitySectionKey } from '../../js/services/lessonPlanReviewService.js';

test('createLessonPlan: defaults every dynamic list to empty, status to draft, never undefined anywhere Firestore would reject it', () => {
  const plan = createLessonPlan({ classroomId: 'c1', createdByUid: 'u1' });
  assert.deepEqual(plan.activities, []);
  assert.deepEqual(plan.assessments, []);
  assert.deepEqual(plan.objectives, []);
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
  // Scheduling — a durable reference into the classroom's own real
  // Timetable (see this model's own doc comment), never populated by
  // default: `null` here means "not yet scheduled," a real, valid
  // state, never `undefined` (Firestore setDoc() rejects that outright).
  assert.equal(plan.scheduledDate, null);
  assert.equal(plan.scheduledPeriodNumber, null);
});

// ---------------------------------------------------------------------
// Scheduling — lessonPlanService.updateSchedule(). Both fields are set
// or cleared together; a lone date or a lone period is never a state
// this model represents.
// ---------------------------------------------------------------------

test('updateSchedule: sets both scheduledDate and scheduledPeriodNumber together, and bumps updatedAt (a real content edit)', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  // An old fixed baseline, not "whatever the clock said a moment ago"
  // — two synchronous calls can land in the same millisecond, which
  // would make a real-clock comparison here flaky rather than wrong
  // (see updateActivity's own identical test above for the same fix).
  plan.updatedAt = '2020-01-01T00:00:00.000Z';
  lessonPlanService.updateSchedule(plan, { scheduledDate: '2026-09-07', scheduledPeriodNumber: 3 });
  assert.equal(plan.scheduledDate, '2026-09-07');
  assert.equal(plan.scheduledPeriodNumber, 3);
  assert.notEqual(plan.updatedAt, '2020-01-01T00:00:00.000Z');
});

test('updateSchedule: clearing (both null) resets both fields together', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.updateSchedule(plan, { scheduledDate: '2026-09-07', scheduledPeriodNumber: 3 });
  lessonPlanService.updateSchedule(plan, { scheduledDate: null, scheduledPeriodNumber: null });
  assert.equal(plan.scheduledDate, null);
  assert.equal(plan.scheduledPeriodNumber, null);
});

test('updateSchedule: a lone date with no period (or a lone period with no date) is rejected as a no-op — never leaves one field set while the other is null', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const before = plan.updatedAt;

  lessonPlanService.updateSchedule(plan, { scheduledDate: '2026-09-07', scheduledPeriodNumber: null });
  assert.equal(plan.scheduledDate, null);
  assert.equal(plan.scheduledPeriodNumber, null);
  assert.equal(plan.updatedAt, before);

  lessonPlanService.updateSchedule(plan, { scheduledDate: null, scheduledPeriodNumber: 3 });
  assert.equal(plan.scheduledDate, null);
  assert.equal(plan.scheduledPeriodNumber, null);
  assert.equal(plan.updatedAt, before);

  // Same guard applies to an already-scheduled plan — a partial call
  // must never silently overwrite half of a real, existing schedule.
  lessonPlanService.updateSchedule(plan, { scheduledDate: '2026-09-07', scheduledPeriodNumber: 3 });
  const afterRealSchedule = plan.updatedAt;
  lessonPlanService.updateSchedule(plan, { scheduledDate: '2026-09-10', scheduledPeriodNumber: null });
  assert.equal(plan.scheduledDate, '2026-09-07');
  assert.equal(plan.scheduledPeriodNumber, 3);
  assert.equal(plan.updatedAt, afterRealSchedule);
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
// Phase 4 — Teaching Ideas copy-in: new id, deep copy, provenance
// recorded, source untouched, copy freely editable afterward.
// ---------------------------------------------------------------------

test('addActivityFromTeachingIdea: copies content as a brand-new Activity with a fresh id and records provenance', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivityFromTeachingIdea(
    plan,
    { title: 'Human Number Line', teacherAction: 'Mark a line on the floor.', studentAction: 'Stand at your fraction’s position.', differentiation: { redBucket: 'Give a number card.', greenBucket: '', others: '' } },
    { sourceLessonPlanId: 'other-plan-1', sourceActivityId: 'other-activity-1' }
  );

  assert.equal(plan.activities.length, 1);
  assert.notEqual(activity.id, 'other-activity-1');
  assert.equal(activity.title, 'Human Number Line');
  assert.deepEqual(activity.differentiation, { redBucket: 'Give a number card.', greenBucket: '', others: '' });

  assert.equal(plan.sourceElementRefs.length, 1);
  assert.equal(plan.sourceElementRefs[0].elementType, 'activity');
  assert.equal(plan.sourceElementRefs[0].sourceLessonPlanId, 'other-plan-1');
  assert.equal(plan.sourceElementRefs[0].sourceActivityId, 'other-activity-1');
  assert.equal(plan.sourceElementRefs[0].resourceId, null);

  // Mutating the copy must never reach back into the source object passed in.
  activity.differentiation.redBucket = 'Changed locally';
  assert.equal(activity.differentiation.redBucket, 'Changed locally');
});

test('addActivityFromTeachingIdea: copying twice from the same source produces two fully independent activities', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const source = { title: 'Human Number Line', teacherAction: 'TA', studentAction: 'SA', differentiation: null };
  const first = lessonPlanService.addActivityFromTeachingIdea(plan, source, { sourceLessonPlanId: 'p1', sourceActivityId: 'a1' });
  const second = lessonPlanService.addActivityFromTeachingIdea(plan, source, { sourceLessonPlanId: 'p1', sourceActivityId: 'a1' });
  assert.notEqual(first.id, second.id);
  assert.equal(plan.activities.length, 2);
  lessonPlanService.updateActivity(plan, first.id, { title: 'Edited copy one' });
  assert.equal(findLessonPlanActivity(plan, second.id).title, 'Human Number Line');
});

test('applySparkFromTeachingIdea: replaces this plan\'s own Spark and records provenance', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.applySparkFromTeachingIdea(plan, { title: 'Which fraction is hiding?', teacherAction: 'Cover part of a shape.', studentAction: 'Guess the fraction.' }, { sourceLessonPlanId: 'other-plan-1' });
  assert.deepEqual(plan.spark, { title: 'Which fraction is hiding?', teacherAction: 'Cover part of a shape.', studentAction: 'Guess the fraction.' });
  assert.equal(plan.sourceElementRefs[0].elementType, 'spark');
  assert.equal(plan.sourceElementRefs[0].sourceLessonPlanId, 'other-plan-1');
  assert.equal(plan.sourceElementRefs[0].sourceActivityId, null);
});

test('addAssessmentItemFromTeachingIdea: adds a new assessment item and records provenance, same shape as addAssessmentItem', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const item = lessonPlanService.addAssessmentItemFromTeachingIdea(plan, 'Exit ticket: prove 3/4 > 2/3', { sourceLessonPlanId: 'other-plan-1' });
  assert.equal(plan.assessments.length, 1);
  assert.equal(plan.assessments[0].id, item.id);
  assert.equal(plan.sourceElementRefs[0].elementType, 'assessment');
});

test('applyQuestionFromTeachingIdea: copies into bigQuestion or finalQuestion by field name, and records provenance', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.applyQuestionFromTeachingIdea(plan, 'bigQuestion', 'How can you prove that 3/4 is greater than 2/3?', { sourceLessonPlanId: 'other-plan-1' });
  assert.equal(plan.bigQuestion, 'How can you prove that 3/4 is greater than 2/3?');
  assert.equal(plan.finalQuestion, '');
  assert.equal(plan.sourceElementRefs[0].elementType, 'question');

  lessonPlanService.applyQuestionFromTeachingIdea(plan, 'finalQuestion', 'Which method was fastest?', { sourceLessonPlanId: 'other-plan-2' });
  assert.equal(plan.finalQuestion, 'Which method was fastest?');
  assert.equal(plan.sourceElementRefs.length, 2);
});

test('applyDifferentiationBucketFromTeachingIdea: copies into exactly ONE bucket of an existing activity, leaving the other buckets untouched', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.addActivityDifferentiation(plan, activity.id);
  lessonPlanService.updateActivityDifferentiation(plan, activity.id, { redBucket: 'Already here', others: 'Also already here' });

  lessonPlanService.applyDifferentiationBucketFromTeachingIdea(plan, activity.id, 'greenBucket', 'Represent the comparison visually before explaining.', {
    sourceLessonPlanId: 'other-plan-1',
    sourceActivityId: 'other-activity-1',
  });

  const updated = findLessonPlanActivity(plan, activity.id);
  assert.equal(updated.differentiation.greenBucket, 'Represent the comparison visually before explaining.');
  assert.equal(updated.differentiation.redBucket, 'Already here'); // untouched
  assert.equal(updated.differentiation.others, 'Also already here'); // untouched
  assert.equal(plan.sourceElementRefs[0].elementType, 'differentiation');
});

test('applyDifferentiationBucketFromTeachingIdea: reveals differentiation first if the activity does not have it yet (progressive disclosure preserved)', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const activity = lessonPlanService.addActivity(plan);
  assert.equal(activity.differentiation, null);

  lessonPlanService.applyDifferentiationBucketFromTeachingIdea(plan, activity.id, 'redBucket', 'Extra scaffolding.', { sourceLessonPlanId: 'p1', sourceActivityId: 'a1' });

  const updated = findLessonPlanActivity(plan, activity.id);
  assert.equal(updated.differentiation.redBucket, 'Extra scaffolding.');
  assert.equal(updated.differentiation.greenBucket, '');
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

test('addSwbatObjective/updateSwbatObjective/removeSwbatObjective: a dynamic list of SWBAT strings — legacy, no current UI writes it, but still a valid mutation of the model', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  lessonPlanService.addSwbatObjective(plan, 'Identify the causes of the revolt');
  lessonPlanService.addSwbatObjective(plan, 'Explain Kattabomman\'s role');
  assert.equal(plan.swbatObjectives.length, 2);
  lessonPlanService.updateSwbatObjective(plan, 0, 'Identify at least two causes of the revolt');
  assert.equal(plan.swbatObjectives[0], 'Identify at least two causes of the revolt');
  lessonPlanService.removeSwbatObjective(plan, 1);
  assert.equal(plan.swbatObjectives.length, 1);
});

// ---------------------------------------------------------------------
// Objectives — first-class objects, each with its own stable, real id
// (see models/LessonPlan.js's own createLessonPlanObjective() doc
// comment): add / edit / delete / reorder, same shape as Activities'
// own test block above.
// ---------------------------------------------------------------------

test('addObjective: appends a new objective with real text and a real, independent id — never a fixed count', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const first = lessonPlanService.addObjective(plan, 'Explain the conflict between Kattabomman and the British');
  const second = lessonPlanService.addObjective(plan, 'Identify the role of the Nawab of Arcot');
  assert.equal(plan.objectives.length, 2);
  assert.ok(first.id);
  assert.ok(second.id);
  assert.notEqual(first.id, second.id);
  assert.equal(plan.objectives[0].text, 'Explain the conflict between Kattabomman and the British');
});

test('updateObjective: edits exactly one objective\'s text by id, leaving every other objective untouched', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const a = lessonPlanService.addObjective(plan, 'Original text');
  const b = lessonPlanService.addObjective(plan, 'Untouched');
  lessonPlanService.updateObjective(plan, a.id, 'Edited text');
  assert.equal(findLessonPlanObjective(plan, a.id).text, 'Edited text');
  assert.equal(findLessonPlanObjective(plan, b.id).text, 'Untouched');
});

test('removeObjective: deletes exactly one objective by id — nothing else in the list is touched', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const a = lessonPlanService.addObjective(plan, 'Keep me');
  const b = lessonPlanService.addObjective(plan, 'Delete me');
  const c = lessonPlanService.addObjective(plan, 'Also keep me');

  lessonPlanService.removeObjective(plan, b.id);

  assert.equal(plan.objectives.length, 2);
  assert.equal(findLessonPlanObjective(plan, b.id), null);
  assert.ok(findLessonPlanObjective(plan, a.id));
  assert.ok(findLessonPlanObjective(plan, c.id));
});

test('moveObjectiveUp/moveObjectiveDown: swap order, no-op at the boundaries, and do NOT bump updatedAt (reordering isn\'t a content edit)', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const a = lessonPlanService.addObjective(plan, 'First');
  const b = lessonPlanService.addObjective(plan, 'Second');
  const beforeUpdatedAt = plan.updatedAt;

  lessonPlanService.moveObjectiveDown(plan, a.id);
  assert.deepEqual(plan.objectives.map((objective) => objective.id), [b.id, a.id]);
  assert.equal(plan.updatedAt, beforeUpdatedAt);

  // No-op past the boundary — order stays exactly as is.
  lessonPlanService.moveObjectiveDown(plan, a.id);
  assert.deepEqual(plan.objectives.map((objective) => objective.id), [b.id, a.id]);

  lessonPlanService.moveObjectiveUp(plan, a.id);
  assert.deepEqual(plan.objectives.map((objective) => objective.id), [a.id, b.id]);

  lessonPlanService.moveObjectiveUp(plan, a.id);
  assert.deepEqual(plan.objectives.map((objective) => objective.id), [a.id, b.id]);
});

test('updateObjective: a real content edit DOES bump updatedAt, unlike reordering', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const objective = lessonPlanService.addObjective(plan, 'Original');
  plan.updatedAt = '2020-01-01T00:00:00.000Z';
  lessonPlanService.updateObjective(plan, objective.id, 'New text');
  assert.notEqual(plan.updatedAt, '2020-01-01T00:00:00.000Z');
});

test('getLessonPlanObjectiveIndex: the position of one objective by id, or -1 if not found', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const a = lessonPlanService.addObjective(plan, 'First');
  const b = lessonPlanService.addObjective(plan, 'Second');
  assert.equal(getLessonPlanObjectiveIndex(plan, a.id), 0);
  assert.equal(getLessonPlanObjectiveIndex(plan, b.id), 1);
  assert.equal(getLessonPlanObjectiveIndex(plan, 'not-a-real-id'), -1);
});

// ---------------------------------------------------------------------
// migrateLegacyObjectives — one-time, lossless normalization from the
// PRE-Objectives shape (lessonObjective / swbatObjectives) into real
// LessonPlanObjective entries. Never discards the original fields.
// ---------------------------------------------------------------------

test('migrateLegacyObjectives: a plan with real swbatObjectives content migrates each entry into its own objective, and leaves swbatObjectives itself untouched', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  plan.swbatObjectives = ['Identify the causes of the revolt', 'Explain Kattabomman\'s role', ''];

  const migrated = lessonPlanService.migrateLegacyObjectives(plan);

  assert.equal(migrated, true);
  assert.deepEqual(
    plan.objectives.map((objective) => objective.text),
    ['Identify the causes of the revolt', 'Explain Kattabomman\'s role']
  );
  // Every migrated objective gets its own real, independent id.
  assert.equal(new Set(plan.objectives.map((o) => o.id)).size, plan.objectives.length);
  // The original legacy field is never rewritten or cleared.
  assert.deepEqual(plan.swbatObjectives, ['Identify the causes of the revolt', 'Explain Kattabomman\'s role', '']);
});

test('migrateLegacyObjectives: a bullet-per-line lessonObjective (the real reported example) splits into one objective per bullet, stripping the "SWBAT:" header and bullet markers', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  plan.lessonObjective =
    'SWBAT:\n' +
    '• explain the conflict between Kattabomman and the British\n' +
    '• identify the role of the Nawab of Arcot and the British\n' +
    '• sequence the major events leading to the fall of Panchalamkuruchi\n' +
    '• explain why Kattabomman became a symbol of resistance';

  const migrated = lessonPlanService.migrateLegacyObjectives(plan);

  assert.equal(migrated, true);
  assert.deepEqual(plan.objectives.map((objective) => objective.text), [
    'explain the conflict between Kattabomman and the British',
    'identify the role of the Nawab of Arcot and the British',
    'sequence the major events leading to the fall of Panchalamkuruchi',
    'explain why Kattabomman became a symbol of resistance',
  ]);
  // The original legacy text is never rewritten or cleared.
  assert.ok(plan.lessonObjective.startsWith('SWBAT:'));
});

test('migrateLegacyObjectives: a single-line lessonObjective with inline "•" separators (the app\'s own old placeholder style) also splits correctly', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  plan.lessonObjective = 'SWBAT: • trace the causes of the revolt • sequence the events • identify the key figures';

  lessonPlanService.migrateLegacyObjectives(plan);

  assert.deepEqual(plan.objectives.map((objective) => objective.text), [
    'trace the causes of the revolt',
    'sequence the events',
    'identify the key figures',
  ]);
});

test('migrateLegacyObjectives: plain prose with no bullets at all becomes ONE objective — never silently dropped just because it wasn\'t list-formatted', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  plan.lessonObjective = 'Understand the causes of the Poligars revolt.';

  const migrated = lessonPlanService.migrateLegacyObjectives(plan);

  assert.equal(migrated, true);
  assert.equal(plan.objectives.length, 1);
  assert.equal(plan.objectives[0].text, 'Understand the causes of the Poligars revolt.');
});

test('migrateLegacyObjectives: a brand-new plan with no legacy content at all is a no-op — objectives stays empty, nothing to persist', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const migrated = lessonPlanService.migrateLegacyObjectives(plan);
  assert.equal(migrated, false);
  assert.deepEqual(plan.objectives, []);
});

test('migrateLegacyObjectives: a plan that already has real objectives is left completely untouched — never re-migrates or duplicates', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  const existing = lessonPlanService.addObjective(plan, 'Already here');
  plan.lessonObjective = 'Some old legacy text that must NOT be re-migrated on top';

  const migrated = lessonPlanService.migrateLegacyObjectives(plan);

  assert.equal(migrated, false);
  assert.equal(plan.objectives.length, 1);
  assert.equal(plan.objectives[0].id, existing.id);
  assert.equal(plan.objectives[0].text, 'Already here');
});

test('migrateLegacyObjectives: prefers swbatObjectives over lessonObjective when a plan somehow has both (the more reliable, already-separated source)', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  plan.swbatObjectives = ['From swbatObjectives'];
  plan.lessonObjective = 'From lessonObjective, should not be used';

  lessonPlanService.migrateLegacyObjectives(plan);

  assert.deepEqual(plan.objectives.map((o) => o.text), ['From swbatObjectives']);
});
