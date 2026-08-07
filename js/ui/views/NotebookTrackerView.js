/**
 * ui/views/NotebookTrackerView.js
 *
 * The classroom-level Notebook landing page — an OPERATIONAL
 * workspace, not a configuration list. Renders directly from
 * services/workTypes/NotebookWorkType.js's own getActiveWork()/
 * getStartActions() — this view contains zero notebook-specific
 * business logic itself; every card's title/subtitle/count/
 * navigateTo already came fully-formed from NotebookWorkType, per the
 * frozen WorkType architecture ("Dashboard owns all presentation...
 * WorkType orchestrates domain services, never duplicates business
 * logic").
 *
 * Deliberately built as a preview of the future, unified Open Work
 * section (Phase 3/4), scoped to one WorkType today — the card
 * renderer itself (createWorkItemCard()) takes only the plain
 * {title, subtitle, count, navigateTo} shape and has no notebook
 * awareness at all, so it can be reused unchanged once Open Work
 * aggregates across every WorkType, rather than being rebuilt then.
 *
 * "⚙ Configure Notebook Types" is deliberately phrased as a doorway
 * out, not an action that belongs to this screen — per the frozen
 * Operational Work / Configuration boundary, this tracker is
 * operational; adding a new Subject/Notebook Type is configuration,
 * and the link should read as "you are about to leave this space,"
 * not as "this is one more thing this screen does." It links straight
 * to the existing Settings → Notebooks screen; nothing here duplicates
 * that screen's own creation form.
 */

import { NotebookWorkType } from '../../services/workTypes/NotebookWorkType.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';

export function renderNotebookTrackerView(container, { classroom, onBack, onNavigate, onOpenNotebookConfiguration }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  const backButton = createBackButton(onBack);
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Notebook Tracker';
  header.append(backButton, title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content notebook-tracker__content';

  const activeWork = NotebookWorkType.getActiveWork(classroom);
  const startActions = NotebookWorkType.getStartActions(classroom);

  if (activeWork.length === 0 && startActions.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'No subjects or notebook types configured yet.' }));
  } else {
    activeWork.forEach((item) => {
      content.appendChild(createWorkItemCard(item, 'Continue', onNavigate));
    });
    startActions.forEach((item) => {
      content.appendChild(createWorkItemCard(item, item.title, onNavigate));
    });
  }

  content.appendChild(createConfigureNotebookTypesLink(onOpenNotebookConfiguration));

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

/**
 * Renders one plain {title, subtitle, count, navigateTo} item as an
 * operational card — no notebook-specific knowledge here at all; this
 * same function is meant to keep working unchanged once Open Work
 * aggregates cards from every WorkType, not only Notebook's own.
 */
function createWorkItemCard(item, buttonLabel, onNavigate) {
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

/**
 * Deliberately styled and worded as a doorway out of this operational
 * screen, not an action this screen performs — see this file's own
 * header comment for why "⚙ Configure" rather than "+ Add" is the
 * correct grammar here.
 */
function createConfigureNotebookTypesLink(onOpenNotebookConfiguration) {
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'notebook-tracker__configure-link';
  link.textContent = '\u2699 Configure Notebook Types';
  link.addEventListener('click', () => onOpenNotebookConfiguration());
  return link;
}
