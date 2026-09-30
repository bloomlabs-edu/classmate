import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../../js/models/Task.js';
import {
  getPriorityDisplay,
  getStatusLabel,
  getDueDateLabel,
  getEffortDisplay,
  sortTasksForList,
  isActiveTask,
  getTasksDueToday,
  getTasksDueInRange,
} from '../../js/ui/views/MyWorkTaskDisplay.js';

const TODAY = '2026-09-28';

test('getPriorityDisplay: known priorities have an icon + label, unrecognized falls back safely', () => {
  assert.deepEqual(getPriorityDisplay('must_do'), { icon: '🔥', label: 'Must Do' });
  assert.deepEqual(getPriorityDisplay('important'), { icon: '⭐', label: 'Important' });
  assert.deepEqual(getPriorityDisplay('whenever'), { icon: '○', label: 'Whenever' });
  assert.deepEqual(getPriorityDisplay('urgent'), { icon: '○', label: 'urgent' });
});

test('getStatusLabel: maps every TASK_STATUS to a human label', () => {
  assert.equal(getStatusLabel('todo'), 'To do');
  assert.equal(getStatusLabel('in_progress'), 'In progress');
  assert.equal(getStatusLabel('done'), 'Done');
  assert.equal(getStatusLabel('archived'), 'Archived');
});

test('getDueDateLabel: null dueDate has no label at all', () => {
  const task = createTask({ ownerUid: 'uid-1', title: 'x' });
  assert.equal(getDueDateLabel(task, TODAY), null);
});

test('getDueDateLabel: today/tomorrow read as friendly words, not raw dates', () => {
  const todayTask = createTask({ ownerUid: 'uid-1', title: 'x', dueDate: TODAY });
  assert.equal(getDueDateLabel(todayTask, TODAY), 'Today');

  const tomorrowTask = createTask({ ownerUid: 'uid-1', title: 'x', dueDate: '2026-09-29' });
  assert.equal(getDueDateLabel(tomorrowTask, TODAY), 'Tomorrow');
});

test('getDueDateLabel: a past due date on a still-active Task reads as "Overdue"', () => {
  const task = createTask({ ownerUid: 'uid-1', title: 'x', dueDate: '2026-09-01', status: 'todo' });
  assert.equal(getDueDateLabel(task, TODAY), 'Overdue');
});

test('getDueDateLabel: a past due date on a DONE or ARCHIVED Task is never shown as overdue', () => {
  const done = createTask({ ownerUid: 'uid-1', title: 'x', dueDate: '2026-09-01', status: 'done' });
  assert.notEqual(getDueDateLabel(done, TODAY), 'Overdue');
  const archived = createTask({ ownerUid: 'uid-1', title: 'x', dueDate: '2026-09-01', status: 'archived' });
  assert.notEqual(getDueDateLabel(archived, TODAY), 'Overdue');
});

test('getDueDateLabel: a distant future date reads as a plain formatted date', () => {
  const task = createTask({ ownerUid: 'uid-1', title: 'x', dueDate: '2026-12-25' });
  assert.equal(getDueDateLabel(task, TODAY), '25 Dec 2026');
});

test('getEffortDisplay: null has no label; bands read Quick/Medium/Deep Work with the minute count', () => {
  assert.equal(getEffortDisplay(null), null);
  assert.equal(getEffortDisplay(15), 'Quick · 15 min');
  assert.equal(getEffortDisplay(45), 'Medium · 45 min');
  assert.equal(getEffortDisplay(90), 'Deep Work · 90 min');
});

test('isActiveTask: only TODO/IN_PROGRESS are active', () => {
  assert.equal(isActiveTask(createTask({ ownerUid: 'uid-1', title: 'x', status: 'todo' })), true);
  assert.equal(isActiveTask(createTask({ ownerUid: 'uid-1', title: 'x', status: 'in_progress' })), true);
  assert.equal(isActiveTask(createTask({ ownerUid: 'uid-1', title: 'x', status: 'done' })), false);
  assert.equal(isActiveTask(createTask({ ownerUid: 'uid-1', title: 'x', status: 'archived' })), false);
});

test('sortTasksForList: active tasks first (Must Do > Important > Whenever), then done, then archived', () => {
  const whenever = createTask({ ownerUid: 'uid-1', title: 'whenever', priority: 'whenever', createdAt: '2026-09-01T00:00:00.000Z' });
  const mustDo = createTask({ ownerUid: 'uid-1', title: 'must-do', priority: 'must_do', createdAt: '2026-09-01T00:00:00.000Z' });
  const important = createTask({ ownerUid: 'uid-1', title: 'important', priority: 'important', createdAt: '2026-09-01T00:00:00.000Z' });
  const done = createTask({ ownerUid: 'uid-1', title: 'done', status: 'done', completedAt: '2026-09-02T00:00:00.000Z' });
  const archived = createTask({ ownerUid: 'uid-1', title: 'archived', status: 'archived', updatedAt: '2026-09-03T00:00:00.000Z' });

  const sorted = sortTasksForList([archived, done, whenever, important, mustDo]);
  assert.deepEqual(sorted.map((t) => t.title), ['must-do', 'important', 'whenever', 'done', 'archived']);
});

