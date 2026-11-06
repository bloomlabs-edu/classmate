import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLesson,
  findInvalidExecutedConceptIds,
  getFeedbackEligibleConceptIds,
  carryForwardConcept,
  resetLessonForUnitChange,
  moveConcept,
  removeConceptFromLesson,
  createRescheduleRecord,
  rescheduleConceptsForHoliday,
} from '../../js/models/Lesson.js';

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

// ---------------------------------------------------------------------
// Weekly Plan content — objectives[]/bigQuestion/lessonPlanId (see
// docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md). This
// Lesson is the Weekly Plan; the Detailed Lesson Plan is a separate,
// optional document created lazily and cross-referenced via
// lessonPlanId.
// ---------------------------------------------------------------------

test('createLesson: objectives/bigQuestion default to empty, lessonPlanId defaults to null (never undefined)', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: [] });
  assert.deepEqual(lesson.objectives, []);
  assert.equal(lesson.bigQuestion, '');
  assert.equal(lesson.lessonPlanId, null);
  assert.notEqual(lesson.lessonPlanId, undefined);
});

test('createLesson: objectives/bigQuestion/lessonPlanId are stored as supplied', () => {
  const lesson = createLesson({
    classroomId: 'c1',
    conceptIds: ['A'],
    objectives: [{ id: 'obj-1', text: 'Explain the causes of the revolt.' }],
    bigQuestion: 'Why did Kattabomman resist British rule?',
    lessonPlanId: 'plan-1',
  });
  assert.deepEqual(lesson.objectives, [{ id: 'obj-1', text: 'Explain the causes of the revolt.' }]);
  assert.equal(lesson.bigQuestion, 'Why did Kattabomman resist British rule?');
  assert.equal(lesson.lessonPlanId, 'plan-1');
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

// ---------------------------------------------------------------------
// moveConcept — the Concepts panel redesign's PLANNING rearrangement
// ("Move to..."), deliberately distinct from carryForwardConcept()
// above: no teaching-history trace left behind on either lesson.
// Monday Hazards -> moved to Wednesday during planning, nothing taught
// yet anywhere.
// ---------------------------------------------------------------------

test('moveConcept: moves the SAME concept id to the target lesson, never cloning it', () => {
  const monday = createLesson({ id: 'lesson-mon', classroomId: 'c1', conceptIds: ['Hazards', 'Disasters'] });
  const wednesday = createLesson({ id: 'lesson-wed', classroomId: 'c1', conceptIds: [] });

  moveConcept({ sourceLesson: monday, targetLesson: wednesday, conceptId: 'Hazards' });

  assert.ok(wednesday.conceptIds.includes('Hazards'));
  assert.equal(wednesday.conceptIds.filter((id) => id === 'Hazards').length, 1);
});

test('moveConcept: unlike carryForwardConcept, the concept is REMOVED from the source lesson entirely — not kept and tagged', () => {
  const monday = createLesson({ id: 'lesson-mon', classroomId: 'c1', conceptIds: ['Hazards', 'Disasters'] });
  const wednesday = createLesson({ id: 'lesson-wed', classroomId: 'c1', conceptIds: [] });

  moveConcept({ sourceLesson: monday, targetLesson: wednesday, conceptId: 'Hazards' });

  assert.ok(!monday.conceptIds.includes('Hazards'), 'Hazards must be gone from the source lesson\'s own conceptIds');
  assert.deepEqual(monday.carriedForwardConceptIds, [], 'moving must never populate carriedForwardConceptIds — that would make this indistinguishable from Carry Forward');
  assert.deepEqual(monday.conceptIds, ['Disasters']);
});

test('moveConcept: no conceptProvenance entry is created on the target — a moved concept reads as if always planned there', () => {
  const monday = createLesson({ id: 'lesson-mon', classroomId: 'c1', conceptIds: ['Hazards'] });
  const wednesday = createLesson({ id: 'lesson-wed', classroomId: 'c1', conceptIds: [] });

  moveConcept({ sourceLesson: monday, targetLesson: wednesday, conceptId: 'Hazards' });

  assert.deepEqual(wednesday.conceptProvenance, {});
});

test('moveConcept: throws if the concept was already executed on the source (not open to ordinary planning rearrangement anymore)', () => {
  const monday = createLesson({ id: 'lesson-mon', classroomId: 'c1', conceptIds: ['Hazards'], executedConceptIds: ['Hazards'] });
  const wednesday = createLesson({ id: 'lesson-wed', classroomId: 'c1', conceptIds: [] });

  assert.throws(() => moveConcept({ sourceLesson: monday, targetLesson: wednesday, conceptId: 'Hazards' }));
});

test('moveConcept: throws if the concept isn\'t actually planned on the source lesson at all', () => {
  const monday = createLesson({ id: 'lesson-mon', classroomId: 'c1', conceptIds: ['Disasters'] });
  const wednesday = createLesson({ id: 'lesson-wed', classroomId: 'c1', conceptIds: [] });

  assert.throws(() => moveConcept({ sourceLesson: monday, targetLesson: wednesday, conceptId: 'Hazards' }));
});

test('moveConcept: throws if the concept has already been carried forward (teaching history, not an ordinary planning move anymore)', () => {
  const monday = createLesson({ id: 'lesson-mon', classroomId: 'c1', conceptIds: ['Hazards'], carriedForwardConceptIds: ['Hazards'] });
  const wednesday = createLesson({ id: 'lesson-wed', classroomId: 'c1', conceptIds: [] });

  assert.throws(() => moveConcept({ sourceLesson: monday, targetLesson: wednesday, conceptId: 'Hazards' }));
});

test('moveConcept: throws if the concept is already planned on the target lesson (would silently duplicate it)', () => {
  const monday = createLesson({ id: 'lesson-mon', classroomId: 'c1', conceptIds: ['Hazards'] });
  const wednesday = createLesson({ id: 'lesson-wed', classroomId: 'c1', conceptIds: ['Hazards'] });

  assert.throws(() => moveConcept({ sourceLesson: monday, targetLesson: wednesday, conceptId: 'Hazards' }));
});

// ---------------------------------------------------------------------
// moveConcept() + existing conceptProvenance — the "moved more than
// once" case (2026-10 fix): a concept that already arrived on its
// current lesson via carryForwardConcept() must keep its own real
// provenance reconstructable even after a SECOND move (whether an
// ordinary "Move to..." planning action or a Holiday automatically
// displacing the lesson that received it) — never silently discarded.
// ---------------------------------------------------------------------

test('moveConcept: a concept with EXISTING provenance (it already arrived via carryForwardConcept) carries that SAME provenance forward to the new target — never discarded', () => {
  const tuesday = createLesson({ id: 'lesson-tue', classroomId: 'c1', teachingSlotId: 'slot-tue', conceptIds: ['D'] });
  const thursday = createLesson({ id: 'lesson-thu', classroomId: 'c1', teachingSlotId: 'slot-thu', conceptIds: [] });
  const friday = createLesson({ id: 'lesson-fri', classroomId: 'c1', teachingSlotId: 'slot-fri', conceptIds: [] });

  // D is carried forward Tuesday -> Thursday first (Thursday now owns real provenance for D).
  carryForwardConcept({ sourceLesson: tuesday, targetLesson: thursday, conceptId: 'D', sourceTeachingSlotId: 'slot-tue', carriedAt: '2026-08-25T10:00:00.000Z' });
  assert.deepEqual(thursday.conceptProvenance.D, { fromLessonId: 'lesson-tue', fromTeachingSlotId: 'slot-tue', carriedAt: '2026-08-25T10:00:00.000Z' });

  // Thursday's own date is later displaced (e.g. a Holiday) — D moves AGAIN, Thursday -> Friday, via moveConcept().
  moveConcept({ sourceLesson: thursday, targetLesson: friday, conceptId: 'D' });

  // The provenance must be gone from Thursday (it no longer holds D at all)...
  assert.equal(thursday.conceptProvenance.D, undefined);
  // ...and must be on Friday now, UNCHANGED — still pointing at the TRUE original source (Tuesday), never fabricated, never pointing at Thursday (the intermediate hop) instead.
  assert.deepEqual(friday.conceptProvenance.D, { fromLessonId: 'lesson-tue', fromTeachingSlotId: 'slot-tue', carriedAt: '2026-08-25T10:00:00.000Z' });
});

test('moveConcept: a chain of THREE moves (carry-forward, then two plain moves) still preserves the ORIGINAL provenance at the very end, not the most recent hop', () => {
  const mon = createLesson({ id: 'lesson-mon', classroomId: 'c1', teachingSlotId: 'slot-mon', conceptIds: ['X'] });
  const wed = createLesson({ id: 'lesson-wed', classroomId: 'c1', teachingSlotId: 'slot-wed', conceptIds: [] });
  const fri = createLesson({ id: 'lesson-fri', classroomId: 'c1', teachingSlotId: 'slot-fri', conceptIds: [] });
  const nextMon = createLesson({ id: 'lesson-nextmon', classroomId: 'c1', teachingSlotId: 'slot-nextmon', conceptIds: [] });

  carryForwardConcept({ sourceLesson: mon, targetLesson: wed, conceptId: 'X', sourceTeachingSlotId: 'slot-mon', carriedAt: '2026-08-24T10:00:00.000Z' });
  moveConcept({ sourceLesson: wed, targetLesson: fri, conceptId: 'X' });
  moveConcept({ sourceLesson: fri, targetLesson: nextMon, conceptId: 'X' });

  assert.deepEqual(nextMon.conceptProvenance.X, { fromLessonId: 'lesson-mon', fromTeachingSlotId: 'slot-mon', carriedAt: '2026-08-24T10:00:00.000Z' });
  assert.equal(wed.conceptProvenance.X, undefined);
  assert.equal(fri.conceptProvenance.X, undefined);
  assert.deepEqual(nextMon.conceptIds, ['X']);
  assert.deepEqual(wed.conceptIds, []);
  assert.deepEqual(fri.conceptIds, []);
});

test('rescheduleConceptsForHoliday: a concept that already had carry-forward provenance keeps it after being holiday-displaced', () => {
  const tuesday = createLesson({ id: 'lesson-tue', classroomId: 'c1', teachingSlotId: 'slot-tue', date: '2026-08-25', conceptIds: ['D'] });
  const thursday = createLesson({ id: 'lesson-thu', classroomId: 'c1', teachingSlotId: 'slot-thu', date: '2026-08-27', conceptIds: [] });
  const nextTuesday = createLesson({ id: 'lesson-next-tue', classroomId: 'c1', teachingSlotId: 'slot-next-tue', date: '2026-09-01', conceptIds: [] });

  carryForwardConcept({ sourceLesson: tuesday, targetLesson: thursday, conceptId: 'D', sourceTeachingSlotId: 'slot-tue', carriedAt: '2026-08-25T10:00:00.000Z' });

  // Thursday is now hit by a Holiday — rescheduleConceptsForHoliday() displaces D to the following Tuesday.
  rescheduleConceptsForHoliday({
    sourceLesson: thursday,
    targetLesson: nextTuesday,
    conceptIds: ['D'],
    fromTeachingSlotId: 'slot-thu',
    fromDate: '2026-08-27',
    toTeachingSlotId: 'slot-next-tue',
    toDate: '2026-09-01',
    exceptionId: 'exc-1',
    movedAt: '2026-08-20T00:00:00.000Z',
  });

  assert.deepEqual(nextTuesday.conceptProvenance.D, { fromLessonId: 'lesson-tue', fromTeachingSlotId: 'slot-tue', carriedAt: '2026-08-25T10:00:00.000Z' }, 'the original carry-forward provenance must survive the holiday reschedule, not be discarded');
  assert.equal(thursday.conceptProvenance.D, undefined);
  // The reschedule's own audit trail is independent of, and coexists with, the preserved provenance.
  assert.equal(thursday.rescheduleHistory[0].direction, 'sent');
  assert.equal(nextTuesday.rescheduleHistory[0].direction, 'received');
});

// ---------------------------------------------------------------------
// removeConceptFromLesson — "Remove from lesson" in the Concepts
// panel's overflow menu. Never touches the canonical LearningConcept
// (see services/learningRecordTeacherService.js's own deleteConcept()
// for that separate action) — only this one Lesson's own references.
// ---------------------------------------------------------------------

test('removeConceptFromLesson: removes the concept from conceptIds, leaves other concepts untouched', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['Hazards', 'Disasters', 'Mitigation'] });
  removeConceptFromLesson(lesson, 'Disasters');
  assert.deepEqual(lesson.conceptIds, ['Hazards', 'Mitigation']);
});

