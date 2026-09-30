/**
 * ui/views/MyWorkView.js
 *
 * "My Work" Phase 2 — the first user-facing surface, reached at
 * `#/my-work`. Not classroom-scoped (see js/ui/router.js's own
 * `curriculum-management` route for the identical "flat, top-level,
 * reached from Personal Hub" shape this follows) — a Task belongs to a
 * PERSON, not a classroom, per models/Task.js's own header comment.
 *
 * Scope, deliberately: fast capture, a plain list, create/edit,
 * complete/reopen, delete/archive, priority, due date, workspace,
 * estimated effort, basic status. Explicitly NOT built here (later
 * phases): Focus Sessions, Subtasks UI, ClassMate entity-linking UI,
 * AI/intelligent planning, Open Work merge, Today/This Week task views,
 * or any change to ui/views/PersonalHubView.js's own existing Today/My
 * Week sections — this view is reached by its own new route only.
 *
 * Every mutation goes through services/taskService.js's own pure
 * mutators (never a hand-rolled field assignment here) — this view's
 * only two jobs are rendering and calling repositories/taskRepository.js
 * to persist whatever taskService.js just mutated, the exact same
 * "service mutates, view persists" split every other editor in this app
 * already uses (see ui/views/ChapterPlanEditorView.js's own `persist()`).
 *
 * One-time fetch on mount, no live listener — a personal task list is
 * realistically a few dozen documents a single user owns, the same
 * "simple and explicit over cached and synchronized" reasoning
 * repositories/chapterPlanRepository.js's own header comment already
 * documents for an identically-sized collection.
 */

import * as taskRepository from '../../repositories/taskRepository.js';
import {
  createTaskDraft,
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
} from '../../services/taskService.js';
import { TASK_STATUS, TASK_PRIORITY, TASK_DUE_TYPE, TASK_EFFORT_PRESETS } from '../../models/Task.js';
import { getPriorityDisplay, getStatusLabel, getDueDateLabel, getEffortDisplay, sortTasksForList, isActiveTask } from './MyWorkTaskDisplay.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { getTodayDateKey } from '../../utils/dateHelpers.js';

const PRIORITY_OPTIONS = [TASK_PRIORITY.MUST_DO, TASK_PRIORITY.IMPORTANT, TASK_PRIORITY.WHENEVER];
const DUE_TYPE_OPTIONS = [
  { value: TASK_DUE_TYPE.TODAY, label: 'Today' },
  { value: TASK_DUE_TYPE.TOMORROW, label: 'Tomorrow' },
  { value: TASK_DUE_TYPE.THIS_WEEK, label: 'This week' },
  { value: TASK_DUE_TYPE.CUSTOM, label: 'Custom' },
  { value: TASK_DUE_TYPE.NONE, label: 'No deadline' },
];
const EFFORT_PRESET_OPTIONS = [
  { minutes: TASK_EFFORT_PRESETS.QUICK, label: 'Quick' },
  { minutes: TASK_EFFORT_PRESETS.MEDIUM, label: 'Medium' },
  { minutes: TASK_EFFORT_PRESETS.DEEP_WORK, label: 'Deep Work' },
];

