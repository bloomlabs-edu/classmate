import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, LESSON_PLAN_STATUS } from '../../js/models/LessonPlan.js';
import * as lessonPlanService from '../../js/services/lessonPlanService.js';
import * as teachingIdeasService from '../../js/services/teachingIdeasService.js';

function makeClassroom() {
  return {
    id: 'classroom-1',
    name: 'Real Classroom Name', // must never leak into a projection/UI, per Phase 4 privacy direction
    members: { 'teacher-1': { role: 'teacher', displayName: 'Anu' } },
    memberUids: ['teacher-1'],
  };
}

function makeApprovedPlan(overrides = {}) {
  const plan = createLessonPlan({ classroomId: 'classroom-1', createdByUid: 'teacher-1', conceptIds: ['concept-fractions'], gradeLabel: 'Grade 6', subjectId: 'subject-math', topic: 'Comparing Fractions', ...overrides });
  plan.status = LESSON_PLAN_STATUS.APPROVED;
  return plan;
}

// ---------------------------------------------------------------------
// Eligibility — draft/submitted/changes_requested excluded, approved included
// ---------------------------------------------------------------------

test('isTeachingIdeaEligible: only APPROVED is eligible', () => {
  const plan = createLessonPlan({ classroomId: 'c1' });
  assert.equal(teachingIdeasService.isTeachingIdeaEligible(plan), false); // draft
  plan.status = LESSON_PLAN_STATUS.SUBMITTED;
  assert.equal(teachingIdeasService.isTeachingIdeaEligible(plan), false);
  plan.status = LESSON_PLAN_STATUS.CHANGES_REQUESTED;
  assert.equal(teachingIdeasService.isTeachingIdeaEligible(plan), false);
  plan.status = LESSON_PLAN_STATUS.APPROVED;
  assert.equal(teachingIdeasService.isTeachingIdeaEligible(plan), true);
});

test('buildTeachingIdeaProjection: throws for a non-approved plan — publishing an ineligible plan is refused, not silently allowed', () => {
  const classroom = makeClassroom();
  const plan = createLessonPlan({ classroomId: 'classroom-1', createdByUid: 'teacher-1' });
  assert.throws(() => teachingIdeasService.buildTeachingIdeaProjection(classroom, plan));
});

test('buildTeachingIdeaProjection: snapshots teacher display name and never includes the classroom name', () => {
  const classroom = makeClassroom();
  const plan = makeApprovedPlan();
  const projection = teachingIdeasService.buildTeachingIdeaProjection(classroom, plan);
  assert.equal(projection.teacherDisplayName, 'Anu');
  assert.equal(projection.sourceLessonPlanId, plan.id);
  assert.equal(projection.sourceClassroomId, 'classroom-1');
  assert.equal(JSON.stringify(projection).includes('Real Classroom Name'), false);
});

// ---------------------------------------------------------------------
// Extraction — every element type, plus differentiation per bucket
// ---------------------------------------------------------------------

function buildFullTeachingIdea() {
  const classroom = makeClassroom();
  const plan = makeApprovedPlan();
  lessonPlanService.updateSpark(plan, { title: 'Which fraction is hiding?', teacherAction: 'Cover part of a shape.', studentAction: 'Guess the fraction.' });
  lessonPlanService.updateWhy(plan, { bigQuestion: 'How can you prove that 3/4 is greater than 2/3?' });
  lessonPlanService.updateHelpingEachOtherLearn(plan, { finalQuestion: 'Which method was fastest?' });
  lessonPlanService.addAssessmentItem(plan, 'Exit ticket: order three fractions.');
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, activity.id, { title: 'Human Number Line', teacherAction: 'Mark a line on the floor.', studentAction: 'Stand at your fraction’s position.' });
  lessonPlanService.addActivityDifferentiation(plan, activity.id);
  lessonPlanService.updateActivityDifferentiation(plan, activity.id, {
    redBucket: 'Give a number card as a hint.',
    greenBucket: 'Represent the comparison visually before explaining.',
    others: '',
  });
  return { teachingIdea: teachingIdeasService.buildTeachingIdeaProjection(classroom, plan), activityId: activity.id };
}

