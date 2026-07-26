/**
 * ui/components/SubjectsWidget.js
 *
 * Classroom Dashboard widget: a compact list of configured Subjects.
 * Reuses Notebook Tracker rather than duplicating any notebook
 * management — clicking a subject navigates to the existing, unfiltered
 * Notebook Tracker list (see main.js), which already groups its rows by
 * subject. True per-subject filtering would mean modifying
 * NotebookTrackerView.js, which this phase's "existing modules remain
 * their existing implementation" constraint argues against — flagged
 * as an open question rather than decided silently (see Phase 2's
 * CHANGELOG entry).
 *
 * Phase 7B: rendered as a "waypoint list" — chips connected by a thin
 * line with a trailing chevron, evoking stops on a path rather than a
 * plain tag list. This is Navigation-intent's distinct shape language
 * (see CHANGELOG's Phase 7B entry) — distinct from Groups' overlapping
 * avatar clusters below it on the same Dashboard.
 */

import * as notebookConfigService from '../../services/notebookConfigService.js';
import { createEmptyStateElement } from './EmptyState.js';
import { createIconBadge } from './Icon.js';

export function createSubjectsWidgetElement({ classroom, onOpenNotebookTracker }) {
  const widget = document.createElement('div');
  widget.className = 'dashboard-widget';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-widget__heading';
  heading.appendChild(createIconBadge('book-open', 'notebook', { size: 28 }));
  heading.append('Subjects');
  widget.appendChild(heading);

  const subjects = notebookConfigService.listSubjects(classroom);

  if (subjects.length === 0) {
    widget.appendChild(createEmptyStateElement({ message: 'Add a subject in Settings to get started.' }));
    return widget;
  }

  const list = document.createElement('div');
  list.className = 'waypoint-list';

  subjects.forEach((subject, index) => {
    if (index > 0) {
      const connector = document.createElement('span');
      connector.className = 'waypoint-list__connector';
      connector.setAttribute('aria-hidden', 'true');
      list.appendChild(connector);
    }

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'waypoint-list__chip';
    chip.textContent = subject.name;
    chip.addEventListener('click', onOpenNotebookTracker);
    list.appendChild(chip);
  });

  const trailingChevron = document.createElement('span');
  trailingChevron.className = 'waypoint-list__chevron';
  trailingChevron.setAttribute('aria-hidden', 'true');
  trailingChevron.textContent = '\u203a';
  list.appendChild(trailingChevron);

  widget.appendChild(list);
  return widget;
}
