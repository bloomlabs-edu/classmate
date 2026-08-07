/**
 * ui/components/OperationalWorkCard.js
 *
 * A large, rounded, touch-friendly operational card — deliberately
 * richer than ui/components/WorkItemCard.js's own compact rendering,
 * for full-page dashboard contexts (ui/views/NotebookTrackerView.js
 * today) rather than a space-constrained Dashboard widget preview
 * (ui/components/OpenWorkWidget.js, which keeps using WorkItemCard.js
 * unchanged — a different context with different constraints, not an
 * oversight).
 *
 * This is a pure presentation-layer redesign: consumes exactly the
 * same frozen WorkType shape — { title, subtitle, count, navigateTo }
 * — as WorkItemCard.js already does, with zero domain awareness of
 * its own. No service changed, no WorkType interface changed, no new
 * data introduced. The decorative "📓 Notebook Check" label above the
 * title is static and identical on every card on this page — it is
 * NOT sourced from the item at all, since every card on this specific
 * page is already known to be notebook-shaped; it exists purely to
 * give the eye a category anchor before it reaches the real title,
 * matching the "icon → title → status → action" reading order this
 * card is built around.
 *
 * The eye should land, in order: the decorative category label
 * (fastest to ignore once familiar), the real title (identity —
 * "what is this"), the real status line (operational state), the one
 * clear CTA. Never more than one button per card.
 */

export function createOperationalWorkCard(item, buttonLabel, onNavigate, { categoryIcon = '\ud83d\udcd3', categoryLabel = 'Notebook Check' } = {}) {
  const card = document.createElement('div');
  card.className = 'operational-work-card';

  const category = document.createElement('p');
  category.className = 'operational-work-card__category';
  category.textContent = `${categoryIcon} ${categoryLabel}`;
  card.appendChild(category);

  const title = document.createElement('p');
  title.className = 'operational-work-card__title';
  title.textContent = item.title;
  card.appendChild(title);

  const status = document.createElement('p');
  status.className = 'operational-work-card__status';
  status.textContent = item.count !== undefined ? `${item.count} ${item.subtitle}` : item.subtitle || 'No active notebook check';
  card.appendChild(status);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary operational-work-card__action';
  button.textContent = buttonLabel;
  button.addEventListener('click', () => onNavigate(item.navigateTo));
  card.appendChild(button);

  return card;
}
