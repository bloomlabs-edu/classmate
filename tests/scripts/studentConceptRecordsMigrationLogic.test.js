import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createTeam } from '../../js/models/Team.js';
import { createStudent } from '../../js/models/Student.js';
import {
  buildRecordId,
  listLegacyRecords,
  computeRecordsToBackfill,
} from '../../scripts/studentConceptRecordsMigrationLogic.js';

function classroomWithLegacyData() {
  const studentA = createStudent({
    id: 'student-A',
    name: 'A',
    learningRecord: {
      'concept-1': { understanding: 'confident', notebook: 'not_required', helpRequested: false, updatedAt: '2025-01-01' },
      'concept-2': { understanding: 'need_help', notebook: 'not_required', helpRequested: true, updatedAt: '2025-02-01' },
    },
  });
  const studentB = createStudent({ id: 'student-B', name: 'B' }); // no learningRecord at all
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test', gradeSection: 'G1' });
  classroom.teams = [createTeam({ name: 'Alpha', students: [studentA, studentB] })];
  return classroom;
}

test('buildRecordId matches the repository’s own deterministic scheme', () => {
  assert.equal(buildRecordId('student-A', 'concept-1'), 'student-A_concept-1');
});

test('listLegacyRecords: flattens every real legacy entry across the whole roster', () => {
  const rows = listLegacyRecords(classroomWithLegacyData());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.recordId).sort(), ['student-A_concept-1', 'student-A_concept-2']);
});

test('listLegacyRecords: a student with no learningRecord at all contributes nothing', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  classroom.teams = [createTeam({ name: 'Alpha', students: [createStudent({ id: 's1', name: 'A' })] })];
  assert.deepEqual(listLegacyRecords(classroom), []);
});

test('computeRecordsToBackfill: excludes anything already present in the new collection', () => {
  const classroom = classroomWithLegacyData();
  const existing = new Set(['student-A_concept-1']);
  const toBackfill = computeRecordsToBackfill(classroom, existing);
  assert.equal(toBackfill.length, 1);
  assert.equal(toBackfill[0].recordId, 'student-A_concept-2');
});

test('computeRecordsToBackfill: is idempotent — computing it again after "backfilling" everything returns nothing', () => {
  const classroom = classroomWithLegacyData();
  const firstPass = computeRecordsToBackfill(classroom, new Set());
  const allIds = new Set(firstPass.map((r) => r.recordId));

  const secondPass = computeRecordsToBackfill(classroom, allIds);
  assert.deepEqual(secondPass, []);
});

test('computeRecordsToBackfill: every returned row has uid: null, never a fabricated identity', () => {
  const toBackfill = computeRecordsToBackfill(classroomWithLegacyData(), new Set());
  toBackfill.forEach((row) => assert.equal(row.uid, null));
});

test('computeRecordsToBackfill: preserves the real legacy understanding/notebook/helpRequested/updatedAt values', () => {
  const toBackfill = computeRecordsToBackfill(classroomWithLegacyData(), new Set());
  const concept2 = toBackfill.find((r) => r.conceptId === 'concept-2');
  assert.equal(concept2.understanding, 'need_help');
  assert.equal(concept2.helpRequested, true);
  assert.equal(concept2.updatedAt, '2025-02-01');
});