export function renderMyWorkView(container, { currentUser, onBack }) {
  let tasks = null; // null = loading
  let loadError = null;
  let actionError = null;
  let showArchived = false;
  let expandedTaskId = null;
  const todayDateKey = getTodayDateKey();

  function rerender() {
    renderContent(
      container,
      { tasks, loadError, actionError, showArchived, expandedTaskId, todayDateKey },
      {
        onBack,
        onCapture,
        onToggleExpand: (taskId) => {
          expandedTaskId = expandedTaskId === taskId ? null : taskId;
          rerender();
        },
        onToggleShowArchived: () => {
          showArchived = !showArchived;
          rerender();
        },
        onUpdateTitle: (task, title) => persistMutation(task, () => updateTitle(task, title)),
        onUpdateDescription: (task, description) => persistMutation(task, () => updateDescription(task, description)),
        onUpdateWorkspace: (task, workspace) => persistMutation(task, () => updateWorkspace(task, workspace)),
        onUpdatePriority: (task, priority) => persistMutation(task, () => updatePriority(task, priority)),
        onUpdateDueDate: (task, dueType, customDate) => persistMutation(task, () => updateDueDate(task, { dueType, customDate, todayDateKey })),
        onUpdateEstimatedMinutes: (task, minutes) => persistMutation(task, () => updateEstimatedMinutes(task, minutes)),
        onMarkInProgress: (task) => persistMutation(task, () => markInProgress(task)),
        onMarkComplete: (task) => persistMutation(task, () => markComplete(task)),
        onReopen: (task) => persistMutation(task, () => reopenTask(task)),
        onArchive: (task) => persistMutation(task, () => archiveTask(task)),
        onDelete,
      }
    );
  }

  rerender();
  mount();

  async function mount() {
    try {
      tasks = await taskRepository.getTasksForUser(currentUser.uid);
    } catch (error) {
      console.error('[MyWorkView] Failed to load Tasks:', error);
      loadError = "Couldn't load My Work. Check your connection and try again.";
    }
    rerender();
  }

  async function persistMutation(task, mutationFn) {
    try {
      mutationFn();
      actionError = null;
      await taskRepository.saveTask(currentUser.uid, task);
    } catch (error) {
      console.error('[MyWorkView] Failed to save a Task:', error);
      actionError = "Couldn't save that change. Check your connection and try again.";
    }
    rerender();
  }

  async function onCapture(title) {
    let task;
    try {
      task = createTaskDraft({ ownerUid: currentUser.uid, title, todayDateKey });
    } catch (error) {
      actionError = error.message;
      rerender();
      return;
    }
    tasks = [...(tasks || []), task];
    actionError = null;
    rerender();
    try {
      await taskRepository.saveTask(currentUser.uid, task);
    } catch (error) {
      console.error('[MyWorkView] Failed to save a newly-captured Task:', error);
      actionError = "Saved locally, but couldn't reach the server — check your connection.";
      rerender();
    }
  }

  async function onDelete(task) {
    tasks = tasks.filter((t) => t.id !== task.id);
    if (expandedTaskId === task.id) expandedTaskId = null;
    rerender();
    try {
      await taskRepository.deleteTask(currentUser.uid, task.id);
    } catch (error) {
      console.error('[MyWorkView] Failed to delete a Task:', error);
      actionError = "Couldn't delete that task. Check your connection and try again.";
      rerender();
    }
  }
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderContent(container, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'my-work';

  const header = document.createElement('header');
  header.className = 'my-work__header';
  header.appendChild(createBackButton(handlers.onBack));
  const title = document.createElement('h1');
  title.className = 'my-work__title';
  title.textContent = 'My Work';
  header.appendChild(title);
  wrapper.appendChild(header);

  wrapper.appendChild(renderCaptureBar(handlers));

  if (state.actionError) {
    const error = document.createElement('p');
    error.className = 'my-work__error';
    error.textContent = state.actionError;
    wrapper.appendChild(error);
  }

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'my-work__error';
    error.textContent = state.loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (state.tasks === null) {
    const loading = document.createElement('p');
    loading.className = 'my-work__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  const sorted = sortTasksForList(state.tasks);
  const visible = sorted.filter((task) => task.status !== TASK_STATUS.ARCHIVED || state.showArchived);
  const archivedCount = sorted.filter((task) => task.status === TASK_STATUS.ARCHIVED).length;

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'my-work__empty';
    empty.textContent = 'Nothing here yet — capture the first thing you need to do above.';
    wrapper.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'my-work__list';
    visible.forEach((task) => {
      list.appendChild(renderTaskRow(task, { expanded: state.expandedTaskId === task.id, todayDateKey: state.todayDateKey }, handlers));
    });
    wrapper.appendChild(list);
  }

  if (archivedCount > 0) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn--text my-work__archived-toggle';
    toggle.textContent = state.showArchived ? 'Hide archived' : `Show archived (${archivedCount})`;
    toggle.addEventListener('click', handlers.onToggleShowArchived);
    wrapper.appendChild(toggle);
  }

  container.appendChild(wrapper);
}

/** The fast-capture bar — a single text input + Add button, Enter submits. Deliberately the ONLY thing visible before a Task exists; every other field is set later, inline, on the row itself. */
function renderCaptureBar(handlers) {
  const bar = document.createElement('form');
  bar.className = 'my-work__capture-bar';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'my-work__capture-input';
  input.placeholder = "What do you need to do?";
  bar.appendChild(input);

  const addButton = document.createElement('button');
  addButton.type = 'submit';
  addButton.className = 'btn btn--primary my-work__capture-button';
  addButton.appendChild(createIcon('plus', { size: 16 }));
  addButton.append(' Add');
  bar.appendChild(addButton);

  bar.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    handlers.onCapture(title);
    input.value = '';
    input.focus();
  });

  return bar;
}

