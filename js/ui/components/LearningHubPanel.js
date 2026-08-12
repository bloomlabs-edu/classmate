/**
 * ui/components/LearningHubPanel.js
 *
 * Learning Hub as a dormant plugin, not a permanent ClassMate page
 * section. openLearningHubPanel() mounts a right-side drawer on top
 * of the existing ClassMate workspace via the same .modal-overlay
 * backdrop mechanism ui/components/AssignCurriculumModal.js already
 * established (fixed, full-viewport, click-outside-to-close) — this
 * file adds a new, side-anchored panel variant rather than reusing
 * .modal itself, since that's centered, not a drawer.
 *
 * Per explicit product decision, this drawer is resource-discovery
 * ONLY — Learning Hub Pack association does not live here at all.
 * That control (renderUnitPackControl(), unmodified) is rendered
 * directly on the Unit page itself (see
 * ui/views/LearningManagementView.js), not inside this file, and this
 * file never imports or references it.
 *
 * Concept-aware: when `concept` is a real, specific Concept (passed
 * by the caller — either ui/views/ConceptWorkspaceView.js's own
 * screen for one unambiguous Concept, or LearningManagementView.js's
 * Unit-level list when it has exactly one Concept), the panel shows
 * "Resources for: {concept.title}" and pre-fills search with it. This
 * is a starting point, never a restriction — the teacher can clear or
 * replace the query at any time, and "Use for this concept" always
 * targets the exact concept the panel currently knows, with zero
 * separate "which Concept?" step needed at all in that case. When no
 * single Concept is known (the Unit-level list with zero or several
 * Concepts), the existing "which Concept?" chooser step still applies
 * after a result is picked — unchanged from before.
 *
 * fetchLearningHubCatalogue()/groupExperiencesByType() are reused
 * completely unmodified (services/learningHubCatalogueService.js) —
 * no rewrite of the underlying search logic, only of how its states
 * are now genuinely distinguished (loading vs. loaded-with-no-query
 * vs. no-matches vs. real fetch failure — see renderResults() below).
 * Selecting a result still calls the exact same, existing
 * handlers.onPickLearningHubExperience()/onUseLearningHubResourceForConcept()
 * (see ui/views/LearningManagementView.js's own closure) — this file
 * has no resource-creation logic of its own at all.
 */

import { fetchLearningHubCatalogue, groupExperiencesByType } from '../../services/learningHubCatalogueService.js';
import { LEARNING_HUB_TYPE_GROUP_LABELS, buildLearningHubLaunchUrl } from '../views/ConceptWorkspaceView.js';
import { createEmptyStateElement } from './EmptyState.js';
import { createNavigationRow } from './NavigationRow.js';

/**
 * Opens the panel.
 *
 * `concept` — a specific, unambiguous Concept if the caller knows
 * one (see this file's own header comment); otherwise null.
 * `unit` — always required, for the Unit-level "which Concept?" step
 * when `concept` itself is null and the Unit has more than one.
 *
 * `handlers` must provide: onPickLearningHubExperience,
 * onUseLearningHubResourceForConcept, onCancelPendingLearningHubExperience
 * — the exact same handlers already used before this change.
 *
 * Returns { close, rerender }.
 */
export function openLearningHubPanel({ concept, unit, pendingLearningHubExperience, handlers, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay learning-hub-panel-overlay';

  const panel = document.createElement('div');
  panel.className = 'learning-hub-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Learning Hub');

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    if (onClose) onClose();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  const header = document.createElement('div');
  header.className = 'learning-hub-panel__header';

  const headerTopRow = document.createElement('div');
  headerTopRow.className = 'learning-hub-panel__header-top-row';

  const brand = document.createElement('div');
  brand.className = 'learning-hub-panel__brand';
  const icon = document.createElement('span');
  icon.className = 'learning-hub-panel__icon';
  icon.textContent = '\ud83d\udcda';
  icon.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'learning-hub-panel__name';
  name.textContent = 'Learning Hub';
  brand.append(icon, name);
  headerTopRow.appendChild(brand);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'learning-hub-panel__close';
  closeButton.setAttribute('aria-label', 'Close Learning Hub');
  closeButton.textContent = '\u00d7';
  closeButton.addEventListener('click', close);
  headerTopRow.appendChild(closeButton);

  header.appendChild(headerTopRow);

  const subtitle = document.createElement('p');
  subtitle.className = 'learning-hub-panel__subtitle';
  subtitle.textContent = 'Find resources for your lesson';
  header.appendChild(subtitle);

  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'learning-hub-panel__body';
  panel.appendChild(body);

  function rerender(nextPendingLearningHubExperience) {
    renderLearningHubSearchBody(body, { concept, unit }, nextPendingLearningHubExperience, handlers);
  }

  rerender(pendingLearningHubExperience);

  return { close, rerender };
}

