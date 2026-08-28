import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createLearningSubject } from '../../js/models/LearningSubject.js';
import { createLearningUnit } from '../../js/models/LearningUnit.js';
import { createLearningConcept } from '../../js/models/LearningConcept.js';
import { createLesson } from '../../js/models/Lesson.js';
import { formatDateKey } from '../../js/utils/dateHelpers.js';
import { getRelativeDayLabel, sortByDateDesc, groupByDay, resolveExecutedLessonEntries } from '../../js/services/learningHistoryGrouping.js';

const TODAY = '2026-08-28'; // a Friday

// ---------------------------------------------------------------------
// getRelativeDayLabel
// ---------------------------------------------------------------------

test('getRelativeDayLabel: today is "Today"', () => {
  assert.equal(getRelativeDayLabel('2026-08-28', TODAY), 'Today');
});

test('getRelativeDayLabel: one day back is "Yesterday"', () => {
  assert.equal(getRelativeDayLabel('2026-08-27', TODAY), 'Yesterday');
});

test('getRelativeDayLabel: within the last week uses the real weekday name', () => {
  // 2026-08-24 is a Monday, 4 days before the Friday TODAY.
  assert.equal(getRelativeDayLabel('2026-08-24', TODAY), 'Monday');
});

test('getRelativeDayLabel: a week or more back falls back to a plain formatted date', () => {
  const dateKey = '2026-08-10';
  assert.equal(getRelativeDayLabel(dateKey, TODAY), formatDateKey(dateKey));
});

test('getRelativeDayLabel: a future date (should never happen in practice) still falls back to a formatted date, not a negative/garbled label', () => {
  const dateKey = '2026-09-05';
  assert.equal(getRelativeDayLabel(dateKey, TODAY), formatDateKey(dateKey));
});

// ---------------------------------------------------------------------
// sortByDateDesc / groupByDay
// ---------------------------------------------------------------------

test('sortByDateDesc: newest date first', () => {
  const entries = [{ date: '2026-08-24' }, { date: '2026-08-28' }, { date: '2026-08-26' }];
  assert.deepEqual(sortByDateDesc(entries).map((e) => e.date), ['2026-08-28', '2026-08-26', '2026-08-24']);
});

test('sortByDateDesc: does not mutate the original array', () => {
  const entries = [{ date: '2026-08-24' }, { date: '2026-08-28' }];
  const sorted = sortByDateDesc(entries);
  assert.notEqual(sorted, entries);
  assert.equal(entries[0].date, '2026-08-24'); // unchanged
});

test('groupByDay: buckets entries by date, newest date first, with correct labels', () => {
  const entries = [
    { date: '2026-08-24', subjectTitle: 'Science' }, // Monday
    { date: '2026-08-28', subjectTitle: 'Maths' }, // Today
    { date: '2026-08-27', subjectTitle: 'Social Science' }, // Yesterday
    { date: '2026-08-27', subjectTitle: 'English' }, // same day, second entry
  ];
  const groups = groupByDay(entries, TODAY);

  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Today', 'Yesterday', 'Monday']
  );
  // Both same-day entries land in the same group, in their original relative order.
  assert.equal(groups[1].entries.length, 2);
  assert.deepEqual(
    groups[1].entries.map((e) => e.subjectTitle),
    ['Social Science', 'English']
  );
});

test('groupByDay: an empty input returns an empty array, not an error', () => {
  assert.deepEqual(groupByDay([], TODAY), []);
});

// ---------------------------------------------------------------------
// resolveExecutedLessonEntries
// ---------------------------------------------------------------------

function makeFixtureClassroom() {
  const conceptA = createLearningConcept({ id: 'concept-a', title: 'Forces' });
  const conceptB = createLearningConcept({ id: 'concept-b', title: 'Pressure' });
  const unit = createLearningUnit({ id: 'unit-1', title: 'Forces & Pressure', concepts: [conceptA, conceptB] });
  const subject = createLearningSubject({ id: 'subject-1', title: 'Science', units: [unit] });
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  classroom.learningRecord = { subjects: [subject] };
  return { classroom, conceptA, conceptB, unit, subject };
}