function renderTaskRow(task, { expanded, todayDateKey }, handlers) {
  const row = document.createElement('div');
  row.className = `my-work__row my-work__row--${task.status}`;

  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'my-work__row-summary';
  summary.addEventListener('click', () => handlers.onToggleExpand(task.id));

  const priority = getPriorityDisplay(task.priority);
  const priorityEl = document.createElement('span');
  priorityEl.className = 'my-work__row-priority';
  priorityEl.textContent = priority.icon;
  priorityEl.setAttribute('aria-label', priority.label);
  summary.appendChild(priorityEl);

  const textWrap = document.createElement('span');
  textWrap.className = 'my-work__row-text';

  const titleEl = document.createElement('span');
  titleEl.className = 'my-work__row-title';
  titleEl.textContent = task.title;
  textWrap.appendChild(titleEl);

  const metaParts = [getStatusLabel(task.status), getDueDateLabel(task, todayDateKey), getEffortDisplay(task.estimatedMinutes), task.workspace].filter(Boolean);
  if (metaParts.length > 0) {
    const metaEl = document.createElement('span');
    metaEl.className = 'my-work__row-meta';
    metaEl.textContent = metaParts.join(' · ');
    textWrap.appendChild(metaEl);
  }

  summary.appendChild(textWrap);
  row.appendChild(summary);

  if (expanded) {
    row.appendChild(renderTaskEditor(task, { todayDateKey }, handlers));
  }

  return row;
}

function renderTaskEditor(task, { todayDateKey }, handlers) {
  const editor = document.createElement('div');
  editor.className = 'my-work__editor';

  const titleLabel = document.createElement('label');
  titleLabel.className = 'my-work__editor-label';
  titleLabel.textContent = 'Title';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'my-work__editor-input';
  titleInput.value = task.title;
  titleInput.addEventListener('change', () => {
    if (titleInput.value.trim()) handlers.onUpdateTitle(task, titleInput.value);
    else titleInput.value = task.title;
  });
  titleLabel.appendChild(titleInput);
  editor.appendChild(titleLabel);

  const descLabel = document.createElement('label');
  descLabel.className = 'my-work__editor-label';
  descLabel.textContent = 'Notes';
  const descInput = document.createElement('textarea');
  descInput.className = 'my-work__editor-input';
  descInput.value = task.description || '';
  descInput.placeholder = 'Optional notes…';
  descInput.addEventListener('change', () => handlers.onUpdateDescription(task, descInput.value));
  descLabel.appendChild(descInput);
  editor.appendChild(descLabel);

  const workspaceLabel = document.createElement('label');
  workspaceLabel.className = 'my-work__editor-label';
  workspaceLabel.textContent = 'Workspace';
  const workspaceInput = document.createElement('input');
  workspaceInput.type = 'text';
  workspaceInput.className = 'my-work__editor-input';
  workspaceInput.value = task.workspace || '';
  workspaceInput.placeholder = 'e.g. Teaching, School, Personal…';
  workspaceInput.addEventListener('change', () => handlers.onUpdateWorkspace(task, workspaceInput.value || null));
  workspaceLabel.appendChild(workspaceInput);
  editor.appendChild(workspaceLabel);

  editor.appendChild(renderPrioritySection(task, handlers));
  editor.appendChild(renderDueDateSection(task, todayDateKey, handlers));
  editor.appendChild(renderEffortSection(task, handlers));
  editor.appendChild(renderStatusActions(task, handlers));

  return editor;
}

function renderPillGroup(sectionLabel, options, isSelected, onSelect) {
  const wrap = document.createElement('div');
  wrap.className = 'my-work__editor-section';
  const label = document.createElement('span');
  label.className = 'my-work__editor-label';
  label.textContent = sectionLabel;
  wrap.appendChild(label);

  const pillRow = document.createElement('div');
  pillRow.className = 'my-work__pill-row';
  options.forEach((option) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `my-work__pill${isSelected(option) ? ' my-work__pill--active' : ''}`;
    pill.textContent = option.pillLabel;
    pill.addEventListener('click', () => onSelect(option));
    pillRow.appendChild(pill);
  });
  wrap.appendChild(pillRow);
  return wrap;
}

function renderPrioritySection(task, handlers) {
  const options = PRIORITY_OPTIONS.map((value) => ({ value, pillLabel: `${getPriorityDisplay(value).icon} ${getPriorityDisplay(value).label}` }));
  return renderPillGroup(
    'Priority',
    options,
    (option) => option.value === task.priority,
    (option) => handlers.onUpdatePriority(task, option.value)
  );
}