test('removeConceptFromLesson: also clears the concept out of executedConceptIds/carriedForwardConceptIds/conceptProvenance, so nothing references an id this lesson no longer plans', () => {
  const lesson = createLesson({
    classroomId: 'c1',
    conceptIds: ['Hazards', 'Disasters'],
    executedConceptIds: ['Hazards'],
    carriedForwardConceptIds: ['Disasters'],
    conceptProvenance: { Disasters: { fromLessonId: 'other-lesson', fromTeachingSlotId: 'slot-x', carriedAt: '2026-08-01T00:00:00.000Z' } },
  });

  removeConceptFromLesson(lesson, 'Disasters');

  assert.deepEqual(lesson.conceptIds, ['Hazards']);
  assert.deepEqual(lesson.carriedForwardConceptIds, []);
  assert.deepEqual(lesson.conceptProvenance, {});
  assert.deepEqual(lesson.executedConceptIds, ['Hazards'], 'an unrelated concept\'s executed status must survive');
});

test('removeConceptFromLesson: removing a concept not actually on the lesson is a safe no-op', () => {
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['Hazards'] });
  removeConceptFromLesson(lesson, 'DoesNotExist');
  assert.deepEqual(lesson.conceptIds, ['Hazards']);
});

// ---------------------------------------------------------------------
// resetLessonForUnitChange — "Measurement" attached by accident,
// teacher corrects it via the Timetable's own "Edit lesson" action.
// ---------------------------------------------------------------------

