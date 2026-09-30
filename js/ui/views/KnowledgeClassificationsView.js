/**
 * ui/views/KnowledgeClassificationsView.js
 *
 * ClassMate Knowledge Model — K2.3 "Knowledge Authoring", Classifications
 * section. Mounted by ui/views/KnowledgeAuthoringView.js's own tab
 * shell, alongside ui/views/KnowledgeConceptsView.js (K2.1) and
 * ui/views/KnowledgeRelationshipsView.js (K2.2) — reached behind the
 * same PM-only gate ui/views/CurriculumManagementView.js already adds
 * for this whole feature.
 *
 * ---------------------------------------------------------------------
 * Presentation nesting, never structural ownership
 * ---------------------------------------------------------------------
 *
 * Each Classification renders as a card; each of its Categories renders
 * as an indented bullet list of the Concepts currently assigned to it.
 * That indentation is ENTIRELY presentational — see
 * KnowledgeAuthoringDisplay.buildClassificationBlocks()'s own header
 * comment. The underlying data is exactly K1's frozen shape: a
 * Classification with an inline `categories[]` array, and separate
 * KnowledgeClassificationMembership documents that are the only thing
 * connecting a Concept to a Category. Nothing here writes a `categoryId`
 * or `classificationId` onto a Concept itself — that field does not
 * exist and never will (see models/KnowledgeConcept.js's own header
 * comment). The intro copy below says this explicitly, and a Concept
 * bullet is never rendered as a clickable/draggable "child" of its
 * Category — it's a plain list item, same visual weight as any other
 * line of text.
 *
 * ---------------------------------------------------------------------
 * Both a Concept and a Category must already exist — no inline creation
 * ---------------------------------------------------------------------
 *
 * "Assign Concept" reuses ui/components/KnowledgeConceptPicker.js with
 * `allowCustom: false` (same reuse K2.2's Relationships form already
 * established) for the Concept half, and a plain `<select>` scoped to
 * the target Classification's own `categories[]` for the Category half
 * — a Category list is expected to stay small and curated (K1's own
 * design report: "few, stable, ordered"), so a second
 * SearchableSelect-backed search component would be more machinery than
 * this list size ever needs. Neither half can create anything new:
 * Concepts are created only on the Concepts section; Categories are
 * created only via this section's own "+ Add Category" action, never
 * implicitly from typing a name while assigning (K2.3 requirement 9 —
 * "Natural" remains a Category, never a KnowledgeConcept).
 *
 * ---------------------------------------------------------------------
 * At most one membership per Concept per Classification (K2.3 policy)
 * ---------------------------------------------------------------------
 *
 * Enforced entirely client-side via
 * KnowledgeAuthoringDisplay.findMembershipForConceptInClassification() —
 * scoped strictly to `classificationId`, so the SAME Concept can still
 * hold an independent membership under a DIFFERENT Classification
 * (K2.3 requirement 6). Not a firestore.rules change — K1's rules stay
 * exactly as frozen; this is a client-side authoring convenience only,
 * the same posture K2.2 already took for duplicate-relationship
 * detection.
 *
 * ---------------------------------------------------------------------
 * Deletion — Membership only, this phase
 * ---------------------------------------------------------------------
 *
 * Unassigning a Concept from a Category (deleting its
 * KnowledgeClassificationMembership) is safe and offered here — nothing
 * else in K1's schema references a Membership's own id. Deleting a
 * whole Category or a whole Classification is deliberately NOT offered
 * in K2.3 — see this feature's own K2.3 implementation report for why
 * (in short: both would require checking for, and either blocking on or
 * cascading through, existing Memberships that reference them; cascading
 * delete isn't supported by any existing repository operation, and a
 * "block if referenced" client check alone still leaves open questions
 * — e.g. what an author does next when blocked — better decided as its
 * own reviewed phase than folded into this one).
 *
 * No automatic relationship-to-membership inference anywhere in this
 * file (K2.3 requirement 10) — "Flood IS_A Hazard"
 * (models/KnowledgeRelationship.js) is never read by anything here at
 * all; a membership is only ever created by an explicit "Assign
 * Concept" action.
 */

