/**
 * ui/views/MyWorkTaskDisplay.js
 *
 * Pure display/ordering logic for ui/views/MyWorkView.js — kept in its
 * own dependency-free file, not inline in that view, for the same
 * reason ui/views/ChapterPlanRowDisplay.js exists: MyWorkView.js
 * transitively imports Firestore-touching repositories (which import
 * the Firebase SDK from a `https://` URL), which crashes under plain
 * `node --test` (ERR_UNSUPPORTED_ESM_URL_SCHEME) — this one set of
 * decisions needs to stay directly unit-testable.
 *
 * Deliberately NOT a "what should I work on now" ranking (that's a
 * future, explicitly-deferred phase — see services/taskService.js's
 * own header comment on why it excludes exactly that). This is only a
 * sensible DEFAULT list order for a plain list — active tasks grouped
 * ahead of done/archived ones, priority as the primary sort key within
 * "active" — never due-date-aware, never effort-aware, never
 * time-of-day-aware.
 */

import { TASK_STATUS, TASK_PRIORITY } from '../../models/Task.js';
import { formatDateKey } from '../../utils/dateHelpers.js';

const PRIORITY_DISPLAY = Object.freeze({
  [TASK_PRIORITY.MUST_DO]: { icon: '🔥', label: 'Must Do' },
  [TASK_PRIORITY.IMPORTANT]: { icon: '⭐', label: 'Important' },
  [TASK_PRIORITY.WHENEVER]: { icon: '○', label: 'Whenever' },
});

/** `{icon, label}` for a priority value — never throws on an unrecognized one, falls back to the plain value so a display bug is visible, never a blank row. */
export function getPriorityDisplay(priority) {
  return PRIORITY_DISPLAY[priority] || { icon: '○', label: priority };
}

/** Sort weight — lower sorts first. Only meaningful as a relative ordering, never shown to a user directly. */
const PRIORITY_SORT_WEIGHT = Object.freeze({
  [TASK_PRIORITY.MUST_DO]: 0,
  [TASK_PRIORITY.IMPORTANT]: 1,
  [TASK_PRIORITY.WHENEVER]: 2,
});

const STATUS_LABELS = Object.freeze({
  [TASK_STATUS.TODO]: 'To do',
  [TASK_STATUS.IN_PROGRESS]: 'In progress',
  [TASK_STATUS.DONE]: 'Done',
  [TASK_STATUS.ARCHIVED]: 'Archived',
});

export function getStatusLabel(status) {
  return STATUS_LABELS[status] || status;
}

/**
 * A short, human display string for a Task's own `dueDate`/`dueType` —
 * "Today"/"Tomorrow" when the resolved dueDate matches, "Overdue" when
 * it's in the past and the Task isn't DONE/ARCHIVED yet, otherwise a
 * plain formatted date (utils/dateHelpers.js's own formatDateKey()).
 * `null` (never a placeholder string) when there is no deadline at
 * all — the caller decides how to render "no deadline."
 */
export function getDueDateLabel(task, todayDateKey) {
  if (!task.dueDate) return null;
  if (task.dueDate === todayDateKey) return 'Today';

  if (task.dueDate < todayDateKey && task.status !== TASK_STATUS.DONE && task.status !== TASK_STATUS.ARCHIVED) {
    return 'Overdue';
  }

  // "Tomorrow" only when the dueDate is exactly one calendar day after
  // today — computed via plain date arithmetic on the dateKey itself,
  // never a second date-shifting implementation (utils/dateHelpers.js's
  // own shiftDateKey() already owns that logic; this file only compares
  // strings it's already given, it never derives a new date itself).
  const [y, m, d] = todayDateKey.split('-').map(Number);
  const tomorrowDate = new Date(y, m - 1, d + 1);
  const tomorrowKey = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;
  if (task.dueDate === tomorrowKey) return 'Tomorrow';

  return formatDateKey(task.dueDate);
}

