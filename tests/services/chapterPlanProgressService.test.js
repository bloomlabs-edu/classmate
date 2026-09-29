import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLesson } from '../../js/models/Lesson.js';
import { createChapterPlan } from '../../js/models/ChapterPlan.js';
import { getChapterPlanProgress, getChapterPlanWeeks, getChapterPlanLessons } from '../../js/services/chapterPlanProgressService.js';

function plan(overrides = {}) {
  return createChapterPlan({
    classroomId: 'classroom-a',
    teacherUid: 'fellow-1',
    curriculumUnitId: 'unit-local-17',
    linkedCurriculumUnitId: 'curriculum-index-unit-hazards',
    chapterName: 'Hazards',
    conceptIds: ['concept-natural-hazards', 'concept-human-made-hazards', 'concept-risk'],
    ...overrides,
  });
}

function meaningfulLesson(overrides = {}) {
  return createLesson({
    classroomId: 'classroom-a',
    curriculumUnitId: 'unit-local-17',
    date: '2026-09-07',
    teachingSlotId: 'classroom-a_2026-09-07_p1',
    bigQuestion: 'Why do floods become disasters?',
    ...overrides,
  });
}

test('getChapterPlanProgress: a Lesson not matching this chapter\'s curriculumUnitId is excluded entirely, not just uncounted as "planned"', () => {
  const otherChapterLesson = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-99', date: '2026-09-07', teachingSlotId: 'slot-1' });
  const progress = getChapterPlanProgress([otherChapterLesson], plan());
  assert.equal(progress.lessonsPlanned, 0);
  assert.equal(progress.weeksSpanned, 0);
  assert.equal(progress.lastPlannedDate, null);
});

test('getChapterPlanProgress: reusing hasMeaningfulWeeklyPlanContent() verbatim means a matching Lesson already counts as "planned" the moment curriculumUnitId is set — even with no objectives/big question yet. This is the existing Weekly Plan definition, not a new one invented here.', () => {
  const barelyTouched = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-17', date: '2026-09-07', teachingSlotId: 'slot-1' });
  const progress = getChapterPlanProgress([barelyTouched], plan());
  assert.equal(progress.lessonsPlanned, 1);
});

test('getChapterPlanProgress: counts only Lessons matching classroomId AND curriculumUnitId — never linkedCurriculumUnitId', () => {
  const sameChapterOtherClassroom = meaningfulLesson({ classroomId: 'classroom-b', teachingSlotId: 'classroom-b_2026-09-07_p1' });
  const differentUnit = meaningfulLesson({ curriculumUnitId: 'unit-local-99', teachingSlotId: 'classroom-a_2026-09-07_p2' });
  const thisChapter = meaningfulLesson({ teachingSlotId: 'classroom-a_2026-09-07_p3' });

  const progress = getChapterPlanProgress([sameChapterOtherClassroom, differentUnit, thisChapter], plan());
  assert.equal(progress.lessonsPlanned, 1);
});

test('getChapterPlanProgress: lessonsPlanned reuses hasMeaningfulWeeklyPlanContent — a concept alone (no objective/big question) already counts', () => {
  const lesson = createLesson({
    classroomId: 'classroom-a',
    curriculumUnitId: 'unit-local-17',
    date: '2026-09-07',
    teachingSlotId: 'slot-1',
    conceptIds: ['concept-risk'],
  });
  const progress = getChapterPlanProgress([lesson], plan());
  assert.equal(progress.lessonsPlanned, 1);
});

test('getChapterPlanProgress: lessonsWithDetailedPlan counts lessonPlanId independently of "planned" content', () => {
  const withDetailedPlan = meaningfulLesson({ teachingSlotId: 'slot-1', lessonPlanId: 'lesson-plan-1' });
  const withoutOne = meaningfulLesson({ teachingSlotId: 'slot-2' });
  const progress = getChapterPlanProgress([withDetailedPlan, withoutOne], plan());
  assert.equal(progress.lessonsPlanned, 2);
  assert.equal(progress.lessonsWithDetailedPlan, 1);
});