test('extractElements: extracts the Spark as its own element', () => {
  const { teachingIdea } = buildFullTeachingIdea();
  const elements = teachingIdeasService.extractElements(teachingIdea);
  const spark = elements.find((element) => element.elementType === 'spark');
  assert.ok(spark);
  assert.equal(spark.title, 'Which fraction is hiding?');
  assert.equal(spark.content.studentAction, 'Guess the fraction.');
  assert.equal(spark.sourceActivityId, null);
  assert.deepEqual(spark.conceptIds, ['concept-fractions']);
});

test('extractElements: extracts bigQuestion and finalQuestion as two separate Question elements', () => {
  const { teachingIdea } = buildFullTeachingIdea();
  const elements = teachingIdeasService.extractElements(teachingIdea);
  const questions = elements.filter((element) => element.elementType === 'question');
  assert.equal(questions.length, 2);
  assert.ok(questions.some((q) => q.sourceSectionKey === 'bigQuestion' && q.content.includes('3/4')));
  assert.ok(questions.some((q) => q.sourceSectionKey === 'finalQuestion' && q.content.includes('fastest')));
});

test('extractElements: extracts each non-blank assessment item as its own Assessment element', () => {
  const { teachingIdea } = buildFullTeachingIdea();
  const elements = teachingIdeasService.extractElements(teachingIdea);
  const assessments = elements.filter((element) => element.elementType === 'assessment');
  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].content, 'Exit ticket: order three fractions.');
});

test('extractElements: extracts the Activity itself as one element', () => {
  const { teachingIdea, activityId } = buildFullTeachingIdea();
  const elements = teachingIdeasService.extractElements(teachingIdea);
  const activity = elements.find((element) => element.elementType === 'activity');
  assert.ok(activity);
  assert.equal(activity.sourceActivityId, activityId);
  assert.equal(activity.title, 'Human Number Line');
  assert.equal(activity.content.teacherAction, 'Mark a line on the floor.');
});

test('extractElements: extracts Red Bucket and Green Bucket as two INDEPENDENT Differentiation elements, and skips a blank bucket ("Others")', () => {
  const { teachingIdea, activityId } = buildFullTeachingIdea();
  const elements = teachingIdeasService.extractElements(teachingIdea);
  const differentiationElements = elements.filter((element) => element.elementType === 'differentiation');

  assert.equal(differentiationElements.length, 2); // NOT 3 — "others" was blank
  const red = differentiationElements.find((element) => element.bucket === 'redBucket');
  const green = differentiationElements.find((element) => element.bucket === 'greenBucket');
  assert.ok(red);
  assert.ok(green);
  assert.equal(red.content, 'Give a number card as a hint.');
  assert.equal(green.content, 'Represent the comparison visually before explaining.');
  assert.equal(red.sourceActivityId, activityId);
  assert.equal(green.sourceActivityId, activityId);
  assert.ok(green.title.includes('Green Bucket'));
});

test('extractElements: a plan with no assessments/differentiation produces no elements for those types (nothing invented)', () => {
  const classroom = makeClassroom();
  const plan = makeApprovedPlan();
  const teachingIdea = teachingIdeasService.buildTeachingIdeaProjection(classroom, plan);
  const elements = teachingIdeasService.extractElements(teachingIdea);
  assert.equal(elements.filter((e) => e.elementType === 'assessment').length, 0);
  assert.equal(elements.filter((e) => e.elementType === 'differentiation').length, 0);
  assert.equal(elements.filter((e) => e.elementType === 'spark').length, 0); // blank spark never extracted
});

