/**
 * ui/components/LearningHubPanel.js
 *
 * Learning Hub as a dormant plugin, not a permanent ClassMate page
 * section — per explicit product decision. openLearningHubPanel()
 * mounts a right-side drawer (near-full-screen on narrow viewports —
 * see css/styles.css's own media query) on top of the existing
 * ClassMate workspace via the same .modal-overlay backdrop mechanism
 * ui/components/AssignCurriculumModal.js already established
 * (fixed, full-viewport, click-outside-to-close) — this file adds a
 * new, side-anchored panel variant rather than reusing .modal itself,
 * since that's centered, not a drawer.
 *
 * The search body itself (renderLearningHubSearchBody) is the exact
 * same fetchLearningHubCatalogue()/groupExperiencesByType()-driven UI
 * that used to render permanently inline on the Unit page — moved
 * here unchanged internally, not rewritten, per explicit instruction.
 * Selecting a result still calls the exact same, existing
 * handlers.onPickLearningHubExperience()/onUseLearningHubResourceForConcept()
 * (see ui/views/LearningManagementView.js's own closure) — this file
 * has no resource-creation logic of its own at all.
 *
 * The existing Pack-association control (renderUnitPackControl(),
 * completely unmodified, zero other callers anywhere in the
 * codebase) is not imported here at all — the caller passes a small
 * `renderPackSection(container)` callback instead, so this file never
 * needs to know that function exists. Keeps the Pack mechanism
 * completely untouched while still surfacing it inside the panel,
 * per explicit product decision ("if the Pack association action
 * belongs inside the Learning Hub plugin, move its UI into the
 * drawer").
 */

import { fetchLearningHubCatalogue, groupExperiencesByType } from '../../services/learningHubCatalogueService.js';
import { LEARNING_HUB_TYPE_GROUP_LABELS } from '../views/ConceptWorkspaceView.js';
import { createEmptyStateElement } from './EmptyState.js';
import { createNavigationRow } from './NavigationRow.js';

/**
 * Opens the panel. `unit` is the current ClassMate context (the Unit
 * the teacher is working in) — used only to (a) pre-fill an initial
 * search when the Unit has exactly one Concept, matching the exact
 * same "no ambiguity, skip the extra step" precedent already used
 * for resource association, and (b) offer that Unit's own real
 * Concepts in the "which Concept is this for?" step. The teacher can
 * always search anything else afterward — this never restricts
 * search itself, only suggests a starting point.
 *
 * `handlers` must provide: onPickLearningHubExperience,
 * onUseLearningHubResourceForConcept, onCancelPendingLearningHubExperience
 * — the exact same handlers the old inline plugin used, unchanged.
 *
 * `renderPackSection(container)` is an optional callback the caller
 * provides to render the existing, untouched Pack control inside the
 * panel's own body, beneath search results.
 *
 * `pendingLearningHubExperience` mirrors the caller's own closure
 * state exactly, so the "which Concept?" step (see
 * LearningManagementView.js's own onPickLearningHubExperience) keeps
 * working precisely as it did inline — this panel is a new location
 * for that UI, not a new implementation of it.
 *
 * Returns { close, rerender } — `rerender` lets the caller refresh
 * the panel's own body after a state change (e.g. a Concept was just
 * chosen) without closing and reopening the whole drawer.
 */
export function openLearningHubPanel({ unit, pendingLearningHubExperience, handlers, renderPackSection, onClose }) {
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

  const brand = document.createElement('div');
  brand.className = 'learning-hub-panel__brand';
  const icon = document.createElement('span');
  icon.className = 'learning-hub-panel__icon';
  icon.textContent = '\ud83e\udded'; // a compass — a distinct, non-ClassMate mark, deliberately not reusing any existing ClassMate icon glyph
  icon.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'learning-hub-panel__name';
  name.textContent = 'Learning Hub';
  brand.append(icon, name);
  header.appendChild(brand);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'learning-hub-panel__close';
  closeButton.setAttribute('aria-label', 'Close Learning Hub');
  closeButton.textContent = '\u00d7';
  closeButton.addEventListener('click', close);
  header.appendChild(closeButton);

  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'learning-hub-panel__body';
  panel.appendChild(body);

  function rerender(nextPendingLearningHubExperience) {
    renderLearningHubSearchBody(body, unit, nextPendingLearningHubExperience, handlers, renderPackSection);
  }

  rerender(pendingLearningHubExperience);

  return { close, rerender };
}

