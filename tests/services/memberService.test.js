import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProgramManagerAnywhere, getProgramManagerClassroomIds } from '../../js/services/memberService.js';

test('isProgramManagerAnywhere: an owner/teacher who has never joined a PM invite is NOT a Program Manager, even in the classroom they created', () => {
  const classrooms = [
    { id: 'classroom-a', members: { 'uid-1': { role: 'owner' } } },
    { id: 'classroom-b', members: { 'uid-1': { role: 'teacher' } } },
  ];
  assert.equal(isProgramManagerAnywhere(classrooms, 'uid-1'), false);
});

test('isProgramManagerAnywhere: a real program_manager membership on at least one classroom returns true', () => {
  const classrooms = [
    { id: 'classroom-a', members: { 'uid-1': { role: 'owner' } } },
    { id: 'classroom-b', members: { 'uid-1': { role: 'program_manager' } } },
  ];
  assert.equal(isProgramManagerAnywhere(classrooms, 'uid-1'), true);
});

test('isProgramManagerAnywhere: a uid with no membership entry at all in any classroom is not a Program Manager', () => {
  const classrooms = [{ id: 'classroom-a', members: { 'someone-else': { role: 'program_manager' } } }];
  assert.equal(isProgramManagerAnywhere(classrooms, 'uid-1'), false);
});

test('isProgramManagerAnywhere: an empty classrooms array is not a Program Manager', () => {
  assert.equal(isProgramManagerAnywhere([], 'uid-1'), false);
});

test('isProgramManagerAnywhere: a missing/undefined classrooms argument degrades safely to false rather than throwing', () => {
  assert.equal(isProgramManagerAnywhere(undefined, 'uid-1'), false);
});

test('getProgramManagerClassroomIds: returns every classroom id where this uid actually holds program_manager', () => {
  const classrooms = [
    { id: 'classroom-a', members: { 'uid-1': { role: 'owner' } } },
    { id: 'classroom-b', members: { 'uid-1': { role: 'program_manager' } } },
    { id: 'classroom-c', members: { 'uid-1': { role: 'program_manager' } } },
  ];
  assert.deepEqual(getProgramManagerClassroomIds(classrooms, 'uid-1'), ['classroom-b', 'classroom-c']);
});

test('getProgramManagerClassroomIds: an owner/teacher-only uid gets an empty array, never a guess', () => {
  const classrooms = [{ id: 'classroom-a', members: { 'uid-1': { role: 'owner' } } }];
  assert.deepEqual(getProgramManagerClassroomIds(classrooms, 'uid-1'), []);
});

test('getProgramManagerClassroomIds: a missing/undefined classrooms argument degrades safely to an empty array', () => {
  assert.deepEqual(getProgramManagerClassroomIds(undefined, 'uid-1'), []);
});
