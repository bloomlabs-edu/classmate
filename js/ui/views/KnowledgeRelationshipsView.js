/**
 * ui/views/KnowledgeRelationshipsView.js
 *
 * ClassMate Knowledge Model — K2.2 "Knowledge Authoring", Relationships
 * section. Mounted by ui/views/KnowledgeAuthoringView.js's own tab
 * shell, alongside ui/views/KnowledgeConceptsView.js (K2.1) — reached
 * behind the same PM-only gate ui/views/CurriculumManagementView.js
 * already adds for this whole feature.
 *
 * ---------------------------------------------------------------------
 * These are typed KNOWLEDGE relationships, never textbook nesting
 * ---------------------------------------------------------------------
 *
 * Every relationship here is a directed, typed fact between two
 * KnowledgeConcepts — "Heavy rainfall CAUSES Flood," "Flood IS_A
 * Hazard" — never a parent/child position in a textbook outline. This
 * view's own intro copy says so explicitly, and every row renders as a
 * flat "From -> type -> To" line (plus its own DERIVED reverse
 * sentence right underneath, from the OTHER Concept's point of view —
 * see KnowledgeAuthoringDisplay.buildRelationshipRows()), never as an
 * indented tree — a tree would visually imply exactly the hierarchy
 * this whole Knowledge Model is built to avoid conflating with
 * CURRICULUM STRUCTURE.
 *
 * ---------------------------------------------------------------------
 * Both endpoints MUST already exist — no inline Concept creation here
 * ---------------------------------------------------------------------
 *
 * ui/components/KnowledgeConceptPicker.js is reused for both the From
 * and To fields, but with `allowCustom: false` — its own existing
 * SearchableSelect-backed "+ Create new Concept" affordance never
 * appears here at all (see that component's own header comment). A
 * Relationship can only ever reference two Concepts that were already
 * authored on the Concepts section; this view never becomes a back
 * door for creating one.
 *
 * ---------------------------------------------------------------------
 * Validation, all client-side, none of it a K1 schema change
 * ---------------------------------------------------------------------
 *
 * - fromConceptId !== toConceptId — checked here before ever calling
 *   saveKnowledgeRelationship(); firestore.rules' own isKnowledgeAuthor()-
 *   adjacent check for this exact condition is the real, unbypassable
 *   enforcement (see K1's own rules test suite) — this is only the
 *   friendly, immediate version of the same rule.
 * - type must be one of RELATIONSHIP_TYPES (models/KnowledgeRelationship.js,
 *   frozen, read here, never reimplemented or extended).
 * - no duplicate {from, to, type} fact (see
 *   KnowledgeAuthoringDisplay.findDuplicateRelationship()) — evaluated
 *   over the already-loaded full relationships list, no new repository
 *   query, no schema change.
 *
 * Reverse relationships are still never independently stored here —
 * see models/KnowledgeRelationship.js's own header comment; this view
 * only ever calls saveKnowledgeRelationship() once per authored fact,
 * in its one canonical direction.
 */

import * as knowledgeConceptRepository from '../../repositories/knowledgeConceptRepository.js';
import * as knowledgeRelationshipRepository from '../../repositories/knowledgeRelationshipRepository.js';
import { createKnowledgeRelationship, RELATIONSHIP_TYPES, getRelationshipForwardLabel } from '../../models/KnowledgeRelationship.js';
import { getProgramManagerClassroomIds } from '../../services/memberService.js';
import { getDisplayName } from '../../services/classroomService.js';
import { buildRelationshipRows, filterRelationshipRowsByQuery, findDuplicateRelationship } from './KnowledgeAuthoringDisplay.js';
import { createKnowledgeConceptPicker } from '../components/KnowledgeConceptPicker.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

const TYPE_OPTIONS = Object.values(RELATIONSHIP_TYPES).map((type) => ({ type, label: getRelationshipForwardLabel(type) }));