function renderLearningHubSearchBody(container, { concept, unit }, pendingLearningHubExperience, handlers) {
  container.innerHTML = '';

  if (pendingLearningHubExperience) {
    if (concept) {
      handlers.onUseLearningHubResourceForConcept(pendingLearningHubExperience, concept);
      return;
    }

    if (unit.concepts.length === 0) {
      container.appendChild(createEmptyStateElement({ message: 'Add a Concept first \u2014 then you can use this resource for it.' }));
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn btn--text';
      cancelButton.textContent = 'Cancel';
      cancelButton.addEventListener('click', handlers.onCancelPendingLearningHubExperience);
      container.appendChild(cancelButton);
      return;
    }

    const prompt = document.createElement('p');
    prompt.className = 'concept-workspace__tab-intro';
    prompt.textContent = `Use "${pendingLearningHubExperience.title}" for which Concept?`;
    container.appendChild(prompt);

    const list = document.createElement('div');
    list.className = 'learning-management__subject-card-list';
    unit.concepts.forEach((unitConcept) => {
      list.appendChild(createNavigationRow({ label: unitConcept.title, onClick: () => handlers.onUseLearningHubResourceForConcept(pendingLearningHubExperience, unitConcept) }));
    });
    container.appendChild(list);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', handlers.onCancelPendingLearningHubExperience);
    container.appendChild(cancelButton);
    return;
  }

  const initialQuery = concept ? concept.title : (unit.concepts.length === 1 ? unit.concepts[0].title : '');
  if (concept) {
    const contextLabel = document.createElement('p');
    contextLabel.className = 'learning-hub-panel__context-label';
    contextLabel.textContent = 'Working on';
    container.appendChild(contextLabel);
    const contextTitle = document.createElement('p');
    contextTitle.className = 'learning-hub-panel__context-title';
    contextTitle.textContent = concept.title;
    container.appendChild(contextTitle);
  }

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search concepts, missions, subjects\u2026';
  searchInput.className = 'concept-workspace__learning-hub-search';
  searchInput.value = initialQuery;
  container.appendChild(searchInput);

  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'concept-workspace__learning-hub-results';
  container.appendChild(resultsContainer);

  function renderLoading() {
    resultsContainer.innerHTML = '';
    const loadingMessage = document.createElement('p');
    loadingMessage.className = 'concept-workspace__tab-intro';
    loadingMessage.textContent = 'Loading Learning Hub\u2026';
    resultsContainer.appendChild(loadingMessage);
  }

  function loadAndRender() {
    renderLoading();

    fetchLearningHubCatalogue().then((experiences) => {
      const genuinelyFailed = experiences.length === 0;

      function renderResults(filterText) {
        resultsContainer.innerHTML = '';

        if (genuinelyFailed) {
          resultsContainer.appendChild(createEmptyStateElement({ message: "Learning Hub couldn't be loaded right now." }));
          const retryButton = document.createElement('button');
          retryButton.type = 'button';
          retryButton.className = 'btn btn--text';
          retryButton.textContent = 'Retry';
          retryButton.addEventListener('click', loadAndRender);
          resultsContainer.appendChild(retryButton);
          return;
        }

        const filtered = filterText
          ? experiences.filter((experience) => experience.title.toLowerCase().includes(filterText.toLowerCase()))
          : experiences;

        if (filtered.length === 0) {
          resultsContainer.appendChild(createEmptyStateElement({ message: 'No Learning Hub resources found for this search.' }));
          return;
        }

        const groupsHeading = document.createElement('p');
        groupsHeading.className = 'concept-workspace__learning-hub-group-heading';
        groupsHeading.textContent = filterText ? 'Results' : (concept ? 'Recommended for this concept' : 'Recommended');
        resultsContainer.appendChild(groupsHeading);

        const groups = groupExperiencesByType(filtered);
        groups.forEach((experiencesOfType, type) => {
          experiencesOfType.forEach((experience) => {
            const card = document.createElement('div');
            card.className = 'learning-management__learning-hub-result-card';

            const textWrap = document.createElement('div');
            textWrap.className = 'learning-management__learning-hub-result-text';
            const titleEl = document.createElement('p');
            titleEl.className = 'learning-management__learning-hub-result-title';
            titleEl.textContent = experience.title;
            const typeEl = document.createElement('p');
            typeEl.className = 'learning-management__learning-hub-result-type';
            typeEl.textContent = LEARNING_HUB_TYPE_GROUP_LABELS[type] || type;
            textWrap.append(titleEl, typeEl);
            if (experience.description) {
              const descriptionEl = document.createElement('p');
              descriptionEl.className = 'learning-management__learning-hub-result-description';
              descriptionEl.textContent = experience.description;
              textWrap.appendChild(descriptionEl);
            }
            card.appendChild(textWrap);

            const actions = document.createElement('div');
            actions.className = 'learning-hub-panel__result-actions';

            const previewButton = document.createElement('button');
            previewButton.type = 'button';
            previewButton.className = 'btn btn--text';
            previewButton.textContent = 'Preview';
            previewButton.addEventListener('click', () => {
              window.open(buildLearningHubLaunchUrl(experience.type, experience.id), '_blank');
            });
            actions.appendChild(previewButton);

            const useButton = document.createElement('button');
            useButton.type = 'button';
            useButton.className = 'btn btn--secondary';
            useButton.textContent = 'Use for this concept';
            useButton.addEventListener('click', () => handlers.onPickLearningHubExperience(experience, concept ? { concepts: [concept] } : unit));
            actions.appendChild(useButton);

            card.appendChild(actions);
            resultsContainer.appendChild(card);
          });
        });
      }

      renderResults(searchInput.value);
      searchInput.oninput = () => renderResults(searchInput.value);
    });
  }

  loadAndRender();
}
