import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createLesson } from '../../js/models/Lesson.js';
import * as learningRecordTeacherService from '../../js/services/learningRecordTeacherService.js';
import * as timetableDisplayService from '../../js/services/timetableDisplayService.js';

function classroomWithSyllabus() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  const subject = learningRecordTeacherService.createSubject(classroom, { title: 'Science', subjectId: 'science' });
  const unit = learningRecordTeacherService.createUnit(classroom, subject.id, { title: 'Water Cycle' });
  const evaporation = learningRecordTeacherService.createConcept(classroom, unit.id, { title: 'Evaporation' });
  const condensation = learningRecordTeacherService.createConcept(classroom, unit.id, { title: 'Condensation' });
  return { classroom, subject, unit, evaporation, condensation };
}

test('resolveSubjectTitle: uses the classroom\'s own real Learning Record subject title when one has been set up', () => {
  const { classroom } = classroomWithSyllabus();
  assert.equal(timetableDisplayService.resolveSubjectTitle(classroom, 'science'), 'Science');
});

test('resolveSubjectTitle: falls back to the canonical registry title when no Learning Record subject exists yet for this subjectId', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  assert.equal(timetableDisplayService.resolveSubjectTitle(classroom, 'mathematics'), 'Mathematics');
});

test('resolveSubjectTitle: falls back to the raw id as a last resort, never blank', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  assert.equal(timetableDisplayService.resolveSubjectTitle(classroom, 'some-custom-subject-id'), 'some-custom-subject-id');
});

test('resolveLessonTopic: resolves the real LearningUnit title a Lesson\'s curriculumUnitId points to', () => {
  const { classroom, unit } = classroomWithSyllabus();
  const lesson = createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id });
  assert.equal(timetableDisplayService.resolveLessonTopic(classroom, lesson), 'Water Cycle');
});

test('resolveLessonTopic: null before any lesson plan is attached (no dummy topic invented)', () => {
  const { classroom } = classroomWithSyllabus();
  assert.equal(timetableDisplayService.resolveLessonTopic(classroom, null), null);
});

test('resolveLessonConcepts: resolves real concept titles in the lesson\'s own conceptIds order', () => {
  const { classroom, unit, evaporation, condensation } = classroomWithSyllabus();
  const lesson = createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, conceptIds: [evaporation.id, condensation.id] });
  assert.deepEqual(timetableDisplayService.resolveLessonConcepts(classroom, lesson), [
    { id: evaporation.id, title: 'Evaporation' },
    { id: condensation.id, title: 'Condensation' },
  ]);
});

test('resolveLessonConcepts: empty array for no lesson at all', () => {
  const { classroom } = classroomWithSyllabus();
  assert.deepEqual(timetableDisplayService.resolveLessonConcepts(classroom, null), []);
});

// ---------------------------------------------------------------------
// deriveUnitProgress / summarizeUnitProgressForRange — the Timetable
// Calendar's per-subject curriculum-progress view.
// ---------------------------------------------------------------------

test('deriveUnitProgress: null when the Unit has never actually been taught (no Lessons at all)', () => {
  const { unit } = classroomWithSyllabus();
  assert.equal(timetableDisplayService.deriveUnitProgress(unit, []), null);
});

test('deriveUnitProgress: start/last-taught-lesson dates and period count come from the Lessons themselves, in any input order', () => {
  const { classroom, unit } = classroomWithSyllabus();
  const lessons = [
    createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-08' }),
    createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-02' }),
    createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-05' }),
  ];
  const progress = timetableDisplayService.deriveUnitProgress(unit, lessons);
  assert.equal(progress.startDate, '2026-09-02');
  assert.equal(progress.lastTaughtLessonDate, '2026-09-08');
  assert.equal(progress.periodsCount, 3);
});

