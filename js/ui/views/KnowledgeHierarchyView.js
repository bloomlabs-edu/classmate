/**
 * ui/views/KnowledgeHierarchyView.js
 *
 * ClassMate Knowledge Model — "Hierarchy", the fast, primary way to
 * author Concepts while reading a textbook (2026-10-01 UX
 * simplification). Mounted first in ui/views/KnowledgeAuthoringView.js's
 * own tab shell, alongside (never replacing) Concepts (K2.1),
 * Relationships (K2.2), Classifications (K2.3), and Textbook Review
 * (K2.4) — reached behind the same PM-only gate that whole shell
 * already requires.
 *
 * The entire interaction is: type a Concept name, optionally choose
 * "Sub-concept of [existing Concept]," Add. Nothing here ever shows the
 * words "IS_A," "relationship type," "classification," or "provenance"
 * — those remain real, unchanged, data-model-level facts (see
 * models/KnowledgeConcept.js / models/KnowledgeRelationship.js), just
 * never surfaced to this screen's own author. Concretely:
 *   - "Add Concept" -> createKnowledgeConcept() + saveKnowledgeConcept(),
 *     the EXACT SAME calls ui/views/KnowledgeConceptsView.js already
 *     makes for its own "Create New Concept" action.
 *   - "Sub-concept of X" -> ONE createKnowledgeRelationship({ type:
 *     'IS_A', fromConceptId: <new Concept>, toConceptId: X }) +
 *     saveKnowledgeRelationship(), the exact same IS_A fact
 *     ui/views/KnowledgeRelationshipsView.js could already author by
 *     hand — this screen is a faster, narrower front door onto that
 *     same fact, never a second hierarchy mechanism.
 *
 * NO schema change, no new Firestore collection, no new firestore.rules
 * clause — every write here is already-authorized by the existing
 * isKnowledgeAuthor() gate on knowledgeConcepts/knowledgeRelationships.
 *
 * The hierarchy tree itself (ui/views/KnowledgeAuthoringDisplay.js's own
 * buildConceptHierarchyForest()) is a pure, derived READ over the
 * existing IS_A relationships — nothing about it is stored. Per
 * explicit product direction, the tree exists for context/navigation/
 * duplicate-avoidance, not as the primary focus: every branch starts
 * collapsed, and only the path to whatever Concept was most recently
 * added auto-expands (see expandedConceptIds below) — this must never
 * become "a large expanded wall of content."
 *
 * Duplicate-title protection reuses findConceptByExactTitle() (the same
 * exact-match-only rule Textbook Review's own "Create New Concept"
 * button already enforces) — computed live as the author types, via a
 * fast, NON-rerendering DOM patch (see onNameInput below), never a
 * full container rebuild on every keystroke. A full rerender() only
 * ever follows a deliberate click (radio toggle, Add, expand/collapse,
 * the duplicate note's own reuse shortcut) — the same "typing must
 * never fight a full rebuild" lesson
 * ui/views/LessonPlanBuilderView.js's own persistOnly() already
 * documents for this exact race.
 */

import * as knowledgeConceptRepository from '../../repositories/knowledgeConceptRepository.js';
import * as knowledgeRelationshipRepository from '../../repositories/knowledgeRelationshipRepository.js';
import { createKnowledgeConcept } from '../../models/KnowledgeConcept.js';
import { createKnowledgeRelationship } from '../../models/KnowledgeRelationship.js';
import { getProgramManagerClassroomIds } from '../../services/memberService.js';
import { getDisplayName } from '../../services/classroomService.js';
import { findConceptByExactTitle, buildConceptHierarchyForest, getConceptAncestorIds } from './KnowledgeAuthoringDisplay.js';
import { createKnowledgeConceptPicker } from '../components/KnowledgeConceptPicker.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';

