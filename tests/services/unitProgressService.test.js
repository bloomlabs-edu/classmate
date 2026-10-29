/**
 * tests/services/unitProgressService.test.js
 *
 * services/unitProgressService.js — "assigned vs. completed units"
 * (e.g. "8/12 units"), derived entirely from the existing
 * classroom.learningRecord.subjects[].units[] source of truth and
 * services/timetableDisplayService.js's own pre-existing
 * isUnitTaughtComplete() rule. Explicitly a CLASSROOM-WIDE number
 * (confirmed design decision, 2026-10-29) — these tests verify the
 * computation itself, not per-student personalization, which does not
 * exist in the underlying data.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningSubject } from '../../js/models/LearningSubject.js';
import { createLearningUnit } from '../../js/models/LearningUnit.js';
import { createLearningConcept } from '../../js/models/LearningConcept.js';
import * as unitProgressService from '../../js/services/unitProgressService.js';

function taughtConcept(id) {
  return createLearningConcept({ id, title: id, status: 'taught' });
}
function untaughtConcept(id) {
  return createLearningConcept({ id, title: id, status: 'not_taught' });
}

test('getUnitProgressForSubject: a subject with no units at all is 0/0 — a real, valid state, not an error', () => {
  const subject = createLearningSubject({ id: 'sub1', title: 'Science', units: [] });
  const classroom = { learningRecord: { subjects: [subject] } };
  assert.deepEqual(unitProgressService.getUnitProgressForSubject(classroom, 'sub1'), { assignedUnits: 0, completedUnits: 0 });
});

test('getUnitProgressForSubject: PARTIALLY completed — some units fully taught, some not, some mixed', () => {
  const fullyTaught = createLearningUnit({ id: 'u1', title: 'Unit 1', concepts: [taughtConcept('c1'), taughtConcept('c2')] });
  const mixed = createLearningUnit({ id: 'u2', title: 'Unit 2', concepts: [taughtConcept('c3'), untaughtConcept('c4')] });
  const notStarted = createLearningUnit({ id: 'u3', title: 'Unit 3', concepts: [untaughtConcept('c5')] });
  const subject = createLearningSubject({ id: 'sub1', title: 'Science', units: [fullyTaught, mixed, notStarted] });
  const classroom = { learningRecord: { subjects: [subject] } };

  const progress = unitProgressService.getUnitProgressForSubject(classroom, 'sub1');
  assert.deepEqual(progress, { assignedUnits: 3, completedUnits: 1 }); // only fullyTaught counts
});

test('getUnitProgressForSubject: FULLY completed — every unit is complete', () => {
  const u1 = createLearningUnit({ id: 'u1', title: 'Unit 1', concepts: [taughtConcept('c1')] });
  const u2 = createLearningUnit({ id: 'u2', title: 'Unit 2', concepts: [taughtConcept('c2'), taughtConcept('c3')] });
  const subject = createLearningSubject({ id: 'sub1', title: 'Science', units: [u1, u2] });
  const classroom = { learningRecord: { subjects: [subject] } };

  assert.deepEqual(unitProgressService.getUnitProgressForSubject(classroom, 'sub1'), { assignedUnits: 2, completedUnits: 2 });
});

test('getUnitProgressForSubject: a unit with ZERO concepts is never counted as complete (no vacuous truth)', () => {
  const emptyUnit = createLearningUnit({ id: 'u1', title: 'Empty Unit', concepts: [] });
  const subject = createLearningSubject({ id: 'sub1', title: 'Science', units: [emptyUnit] });
  const classroom = { learningRecord: { subjects: [subject] } };

  assert.deepEqual(unitProgressService.getUnitProgressForSubject(classroom, 'sub1'), { assignedUnits: 1, completedUnits: 0 });
});

test('getUnitProgressForSubject: an unknown subjectId resolves to 0/0, never throws', () => {
  const classroom = { learningRecord: { subjects: [] } };
  assert.deepEqual(unitProgressService.getUnitProgressForSubject(classroom, 'does-not-exist'), { assignedUnits: 0, completedUnits: 0 });
});

test('getUnitProgressForSubject: a classroom with no learningRecord at all resolves to 0/0, never throws', () => {
  assert.deepEqual(unitProgressService.getUnitProgressForSubject({}, 'sub1'), { assignedUnits: 0, completedUnits: 0 });
});

// ---------------------------------------------------------------------
// Classroom-wide total — sums across Subjects without double-counting
// ---------------------------------------------------------------------

test('getUnitProgressForClassroom: sums assigned/completed across MULTIPLE subjects (e.g. two different textbooks), never double-counting', () => {
  const scienceUnits = [
    createLearningUnit({ id: 'u1', title: 'U1', concepts: [taughtConcept('c1')] }),
    createLearningUnit({ id: 'u2', title: 'U2', concepts: [untaughtConcept('c2')] }),
  ];
  const mathUnits = [
    createLearningUnit({ id: 'u3', title: 'U3', concepts: [taughtConcept('c3')] }),
    createLearningUnit({ id: 'u4', title: 'U4', concepts: [taughtConcept('c4')] }),
    createLearningUnit({ id: 'u5', title: 'U5', concepts: [untaughtConcept('c5')] }),
  ];
  const classroom = {
    learningRecord: {
      subjects: [
        createLearningSubject({ id: 'sub-sci', title: 'Science', units: scienceUnits }),
        createLearningSubject({ id: 'sub-math', title: 'Math', units: mathUnits }),
      ],
    },
  };

  assert.deepEqual(unitProgressService.getUnitProgressForClassroom(classroom), { assignedUnits: 5, completedUnits: 3 });
});

test('getUnitProgressForClassroom: a classroom with zero subjects/units is 0/0', () => {
  assert.deepEqual(unitProgressService.getUnitProgressForClassroom({ learningRecord: { subjects: [] } }), { assignedUnits: 0, completedUnits: 0 });
});

// ---------------------------------------------------------------------
// Recalculation when assignments/completion change — no manual counter
// to go stale, since every read is a live derivation.
// ---------------------------------------------------------------------

test('recalculates live when a curriculum is REASSIGNED to a subject (subject.units replaced wholesale, matching curriculumLinkingService.js\'s own convention) — old units never linger, no double-counting across the old and new assignment', () => {
  const subject = createLearningSubject({
    id: 'sub1',
    title: 'Science',
    units: [createLearningUnit({ id: 'old-u1', title: 'Old Unit', concepts: [taughtConcept('old-c1')] })],
  });
  const classroom = { learningRecord: { subjects: [subject] } };
  assert.deepEqual(unitProgressService.getUnitProgressForSubject(classroom, 'sub1'), { assignedUnits: 1, completedUnits: 1 });

  // Simulate curriculumLinkingService.js's own assignCurriculumToSubject():
  // a wholesale replacement of subject.units, never an append.
  subject.units = [
    createLearningUnit({ id: 'new-u1', title: 'New Unit 1', concepts: [untaughtConcept('new-c1')] }),
    createLearningUnit({ id: 'new-u2', title: 'New Unit 2', concepts: [untaughtConcept('new-c2')] }),
  ];

  const afterReassignment = unitProgressService.getUnitProgressForSubject(classroom, 'sub1');
  assert.deepEqual(afterReassignment, { assignedUnits: 2, completedUnits: 0 }); // the old unit is gone entirely, not still counted
});

test('recalculates live when a concept\'s taught status changes — no caching, no stale read', () => {
  const concept = untaughtConcept('c1');
  const unit = createLearningUnit({ id: 'u1', title: 'Unit 1', concepts: [concept] });
  const subject = createLearningSubject({ id: 'sub1', title: 'Science', units: [unit] });
  const classroom = { learningRecord: { subjects: [subject] } };

  assert.equal(unitProgressService.getUnitProgressForSubject(classroom, 'sub1').completedUnits, 0);

  concept.status = 'taught'; // the same in-place mutation learningRecordTeacherService.js's own setConceptTaughtStatus() performs
  assert.equal(unitProgressService.getUnitProgressForSubject(classroom, 'sub1').completedUnits, 1);
});

// ---------------------------------------------------------------------
// Formatting + percent — zero-assigned handled cleanly, no division errors
// ---------------------------------------------------------------------

test('formatUnitProgress: zero assigned units reads as an honest "No units assigned yet," never "0/0 units"', () => {
  assert.equal(unitProgressService.formatUnitProgress({ completedUnits: 0, assignedUnits: 0 }), 'No units assigned yet');
});

test('formatUnitProgress: a real ratio formats as "completed/assigned units"', () => {
  assert.equal(unitProgressService.formatUnitProgress({ completedUnits: 8, assignedUnits: 12 }), '8/12 units');
});

test('getUnitProgressPercent: zero assigned units is 0%, never NaN/Infinity', () => {
  const percent = unitProgressService.getUnitProgressPercent({ completedUnits: 0, assignedUnits: 0 });
  assert.equal(percent, 0);
  assert.equal(Number.isFinite(percent), true);
});

test('getUnitProgressPercent: a real ratio rounds to the nearest whole percent', () => {
  assert.equal(unitProgressService.getUnitProgressPercent({ completedUnits: 1, assignedUnits: 3 }), 33);
  assert.equal(unitProgressService.getUnitProgressPercent({ completedUnits: 12, assignedUnits: 12 }), 100);
});