test('resolveExecutedLessonEntries: a Lesson with one executed concept resolves to one entry with real subject/unit/concept context', () => {
  const { classroom } = makeFixtureClassroom();
  const lesson = createLesson({ classroomId: 'classroom-1', date: '2026-08-28', teachingSlotId: 'slot-1', curriculumUnitId: 'unit-1', conceptIds: ['concept-a'] });
  lesson.executedConceptIds = ['concept-a'];

  const entries = resolveExecutedLessonEntries(classroom, [lesson]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, '2026-08-28');
  assert.equal(entries[0].subjectTitle, 'Science');
  assert.equal(entries[0].unitTitle, 'Forces & Pressure');
  assert.equal(entries[0].concepts.length, 1);
  assert.equal(entries[0].concepts[0].title, 'Forces');
});

test('resolveExecutedLessonEntries: a Lesson with multiple executed concepts keeps them all, in order', () => {
  const { classroom } = makeFixtureClassroom();
  const lesson = createLesson({ classroomId: 'classroom-1', date: '2026-08-28', teachingSlotId: 'slot-1', curriculumUnitId: 'unit-1', conceptIds: ['concept-a', 'concept-b'] });
  lesson.executedConceptIds = ['concept-a', 'concept-b'];

  const entries = resolveExecutedLessonEntries(classroom, [lesson]);

  assert.equal(entries.length, 1);
  assert.deepEqual(
    entries[0].concepts.map((c) => c.title),
    ['Forces', 'Pressure']
  );
});

test('resolveExecutedLessonEntries: a Lesson with no executed concepts (planned but not taught) is excluded entirely', () => {
  const { classroom } = makeFixtureClassroom();
  const lesson = createLesson({ classroomId: 'classroom-1', date: '2026-08-28', teachingSlotId: 'slot-1', curriculumUnitId: 'unit-1', conceptIds: ['concept-a'] });
  // executedConceptIds left at its default []

  const entries = resolveExecutedLessonEntries(classroom, [lesson]);
  assert.deepEqual(entries, []);
});

test('resolveExecutedLessonEntries: a Lesson whose only executed concept id no longer resolves (deleted from the syllabus since) is excluded, not returned with an empty concepts array', () => {
  const { classroom } = makeFixtureClassroom();
  const lesson = createLesson({ classroomId: 'classroom-1', date: '2026-08-28', teachingSlotId: 'slot-1', curriculumUnitId: 'unit-1', conceptIds: ['concept-deleted'] });
  lesson.executedConceptIds = ['concept-deleted'];

  const entries = resolveExecutedLessonEntries(classroom, [lesson]);
  assert.deepEqual(entries, []);
});

test('resolveExecutedLessonEntries: multiple Lessons across different dates each produce their own entry', () => {
  const { classroom } = makeFixtureClassroom();
  const lessonMonday = createLesson({ classroomId: 'classroom-1', date: '2026-08-24', teachingSlotId: 'slot-1', curriculumUnitId: 'unit-1', conceptIds: ['concept-a'] });
  lessonMonday.executedConceptIds = ['concept-a'];
  const lessonToday = createLesson({ classroomId: 'classroom-1', date: '2026-08-28', teachingSlotId: 'slot-2', curriculumUnitId: 'unit-1', conceptIds: ['concept-b'] });
  lessonToday.executedConceptIds = ['concept-b'];

  const entries = resolveExecutedLessonEntries(classroom, [lessonMonday, lessonToday]);
  assert.equal(entries.length, 2);
  assert.deepEqual(sortByDateDesc(entries).map((e) => e.date), ['2026-08-28', '2026-08-24']);
});
