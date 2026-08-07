/**
 * ui/components/WorkItemCard.js
 *
 * Renders one plain WorkType item — { title, subtitle, count,
 * navigateTo } — as an operational card. No domain awareness
 * whatsoever: this same function renders a Notebook card, an
 * Assessment card, a Goal Cycle card, or a Learning Activity card
 * identically, since every WorkType already hands back this exact
 * shape (see services/workTypes/workTypeContract.js). Extracted from
 * ui/views/NotebookTrackerView.js, which originally defined this
 * locally — now shared with ui/components/OpenWorkWidget.js so the
 * two never duplicate the same rendering logic.
 */

export function createWorkItemCard(item, buttonLabel, onNavigate) {
  const card = document.createElement('div');
  card.className = 'notebook-tracker__card';

  const titleEl = document.createElement('p');
  titleEl.className = 'notebook-tracker__card-title';
  titleEl.textContent = item.title;
  card.appendChild(titleEl);

  const subtitleEl = document.createElement('p');
  subtitleEl.className = 'notebook-tracker__card-subtitle';
  subtitleEl.textContent = item.count !== undefined ? `${item.count} ${item.subtitle}` : item.subtitle || 'No active work';
  card.appendChild(subtitleEl);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary';
  button.textContent = buttonLabel;
  button.addEventListener('click', () => onNavigate(item.navigateTo));
  card.appendChild(button);

  return card;
}
