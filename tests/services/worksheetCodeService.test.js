/**
 * tests/services/worksheetCodeService.test.js
 *
 * services/worksheetCodeService.js — automatic worksheet code
 * generation (Workstream 4A). See that file's own header comment for
 * the "per-classroom assignment, not a reusable resource" model
 * decision this covers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorksheetCode } from '../../js/services/worksheetCodeService.js';
import { createLearningSubject } from '../../js/models/LearningSubject.js';
import { createLearningUnit } from '../../js/models/LearningUnit.js';

function classroomWithSubject({ subjectId = 'science', title = 'Science', units = [] } = {}) {
  const subject = createLearningSubject({ id: 'subj-1', subjectId, title, units });
  return { learningRecord: { subjects: [subject] }, assignments: [] };
}

test('a canonical subject with a numbered unit produces WS-{ABBR}-U{number}-01', () => {
  const unit = createLearningUnit({ id: 'unit-1', title: 'Chemical Reactions', number: 12 });
  const classroom = classroomWithSubject({ subjectId: 'science', units: [unit] });

  const code = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-1' });
  assert.equal(code, 'WS-SCI-U12-01');
});

test('sequence increments for additional worksheets in the exact same Subject+Unit scope', () => {
  const unit = createLearningUnit({ id: 'unit-1', title: 'Chemical Reactions', number: 12 });
  const classroom = classroomWithSubject({ subjectId: 'science', units: [unit] });

  classroom.assignments.push({ code: generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-1' }) });
  const second = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-1' });
  assert.equal(second, 'WS-SCI-U12-02');

  classroom.assignments.push({ code: second });
  const third = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-1' });
  assert.equal(third, 'WS-SCI-U12-03');
});

test('a different Unit on the same Subject gets its own independent sequence', () => {
  const unit12 = createLearningUnit({ id: 'unit-12', title: 'Chemical Reactions', number: 12 });
  const unit13 = createLearningUnit({ id: 'unit-13', title: 'Metals and Non-metals', number: 13 });
  const classroom = classroomWithSubject({ subjectId: 'science', units: [unit12, unit13] });

  classroom.assignments.push({ code: generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-12' }) });
  const unit13Code = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-13' });
  assert.equal(unit13Code, 'WS-SCI-U13-01', 'Unit 13 must not inherit Unit 12’s own sequence');
});

test('no Unit selected omits the unit segment entirely, scoping sequence to Subject alone', () => {
  const classroom = classroomWithSubject({ subjectId: 'mathematics', title: 'Mathematics' });
  const code = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: null });
  assert.equal(code, 'WS-MAT-01');
});

test('no Subject at all falls back to the category name’s own abbreviation', () => {
  const classroom = { learningRecord: { subjects: [] }, assignments: [] };
  const code = generateWorksheetCode(classroom, { subjectId: null, unitId: null, categoryName: 'Projects' });
  assert.equal(code, 'WS-PRO-01');
});

test('no Subject and no category name falls back to a generic abbreviation rather than throwing', () => {
  const classroom = { learningRecord: { subjects: [] }, assignments: [] };
  const code = generateWorksheetCode(classroom, {});
  assert.equal(code, 'WS-GEN-01');
});

test('a free-typed (non-canonical) Subject abbreviates from its own title', () => {
  const classroom = classroomWithSubject({ subjectId: null, title: 'Robotics Club' });
  const code = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: null });
  assert.equal(code, 'WS-ROB-01');
});

test('codes are never duplicated even if assignments are deleted and recreated out of order', () => {
  const unit = createLearningUnit({ id: 'unit-1', title: 'Chemical Reactions', number: 12 });
  const classroom = classroomWithSubject({ subjectId: 'science', units: [unit] });

  const first = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-1' });
  classroom.assignments.push({ code: first });
  const second = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-1' });
  classroom.assignments.push({ code: second });

  // The first assignment gets deleted -- its own code (01) is now free,
  // but the generator must still never reissue it, since "02" already
  // exists and a human may already be referring to "01" as "the one
  // that was deleted," not an available slot.
  classroom.assignments = classroom.assignments.filter((a) => a.code !== first);

  const third = generateWorksheetCode(classroom, { subjectId: 'subj-1', unitId: 'unit-1' });
  assert.equal(third, 'WS-SCI-U12-03');
});