export function renderKnowledgeHierarchyView(container, { classrooms, currentUser }) {
  const pmClassroomIds = getProgramManagerClassroomIds(classrooms, currentUser.uid);
  let selectedAuthorizingClassroomId = pmClassroomIds[0] || null;

  let concepts = null; // null = loading
  let relationships = null; // null = loading
  let loadError = null;
  let actionError = null;

  // The in-progress "Add Concept" form — a plain, uncontrolled text
  // input (read fresh at Add time, same convention every other K2 form
  // already uses); `currentNameValue` only mirrors it so a radio toggle
  // or the duplicate-shortcut can trigger a full rerender() without
  // losing whatever's already been typed.
  let currentNameValue = '';
  let parentMode = 'top-level'; // 'top-level' | 'sub-concept'
  let pendingParentId = null; // set whenever parentMode === 'sub-concept'
  let focusNameInputOnNextRender = false;

  // Which concept ids currently show their children — starts empty
  // (every branch collapsed) per explicit product direction; populated
  // only by auto-expanding the path to whatever was just added (see
  // revealConcept() below) or a manual chevron click.
  const expandedConceptIds = new Set();

  function revealConcept(conceptId) {
    expandedConceptIds.add(conceptId);
    getConceptAncestorIds(relationships, conceptId).forEach((id) => expandedConceptIds.add(id));
  }

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
        currentNameValue,
        parentMode,
        pendingParentId,
        expandedConceptIds,
        focusNameInputOnNextRender,
      },
      {
        onSelectAuthorizingClassroom: (classroomId) => {
          selectedAuthorizingClassroomId = classroomId;
          rerender();
        },
        onNameInputMount: (inputEl, noteSlotEl, addButtonEl) => {
          inputEl.addEventListener('input', () => {
            currentNameValue = inputEl.value;
            updateDuplicateNote(noteSlotEl, addButtonEl);
          });
        },
        onParentModeChange: (mode) => {
          parentMode = mode;
          focusNameInputOnNextRender = false;
          rerender();
        },
        onPendingParentChange: (conceptId) => {
          pendingParentId = conceptId;
          rerender();
        },
        onAddConcept: () => addConcept(),
        onToggleExpand: (conceptId) => {
          if (expandedConceptIds.has(conceptId)) expandedConceptIds.delete(conceptId);
          else expandedConceptIds.add(conceptId);
          rerender();
        },
      }
    );
    focusNameInputOnNextRender = false;
  }

  /** Fast path for live typing — patches just the duplicate note + Add-button disabled state, never a full rerender(). See this file's own header comment on why. */
  function updateDuplicateNote(noteSlotEl, addButtonEl) {
    const duplicate = findConceptByExactTitle(concepts, currentNameValue);
    const needsParent = parentMode === 'sub-concept' && !pendingParentId;
    addButtonEl.disabled = !currentNameValue.trim() || Boolean(duplicate) || needsParent;

    noteSlotEl.innerHTML = '';
    if (!duplicate) return;
    const note = document.createElement('p');
    note.className = 'knowledge-authoring__existing-note';
    note.append(`'${duplicate.title}' already exists. `);
    const useAsParentButton = document.createElement('button');
    useAsParentButton.type = 'button';
    useAsParentButton.className = 'btn btn--text';
    useAsParentButton.textContent = 'Use it as the sub-concept parent instead';
    useAsParentButton.addEventListener('click', () => {
      currentNameValue = '';
      parentMode = 'sub-concept';
      pendingParentId = duplicate.id;
      focusNameInputOnNextRender = true;
      rerender();
    });
    note.appendChild(useAsParentButton);
    noteSlotEl.appendChild(note);
  }

  async function addConcept() {
    const title = currentNameValue.trim();
    if (!title) return;
    if (findConceptByExactTitle(concepts, title)) return; // defensive — the Add button is already disabled for this case
    if (!selectedAuthorizingClassroomId) {
      actionError = 'You need Program Manager access on at least one classroom to author Knowledge Model content.';
      rerender();
      return;
    }
    if (parentMode === 'sub-concept' && !pendingParentId) return; // defensive — Add button is already disabled for this case

    const concept = createKnowledgeConcept({
      title,
      authorizingClassroomId: selectedAuthorizingClassroomId,
      createdByUid: currentUser.uid,
    });
    concepts = [...(concepts || []), concept];

    let relationship = null;
    if (parentMode === 'sub-concept' && pendingParentId) {
      relationship = createKnowledgeRelationship({
        fromConceptId: concept.id,
        toConceptId: pendingParentId,
        type: 'IS_A',
        authorizingClassroomId: selectedAuthorizingClassroomId,
        createdByUid: currentUser.uid,
      });
      relationships = [...(relationships || []), relationship];
    }

    // Continue the drill-down: the next entry defaults to "sub-concept
    // of the one just added" (per explicit product direction — adding
    // a chain of children is then one field + Add each time); the
    // author can always switch back to Top-level or a different parent.
    currentNameValue = '';
    parentMode = 'sub-concept';
    pendingParentId = concept.id;
    actionError = null;
    revealConcept(concept.id);
    focusNameInputOnNextRender = true;
    rerender();

    try {
      await knowledgeConceptRepository.saveKnowledgeConcept(concept);
      if (relationship) await knowledgeRelationshipRepository.saveKnowledgeRelationship(relationship);
    } catch (error) {
      console.error('[KnowledgeHierarchyView] Failed to save:', error);
      actionError = "Saved locally, but couldn't reach the server — check your connection.";
      rerender();
    }
  }

  rerender();
  mount();

  async function mount() {
    try {
      [concepts, relationships] = await Promise.all([
        knowledgeConceptRepository.getAllKnowledgeConcepts(),
        knowledgeRelationshipRepository.getAllKnowledgeRelationships(),
      ]);
    } catch (error) {
      console.error('[KnowledgeHierarchyView] Failed to load Knowledge Model data:', error);
      loadError = "Couldn't load the Knowledge Model. Check your connection and try again.";
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
  intro.textContent = 'Add a Concept, optionally as a sub-concept of one you already have — the tree below fills in as you go.';
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

  wrapper.appendChild(renderAddConceptForm(state, handlers));
  wrapper.appendChild(renderHierarchyTree(state, handlers));

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

function renderAddConceptForm(state, handlers) {
  const form = document.createElement('div');
  form.className = 'knowledge-hierarchy__add-form';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'knowledge-authoring__editor-label';
  nameLabel.textContent = 'Concept name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'knowledge-authoring__editor-input';
  nameInput.placeholder = "e.g. 'Earthquake'";
  nameInput.value = state.currentNameValue;
  nameLabel.appendChild(nameInput);
  form.appendChild(nameLabel);

  const noteSlot = document.createElement('div');
  noteSlot.className = 'knowledge-hierarchy__duplicate-note-slot';
  form.appendChild(noteSlot);

  const hasConcepts = (state.concepts || []).length > 0;

  const parentChoice = document.createElement('div');
  parentChoice.className = 'knowledge-hierarchy__parent-choice';

  const topLevelOption = document.createElement('label');
  topLevelOption.className = 'knowledge-hierarchy__radio-option';
  const topLevelRadio = document.createElement('input');
  topLevelRadio.type = 'radio';
  topLevelRadio.name = 'knowledge-hierarchy-parent-mode';
  topLevelRadio.checked = state.parentMode === 'top-level';
  topLevelRadio.addEventListener('change', () => handlers.onParentModeChange('top-level'));
  topLevelOption.appendChild(topLevelRadio);
  topLevelOption.append(' Top-level concept');
  parentChoice.appendChild(topLevelOption);

  const subConceptOption = document.createElement('label');
  subConceptOption.className = 'knowledge-hierarchy__radio-option';
  const subConceptRadio = document.createElement('input');
  subConceptRadio.type = 'radio';
  subConceptRadio.name = 'knowledge-hierarchy-parent-mode';
  subConceptRadio.checked = state.parentMode === 'sub-concept';
  subConceptRadio.disabled = !hasConcepts;
  subConceptRadio.addEventListener('change', () => handlers.onParentModeChange('sub-concept'));
  subConceptOption.appendChild(subConceptRadio);
  subConceptOption.append(' Sub-concept of');
  parentChoice.appendChild(subConceptOption);

  if (state.parentMode === 'sub-concept') {
    const picker = createKnowledgeConceptPicker({
      concepts: state.concepts,
      value: state.pendingParentId || '',
      allowCustom: false,
      placeholder: 'Search existing Concepts…',
      onSelect: (conceptId) => handlers.onPendingParentChange(conceptId),
    });
    parentChoice.appendChild(picker.wrapper);
  }
  form.appendChild(parentChoice);

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary knowledge-hierarchy__add-button';
  addButton.textContent = 'Add Concept';
  addButton.addEventListener('click', handlers.onAddConcept);
  form.appendChild(addButton);

  handlers.onNameInputMount(nameInput, noteSlot, addButton);
  // Sets addButton.disabled (duplicate-aware) and any duplicate note —
  // dispatchEvent runs the listener synchronously, so this is the ONE
  // place that state is computed, right after every (re)render (e.g.
  // right after Add resets the field, or after switching parent mode)
  // — onNameInputMount only wires the live 'input' listener, it
  // doesn't run once up front on its own.
  nameInput.dispatchEvent(new Event('input'));

  if (state.focusNameInputOnNextRender) {
    // Deferred one tick so this runs after the element is actually in
    // the document (appended by the caller right after this returns).
    setTimeout(() => nameInput.focus(), 0);
  }

  return form;
}

function renderHierarchyTree(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-hierarchy__tree-section';

  const heading = document.createElement('p');
  heading.className = 'knowledge-authoring__editor-label';
  heading.textContent = 'Hierarchy';
  section.appendChild(heading);

  const forest = buildConceptHierarchyForest(state.concepts, state.relationships);

  if (forest.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No Concepts yet — add the first one above.' }));
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'knowledge-hierarchy__tree';
  forest.forEach((node) => list.appendChild(renderTreeNode(node, state, handlers)));
  section.appendChild(list);

  return section;
}

function renderTreeNode(node, state, handlers) {
  const item = document.createElement('li');
  item.className = 'knowledge-hierarchy__tree-node';

  const row = document.createElement('div');
  row.className = 'knowledge-hierarchy__tree-row';

  const hasChildren = node.children.length > 0;
  const isExpanded = state.expandedConceptIds.has(node.concept.id);

  if (hasChildren) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'knowledge-hierarchy__tree-toggle';
    toggle.setAttribute('aria-label', isExpanded ? 'Collapse' : 'Expand');
    // Always the same glyph — CSS rotates it 90deg when expanded (chevron-right -> chevron-down), rather than swapping icon shape.
    const toggleIconClass = isExpanded ? 'knowledge-hierarchy__tree-toggle-icon knowledge-hierarchy__tree-toggle-icon--expanded' : 'knowledge-hierarchy__tree-toggle-icon';
    toggle.appendChild(createIcon('arrow-right', { size: 14, className: toggleIconClass }));
    toggle.addEventListener('click', () => handlers.onToggleExpand(node.concept.id));
    row.appendChild(toggle);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'knowledge-hierarchy__tree-toggle-spacer';
    row.appendChild(spacer);
  }

  const title = document.createElement('span');
  title.className = 'knowledge-hierarchy__tree-title';
  title.textContent = node.concept.title;
  row.appendChild(title);

  if (hasChildren) {
    const count = document.createElement('span');
    count.className = 'knowledge-hierarchy__tree-count';
    count.textContent = String(node.children.length);
    row.appendChild(count);
  }

  item.appendChild(row);

  if (hasChildren && isExpanded) {
    const childList = document.createElement('ul');
    childList.className = 'knowledge-hierarchy__tree';
    node.children.forEach((child) => childList.appendChild(renderTreeNode(child, state, handlers)));
    item.appendChild(childList);
  }

  return item;
}
