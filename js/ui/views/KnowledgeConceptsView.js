/**
 * ui/views/KnowledgeConceptsView.js
 *
 * ClassMate Knowledge Model — K2.1 "Knowledge Authoring", Concepts
 * section. Mounted by ui/views/KnowledgeAuthoringView.js's own tab
 * shell (added in K2.2 alongside ui/views/KnowledgeRelationshipsView.js)
 * — reached exclusively from ui/views/CurriculumManagementView.js's own
 * hub, behind a PM-only gate that view adds specifically for this whole
 * feature (see that file's own header comment on why the rest of
 * Curriculum Management stays exactly as ungated as it already was).
 *
 * Scope, deliberately: search/reuse/create KnowledgeConcepts, a plain
 * browsing list with a search filter. Explicitly NOT built here: a
 * Classifications section, the Textbook Conversion helper, aliases/
 * synonyms, or any edit/delete affordance on an existing Concept — this
 * section only ever creates.
 *
 * ---------------------------------------------------------------------
 * Search-first, human-decided reuse vs. create — never automatic
 * ---------------------------------------------------------------------
 *
 * The ONLY way to create a new KnowledgeConcept here is through
 * ui/components/KnowledgeConceptPicker.js's own "+ Create new Concept"
 * action — there is no separate, picker-free "New Concept" button that
 * would let an author skip searching first. Picking an EXISTING match
 * from the picker never creates anything; it just surfaces an
 * "already exists" acknowledgement so the author can go find it in the
 * list below rather than accidentally authoring a duplicate. This is
 * the actual mechanism behind this feature's own "never auto-merge by
 * title similarity" requirement: the picker's own substring search
 * (see KnowledgeAuthoringDisplay.js) will happily show "Tropical
 * cyclones" as a NON-match for a search of "Cyclonic storms" — nothing
 * here ever assumes they're the same Concept. A human decides that,
 * every time, or doesn't.
 *
 * ---------------------------------------------------------------------
 * `sourceCurriculumUnitId` — provenance only, never required
 * ---------------------------------------------------------------------
 *
 * Per explicit product direction: the ordinary "New Concept" form never
 * asks an author to navigate Curriculum -> Grade -> Subject -> Unit.
 * `sourceCurriculumUnitId` is accepted as an optional constructor
 * argument to this whole view (defaults to null) so a FUTURE entry
 * point — the Textbook Conversion helper (K2.4), reached FROM a
 * specific Curriculum Unit already in context — can silently supply it
 * without this file changing at all. It is never displayed, edited, or
 * required in the form itself; see models/KnowledgeConcept.js's own
 * header comment for why it must never be read as ownership/hierarchy.
 *
 * ---------------------------------------------------------------------
 * `authorizingClassroomId` — resolved automatically, not asked for
 * ---------------------------------------------------------------------
 *
 * Every write needs one (see firestore.rules' own isKnowledgeAuthor()).
 * Resolved via memberService.getProgramManagerClassroomIds(classrooms,
 * uid) — almost always exactly one classroom in practice, silently
 * used with no extra step; the rare multi-classroom PM sees a small
 * inline choice instead of a silent, possibly-wrong pick.
 */

import * as knowledgeConceptRepository from '../../repositories/knowledgeConceptRepository.js';
import { createKnowledgeConcept } from '../../models/KnowledgeConcept.js';
import { getProgramManagerClassroomIds } from '../../services/memberService.js';
import { getDisplayName } from '../../services/classroomService.js';
import { filterConceptsByQuery } from './KnowledgeAuthoringDisplay.js';
import { createKnowledgeConceptPicker } from '../components/KnowledgeConceptPicker.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

