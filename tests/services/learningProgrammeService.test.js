import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as learningProgrammeService from '../../js/services/learningProgrammeService.js';
import { buildEnglishLiteracyCircleConfiguration } from '../../js/config/englishLiteracyCircleDefaults.js';

function makeClassroom() {
  return createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
}

// ---------------------------------------------------------------------
// Existing-classroom compatibility (no migration required)
// ---------------------------------------------------------------------

test('classroom creation/loading with no learningProgrammes field behaves exactly as before', () => {
  const classroom = { id: 'legacy-classroom', teams: [] }; // simulates a raw Firestore doc predating this feature
  assert.equal(classroom.learningProgrammes, undefined);

  const programmes = learningProgrammeService.listLearningProgrammes(classroom);
  assert.deepEqual(programmes, []);
  // ensureLearningProgrammes() should have safely defaulted the field in place
  assert.deepEqual(classroom.learningProgrammes, []);
});

test('createClassroom: learningProgrammes defaults to an empty array', () => {
  const classroom = makeClassroom();
  assert.deepEqual(classroom.learningProgrammes, []);
});

// ---------------------------------------------------------------------
// Programme creation
// ---------------------------------------------------------------------

test('createNewLearningProgramme: creates and appends a programme, defaults classroomIds to this classroom', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, {
    name: 'English Literacy Circle',
    ownerId: 'teacher-uid-1',
  });

  assert.equal(programme.name, 'English Literacy Circle');
  assert.deepEqual(programme.classroomIds, ['classroom-1']);
  assert.equal(classroom.learningProgrammes.length, 1);
  assert.equal(classroom.learningProgrammes[0].id, programme.id);
});

test('createNewLearningProgramme: rejects a missing name', () => {
  const classroom = makeClassroom();
  assert.throws(() => learningProgrammeService.createNewLearningProgramme(classroom, {}), /name is required/);
});

test('createNewLearningProgramme: rejects an empty classroomIds array if explicitly provided', () => {
  const classroom = makeClassroom();
  assert.throws(
    () => learningProgrammeService.createNewLearningProgramme(classroom, { name: 'Reading Club', classroomIds: [] }),
    /classroomIds must be a non-empty array/
  );
});

test('createNewLearningProgramme: multiple programmes for one classroom coexist independently', () => {
  const classroom = makeClassroom();
  const first = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });
  const second = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'Reading Club' });

  assert.equal(classroom.learningProgrammes.length, 2);
  assert.notEqual(first.id, second.id);
  assert.equal(learningProgrammeService.getLearningProgrammeById(classroom, first.id).name, 'English Literacy Circle');
  assert.equal(learningProgrammeService.getLearningProgrammeById(classroom, second.id).name, 'Reading Club');
});

test('createNewLearningProgramme: default English Literacy Circle configuration is seeded with real category ids', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, {
    name: 'English Literacy Circle',
    configuration: buildEnglishLiteracyCircleConfiguration(),
  });

  const categories = programme.configuration.goalFramework.categories;
  assert.equal(categories.length, 4);
  categories.forEach((category) => assert.ok(category.id));
  assert.deepEqual(categories.map((c) => c.name), ['Listening', 'Speaking', 'Reading', 'Writing']);
});

// ---------------------------------------------------------------------
// Configuration updates must not touch history-relevant invariants
// ---------------------------------------------------------------------

test('updateProgrammeConfiguration: updates only the fields provided', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle', description: 'v1' });
  const originalCreatedAt = programme.createdAt;

  learningProgrammeService.updateProgrammeConfiguration(programme, { description: 'v2' });

  assert.equal(programme.name, 'English Literacy Circle');
  assert.equal(programme.description, 'v2');
  assert.equal(programme.createdAt, originalCreatedAt);
  assert.ok(programme.updatedAt, 'updatedAt must be stamped after a configuration change');
});

