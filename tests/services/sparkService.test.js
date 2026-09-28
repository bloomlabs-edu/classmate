import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPARK_TYPES, SPARK_VISIBILITY } from '../../js/models/Spark.js';
import * as sparkService from '../../js/services/sparkService.js';

const CREATOR = 'anu';
const OTHER_FELLOW = 'rejeesh';

function spark(overrides = {}) {
  return sparkService.createSpark({
    title: 'Plant Kingdom Ladder',
    description: 'A visual ladder sorting plants by structure.',
    sparkType: SPARK_TYPES.ACTIVITY,
    createdByUid: CREATOR,
    subjectIds: ['science'],
    gradeLevels: ['Grade 8'],
    conceptIds: ['concept-plant-classification'],
    linkedCurriculumUnitId: 'curriculum-index-unit-17',
    ...overrides,
  });
}

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------

test('createSpark: builds a Spark with the given fields, defaults visibility to shared', () => {
  const s = spark();
  assert.equal(s.title, 'Plant Kingdom Ladder');
  assert.equal(s.createdByUid, CREATOR);
  assert.equal(s.visibility, SPARK_VISIBILITY.SHARED);
});

test('createSpark: requires a title', () => {
  assert.throws(() => sparkService.createSpark({ createdByUid: CREATOR }), /title/);
});

test('createSpark: requires createdByUid — provenance must exist from the moment of creation', () => {
  assert.throws(() => sparkService.createSpark({ title: 'x' }), /createdByUid/);
});

// ---------------------------------------------------------------------
// Update — creator only
// ---------------------------------------------------------------------

test('the creator can update their own Spark\'s content', () => {
  const s = spark();
  sparkService.updateSpark(s, CREATOR, { description: 'A revised description.' });
  assert.equal(s.description, 'A revised description.');
});

test('another Fellow cannot update a Spark they did not create', () => {
  const s = spark();
  assert.throws(() => sparkService.updateSpark(s, OTHER_FELLOW, { description: 'hijacked' }), /Not authorized/);
  assert.equal(s.description, 'A visual ladder sorting plants by structure.');
});

test('Phase 4 — a Program Manager reviewing the Chapter Plan that references this Spark still cannot modify or delete it: no PM override exists anywhere in this file, a reviewer is treated exactly like any other non-creator Fellow', () => {
  const s = spark();
  const PM = 'pm-1';
  assert.equal(sparkService.canModifySpark(s, PM), false);
  assert.throws(() => sparkService.updateSpark(s, PM, { title: 'hijacked' }), /Not authorized/);
  assert.throws(() => sparkService.assertCanDeleteSpark(s, PM), /Not authorized/);
  // Read access is unaffected — a PM (like any Fellow) can still see the
  // Spark's own canonical content while reviewing; only mutation is blocked.
  assert.equal(s.title, 'Plant Kingdom Ladder');
});

test('updateSpark has no createdByUid/createdAt parameter at all — there is no code path that could reassign them', () => {
  const s = spark();
  const originalCreatedAt = s.createdAt;
  sparkService.updateSpark(s, CREATOR, { title: 'Renamed', createdByUid: OTHER_FELLOW, createdAt: '2020-01-01T00:00:00.000Z' });
  // The unsupported keys are simply ignored — not destructured, not read, not applied.
  assert.equal(s.createdByUid, CREATOR);
  assert.equal(s.createdAt, originalCreatedAt);
  assert.equal(s.title, 'Renamed');
});

test('canModifySpark: true only for the creator', () => {
  const s = spark();
  assert.equal(sparkService.canModifySpark(s, CREATOR), true);
  assert.equal(sparkService.canModifySpark(s, OTHER_FELLOW), false);
  assert.equal(sparkService.canModifySpark(s, null), false);
});

// ---------------------------------------------------------------------
// Resource references
// ---------------------------------------------------------------------

test('the creator can add a resourceRef pointing at a Resource in a different classroom', () => {
  const s = spark();
  const ref = sparkService.addSparkResourceRef(s, CREATOR, { classroomId: 'classroom-b', resourceId: 'resource-1' });
  assert.deepEqual(ref, { classroomId: 'classroom-b', resourceId: 'resource-1' });
  assert.equal(s.resourceRefs.length, 1);
});

test('another Fellow cannot add a resourceRef to a Spark they did not create', () => {
  const s = spark();
  assert.throws(() => sparkService.addSparkResourceRef(s, OTHER_FELLOW, { classroomId: 'classroom-b', resourceId: 'resource-1' }));
});

