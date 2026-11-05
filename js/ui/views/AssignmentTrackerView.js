/**
 * ui/views/AssignmentTrackerView.js
 *
 * The classroom-level Assignments landing page — REDESIGNED (2026-10)
 * per explicit product decision: Assignment Categories ("Worksheets",
 * "Graphic Organizers") were the primary navigation folder here before
 * this redesign; they are now metadata only (a "type" pill on each
 * card), exactly mirroring how ui/views/NotebookTrackerView.js already
 * treats Notebook Type as "a small pill... metadata describing it"
 * while Subject is the card's real identity. The primary navigation
 * item here is now the individual Assignment itself — one card per
 * Assignment, clicking it opens its own checkpoint tracker (see
 * ui/views/AssignmentDetailView.js, the redesign's new per-assignment
 * screen), the same "choose a thing, see its checkpoints" shape
 * NotebookTrackerView.js already established for Notebooks.
 *
 * Category/aspect CONFIGURATION is unchanged and stays exactly where
 * it was (Settings > Assignment Categories, services/assignmentConfigService.js)
 * — this redesign only changes what a teacher clicks to get to their
 * actual assignments day to day, never the underlying category/aspect
 * data, which is preserved byte-for-byte (same ids, same names, same
 * aspects).
 *
 * Reuses ui/views/NotebookTrackerView.js's own CSS classes
 * (.notebook-tracker__*) — same bento card grid, page header, and
 * configure-panel shape as before this redesign.
 */

import * as assignmentService from '../../services/assignmentService.js';
import * as assignmentConfigService from '../../services/assignmentConfigService.js';
import * as assignmentCheckpointService from '../../services/assignmentCheckpointService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon, createIconBadge } from '../components/Icon.js';
import { createOverflowMenu } from '../components/OverflowMenu.js';
import { formatDate, getTodayDateKey } from '../../utils/dateHelpers.js';

