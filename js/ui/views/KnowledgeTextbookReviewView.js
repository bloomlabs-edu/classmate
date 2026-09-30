/**
 * ui/views/KnowledgeTextbookReviewView.js
 *
 * ClassMate Knowledge Model — K2.4 "Knowledge Authoring", Textbook
 * Review section. Mounted by ui/views/KnowledgeAuthoringView.js's own
 * tab shell, alongside Concepts (K2.1), Relationships (K2.2), and
 * Classifications (K2.3) — reached behind the same PM-only gate
 * ui/views/CurriculumManagementView.js already adds for this whole
 * feature.
 *
 * ---------------------------------------------------------------------
 * "Review", not "Convert" — deliberately reframed per explicit product
 * direction
 * ---------------------------------------------------------------------
 *
 * The existing Curriculum Index/Library calls every flat string in a
 * Unit's own `concepts[]` array a "concept" — but this feature's own
 * K1 textbook-validation report already proved some of those strings
 * are genuine KnowledgeConcepts, some are grouping headings ("Causes of
 * floods"), and some are closer to a Classification label ("Based on
 * causes of occurrence"). This screen is titled and framed as
 * reviewing textbook KNOWLEDGE ITEMS and deciding which belong in the
 * shared Knowledge Model — never as "converting textbook concepts into
 * Concepts," which would silently assume every item deserves to become
 * one.
 *
 * ---------------------------------------------------------------------
 * Strictly READ-ONLY with respect to curriculum data
 * ---------------------------------------------------------------------
 *
 * Only services/curriculumLibraryService.js's own READ functions are
 * ever called here — getAllCurricula(), getLatestVersion(),
 * getSubjectsInVersion(), getPack(), getUnitAsImportCandidate(). Not
 * one write path of that service (or of
 * services/curriculumIndexSession.js, services/curriculumSubmissionsService.js,
 * or any other curriculum-authoring service) is imported or called
 * anywhere in this file. The Curriculum Index/Library, Curriculum Pack,
 * and `unit.concepts[]` are never modified — see
 * KnowledgeAuthoringDisplay.extractTextbookItemTitles()'s own header
 * comment for how even the in-memory read is defensively a fresh copy,
 * never the same array reference.
 *
 * NOTE ON A PRE-EXISTING, UNRELATED DISCREPANCY found while building
 * this: ui/views/AddConceptsView.js's own curriculum drill-down calls
 * `curriculumLibraryService.getCurricula()` and reads `curriculum.grades`
 * directly — neither of which exist on the real, current service
 * (`getAllCurricula()` returns curricula whose Grades live under
 * `curriculum.versions[].grades`, resolved via getLatestVersion()). This
 * file does NOT reproduce that pattern — it follows
 * ui/views/CurriculumManagementView.js's own Preview Structure flow
 * instead (verified correct, currently working), which is the one this
 * screen's own drill-down mirrors. Flagging this discrepancy in case it
 * turns out AddConceptsView.js's own flow is quietly broken — fixing it
 * is out of scope for K2.4.
 *
 * ---------------------------------------------------------------------
 * Three explicit choices, never an automatic fourth
 * ---------------------------------------------------------------------
 *
 * "Use Existing Concept" — ui/components/KnowledgeConceptPicker.js with
 * `allowCustom: false` (same reuse every K2 phase since K2.2 already
 * establishes); a human explicitly picks one, nothing here ever
 * auto-matches by title similarity.
 *
 * "Create New Concept" — title pre-filled from the textbook item
 * (editable), optional description, saved through the exact same
 * models/KnowledgeConcept.js factory + repositories/knowledgeConceptRepository.js
 * every other K2 phase already uses. Blocked (not silently redirected)
 * if a Concept with the EXACT same title already exists — see
 * KnowledgeAuthoringDisplay.findConceptByExactTitle()'s own header
 * comment for why this is the same hard, exact-match-only rule K2.1's
 * own picker already enforces, applied here because this button isn't
 * routed through that picker's dropdown at all.
 *
 * "Leave as Heading / Presentation Structure" — creates NOTHING. No
 * Concept, no Classification, no new "Heading" entity (none exists, and
 * K2.4 does not invent one), no mirror of the textbook's own hierarchy
 * anywhere in the Knowledge Model. The item's local review state simply
 * records that a human looked at it and decided it's presentation-only
 * — that state lives only in this screen's own in-memory session, never
 * persisted anywhere.
 *
 * No automatic relationship/classification/category/membership
 * inference of any kind happens here — this screen only ever creates a
 * bare KnowledgeConcept (or nothing at all). Authoring relationships
 * between whatever Concepts this review produces is Relationships'
 * (K2.2) own job, entirely separate and always a later, deliberate
 * step.
 */