import * as knowledgeConceptRepository from '../../repositories/knowledgeConceptRepository.js';
import * as knowledgeClassificationRepository from '../../repositories/knowledgeClassificationRepository.js';
import * as knowledgeClassificationMembershipRepository from '../../repositories/knowledgeClassificationMembershipRepository.js';
import { createKnowledgeClassification, createKnowledgeCategory } from '../../models/KnowledgeClassification.js';
import { createKnowledgeClassificationMembership } from '../../models/KnowledgeClassificationMembership.js';
import { getProgramManagerClassroomIds } from '../../services/memberService.js';
import { getDisplayName } from '../../services/classroomService.js';
import { buildClassificationBlocks, buildCategoryOptions, findMembershipForConceptInClassification } from './KnowledgeAuthoringDisplay.js';
import { createKnowledgeConceptPicker } from '../components/KnowledgeConceptPicker.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

export function renderKnowledgeClassificationsView(container, { classrooms, currentUser }) {
  const pmClassroomIds = getProgramManagerClassroomIds(classrooms, currentUser.uid);
  let selectedAuthorizingClassroomId = pmClassroomIds[0] || null;

  let classifications = null; // null = loading
  let memberships = null; // null = loading
  let concepts = null; // null = loading
  let loadError = null;
  let actionError = null;

  // "+ New Classification" form state.
  let newClassificationName = '';
  let newClassificationDescription = '';
  let showNewClassificationForm = false;

  // "+ Add Category" — which Classification is currently showing its inline form, and the typed name.
  let addCategoryTargetClassificationId = null;
  let newCategoryName = '';

  // "+ Assign Concept" — which Classification is currently showing its inline form, and its own picker/select state.
  let assignTargetClassificationId = null;
  let assignConceptId = null;
  let assignConceptLabel = '';
  let assignCategoryId = '';

  function rerender() {
    renderContent(
      container,
      {
        pmClassroomIds,
        selectedAuthorizingClassroomId,
        classrooms,
        classifications,
        memberships,
        concepts,
        loadError,
        actionError,
        newClassificationName,
        newClassificationDescription,
        showNewClassificationForm,
        addCategoryTargetClassificationId,
        newCategoryName,
        assignTargetClassificationId,
        assignConceptId,
        assignConceptLabel,
        assignCategoryId,
      },
      {
        onSelectAuthorizingClassroom: (classroomId) => {
          selectedAuthorizingClassroomId = classroomId;
          rerender();
        },
        onToggleNewClassificationForm: () => {
          showNewClassificationForm = !showNewClassificationForm;
          newClassificationName = '';
          newClassificationDescription = '';
          rerender();
        },
        onSaveNewClassification: (name, description) => persistNewClassification(name, description),
        onOpenAddCategory: (classificationId) => {
          addCategoryTargetClassificationId = classificationId;
          newCategoryName = '';
          actionError = null;
          rerender();
        },
        onCancelAddCategory: () => {
          addCategoryTargetClassificationId = null;
          rerender();
        },
        onSaveNewCategory: (classificationId, name) => persistNewCategory(classificationId, name),
        onOpenAssignConcept: (classificationId) => {
          assignTargetClassificationId = classificationId;
          assignConceptId = null;
          assignConceptLabel = '';
          assignCategoryId = '';
          actionError = null;
          rerender();
        },
        onCancelAssignConcept: () => {
          assignTargetClassificationId = null;
          rerender();
        },
        onAssignConceptSelect: (value, { label, isNew }) => {
          actionError = null;
          if (isNew) {
            actionError = 'Create this Concept first on the Concepts section, then come back to assign it.';
            rerender();
            return;
          }
          assignConceptId = value;
          assignConceptLabel = label;
          rerender();
        },
        onAssignCategoryChange: (categoryId) => {
          assignCategoryId = categoryId;
          rerender();
        },
        onSaveAssignment: (classificationId) => persistNewMembership(classificationId),
        onDeleteMembership: (membershipId) => deleteMembership(membershipId),
      }
    );
  }

  async function persistNewClassification(name, description) {
    if (!selectedAuthorizingClassroomId) {
      actionError = 'You need Program Manager access on at least one classroom to author Knowledge Model content.';
      rerender();
      return;
    }
    const classification = createKnowledgeClassification({
      name,
      description: description || null,
      categories: [],
      authorizingClassroomId: selectedAuthorizingClassroomId,
      createdByUid: currentUser.uid,
    });
    classifications = [...(classifications || []), classification];
    showNewClassificationForm = false;
    actionError = null;
    rerender();
    try {
      await knowledgeClassificationRepository.saveKnowledgeClassification(classification);
    } catch (error) {
      console.error('[KnowledgeClassificationsView] Failed to save a new KnowledgeClassification:', error);
      actionError = "Saved locally, but couldn't reach the server — check your connection.";
      rerender();
    }
  }

  async function persistNewCategory(classificationId, name) {
    const classification = classifications.find((c) => c.id === classificationId);
    const category = createKnowledgeCategory({ name });
    const updatedClassification = { ...classification, categories: [...(classification.categories || []), category] };
    classifications = classifications.map((c) => (c.id === classificationId ? updatedClassification : c));
    addCategoryTargetClassificationId = null;
    actionError = null;
    rerender();
    try {
      await knowledgeClassificationRepository.saveKnowledgeClassification(updatedClassification);
    } catch (error) {
      console.error('[KnowledgeClassificationsView] Failed to save a new Category:', error);
      actionError = "Saved locally, but couldn't reach the server — check your connection.";
      rerender();
    }
  }

  async function persistNewMembership(classificationId) {
    actionError = null;

    if (!selectedAuthorizingClassroomId) {
      actionError = 'You need Program Manager access on at least one classroom to author Knowledge Model content.';
      rerender();
      return;
    }
    if (!assignConceptId) {
      actionError = 'Pick a Concept to assign.';
      rerender();
      return;
    }
    if (!assignCategoryId) {
      actionError = 'Pick a Category to assign it to.';
      rerender();
      return;
    }

    const existing = findMembershipForConceptInClassification(memberships, { conceptId: assignConceptId, classificationId });
    if (existing) {
      const classification = classifications.find((c) => c.id === classificationId);
      const existingCategory = (classification?.categories || []).find((c) => c.id === existing.categoryId);
      actionError = `'${assignConceptLabel}' already belongs to '${existingCategory ? existingCategory.name : 'a Category'}' within this Classification. Remove that assignment first if you want to reassign it.`;
      rerender();
      return;
    }

    const membership = createKnowledgeClassificationMembership({
      conceptId: assignConceptId,
      classificationId,
      categoryId: assignCategoryId,
      authorizingClassroomId: selectedAuthorizingClassroomId,
      createdByUid: currentUser.uid,
    });
    memberships = [...(memberships || []), membership];
    assignTargetClassificationId = null;
    rerender();
    try {
      await knowledgeClassificationMembershipRepository.saveKnowledgeClassificationMembership(membership);
    } catch (error) {
      console.error('[KnowledgeClassificationsView] Failed to save a new KnowledgeClassificationMembership:', error);
      actionError = "Saved locally, but couldn't reach the server — check your connection.";
      rerender();
    }
  }

  async function deleteMembership(membershipId) {
    if (!window.confirm('Remove this Concept from this Category? This can’t be undone.')) return;
    memberships = memberships.filter((m) => m.id !== membershipId);
    rerender();
    try {
      await knowledgeClassificationMembershipRepository.deleteKnowledgeClassificationMembership(membershipId);
    } catch (error) {
      console.error('[KnowledgeClassificationsView] Failed to delete a KnowledgeClassificationMembership:', error);
      actionError = "Couldn't remove that assignment. Check your connection and try again.";
      rerender();
    }
  }

  rerender();
  mount();

  async function mount() {
    try {
      const [loadedClassifications, loadedMemberships, loadedConcepts] = await Promise.all([
        knowledgeClassificationRepository.getAllKnowledgeClassifications(),
        knowledgeClassificationMembershipRepository.getAllKnowledgeClassificationMemberships(),
        knowledgeConceptRepository.getAllKnowledgeConcepts(),
      ]);
      classifications = loadedClassifications;
      memberships = loadedMemberships;
      concepts = loadedConcepts;
    } catch (error) {
      console.error('[KnowledgeClassificationsView] Failed to load Classifications/Memberships/Concepts:', error);
      loadError = "Couldn't load Knowledge Classifications. Check your connection and try again.";
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
    'A Classification is a lens for grouping Concepts (e.g. "Based on causes of occurrence"). Assigning a Concept to a Category never changes the Concept itself — it only records a fact alongside it. The same Concept can be assigned under several different Classifications at once.';
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

  if (state.classifications === null || state.memberships === null || state.concepts === null) {
    const loading = document.createElement('p');
    loading.className = 'knowledge-authoring__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  wrapper.appendChild(renderNewClassificationSection(state, handlers));
  wrapper.appendChild(renderClassificationList(state, handlers));

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

function renderNewClassificationSection(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__picker-section';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'btn btn--secondary';
  toggleButton.textContent = state.showNewClassificationForm ? 'Cancel' : '+ New Classification';
  toggleButton.addEventListener('click', handlers.onToggleNewClassificationForm);
  section.appendChild(toggleButton);

  if (state.showNewClassificationForm) {
    const form = document.createElement('form');
    form.className = 'knowledge-authoring__new-concept-form';

    const nameLabel = document.createElement('label');
    nameLabel.className = 'knowledge-authoring__editor-label';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'knowledge-authoring__editor-input';
    nameInput.required = true;
    nameInput.placeholder = "e.g. 'Based on causes of occurrence'";
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    const descLabel = document.createElement('label');
    descLabel.className = 'knowledge-authoring__editor-label';
    descLabel.textContent = 'Description (optional)';
    const descInput = document.createElement('textarea');
    descInput.className = 'knowledge-authoring__editor-input';
    descLabel.appendChild(descInput);
    form.appendChild(descLabel);

    const actions = document.createElement('div');
    actions.className = 'knowledge-authoring__form-actions';
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'btn btn--primary';
    saveButton.textContent = 'Save Classification';
    actions.appendChild(saveButton);
    form.appendChild(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      handlers.onSaveNewClassification(name, descInput.value.trim());
    });

    section.appendChild(form);
  }

  return section;
}

function renderClassificationList(state, handlers) {
  const wrap = document.createElement('div');

  const blocks = buildClassificationBlocks(state.classifications, state.memberships, state.concepts);

  if (blocks.length === 0) {
    wrap.appendChild(createEmptyStateElement({ message: 'No Classifications yet — create the first one above.' }));
    return wrap;
  }

  blocks.forEach((block) => {
    wrap.appendChild(renderClassificationCard(block, state, handlers));
  });

  return wrap;
}

function renderClassificationCard(block, state, handlers) {
  const card = document.createElement('div');
  card.className = 'knowledge-authoring__classification-card';

  const heading = document.createElement('h3');
  heading.className = 'knowledge-authoring__classification-name';
  heading.textContent = block.name;
  card.appendChild(heading);

  if (block.description) {
    const desc = document.createElement('p');
    desc.className = 'knowledge-authoring__row-description';
    desc.textContent = block.description;
    card.appendChild(desc);
  }

  if (block.categories.length === 0) {
    card.appendChild(createEmptyStateElement({ message: 'No Categories yet.', compact: true }));
  } else {
    const categoryList = document.createElement('div');
    categoryList.className = 'knowledge-authoring__category-list';
    block.categories.forEach((category) => {
      categoryList.appendChild(renderCategoryBlock(category, handlers));
    });
    card.appendChild(categoryList);
  }

  const actions = document.createElement('div');
  actions.className = 'knowledge-authoring__form-actions';

  const addCategoryButton = document.createElement('button');
  addCategoryButton.type = 'button';
  addCategoryButton.className = 'btn btn--secondary';
  addCategoryButton.textContent = state.addCategoryTargetClassificationId === block.id ? 'Cancel' : '+ Add Category';
  addCategoryButton.addEventListener('click', () =>
    state.addCategoryTargetClassificationId === block.id ? handlers.onCancelAddCategory() : handlers.onOpenAddCategory(block.id)
  );
  actions.appendChild(addCategoryButton);

  const assignButton = document.createElement('button');
  assignButton.type = 'button';
  assignButton.className = 'btn btn--secondary';
  assignButton.textContent = state.assignTargetClassificationId === block.id ? 'Cancel' : '+ Assign Concept';
  assignButton.disabled = block.categories.length === 0 && state.assignTargetClassificationId !== block.id;
  if (assignButton.disabled) assignButton.title = 'Add a Category first.';
  assignButton.addEventListener('click', () =>
    state.assignTargetClassificationId === block.id ? handlers.onCancelAssignConcept() : handlers.onOpenAssignConcept(block.id)
  );
  actions.appendChild(assignButton);

  card.appendChild(actions);

  if (state.addCategoryTargetClassificationId === block.id) {
    card.appendChild(renderAddCategoryForm(block.id, handlers));
  }

  if (state.assignTargetClassificationId === block.id) {
    card.appendChild(renderAssignConceptForm(block, state, handlers));
  }

  return card;
}

/** One Category — a plain name plus a flat bullet list of the Concepts CURRENTLY assigned to it. Indentation here is presentation only (see this file's own header comment); a bullet is never draggable/nested further, and removing one only ever deletes its own KnowledgeClassificationMembership, never the Concept it names. */
function renderCategoryBlock(category, handlers) {
  const block = document.createElement('div');
  block.className = 'knowledge-authoring__category-block';

  const name = document.createElement('p');
  name.className = 'knowledge-authoring__category-name';
  name.textContent = category.name;
  block.appendChild(name);

  if (category.assignedConcepts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-authoring__category-empty';
    empty.textContent = '[none yet]';
    block.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'knowledge-authoring__category-concept-list';
    category.assignedConcepts.forEach((assigned) => {
      const item = document.createElement('li');
      const titleSpan = document.createElement('span');
      titleSpan.textContent = assigned.title;
      item.appendChild(titleSpan);
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'btn btn--text';
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => handlers.onDeleteMembership(assigned.membershipId));
      item.appendChild(removeButton);
      list.appendChild(item);
    });
    block.appendChild(list);
  }

  return block;
}

function renderAddCategoryForm(classificationId, handlers) {
  const form = document.createElement('form');
  form.className = 'knowledge-authoring__new-concept-form';

  const label = document.createElement('label');
  label.className = 'knowledge-authoring__editor-label';
  label.textContent = 'Category name';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'knowledge-authoring__editor-input';
  input.required = true;
  label.appendChild(input);
  form.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'knowledge-authoring__form-actions';
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Add Category';
  actions.appendChild(saveButton);
  form.appendChild(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    handlers.onSaveNewCategory(classificationId, name);
  });

  return form;
}

function renderAssignConceptForm(block, state, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'knowledge-authoring__new-concept-form';

  const conceptLabel = document.createElement('label');
  conceptLabel.className = 'knowledge-authoring__editor-label';
  conceptLabel.textContent = 'Concept';
  const picker = createKnowledgeConceptPicker({
    concepts: state.concepts,
    placeholder: 'Search existing Concepts…',
    allowCustom: false,
    onSelect: handlers.onAssignConceptSelect,
  });
  conceptLabel.appendChild(picker.wrapper);
  wrap.appendChild(conceptLabel);

  const categoryLabel = document.createElement('label');
  categoryLabel.className = 'knowledge-authoring__editor-label';
  categoryLabel.textContent = 'Category';
  const categorySelect = document.createElement('select');
  categorySelect.className = 'knowledge-authoring__classroom-select';
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'Choose a Category…';
  placeholderOption.disabled = true;
  placeholderOption.selected = !state.assignCategoryId;
  categorySelect.appendChild(placeholderOption);
  buildCategoryOptions(block).forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === state.assignCategoryId;
    categorySelect.appendChild(option);
  });
  categorySelect.addEventListener('change', () => handlers.onAssignCategoryChange(categorySelect.value));
  categoryLabel.appendChild(categorySelect);
  wrap.appendChild(categoryLabel);

  const actions = document.createElement('div');
  actions.className = 'knowledge-authoring__form-actions';
  const assignButton = document.createElement('button');
  assignButton.type = 'button';
  assignButton.className = 'btn btn--primary';
  assignButton.textContent = 'Assign';
  assignButton.addEventListener('click', () => handlers.onSaveAssignment(block.id));
  actions.appendChild(assignButton);
  wrap.appendChild(actions);

  return wrap;
}