export function renderKnowledgeConceptsView(container, { classrooms, currentUser, sourceCurriculumUnitId = null }) {
  const pmClassroomIds = getProgramManagerClassroomIds(classrooms, currentUser.uid);
  let selectedAuthorizingClassroomId = pmClassroomIds[0] || null;

  let concepts = null; // null = loading
  let loadError = null;
  let actionError = null;
  let searchQuery = '';
  let pendingCreateTitle = null; // set once the picker's own "+ Create new Concept" is chosen
  let existingMatchTitle = null; // set once an EXISTING Concept is chosen from the picker

  function rerender() {
    renderContent(
      container,
      {
        pmClassroomIds,
        selectedAuthorizingClassroomId,
        classrooms,
        concepts,
        loadError,
        actionError,
        searchQuery,
        pendingCreateTitle,
        existingMatchTitle,
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
        onPickerSelect: (value, { label, isNew }) => {
          actionError = null;
          if (isNew) {
            pendingCreateTitle = label;
            existingMatchTitle = null;
          } else {
            existingMatchTitle = label;
            pendingCreateTitle = null;
          }
          rerender();
        },
        onCancelCreate: () => {
          pendingCreateTitle = null;
          rerender();
        },
        onDismissExistingMatchNote: () => {
          existingMatchTitle = null;
          rerender();
        },
        onSaveNewConcept: (title, description) => persistNewConcept(title, description),
      }
    );
  }

  async function persistNewConcept(title, description) {
    if (!selectedAuthorizingClassroomId) {
      actionError = 'You need Program Manager access on at least one classroom to author Knowledge Model content.';
      rerender();
      return;
    }
    const concept = createKnowledgeConcept({
      title,
      description: description || null,
      sourceCurriculumUnitId,
      authorizingClassroomId: selectedAuthorizingClassroomId,
      createdByUid: currentUser.uid,
    });
    concepts = [...(concepts || []), concept];
    pendingCreateTitle = null;
    actionError = null;
    rerender();
    try {
      await knowledgeConceptRepository.saveKnowledgeConcept(concept);
    } catch (error) {
      console.error('[KnowledgeConceptsView] Failed to save a new KnowledgeConcept:', error);
      actionError = "Saved locally, but couldn't reach the server — check your connection.";
      rerender();
    }
  }

  rerender();
  mount();

  async function mount() {
    try {
      concepts = await knowledgeConceptRepository.getAllKnowledgeConcepts();
    } catch (error) {
      console.error('[KnowledgeConceptsView] Failed to load KnowledgeConcepts:', error);
      loadError = "Couldn't load Knowledge Concepts. Check your connection and try again.";
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
  intro.textContent = 'Search existing Concepts first. Reuse one, or deliberately create a new one — nothing here ever merges two Concepts automatically.';
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

  wrapper.appendChild(renderPickerSection(state, handlers));

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'knowledge-authoring__error';
    error.textContent = state.loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (state.concepts === null) {
    const loading = document.createElement('p');
    loading.className = 'knowledge-authoring__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  wrapper.appendChild(renderListSection(state, handlers));

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

function renderPickerSection(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__picker-section';

  const label = document.createElement('p');
  label.className = 'knowledge-authoring__editor-label';
  label.textContent = 'Find or create a Concept';
  section.appendChild(label);

  const picker = createKnowledgeConceptPicker({
    concepts: state.concepts || [],
    placeholder: "Search existing Concepts, e.g. 'Flood'…",
    onSelect: handlers.onPickerSelect,
  });
  section.appendChild(picker.wrapper);

  if (state.existingMatchTitle) {
    const note = document.createElement('p');
    note.className = 'knowledge-authoring__existing-note';
    note.append(`'${state.existingMatchTitle}' already exists — see it in the list below. `);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn btn--text';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', handlers.onDismissExistingMatchNote);
    note.appendChild(dismiss);
    section.appendChild(note);
  }

  if (state.pendingCreateTitle) {
    section.appendChild(renderNewConceptForm(state.pendingCreateTitle, handlers));
  }

  return section;
}

function renderNewConceptForm(prefilledTitle, handlers) {
  const form = document.createElement('form');
  form.className = 'knowledge-authoring__new-concept-form';

  const titleLabel = document.createElement('label');
  titleLabel.className = 'knowledge-authoring__editor-label';
  titleLabel.textContent = 'Title';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'knowledge-authoring__editor-input';
  titleInput.required = true;
  titleInput.value = prefilledTitle;
  titleLabel.appendChild(titleInput);
  form.appendChild(titleLabel);

  const descLabel = document.createElement('label');
  descLabel.className = 'knowledge-authoring__editor-label';
  descLabel.textContent = 'Description (optional)';
  const descInput = document.createElement('textarea');
  descInput.className = 'knowledge-authoring__editor-input';
  descInput.placeholder = 'Optional notes…';
  descLabel.appendChild(descInput);
  form.appendChild(descLabel);

  const actions = document.createElement('div');
  actions.className = 'knowledge-authoring__form-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save Concept';
  actions.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelCreate);
  actions.appendChild(cancelButton);

  form.appendChild(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    handlers.onSaveNewConcept(title, descInput.value.trim());
  });

  return form;
}

function renderListSection(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__list-section';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'knowledge-authoring__search-input';
  searchInput.placeholder = 'Filter the list below…';
  searchInput.value = state.searchQuery;
  searchInput.addEventListener('input', () => handlers.onSearchQueryChange(searchInput.value));
  section.appendChild(searchInput);

  const visible = filterConceptsByQuery(state.concepts, state.searchQuery);

  if (visible.length === 0) {
    section.appendChild(
      createEmptyStateElement({
        message: state.concepts.length === 0 ? 'No Concepts yet — search above to create the first one.' : 'No Concepts match this filter.',
      })
    );
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'knowledge-authoring__list';
  visible.forEach((concept) => {
    const row = document.createElement('li');
    row.className = 'knowledge-authoring__row';
    const titleEl = document.createElement('span');
    titleEl.className = 'knowledge-authoring__row-title';
    titleEl.textContent = concept.title;
    row.appendChild(titleEl);
    if (concept.description) {
      const descEl = document.createElement('span');
      descEl.className = 'knowledge-authoring__row-description';
      descEl.textContent = concept.description;
      row.appendChild(descEl);
    }
    list.appendChild(row);
  });
  section.appendChild(list);

  return section;
}
