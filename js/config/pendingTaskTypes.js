/**
 * config/pendingTaskTypes.js
 *
 * The Pending Tasks widget's task types, as data. Each entry is metadata
 * only — the actual checking logic lives in
 * services/pendingTaskService.js, keyed by this file's `id`, so this
 * file has no dependency on other services and stays plain data (the
 * same split as config/recognitionCategories.js).
 *
 * Adding a new task type later (e.g. "Bucket not assigned", "Note
 * follow-up needed") means one new entry here plus one new checker
 * function in pendingTaskService.js — never a widget rewrite.
 */

export const PENDING_TASK_TYPES = Object.freeze([
  {
    id: 'notebook_not_checked_today',
    label: 'Notebook not checked today',
    icon: 'notebook-text',
  },
  {
    id: 'activity_awaiting_completion',
    label: 'Activities awaiting completion',
    icon: 'clipboard-list',
  },
  {
    id: 'homework_awaiting_review',
    label: 'Homework awaiting review',
    icon: 'alert-triangle',
  },
]);

export function getPendingTaskTypeById(taskTypeId) {
  return PENDING_TASK_TYPES.find((taskType) => taskType.id === taskTypeId) || null;
}