import * as curriculumLibraryService from '../../services/curriculumLibraryService.js';
import * as knowledgeConceptRepository from '../../repositories/knowledgeConceptRepository.js';
import { createKnowledgeConcept } from '../../models/KnowledgeConcept.js';
import { getProgramManagerClassroomIds } from '../../services/memberService.js';
import { getDisplayName } from '../../services/classroomService.js';
import {
  extractTextbookItemTitles,
  createInitialTextbookItemStates,
  setTextbookItemState,
  findConceptByExactTitle,
} from './KnowledgeAuthoringDisplay.js';
import { createKnowledgeConceptPicker } from '../components/KnowledgeConceptPicker.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

export function renderKnowledgeTextbookReviewView(container, { classrooms, currentUser }) {
  const pmClassroomIds = getProgramManagerClassroomIds(classrooms, currentUser.uid);
  let selectedAuthorizingClassroomId = pmClassroomIds[0] || null;

  // Drill-down state — mirrors ui/views/CurriculumManagementView.js's
  // own Preview Structure flow (Curriculum -> Grade -> Subject -> Unit),
  // the verified-working read path this whole screen builds on.
  let step = 'choose-curriculum'; // 'choose-curriculum' | 'choose-grade' | 'choose-subject' | 'choose-unit' | 'review'
  let curricula = null; // null = loading
  let loadError = null;
  let selectedCurriculum = null;
  let selectedGrade = null;
  let selectedPack = null;
  let selectedUnit = null;

  // Review state — set once a Unit is chosen.
  let items = null; // string[] — this Unit's own textbook item titles
  let itemStates = null; // parallel array — see KnowledgeAuthoringDisplay.createInitialTextbookItemStates()
  let concepts = null; // all existing KnowledgeConcepts, for the picker + exact-title check
  let actionError = null;

  // Which single row currently has an inline "Use Existing"/"Create New" form open, and which one.
  let openItemIndex = null;
  let openItemAction = null; // 'existing' | 'create'
  let pendingCreateTitle = '';
  let pendingCreateDescription = '';

  function rerender() {
    renderContent(
      container,
      {
        pmClassroomIds,
        selectedAuthorizingClassroomId,
        classrooms,
        step,
        curricula,
        loadError,
        selectedCurriculum,
        selectedGrade,
        selectedPack,
        selectedUnit,
        items,
        itemStates,
        concepts,
        actionError,
        openItemIndex,
        openItemAction,
        pendingCreateTitle,
        pendingCreateDescription,
      },
      {
        onSelectAuthorizingClassroom: (classroomId) => {
          selectedAuthorizingClassroomId = classroomId;
          rerender();
        },
        onChooseCurriculum: (curriculum) => {
          selectedCurriculum = curriculum;
          step = 'choose-grade';
          rerender();
        },
        onChooseGrade: (grade) => {
          selectedGrade = grade;
          step = 'choose-subject';
          rerender();
        },
        onChooseSubject: (subjectEntry) => chooseSubject(subjectEntry),
        onChooseUnit: (unit) => chooseUnit(unit),
        onBackTo: (targetStep) => {
          step = targetStep;
          actionError = null;
          rerender();
        },
        onOpenExisting: (index) => {
          openItemIndex = index;
          openItemAction = 'existing';
          actionError = null;
          rerender();
        },
        onOpenCreate: (index) => {
          openItemIndex = index;
          openItemAction = 'create';
          pendingCreateTitle = itemStates[index].title;
          pendingCreateDescription = '';
          actionError = null;
          rerender();
        },
        onCancelItemForm: () => {
          openItemIndex = null;
          openItemAction = null;
          rerender();
        },
        onLeaveAsHeading: (index) => {
          itemStates = setTextbookItemState(itemStates, index, { status: 'heading' });
          rerender();
        },
        onResetToUndecided: (index) => {
          itemStates = setTextbookItemState(itemStates, index, { status: 'undecided', conceptId: null, conceptLabel: null });
          rerender();
        },
        onExistingConceptSelect: (value, { label, isNew }) => {
          actionError = null;
          if (isNew) {
            actionError = 'Create this Concept first, or use "Create New Concept" for this item instead.';
            rerender();
            return;
          }
          itemStates = setTextbookItemState(itemStates, openItemIndex, { status: 'existing', conceptId: value, conceptLabel: label });
          openItemIndex = null;
          openItemAction = null;
          rerender();
        },
        onSaveNewConcept: (index, title, description) => persistNewConceptForItem(index, title, description),
      }
    );
  }

  async function chooseSubject(subjectEntry) {
    loadError = null;
    step = 'choose-unit';
    rerender();
    try {
      selectedPack = await curriculumLibraryService.getPack(subjectEntry.submissionId);
    } catch (error) {
      console.error('[KnowledgeTextbookReviewView] Failed to load pack:', error);
      loadError = "Couldn't load this subject's structure. Check your connection and try again.";
    }
    rerender();
  }

  async function chooseUnit(unit) {
    selectedUnit = unit;
    items = extractTextbookItemTitles(unit);
    itemStates = createInitialTextbookItemStates(items);
    step = 'review';
    rerender();
    try {
      concepts = await knowledgeConceptRepository.getAllKnowledgeConcepts();
    } catch (error) {
      console.error('[KnowledgeTextbookReviewView] Failed to load Concepts:', error);
      actionError = "Couldn't load existing Concepts. Check your connection and try again.";
    }
    rerender();
  }

  async function persistNewConceptForItem(index, title, description) {
    actionError = null;

    if (!selectedAuthorizingClassroomId) {
      actionError = 'You need Program Manager access on at least one classroom to author Knowledge Model content.';
      rerender();
      return;
    }
    const duplicate = findConceptByExactTitle(concepts, title);
    if (duplicate) {
      actionError = `A Concept titled '${duplicate.title}' already exists — use "Use Existing Concept" for this item instead.`;
      rerender();
      return;
    }

    const concept = createKnowledgeConcept({
      title,
      description: description || null,
      // Provenance only — the Curriculum Pack's own unit id, since
      // K2.4 works from the published Curriculum Library directly (no
      // classroom is ever chosen here). See this file's own header
      // comment and this feature's own K2.4 report for why this is a
      // deliberate, honest use of the same optional field, not a scope
      // change to it.
      sourceCurriculumUnitId: selectedUnit.id,
      authorizingClassroomId: selectedAuthorizingClassroomId,
      createdByUid: currentUser.uid,
    });
    concepts = [...(concepts || []), concept];
    itemStates = setTextbookItemState(itemStates, index, { status: 'created', conceptId: concept.id, conceptLabel: concept.title });
    openItemIndex = null;
    openItemAction = null;
    rerender();
    try {
      await knowledgeConceptRepository.saveKnowledgeConcept(concept);
    } catch (error) {
      console.error('[KnowledgeTextbookReviewView] Failed to save a new KnowledgeConcept:', error);
      actionError = "Saved locally, but couldn't reach the server — check your connection.";
      rerender();
    }
  }

  rerender();
  mount();

  async function mount() {
    try {
      curricula = await curriculumLibraryService.getAllCurricula();
    } catch (error) {
      console.error('[KnowledgeTextbookReviewView] Failed to load the Curriculum Library:', error);
      loadError = "Couldn't load the Curriculum Library. Check your connection and try again.";
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
    'Review textbook knowledge items and decide which belong in the shared Knowledge Model. This never changes the Curriculum Index/Library, the Curriculum Pack, or the textbook’s own item list — it only ever reads them.';
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
  }

  if (state.step === 'choose-curriculum') {
    wrapper.appendChild(renderChooseCurriculumStep(state, handlers));
  } else if (state.step === 'choose-grade') {
    wrapper.appendChild(renderChooseGradeStep(state, handlers));
  } else if (state.step === 'choose-subject') {
    wrapper.appendChild(renderChooseSubjectStep(state, handlers));
  } else if (state.step === 'choose-unit') {
    wrapper.appendChild(renderChooseUnitStep(state, handlers));
  } else if (state.step === 'review') {
    wrapper.appendChild(renderReviewStep(state, handlers));
  }

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

function renderBackButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--text';
  button.textContent = `← ${label}`;
  button.addEventListener('click', onClick);
  return button;
}

function renderChooseCurriculumStep(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__picker-section';

  const heading = document.createElement('p');
  heading.className = 'knowledge-authoring__editor-label';
  heading.textContent = 'Choose a Curriculum';
  section.appendChild(heading);

  if (state.curricula === null) {
    const loading = document.createElement('p');
    loading.className = 'knowledge-authoring__loading';
    loading.textContent = 'Loading…';
    section.appendChild(loading);
    return section;
  }

  if (state.curricula.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No curricula in the Library yet.' }));
    return section;
  }

  const list = document.createElement('div');
  list.className = 'knowledge-authoring__list';
  state.curricula.forEach((curriculum) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'knowledge-authoring__row';
    button.textContent = curriculum.name;
    button.addEventListener('click', () => handlers.onChooseCurriculum(curriculum));
    list.appendChild(button);
  });
  section.appendChild(list);

  return section;
}

