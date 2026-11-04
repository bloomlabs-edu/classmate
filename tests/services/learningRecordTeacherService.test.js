import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createLearningSubject } from '../../js/models/LearningSubject.js';
import { createLearningUnit } from '../../js/models/LearningUnit.js';
import { createLearningConcept } from '../../js/models/LearningConcept.js';
import {
  setConceptDescription,
  setConceptTaughtStatus,
  renameConcept,
  setLearningHubConceptMapping,
  clearLearningHubConceptMapping,
} from '../../js/services/learningRecordTeacherService.js';

function makeClassroomWithConcept({ learningHubConcept = null } = {}) {
  const concept = createLearningConcept({ id: 'concept-1', title: 'Forces', learningHubConcept });
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

// ---------------------------------------------------------------------
// learningHubConcept mapping survives ordinary concept mutations — none
// of these functions reconstruct the concept object, they only ever set
// one named field in place, so a co-existing mapping is preserved by
// construction. These tests pin that down explicitly rather than
// leaving it as an unverified side effect.
// ---------------------------------------------------------------------

test('renameConcept: preserves an existing learningHubConcept mapping — the cached title inside it is untouched by renaming the concept itself', () => {
  const { classroom, concept } = makeClassroomWithConcept({ learningHubConcept: { conceptId: 'hub-concept-42', title: 'Forces and Motion' } });
  renameConcept(classroom, 'concept-1', 'Newtonian Forces');
  assert.equal(concept.title, 'Newtonian Forces');
  assert.deepEqual(concept.learningHubConcept, { conceptId: 'hub-concept-42', title: 'Forces and Motion' });
});

test('setConceptTaughtStatus: preserves an existing learningHubConcept mapping', () => {
  const { classroom, concept } = makeClassroomWithConcept({ learningHubConcept: { conceptId: 'hub-concept-42', title: 'Forces and Motion' } });
  setConceptTaughtStatus(classroom, 'concept-1', 'taught');
  assert.equal(concept.status, 'taught');
  assert.deepEqual(concept.learningHubConcept, { conceptId: 'hub-concept-42', title: 'Forces and Motion' });
});

test('setConceptDescription: preserves an existing learningHubConcept mapping', () => {
  const { classroom, concept } = makeClassroomWithConcept({ learningHubConcept: { conceptId: 'hub-concept-42', title: 'Forces and Motion' } });
  setConceptDescription(classroom, 'concept-1', 'A force is a push or pull.');
  assert.equal(concept.description, 'A force is a push or pull.');
  assert.deepEqual(concept.learningHubConcept, { conceptId: 'hub-concept-42', title: 'Forces and Motion' });
});

test('renameConcept/setConceptTaughtStatus/setConceptDescription: a concept with NO mapping (null) stays null through every mutation — never fabricated', () => {
  const { classroom, concept } = makeClassroomWithConcept();
  renameConcept(classroom, 'concept-1', 'Newtonian Forces');
  setConceptTaughtStatus(classroom, 'concept-1', 'taught');
  setConceptDescription(classroom, 'concept-1', 'A force is a push or pull.');
  assert.equal(concept.learningHubConcept, null);
});

// ---------------------------------------------------------------------
// setLearningHubConceptMapping / clearLearningHubConceptMapping — the
// Phase 2 picker's own save/remove actions. Same mutate-and-return,
// caller-saves convention as setConceptDescription() above: these never
// touch Firestore themselves, the caller (ConceptWorkspaceView.js)
// persists via workspaceService after a non-null return.
// ---------------------------------------------------------------------

test('setLearningHubConceptMapping: saves conceptId + title onto the concept and returns the concept', () => {
  const { classroom, concept } = makeClassroomWithConcept();
  const result = setLearningHubConceptMapping(classroom, 'concept-1', { conceptId: 'hub-weather', title: 'Weather' });
  assert.equal(result, concept);
  assert.deepEqual(concept.learningHubConcept, { conceptId: 'hub-weather', title: 'Weather' });
});

test('setLearningHubConceptMapping: overwrites a previous mapping (change flow), never merges fields from the old one', () => {
  const { classroom, concept } = makeClassroomWithConcept({ learningHubConcept: { conceptId: 'hub-old', title: 'Old Concept' } });
  setLearningHubConceptMapping(classroom, 'concept-1', { conceptId: 'hub-new', title: 'New Concept' });
  assert.deepEqual(concept.learningHubConcept, { conceptId: 'hub-new', title: 'New Concept' });
});

test('setLearningHubConceptMapping: a missing title falls back to the conceptId itself, never crashes or saves undefined', () => {
  const { classroom, concept } = makeClassroomWithConcept();
  setLearningHubConceptMapping(classroom, 'concept-1', { conceptId: 'hub-weather' });
  assert.deepEqual(concept.learningHubConcept, { conceptId: 'hub-weather', title: 'hub-weather' });
});

test('setLearningHubConceptMapping: an unknown conceptId returns null and does not throw', () => {
  const { classroom } = makeClassroomWithConcept();
  const result = setLearningHubConceptMapping(classroom, 'does-not-exist', { conceptId: 'hub-weather', title: 'Weather' });
  assert.equal(result, null);
});

test('setLearningHubConceptMapping: a null/empty mapping (Cancel with nothing selected) leaves the existing mapping untouched', () => {
  const { classroom, concept } = makeClassroomWithConcept({ learningHubConcept: { conceptId: 'hub-old', title: 'Old Concept' } });
  setLearningHubConceptMapping(classroom, 'concept-1', null);
  assert.deepEqual(concept.learningHubConcept, { conceptId: 'hub-old', title: 'Old Concept' });
});

test('clearLearningHubConceptMapping: removes the mapping, setting it back to null', () => {
  const { classroom, concept } = makeClassroomWithConcept({ learningHubConcept: { conceptId: 'hub-weather', title: 'Weather' } });
  const result = clearLearningHubConceptMapping(classroom, 'concept-1');
  assert.equal(result, concept);
  assert.equal(concept.learningHubConcept, null);
});

test('clearLearningHubConceptMapping: an unknown conceptId returns null and does not throw', () => {
  const { classroom } = makeClassroomWithConcept();
  assert.equal(clearLearningHubConceptMapping(classroom, 'does-not-exist'), null);
});

test('clearLearningHubConceptMapping: a concept that was never mapped stays null (idempotent, no crash)', () => {
  const { classroom, concept } = makeClassroomWithConcept();
  clearLearningHubConceptMapping(classroom, 'concept-1');
  assert.equal(concept.learningHubConcept, null);
});