test('resetLessonForUnitChange: reassigns curriculumUnitId to the new unit', () => {
  const lesson = createLesson({ classroomId: 'c1', curriculumUnitId: 'unit-measurement', conceptIds: [] });
  resetLessonForUnitChange(lesson, 'unit-fractions');
  assert.equal(lesson.curriculumUnitId, 'unit-fractions');
});

test('resetLessonForUnitChange: clears conceptIds/executedConceptIds/carriedForwardConceptIds/conceptProvenance — a concept id from the old unit is meaningless against the new one', () => {
  const lesson = createLesson({
    classroomId: 'c1',
    curriculumUnitId: 'unit-measurement',
    conceptIds: ['A', 'B'],
    executedConceptIds: ['A'],
    carriedForwardConceptIds: ['B'],
    conceptProvenance: { B: { fromLessonId: 'other-lesson', fromTeachingSlotId: 'slot-x', carriedAt: '2026-08-01T00:00:00.000Z' } },
  });

  resetLessonForUnitChange(lesson, 'unit-fractions');

  assert.deepEqual(lesson.conceptIds, []);
  assert.deepEqual(lesson.executedConceptIds, []);
  assert.deepEqual(lesson.carriedForwardConceptIds, []);
  assert.deepEqual(lesson.conceptProvenance, {});
});

