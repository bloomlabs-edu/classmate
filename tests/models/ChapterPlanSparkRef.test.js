import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChapterPlanSparkRef } from '../../js/models/ChapterPlanSparkRef.js';
import {
  createChapterPlan,
  CHAPTER_PLAN_SPARK_SECTIONS,
  getChapterPlanSparkRefIndex,
  findChapterPlanSparkRef,
  hasChapterPlanSparkRef,
} from '../../js/models/ChapterPlan.js';

test('createChapterPlanSparkRef: carries sparkId + section as a reference, defaults addedBy to null and addedAt to now', () => {
  const ref = createChapterPlanSparkRef({ sparkId: 'spark-1', section: CHAPTER_PLAN_SPARK_SECTIONS.KEY_METHODS });
  assert.ok(ref.id);
  assert.equal(ref.sparkId, 'spark-1');
  assert.equal(ref.section, CHAPTER_PLAN_SPARK_SECTIONS.KEY_METHODS);
  assert.equal(ref.addedBy, null);
  assert.ok(ref.addedAt);
});

test('createChapterPlanSparkRef: never carries any of the Spark\'s own content fields — reference only, never a duplicate', () => {
  const ref = createChapterPlanSparkRef({ sparkId: 'spark-1', section: 'keyMethods' });
  assert.equal(ref.title, undefined);
  assert.equal(ref.description, undefined);
  assert.equal(ref.instructions, undefined);
  assert.equal(ref.sparkType, undefined);
  assert.equal(ref.createdByUid, undefined);
});

test('CHAPTER_PLAN_SPARK_SECTIONS: exactly the three minimum-supported sections, no more', () => {
  assert.deepEqual(Object.values(CHAPTER_PLAN_SPARK_SECTIONS).sort(), ['keyMethods', 'revisionIdeas', 'subjectSpecific'].sort());
});

test('createChapterPlan: sparkRefs defaults to an empty array', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1' });
  assert.deepEqual(plan.sparkRefs, []);
});

test('createChapterPlan: sparkRefs holds ChapterPlanSparkRef references, never a copy of the Spark\'s own content', () => {
  const ref = createChapterPlanSparkRef({ sparkId: 'spark-1', section: CHAPTER_PLAN_SPARK_SECTIONS.REVISION_IDEAS, addedBy: 'rejeesh' });
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', sparkRefs: [ref] });
  assert.equal(plan.sparkRefs.length, 1);
  assert.equal(plan.sparkRefs[0].sparkId, 'spark-1');
  assert.equal(plan.sparkRefs[0].title, undefined);
});

test('getChapterPlanSparkRefIndex / findChapterPlanSparkRef: find an existing ref by id, or report absence', () => {
  const ref = createChapterPlanSparkRef({ sparkId: 'spark-1', section: 'keyMethods' });
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', sparkRefs: [ref] });

  assert.equal(getChapterPlanSparkRefIndex(plan, ref.id), 0);
  assert.equal(findChapterPlanSparkRef(plan, ref.id), plan.sparkRefs[0]);

  assert.equal(getChapterPlanSparkRefIndex(plan, 'no-such-ref'), -1);
  assert.equal(findChapterPlanSparkRef(plan, 'no-such-ref'), null);
});

test('hasChapterPlanSparkRef: true only for the exact (sparkId, section) pair; the same Spark in a different section is not a match', () => {
  const ref = createChapterPlanSparkRef({ sparkId: 'spark-1', section: 'keyMethods' });
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', sparkRefs: [ref] });

  assert.equal(hasChapterPlanSparkRef(plan, 'spark-1', 'keyMethods'), true);
  assert.equal(hasChapterPlanSparkRef(plan, 'spark-1', 'revisionIdeas'), false);
  assert.equal(hasChapterPlanSparkRef(plan, 'spark-2', 'keyMethods'), false);
});

test('a Spark reference has no classroomId — Sparks are a top-level collection, unlike Resources', () => {
  const ref = createChapterPlanSparkRef({ sparkId: 'spark-1', section: 'keyMethods' });
  assert.equal(ref.classroomId, undefined);
});
