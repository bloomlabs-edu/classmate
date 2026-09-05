/**
 * ui/components/TeachingIdeasPickerModal.js
 *
 * The Builder's own "+ From Teaching Ideas" entry point — a thin modal
 * shell around ui/components/TeachingIdeasBrowser.js (the same
 * discovery UI ui/views/ConceptWorkspaceView.js's Teaching Ideas tab
 * uses), with `onCopyElement` always supplied here (this IS the
 * insertion path — "insertion into the current lesson belongs in the
 * Builder," per explicit Phase 4 product direction).
 *
 * A LessonPlan can have multiple Concepts; Teaching Ideas discovery is
 * always scoped to exactly one Concept at a time
 * (repositories/teachingIdeasRepository.js's own getTeachingIdeasForConcept()).
 * With 2+ concepts, a small select lets the teacher switch which one
 * to browse — re-rendering the same browser into the same slot, never
 * a fan-out query across every concept at once (keeps this exactly as
 * simple as repositories/teachingIdeasRepository.js's own single-query
 * shape already is).
 */

import { renderTeachingIdeasBrowser } from './TeachingIdeasBrowser.js';

/**
 * @param {object} options
 * @param {{id:string,title:string}[]} options.concepts - the current lesson's own tagged concepts, already resolved to titles
 * @param {string|null} options.gradeLabel
 * @param {string|null} options.subjectId
 * @param {string|null} options.elementTypeFilter - fixes the browser to one element type (e.g. 'activity' from the Activities section's own picker)
 * @param {(element: object) => void} options.onCopyElement
 */
export function openTeachingIdeasPickerModal({ concepts, gradeLabel, subjectId, elementTypeFilter, onCopyElement }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Find Teaching Ideas');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Find Teaching Ideas';
  modal.appendChild(heading);

  if (!concepts || concepts.length === 0) {
    const message = document.createElement('p');
    message.textContent = 'Add at least one Concept to this lesson first — Teaching Ideas are discovered by Concept.';
    modal.appendChild(message);
    appendCloseButton(modal, overlay);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return;
  }

  let activeConceptId = concepts[0].id;

  if (concepts.length > 1) {
    const conceptLabel = document.createElement('label');
    conceptLabel.className = 'modal__label';
    conceptLabel.textContent = 'Browse by Concept';
    const conceptSelect = document.createElement('select');
    conceptSelect.className = 'modal__input';
    concepts.forEach((concept) => {
      const option = document.createElement('option');
      option.value = concept.id;
      option.textContent = concept.title;
      conceptSelect.appendChild(option);
    });
    conceptSelect.addEventListener('change', () => {
      activeConceptId = conceptSelect.value;
      mountBrowser();
    });
    conceptLabel.appendChild(conceptSelect);
    modal.appendChild(conceptLabel);
  }

  const browserContainer = document.createElement('div');
  modal.appendChild(browserContainer);

  function mountBrowser() {
    const activeConcept = concepts.find((concept) => concept.id === activeConceptId);
    renderTeachingIdeasBrowser(browserContainer, {
      conceptId: activeConceptId,
      conceptTitle: activeConcept?.title,
      initialGradeLabel: gradeLabel,
      initialSubjectId: subjectId,
      elementTypeFilter,
      onCopyElement: (element) => {
        close();
        onCopyElement(element);
      },
    });
  }

  appendCloseButton(modal, overlay);
  mountBrowser();

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function appendCloseButton(modal, overlay) {
  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--text';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => overlay.remove());
  actions.appendChild(closeButton);
  modal.appendChild(actions);
}
