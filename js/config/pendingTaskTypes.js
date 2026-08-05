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
    id: 'work_request_awaiting_submission',
    label: 'Awaiting submission',
    icon: 'notebook-text',
  },
  {
    id: 'work_request_submitted_awaiting_review',
    label: 'Submitted, awaiting review',
    icon: 'alert-triangle',
  },
  {
    id: 'work_request_needs_correction',
    label: 'Needs correction',
    icon: 'rotate-ccw',
  },
  {
    id: 'activity_awaiting_completion',
    label: 'Activities awaiting completion',
    icon: 'clipboard-list',
  },
]);

export function getPendingTaskTypeById(taskTypeId) {
  return PENDING_TASK_TYPES.find((taskType) => taskType.id === taskTypeId) || null;
}