function renderChooseGradeStep(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__picker-section';
  section.appendChild(renderBackButton('Choose a different Curriculum', () => handlers.onBackTo('choose-curriculum')));

  const heading = document.createElement('p');
  heading.className = 'knowledge-authoring__editor-label';
  heading.textContent = `Choose a Grade — ${state.selectedCurriculum.name}`;
  section.appendChild(heading);

  const latestVersion = curriculumLibraryService.getLatestVersion(state.selectedCurriculum);
  const list = document.createElement('div');
  list.className = 'knowledge-authoring__list';
  (latestVersion?.grades || []).forEach((grade) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'knowledge-authoring__row';
    button.textContent = grade.name;
    button.addEventListener('click', () => handlers.onChooseGrade(grade));
    list.appendChild(button);
  });
  section.appendChild(list);

  return section;
}

function renderChooseSubjectStep(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__picker-section';
  section.appendChild(renderBackButton('Choose a different Grade', () => handlers.onBackTo('choose-grade')));

  const heading = document.createElement('p');
  heading.className = 'knowledge-authoring__editor-label';
  heading.textContent = `Choose a Subject — ${state.selectedGrade.name}`;
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'knowledge-authoring__list';
  (state.selectedGrade.subjects || []).forEach((subjectEntry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'knowledge-authoring__row';
    button.textContent = subjectEntry.name;
    button.addEventListener('click', () => handlers.onChooseSubject(subjectEntry));
    list.appendChild(button);
  });
  section.appendChild(list);

  return section;
}

