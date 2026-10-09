/**
 * ui/views/AssignmentTrackerView.js
 *
 * The classroom-level Assignments landing page — directly mirrors
 * ui/views/NotebookTrackerView.js's own "pure launcher" design (see
 * that file's own header comment): one card per Assignment Category,
 * each a plain, clickable destination straight to its own
 * AssignmentCategoryView.js grid. "Configure Assignment Categories" is
 * the same deliberate doorway-out panel NotebookTrackerView.js uses —
 * configuration lives in Settings, this screen is operational only.
 *
 * Reuses NotebookTrackerView.js's own CSS classes directly
 * (.notebook-tracker__*) rather than a parallel set — the shape (bento
 * card grid, page header, configure-panel) is identical, per explicit
 * instruction to reuse the Notebook architecture rather than building
 * a second one. See css/styles.css's own .notebook-tracker__* rules.
 */

import * as assignmentConfigService from '../../services/assignmentConfigService.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon, createIconBadge } from '../components/Icon.js';

export function renderAssignmentTrackerView(container, { classroom, onBack, onNavigate, onOpenAssignmentConfiguration, onGoToClassMode }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view notebook-tracker-view';

  const header = document.createElement('header');
  header.className = 'notebook-tracker__page-header';
  const backButton = createBackButton(onBack);
  const title = document.createElement('h1');
  title.className = 'notebook-tracker__page-header-title';
  title.textContent = 'Assignments';
  header.append(backButton, title);
  if (onGoToClassMode) {
    const actions = document.createElement('div');
    actions.className = 'notebook-tracker__page-header-actions';
    const classModeButton = document.createElement('button');
    classModeButton.type = 'button';
    classModeButton.className = 'btn btn--ghost btn--icon-only';
    classModeButton.appendChild(createIcon('users'));
    classModeButton.setAttribute('aria-label', 'Class Mode');
    classModeButton.title = 'Class Mode';
    classModeButton.addEventListener('click', onGoToClassMode);
    actions.appendChild(classModeButton);
    header.appendChild(actions);
  }
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content notebook-tracker__content';

  content.appendChild(renderPageIntro());

  const categories = assignmentConfigService.listCategories(classroom);
  if (categories.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'No assignment categories configured yet.' }));
  } else {
    const grid = document.createElement('div');
    grid.className = 'notebook-tracker__bento-grid';
    categories.forEach((category) => {
      grid.appendChild(createAssignmentCategoryCard(category, classroom, onNavigate));
    });
    content.appendChild(grid);
  }

  content.appendChild(createConfigurePanel(onOpenAssignmentConfiguration));

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderPageIntro() {
  const intro = document.createElement('div');
  intro.className = 'notebook-tracker__intro';
  intro.appendChild(createIconBadge('pencil', 'activities', { size: 40 }));

  const text = document.createElement('div');
  text.className = 'notebook-tracker__intro-text';

  const heading = document.createElement('h2');
  heading.className = 'notebook-tracker__intro-heading';
  heading.textContent = 'My Assignments';
  text.appendChild(heading);

  const subtitle = document.createElement('p');
  subtitle.className = 'notebook-tracker__intro-subtitle';
  subtitle.textContent = 'Track worksheets, projects, and other learning tasks across your classes.';
  text.appendChild(subtitle);

  intro.appendChild(text);
  return intro;
}

/** A selectable destination, not an operational status card — same simplicity as NotebookTrackerView.js's own createNotebookTypeCard(). No Subject metadata pill here (Assignments has one flat category level, not Notebook's Subject+Type pair) — the category name itself is the card's whole identity. */
function createAssignmentCategoryCard(category, classroom, onNavigate) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'notebook-tracker__bento-card';
  card.addEventListener('click', () => {
    onNavigate(`/classroom/${classroom.id}/assignments/${category.id}`);
  });

  const top = document.createElement('div');
  top.className = 'notebook-tracker__bento-card-top';
  top.appendChild(createIconBadge('pencil', 'activities', { size: 40 }));

  const arrow = document.createElement('span');
  arrow.className = 'notebook-tracker__bento-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.appendChild(createIcon('arrow-right', { size: 16 }));
  top.appendChild(arrow);
  card.appendChild(top);

  const title = document.createElement('span');
  title.className = 'notebook-tracker__bento-title';
  title.textContent = category.name;
  card.appendChild(title);

  const description = document.createElement('span');
  description.className = 'notebook-tracker__bento-description';
  description.textContent = `Track ${category.name.toLowerCase()} assignments`;
  card.appendChild(description);

  return card;
}

function createConfigurePanel(onOpenAssignmentConfiguration) {
  const panel = document.createElement('div');
  panel.className = 'notebook-tracker__configure-panel';

  panel.appendChild(createIcon('settings', { size: 24, className: 'notebook-tracker__configure-panel-icon' }));

  const heading = document.createElement('p');
  heading.className = 'notebook-tracker__configure-panel-heading';
  heading.textContent = 'Configure Assignment Categories';
  panel.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'notebook-tracker__configure-panel-description';
  description.textContent = 'Add, edit or remove assignment categories for your classrooms.';
  panel.appendChild(description);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--secondary notebook-tracker__configure-panel-button';
  button.textContent = 'Configure Now →';
  button.addEventListener('click', () => onOpenAssignmentConfiguration());
  panel.appendChild(button);

  return panel;
}