/** A suggested display label for an estimate, in minutes — mirrors services/taskService.js's own getEffortLabel() (not re-imported here to keep this file's own dependency graph minimal; the two are kept in sync by both being direct, simple bands over the same models/Task.js's own TASK_EFFORT_PRESETS values). `null` for no estimate. */
export function getEffortDisplay(estimatedMinutes) {
  if (estimatedMinutes === null || estimatedMinutes === undefined) return null;
  const label = estimatedMinutes <= 20 ? 'Quick' : estimatedMinutes <= 60 ? 'Medium' : 'Deep Work';
  return `${label} · ${estimatedMinutes} min`;
}

const ACTIVE_STATUSES = new Set([TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS]);

/**
 * The plain list's own default order: active Tasks (TODO/IN_PROGRESS)
 * first, sorted Must Do -> Important -> Whenever, newest-created first
 * within the same priority; DONE Tasks next, most-recently-completed
 * first; ARCHIVED Tasks last, most-recently-updated first. Never
 * mutates its input.
 */
export function sortTasksForList(tasks) {
  return [...(tasks || [])].sort((a, b) => {
    const bucketA = a.status === TASK_STATUS.ARCHIVED ? 2 : a.status === TASK_STATUS.DONE ? 1 : 0;
    const bucketB = b.status === TASK_STATUS.ARCHIVED ? 2 : b.status === TASK_STATUS.DONE ? 1 : 0;
    if (bucketA !== bucketB) return bucketA - bucketB;

    if (bucketA === 0) {
      const weightDiff = PRIORITY_SORT_WEIGHT[a.priority] - PRIORITY_SORT_WEIGHT[b.priority];
      if (weightDiff !== 0) return weightDiff;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    }
    if (bucketA === 1) {
      return (b.completedAt || '').localeCompare(a.completedAt || '');
    }
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}

/** Whether a Task belongs in the "active" (not done, not archived) group — the one place this grouping boundary is defined, so a future view never has to re-derive it. */
export function isActiveTask(task) {
  return ACTIVE_STATUSES.has(task.status);
}

/**
 * Active (TODO/IN_PROGRESS) Tasks due today or overdue as of
 * `todayDateKey` — the exact set ui/views/PersonalHubView.js's own
 * Today section surfaces alongside the day's real schedule (see that
 * file's own populateTodaySection()). Sorted Must Do -> Important ->
 * Whenever, then most-overdue first within the same priority, so the
 * single most pressing thing reads first in a deliberately short list.
 * A Task with no `dueDate` at all never appears here — this is a
 * deadline-driven view, not a general task list (that's #/my-work's
 * own job).
 */
export function getTasksDueToday(tasks, todayDateKey) {
  return (tasks || [])
    .filter((task) => isActiveTask(task) && task.dueDate && task.dueDate <= todayDateKey)
    .sort((a, b) => {
      const weightDiff = PRIORITY_SORT_WEIGHT[a.priority] - PRIORITY_SORT_WEIGHT[b.priority];
      if (weightDiff !== 0) return weightDiff;
      return a.dueDate.localeCompare(b.dueDate);
    });
}

/**
 * Active Tasks whose own `dueDate` falls within [startDateKey,
 * endDateKey] inclusive — the set ui/views/PersonalHubView.js's own My
 * Week section surfaces alongside the week's real schedule grid (see
 * that file's own populateWeekSectionBody()). Deliberately does NOT
 * also include overdue-from-before-the-range Tasks the way
 * getTasksDueToday() includes overdue-from-before-today ones — My
 * Week's own job is "what's due across this specific week," not a
 * second backlog view. Sorted by due date first (the week's own
 * chronological order), then Must Do -> Important -> Whenever within
 * the same day.
 */
export function getTasksDueInRange(tasks, startDateKey, endDateKey) {
  return (tasks || [])
    .filter((task) => isActiveTask(task) && task.dueDate && task.dueDate >= startDateKey && task.dueDate <= endDateKey)
    .sort((a, b) => {
      const dueDiff = a.dueDate.localeCompare(b.dueDate);
      if (dueDiff !== 0) return dueDiff;
      return PRIORITY_SORT_WEIGHT[a.priority] - PRIORITY_SORT_WEIGHT[b.priority];
    });
}
