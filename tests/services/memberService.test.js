import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProgramManagerAnywhere } from '../../js/services/memberService.js';

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
