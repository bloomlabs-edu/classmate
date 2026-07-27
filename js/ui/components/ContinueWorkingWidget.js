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
 * Also carries the "📚 Manage Lessons" entry point into Learning
 * Record (see ui/views/LearningRecordView.js, docs/LEARNING_RECORD.md)
 * — a deliberate, explicit product decision, not a data widget the
 * feature happens to live inside. After Learning Record's entry point
 * broke twice in a row on hidden wiring (see this project's
 * CHANGELOG), this button is intentionally large, colored, and
 * labeled with an emoji specifically so it cannot be mistaken for a
 * secondary/optional action — it's the first thing in this card,
 * before the heading, not a small chip tucked into a header row. This
 * card was chosen as its home specifically because — unlike most of
 * this Dashboard's widgets — it always renders regardless of
 * classroom state (see this file's own empty-state branch below, and
 * ui/views/DashboardView.js's pre-roster welcome screen, which shows
 * the same button when there's no roster yet at all). The button is
 * unconditional: it's always in the returned element regardless of
 * whether there are any recent notebooks to show.
 *
 * Purely props-driven, like every other component in this app: the
 * view (ui/views/DashboardView.js) does the async fetch and the
 * subject/notebook-type name lookups; this file only renders what it's
 * handed.
 */

import { createEmptyStateElement } from './EmptyState.js';
import { createIcon } from './Icon.js';

export function createContinueWorkingWidgetElement({ entries, onOpenNotebook, onManageLessons }) {
  const widget = document.createElement('div');
  widget.className = 'dashboard-widget';

  if (onManageLessons) {
    const manageLessonsButton = document.createElement('button');
    manageLessonsButton.type = 'button';
    manageLessonsButton.className = 'dashboard-widget__manage-lessons-button';
    manageLessonsButton.append('\ud83d\udcda Manage Lessons');
    manageLessonsButton.addEventListener('click', onManageLessons);
    widget.appendChild(manageLessonsButton);
  }

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
