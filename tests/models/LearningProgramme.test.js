import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningProgramme } from '../../js/models/LearningProgramme.js';

test('createLearningProgramme: safe defaults for a brand-new programme', () => {
  const programme = createLearningProgramme({ name: 'English Literacy Circle' });

  assert.equal(programme.name, 'English Literacy Circle');
  assert.equal(programme.status, 'active');
  assert.deepEqual(programme.classroomIds, []);
  assert.deepEqual(programme.facilitatorUids, []);
  assert.deepEqual(programme.memberships, []);
  assert.deepEqual(programme.configuration.defaultComponents, []);
  assert.deepEqual(programme.configuration.extensions, []);
  assert.deepEqual(programme.configuration.goalFramework.categories, []);
  assert.deepEqual(programme.configuration.settings, {});
  assert.ok(programme.id);
  assert.ok(programme.createdAt);
  assert.equal(programme.updatedAt, programme.createdAt);
});

test('createLearningProgramme: classroomIds is always an array, never assumed to be exactly one', () => {
  const single = createLearningProgramme({ name: 'Reading Club', classroomIds: ['classroom-1'] });
  const multi = createLearningProgramme({ name: 'Reading Club', classroomIds: ['classroom-1', 'classroom-2'] });

  assert.deepEqual(single.classroomIds, ['classroom-1']);
  assert.deepEqual(multi.classroomIds, ['classroom-1', 'classroom-2']);
});

test('createLearningProgramme: no score/progress field exists anywhere on the model', () => {
  const programme = createLearningProgramme({ name: 'English Literacy Circle' });
  const keys = Object.keys(programme);

  assert.ok(!keys.includes('score'));
  assert.ok(!keys.includes('progress'));
  assert.ok(!keys.includes('cachedAttendancePercentage'));
  assert.ok(!keys.includes('cachedGoalCompletion'));
  assert.ok(!('progress' in programme.configuration));
});

test('createLearningProgramme: configuration.goalFramework.categories preserves provided categories', () => {
  const programme = createLearningProgramme({
    name: 'English Literacy Circle',
    configuration: {
      goalFramework: {
        categories: [{ id: 'cat-1', name: 'Reading', suggestedGoals: ['Read two pages'] }],
      },
    },
  });

  assert.equal(programme.configuration.goalFramework.categories.length, 1);
  assert.equal(programme.configuration.goalFramework.categories[0].name, 'Reading');
});
