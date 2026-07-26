/**
 * ui/components/ContinueWorkingWidget.js
 *
 * Classroom Dashboard widget: this teacher's own recently-opened
 * notebooks, filtered to the classroom currently being viewed (the
 * underlying list is per-teacher across every classroom they have —
 * see services/continueWorkingService.js and
 * docs/PROGRESS_ENGINE.md §10 — so filtering to "this classroom" is a
 * display-time concern, not a storage-time one).
 *
 * Purely props-driven, like every other component in this app: the
 * view (ui/views/DashboardView.js) does the async fetch and the
 * subject/notebook-type name lookups; this file only renders what it's
 * handed.
 */

import { createEmptyStateElement } from './EmptyState.js';
import { createIcon } from './Icon.js';

export function createContinueWorkingWidgetElement({ entries, onOpenNotebook }) {
  const widget = document.createElement('div');
  widget.className = 'dashboard-widget';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-widget__heading';
  heading.appendChild(createIcon('clock', { size: 18 }));
  heading.append('Continue Working');
  widget.appendChild(heading);

  if (entries.length === 0) {
    widget.appendChild(createEmptyStateElement({ message: 'Notebooks you open will show up here.' }));
    return widget;
  }

  const list = document.createElement('div');
  list.className = 'dashboard-widget__chip-list';

  entries.forEach((entry) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'dashboard-widget__chip';
    chip.textContent = `${entry.subjectName} \u00b7 ${entry.notebookTypeName}`;
    chip.addEventListener('click', () => onOpenNotebook(entry.subjectId, entry.notebookTypeId));
    list.appendChild(chip);
  });

  widget.appendChild(list);
  return widget;
}
