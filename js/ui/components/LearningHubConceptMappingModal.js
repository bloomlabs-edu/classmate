/**
 * ui/components/LearningHubConceptMappingModal.js
 *
 * "Link to a Learning Hub concept" — opened from the Concept
 * Workspace's own Overview tab (ui/views/ConceptWorkspaceView.js) to
 * set/change models/LearningConcept.js's own `learningHubConcept`
 * field. Backed entirely by services/learningHubConceptService.js's
 * searchConcepts() — a teacher types a title, picks ONE real,
 * published Learning Hub concept from the results; the concept id is
 * never typed by hand. Shares the exact modal shell/search-bar/result-
 * list conventions already established in this app (modal-overlay/
 * modal/modal__heading/modal__form, the same debounced-search +
 * results-list shape ui/components/LearningHubPanel.js's own
 * Learning-Hub-facing pickers already use) rather than inventing a
 * second modal or search language.
 *
 * `onSave({ conceptId, title })` is the caller's own async function —
 * this file only owns the search/select UI, never
 * learningRecordTeacherService/workspaceService calls directly, same
 * "no parallel update mechanism" rule every other modal in this app
 * already follows (see ui/components/NewClassroomModal.js's own save
 * flow for the shell/field-styling precedent this mirrors).
 */
import { searchConcepts } from '../../services/learningHubConceptService.js';

export function openLearningHubConceptMappingModal({ currentMapping, onSave }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Link to a Learning Hub concept');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Link to a Learning Hub concept';

  const form = document.createElement('div');
  form.className = 'modal__form';

  if (currentMapping) {
    const currentNote = document.createElement('p');
    currentNote.className = 'missionCaption';
    currentNote.textContent = `Currently linked to "${currentMapping.title}". Search below to change it.`;
    form.appendChild(currentNote);
  }

  const searchLabel = document.createElement('label');
  searchLabel.className = 'modal__label';
  searchLabel.textContent = 'Search Learning Hub concepts by title';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'modal__input';
  searchInput.placeholder = 'e.g. Weather';
  searchLabel.appendChild(searchInput);
  form.appendChild(searchLabel);

  const resultsEl = document.createElement('div');
  resultsEl.className = 'learning-hub-concept-mapping-results';
  form.appendChild(resultsEl);

  const errorText = document.createElement('p');
  errorText.className = 'modal__error';
  errorText.hidden = true;
  form.appendChild(errorText);

  let selected = null;
  let searchDebounceHandle = null;

  function renderResults(concepts) {
    resultsEl.innerHTML = '';
    if (!concepts.length) {
      const empty = document.createElement('p');
      empty.className = 'repoEmpty';
      empty.textContent = 'No matching Learning Hub concepts.';
      resultsEl.appendChild(empty);
      return;
    }
    concepts.forEach((concept) => {
      const resultButton = document.createElement('button');
      resultButton.type = 'button';
      resultButton.className = 'learning-hub-concept-mapping-result';
      const titleEl = document.createElement('b');
      titleEl.textContent = concept.title;
      resultButton.appendChild(titleEl);
      if (concept.subject) {
        const metaEl = document.createElement('small');
        metaEl.textContent = concept.subject;
        resultButton.appendChild(metaEl);
      }
      resultButton.addEventListener('click', () => {
        selected = concept;
        saveButton.disabled = false;
        resultsEl.querySelectorAll('.learning-hub-concept-mapping-result').forEach((el) => el.classList.remove('learning-hub-concept-mapping-result--selected'));
        resultButton.classList.add('learning-hub-concept-mapping-result--selected');
      });
      resultsEl.appendChild(resultButton);
    });
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceHandle);
    const value = searchInput.value.trim();
    if (!value) {
      resultsEl.innerHTML = '';
      return;
    }
    searchDebounceHandle = setTimeout(() => {
      searchConcepts(value).then((concepts) => {
        renderResults(concepts);
      }).catch((error) => {
        console.error('[LearningHubConceptMappingModal] search failed:', error);
        resultsEl.innerHTML = '<p class="repoError">Couldn’t search Learning Hub right now.</p>';
      });
    }, 150);
  });

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.disabled = true;

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';

  function close() {
    overlay.remove();
  }

  saveButton.addEventListener('click', async () => {
    if (!selected || saveButton.disabled) return;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    saveButton.textContent = 'Saving…';
    errorText.hidden = true;
    try {
      await onSave({ conceptId: selected.conceptId, title: selected.title });
      close();
    } catch (error) {
      saveButton.disabled = false;
      cancelButton.disabled = false;
      saveButton.textContent = 'Save';
      errorText.textContent = 'Save failed. Check your connection and try again.';
      errorText.hidden = false;
    }
  });

  cancelButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && !saveButton.disabled) close();
  });

  actions.append(saveButton, cancelButton);
  modal.append(heading, form, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  searchInput.focus();
}