test('updateProgrammeConfiguration: replacing goalFramework categories does not affect memberships or status', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, {
    name: 'English Literacy Circle',
    configuration: buildEnglishLiteracyCircleConfiguration(),
  });
  learningProgrammeService.addMembership(programme, 'student-1');

  learningProgrammeService.updateProgrammeConfiguration(programme, {
    configuration: { goalFramework: { categories: [{ name: 'Vocabulary', suggestedGoals: ['Learn 5 words'] }] } },
  });

  assert.equal(programme.configuration.goalFramework.categories.length, 1);
  assert.equal(programme.configuration.goalFramework.categories[0].name, 'Vocabulary');
  assert.ok(programme.configuration.goalFramework.categories[0].id);
  // Membership untouched by a configuration change
  assert.equal(programme.memberships.length, 1);
  assert.equal(programme.status, 'active');
});

// ---------------------------------------------------------------------
// Archival
// ---------------------------------------------------------------------

test('archiveProgramme: sets status to archived, preserves memberships', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });
  learningProgrammeService.addMembership(programme, 'student-1');

  learningProgrammeService.archiveProgramme(programme);

  assert.equal(programme.status, 'archived');
  assert.equal(programme.memberships.length, 1);
});

// ---------------------------------------------------------------------
// Membership lifecycle
// ---------------------------------------------------------------------

test('addMembership: adds a new active membership for a student', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });

  const membership = learningProgrammeService.addMembership(programme, 'student-1');

  assert.equal(membership.studentId, 'student-1');
  assert.equal(membership.status, 'active');
  assert.equal(programme.memberships.length, 1);
});

test('addMembership: calling it twice for the same active student is a no-op, not a duplicate', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });

  const first = learningProgrammeService.addMembership(programme, 'student-1');
  const second = learningProgrammeService.addMembership(programme, 'student-1');

  assert.equal(programme.memberships.length, 1);
  assert.equal(first.id, second.id);
});

test('markMembershipLeft: sets leftAt/status without deleting the membership record', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });
  learningProgrammeService.addMembership(programme, 'student-1');

  const left = learningProgrammeService.markMembershipLeft(programme, 'student-1');

  assert.equal(left.status, 'left');
  assert.ok(left.leftAt);
  assert.equal(programme.memberships.length, 1, 'membership record must still exist after leaving');
  assert.equal(learningProgrammeService.getActiveMembership(programme, 'student-1'), null);
});

test('markMembershipLeft: is a no-op for a student with no active membership', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });

  const result = learningProgrammeService.markMembershipLeft(programme, 'never-joined-student');
  assert.equal(result, null);
});

test('re-joining after leaving creates a brand new membership record, never revives the old one', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });

  const firstStint = learningProgrammeService.addMembership(programme, 'student-1');
  learningProgrammeService.markMembershipLeft(programme, 'student-1');
  const secondStint = learningProgrammeService.addMembership(programme, 'student-1');

  assert.equal(programme.memberships.length, 2, 'both stints must be preserved as separate history entries');
  assert.notEqual(firstStint.id, secondStint.id);
  assert.equal(programme.memberships[0].status, 'left');
  assert.equal(programme.memberships[1].status, 'active');

  const fullHistory = learningProgrammeService.getMembershipsForStudent(programme, 'student-1');
  assert.equal(fullHistory.length, 2);
});

test('a student never has student profile data duplicated into a membership record', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });
  const membership = learningProgrammeService.addMembership(programme, 'student-1');

  assert.deepEqual(Object.keys(membership).sort(), ['id', 'joinedAt', 'leftAt', 'status', 'studentId'].sort());
});

test('getActiveMembers: returns only students currently active, not students who have left', () => {
  const classroom = makeClassroom();
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, { name: 'English Literacy Circle' });
  learningProgrammeService.addMembership(programme, 'student-1');
  learningProgrammeService.addMembership(programme, 'student-2');
  learningProgrammeService.markMembershipLeft(programme, 'student-1');

  const active = learningProgrammeService.getActiveMembers(programme);
  assert.deepEqual(active.map((m) => m.studentId), ['student-2']);
});
