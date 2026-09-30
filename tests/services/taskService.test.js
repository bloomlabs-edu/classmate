import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_STATUS, TASK_PRIORITY, TASK_DUE_TYPE } from '../../js/models/Task.js';
import {
  createTaskDraft,
  resolveDueDate,
  getEffortLabel,
  updateTitle,
  updateDescription,
  updateWorkspace,
  updatePriority,
  updateDueDate,
  updateEstimatedMinutes,
  markInProgress,
  markComplete,
  reopenTask,
  archiveTask,
  addSubtask,
  removeSubtask,
  toggleSubtask,
  setContextRef,
  clearContextRef,
} from '../../js/services/taskService.js';

const TODAY = '2026-09-28'; // Monday

// ---------------------------------------------------------------------
// createTaskDraft
// ---------------------------------------------------------------------

test('createTaskDraft: only ownerUid and title are required — low-friction capture', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'Redesign the assessment dashboard' });
  assert.equal(task.ownerUid, 'uid-1');
  assert.equal(task.title, 'Redesign the assessment dashboard');
  assert.equal(task.status, TASK_STATUS.TODO);
  assert.equal(task.priority, TASK_PRIORITY.WHENEVER);
  assert.equal(task.dueType, TASK_DUE_TYPE.NONE);
});

test('createTaskDraft: rejects a missing ownerUid or title', () => {
  assert.throws(() => createTaskDraft({ title: 'x' }), /ownerUid/);
  assert.throws(() => createTaskDraft({ ownerUid: 'uid-1' }), /title/);
});

test('createTaskDraft: rejects an invalid priority', () => {
  assert.throws(() => createTaskDraft({ ownerUid: 'uid-1', title: 'x', priority: 'urgent' }), /not a valid priority/);
});

test('createTaskDraft: an explicit dueType resolves dueDate at creation time', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'x', dueType: TASK_DUE_TYPE.TODAY, todayDateKey: TODAY });
  assert.equal(task.dueType, TASK_DUE_TYPE.TODAY);
  assert.equal(task.dueDate, TODAY);
});

test('createTaskDraft: a contextRef is validated and carried through', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'Create Chapter Plan', contextRef: { entityType: 'chapterPlan', entityId: 'plan-1' } });
  assert.deepEqual(task.contextRef, { entityType: 'chapterPlan', entityId: 'plan-1', classroomId: null });
});

test('createTaskDraft: rejects a contextRef missing entityType/entityId', () => {
  assert.throws(() => createTaskDraft({ ownerUid: 'uid-1', title: 'x', contextRef: { entityId: 'plan-1' } }), /entityType/);
  assert.throws(() => createTaskDraft({ ownerUid: 'uid-1', title: 'x', contextRef: { entityType: 'chapterPlan' } }), /entityId/);
});

// ---------------------------------------------------------------------
// resolveDueDate
// ---------------------------------------------------------------------

test('resolveDueDate: TODAY resolves to todayDateKey verbatim', () => {
  assert.deepEqual(resolveDueDate(TASK_DUE_TYPE.TODAY, { todayDateKey: TODAY }), { dueType: 'today', dueDate: TODAY });
});

test('resolveDueDate: TOMORROW resolves to todayDateKey + 1 day', () => {
  assert.deepEqual(resolveDueDate(TASK_DUE_TYPE.TOMORROW, { todayDateKey: TODAY }), { dueType: 'tomorrow', dueDate: '2026-09-29' });
});

test('resolveDueDate: THIS_WEEK resolves to the Friday of the current Mon-Fri week, regardless of which weekday today is', () => {
  assert.deepEqual(resolveDueDate(TASK_DUE_TYPE.THIS_WEEK, { todayDateKey: TODAY }), { dueType: 'this_week', dueDate: '2026-10-02' });
  // Thursday of the same week resolves to the same Friday.
  assert.deepEqual(resolveDueDate(TASK_DUE_TYPE.THIS_WEEK, { todayDateKey: '2026-10-01' }), { dueType: 'this_week', dueDate: '2026-10-02' });
});

test('resolveDueDate: CUSTOM passes the caller-supplied date through, and rejects a missing one', () => {
  assert.deepEqual(resolveDueDate(TASK_DUE_TYPE.CUSTOM, { customDate: '2026-12-25' }), { dueType: 'custom', dueDate: '2026-12-25' });
  assert.throws(() => resolveDueDate(TASK_DUE_TYPE.CUSTOM, {}), /custom due date/);
});

test('resolveDueDate: NONE always resolves to a null dueDate', () => {
  assert.deepEqual(resolveDueDate(TASK_DUE_TYPE.NONE, { todayDateKey: TODAY }), { dueType: 'none', dueDate: null });
});

test('resolveDueDate: rejects an invalid dueType', () => {
  assert.throws(() => resolveDueDate('next_month', { todayDateKey: TODAY }), /not a valid due-date type/);
});