/**
 * The moved search body — identical logic to the old, permanently
 * inline plugin, just rendered inside the panel's own body instead
 * of directly on the Unit page. An initial query pre-fills from
 * `unit`'s own single Concept, if it has exactly one; the teacher can
 * clear or replace it freely.
 */
function renderLearningHubSearchBody(container, unit, pendingLearningHubExperience, handlers, renderPackSection) {
  container.innerHTML = '';

  if (pendingLearningHubExperience) {
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
    unit.concepts.forEach((concept) => {
      list.appendChild(createNavigationRow({ label: concept.title, onClick: () => handlers.onUseLearningHubResourceForConcept(pendingLearningHubExperience, concept) }));
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

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search concepts, missions, subjects\u2026';
  searchInput.className = 'concept-workspace__learning-hub-search';
  // A starting point, not a restriction — the teacher can clear or
  // replace this at any time; search is never limited to it.
  searchInput.value = unit.concepts.length === 1 ? unit.concepts[0].title : '';
  container.appendChild(searchInput);

  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'concept-workspace__learning-hub-results';
  const loadingMessage = document.createElement('p');
  loadingMessage.className = 'concept-workspace__tab-intro';
  loadingMessage.textContent = 'Loading\u2026';
  resultsContainer.appendChild(loadingMessage);
  container.appendChild(resultsContainer);

  function loadAndRender() {
    resultsContainer.innerHTML = '';
    const freshLoadingMessage = document.createElement('p');
    freshLoadingMessage.className = 'concept-workspace__tab-intro';
    freshLoadingMessage.textContent = 'Loading\u2026';
    resultsContainer.appendChild(freshLoadingMessage);

    fetchLearningHubCatalogue().then((experiences) => {
      function renderResults(filterText) {
        resultsContainer.innerHTML = '';
        const filtered = filterText
          ? experiences.filter((experience) => experience.title.toLowerCase().includes(filterText.toLowerCase()))
          : experiences;

        if (filtered.length === 0) {
          const emptyState = createEmptyStateElement({ message: experiences.length === 0 ? "Learning Hub couldn't be loaded right now." : 'No resources match your search.' });
          resultsContainer.appendChild(emptyState);
          // Error isolation — this Retry only ever re-fetches the
          // catalogue inside this panel; it never touches the
          // Concepts workspace behind it at all.
          if (experiences.length === 0) {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'btn btn--text';
            retryButton.textContent = 'Retry';
            retryButton.addEventListener('click', loadAndRender);
            resultsContainer.appendChild(retryButton);
          }
          return;
        }

        const groups = groupExperiencesByType(filtered);
        groups.forEach((experiencesOfType, type) => {
          const groupHeading = document.createElement('p');
          groupHeading.className = 'concept-workspace__learning-hub-group-heading';
          groupHeading.textContent = LEARNING_HUB_TYPE_GROUP_LABELS[type] || type;
          resultsContainer.appendChild(groupHeading);

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
            card.appendChild(textWrap);

            const useButton = document.createElement('button');
            useButton.type = 'button';
            useButton.className = 'btn btn--secondary';
            useButton.textContent = 'Use for this concept';
            useButton.addEventListener('click', () => handlers.onPickLearningHubExperience(experience, unit));
            card.appendChild(useButton);

            resultsContainer.appendChild(card);
          });
        });
      }

      renderResults(searchInput.value);
      searchInput.oninput = () => renderResults(searchInput.value);
    });
  }

  loadAndRender();

  if (renderPackSection) {
    const packDivider = document.createElement('hr');
    packDivider.className = 'learning-management__subject-divider';
    container.appendChild(packDivider);
    const packContainer = document.createElement('div');
    container.appendChild(packContainer);
    renderPackSection(packContainer);
  }
}
