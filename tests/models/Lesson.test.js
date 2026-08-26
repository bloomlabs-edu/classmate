import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLesson, findInvalidExecutedConceptIds, getFeedbackEligibleConceptIds, carryForwardConcept } from '../../js/models/Lesson.js';

test('createLesson: executedConceptIds/carriedForwardConceptIds/conceptProvenance default to empty, planningCycleId to null', () => {
  const lesson = createLesson({ classroomId: 'c1', date: '2026-08-25', teachingSlotId: 'slot-1', conceptIds: ['A', 'B'] });
  assert.deepEqual(lesson.executedConceptIds, []);
  assert.deepEqual(lesson.carriedForwardConceptIds, []);
  assert.deepEqual(lesson.conceptProvenance, {});
  assert.equal(lesson.planningCycleId, null);
  assert.equal(lesson.teacherReflection, null);
  // Firestore's setDoc() rejects any field whose value is `undefined`
  // — sequenceIndex must never be left as undefined when the caller
  // doesn't supply one (see services/timetableLessonService.js's
  // attachLessonPlan(), which never does).
  assert.equal(lesson.sequenceIndex, null);
  assert.notEqual(lesson.sequenceIndex, undefined);
  assert.deepEqual(lesson.conceptIds, ['A', 'B']);
});

test('findInvalidExecutedConceptIds: empty result when every executed id is actually planned', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['A', 'B', 'C'] });
  assert.deepEqual(findInvalidExecutedConceptIds(lesson, ['A', 'B']), []);
});

test('findInvalidExecutedConceptIds: reports ids that are NOT in conceptIds at all', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['A', 'B', 'C'] });
  assert.deepEqual(findInvalidExecutedConceptIds(lesson, ['A', 'D']), ['D']);
});

test('findInvalidExecutedConceptIds: an empty executedConceptIds list is always valid (nothing taught yet)', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['A', 'B'] });
  assert.deepEqual(findInvalidExecutedConceptIds(lesson, []), []);
});

test('getFeedbackEligibleConceptIds: only executed concepts are eligible, planned-but-not-executed ones are not', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['A', 'B', 'C', 'D'], executedConceptIds: ['A', 'B', 'C'] });
  assert.deepEqual(getFeedbackEligibleConceptIds(lesson), ['A', 'B', 'C']);
  assert.ok(!getFeedbackEligibleConceptIds(lesson).includes('D'));
});

test('getFeedbackEligibleConceptIds: a lesson with nothing executed yet has zero feedback-eligible concepts', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['A', 'B'] });
  assert.deepEqual(getFeedbackEligibleConceptIds(lesson), []);
});

// ---------------------------------------------------------------------
// carryForwardConcept — Tuesday Science's D, unexecuted, moves to
// Thursday Science, matching the approved reference exactly.
// ---------------------------------------------------------------------

test('carryForwardConcept: moves the SAME concept id to the target lesson, never cloning it', () => {
  const tuesday = createLesson({ id: 'lesson-tue', classroomId: 'c1', date: '2026-08-25', teachingSlotId: 'slot-tue-p3', conceptIds: ['A', 'B', 'C', 'D'], executedConceptIds: ['A', 'B', 'C'] });
  const thursday = createLesson({ id: 'lesson-thu', classroomId: 'c1', date: '2026-08-27', teachingSlotId: 'slot-thu-p3', conceptIds: [] });

  carryForwardConcept({ sourceLesson: tuesday, targetLesson: thursday, conceptId: 'D', sourceTeachingSlotId: 'slot-tue-p3', carriedAt: '2026-08-25T10:00:00.000Z' });

  assert.ok(thursday.conceptIds.includes('D'));
  assert.equal(thursday.conceptIds.filter((id) => id === 'D').length, 1, 'D should appear exactly once, never duplicated/cloned');
});

test('carryForwardConcept: D stays visible in the source lesson\'s own Planned Concepts (conceptIds), flagged as carried', () => {
  const tuesday = createLesson({ id: 'lesson-tue', classroomId: 'c1', conceptIds: ['A', 'B', 'C', 'D'], executedConceptIds: ['A', 'B', 'C'] });
  const thursday = createLesson({ id: 'lesson-thu', classroomId: 'c1', conceptIds: [] });

  carryForwardConcept({ sourceLesson: tuesday, targetLesson: thursday, conceptId: 'D', sourceTeachingSlotId: 'slot-tue-p3', carriedAt: '2026-08-25T10:00:00.000Z' });

  assert.ok(tuesday.conceptIds.includes('D'), 'D must remain in the source lesson\'s own conceptIds');
  assert.ok(tuesday.carriedForwardConceptIds.includes('D'));
});

test('carryForwardConcept: preserves full provenance — originally planned on the source, carried forward, traceable on the target', () => {
  const tuesday = createLesson({ id: 'lesson-tue', classroomId: 'c1', teachingSlotId: 'slot-tue-p3', conceptIds: ['D'] });
  const thursday = createLesson({ id: 'lesson-thu', classroomId: 'c1', teachingSlotId: 'slot-thu-p3', conceptIds: [] });

  carryForwardConcept({ sourceLesson: tuesday, targetLesson: thursday, conceptId: 'D', sourceTeachingSlotId: 'slot-tue-p3', carriedAt: '2026-08-25T10:00:00.000Z' });

  assert.deepEqual(thursday.conceptProvenance.D, {
    fromLessonId: 'lesson-tue',
    fromTeachingSlotId: 'slot-tue-p3',
    carriedAt: '2026-08-25T10:00:00.000Z',
  });

  // "D was subsequently taught on Thursday" — reconstructable once executed there.
  thursday.executedConceptIds = ['D'];
  assert.ok(thursday.executedConceptIds.includes('D'));
  assert.equal(thursday.conceptProvenance.D.fromLessonId, 'lesson-tue');
});

test('carryForwardConcept: throws if the concept was already executed on the source (nothing left to carry)', () => {
  const tuesday = createLesson({ id: 'lesson-tue', classroomId: 'c1', conceptIds: ['D'], executedConceptIds: ['D'] });
  const thursday = createLesson({ id: 'lesson-thu', classroomId: 'c1', conceptIds: [] });

  assert.throws(() => carryForwardConcept({ sourceLesson: tuesday, targetLesson: thursday, conceptId: 'D', sourceTeachingSlotId: 's1', carriedAt: 'now' }));
});

test('carryForwardConcept: throws if the concept isn\'t actually planned on the source lesson at all', () => {
  const tuesday = createLesson({ id: 'lesson-tue', classroomId: 'c1', conceptIds: ['A', 'B'] });
  const thursday = createLesson({ id: 'lesson-thu', classroomId: 'c1', conceptIds: [] });

  assert.throws(() => carryForwardConcept({ sourceLesson: tuesday, targetLesson: thursday, conceptId: 'D', sourceTeachingSlotId: 's1', carriedAt: 'now' }));
});

test('carryForwardConcept: throws if the concept has already been carried forward once before', () => {
  const tuesday = createLesson({ id: 'lesson-tue', classroomId: 'c1', conceptIds: ['D'], carriedForwardConceptIds: ['D'] });
  const thursday = createLesson({ id: 'lesson-thu', classroomId: 'c1', conceptIds: [] });

  assert.throws(() => carryForwardConcept({ sourceLesson: tuesday, targetLesson: thursday, conceptId: 'D', sourceTeachingSlotId: 's1', carriedAt: 'now' }));
});