test('extractElements: every element inherits the source plan\'s own conceptIds (V1 — no per-activity tagging)', () => {
  const classroom = makeClassroom();
  const plan = makeApprovedPlan({ conceptIds: ['concept-fractions', 'concept-decimals'] });
  const activity = lessonPlanService.addActivity(plan);
  lessonPlanService.updateActivity(plan, activity.id, { title: 'A', teacherAction: 'B', studentAction: 'C' });
  const teachingIdea = teachingIdeasService.buildTeachingIdeaProjection(classroom, plan);
  const elements = teachingIdeasService.extractElements(teachingIdea);
  const activityElement = elements.find((e) => e.elementType === 'activity');
  assert.deepEqual(activityElement.conceptIds, ['concept-fractions', 'concept-decimals']);
});

// ---------------------------------------------------------------------
// Discovery filtering (pure) — Concept/Grade/Subject/Element-type/text
// ---------------------------------------------------------------------

test('filterElements: filters by elementType, gradeLabel, subjectId, and combines all three', () => {
  const { teachingIdea } = buildFullTeachingIdea();
  const elements = teachingIdeasService.extractElements(teachingIdea);

  assert.ok(teachingIdeasService.filterElements(elements, { elementType: 'spark' }).every((e) => e.elementType === 'spark'));
  assert.ok(teachingIdeasService.filterElements(elements, { gradeLabel: 'Grade 6' }).length === elements.length);
  assert.equal(teachingIdeasService.filterElements(elements, { gradeLabel: 'Grade 9' }).length, 0);
  assert.equal(teachingIdeasService.filterElements(elements, { subjectId: 'subject-science' }).length, 0);
  assert.equal(teachingIdeasService.filterElements(elements, { elementType: 'differentiation', gradeLabel: 'Grade 6' }).length, 2);
});

test('filterElements: text search matches title or content substrings, case-insensitively', () => {
  const { teachingIdea } = buildFullTeachingIdea();
  const elements = teachingIdeasService.extractElements(teachingIdea);
  const matches = teachingIdeasService.filterElements(elements, { searchText: 'number line' });
  assert.ok(matches.some((e) => e.title === 'Human Number Line'));
  assert.equal(teachingIdeasService.filterElements(elements, { searchText: 'nonexistent phrase' }).length, 0);
});

test('filterLessonExamples: filters complete lessons by grade/subject/text', () => {
  const { teachingIdea } = buildFullTeachingIdea();
  assert.equal(teachingIdeasService.filterLessonExamples([teachingIdea], { gradeLabel: 'Grade 6' }).length, 1);
  assert.equal(teachingIdeasService.filterLessonExamples([teachingIdea], { gradeLabel: 'Grade 9' }).length, 0);
  assert.equal(teachingIdeasService.filterLessonExamples([teachingIdea], { searchText: 'fractions' }).length, 1);
  assert.equal(teachingIdeasService.filterLessonExamples([teachingIdea], { searchText: 'nope' }).length, 0);
});

test('extractElementsForDiscovery: combines extraction across multiple Teaching Ideas, then filters — the shape a discovery UI actually calls', () => {
  const classroom = makeClassroom();
  const planA = makeApprovedPlan({ topic: 'Lesson A' });
  lessonPlanService.updateSpark(planA, { title: 'Spark A', teacherAction: 'x', studentAction: 'y' });
  const planB = makeApprovedPlan({ topic: 'Lesson B', gradeLabel: 'Grade 8' });
  lessonPlanService.updateSpark(planB, { title: 'Spark B', teacherAction: 'x', studentAction: 'y' });

  const ideas = [teachingIdeasService.buildTeachingIdeaProjection(classroom, planA), teachingIdeasService.buildTeachingIdeaProjection(classroom, planB)];
  const allSparks = teachingIdeasService.extractElementsForDiscovery(ideas, { elementType: 'spark' });
  assert.equal(allSparks.length, 2);

  const grade8Only = teachingIdeasService.extractElementsForDiscovery(ideas, { elementType: 'spark', gradeLabel: 'Grade 8' });
  assert.equal(grade8Only.length, 1);
  assert.equal(grade8Only[0].title, 'Spark B');
});