test('deriveUnitProgress: not completed while at least one concept is still not_taught — never inferred from a scheduled date passing', () => {
  const { classroom, unit, evaporation } = classroomWithSyllabus();
  learningRecordTeacherService.setConceptTaughtStatus(classroom, evaporation.id, 'taught');
  // condensation stays 'not_taught'
  const lessons = [createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-02' })];
  const progress = timetableDisplayService.deriveUnitProgress(unit, lessons);
  assert.equal(progress.isCompleted, false);
  assert.equal(progress.completedDate, null);
});

test('deriveUnitProgress: completedDate is the date the LAST remaining concept was first executed, not this Unit\'s last Lesson — a later revision Lesson must never push completion forward', () => {
  const { classroom, unit, evaporation, condensation } = classroomWithSyllabus();
  learningRecordTeacherService.setConceptTaughtStatus(classroom, evaporation.id, 'taught');
  learningRecordTeacherService.setConceptTaughtStatus(classroom, condensation.id, 'taught');
  const lessons = [
    createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-02', executedConceptIds: [evaporation.id] }),
    createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-04', executedConceptIds: [condensation.id] }),
    // A Sep 10 revision Lesson for the same, already-complete Unit —
    // this is the exact scenario that must NOT report Sep 10 as the
    // completion date.
    createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-10', executedConceptIds: [evaporation.id, condensation.id] }),
  ];
  const progress = timetableDisplayService.deriveUnitProgress(unit, lessons);
  assert.equal(progress.isCompleted, true);
  assert.equal(progress.completedDate, '2026-09-04');
  assert.equal(progress.lastTaughtLessonDate, '2026-09-10');
});

test('deriveUnitProgress: completedDate is null (never guessed) when a concept\'s taught status can\'t be traced back to any dated Lesson — e.g. the Learning Record view\'s direct taught/not-taught toggle', () => {
  const { classroom, unit, evaporation, condensation } = classroomWithSyllabus();
  learningRecordTeacherService.setConceptTaughtStatus(classroom, evaporation.id, 'taught');
  // condensation is marked taught directly (no Lesson ever records it) —
  // simulates the Learning Record toggle path, which writes no date.
  learningRecordTeacherService.setConceptTaughtStatus(classroom, condensation.id, 'taught');
  const lessons = [createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-02', executedConceptIds: [evaporation.id] })];
  const progress = timetableDisplayService.deriveUnitProgress(unit, lessons);
  assert.equal(progress.isCompleted, true);
  assert.equal(progress.completedDate, null);
  assert.equal(progress.lastTaughtLessonDate, '2026-09-02');
});

test('deriveUnitProgress: a Unit with zero concepts is never "completed", even though every() over an empty array is vacuously true', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  const subject = learningRecordTeacherService.createSubject(classroom, { title: 'Science', subjectId: 'science' });
  const emptyUnit = learningRecordTeacherService.createUnit(classroom, subject.id, { title: 'Untouched Unit' });
  const lessons = [createLesson({ classroomId: classroom.id, curriculumUnitId: emptyUnit.id, date: '2026-09-02' })];
  assert.equal(timetableDisplayService.deriveUnitProgress(emptyUnit, lessons).isCompleted, false);
});

// Calendar curriculum progress after a Lesson's Unit/Topic is cleared
// via the Timetable's own "Edit lesson" -> "None" action
// (ui/views/TimetableView.js's openEditLessonUnitFlow()). Clearing
// sets Lesson.curriculumUnitId to null and saves that one Lesson
// document; plannerRepository.getLessonsForUnit()'s own Firestore
// query (`where('curriculumUnitId', '==', unitId)`) then simply never
// returns that Lesson for the OLD unit again — a live filter on the
// CURRENT field value, not a cached association. This test simulates
// exactly that: "before" includes the now-cleared Lesson, "after"
// is the lessonsForUnit list that same query would return post-clear
// (i.e. with it simply absent) — deriveUnitProgress() itself needs no
// awareness that anything was ever cleared; it only ever sees
// whatever list it's handed.
test('deriveUnitProgress: a Lesson no longer counts toward a Unit\'s progression once its curriculumUnitId has been cleared (simulated as its own absence from lessonsForUnit, matching what getLessonsForUnit()\'s live query would return post-clear)', () => {
  const { classroom, unit, evaporation, condensation } = classroomWithSyllabus();
  learningRecordTeacherService.setConceptTaughtStatus(classroom, evaporation.id, 'taught');
  learningRecordTeacherService.setConceptTaughtStatus(classroom, condensation.id, 'taught');

  const clearedLesson = createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-04', executedConceptIds: [condensation.id] });
  const remainingLesson = createLesson({ classroomId: classroom.id, curriculumUnitId: unit.id, date: '2026-09-02', executedConceptIds: [evaporation.id] });

  const before = timetableDisplayService.deriveUnitProgress(unit, [remainingLesson, clearedLesson]);
  assert.equal(before.isCompleted, true);
  assert.equal(before.periodsCount, 2);
  assert.equal(before.completedDate, '2026-09-04');

  // "After": clearedLesson's own curriculumUnitId is now null, so
  // getLessonsForUnit(classroomId, unit.id) would no longer include
  // it at all.
  const after = timetableDisplayService.deriveUnitProgress(unit, [remainingLesson]);
  assert.equal(after.periodsCount, 1);
  assert.equal(after.startDate, '2026-09-02');
  // LearningConcept.status itself is untouched by clearing a Lesson's
  // own unit assignment (it's a separate, classroom-wide field), so
  // `isCompleted` stays true either way — but condensation was only
  // ever executed on the now-cleared Lesson, so from this Unit's
  // remaining Lesson history alone its first-executed date can no
  // longer be traced at all. completedDate honestly becomes null
  // rather than silently keeping the old, no-longer-supported Sep 4.
  assert.equal(after.isCompleted, true);
  assert.equal(after.completedDate, null);
});

test('summarizeUnitProgressForRange: a Unit that started in an earlier month still counts as completed in the range containing its actual completedDate', () => {
  const unitA = { unitId: 'u-a', unitTitle: 'Water Cycle', startDate: '2026-08-28', lastTaughtLessonDate: '2026-09-08', periodsCount: 5, isCompleted: true, completedDate: '2026-09-08' };
  const summary = timetableDisplayService.summarizeUnitProgressForRange([unitA], [], { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(summary.completedInRange, [unitA]);
});

test('summarizeUnitProgressForRange: an in-progress Unit counts only when it actually has a Lesson inside the range', () => {
  const unitInProgress = { unitId: 'u-b', unitTitle: 'Photosynthesis', startDate: '2026-09-20', lastTaughtLessonDate: '2026-09-25', periodsCount: 2, isCompleted: false, completedDate: null };
  const monthLessons = [{ curriculumUnitId: 'u-b', date: '2026-09-25' }];
  const summary = timetableDisplayService.summarizeUnitProgressForRange([unitInProgress], monthLessons, { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(summary.inProgressInRange, [unitInProgress]);
  assert.equal(summary.teachingPeriodsInRange, 1);
});

test('summarizeUnitProgressForRange: a completed Unit whose exact completedDate is unknown is excluded from BOTH completedInRange and inProgressInRange — it genuinely isn\'t "in progress", but attributing it to this month would claim precision the data doesn\'t have', () => {
  const unitUnknownDate = { unitId: 'u-c', unitTitle: 'Untraceable Unit', startDate: '2026-09-01', lastTaughtLessonDate: '2026-09-05', periodsCount: 3, isCompleted: true, completedDate: null };
  const monthLessons = [{ curriculumUnitId: 'u-c', date: '2026-09-05' }];
  const summary = timetableDisplayService.summarizeUnitProgressForRange([unitUnknownDate], monthLessons, { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(summary.completedInRange, []);
  assert.deepEqual(summary.inProgressInRange, []);
});

test('summarizeUnitProgressForRange: average periods-per-unit is computed only over Units completed within the range, never over in-progress ones', () => {
  const completedShort = { unitId: 'u-1', isCompleted: true, completedDate: '2026-09-05', periodsCount: 4 };
  const completedLong = { unitId: 'u-2', isCompleted: true, completedDate: '2026-09-20', periodsCount: 6 };
  const stillInProgress = { unitId: 'u-3', isCompleted: false, completedDate: null, periodsCount: 100 };
  const summary = timetableDisplayService.summarizeUnitProgressForRange(
    [completedShort, completedLong, stillInProgress],
    [{ curriculumUnitId: 'u-3', date: '2026-09-28' }],
    { start: '2026-09-01', end: '2026-09-30' }
  );
  assert.equal(summary.averagePeriodsPerCompletedUnit, 5);
});

test('summarizeUnitProgressForRange: null (never 0 or NaN) average when nothing completed in the range, so the caller can omit the line entirely', () => {
  const summary = timetableDisplayService.summarizeUnitProgressForRange([], [], { start: '2026-09-01', end: '2026-09-30' });
  assert.equal(summary.averagePeriodsPerCompletedUnit, null);
});

// ---------------------------------------------------------------------
// computeUnitWeekSegment / assignUnitLanes — the integrated Calendar's
// Unit-strip positioning math. `week` fixtures below match the exact
// shape ui/views/TimetableView.js's own buildCalendarWeeks() produces:
// 7 entries, a real "YYYY-MM-DD" dateKey or `null` for a leading/
// trailing blank slot outside the month.
// ---------------------------------------------------------------------

test('computeUnitWeekSegment: a Unit fully inside one week gets that week\'s own real start/end columns, no continuation either side', () => {
  const week = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  const unit = { startDate: '2026-09-07', lastTaughtLessonDate: '2026-09-09', completedDate: '2026-09-09', isCompleted: true };
  const segment = timetableDisplayService.computeUnitWeekSegment(unit, week);
  assert.deepEqual(segment, { startColumn: 1, endColumn: 3, continuesBefore: false, continuesAfter: false });
});

test('computeUnitWeekSegment: a Unit that started in an earlier week gets continuesBefore: true, clipped to this week\'s own first real day', () => {
  const week = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  const unit = { startDate: '2026-08-28', lastTaughtLessonDate: '2026-09-08', completedDate: '2026-09-08', isCompleted: true };
  const segment = timetableDisplayService.computeUnitWeekSegment(unit, week);
  assert.equal(segment.startColumn, 0); // week's own first column, never a false "started here"
  assert.equal(segment.continuesBefore, true);
});

test('computeUnitWeekSegment: an in-progress Unit gets continuesAfter: true even when its own last-taught date IS this week\'s last real day — the future is still genuinely open', () => {
  const week = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  const unit = { startDate: '2026-09-09', lastTaughtLessonDate: '2026-09-12', completedDate: null, isCompleted: false };
  const segment = timetableDisplayService.computeUnitWeekSegment(unit, week);
  assert.equal(segment.endColumn, 6);
  assert.equal(segment.continuesAfter, true);
});

test('computeUnitWeekSegment: a completed Unit whose completedDate IS this week\'s last real day gets continuesAfter: false — it genuinely ends here', () => {
  const week = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  const unit = { startDate: '2026-09-09', lastTaughtLessonDate: '2026-09-12', completedDate: '2026-09-12', isCompleted: true };
  const segment = timetableDisplayService.computeUnitWeekSegment(unit, week);
  assert.equal(segment.continuesAfter, false);
});

test('computeUnitWeekSegment: null when the Unit has no overlap with this week at all', () => {
  const week = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  const unit = { startDate: '2026-09-20', lastTaughtLessonDate: '2026-09-22', completedDate: '2026-09-22', isCompleted: true };
  assert.equal(timetableDisplayService.computeUnitWeekSegment(unit, week), null);
});

test('computeUnitWeekSegment: column indexes account for leading blank slots — a month\'s opening week, not a plain weekday number', () => {
  // September 2026 starts on a Tuesday: two leading blanks (Sun, Mon).
  const week = [null, null, '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
  const unit = { startDate: '2026-09-02', lastTaughtLessonDate: '2026-09-03', completedDate: '2026-09-03', isCompleted: true };
  const segment = timetableDisplayService.computeUnitWeekSegment(unit, week);
  assert.equal(segment.startColumn, 3); // index of '2026-09-02' in the array, not weekday()
  assert.equal(segment.endColumn, 4);
});

test('assignUnitLanes: two sequential, non-overlapping Units share lane 0', () => {
  const unitA = { unitId: 'a', startDate: '2026-09-01', lastTaughtLessonDate: '2026-09-05', completedDate: '2026-09-05', isCompleted: true };
  const unitB = { unitId: 'b', startDate: '2026-09-06', lastTaughtLessonDate: '2026-09-10', completedDate: '2026-09-10', isCompleted: true };
  const lanes = timetableDisplayService.assignUnitLanes([unitA, unitB], { start: '2026-09-01', end: '2026-09-30' });
  assert.equal(lanes.get('a'), 0);
  assert.equal(lanes.get('b'), 0);
});

test('assignUnitLanes: two overlapping Units (the data model genuinely permits interleaved Units) get different lanes', () => {
  const unitA = { unitId: 'a', startDate: '2026-09-01', lastTaughtLessonDate: '2026-09-10', completedDate: null, isCompleted: false };
  const unitB = { unitId: 'b', startDate: '2026-09-05', lastTaughtLessonDate: '2026-09-15', completedDate: null, isCompleted: false };
  const lanes = timetableDisplayService.assignUnitLanes([unitA, unitB], { start: '2026-09-01', end: '2026-09-30' });
  assert.notEqual(lanes.get('a'), lanes.get('b'));
});

test('assignUnitLanes: deterministic regardless of input order — the same overlap set produces the same lane assignment either way', () => {
  const unitA = { unitId: 'a', startDate: '2026-09-01', lastTaughtLessonDate: '2026-09-10', completedDate: null, isCompleted: false };
  const unitB = { unitId: 'b', startDate: '2026-09-05', lastTaughtLessonDate: '2026-09-15', completedDate: null, isCompleted: false };
  const forward = timetableDisplayService.assignUnitLanes([unitA, unitB], { start: '2026-09-01', end: '2026-09-30' });
  const reversed = timetableDisplayService.assignUnitLanes([unitB, unitA], { start: '2026-09-01', end: '2026-09-30' });
  assert.equal(forward.get('a'), reversed.get('a'));
  assert.equal(forward.get('b'), reversed.get('b'));
});

test('assignUnitLanes: a Unit that started before the visible month is clipped to range.start for overlap purposes, same as the Calendar itself only ever shows', () => {
  const unitStartedInAugust = { unitId: 'a', startDate: '2026-08-05', lastTaughtLessonDate: '2026-09-03', completedDate: '2026-09-03', isCompleted: true };
  const unitEarlySeptember = { unitId: 'b', startDate: '2026-09-01', lastTaughtLessonDate: '2026-09-02', completedDate: '2026-09-02', isCompleted: true };
  const lanes = timetableDisplayService.assignUnitLanes([unitStartedInAugust, unitEarlySeptember], { start: '2026-09-01', end: '2026-09-30' });
  // Both effectively occupy the start of September once clipped — they
  // genuinely overlap within the visible range, so they must land on
  // different lanes even though unitStartedInAugust's own real
  // (unclipped) start predates unitEarlySeptember's by weeks.
  assert.notEqual(lanes.get('a'), lanes.get('b'));
});