test('resetLessonForUnitChange: clears feedbackSharedAt — feedback already shared referred to concepts that no longer apply', () => {
  const lesson = createLesson({ classroomId: 'c1', curriculumUnitId: 'unit-measurement', conceptIds: ['A'], feedbackSharedAt: '2026-08-20T10:00:00.000Z' });
  resetLessonForUnitChange(lesson, 'unit-fractions');
  assert.equal(lesson.feedbackSharedAt, null);
});

test('resetLessonForUnitChange: a lesson that already had zero concepts stays at zero (no-op on the concept fields, but the unit still changes)', () => {
  const lesson = createLesson({ classroomId: 'c1', curriculumUnitId: 'unit-measurement', conceptIds: [] });
  resetLessonForUnitChange(lesson, 'unit-fractions');
  assert.equal(lesson.curriculumUnitId, 'unit-fractions');
  assert.deepEqual(lesson.conceptIds, []);
});

// "None" — the Timetable's own Edit Lesson dropdown clearing a
// Unit/Topic assigned by accident, e.g. English -> "Poem: Special
// Hero" — no special-casing in this function itself; `null` is just
// another `newUnitId`, same as any real unit id.
test('resetLessonForUnitChange: newUnitId of null (the "None" option) clears curriculumUnitId — the lesson itself, its date, and its teachingSlotId are all untouched', () => {
  const lesson = createLesson({
    classroomId: 'c1',
    date: '2026-09-10',
    teachingSlotId: 'slot-123',
    curriculumUnitId: 'unit-poem-special-hero',
    conceptIds: ['A', 'B'],
    executedConceptIds: ['A'],
  });

  resetLessonForUnitChange(lesson, null);

  assert.equal(lesson.curriculumUnitId, null);
  assert.deepEqual(lesson.conceptIds, []);
  assert.deepEqual(lesson.executedConceptIds, []);
  assert.equal(lesson.date, '2026-09-10');
  assert.equal(lesson.teachingSlotId, 'slot-123');
  assert.equal(lesson.classroomId, 'c1');
});