export function renderAssignmentTrackerView(container, { classroom, onBack, onNavigate, onOpenAssignmentConfiguration, onGoToClassMode }) {
  let currentClassroom = classroom;
  let isCreating = false;
  let editingAssignmentId = null;

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view notebook-tracker-view';

  const header = document.createElement('header');
  header.className = 'notebook-tracker__page-header';
  const backButton = createBackButton(onBack);
  const title = document.createElement('h1');
  title.className = 'notebook-tracker__page-header-title';
  title.textContent = 'Assignments';
  header.append(backButton, title);
  if (onGoToClassMode) {
    const actions = document.createElement('div');
    actions.className = 'notebook-tracker__page-header-actions';
    const classModeButton = document.createElement('button');
    classModeButton.type = 'button';
    classModeButton.className = 'btn btn--ghost btn--icon-only';
    classModeButton.appendChild(createIcon('users'));
    classModeButton.setAttribute('aria-label', 'Class Mode');
    classModeButton.title = 'Class Mode';
    classModeButton.addEventListener('click', onGoToClassMode);
    actions.appendChild(classModeButton);
    header.appendChild(actions);
  }
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content notebook-tracker__content';

  content.appendChild(renderPageIntro());

  const categories = assignmentConfigService.listCategories(currentClassroom);

  const addButtonSlot = document.createElement('div');
  const formSlot = document.createElement('div');
  const gridSlot = document.createElement('div');
  content.appendChild(addButtonSlot);
  content.appendChild(formSlot);
  content.appendChild(gridSlot);
  content.appendChild(createConfigurePanel(onOpenAssignmentConfiguration));

  wrapper.appendChild(content);
  container.appendChild(wrapper);

  function persistClassroom() {
    workspaceService.save(currentClassroom);
  }

  function refreshAddButton() {
    addButtonSlot.innerHTML = '';
    if (categories.length === 0) return; // nothing to create an assignment AS yet — configure a type first
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--primary notebook-checkpoints__add-button';
    addButton.textContent = '+ New Assignment';
    addButton.addEventListener('click', () => {
      isCreating = true;
      editingAssignmentId = null;
      refreshForm();
    });
    addButtonSlot.appendChild(addButton);
  }

  const handlers = {
    onStartEdit: (assignmentId) => {
      isCreating = false;
      editingAssignmentId = assignmentId;
      refreshForm();
    },
    onCancelEdit: () => {
      isCreating = false;
      editingAssignmentId = null;
      refreshForm();
    },
    onSave: (fields) => {
      if (isCreating) {
        assignmentService.createNewAssignment(currentClassroom, fields);
      } else {
        const assignment = assignmentService.getAssignmentById(currentClassroom, editingAssignmentId);
        assignmentService.updateAssignment(assignment, fields);
      }
      isCreating = false;
      editingAssignmentId = null;
      refreshForm();
      persistClassroom();
      refreshGrid();
    },
    onDelete: (assignmentId, title) => {
      const impact = assignmentCheckpointService.countCheckpointImpactForAssignment(currentClassroom, assignmentId);
      const message = buildDeleteImpactMessage(title, impact);
      if (!window.confirm(message)) return;
      // Cascade BEFORE the assignment itself is removed, while
      // assignmentId can still resolve its own checkpoints — mirrors
      // services/checkpointService.js's own deleteAllCheckpointsForNotebook()
      // cascade-before-removal convention exactly.
      assignmentCheckpointService.deleteAllCheckpointsForAssignment(currentClassroom, assignmentId);
      assignmentService.deleteAssignment(currentClassroom, assignmentId);
      persistClassroom();
      refreshGrid();
    },
    onOpen: (assignmentId) => onNavigate(`/classroom/${currentClassroom.id}/assignments/${assignmentId}`),
  };

  function refreshForm() {
    formSlot.innerHTML = '';
    if (isCreating || editingAssignmentId) {
      const assignment = editingAssignmentId ? assignmentService.getAssignmentById(currentClassroom, editingAssignmentId) : null;
      formSlot.appendChild(renderAssignmentForm(assignment, currentClassroom, handlers));
    }
  }

  function refreshGrid() {
    gridSlot.innerHTML = '';

    const assignments = (currentClassroom.assignments || [])
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (categories.length === 0) {
      gridSlot.appendChild(
        createEmptyStateElement({ message: 'No assignment types configured yet — set up a type (e.g. Worksheet, Project) from Settings > Assignment Categories first.' })
      );
      return;
    }

    if (assignments.length === 0) {
      gridSlot.appendChild(createEmptyStateElement({ message: 'No assignments yet — click "+ New Assignment" to add your first one.' }));
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'notebook-tracker__bento-grid';
    assignments.forEach((assignment) => {
      grid.appendChild(createAssignmentCard(assignment, currentClassroom, handlers));
    });
    gridSlot.appendChild(grid);
  }

  refreshAddButton();
  refreshForm();
  refreshGrid();
}

function renderPageIntro() {
  const intro = document.createElement('div');
  intro.className = 'notebook-tracker__intro';
  intro.appendChild(createIconBadge('pencil', 'activities', { size: 40 }));

  const text = document.createElement('div');
  text.className = 'notebook-tracker__intro-text';

  const heading = document.createElement('h2');
  heading.className = 'notebook-tracker__intro-heading';
  heading.textContent = 'My Assignments';
  text.appendChild(heading);

  const subtitle = document.createElement('p');
  subtitle.className = 'notebook-tracker__intro-subtitle';
  subtitle.textContent = 'Track worksheets, projects, and other learning tasks across your classes.';
  text.appendChild(subtitle);

  intro.appendChild(text);
  return intro;
}

/** Linked-concept chips, resolved live (never copied) — unchanged from the pre-redesign card. */
function buildConceptChips(classroom, conceptIds) {
  const chips = document.createElement('div');
  chips.className = 'assignment-form__concept-chips';
  (conceptIds || []).forEach((conceptId) => {
    const concept = learningRecordService.getConceptById(classroom, conceptId);
    if (!concept) return;
    const chip = document.createElement('span');
    chip.className = 'assignment-form__concept-chip';
    chip.textContent = concept.title;
    chips.appendChild(chip);
  });
  return chips;
}

/**
 * One Assignment's own landing-page card — title is the primary
 * identity; Type (category) and Subject are small metadata pills, the
 * same visual hierarchy NotebookTrackerView.js's own
 * createNotebookTypeCard() already established for Subject/Notebook
 * Type. Clicking the card opens this Assignment's own checkpoint
 * tracker (ui/views/AssignmentDetailView.js); Edit/Delete live in the
 * overflow menu, same precedent as the retired grid-column card's own
 * menu.
 */
function createAssignmentCard(assignment, classroom, handlers) {
  const category = assignmentConfigService.getCategoryById(classroom, assignment.categoryId);
  const subject = assignment.subjectId ? learningRecordService.getSubjects(classroom).find((s) => s.id === assignment.subjectId) : null;

  const card = document.createElement('div');
  card.className = 'notebook-tracker__bento-card notebook-tracker__bento-card--assignment';

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'notebook-tracker__bento-card-open-area';
  openButton.addEventListener('click', () => handlers.onOpen(assignment.id));

  const top = document.createElement('div');
  top.className = 'notebook-tracker__bento-card-top';
  top.appendChild(createIconBadge('pencil', 'activities', { size: 40 }));
  const arrow = document.createElement('span');
  arrow.className = 'notebook-tracker__bento-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.appendChild(createIcon('arrow-right', { size: 16 }));
  top.appendChild(arrow);
  openButton.appendChild(top);

  // Workstream 4A — the auto-generated code is this worksheet's own
  // primary identifier once it has one; the description (the former
  // free-text "Title" field, unchanged internally — see
  // renderAssignmentForm()'s own comment) stays visible right below it,
  // never replaced. An Assignment created before this field existed has
  // no code at all and simply shows its description alone, unchanged
  // from before this feature.
  if (assignment.code) {
    const codeEl = document.createElement('span');
    codeEl.className = 'notebook-tracker__bento-code';
    codeEl.textContent = assignment.code;
    openButton.appendChild(codeEl);
  }

  const titleEl = document.createElement('span');
  titleEl.className = 'notebook-tracker__bento-title';
  titleEl.textContent = assignment.title;
  openButton.appendChild(titleEl);

  const pillRow = document.createElement('div');
  pillRow.className = 'assignment-tracker__pill-row';
  if (category) {
    const typePill = document.createElement('span');
    typePill.className = 'notebook-tracker__bento-pill';
    typePill.textContent = category.name;
    pillRow.appendChild(typePill);
  }
  if (subject) {
    const subjectPill = document.createElement('span');
    subjectPill.className = 'notebook-tracker__bento-pill notebook-tracker__bento-pill--subject';
    subjectPill.textContent = subject.title;
    pillRow.appendChild(subjectPill);
  }
  openButton.appendChild(pillRow);

  if (assignment.conceptIds && assignment.conceptIds.length > 0) {
    openButton.appendChild(buildConceptChips(classroom, assignment.conceptIds));
  }

  const description = document.createElement('span');
  description.className = 'notebook-tracker__bento-description';
  description.textContent = assignment.dueDate ? `Due ${formatDate(assignment.dueDate)}` : `Given ${formatDate(assignment.givenDate)}`;
  openButton.appendChild(description);

  card.appendChild(openButton);

  if (assignment.resourceUrl) {
    const link = document.createElement('a');
    link.className = 'assignment-form__resource-link';
    link.href = assignment.resourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open resource ↗';
    link.addEventListener('click', (event) => event.stopPropagation());
    card.appendChild(link);
  }

  const menuActions = [
    { label: 'Edit assignment', onClick: () => handlers.onStartEdit(assignment.id) },
    { label: 'Delete assignment', danger: true, onClick: () => handlers.onDelete(assignment.id, assignment.title) },
  ];
  const menuWrapper = document.createElement('div');
  menuWrapper.className = 'notebook-tracker__bento-card-menu';
  menuWrapper.appendChild(createOverflowMenu({ actions: menuActions, ariaLabel: `${assignment.title} actions` }));
  card.appendChild(menuWrapper);

  return card;
}

/** Honest delete-confirmation message naming the real checkpoint impact — mirrors ui/views/SettingsView.js's own buildDeleteImpactMessage() convention for Notebook Types. */
function buildDeleteImpactMessage(title, { checkpointCount, recordCount }) {
  if (checkpointCount === 0) return `Delete "${title}"? This cannot be undone.`;
  return `Delete "${title}"? This also removes ${checkpointCount} checkpoint${checkpointCount === 1 ? '' : 's'} (${recordCount} student record${recordCount === 1 ? '' : 's'}). This cannot be undone.`;
}

/**
 * THE ACTUAL FIX for Workstream 4B: previously showed EVERY concept
 * across EVERY subject/unit in the whole classroom, completely
 * unfiltered and never re-rendered on Subject/Unit selection — the
 * Subject `<select>` elsewhere in this form was never even read by
 * this function. Now scoped to exactly the one selected Unit, per
 * explicit requirement ("display only concepts associated with the
 * selected unit"), and re-invoked by renderAssignmentForm() below
 * whenever Subject or Unit changes — see that function's own
 * `refreshConceptSection()`.
 *
 * `unitId` — null means "no unit chosen yet" (whether because no
 * Subject is selected either, or a Subject is selected but its own
 * Unit hasn't been picked), rendered as a plain hint rather than an
 * empty checkbox list, since an empty list reads as "this
 * subject/unit genuinely has zero concepts," which is a different,
 * misleading claim.
 *
 * `preservedUnresolvableConceptIds` — existing concept ids on the
 * Assignment being edited that `learningRecordService.getAllConcepts()`
 * can no longer resolve at all (the concept itself, or its containing
 * Subject/Unit, was deleted since this Assignment was linked to it).
 * Per explicit instruction not to silently delete existing concept
 * links for a legacy Assignment, these are listed read-only (never as
 * an interactive checkbox — there is nothing current to toggle them
 * against) and are always included back into the saved conceptIds by
 * renderAssignmentForm()'s own save handler, regardless of which unit
 * is currently selected.
 */
function renderConceptLinkSection(classroom, unitId, selectedConceptIds, preservedUnresolvableConceptIds) {
  const section = document.createElement('div');
  section.className = 'assignment-form__concept-section';

  const label = document.createElement('p');
  label.className = 'notebook-checkpoints__cell-editor-section-label';
  label.textContent = 'Link concepts (optional)';
  section.appendChild(label);

  if (preservedUnresolvableConceptIds.size > 0) {
    const preservedNote = document.createElement('p');
    preservedNote.className = 'assignment-form__concept-empty';
    preservedNote.textContent = `${preservedUnresolvableConceptIds.size} previously linked concept${preservedUnresolvableConceptIds.size === 1 ? '' : 's'} no longer resolve to a current Subject/Unit and are kept linked, unchanged.`;
    section.appendChild(preservedNote);
  }

  const unit = unitId ? learningRecordService.getUnitById(classroom, unitId) : null;
  if (!unit) {
    const empty = document.createElement('p');
    empty.className = 'assignment-form__concept-empty';
    empty.textContent = 'Select a Subject and Unit above to link concepts.';
    section.appendChild(empty);
    return section;
  }

  if (unit.concepts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'assignment-form__concept-empty';
    empty.textContent = 'No concepts set up yet for this unit — add some from Learning Management first.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'assignment-form__concept-list';

  unit.concepts.forEach((concept) => {
    const option = document.createElement('label');
    option.className = 'assignment-form__concept-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedConceptIds.has(concept.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedConceptIds.add(concept.id);
      else selectedConceptIds.delete(concept.id);
    });
    option.appendChild(checkbox);

    const title = document.createElement('span');
    title.textContent = concept.title;
    option.appendChild(title);

    list.appendChild(option);
  });

  section.appendChild(list);
  return section;
}