function renderChooseUnitStep(state, handlers) {
  const section = document.createElement('div');
  section.className = 'knowledge-authoring__picker-section';
  section.appendChild(renderBackButton('Choose a different Subject', () => handlers.onBackTo('choose-subject')));

  if (!state.selectedPack) {
    const loading = document.createElement('p');
    loading.className = 'knowledge-authoring__loading';
    loading.textContent = 'Loading…';
    section.appendChild(loading);
    return section;
  }

  const heading = document.createElement('p');
  heading.className = 'knowledge-authoring__editor-label';
  heading.textContent = `Choose a Unit — ${state.selectedPack.curriculum} ${state.selectedPack.grade} ${state.selectedPack.subject}`;
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'knowledge-authoring__list';
  state.selectedPack.units.forEach((unit) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'knowledge-authoring__row';
    const title = document.createElement('span');
    title.className = 'knowledge-authoring__row-title';
    title.textContent = unit.title;
    button.appendChild(title);
    const count = document.createElement('span');
    count.className = 'knowledge-authoring__row-description';
    count.textContent = `${(unit.concepts || []).length} item${(unit.concepts || []).length === 1 ? '' : 's'}`;
    button.appendChild(count);
    button.addEventListener('click', () => handlers.onChooseUnit(unit));
    list.appendChild(button);
  });
  section.appendChild(list);

  return section;
}

