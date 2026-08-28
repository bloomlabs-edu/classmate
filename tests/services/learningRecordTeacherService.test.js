import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createLearningSubject } from '../../js/models/LearningSubject.js';
import { createLearningUnit } from '../../js/models/LearningUnit.js';
import { createLearningConcept } from '../../js/models/LearningConcept.js';
import { setConceptDescription } from '../../js/services/learningRecordTeacherService.js';

function makeClassroomWithConcept() {
  const concept = createLearningConcept({ id: 'concept-1', title: 'Forces' });
  const unit = createLearningUnit({ id: 'unit-1', title: 'Forces & Pressure', concepts: [concept] });
  const subject = createLearningSubject({ id: 'subject-1', title: 'Science', units: [unit] });
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  classroom.learningRecord = { subjects: [subject] };
  return { classroom, concept };
}

test('setConceptDescription: sets a real description on the concept in place', () => {
  const { classroom, concept } = makeClassroomWithConcept();
  const result = setConceptDescription(classroom, 'concept-1', 'A force is a push or pull.');
  assert.equal(result, concept);
  assert.equal(concept.description, 'A force is a push or pull.');
});

test('setConceptDescription: trims surrounding whitespace', () => {
  const { classroom, concept } = makeClassroomWithConcept();
  setConceptDescription(classroom, 'concept-1', '  A force is a push or pull.  ');
  assert.equal(concept.description, 'A force is a push or pull.');
});

test('setConceptDescription: an empty or whitespace-only string normalizes to null, not a visually-empty string', () => {
  const { classroom, concept } = makeClassroomWithConcept();
  concept.description = 'previous text';
  setConceptDescription(classroom, 'concept-1', '   ');
  assert.equal(concept.description, null);
});

test('setConceptDescription: an unknown conceptId returns null and does not throw', () => {
  const { classroom } = makeClassroomWithConcept();
  const result = setConceptDescription(classroom, 'does-not-exist', 'text');
  assert.equal(result, null);
});
