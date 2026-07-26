/**
 * ui/components/RecognitionWidget.js
 *
 * The Recognition Wall — the Dashboard's top section, and the "breadth"
 * view: every category at a glance, this week only, no depth. The
 * dedicated Recognition Screen (ui/views/RecognitionScreenView.js) is
 * the "depth" counterpart — one category in focus, full leaderboard,
 * every period. Entirely config-driven: iterates
 * config/recognitionCategories.js and asks
 * services/studentProgressService.js for this week's winner(s) of each.
 *
 * Renders each category using the shared ui/components/RecognitionCard.js
 * (compact variant) — this file used to have its own private card-building
 * function; it's been removed in favor of the shared component so the
 * Wall and the Recognition Screen never drift apart in how a winner is
 * displayed.
 *
 * Categories with no winner this week are omitted individually (not
 * shown with a "no winner" placeholder each) — if literally nothing has
 * a winner yet, the whole widget shows one overall empty state instead.
 */

import { RECOGNITION_CATEGORIES } from '../../config/recognitionCategories.js';
import * as studentProgressService from '../../services/studentProgressService.js';
import { createRecognitionCardElement } from './RecognitionCard.js';
import { createEmptyStateElement } from './EmptyState.js';
import { createIcon } from './Icon.js';

export function createRecognitionWidgetElement({ classroom, onViewAll }) {
  const widget = document.createElement('div');
  widget.className = 'dashboard-widget dashboard-widget--recognition dashboard-widget--celebrate';

  const header = document.createElement('div');
  header.className = 'dashboard-widget__header-row';
  const heading = document.createElement('h2');
  heading.className = 'dashboard-widget__heading';
  heading.textContent = '\ud83c\udfc6 Recognition Wall';
  header.appendChild(heading);

  if (onViewAll) {
    const viewAllLink = document.createElement('button');
    viewAllLink.type = 'button';
    viewAllLink.className = 'btn btn--text';
    viewAllLink.append('View All ');
    viewAllLink.appendChild(createIcon('arrow-right', { size: 16 }));
    viewAllLink.addEventListener('click', onViewAll);
    header.appendChild(viewAllLink);
  }

  widget.appendChild(header);

  const categoriesWithWinners = RECOGNITION_CATEGORIES.filter((category) => category.periods.includes('week'))
    .map((category) => ({
      category,
      winners: studentProgressService.getRecognitionWinners(classroom, category.id, 'week'),
    }))
    .filter((entry) => entry.winners.length > 0);

  if (categoriesWithWinners.length === 0) {
    widget.appendChild(createEmptyStateElement({ message: 'The week is just getting started \u2014 recognitions will appear here soon.' }));
    return widget;
  }

  const cardRow = document.createElement('div');
  cardRow.className = 'recognition-card-row';

  categoriesWithWinners.forEach(({ category, winners }) => {
    cardRow.appendChild(createRecognitionCardElement({ category, winners, period: 'week', variant: 'compact' }));
  });

  widget.appendChild(cardRow);
  return widget;
}