function renderReviewStep(state, handlers) {
  const section = document.createElement('div');
  section.appendChild(renderBackButton('Choose a different Unit', () => handlers.onBackTo('choose-unit')));

  const heading = document.createElement('p');
  heading.className = 'knowledge-authoring__editor-label';
  heading.textContent = `Reviewing — ${state.selectedUnit.title}`;
  section.appendChild(heading);

  if (state.concepts === null) {
    const loading = document.createElement('p');
    loading.className = 'knowledge-authoring__loading';
    loading.textContent = 'Loading…';
    section.appendChild(loading);
    return section;
  }

  if (state.itemStates.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'This Unit has no textbook items to review.' }));
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'knowledge-authoring__list';
  state.itemStates.forEach((item, index) => {
    list.appendChild(renderReviewItemRow(item, index, state, handlers));
  });
  section.appendChild(list);

  return section;
}

function renderReviewItemRow(item, index, state, handlers) {
  const row = document.createElement('li');
  row.className = 'knowledge-authoring__row';

  const title = document.createElement('span');
  title.className = 'knowledge-authoring__row-title';
  title.textContent = item.title;
  row.appendChild(title);

  if (item.status === 'undecided') {
    const actions = document.createElement('div');
    actions.className = 'knowledge-authoring__form-actions';

    const existingButton = document.createElement('button');
    existingButton.type = 'button';
    existingButton.className = 'btn btn--secondary';
    existingButton.textContent = 'Use Existing Concept';
    existingButton.addEventListener('click', () => handlers.onOpenExisting(index));
    actions.appendChild(existingButton);

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'btn btn--secondary';
    createButton.textContent = 'Create New Concept';
    createButton.addEventListener('click', () => handlers.onOpenCreate(index));
    actions.appendChild(createButton);

    const headingButton = document.createElement('button');
    headingButton.type = 'button';
    headingButton.className = 'btn btn--text';
    headingButton.textContent = 'Leave as Heading';
    headingButton.addEventListener('click', () => handlers.onLeaveAsHeading(index));
    actions.appendChild(headingButton);

    row.appendChild(actions);

    if (state.openItemIndex === index && state.openItemAction === 'existing') {
      row.appendChild(renderExistingConceptForm(state, handlers));
    } else if (state.openItemIndex === index && state.openItemAction === 'create') {
      row.appendChild(renderCreateConceptForm(index, state, handlers));
    }
  } else if (item.status === 'heading') {
    const note = document.createElement('span');
    note.className = 'knowledge-authoring__row-description';
    note.textContent = '— Left as heading / presentation structure';
    row.appendChild(note);
    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'btn btn--text';
    change.textContent = 'Change';
    change.addEventListener('click', () => handlers.onResetToUndecided(index));
    row.appendChild(change);
  } else if (item.status === 'existing') {
    const note = document.createElement('span');
    note.className = 'knowledge-authoring__row-description';
    note.textContent = `✓ Mapped to existing Concept: ${item.conceptLabel}`;
    row.appendChild(note);
  } else if (item.status === 'created') {
    const note = document.createElement('span');
    note.className = 'knowledge-authoring__row-description';
    note.textContent = `✓ Created new Concept: ${item.conceptLabel}`;
    row.appendChild(note);
  }

  return row;
}

function renderExistingConceptForm(state, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'knowledge-authoring__new-concept-form';

  const label = document.createElement('label');
  label.className = 'knowledge-authoring__editor-label';
  label.textContent = 'Concept';
  const picker = createKnowledgeConceptPicker({
    concepts: state.concepts,
    placeholder: 'Search existing Concepts…',
    allowCustom: false,
    onSelect: handlers.onExistingConceptSelect,
  });
  label.appendChild(picker.wrapper);
  wrap.appendChild(label);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--text';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', handlers.onCancelItemForm);
  wrap.appendChild(cancel);

  return wrap;
}

function renderCreateConceptForm(index, state, handlers) {
  const form = document.createElement('form');
  form.className = 'knowledge-authoring__new-concept-form';

  const titleLabel = document.createElement('label');
  titleLabel.className = 'knowledge-authoring__editor-label';
  titleLabel.textContent = 'Title';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'knowledge-authoring__editor-input';
  titleInput.required = true;
  titleInput.value = state.pendingCreateTitle;
  titleLabel.appendChild(titleInput);
  form.appendChild(titleLabel);

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
  saveButton.textContent = 'Save Concept';
  actions.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelItemForm);
  actions.appendChild(cancelButton);
  form.appendChild(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    handlers.onSaveNewConcept(index, title, descInput.value.trim());
  });

  return form;
}
