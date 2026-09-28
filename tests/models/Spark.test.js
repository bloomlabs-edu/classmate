import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpark, createSparkResourceRef, SPARK_TYPES, SPARK_VISIBILITY } from '../../js/models/Spark.js';

test('createSpark: defaults every dynamic list to empty, visibility to shared, sparkType to null (not mandatory)', () => {
  const spark = createSpark({ title: 'Plant Kingdom Ladder', createdByUid: 'anu' });
  assert.equal(spark.title, 'Plant Kingdom Ladder');
  assert.equal(spark.createdByUid, 'anu');
  assert.equal(spark.sparkType, null);
  assert.equal(spark.instructions, '');
  assert.equal(spark.estimatedTime, '');
  assert.deepEqual(spark.subjectIds, []);
  assert.deepEqual(spark.gradeLevels, []);
  assert.deepEqual(spark.conceptIds, []);
  assert.deepEqual(spark.curriculumUnitIds, []);
  assert.equal(spark.linkedCurriculumUnitId, null);
  assert.deepEqual(spark.resourceRefs, []);
  assert.deepEqual(spark.tags, []);
  assert.equal(spark.visibility, SPARK_VISIBILITY.SHARED);
  assert.ok(spark.id);
  assert.ok(spark.createdAt);
  assert.equal(spark.updatedAt, spark.createdAt);
});

test('createSpark: a real sparkType from SPARK_TYPES round-trips', () => {
  const spark = createSpark({ title: 'Mystery Plant', createdByUid: 'anu', sparkType: SPARK_TYPES.HOOK });
  assert.equal(spark.sparkType, SPARK_TYPES.HOOK);
});

test('SPARK_TYPES: a broad, non-exhaustive filter vocabulary, including OTHER as a catch-all', () => {
  assert.ok(Object.values(SPARK_TYPES).includes('other'));
  assert.ok(Object.values(SPARK_TYPES).includes('activity'));
  assert.ok(Object.values(SPARK_TYPES).includes('experiment'));
});

// ---------------------------------------------------------------------
// Provenance — the one thing every other Fellow's use of a Spark
// depends on staying trustworthy.
// ---------------------------------------------------------------------

test('createSpark: createdByUid is the required provenance field, always present on the returned object', () => {
  const spark = createSpark({ title: 'Bryophyte vs Pteridophyte Think-Pair-Share', createdByUid: 'rahul' });
  assert.equal(spark.createdByUid, 'rahul');
});

test('createSpark: createdAt is stamped once at creation and does not silently change on a later re-construction with the same data', () => {
  const spark = createSpark({ title: 'Mystery Plant', createdByUid: 'anu', createdAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(spark.createdAt, '2026-09-01T00:00:00.000Z');
});

// ---------------------------------------------------------------------
// Cross-Fellow discoverability field
// ---------------------------------------------------------------------

test('createSpark: linkedCurriculumUnitId (singular) is the cross-classroom chapter identity, independent of curriculumUnitIds (plural, classroom-local)', () => {
  const spark = createSpark({
    title: 'Plant Kingdom Ladder',
    createdByUid: 'anu',
    curriculumUnitIds: ['unit-in-classroom-b'],
    linkedCurriculumUnitId: 'curriculum-index-unit-17',
  });
  assert.deepEqual(spark.curriculumUnitIds, ['unit-in-classroom-b']);
  assert.equal(spark.linkedCurriculumUnitId, 'curriculum-index-unit-17');
});

test('a Spark discoverable for "the same chapter" as a ChapterPlan shares linkedCurriculumUnitId with it, regardless of which classroom either was authored in', async () => {
  const { createChapterPlan } = await import('../../js/models/ChapterPlan.js');
  const chapterPlan = createChapterPlan({ classroomId: 'classroom-a', teacherUid: 'rejeesh', linkedCurriculumUnitId: 'curriculum-index-unit-17' });
  const spark = createSpark({ title: 'Plant Kingdom Ladder', createdByUid: 'anu', linkedCurriculumUnitId: 'curriculum-index-unit-17' });
  assert.equal(spark.linkedCurriculumUnitId, chapterPlan.linkedCurriculumUnitId);
});

// ---------------------------------------------------------------------
// Resource references — reused, never duplicated
// ---------------------------------------------------------------------

test('createSparkResourceRef: a plain {classroomId, resourceId} pointer, no per-ref provenance fields', () => {
  const ref = createSparkResourceRef({ classroomId: 'classroom-b', resourceId: 'resource-1' });
  assert.deepEqual(ref, { classroomId: 'classroom-b', resourceId: 'resource-1' });
});

test('createSpark: resourceRefs holds references, never a copy of any Resource\'s own content', () => {
  const ref = createSparkResourceRef({ classroomId: 'classroom-b', resourceId: 'resource-1' });
  const spark = createSpark({ title: 'Mystery Plant', createdByUid: 'anu', resourceRefs: [ref] });
  assert.equal(spark.resourceRefs.length, 1);
  assert.equal(spark.resourceRefs[0].resourceId, 'resource-1');
  assert.equal(spark.resourceRefs[0].title, undefined);
});

// ---------------------------------------------------------------------
// Independent-entity semantics — not LessonPlan.spark, not a
// TeachingIdeas projection.
// ---------------------------------------------------------------------

test('a Spark has no owning LessonPlan/ChapterPlan reference of any kind — it exists independently of any one plan', () => {
  const spark = createSpark({ title: 'Plant Kingdom Ladder', createdByUid: 'anu' });
  assert.equal(spark.lessonPlanId, undefined);
  assert.equal(spark.chapterPlanId, undefined);
  assert.equal(spark.sourceLessonPlanId, undefined);
});

test('a Spark has no status field at all — unlike teachingIdeas, it is never gated on any plan being "approved" first', () => {
  const spark = createSpark({ title: 'Plant Kingdom Ladder', createdByUid: 'anu' });
  assert.equal(spark.status, undefined);
});