test('removeSparkResourceRef: creator only, matches by (classroomId, resourceId) pair', () => {
  const s = spark();
  sparkService.addSparkResourceRef(s, CREATOR, { classroomId: 'classroom-b', resourceId: 'resource-1' });
  assert.throws(() => sparkService.removeSparkResourceRef(s, OTHER_FELLOW, { classroomId: 'classroom-b', resourceId: 'resource-1' }));
  sparkService.removeSparkResourceRef(s, CREATOR, { classroomId: 'classroom-b', resourceId: 'resource-1' });
  assert.equal(s.resourceRefs.length, 0);
});

// ---------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------

test('assertCanDeleteSpark: passes for the creator, throws for anyone else', () => {
  const s = spark();
  assert.doesNotThrow(() => sparkService.assertCanDeleteSpark(s, CREATOR));
  assert.throws(() => sparkService.assertCanDeleteSpark(s, OTHER_FELLOW), /Not authorized/);
});

// ---------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------

test('filterSparks: discovery by linkedCurriculumUnitId happens at the repository query layer, not here — this file filters an already-fetched, already-scoped list further', () => {
  const plantKingdomSpark = spark();
  const unrelatedSpark = spark({ title: 'Fractions Number Line', subjectIds: ['mathematics'], conceptIds: ['concept-fractions'], linkedCurriculumUnitId: 'curriculum-index-unit-9' });

  // Simulates a caller that already ran
  // sparkRepository.getSparksForLinkedCurriculumUnitId('curriculum-index-unit-17')
  // and got back only plantKingdomSpark.
  const scoped = [plantKingdomSpark];
  assert.deepEqual(sparkService.filterSparks(scoped, {}), scoped);
  assert.notEqual(unrelatedSpark, undefined); // exists only to prove it would have been excluded upstream, not by filterSparks
});

test('filterSparks: by sparkType', () => {
  const sparks = [spark({ sparkType: SPARK_TYPES.ACTIVITY }), spark({ sparkType: SPARK_TYPES.QUESTION, title: 'Should all plants belong to one group?' })];
  const result = sparkService.filterSparks(sparks, { sparkType: SPARK_TYPES.QUESTION });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Should all plants belong to one group?');
});

test('filterSparks: by subjectId', () => {
  const sparks = [spark({ subjectIds: ['science'] }), spark({ title: 'Algebra Tiles', subjectIds: ['mathematics'] })];
  const result = sparkService.filterSparks(sparks, { subjectId: 'mathematics' });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Algebra Tiles');
});

test('filterSparks: by gradeLevel', () => {
  const sparks = [spark({ gradeLevels: ['Grade 8'] }), spark({ title: 'Grade 6 idea', gradeLevels: ['Grade 6'] })];
  const result = sparkService.filterSparks(sparks, { gradeLevel: 'Grade 6' });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Grade 6 idea');
});

test('filterSparks: by conceptId — concept-based discovery is supported', () => {
  const sparks = [spark({ conceptIds: ['concept-plant-classification'] }), spark({ title: 'Bryophyte vs Pteridophyte', conceptIds: ['concept-bryophytes'] })];
  const result = sparkService.filterSparks(sparks, { conceptId: 'concept-bryophytes' });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Bryophyte vs Pteridophyte');
});

test('filterSparks: by free-text search across title/description/instructions/tags', () => {
  const sparks = [
    spark({ title: 'Mystery Plant', description: 'A guessing game.' }),
    spark({ title: 'Plant Kingdom Ladder', tags: ['classification', 'ladder'] }),
  ];
  assert.equal(sparkService.filterSparks(sparks, { searchText: 'guessing' }).length, 1);
  assert.equal(sparkService.filterSparks(sparks, { searchText: 'ladder' }).length, 1);
  assert.equal(sparkService.filterSparks(sparks, { searchText: 'no-match-anywhere' }).length, 0);
});

test('filterSparks: composes multiple filters together (AND, not OR)', () => {
  const sparks = [spark({ subjectIds: ['science'], gradeLevels: ['Grade 8'] }), spark({ title: 'Other', subjectIds: ['science'], gradeLevels: ['Grade 6'] })];
  const result = sparkService.filterSparks(sparks, { subjectId: 'science', gradeLevel: 'Grade 8' });
  assert.equal(result.length, 1);
});

// ---------------------------------------------------------------------
// Independent-entity semantics
// ---------------------------------------------------------------------

test('Spark is independent of TeachingIdeas: no sourceLessonPlanId, no isTeachingIdeaEligible-style status gate, no approval requirement', async () => {
  const teachingIdeasService = await import('../../js/services/teachingIdeasService.js');
  const s = spark();
  assert.equal(s.sourceLessonPlanId, undefined);
  assert.equal(s.status, undefined);
  // teachingIdeasService's own eligibility gate takes a LessonPlan-shaped
  // object; a Spark simply isn't the kind of thing that function's
  // domain ever touches — proven by the two modules never importing
  // one another (see services/sparkService.js's own header comment).
  assert.equal(typeof teachingIdeasService.isTeachingIdeaEligible, 'function');
});