test('sortTasksForList: within the same priority, newest-created sorts first', () => {
  const older = createTask({ ownerUid: 'uid-1', title: 'older', priority: 'must_do', createdAt: '2026-09-01T00:00:00.000Z' });
  const newer = createTask({ ownerUid: 'uid-1', title: 'newer', priority: 'must_do', createdAt: '2026-09-05T00:00:00.000Z' });
  const sorted = sortTasksForList([older, newer]);
  assert.deepEqual(sorted.map((t) => t.title), ['newer', 'older']);
});

test('sortTasksForList: does not mutate its input array', () => {
  const tasks = [createTask({ ownerUid: 'uid-1', title: 'a' }), createTask({ ownerUid: 'uid-1', title: 'b' })];
  const original = [...tasks];
  sortTasksForList(tasks);
  assert.deepEqual(tasks, original);
});

test('getTasksDueToday: includes due-today and overdue active tasks, excludes future/done/archived/no-due-date', () => {
  const dueToday = createTask({ ownerUid: 'uid-1', title: 'due-today', dueDate: TODAY });
  const overdue = createTask({ ownerUid: 'uid-1', title: 'overdue', dueDate: '2026-09-01' });
  const future = createTask({ ownerUid: 'uid-1', title: 'future', dueDate: '2026-10-01' });
  const noDueDate = createTask({ ownerUid: 'uid-1', title: 'no-due-date' });
  const doneOverdue = createTask({ ownerUid: 'uid-1', title: 'done-overdue', dueDate: '2026-09-01', status: 'done' });
  const archivedOverdue = createTask({ ownerUid: 'uid-1', title: 'archived-overdue', dueDate: '2026-09-01', status: 'archived' });

  const result = getTasksDueToday([dueToday, overdue, future, noDueDate, doneOverdue, archivedOverdue], TODAY);
  assert.deepEqual(result.map((t) => t.title).sort(), ['due-today', 'overdue']);
});

test('getTasksDueToday: sorts Must Do before Important before Whenever', () => {
  const whenever = createTask({ ownerUid: 'uid-1', title: 'whenever', priority: 'whenever', dueDate: TODAY });
  const mustDo = createTask({ ownerUid: 'uid-1', title: 'must-do', priority: 'must_do', dueDate: TODAY });
  const important = createTask({ ownerUid: 'uid-1', title: 'important', priority: 'important', dueDate: TODAY });

  const result = getTasksDueToday([whenever, mustDo, important], TODAY);
  assert.deepEqual(result.map((t) => t.title), ['must-do', 'important', 'whenever']);
});

test('getTasksDueInRange: only includes tasks whose dueDate falls within the range, inclusive', () => {
  const before = createTask({ ownerUid: 'uid-1', title: 'before', dueDate: '2026-09-27' });
  const rangeStart = createTask({ ownerUid: 'uid-1', title: 'range-start', dueDate: '2026-09-28' });
  const rangeMid = createTask({ ownerUid: 'uid-1', title: 'range-mid', dueDate: '2026-10-01' });
  const rangeEnd = createTask({ ownerUid: 'uid-1', title: 'range-end', dueDate: '2026-10-04' });
  const after = createTask({ ownerUid: 'uid-1', title: 'after', dueDate: '2026-10-05' });
  const noDueDate = createTask({ ownerUid: 'uid-1', title: 'no-due-date' });

  const result = getTasksDueInRange([before, rangeStart, rangeMid, rangeEnd, after, noDueDate], '2026-09-28', '2026-10-04');
  assert.deepEqual(result.map((t) => t.title), ['range-start', 'range-mid', 'range-end']);
});

test('getTasksDueInRange: excludes done/archived tasks even if their dueDate is in range', () => {
  const done = createTask({ ownerUid: 'uid-1', title: 'done', dueDate: '2026-10-01', status: 'done' });
  const archived = createTask({ ownerUid: 'uid-1', title: 'archived', dueDate: '2026-10-01', status: 'archived' });
  const active = createTask({ ownerUid: 'uid-1', title: 'active', dueDate: '2026-10-01', status: 'todo' });

  const result = getTasksDueInRange([done, archived, active], '2026-09-28', '2026-10-04');
  assert.deepEqual(result.map((t) => t.title), ['active']);
});

test('getTasksDueInRange: sorts by due date ascending, then priority within the same day', () => {
  const laterDay = createTask({ ownerUid: 'uid-1', title: 'later-day', dueDate: '2026-10-02' });
  const earlierWhenever = createTask({ ownerUid: 'uid-1', title: 'earlier-whenever', priority: 'whenever', dueDate: '2026-10-01' });
  const earlierMustDo = createTask({ ownerUid: 'uid-1', title: 'earlier-must-do', priority: 'must_do', dueDate: '2026-10-01' });

  const result = getTasksDueInRange([laterDay, earlierWhenever, earlierMustDo], '2026-09-28', '2026-10-04');
  assert.deepEqual(result.map((t) => t.title), ['earlier-must-do', 'earlier-whenever', 'later-day']);
});