export function renderKnowledgeRelationshipsView(container, { classrooms, currentUser }) {
  const pmClassroomIds = getProgramManagerClassroomIds(classrooms, currentUser.uid);
  let selectedAuthorizingClassroomId = pmClassroomIds[0] || null;

  let concepts = null; // null = loading
  let relationships = null; // null = loading
  let loadError = null;
  let actionError = null;
  let searchQuery = '';

  // New Relationship form state — reset after every successful save.
  let fromConceptId = null;
  let fromConceptLabel = '';
  let toConceptId = null;
  let toConceptLabel = '';
  let selectedType = '';

  function rerender() {
    renderContent(
      container,
      {
        pmClassroomIds,
        selectedAuthorizingClassroomId,
        classrooms,
        concepts,
        relationships,
        loadError,
        actionError,
        searchQuery,
        fromConceptId,
        fromConceptLabel,
        toConceptId,
        toConceptLabel,
        selectedType,
      },
      {
        onSelectAuthorizingClassroom: (classroomId) => {
          selectedAuthorizingClassroomId = classroomId;
          rerender();
        },
        onSearchQueryChange: (value) => {
          searchQuery = value;
          rerender();
        },
        onFromSelect: (value, { label, isNew }) => {
          actionError = null;
          if (isNew) {
            actionError = "Create this Concept first on the Concepts section, then come back to relate it.";
            rerender();
            return;
          }
          fromConceptId = value;
          fromConceptLabel = label;
          rerender();
        },
        onToSelect: (value, { label, isNew }) => {
          actionError = null;
          if (isNew) {
            actionError = "Create this Concept first on the Concepts section, then come back to relate it.";
            rerender();
            return;
          }
          toConceptId = value;
          toConceptLabel = label;
          rerender();
        },
        onTypeChange: (type) => {
          selectedType = type;
          rerender();
        },
        onSaveRelationship: () => persistNewRelationship(),
        onDeleteRelationship: (relationship) => deleteRelationship(relationship),
      }
    );
  }

  async function persistNewRelationship() {
    actionError = null;

    if (!selectedAuthorizingClassroomId) {
      actionError = 'You need Program Manager access on at least one classroom to author Knowledge Model content.';
      rerender();
      return;
    }
    if (!fromConceptId || !toConceptId) {
      actionError = 'Pick both a From Concept and a To Concept.';
      rerender();
      return;
    }
    if (!selectedType) {
      actionError = 'Pick a relationship type.';
      rerender();
      return;
    }
    if (fromConceptId === toConceptId) {
      actionError = 'A Concept cannot relate to itself — pick two different Concepts.';
      rerender();
      return;
    }
    const duplicate = findDuplicateRelationship(relationships, { fromConceptId, toConceptId, type: selectedType });
    if (duplicate) {
      actionError = 'This relationship already exists.';
      rerender();
      return;
    }

    const relationship = createKnowledgeRelationship({
      fromConceptId,
      toConceptId,
      type: selectedType,
      authorizingClassroomId: selectedAuthorizingClassroomId,
      createdByUid: currentUser.uid,
    });
    relationships = [...(relationships || []), relationship];
    fromConceptId = null;
    fromConceptLabel = '';
    toConceptId = null;
    toConceptLabel = '';
    selectedType = '';
    rerender();
    try {
      await knowledgeRelationshipRepository.saveKnowledgeRelationship(relationship);
    } catch (error) {
      console.error('[KnowledgeRelationshipsView] Failed to save a new KnowledgeRelationship:', error);
      actionError = "Saved locally, but couldn't reach the server — check your connection.";
      rerender();
    }
  }

  async function deleteRelationship(relationship) {
    if (!window.confirm('Delete this relationship? This can’t be undone.')) return;
    relationships = relationships.filter((r) => r.id !== relationship.id);
    rerender();
    try {
      await knowledgeRelationshipRepository.deleteKnowledgeRelationship(relationship.id);
    } catch (error) {
      console.error('[KnowledgeRelationshipsView] Failed to delete a KnowledgeRelationship:', error);
      actionError = "Couldn't delete that relationship. Check your connection and try again.";
      rerender();
    }
  }

  rerender();
  mount();

  async function mount() {
    try {
      const [loadedConcepts, loadedRelationships] = await Promise.all([
        knowledgeConceptRepository.getAllKnowledgeConcepts(),
        knowledgeRelationshipRepository.getAllKnowledgeRelationships(),
      ]);
      concepts = loadedConcepts;
      relationships = loadedRelationships;
    } catch (error) {
      console.error('[KnowledgeRelationshipsView] Failed to load Concepts/Relationships:', error);
      loadError = "Couldn't load Knowledge Relationships. Check your connection and try again.";
    }
    rerender();
  }
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderContent(container, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'knowledge-authoring';

  const intro = document.createElement('p');
  intro.className = 'knowledge-authoring__intro';
  intro.textContent =
    'These are typed knowledge relationships between Concepts — a graph of facts, never textbook headings or outline structure. Each one only ever connects two Concepts that already exist.';
  wrapper.appendChild(intro);

  if (state.pmClassroomIds.length === 0) {
    wrapper.appendChild(
      createEmptyStateElement({ message: 'You need Program Manager access on at least one classroom to author Knowledge Model content.' })
    );
    container.appendChild(wrapper);
    return;
  }

  if (state.pmClassroomIds.length > 1) {
    wrapper.appendChild(renderAuthoringClassroomChoice(state, handlers));
  } else {
    const asLine = document.createElement('p');
    asLine.className = 'knowledge-authoring__authoring-as';
    const classroom = state.classrooms.find((c) => c.id === state.selectedAuthorizingClassroomId);
    asLine.textContent = `Authoring as Program Manager of: ${classroom ? getDisplayName(classroom) : state.selectedAuthorizingClassroomId}`;
    wrapper.appendChild(asLine);
  }

  if (state.actionError) {
    const error = document.createElement('p');
    error.className = 'knowledge-authoring__error';
    error.textContent = state.actionError;
    wrapper.appendChild(error);
  }

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'knowledge-authoring__error';
    error.textContent = state.loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (state.concepts === null || state.relationships === null) {
    const loading = document.createElement('p');
    loading.className = 'knowledge-authoring__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  wrapper.appendChild(renderNewRelationshipForm(state, handlers));
  wrapper.appendChild(renderRelationshipListSection(state, handlers));

  container.appendChild(wrapper);
}

function renderAuthoringClassroomChoice(state, handlers) {
  const wrap = document.createElement('label');
  wrap.className = 'knowledge-authoring__editor-label';
  wrap.textContent = 'Authoring as Program Manager of';

  const select = document.createElement('select');
  select.className = 'knowledge-authoring__classroom-select';
  state.pmClassroomIds.forEach((classroomId) => {
    const classroom = state.classrooms.find((c) => c.id === classroomId);
    const option = document.createElement('option');
    option.value = classroomId;
    option.textContent = classroom ? getDisplayName(classroom) : classroomId;
    option.selected = classroomId === state.selectedAuthorizingClassroomId;
    select.appendChild(option);
  });
  select.addEventListener('change', () => handlers.onSelectAuthorizingClassroom(select.value));
  wrap.appendChild(select);
  return wrap;
}

function renderNewRelationshipForm(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__picker-section';

  const heading = document.createElement('p');
  heading.className = 'knowledge-authoring__editor-label';
  heading.textContent = 'New Relationship';
  section.appendChild(heading);

  const fromLabel = document.createElement('label');
  fromLabel.className = 'knowledge-authoring__editor-label';
  fromLabel.textContent = 'From Concept';
  const fromPicker = createKnowledgeConceptPicker({
    concepts: state.concepts,
    placeholder: 'Search existing Concepts…',
    allowCustom: false,
    onSelect: handlers.onFromSelect,
  });
  fromLabel.appendChild(fromPicker.wrapper);
  section.appendChild(fromLabel);

  const typeLabel = document.createElement('label');
  typeLabel.className = 'knowledge-authoring__editor-label';
  typeLabel.textContent = 'Relationship Type';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'knowledge-authoring__classroom-select';
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'Choose a relationship type…';
  placeholderOption.disabled = true;
  placeholderOption.selected = !state.selectedType;
  typeSelect.appendChild(placeholderOption);
  TYPE_OPTIONS.forEach(({ type, label }) => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = `${type} — ${label}`;
    option.selected = type === state.selectedType;
    typeSelect.appendChild(option);
  });
  typeSelect.addEventListener('change', () => handlers.onTypeChange(typeSelect.value));
  typeLabel.appendChild(typeSelect);
  section.appendChild(typeLabel);

  const toLabel = document.createElement('label');
  toLabel.className = 'knowledge-authoring__editor-label';
  toLabel.textContent = 'To Concept';
  const toPicker = createKnowledgeConceptPicker({
    concepts: state.concepts,
    placeholder: 'Search existing Concepts…',
    allowCustom: false,
    onSelect: handlers.onToSelect,
  });
  toLabel.appendChild(toPicker.wrapper);
  section.appendChild(toLabel);

  if (state.fromConceptId && state.selectedType && state.toConceptId) {
    const preview = document.createElement('p');
    preview.className = 'knowledge-authoring__existing-note';
    preview.textContent = `${state.fromConceptLabel} → ${getRelationshipForwardLabel(state.selectedType)} → ${state.toConceptLabel}`;
    section.appendChild(preview);
  }

  const actions = document.createElement('div');
  actions.className = 'knowledge-authoring__form-actions';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save Relationship';
  saveButton.addEventListener('click', handlers.onSaveRelationship);
  actions.appendChild(saveButton);
  section.appendChild(actions);

  return section;
}

function renderRelationshipListSection(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__list-section';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'knowledge-authoring__search-input';
  searchInput.placeholder = 'Filter existing relationships…';
  searchInput.value = state.searchQuery;
  searchInput.addEventListener('input', () => handlers.onSearchQueryChange(searchInput.value));
  section.appendChild(searchInput);

  const rows = buildRelationshipRows(state.relationships, state.concepts);
  const visible = filterRelationshipRowsByQuery(rows, state.searchQuery);

  if (visible.length === 0) {
    section.appendChild(
      createEmptyStateElement({
        message: rows.length === 0 ? 'No Relationships yet — create the first one above.' : 'No Relationships match this filter.',
      })
    );
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'knowledge-authoring__list';
  visible.forEach((row) => {
    const item = document.createElement('li');
    item.className = 'knowledge-authoring__row';

    const forwardLine = document.createElement('span');
    forwardLine.className = 'knowledge-authoring__row-title';
    forwardLine.textContent = `${row.fromTitle} → ${row.forwardLabel} → ${row.toTitle}`;
    item.appendChild(forwardLine);

    const reverseLine = document.createElement('span');
    reverseLine.className = 'knowledge-authoring__row-description';
    reverseLine.textContent = row.reverseSentence;
    item.appendChild(reverseLine);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--text';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => handlers.onDeleteRelationship(row));
    item.appendChild(deleteButton);

    list.appendChild(item);
  });
  section.appendChild(list);

  return section;
}