test('getChapterPlanProgress: weeksSpanned counts distinct Monday-start weeks among planned Lessons only', () => {
  const mondayLesson = meaningfulLesson({ teachingSlotId: 'slot-mon-1', date: '2026-09-07' }); // Monday
  const sameWeekLesson = meaningfulLesson({ teachingSlotId: 'slot-wed-1', date: '2026-09-09' }); // Wednesday, same week
  const nextWeekLesson = meaningfulLesson({ teachingSlotId: 'slot-mon-2', date: '2026-09-14' }); // following Monday

  const progress = getChapterPlanProgress([mondayLesson, sameWeekLesson, nextWeekLesson], plan());
  assert.equal(progress.weeksSpanned, 2);
  assert.equal(progress.lessonsPlanned, 3);
});

test('getChapterPlanProgress: conceptsAddressed is the union of executedConceptIds (taught), not conceptIds (merely planned)', () => {
  const lesson = meaningfulLesson({
    teachingSlotId: 'slot-1',
    conceptIds: ['concept-natural-hazards', 'concept-human-made-hazards'],
    executedConceptIds: ['concept-natural-hazards'],
  });
  const progress = getChapterPlanProgress([lesson], plan());
  assert.deepEqual(progress.conceptsAddressed, ['concept-natural-hazards']);
});

test('getChapterPlanProgress: conceptsIntended is chapterPlan.conceptIds verbatim, never merged with conceptsAddressed', () => {
  const lesson = meaningfulLesson({ teachingSlotId: 'slot-1', conceptIds: ['concept-risk'], executedConceptIds: ['concept-risk'] });
  const progress = getChapterPlanProgress([lesson], plan());
  assert.deepEqual(progress.conceptsIntended, ['concept-natural-hazards', 'concept-human-made-hazards', 'concept-risk']);
  assert.deepEqual(progress.conceptsAddressed, ['concept-risk']);
});

test('getChapterPlanProgress: lastPlannedDate is the latest date among matching (this chapter\'s) Lessons only, null when there are none', () => {
  const earlier = meaningfulLesson({ teachingSlotId: 'slot-1', date: '2026-09-07' });
  const later = meaningfulLesson({ teachingSlotId: 'slot-2', date: '2026-09-21' });
  const otherChapterLaterStill = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-99', date: '2026-09-28', teachingSlotId: 'slot-3' });

  const progress = getChapterPlanProgress([earlier, later, otherChapterLaterStill], plan());
  assert.equal(progress.lastPlannedDate, '2026-09-21');
  assert.equal(getChapterPlanProgress([otherChapterLaterStill], plan()).lastPlannedDate, null);
});

test('getChapterPlanProgress: an empty/no Lessons list returns all-zero, non-null progress', () => {
  const progress = getChapterPlanProgress([], plan());
  assert.deepEqual(progress, {
    lessonsPlanned: 0,
    lessonsWithDetailedPlan: 0,
    weeksSpanned: 0,
    conceptsAddressed: [],
    conceptsIntended: ['concept-natural-hazards', 'concept-human-made-hazards', 'concept-risk'],
    lastPlannedDate: null,
  });
});

// ---------------------------------------------------------------------
// getChapterPlanWeeks
// ---------------------------------------------------------------------

test('getChapterPlanWeeks: an empty/no Lessons list returns an empty list', () => {
  assert.deepEqual(getChapterPlanWeeks([], plan()), []);
});

test('getChapterPlanWeeks: groups Lessons into one entry per distinct Monday-start week, sorted ascending, with a per-week lessonCount', () => {
  const mondayLesson = meaningfulLesson({ teachingSlotId: 'slot-mon-1', date: '2026-09-07' }); // Monday
  const wedSameWeek = meaningfulLesson({ teachingSlotId: 'slot-wed-1', date: '2026-09-09' }); // same week
  const nextWeekLesson = meaningfulLesson({ teachingSlotId: 'slot-mon-2', date: '2026-09-14' }); // following week

  const weeks = getChapterPlanWeeks([nextWeekLesson, mondayLesson, wedSameWeek], plan());
  assert.deepEqual(weeks, [
    { weekStartDate: '2026-09-07', lessonCount: 2 },
    { weekStartDate: '2026-09-14', lessonCount: 1 },
  ]);
});

test('getChapterPlanWeeks: excludes Lessons from a different classroom or a different curriculumUnitId — never linkedCurriculumUnitId', () => {
  const otherClassroom = meaningfulLesson({ classroomId: 'classroom-b', teachingSlotId: 'classroom-b_slot-1' });
  const otherUnit = meaningfulLesson({ curriculumUnitId: 'unit-local-99', teachingSlotId: 'slot-other-unit' });
  const thisChapter = meaningfulLesson({ teachingSlotId: 'slot-this-chapter' });

  const weeks = getChapterPlanWeeks([otherClassroom, otherUnit, thisChapter], plan());
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].lessonCount, 1);
});

