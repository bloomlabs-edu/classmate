/**
 * ui/components/OpenWorkWidget.js
 *
 * The first, minimal instance of Open Work — not a Notebook-specific
 * discoverability hack. Aggregates
 * services/workTypes/index.js's own WORK_TYPES.flatMap(type =>
 * type.getActiveWork(classroom)) directly: every domain already in
 * the registry (Notebook, Assessment, Goal Cycle, Learning Activity)
 * contributes here identically, with zero per-domain branching in
 * this file. This widget is meant to survive unchanged into the full
 * Dashboard redesign — it already IS Open Work, scoped for now to a
 * small Dashboard preview rather than its own full page.
 *
 * Reuses ui/components/WorkItemCard.js's own card renderer — the same
 * one ui/views/NotebookTrackerView.js already uses — so this widget
 * and that landing page never render the same plain
 * {title, subtitle, count, navigateTo} shape two different ways.
 *
 * Each item's own `navigateTo` is a plain route path string; this
 * widget calls onNavigate(item.navigateTo) directly and generically —
 * it has no idea which WorkType an item came from, and doesn't need
 * to.
 */

import { WORK_TYPES } from '../../services/workTypes/index.js';
import { createWorkItemCard } from './WorkItemCard.js';
import { createEmptyStateElement } from './EmptyState.js';
import { createIcon } from './Icon.js';

const PREVIEW_LIMIT = 4;

export function createOpenWorkWidgetElement({ classroom, onNavigate }) {
  const widget = document.createElement('div');
  widget.className = 'dashboard-widget dashboard-widget--focus';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-widget__heading';
  heading.appendChild(createIcon('trending-up', { size: 18 }));
  heading.append('Open Work');
  widget.appendChild(heading);

  const activeWork = WORK_TYPES.flatMap((type) => type.getActiveWork(classroom));

  if (activeWork.length === 0) {
    widget.appendChild(createEmptyStateElement({ message: 'Nothing open right now. Nice work.' }));
    return widget;
  }

  const list = document.createElement('div');
  list.className = 'open-work-widget__list';

  activeWork.slice(0, PREVIEW_LIMIT).forEach((item) => {
    list.appendChild(createWorkItemCard(item, 'Continue', onNavigate));
  });
  widget.appendChild(list);

  const remaining = activeWork.length - PREVIEW_LIMIT;
  if (remaining > 0) {
    const moreLine = document.createElement('p');
    moreLine.className = 'dashboard-widget__stat-line open-work-widget__more';
    moreLine.textContent = `+${remaining} more open`;
    widget.appendChild(moreLine);
  }

  return widget;
}
