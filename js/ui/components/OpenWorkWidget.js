/**
 * ui/components/OpenWorkWidget.js
 *
 * Open Work — a deliberately teacher-curated Dashboard section, per
 * explicit product decision. Nothing appears here automatically:
 * each WorkType's own getActiveWork() (see
 * services/workTypes/index.js) now filters to items the teacher has
 * explicitly pinned (item.pinnedToDashboard === true) before this
 * widget ever sees them — pinning itself is a real, existing-model
 * field (see e.g. models/WorkRequest.js), set from each domain's own
 * existing teacher-facing screen (its own "📌 Pin to Dashboard"
 * action), never decided here. This widget still has zero domain
 * awareness at all — it doesn't know or care that filtering happened
 * upstream.
 *
 * When nothing is pinned at all, this returns null rather than an
 * empty-state placeholder — the section is meant to disappear
 * entirely, not show "Nothing pinned yet." The caller
 * (ui/views/DashboardView.js) is responsible for skipping the
 * append when this returns null.
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
import { createIcon } from './Icon.js';

const PREVIEW_LIMIT = 4;

export function createOpenWorkWidgetElement({ classroom, onNavigate }) {
  const activeWork = WORK_TYPES.flatMap((type) => type.getActiveWork(classroom));

  if (activeWork.length === 0) {
    return null;
  }

  const widget = document.createElement('div');
  widget.className = 'dashboard-widget dashboard-widget--focus';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-widget__heading';
  heading.appendChild(createIcon('trending-up', { size: 18 }));
  heading.append('Open Work');
  widget.appendChild(heading);

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
