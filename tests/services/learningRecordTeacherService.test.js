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
  renameSubject,
  renameUnit,
  createSubject,
  createUnit,
  deleteSubject,
  deleteUnit,
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
// renameSubject / renameUnit — Learning Management's own "Edit" affordance
// on the Subject heading and a selected Unit's own heading. Both simply
// overwrite `title` in place (see learningRecordTeacherService.js's own
// implementation) — these tests pin down that nothing else on the
// record is ever touched by that in-place write.
// ---------------------------------------------------------------------

function makeClassroomWithFullSubject() {
  const concept = createLearningConcept({ id: 'concept-1', title: 'Forces' });
  const unit = createLearningUnit({
    id: 'unit-1',
    title: 'Forces & Pressure',
    concepts: [concept],
    partName: 'Part A',
    linkedCurriculumUnitId: 'curriculum-unit-42',
    number: 3,
    learningHubPack: { packId: 'pack-1', title: 'Forces Pack' },
  });
  const otherUnit = createLearningUnit({ id: 'unit-2', title: 'Energy', concepts: [] });
  const subject = createLearningSubject({
    id: 'subject-1',
    subjectId: 'science',
    title: 'Science',
    units: [unit, otherUnit],
    linkedCurriculumIndexId: 'curriculum-index-9',
  });
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  classroom.learningRecord = { subjects: [subject] };
  return { classroom, subject, unit, otherUnit, concept };
}

test('renameSubject: changes the title, returns the same subject object, and leaves id/subjectId/linkedCurriculumIndexId/units completely untouched', () => {
  const { classroom, subject, unit, otherUnit } = makeClassroomWithFullSubject();
  const result = renameSubject(classroom, 'subject-1', 'Physical Science');

  assert.equal(result, subject);
  assert.equal(subject.title, 'Physical Science');
  assert.equal(subject.id, 'subject-1');
  assert.equal(subject.subjectId, 'science');
  assert.equal(subject.linkedCurriculumIndexId, 'curriculum-index-9');
  // The units array itself, and every unit inside it (id, concepts,
  // and every other field), is the exact same untouched data.
  assert.equal(subject.units.length, 2);
  assert.equal(subject.units[0], unit);
  assert.equal(subject.units[1], otherUnit);
  assert.equal(unit.id, 'unit-1');
  assert.equal(unit.title, 'Forces & Pressure');
  assert.equal(unit.concepts.length, 1);
  assert.equal(unit.concepts[0].id, 'concept-1');
  assert.equal(unit.linkedCurriculumUnitId, 'curriculum-unit-42');
  assert.equal(unit.number, 3);
  assert.equal(unit.partName, 'Part A');
  assert.deepEqual(unit.learningHubPack, { packId: 'pack-1', title: 'Forces Pack' });
});

test('renameSubject: an unknown subjectId returns null, does not throw, and does not mutate any existing subject', () => {
  const { classroom, subject } = makeClassroomWithFullSubject();
  const result = renameSubject(classroom, 'does-not-exist', 'New Title');
  assert.equal(result, null);
  assert.equal(subject.title, 'Science');
});

test('renameUnit: changes the title, returns the same unit object, and leaves id/concepts/linkedCurriculumUnitId/number/partName/learningHubPack untouched', () => {
  const { classroom, subject, unit, otherUnit, concept } = makeClassroomWithFullSubject();
  const result = renameUnit(classroom, 'unit-1', 'Forces & Motion');

  assert.equal(result, unit);
  assert.equal(unit.title, 'Forces & Motion');
  assert.equal(unit.id, 'unit-1');
  // Still found in the exact same subject's units array, at the same
  // position, alongside the untouched sibling unit.
  assert.equal(subject.units[0], unit);
  assert.equal(subject.units[1], otherUnit);
  assert.equal(subject.units.length, 2);
  // The unit's own concepts array, and the concept inside it, are
  // untouched.
  assert.equal(unit.concepts.length, 1);
  assert.equal(unit.concepts[0], concept);
  assert.equal(concept.title, 'Forces');
  // Curriculum-link/grouping/shortcut fields untouched.
  assert.equal(unit.linkedCurriculumUnitId, 'curriculum-unit-42');
  assert.equal(unit.number, 3);
  assert.equal(unit.partName, 'Part A');
  assert.deepEqual(unit.learningHubPack, { packId: 'pack-1', title: 'Forces Pack' });
});

test('renameUnit: an unknown unitId returns null, does not throw, and does not mutate any existing unit', () => {
  const { classroom, unit } = makeClassroomWithFullSubject();
  const result = renameUnit(classroom, 'does-not-exist', 'New Title');
  assert.equal(result, null);
  assert.equal(unit.title, 'Forces & Pressure');
});

// ---------------------------------------------------------------------
// Confirming create/delete still work exactly as before — unchanged by
// this work (no code in createSubject/createUnit/deleteSubject/deleteUnit
// was touched), added here only because none of these four had explicit
// test coverage of their own yet.
// ---------------------------------------------------------------------

test('createSubject: adds a new subject to the classroom’s learningRecord', () => {
  const classroom = createClassroom({ id: 'classroom-2', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  const subject = createSubject(classroom, { title: 'Mathematics' });
  assert.equal(classroom.learningRecord.subjects.length, 1);
  assert.equal(classroom.learningRecord.subjects[0], subject);
  assert.equal(subject.title, 'Mathematics');
});

test('createUnit: adds a new unit to the named subject’s units array', () => {
  const { classroom, subject } = makeClassroomWithFullSubject();
  const newUnit = createUnit(classroom, 'subject-1', { title: 'Light' });
  assert.equal(subject.units.length, 3);
  assert.equal(subject.units[2], newUnit);
  assert.equal(newUnit.title, 'Light');
});

test('createUnit: an unknown subjectId returns null and does not throw', () => {
  const { classroom } = makeClassroomWithFullSubject();
  const result = createUnit(classroom, 'does-not-exist', { title: 'Light' });
  assert.equal(result, null);
});

test('deleteSubject: removes exactly the named subject and returns true', () => {
  const { classroom } = makeClassroomWithFullSubject();
  const removed = deleteSubject(classroom, 'subject-1');
  assert.equal(removed, true);
  assert.equal(classroom.learningRecord.subjects.length, 0);
});

test('deleteSubject: an unknown subjectId returns false and leaves existing subjects untouched', () => {
  const { classroom, subject } = makeClassroomWithFullSubject();
  const removed = deleteSubject(classroom, 'does-not-exist');
  assert.equal(removed, false);
  assert.equal(classroom.learningRecord.subjects.length, 1);
  assert.equal(classroom.learningRecord.subjects[0], subject);
});

test('deleteUnit: removes exactly the named unit from its subject and returns true', () => {
  const { classroom, subject, otherUnit } = makeClassroomWithFullSubject();
  const removed = deleteUnit(classroom, 'subject-1', 'unit-1');
  assert.equal(removed, true);
  assert.equal(subject.units.length, 1);
  assert.equal(subject.units[0], otherUnit);
});

test('deleteUnit: an unknown unitId returns false and leaves existing units untouched', () => {
  const { classroom, subject } = makeClassroomWithFullSubject();
  const removed = deleteUnit(classroom, 'subject-1', 'does-not-exist');
  assert.equal(removed, false);
  assert.equal(subject.units.length, 2);
});
