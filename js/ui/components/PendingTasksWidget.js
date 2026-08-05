/**
 * ui/components/PendingTasksWidget.js
 *
 * Classroom Dashboard widget: consumes services/pendingTaskService.js's
 * getPendingTasks() directly. Purely a rendering layer — task detection
 * logic all lives in that service (see docs/PROGRESS_ENGINE.md §9).
 *
 * Phase 4: each item is clickable via the optional onSelectTask
 * callback, deep-linking straight to the relevant screen.
 *
 * Phase 5 (motion): when an item that was pending a moment ago is no
 * longer returned by getPendingTasks() (a notebook got checked, an
 * activity got marked), it briefly reappears as a success-colored,
 * collapsing line rather than just vanishing — "combine a brief success
 * indication with a height collapse to prevent abrupt layout shifts."
 *
 * This requires remembering what was pending on the *previous* render,
 * which this otherwise-pure rendering module doesn't normally need —
 * a small, deliberate exception, kept as narrow as possible: a
 * module-level map from classroomId to a snapshot of {key -> label},
 * compared each render purely to compute what just disappeared. Nothing
 * here writes to Firestore or calls any service beyond the existing
 * read; it's bookkeeping for one visual effect, not new application
 * state.
 */

import * as pendingTaskService from '../../services/pendingTaskService.js';
import { createEmptyStateElement } from './EmptyState.js';
import { createIcon } from './Icon.js';

const previousSnapshotByClassroomId = new Map();

function getItemKey(groupId, item) {
  if (item.activityId) return `${groupId}:activity:${item.activityId}`;
  if (item.requestId) return `${groupId}:work-request:${item.requestId}`;
  return `${groupId}:notebook:${item.subjectId}:${item.notebookTypeId}:${item.dateKey || 'today'}`;
}

function getItemLabel(item) {
  return item.count ? `${item.description} (${item.count})` : item.description;
}

export function createPendingTasksWidgetElement({ classroom, onSelectTask }) {
  const widget = document.createElement('div');
  widget.className = 'dashboard-widget dashboard-widget--focus';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-widget__heading';
  heading.appendChild(createIcon('clipboard-list', { size: 18 }));
  heading.append('Pending Tasks');
  widget.appendChild(heading);

  const taskGroups = pendingTaskService.getPendingTasks(classroom);

  const currentSnapshot = new Map();
  taskGroups.forEach((group) => {
    group.items.forEach((item) => {
      currentSnapshot.set(getItemKey(group.id, item), getItemLabel(item));
    });
  });

  const previousSnapshot = previousSnapshotByClassroomId.get(classroom.id) || new Map();
  const justResolvedLabels = [];
  previousSnapshot.forEach((label, key) => {
    if (!currentSnapshot.has(key)) justResolvedLabels.push(label);
  });
  previousSnapshotByClassroomId.set(classroom.id, currentSnapshot);

  if (justResolvedLabels.length > 0) {
    const resolvedList = document.createElement('ul');
    resolvedList.className = 'dashboard-widget__resolved-list';

    justResolvedLabels.forEach((label) => {
      const item = document.createElement('li');
      item.className = 'dashboard-widget__resolved-item';
      item.textContent = `\u2713 ${label}`;
      resolvedList.appendChild(item);

      // Mounted in its normal (visible) state first, then the collapsing
      // class is added a frame later — the standard technique for
      // animating an element's exit via CSS transitions, which need a
      // real starting state to transition from.
      requestAnimationFrame(() => {
        item.classList.add('dashboard-widget__resolved-item--collapsing');
      });
    });

    widget.appendChild(resolvedList);
  }

  if (taskGroups.length === 0) {
    widget.appendChild(createEmptyStateElement({ message: 'You\u2019re all caught up. Nice work.' }));
    return widget;
  }

  const totalItemCount = taskGroups.reduce((sum, group) => sum + group.items.length, 0);

  const detailContainer = document.createElement('div');
  detailContainer.className = 'task-detail-container task-detail-container--collapsed';

  taskGroups.forEach((group) => {
    const groupHeading = document.createElement('h3');
    groupHeading.className = 'dashboard-widget__subheading task-group-heading';
    const groupIconBadge = createIcon(group.icon, { className: 'task-group-heading__icon', size: 16 });
    groupHeading.append(groupIconBadge, ` ${group.label} (${group.items.length})`);
    detailContainer.appendChild(groupHeading);

    const list = document.createElement('ul');
    list.className = 'checklist';

    group.items.forEach((item) => {
      const listItem = document.createElement('li');
      listItem.className = 'checklist__row';
      const label = getItemLabel(item);

      const box = document.createElement('span');
      box.className = 'checklist__box';
      box.setAttribute('aria-hidden', 'true');
      listItem.appendChild(box);

      if (onSelectTask) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'checklist__label checklist__label--button';
        button.textContent = label;
        button.addEventListener('click', () => onSelectTask(group.id, item));
        listItem.appendChild(button);
      } else {
        const span = document.createElement('span');
        span.className = 'checklist__label';
        span.textContent = label;
        listItem.appendChild(span);
      }

      const chevron = document.createElement('span');
      chevron.className = 'checklist__chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '\u203a';
      listItem.appendChild(chevron);

      list.appendChild(listItem);
    });

    detailContainer.appendChild(list);
  });

  // Collapsed by default — a compact summary line + one toggle button,
  // rather than every item's row always visible. Matches the same
  // expand/collapse pattern LeaderboardList.js already uses for "Show
  // all," so this isn't a new interaction idiom for the app.
  const summaryLine = document.createElement('p');
  summaryLine.className = 'dashboard-widget__stat-line task-summary-line';
  summaryLine.textContent = `${totalItemCount} task${totalItemCount === 1 ? '' : 's'} need your attention.`;
  widget.appendChild(summaryLine);

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'btn btn--text task-detail-toggle';
  toggleButton.textContent = 'View pending tasks';
  toggleButton.addEventListener('click', () => {
    const isCollapsed = detailContainer.classList.toggle('task-detail-container--collapsed');
    toggleButton.textContent = isCollapsed ? 'View pending tasks' : 'Hide pending tasks';
  });
  widget.appendChild(toggleButton);
  widget.appendChild(detailContainer);

  return widget;
}
