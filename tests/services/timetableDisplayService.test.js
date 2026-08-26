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
