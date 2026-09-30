/**
 * ui/views/KnowledgeAuthoringView.js
 *
 * ClassMate Knowledge Model — the "Knowledge Authoring" shell. Reached
 * exclusively from ui/views/CurriculumManagementView.js's own hub,
 * behind a PM-only gate that view adds specifically for this one entry
 * point (see that file's own header comment on why the rest of
 * Curriculum Management stays exactly as ungated as it already was).
 *
 * This file owns nothing about Concepts, Relationships,
 * Classifications, or Textbook Review itself — it is a thin tab shell
 * mounting one of four independent sub-views into its own content
 * container:
 *   - ui/views/KnowledgeConceptsView.js (K2.1) — search/reuse/create
 *     KnowledgeConcepts.
 *   - ui/views/KnowledgeRelationshipsView.js (K2.2) — author typed
 *     KnowledgeRelationships between two existing Concepts.
 *   - ui/views/KnowledgeClassificationsView.js (K2.3) — author
 *     Classifications, add Categories to them, and assign existing
 *     Concepts into a Category via KnowledgeClassificationMembership.
 *   - ui/views/KnowledgeTextbookReviewView.js (K2.4) — browse an
 *     existing, published Curriculum Unit's own textbook items
 *     (read-only) and decide, per item, whether it maps to an
 *     existing/new KnowledgeConcept or stays presentation-only.
 *
 * K2.1 originally built this feature as a single, Concepts-only screen
 * with no tabs at all — this shell is the minimal restructuring K2.2
 * required to add a second section without duplicating the PM-gated
 * entry point, the `classrooms`/`currentUser` plumbing, or growing a
 * single ever-larger file; K2.3 and K2.4 each only ever added their own
 * tab entry here, no other change to this file. Each mounted sub-view
 * still fully owns its own internal state/rerender loop exactly as it
 * did before (see ui/views/MyWorkView.js/ui/views/PersonalHubView.js
 * for the same "mount a container, hand it a full sub-app" precedent
 * already used elsewhere in this app) — switching tabs here only ever
 * tears down and remounts a sub-view fresh, it never reaches into its
 * internals.
 */

import { renderKnowledgeConceptsView } from './KnowledgeConceptsView.js';
import { renderKnowledgeRelationshipsView } from './KnowledgeRelationshipsView.js';
import { renderKnowledgeClassificationsView } from './KnowledgeClassificationsView.js';
import { renderKnowledgeTextbookReviewView } from './KnowledgeTextbookReviewView.js';

const SECTIONS = [
  { id: 'concepts', label: 'Concepts' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'classifications', label: 'Classifications' },
  { id: 'textbook-review', label: 'Textbook Review' },
];

export function renderKnowledgeAuthoringView(container, { classrooms, currentUser, sourceCurriculumUnitId = null }) {
  let activeSection = 'concepts';

  function rerenderShell() {
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'knowledge-authoring-shell';

    const title = document.createElement('h2');
    title.className = 'knowledge-authoring__title';
    title.textContent = 'Knowledge Authoring';
    wrapper.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'my-work__pill-row';
    SECTIONS.forEach(({ id, label }) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `my-work__pill${activeSection === id ? ' my-work__pill--active' : ''}`;
      tab.textContent = label;
      tab.addEventListener('click', () => {
        if (activeSection === id) return;
        activeSection = id;
        rerenderShell();
      });
      tabs.appendChild(tab);
    });
    wrapper.appendChild(tabs);

    const sectionContainer = document.createElement('div');
    sectionContainer.className = 'knowledge-authoring-shell__section';
    wrapper.appendChild(sectionContainer);

    container.appendChild(wrapper);

    if (activeSection === 'concepts') {
      renderKnowledgeConceptsView(sectionContainer, { classrooms, currentUser, sourceCurriculumUnitId });
    } else if (activeSection === 'relationships') {
      renderKnowledgeRelationshipsView(sectionContainer, { classrooms, currentUser });
    } else if (activeSection === 'classifications') {
      renderKnowledgeClassificationsView(sectionContainer, { classrooms, currentUser });
    } else if (activeSection === 'textbook-review') {
      renderKnowledgeTextbookReviewView(sectionContainer, { classrooms, currentUser });
    }
  }

  rerenderShell();
}
