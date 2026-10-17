import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createLearningSubject } from '../../js/models/LearningSubject.js';
import { createLearningUnit } from '../../js/models/LearningUnit.js';
import { createLearningConcept } from '../../js/models/LearningConcept.js';
import {
  getUnitsForSubject,
  getConceptsForUnit,
  inferInitialUnitId,
  createAssignmentConceptLinkState,
} from '../../js/ui/views/AssignmentConceptLinkingDisplay.js';

// -----------------------------------------------------------------------
// Fixture: Social Science (two units) + Mathematics (zero units) + a
// third subject with one unit but zero concepts — covers every "empty"
// shape the form needs to handle gracefully.
// -----------------------------------------------------------------------

function buildClassroom() {
  const peoplesRevolt = createLearningConcept({ id: 'c-revolt', title: "People's Revolt" });
  const palayamsOrigins = createLearningConcept({ id: 'c-origins', title: 'Origins of Palayams' });
  const palayamsHierarchy = createLearningConcept({ id: 'c-hierarchy', title: 'Palayams Hierarchy Structure' });
  const riverSystems = createLearningConcept({ id: 'c-rivers', title: 'River Systems' });

  const unitPalayams = createLearningUnit({ id: 'u-palayams', title: 'Palayams', concepts: [palayamsOrigins, palayamsHierarchy] });
  const unitRevolt = createLearningUnit({ id: 'u-revolt', title: "1857 Revolt", concepts: [peoplesRevolt] });
  const unitGeography = createLearningUnit({ id: 'u-geo', title: 'Physical Geography', concepts: [riverSystems] });
  const unitEmpty = createLearningUnit({ id: 'u-empty', title: 'Unit With No Concepts Yet', concepts: [] });

  const socialScience = createLearningSubject({ id: 'subj-ss', title: 'Social Science', units: [unitPalayams, unitRevolt, unitGeography, unitEmpty] });
  const mathematics = createLearningSubject({ id: 'subj-math', title: 'Mathematics', units: [] });

  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'G1' });
  classroom.learningRecord.subjects.push(socialScience, mathematics);
  return classroom;
}

// =========================================================================
// 1. Units filtered by selected subject
// =========================================================================

test('getUnitsForSubject: returns only the selected subject\'s own units', () => {
  const classroom = buildClassroom();
  const units = getUnitsForSubject(classroom, 'subj-ss');
  assert.deepEqual(units.map((u) => u.id).sort(), ['u-empty', 'u-geo', 'u-palayams', 'u-revolt']);
});

test('getUnitsForSubject: null/missing subjectId returns []', () => {
  const classroom = buildClassroom();
  assert.deepEqual(getUnitsForSubject(classroom, null), []);
  assert.deepEqual(getUnitsForSubject(classroom, undefined), []);
});

test('getUnitsForSubject: an unknown subjectId returns [] rather than throwing', () => {
  const classroom = buildClassroom();
  assert.deepEqual(getUnitsForSubject(classroom, 'does-not-exist'), []);
});

test('getUnitsForSubject: a subject with zero units (Mathematics) returns []', () => {
  const classroom = buildClassroom();
  assert.deepEqual(getUnitsForSubject(classroom, 'subj-math'), []);
});

// =========================================================================
// 2. Concepts filtered by selected unit
// =========================================================================

test('getConceptsForUnit: returns only the selected unit\'s own concepts, never a sibling unit\'s', () => {
  const classroom = buildClassroom();
  const concepts = getConceptsForUnit(classroom, 'subj-ss', 'u-palayams');
  assert.deepEqual(concepts.map((c) => c.id).sort(), ['c-hierarchy', 'c-origins']);
  // specifically: "1857 Revolt"'s own concept must never leak in
  assert.ok(!concepts.some((c) => c.id === 'c-revolt'));
});

test('getConceptsForUnit: no unit selected returns []', () => {
  const classroom = buildClassroom();
  assert.deepEqual(getConceptsForUnit(classroom, 'subj-ss', null), []);
});

test('getConceptsForUnit: a unit with zero concepts returns [] (empty-state case)', () => {
  const classroom = buildClassroom();
  assert.deepEqual(getConceptsForUnit(classroom, 'subj-ss', 'u-empty'), []);
});

// =========================================================================
// 5/7. inferInitialUnitId — editing/legacy reconstruction
// =========================================================================

test('inferInitialUnitId: a single resolvable unit across every linked concept is returned', () => {
  const classroom = buildClassroom();
  assert.equal(inferInitialUnitId(classroom, ['c-origins', 'c-hierarchy']), 'u-palayams');
});

test('inferInitialUnitId: concepts spanning two different units (legacy data) -> null, never a guess', () => {
  const classroom = buildClassroom();
  assert.equal(inferInitialUnitId(classroom, ['c-origins', 'c-revolt']), null);
});