/**
 * The Assignment creation/edit form — now its own top-level screen
 * element (not nested inside a category's grid), so it needs two new
 * fields the retired per-category form never did: which Type
 * (category) this Assignment belongs to, and optionally which Subject.
 * Both are plain native <select> dropdowns, matching this app's own
 * established "simple select for a single reference, not a custom
 * picker component" convention for exactly this shape of choice.
 */
/** Exported for tests/ui/assignmentFormCascade.test.js — mirrors ui/views/NotebookCheckpointsView.js's own getCellMeta() convention of exporting a specific piece for direct, real-browser testing rather than only reaching it through the full view. */
export function renderAssignmentForm(assignment, classroom, handlers) {
  const form = document.createElement('div');
  form.className = 'notebook-checkpoints__form';

  // Read-only — see models/Assignment.js's own `code` field comment.
  // Only shown once an Assignment actually has one (every Assignment
  // created before this field existed has `code: null` or no field at
  // all) — never a blank/placeholder code for those.
  if (assignment?.code) {
    const codeDisplay = document.createElement('p');
    codeDisplay.className = 'assignment-form__code-display';
    codeDisplay.textContent = assignment.code;
    form.appendChild(codeDisplay);
  }

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  // Per Workstream 4A: the auto-generated Code (above, once this
  // Assignment has been saved at least once) is now the worksheet's own
  // identifier — this field is its plain-language description, never a
  // teacher-typed code. Still the same underlying `title` field (see
  // assignmentService.js's own createNewAssignment()/updateAssignment())
  // -- only the label/placeholder changed, so every existing Assignment
  // and every other reader of `assignment.title` is unaffected.
  titleInput.placeholder = 'Description (e.g. Chemical Formula, Equation and Naming Compounds)';
  titleInput.value = assignment?.title || '';
  form.appendChild(titleInput);

  const descriptionInput = document.createElement('textarea');
  descriptionInput.placeholder = 'Additional notes (optional)';
  descriptionInput.value = assignment?.description || '';
  form.appendChild(descriptionInput);

  const categoryLabel = document.createElement('label');
  categoryLabel.textContent = 'Type';
  const categorySelect = document.createElement('select');
  assignmentConfigService.listCategories(classroom).forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    if ((assignment?.categoryId || '') === category.id) option.selected = true;
    categorySelect.appendChild(option);
  });
  categoryLabel.appendChild(categorySelect);
  form.appendChild(categoryLabel);

  const subjectLabel = document.createElement('label');
  subjectLabel.textContent = 'Subject (optional)';
  const subjectSelect = document.createElement('select');
  const noSubjectOption = document.createElement('option');
  noSubjectOption.value = '';
  noSubjectOption.textContent = 'No subject set';
  subjectSelect.appendChild(noSubjectOption);
  learningRecordService.getSubjects(classroom).forEach((subject) => {
    const option = document.createElement('option');
    option.value = subject.id;
    option.textContent = subject.title;
    if (assignment?.subjectId === subject.id) option.selected = true;
    subjectSelect.appendChild(option);
  });
  subjectLabel.appendChild(subjectSelect);
  form.appendChild(subjectLabel);

  // THE ACTUAL FIX for Workstream 4B: a new Unit selector, populated
  // from whichever Subject is currently selected (see
  // refreshUnitOptions() below) — previously no Unit selector existed
  // here at all, so Concept linking (renderConceptLinkSection) had no
  // way to scope itself to one Unit and showed every concept in the
  // whole classroom unfiltered.
  const unitLabel = document.createElement('label');
  unitLabel.textContent = 'Unit (optional)';
  const unitSelect = document.createElement('select');
  unitLabel.appendChild(unitSelect);
  form.appendChild(unitLabel);

  const conceptSectionSlot = document.createElement('div');

  // Existing concept ids that the LOADED subject/unit (or any current
  // subject/unit at all, for a brand-new Assignment) genuinely cannot
  // resolve — see renderConceptLinkSection()'s own
  // `preservedUnresolvableConceptIds` comment. Computed ONCE against
  // the full, unfiltered concept tree (never against just the
  // currently-selected unit), so a concept link is only ever treated as
  // "legacy/unresolvable" when the concept itself is genuinely gone,
  // not merely because a different unit happens to be selected right
  // now.
  const allResolvableConceptIds = new Set(learningRecordService.getAllConcepts(classroom).map(({ concept }) => concept.id));
  const preservedUnresolvableConceptIds = new Set((assignment?.conceptIds || []).filter((id) => !allResolvableConceptIds.has(id)));
  const selectedConceptIds = new Set((assignment?.conceptIds || []).filter((id) => allResolvableConceptIds.has(id)));

  function refreshConceptSection() {
    conceptSectionSlot.innerHTML = '';
    conceptSectionSlot.appendChild(
      renderConceptLinkSection(classroom, unitSelect.value || null, selectedConceptIds, preservedUnresolvableConceptIds)
    );
  }

  /**
   * Rebuilds the Unit <select>'s own options from `subjectId`'s own
   * `units[]` — called on initial render (preserving a valid existing
   * `assignment.unitId`) and again every time a teacher changes Subject
   * (where `preserveUnitId` is deliberately omitted, since the
   * previously-selected unit almost certainly doesn't belong to the
   * newly-chosen subject at all).
   */
  function refreshUnitOptions(subjectId, preserveUnitId = null) {
    unitSelect.innerHTML = '';
    const noUnitOption = document.createElement('option');
    noUnitOption.value = '';
    noUnitOption.textContent = 'No unit set';
    unitSelect.appendChild(noUnitOption);

    const subject = subjectId ? learningRecordService.getSubjectById(classroom, subjectId) : null;
    (subject?.units || []).forEach((unit) => {
      const option = document.createElement('option');
      option.value = unit.id;
      option.textContent = unit.number != null ? `Unit ${unit.number}: ${unit.title}` : unit.title;
      if (preserveUnitId === unit.id) option.selected = true;
      unitSelect.appendChild(option);
    });
  }

  refreshUnitOptions(assignment?.subjectId || null, assignment?.unitId || null);
  refreshConceptSection();

  // Changing Subject invalidates whatever Unit was selected (a Unit
  // belongs to exactly one Subject) — per explicit instruction to
  // "clear invalid selections when their parent selection changes."
  // Concept selections scoped to the now-cleared Unit are dropped from
  // `selectedConceptIds` too (refreshConceptSection() below re-renders
  // against the new, empty Unit selection, and its own checkboxes are
  // the only thing that ever re-adds to that Set) — genuinely
  // unresolvable legacy links in `preservedUnresolvableConceptIds` are
  // never touched by this, since they were never tied to any
  // currently-selectable unit in the first place.
  subjectSelect.addEventListener('change', () => {
    selectedConceptIds.clear();
    refreshUnitOptions(subjectSelect.value || null);
    refreshConceptSection();
  });

  unitSelect.addEventListener('change', () => {
    selectedConceptIds.clear();
    refreshConceptSection();
  });

  form.appendChild(conceptSectionSlot);

  const givenDateLabel = document.createElement('label');
  givenDateLabel.textContent = 'Date given';
  const givenDateInput = document.createElement('input');
  givenDateInput.type = 'date';
  givenDateInput.value = assignment?.givenDate || getTodayDateKey();
  givenDateLabel.appendChild(givenDateInput);
  form.appendChild(givenDateLabel);

  const dueDateLabel = document.createElement('label');
  dueDateLabel.textContent = 'Due date (optional)';
  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.value = assignment?.dueDate || '';
  dueDateLabel.appendChild(dueDateInput);
  form.appendChild(dueDateLabel);

  const resourceUrlLabel = document.createElement('label');
  resourceUrlLabel.textContent = 'Resource link (optional)';
  const resourceUrlInput = document.createElement('input');
  resourceUrlInput.type = 'url';
  resourceUrlInput.placeholder = 'https://… (worksheet, slides, video, reading, etc.)';
  resourceUrlInput.value = assignment?.resourceUrl || '';
  resourceUrlLabel.appendChild(resourceUrlInput);
  form.appendChild(resourceUrlLabel);

  const actions = document.createElement('div');
  actions.className = 'notebook-checkpoints__form-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title || !categorySelect.value) return;
    handlers.onSave({
      categoryId: categorySelect.value,
      // Only ever consulted by createNewAssignment() -> worksheetCodeService.js
      // as a fallback abbreviation source when no Subject is set (see
      // that service's own header comment) — updateAssignment() doesn't
      // destructure this key at all, so passing it on an edit save is
      // harmless, not a second source of truth for the category name.
      categoryName: assignmentConfigService.listCategories(classroom).find((c) => c.id === categorySelect.value)?.name || null,
      subjectId: subjectSelect.value || null,
      unitId: unitSelect.value || null,
      title,
      description: descriptionInput.value.trim(),
      givenDate: givenDateInput.value,
      dueDate: dueDateInput.value,
      resourceUrl: resourceUrlInput.value.trim(),
      // Union, never a plain list of what's currently checked — a
      // legacy, unresolvable concept link (see
      // preservedUnresolvableConceptIds above) is never shown as a
      // checkbox at all, so a plain "collect checked boxes" save would
      // silently drop it. Per explicit instruction not to silently
      // delete existing concept links, it is always carried through
      // here regardless of which Unit is currently selected.
      conceptIds: Array.from(new Set([...selectedConceptIds, ...preservedUnresolvableConceptIds])),
    });
  });
  actions.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelEdit);
  actions.appendChild(cancelButton);

  form.appendChild(actions);
  return form;
}

function createConfigurePanel(onOpenAssignmentConfiguration) {
  const panel = document.createElement('div');
  panel.className = 'notebook-tracker__configure-panel';

  panel.appendChild(createIcon('settings', { size: 24, className: 'notebook-tracker__configure-panel-icon' }));

  const heading = document.createElement('p');
  heading.className = 'notebook-tracker__configure-panel-heading';
  heading.textContent = 'Configure Assignment Types';
  panel.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'notebook-tracker__configure-panel-description';
  description.textContent = 'Add, edit or remove assignment types (e.g. Worksheet, Project) for your classrooms.';
  panel.appendChild(description);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--secondary notebook-tracker__configure-panel-button';
  button.textContent = 'Configure Now →';
  button.addEventListener('click', () => onOpenAssignmentConfiguration());
  panel.appendChild(button);

  return panel;
}