// ---------------------------------------------------------------------
// getChapterPlanLessons
// ---------------------------------------------------------------------

test('getChapterPlanLessons: a Lesson matching classroomId + curriculumUnitId is included', () => {
  const lesson = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-17', date: '2026-09-07', teachingSlotId: 'classroom-a_2026-09-07_p1' });
  const lessons = getChapterPlanLessons([lesson], plan());
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].id, lesson.id);
});

test('getChapterPlanLessons: a Lesson from a different classroomId is excluded', () => {
  const lesson = createLesson({ classroomId: 'classroom-b', curriculumUnitId: 'unit-local-17', date: '2026-09-07', teachingSlotId: 'classroom-b_2026-09-07_p1' });
  assert.deepEqual(getChapterPlanLessons([lesson], plan()), []);
});

test('getChapterPlanLessons: a Lesson with a different curriculumUnitId is excluded', () => {
  const lesson = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-99', date: '2026-09-07', teachingSlotId: 'classroom-a_2026-09-07_p1' });
  assert.deepEqual(getChapterPlanLessons([lesson], plan()), []);
});

test('getChapterPlanLessons: a Lesson matching this chapter\'s linkedCurriculumUnitId but a DIFFERENT curriculumUnitId is excluded — the association is never made via linkedCurriculumUnitId', () => {
  // plan()'s own linkedCurriculumUnitId is 'curriculum-index-unit-hazards' — this Lesson carries that
  // same value in its OWN curriculumUnitId field (a different classroom's local id could coincidentally
  // collide with another classroom's linkedCurriculumUnitId string) but is NOT plan()'s curriculumUnitId.
  const lesson = createLesson({
    classroomId: 'classroom-a',
    curriculumUnitId: 'curriculum-index-unit-hazards',
    date: '2026-09-07',
    teachingSlotId: 'classroom-a_2026-09-07_p1',
  });
  assert.deepEqual(getChapterPlanLessons([lesson], plan()), []);
});

test('getChapterPlanLessons: returns Lessons ordered chronologically by date, then by period number for the same day', () => {
  const later = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-17', date: '2026-09-14', teachingSlotId: 'classroom-a_2026-09-14_p1' });
  const earlierLaterPeriod = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-17', date: '2026-09-07', teachingSlotId: 'classroom-a_2026-09-07_p3' });
  const earlierEarlierPeriod = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-17', date: '2026-09-07', teachingSlotId: 'classroom-a_2026-09-07_p1' });

  const lessons = getChapterPlanLessons([later, earlierLaterPeriod, earlierEarlierPeriod], plan());
  assert.deepEqual(
    lessons.map((lesson) => lesson.id),
    [earlierEarlierPeriod.id, earlierLaterPeriod.id, later.id]
  );
});

test('getChapterPlanLessons: LessonPlan presence is read straight off the existing lesson.lessonPlanId relationship, never re-derived', () => {
  const withPlan = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-17', date: '2026-09-07', teachingSlotId: 'slot-1', lessonPlanId: 'lesson-plan-1' });
  const withoutPlan = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-17', date: '2026-09-08', teachingSlotId: 'slot-2' });

  const lessons = getChapterPlanLessons([withPlan, withoutPlan], plan());
  assert.equal(lessons.find((lesson) => lesson.id === withPlan.id).lessonPlanId, 'lesson-plan-1');
  assert.equal(lessons.find((lesson) => lesson.id === withoutPlan.id).lessonPlanId, null);
});

test('getChapterPlanLessons: does not mutate its inputs and persists nothing — a pure read', () => {
  const lesson = createLesson({ classroomId: 'classroom-a', curriculumUnitId: 'unit-local-17', date: '2026-09-07', teachingSlotId: 'slot-1' });
  const inputLessons = [lesson];
  const inputPlan = plan();
  const snapshotLesson = JSON.stringify(lesson);
  const snapshotPlan = JSON.stringify(inputPlan);

  getChapterPlanLessons(inputLessons, inputPlan);

  assert.equal(JSON.stringify(lesson), snapshotLesson);
  assert.equal(JSON.stringify(inputPlan), snapshotPlan);
  assert.equal(inputLessons.length, 1); // the input array itself is untouched, not filtered in place
});