// ---------------------------------------------------------------------
// getEffortLabel
// ---------------------------------------------------------------------

test('getEffortLabel: null/undefined estimate has no label', () => {
  assert.equal(getEffortLabel(null), null);
  assert.equal(getEffortLabel(undefined), null);
});

test('getEffortLabel: bands map to Quick / Medium / Deep Work', () => {
  assert.equal(getEffortLabel(15), 'Quick');
  assert.equal(getEffortLabel(20), 'Quick');
  assert.equal(getEffortLabel(45), 'Medium');
  assert.equal(getEffortLabel(60), 'Medium');
  assert.equal(getEffortLabel(90), 'Deep Work');
  assert.equal(getEffortLabel(61), 'Deep Work');
});

// ---------------------------------------------------------------------
// Field mutators
// ---------------------------------------------------------------------

test('updateTitle/updateDescription/updateWorkspace: set the field and bump updatedAt', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'Original' });
  const before = task.updatedAt;
  updateTitle(task, 'Renamed');
  assert.equal(task.title, 'Renamed');
  updateDescription(task, 'Some notes');
  assert.equal(task.description, 'Some notes');
  updateWorkspace(task, 'Teaching');
  assert.equal(task.workspace, 'Teaching');
  assert.ok(task.updatedAt >= before);
});

test('updateTitle: rejects a blank title', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'x' });
  assert.throws(() => updateTitle(task, '   '), /needs a title/);
});

test('updatePriority: sets a valid priority, rejects an invalid one', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'x' });
  updatePriority(task, TASK_PRIORITY.MUST_DO);
  assert.equal(task.priority, TASK_PRIORITY.MUST_DO);
  assert.throws(() => updatePriority(task, 'urgent'), /not a valid priority/);
});

test('updateDueDate: reschedules dueType and dueDate together, never independently', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'x' });
  updateDueDate(task, { dueType: TASK_DUE_TYPE.TOMORROW, todayDateKey: TODAY });
  assert.equal(task.dueType, TASK_DUE_TYPE.TOMORROW);
  assert.equal(task.dueDate, '2026-09-29');
});

test('updateEstimatedMinutes: accepts null or a non-negative number, rejects a negative one', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'x' });
  updateEstimatedMinutes(task, 45);
  assert.equal(task.estimatedMinutes, 45);
  updateEstimatedMinutes(task, null);
  assert.equal(task.estimatedMinutes, null);
  assert.throws(() => updateEstimatedMinutes(task, -5), /non-negative/);
});

// ---------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------

test('markInProgress / markComplete / reopenTask / archiveTask: the exact V1 transitions', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'x' });

  markInProgress(task);
  assert.equal(task.status, TASK_STATUS.IN_PROGRESS);
  assert.equal(task.completedAt, null);

  markComplete(task);
  assert.equal(task.status, TASK_STATUS.DONE);
  assert.ok(task.completedAt);

  reopenTask(task);
  assert.equal(task.status, TASK_STATUS.TODO);
  assert.equal(task.completedAt, null);

  archiveTask(task);
  assert.equal(task.status, TASK_STATUS.ARCHIVED);
});

// ---------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------

test('addSubtask / toggleSubtask / removeSubtask: full round trip', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'Review examination copies' });
  const subtask = addSubtask(task, 'Review copies');
  assert.equal(task.subtasks.length, 1);
  assert.equal(task.subtasks[0].done, false);

  toggleSubtask(task, subtask.id);
  assert.equal(task.subtasks[0].done, true);
  toggleSubtask(task, subtask.id);
  assert.equal(task.subtasks[0].done, false);

  removeSubtask(task, subtask.id);
  assert.equal(task.subtasks.length, 0);
});

test('removeSubtask: a no-op (no touch) when the subtask id does not exist', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'x' });
  const before = task.updatedAt;
  removeSubtask(task, 'missing');
  assert.equal(task.updatedAt, before);
});

// ---------------------------------------------------------------------
// Context reference
// ---------------------------------------------------------------------

test('setContextRef / clearContextRef: attach and detach a reference, never copying entity content', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'Analyse mistake patterns' });
  setContextRef(task, { entityType: 'assessment', entityId: 'assessment-1', classroomId: 'classroom-a' });
  assert.deepEqual(task.contextRef, { entityType: 'assessment', entityId: 'assessment-1', classroomId: 'classroom-a' });

  clearContextRef(task);
  assert.equal(task.contextRef, null);
});

test('setContextRef: rejects a reference missing entityType or entityId', () => {
  const task = createTaskDraft({ ownerUid: 'uid-1', title: 'x' });
  assert.throws(() => setContextRef(task, { entityId: 'plan-1' }), /entityType/);
  assert.throws(() => setContextRef(task, { entityType: 'chapterPlan' }), /entityId/);
});
