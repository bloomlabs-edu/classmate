import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { ensureVisitorAccessCode, revokeVisitorAccessCode, ensureProgramManagerJoinCode, upsertClassroom } from '../../js/services/classroomService.js';
import * as assignmentConfigService from '../../js/services/assignmentConfigService.js';

test('ensureVisitorAccessCode: generates a code once, and is a no-op if one already exists', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  assert.equal(classroom.visitorAccessCode, null);

  const created = ensureVisitorAccessCode(classroom);
  assert.equal(created, true);
  assert.ok(classroom.visitorAccessCode);

  const existingCode = classroom.visitorAccessCode;
  const createdAgain = ensureVisitorAccessCode(classroom);
  assert.equal(createdAgain, false);
  assert.equal(classroom.visitorAccessCode, existingCode); // never silently regenerated over an existing code
});

test('revokeVisitorAccessCode: clears the classroom\'s own pointer back to null', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  ensureVisitorAccessCode(classroom);
  assert.ok(classroom.visitorAccessCode);

  revokeVisitorAccessCode(classroom);
  assert.equal(classroom.visitorAccessCode, null);
});

test('ensureProgramManagerJoinCode: generates a code once, and is a no-op if one already exists', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  assert.equal(classroom.programManagerJoinCode, null);

  const created = ensureProgramManagerJoinCode(classroom);
  assert.equal(created, true);
  assert.ok(classroom.programManagerJoinCode);

  const existingCode = classroom.programManagerJoinCode;
  const createdAgain = ensureProgramManagerJoinCode(classroom);
  assert.equal(createdAgain, false);
  assert.equal(classroom.programManagerJoinCode, existingCode);
});

test('ensureProgramManagerJoinCode: generates a DIFFERENT code from classroomJoinCode — the two must never be interchangeable', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  classroom.classroomJoinCode = 'ABC123';
  ensureProgramManagerJoinCode(classroom);
  assert.notEqual(classroom.programManagerJoinCode, classroom.classroomJoinCode);
});

/**
 * Regression coverage for the production crash reported against the
 * Assignment Tracker: `TypeError: Cannot read properties of undefined
 * (reading 'categories')` in assignmentConfigService.js's own
 * listCategories(). Root cause -- a classroom document saved to
 * Firestore BEFORE the Assignment feature existed has no
 * `assignmentConfig` field at all (models/Classroom.js's own
 * `assignmentConfig = { categories: [] }` default only applies when
 * createClassroom() itself builds a brand-new classroom; it never runs
 * again for a classroom loaded back out of Firestore). upsertClassroom()
 * -- the one function every Firestore snapshot for every classroom
 * passes through (see workspaceService.js) -- already backfills
 * notebookConfig the exact same way for the identical reason; it simply
 * never got the matching line for assignmentConfig when that feature
 * shipped. These tests exercise upsertClassroom() directly with a raw,
 * plain object shaped like real legacy Firestore data (no
 * createClassroom() call involved), the same way a real snapshot
 * listener callback receives one.
 */
test('upsertClassroom: backfills assignmentConfig for a classroom document saved before the Assignment feature existed', () => {
  const legacyClassroomData = {
    id: 'legacy-1',
    schoolName: 'A School',
    gradeSection: 'Grade 8',
    teams: [],
    // No `assignmentConfig` key at all -- exactly what a classroom
    // document written before this feature existed looks like.
  };

  const normalized = upsertClassroom(legacyClassroomData);

  assert.deepEqual(normalized.assignmentConfig, { categories: [] });
  // The exact call site that crashed in production -- must now return
  // an empty array instead of throwing.
  assert.deepEqual(assignmentConfigService.listCategories(normalized), []);
});

test('upsertClassroom: never overwrites an existing classroom\'s already-saved assignment categories', () => {
  const existingCategory = { id: 'cat-1', name: 'Worksheets', aspects: [] };
  const classroomData = {
    id: 'legacy-2',
    schoolName: 'A School',
    gradeSection: 'Grade 8',
    teams: [],
    assignmentConfig: { categories: [existingCategory] },
  };

  const normalized = upsertClassroom(classroomData);

  assert.deepEqual(normalized.assignmentConfig.categories, [existingCategory]);
  assert.deepEqual(assignmentConfigService.listCategories(normalized), [existingCategory]);
});

test('upsertClassroom: never overwrites an existing student roster while backfilling assignmentConfig', () => {
  const existingStudent = { id: 's1', name: 'Asha', score: 7, bucket: 'green', badges: ['star'], notes: [], submissions: {}, history: [{ id: 'h1' }] };
  const classroomData = {
    id: 'legacy-3',
    schoolName: 'A School',
    gradeSection: 'Grade 8',
    teams: [{ id: 't1', name: 'Team 1', students: [existingStudent] }],
    // No assignmentConfig, same as a real legacy document.
  };

  const normalized = upsertClassroom(classroomData);

  assert.deepEqual(normalized.assignmentConfig, { categories: [] });
  assert.deepEqual(normalized.teams[0].students[0], existingStudent);
});