test('resetLessonForUnitChange: an already-unassigned lesson (curriculumUnitId already null) stays null and stays a no-op on its own concept fields', () => {
  const lesson = createLesson({ classroomId: 'c1', curriculumUnitId: null, conceptIds: [] });
  resetLessonForUnitChange(lesson, null);
  assert.equal(lesson.curriculumUnitId, null);
  assert.deepEqual(lesson.conceptIds, []);
});

test('createLesson: rescheduleHistory defaults to an empty array', () => {
  const lesson = createLesson({ classroomId: 'c1' });
  assert.deepEqual(lesson.rescheduleHistory, []);
});

test('rescheduleConceptsForHoliday: moves every open concept to the target, clearing them from the source entirely (via moveConcept)', () => {
  const source = createLesson({ classroomId: 'c1', date: '2026-08-27', teachingSlotId: 'slot-src', curriculumUnitId: 'unit-1', conceptIds: ['c1', 'c2'] });
  const target = createLesson({ classroomId: 'c1', date: '2026-09-01', teachingSlotId: 'slot-dst', curriculumUnitId: 'unit-1' });

  rescheduleConceptsForHoliday({
    sourceLesson: source,
    targetLesson: target,
    conceptIds: ['c1', 'c2'],
    fromTeachingSlotId: 'slot-src',
    fromDate: '2026-08-27',
    toTeachingSlotId: 'slot-dst',
    toDate: '2026-09-01',
    exceptionId: 'exc-1',
    movedAt: '2026-08-20T00:00:00.000Z',
  });

  assert.deepEqual(source.conceptIds, []);
  assert.deepEqual(target.conceptIds, ['c1', 'c2']);
});

test('rescheduleConceptsForHoliday: records a paired rescheduleHistory entry on BOTH lessons, sharing one moveId', () => {
  const source = createLesson({ classroomId: 'c1', date: '2026-08-27', teachingSlotId: 'slot-src', curriculumUnitId: 'unit-1', conceptIds: ['c1'] });
  const target = createLesson({ classroomId: 'c1', date: '2026-09-01', teachingSlotId: 'slot-dst', curriculumUnitId: 'unit-1' });

  rescheduleConceptsForHoliday({
    sourceLesson: source,
    targetLesson: target,
    conceptIds: ['c1'],
    fromTeachingSlotId: 'slot-src',
    fromDate: '2026-08-27',
    toTeachingSlotId: 'slot-dst',
    toDate: '2026-09-01',
    exceptionId: 'exc-1',
    movedAt: '2026-08-20T00:00:00.000Z',
  });

  assert.equal(source.rescheduleHistory.length, 1);
  assert.equal(target.rescheduleHistory.length, 1);
  const sentRecord = source.rescheduleHistory[0];
  const receivedRecord = target.rescheduleHistory[0];
  assert.equal(sentRecord.direction, 'sent');
  assert.equal(receivedRecord.direction, 'received');
  assert.equal(sentRecord.moveId, receivedRecord.moveId, 'both sides of the same move share one moveId');
  assert.deepEqual(sentRecord.conceptIds, ['c1']);
  assert.equal(sentRecord.fromTeachingSlotId, 'slot-src');
  assert.equal(sentRecord.toTeachingSlotId, 'slot-dst');
  assert.equal(sentRecord.exceptionId, 'exc-1');
  assert.equal(sentRecord.reason, 'holiday');
  assert.equal(sentRecord.movedAt, '2026-08-20T00:00:00.000Z');
  assert.equal(sentRecord.toLessonId, target.id);
  assert.equal(receivedRecord.fromLessonId, source.id);
});

