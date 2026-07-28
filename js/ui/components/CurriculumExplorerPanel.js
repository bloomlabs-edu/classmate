/**
 * ui/components/CurriculumExplorerPanel.js
 *
 * The one Curriculum Explorer — an accordion of Units, each expandable
 * to its Concepts. "Reuse the existing Curriculum Explorer. Do not
 * create another viewer" (explicit instruction): this file is that
 * single reusable piece, factored out so there is exactly one
 * accordion implementation in the codebase, not two independently
 * maintained ones.
 *
 * Two callers, two different jobs, same rendering:
 *   - ui/views/LearningManagementView.js — live. Clicking a Concept
 *     materializes it into the real classroom (if it came from a
 *     library version) and opens the Concept Workspace.
 *   - ui/views/CurriculumManagementView.js's "Preview Structure" step
 *     — read-only. A teacher is inspecting a library curriculum
 *     *before* assigning it to any class, so there's no classroom
 *     context yet to materialize anything into or open a workspace
 *     for. Concepts render as plain, unclickable text in this mode.
 *
 * Deliberately takes one normalized shape regardless of where the
 * data actually came from (a fetched library pack's plain-string
 * concept titles, or a classroom's own real LearningConcept objects)
 * — callers do their own normalization before handing units here, so
 * this component never needs to know or care which source it's
 * looking at:
 *
 *   units: [{ id, title, concepts: [{ id, title, onClick? }] }]
 *
 * `onClick` omitted (or `readOnly: true` passed) means that concept
 * renders as inert text, not a button.
 */

import { createIcon } from './Icon.js';

export function createCurriculumExplorerPanel({ units, expandedUnitId, onToggleUnit, readOnly = false }) {
  const accordion = document.createElement('div');
  accordion.className = 'curriculum-explorer-panel';

  units.forEach((unit) => {
    accordion.appendChild(createUnitRow(unit, expandedUnitId === unit.id, onToggleUnit, readOnly));
  });

  return accordion;
}

function createUnitRow(unit, isExpanded, onToggleUnit, readOnly) {
  const row = document.createElement('div');
  row.className = 'curriculum-explorer-panel__unit-row';

  const unitButton = document.createElement('button');
  unitButton.type = 'button';
  unitButton.className = 'curriculum-explorer-panel__unit-toggle';
  unitButton.classList.toggle('curriculum-explorer-panel__unit-toggle--expanded', isExpanded);
  unitButton.appendChild(createIcon('arrow-right', { size: 14 }));

  const unitLabel = document.createElement('span');
  unitLabel.textContent = unit.title;
  unitButton.appendChild(unitLabel);

  const count = document.createElement('span');
  count.className = 'curriculum-explorer-panel__unit-count';
  count.textContent = `${unit.concepts.length} concept${unit.concepts.length === 1 ? '' : 's'}`;
  unitButton.appendChild(count);

  unitButton.addEventListener('click', () => onToggleUnit(unit.id));
  row.appendChild(unitButton);

  if (isExpanded) {
    const conceptList = document.createElement('div');
    conceptList.className = 'curriculum-explorer-panel__concept-list';

    unit.concepts.forEach((concept) => {
      if (readOnly || !concept.onClick) {
        const item = document.createElement('span');
        item.className = 'curriculum-explorer-panel__concept-static';
        item.textContent = concept.title;
        conceptList.appendChild(item);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'curriculum-explorer-panel__concept-option';
        button.textContent = concept.title;
        button.addEventListener('click', concept.onClick);
        conceptList.appendChild(button);
      }
    });

    row.appendChild(conceptList);
  }

  return row;
}