function renderDueDateSection(task, todayDateKey, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'my-work__editor-section';
  const label = document.createElement('span');
  label.className = 'my-work__editor-label';
  label.textContent = 'Due';
  wrap.appendChild(label);

  const pillRow = document.createElement('div');
  pillRow.className = 'my-work__pill-row';

  let customDateInput = null;

  DUE_TYPE_OPTIONS.forEach((option) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `my-work__pill${task.dueType === option.value ? ' my-work__pill--active' : ''}`;
    pill.textContent = option.label;
    pill.addEventListener('click', () => {
      if (option.value === TASK_DUE_TYPE.CUSTOM) {
        if (customDateInput) customDateInput.style.display = '';
        return;
      }
      handlers.onUpdateDueDate(task, option.value, null);
    });
    pillRow.appendChild(pill);
  });
  wrap.appendChild(pillRow);

  customDateInput = document.createElement('input');
  customDateInput.type = 'date';
  customDateInput.className = 'my-work__editor-input my-work__custom-date-input';
  customDateInput.value = task.dueType === TASK_DUE_TYPE.CUSTOM && task.dueDate ? task.dueDate : '';
  customDateInput.style.display = task.dueType === TASK_DUE_TYPE.CUSTOM ? '' : 'none';
  customDateInput.addEventListener('change', () => {
    if (customDateInput.value) handlers.onUpdateDueDate(task, TASK_DUE_TYPE.CUSTOM, customDateInput.value);
  });
  wrap.appendChild(customDateInput);

  return wrap;
}

function renderEffortSection(task, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'my-work__editor-section';
  const label = document.createElement('span');
  label.className = 'my-work__editor-label';
  label.textContent = 'Estimated effort';
  wrap.appendChild(label);

  const pillRow = document.createElement('div');
  pillRow.className = 'my-work__pill-row';
  EFFORT_PRESET_OPTIONS.forEach(({ minutes, label: presetLabel }) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `my-work__pill${task.estimatedMinutes === minutes ? ' my-work__pill--active' : ''}`;
    pill.textContent = `${presetLabel} (${minutes}m)`;
    pill.addEventListener('click', () => handlers.onUpdateEstimatedMinutes(task, minutes));
    pillRow.appendChild(pill);
  });
  wrap.appendChild(pillRow);

  const customMinutes = document.createElement('input');
  customMinutes.type = 'number';
  customMinutes.min = '0';
  customMinutes.className = 'my-work__editor-input my-work__custom-minutes-input';
  customMinutes.placeholder = 'Custom minutes…';
  customMinutes.value = task.estimatedMinutes ?? '';
  customMinutes.addEventListener('change', () => {
    const value = customMinutes.value === '' ? null : Number(customMinutes.value);
    handlers.onUpdateEstimatedMinutes(task, value);
  });
  wrap.appendChild(customMinutes);

  return wrap;
}

function renderStatusActions(task, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'my-work__editor-actions';

  if (task.status === TASK_STATUS.TODO) {
    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = 'btn btn--secondary';
    startButton.textContent = 'Start';
    startButton.addEventListener('click', () => handlers.onMarkInProgress(task));
    wrap.appendChild(startButton);
  }

  if (task.status === TASK_STATUS.TODO || task.status === TASK_STATUS.IN_PROGRESS) {
    const completeButton = document.createElement('button');
    completeButton.type = 'button';
    completeButton.className = 'btn btn--primary';
    completeButton.textContent = 'Mark Complete';
    completeButton.addEventListener('click', () => handlers.onMarkComplete(task));
    wrap.appendChild(completeButton);
  }

  if (task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.ARCHIVED) {
    const reopenButton = document.createElement('button');
    reopenButton.type = 'button';
    reopenButton.className = 'btn btn--secondary';
    reopenButton.textContent = 'Reopen';
    reopenButton.addEventListener('click', () => handlers.onReopen(task));
    wrap.appendChild(reopenButton);
  }

  if (task.status !== TASK_STATUS.ARCHIVED) {
    const archiveButton = document.createElement('button');
    archiveButton.type = 'button';
    archiveButton.className = 'btn btn--text';
    archiveButton.textContent = 'Archive';
    archiveButton.addEventListener('click', () => handlers.onArchive(task));
    wrap.appendChild(archiveButton);
  }

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--text btn--danger-text';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', () => {
    if (window.confirm(`Delete "${task.title}"? This can't be undone.`)) handlers.onDelete(task);
  });
  wrap.appendChild(deleteButton);

  return wrap;
}
