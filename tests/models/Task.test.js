import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTask,
  createTaskSubtask,
  createTaskContextRef,
  getTaskSubtaskIndex,
  findTaskSubtask,
  getSubtaskProgress,
  TASK_STATUS,
  TASK_PRIORITY,
  TASK_DUE_TYPE,
} from '../../js/models/Task.js';

test('createTask: defaults to TODO status, WHENEVER priority, NONE due type, no deadline', () => {
  const task = createTask({ ownerUid: 'uid-1', title: 'Do the thing' });
  assert.equal(task.status, TASK_STATUS.TODO);
  assert.equal(task.priority, TASK_PRIORITY.WHENEVER);
  assert.equal(task.dueType, TASK_DUE_TYPE.NONE);
  assert.equal(task.dueDate, null);
  assert.equal(task.estimatedMinutes, null);
  assert.equal(task.completedAt, null);
  assert.deepEqual(task.subtasks, []);
  assert.equal(task.contextRef, null);
  assert.ok(task.id);
  assert.ok(task.createdAt);
  assert.equal(task.updatedAt, task.createdAt);
});

test('createTask: ownerUid and title are carried through untouched', () => {
  const task = createTask({ ownerUid: 'uid-1', title: 'Grade the exams', description: 'All Grade 8 sections', workspace: 'Teaching' });
  assert.equal(task.ownerUid, 'uid-1');
  assert.equal(task.title, 'Grade the exams');
  assert.equal(task.description, 'All Grade 8 sections');
  assert.equal(task.workspace, 'Teaching');
});

test('createTaskSubtask: {id, title, done} shape, done defaults to false', () => {
  const subtask = createTaskSubtask({ title: 'Review copies' });
  assert.ok(subtask.id);
  assert.equal(subtask.title, 'Review copies');
  assert.equal(subtask.done, false);
});

test('createTaskContextRef: carries entityType/entityId/classroomId verbatim, classroomId defaults to null', () => {
  const ref = createTaskContextRef({ entityType: 'chapterPlan', entityId: 'plan-1' });
  assert.deepEqual(ref, { entityType: 'chapterPlan', entityId: 'plan-1', classroomId: null });
});

test('createTaskContextRef: classroomId is carried through when the referenced entity is classroom-scoped', () => {
  const ref = createTaskContextRef({ entityType: 'lesson', entityId: 'lesson-1', classroomId: 'classroom-a' });
  assert.equal(ref.classroomId, 'classroom-a');
});

test('getTaskSubtaskIndex / findTaskSubtask: find by id, or -1/null when absent', () => {
  const subtask = createTaskSubtask({ title: 'Step 1' });
  const task = createTask({ ownerUid: 'uid-1', title: 'Big task', subtasks: [subtask] });
  assert.equal(getTaskSubtaskIndex(task, subtask.id), 0);
  assert.equal(getTaskSubtaskIndex(task, 'missing'), -1);
  assert.deepEqual(findTaskSubtask(task, subtask.id), subtask);
  assert.equal(findTaskSubtask(task, 'missing'), null);
});

test('getSubtaskProgress: {completed, total} over the subtasks array, {0, 0} for a Task with none', () => {
  const task = createTask({ ownerUid: 'uid-1', title: 'Big task' });
  assert.deepEqual(getSubtaskProgress(task), { completed: 0, total: 0 });

  const withSubtasks = createTask({
    ownerUid: 'uid-1',
    title: 'Big task',
    subtasks: [
      createTaskSubtask({ title: 'a', done: true }),
      createTaskSubtask({ title: 'b', done: false }),
      createTaskSubtask({ title: 'c', done: true }),
    ],
  });
  assert.deepEqual(getSubtaskProgress(withSubtasks), { completed: 2, total: 3 });
});