test('rescheduleConceptsForHoliday: a fully-rescheduled source lesson (nothing else open) gets status "rescheduled"', () => {
  const source = createLesson({ classroomId: 'c1', teachingSlotId: 'slot-src', date: '2026-08-27', curriculumUnitId: 'unit-1', conceptIds: ['c1', 'c2'] });
  const target = createLesson({ classroomId: 'c1', teachingSlotId: 'slot-dst', date: '2026-09-01', curriculumUnitId: 'unit-1' });

  rescheduleConceptsForHoliday({
    sourceLesson: source,
    targetLesson: target,
    conceptIds: ['c1', 'c2'],
    fromTeachingSlotId: 'slot-src',
    fromDate: '2026-08-27',
    toTeachingSlotId: 'slot-dst',
    toDate: '2026-09-01',
    exceptionId: 'exc-1',
    movedAt: '2026-08-20T00:00:00.000Z',
  });

  assert.equal(source.status, 'rescheduled');
});

test('rescheduleConceptsForHoliday: a PARTIALLY-rescheduled source lesson (still has its own executed concept) keeps its normal status — completed work/history untouched', () => {
  const source = createLesson({
    classroomId: 'c1',
    teachingSlotId: 'slot-src',
    date: '2026-08-27',
    curriculumUnitId: 'unit-1',
    conceptIds: ['c1', 'c2'],
    executedConceptIds: ['c1'],
  });
  const target = createLesson({ classroomId: 'c1', teachingSlotId: 'slot-dst', date: '2026-09-01', curriculumUnitId: 'unit-1' });

  rescheduleConceptsForHoliday({
    sourceLesson: source,
    targetLesson: target,
    conceptIds: ['c2'], // only the open one
    fromTeachingSlotId: 'slot-src',
    fromDate: '2026-08-27',
    toTeachingSlotId: 'slot-dst',
    toDate: '2026-09-01',
    exceptionId: 'exc-1',
    movedAt: '2026-08-20T00:00:00.000Z',
  });

  assert.equal(source.status, 'planned', 'c1 is still executed/open on the source — this Lesson still has real completed work of its own');
  assert.deepEqual(source.conceptIds, ['c1'], 'c1 (executed) stays on the source — only c2 (open) actually moved');
  assert.deepEqual(source.executedConceptIds, ['c1'], 'executed history is completely untouched by the reschedule');
});

test('rescheduleConceptsForHoliday: an empty conceptIds list is a safe no-op — no history entries, no status change', () => {
  const source = createLesson({ classroomId: 'c1', teachingSlotId: 'slot-src', date: '2026-08-27', curriculumUnitId: 'unit-1', conceptIds: ['c1'] });
  const target = createLesson({ classroomId: 'c1', teachingSlotId: 'slot-dst', date: '2026-09-01', curriculumUnitId: 'unit-1' });

  rescheduleConceptsForHoliday({
    sourceLesson: source,
    targetLesson: target,
    conceptIds: [],
    fromTeachingSlotId: 'slot-src',
    fromDate: '2026-08-27',
    toTeachingSlotId: 'slot-dst',
    toDate: '2026-09-01',
    exceptionId: 'exc-1',
    movedAt: '2026-08-20T00:00:00.000Z',
  });

  assert.deepEqual(source.rescheduleHistory, []);
  assert.deepEqual(target.rescheduleHistory, []);
  assert.equal(source.status, 'planned');
  assert.deepEqual(source.conceptIds, ['c1']);
});

test('createRescheduleRecord: populates every field exactly as given, generating a real id when none is supplied', () => {
  const record = createRescheduleRecord({
    moveId: 'move-1',
    direction: 'sent',
    conceptIds: ['c1', 'c2'],
    fromTeachingSlotId: 'slot-src',
    fromDate: '2026-08-27',
    toTeachingSlotId: 'slot-dst',
    toDate: '2026-09-01',
    toLessonId: 'lesson-2',
    fromLessonId: 'lesson-1',
    exceptionId: 'exc-1',
    reason: 'holiday',
    movedAt: '2026-08-20T00:00:00.000Z',
  });
  assert.ok(record.id);
  assert.equal(record.moveId, 'move-1');
  assert.equal(record.direction, 'sent');
  assert.deepEqual(record.conceptIds, ['c1', 'c2']);
  assert.equal(record.reason, 'holiday');
});