test('inferInitialUnitId: empty conceptIds -> null', () => {
  const classroom = buildClassroom();
  assert.equal(inferInitialUnitId(classroom, []), null);
  assert.equal(inferInitialUnitId(classroom, undefined), null);
});

test('inferInitialUnitId: a conceptId that no longer resolves (deleted concept) is skipped, not fatal', () => {
  const classroom = buildClassroom();
  assert.equal(inferInitialUnitId(classroom, ['c-origins', 'deleted-concept-id']), 'u-palayams');
});

// =========================================================================
// 3/4. Cascading state machine — subject/unit change clears invalid selections
// =========================================================================

test('createAssignmentConceptLinkState: a brand-new assignment starts with no subject/unit/concepts', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom);
  assert.equal(state.getSubjectId(), null);
  assert.equal(state.getUnitId(), null);
  assert.deepEqual(state.getSelectedConceptIds(), []);
  assert.deepEqual(state.getUnits(), []);
  assert.deepEqual(state.getConcepts(), []);
});

test('createAssignmentConceptLinkState: editing an existing assignment preselects its resolvable unit and preserves its concepts', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss', conceptIds: ['c-origins'] });
  assert.equal(state.getUnitId(), 'u-palayams');
  assert.deepEqual(state.getSelectedConceptIds(), ['c-origins']);
  assert.ok(state.isConceptSelected('c-origins'));
  assert.ok(!state.isConceptSelected('c-hierarchy'));
});

test('createAssignmentConceptLinkState: toggling a concept on/off updates selection', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss' });
  state.setUnitId('u-palayams');
  state.toggleConcept('c-origins', true);
  state.toggleConcept('c-hierarchy', true);
  assert.deepEqual(state.getSelectedConceptIds().sort(), ['c-hierarchy', 'c-origins']);
  state.toggleConcept('c-origins', false);
  assert.deepEqual(state.getSelectedConceptIds(), ['c-hierarchy']);
});

test('setSubjectId: changing subject clears the current unit and every concept selection', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss', conceptIds: ['c-origins'] });
  assert.equal(state.getUnitId(), 'u-palayams'); // sanity: preselected before the change

  state.setSubjectId('subj-math');
  assert.equal(state.getSubjectId(), 'subj-math');
  assert.equal(state.getUnitId(), null);
  assert.deepEqual(state.getSelectedConceptIds(), []);
  assert.deepEqual(state.getUnits(), []); // Mathematics has no units
});

test('setSubjectId: clearing the subject back to none also clears unit/concepts', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss', conceptIds: ['c-origins'] });
  state.setSubjectId(null);
  assert.equal(state.getSubjectId(), null);
  assert.equal(state.getUnitId(), null);
  assert.deepEqual(state.getSelectedConceptIds(), []);
});

test('setUnitId: switching to a sibling unit drops concept selections that belonged only to the old unit', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss' });
  state.setUnitId('u-palayams');
  state.toggleConcept('c-origins', true);
  state.toggleConcept('c-hierarchy', true);

  state.setUnitId('u-revolt');
  assert.equal(state.getUnitId(), 'u-revolt');
  assert.deepEqual(state.getSelectedConceptIds(), []); // neither Palayams concept belongs to 1857 Revolt
  assert.deepEqual(state.getConcepts().map((c) => c.id), ['c-revolt']);
});

test('setUnitId: unsetting the unit entirely (back to "select a unit") clears every concept selection', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss' });
  state.setUnitId('u-palayams');
  state.toggleConcept('c-origins', true);
  state.setUnitId(null);
  assert.equal(state.getUnitId(), null);
  assert.deepEqual(state.getSelectedConceptIds(), []);
});

// =========================================================================
// 6. Subjects/units with no available options
// =========================================================================

test('a subject with zero units never crashes the state machine, just yields empty units/concepts', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-math' });
  assert.deepEqual(state.getUnits(), []);
  assert.deepEqual(state.getConcepts(), []);
});

test('a unit with zero concepts never crashes the state machine, just yields an empty concept list', () => {
  const classroom = buildClassroom();
  const state = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss' });
  state.setUnitId('u-empty');
  assert.deepEqual(state.getConcepts(), []);
});

// =========================================================================
// 8. Persistence/reload round-trip
// =========================================================================

test('round-trip: concepts saved from one unit reload into the same inferred unit on a fresh state', () => {
  const classroom = buildClassroom();
  const createState = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss' });
  createState.setUnitId('u-palayams');
  createState.toggleConcept('c-origins', true);
  createState.toggleConcept('c-hierarchy', true);
  const savedConceptIds = createState.getSelectedConceptIds();

  // Simulate a reload: a brand-new state constructed from exactly what was persisted.
  const reloadedState = createAssignmentConceptLinkState(classroom, { subjectId: 'subj-ss', conceptIds: savedConceptIds });
  assert.equal(reloadedState.getUnitId(), 'u-palayams');
  assert.deepEqual(reloadedState.getSelectedConceptIds().sort(), savedConceptIds.sort());
});
