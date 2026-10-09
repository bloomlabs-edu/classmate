/**
 * ui/views/AssignmentCategoryView.js
 *
 * The Student x Assignment grid for one Assignment Category — directly
 * mirrors ui/views/NotebookCheckpointsView.js's own render architecture
 * (persistent slots, targeted cell updates, workspaceCoordinator
 * registration, sticky-table shell) and reuses its exact CSS classes
 * (.notebook-checkpoints__*, .assessment-gradebook) rather than a
 * parallel set — per explicit instruction to reuse the Notebook
 * architecture wherever appropriate. See that file's own header
 * comment for the full reasoning behind this render shape; it is not
 * repeated here.
 *
 * The one real difference: Checkpoint's hardcoded submission/review
 * dichotomy is replaced by this category's own open, teacher-defined
 * Aspect list (see services/assignmentService.js's own
 * getAssignmentCellStatus()). There is no scoreboard-point integration
 * and no "quick mark" one-tap gesture here — Checkpoint's quick actions
 * exist because its model has exactly one universal binary gesture
 * ("mark submitted"); an open aspect list has no equivalent single
 * gesture, so every cell opens the one full rating editor.
 */

import * as assignmentService from '../../services/assignmentService.js';
import * as assignmentConfigService from '../../services/assignmentConfigService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import { getClassroomStudents } from '../../services/assessmentService.js';
import { formatDate, getTodayDateKey } from '../../utils/dateHelpers.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';
import { createOverflowMenu } from '../components/OverflowMenu.js';

/** The generalized counterpart to NotebookCheckpointsView.js's own getCellMeta() — same four-chip visual language, driven by assignmentService.getAssignmentCellStatus() instead of a hardcoded submission/review pair. Exported for the same reason getCellMeta() is (a future student-facing view rendering the identical status language). */
export function getAssignmentCellMeta(status) {
  switch (status) {
    case 'complete':
      return { label: 'Complete', chipClass: 'green', icon: 'check-circle-2' };
    case 'needs_attention':
      return { label: 'Needs Attention', chipClass: 'orange', icon: 'alert-triangle' };
    case 'in_progress':
      return { label: 'In Progress', chipClass: 'purple', icon: 'circle-dot' };
    default:
      return { label: 'Not Started', chipClass: 'red', icon: 'x-circle' };
  }
}

const RATING_OPTIONS = [
  ['not_yet', 'Not yet'],
  ['developing', 'Developing'],
  ['met', 'Met'],
];

export function renderAssignmentCategoryView(container, { classroom, categoryId, onBack, onSelectStudent, onGoToClassMode }) {
  let currentClassroom = classroom;
  let editingAssignmentId = null; // null | 'new' | an existing assignment's own id
  let openCellFor = null; // null | { assignmentId, studentId }

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'notebook-checkpoints';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(
    createBackButton(() => {
      workspaceCoordinator.unregisterActiveWorkspace(currentClassroom.id);
      onBack();
    })
  );
  const titleEl = document.createElement('h1');
  titleEl.className = 'tracker-header__title';
  header.appendChild(titleEl);
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

  function refreshTitle() {
    const category = assignmentConfigService.getCategoryById(currentClassroom, categoryId);
    titleEl.textContent = `${category?.name || '(Category removed)'} — Assignments`;
  }

  const content = document.createElement('div');
  content.className = 'notebook-checkpoints__content';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary notebook-checkpoints__add-button';
  addButton.textContent = '+ Add Assignment';
  addButton.addEventListener('click', () => {
    editingAssignmentId = 'new';
    refreshForm();
  });
  content.appendChild(addButton);

  const formSlot = document.createElement('div');
  content.appendChild(formSlot);

  const gridSlot = document.createElement('div');
  content.appendChild(gridSlot);

  const cellEditorSlot = document.createElement('div');
  content.appendChild(cellEditorSlot);

  wrapper.appendChild(content);
  container.appendChild(wrapper);

  function getSortedStudents() {
    return [...getClassroomStudents(currentClassroom)].sort((a, b) => a.name.localeCompare(b.name));
  }

  function getCategory() {
    return assignmentConfigService.getCategoryById(currentClassroom, categoryId);
  }

  function persistClassroom() {
    workspaceService.save(currentClassroom);
  }

  const handlers = {
    onStartCreate: () => {
      editingAssignmentId = 'new';
      refreshForm();
    },
    onStartEdit: (assignmentId) => {
      editingAssignmentId = assignmentId;
      refreshForm();
    },
    onCancelEdit: () => {
      editingAssignmentId = null;
      refreshForm();
    },
    onSaveAssignment: (fields) => {
      if (editingAssignmentId === 'new') {
        assignmentService.createNewAssignment(currentClassroom, { categoryId, ...fields });
      } else {
        const assignment = assignmentService.getAssignmentById(currentClassroom, editingAssignmentId);
        assignmentService.updateAssignment(assignment, fields);
      }
      editingAssignmentId = null;
      refreshForm();
      persistClassroom();
      refreshGrid();
    },
    onDeleteAssignment: (assignmentId, title) => {
      const confirmed = window.confirm(`Delete "${title}"? This removes every student's own record for it too. This cannot be undone.`);
      if (!confirmed) return;
      assignmentService.deleteAssignment(currentClassroom, assignmentId);
      persistClassroom();
      refreshGrid();
    },
    onMoveAssignment: (assignmentId, direction) => {
      const ordered = assignmentService.listAssignmentsForCategory(currentClassroom, categoryId);
      const index = ordered.findIndex((a) => a.id === assignmentId);
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= ordered.length) return;
      const reordered = [...ordered];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      assignmentService.reorderAssignments(currentClassroom, categoryId, reordered.map((a) => a.id));
      persistClassroom();
      refreshGrid();
    },
    onOpenCell: (assignmentId, studentId) => {
      openCellFor = { assignmentId, studentId };
      refreshCellEditor();
    },
    onCloseCell: () => {
      openCellFor = null;
      refreshCellEditor();
    },
    onSaveCell: (assignmentId, studentId, ratings, teacherNote) => {
      const assignment = assignmentService.getAssignmentById(currentClassroom, assignmentId);
      const student = getSortedStudents().find((s) => s.id === studentId);
      if (!assignment || !student) return;
      Object.entries(ratings).forEach(([aspectId, rating]) => {
        if (rating) assignmentService.setRating(assignment, studentId, aspectId, rating);
      });
      assignmentService.setTeacherNote(assignment, studentId, teacherNote);
      openCellFor = null;
      persistClassroom();
      refreshCellEditor();
      updateCellAndColumn(assignmentId, studentId);
    },
    onSelectStudent,
  };

  function refreshForm() {
    formSlot.innerHTML = '';
    if (editingAssignmentId) {
      const assignment = editingAssignmentId === 'new' ? null : assignmentService.getAssignmentById(currentClassroom, editingAssignmentId);
      formSlot.appendChild(renderAssignmentForm(assignment, currentClassroom, handlers));
    }
  }

  function refreshCellEditor() {
    cellEditorSlot.innerHTML = '';
    if (openCellFor) {
      const assignment = assignmentService.getAssignmentById(currentClassroom, openCellFor.assignmentId);
      const student = getSortedStudents().find((s) => s.id === openCellFor.studentId);
      const category = getCategory();
      if (assignment && student && category) {
        cellEditorSlot.appendChild(renderCellEditor(category, assignment, student, handlers));
      }
    }
  }

  function refreshGrid() {
    const previousScrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    const previousScrollTop = previousScrollEl?.scrollTop ?? 0;
    const previousScrollLeft = previousScrollEl?.scrollLeft ?? 0;

    gridSlot.innerHTML = '';

    const category = getCategory();
    const assignments = category ? assignmentService.listAssignmentsForCategory(currentClassroom, categoryId) : [];
    const students = getSortedStudents();

    if (students.length === 0) {
      gridSlot.appendChild(createEmptyStateElement({ message: 'No students on this roster yet.' }));
    } else if (!category) {
      gridSlot.appendChild(createEmptyStateElement({ message: 'This category has been removed.' }));
    } else if (assignments.length === 0) {
      gridSlot.appendChild(renderEmptyInstructionalCue());
      gridSlot.appendChild(renderEmptyAssignmentsGrid(students, handlers));
    } else {
      gridSlot.appendChild(renderGrid(category, assignments, students, currentClassroom, handlers));
    }

    const scrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    if (scrollEl) {
      scrollEl.scrollTop = previousScrollTop;
      scrollEl.scrollLeft = previousScrollLeft;
    }
  }

  function updateCellAndColumn(assignmentId, studentId) {
    const scrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    const assignment = assignmentService.getAssignmentById(currentClassroom, assignmentId);
    const category = getCategory();
    if (!scrollEl || !assignment || !category) {
      refreshGrid();
      return;
    }

    const students = getSortedStudents();
    const student = students.find((s) => s.id === studentId);
    const cell = scrollEl.querySelector(`td[data-assignment-id="${assignmentId}"][data-student-id="${studentId}"]`);
    if (cell && student) {
      cell.innerHTML = '';
      populateAssignmentCell(cell, category, assignment, student, handlers);
    }

    const statsEl = scrollEl.querySelector(`th[data-assignment-id="${assignmentId}"] .notebook-checkpoints__column-stats`);
    if (statsEl) {
      statsEl.replaceWith(buildColumnStats(category, assignment, students));
    }
  }

  refreshTitle();
  refreshForm();
  refreshGrid();
  refreshCellEditor();

  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, (freshClassroom) => {
    currentClassroom = freshClassroom;
    refreshTitle();
    refreshGrid();
  });
}

function renderEmptyInstructionalCue() {
  const cue = document.createElement('div');
  cue.className = 'notebook-checkpoints__empty-cue';
  const icon = document.createElement('span');
  icon.className = 'notebook-checkpoints__empty-cue-icon';
  icon.textContent = '💡';
  const text = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'notebook-checkpoints__empty-cue-title';
  title.textContent = 'Start by adding your first assignment.';
  const subtitle = document.createElement('p');
  subtitle.className = 'notebook-checkpoints__empty-cue-subtitle';
  subtitle.textContent = 'Click the first column header to enter the assignment you want to track.';
  text.append(title, subtitle);
  cue.append(icon, text);
  return cue;
}

function renderEmptyAssignmentsGrid(students, handlers) {
  const scroll = document.createElement('div');
  scroll.className = 'assessment-gradebook__scroll';

  const table = document.createElement('table');
  table.className = 'assessment-gradebook notebook-checkpoints__table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const nameTh = document.createElement('th');
  nameTh.className = 'assessment-gradebook__name-header';
  nameTh.textContent = 'Students';
  headerRow.appendChild(nameTh);

  const placeholderTh = document.createElement('th');
  placeholderTh.className = 'notebook-checkpoints__column-header';
  const placeholderButton = document.createElement('button');
  placeholderButton.type = 'button';
  placeholderButton.className = 'notebook-checkpoints__empty-column-button';
  const placeholderIcon = document.createElement('span');
  placeholderIcon.textContent = '✎';
  const placeholderLabel = document.createElement('span');
  placeholderLabel.textContent = 'Enter assignment name';
  placeholderButton.append(placeholderIcon, placeholderLabel);
  placeholderButton.addEventListener('click', handlers.onStartCreate);
  placeholderTh.appendChild(placeholderButton);
  headerRow.appendChild(placeholderTh);

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    populateStudentNameCell(nameCell, student, handlers);
    row.appendChild(nameCell);

    const placeholderCell = document.createElement('td');
    placeholderCell.className = 'notebook-checkpoints__cell notebook-checkpoints__cell--gray';
    placeholderCell.textContent = '—';
    row.appendChild(placeholderCell);

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  scroll.appendChild(table);
  return scroll;
}

function createColumnStatBox(count, total, label) {
  const box = document.createElement('div');
  box.className = 'notebook-checkpoints__column-stat-box';
  const number = document.createElement('span');
  number.className = 'notebook-checkpoints__column-stat-number';
  number.textContent = `${count}/${total}`;
  const labelEl = document.createElement('span');
  labelEl.className = 'notebook-checkpoints__column-stat-label';
  labelEl.textContent = label;
  box.append(number, labelEl);
  return box;
}

function buildColumnStats(category, assignment, students) {
  const summary = assignmentService.getAssignmentSummary(category, assignment, students);

  const statsEl = document.createElement('div');
  statsEl.className = 'notebook-checkpoints__column-stats';

  const boxesRow = document.createElement('div');
  boxesRow.className = 'notebook-checkpoints__column-stat-boxes';
  boxesRow.appendChild(createColumnStatBox(summary.completeCount, students.length, 'Complete'));
  boxesRow.appendChild(createColumnStatBox(summary.needsAttentionCount, students.length, 'Needs Attention'));
  statsEl.appendChild(boxesRow);

  const startedCount = students.length - (summary.notStartedCount ?? students.length);
  const percentStarted = students.length > 0 ? Math.round((startedCount / students.length) * 100) : 0;
  const progress = document.createElement('div');
  progress.className = 'notebook-checkpoints__column-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuenow', String(percentStarted));
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-label', `${startedCount} of ${students.length} started`);
  const progressFill = document.createElement('div');
  progressFill.className = 'notebook-checkpoints__column-progress-fill';
  progressFill.style.width = `${percentStarted}%`;
  progress.appendChild(progressFill);
  statsEl.appendChild(progress);

  return statsEl;
}

/** Linked-concept chips, shown on the Assignment's own card — the "Assignment -> linked concepts" forward direction, resolved live (never copied) via learningRecordService.getConceptById(). A concept id that no longer resolves (the concept was deleted) is silently skipped, same "broken link is skipped, never a crash" convention services/resourceService.js's own getMostRecentlyEditedResource() already uses for Concept -> Resource links. */
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

function buildUnitCard(assignment, index, assignments, students, category, classroom, handlers) {
  const card = document.createElement('div');
  card.className = 'notebook-checkpoints__unit-card';

  const topRow = document.createElement('div');
  topRow.className = 'notebook-checkpoints__unit-card-top';

  const code = document.createElement('span');
  code.className = 'notebook-checkpoints__unit-code';
  code.textContent = `A${String(index + 1).padStart(2, '0')}`;
  topRow.appendChild(code);

  const menuActions = [{ label: 'Edit assignment', onClick: () => handlers.onStartEdit(assignment.id) }];
  if (index > 0) {
    menuActions.push({ label: 'Move left', onClick: () => handlers.onMoveAssignment(assignment.id, -1) });
  }
  if (index < assignments.length - 1) {
    menuActions.push({ label: 'Move right', onClick: () => handlers.onMoveAssignment(assignment.id, 1) });
  }
  menuActions.push({
    label: 'Delete assignment',
    danger: true,
    onClick: () => handlers.onDeleteAssignment(assignment.id, assignment.title),
  });
  topRow.appendChild(createOverflowMenu({ actions: menuActions, ariaLabel: `${assignment.title} actions` }));
  card.appendChild(topRow);

  const titleEl = document.createElement('span');
  titleEl.className = 'notebook-checkpoints__column-title notebook-checkpoints__unit-title';
  titleEl.textContent = assignment.title;
  card.appendChild(titleEl);

  const metaLine = document.createElement('span');
  metaLine.className = 'notebook-checkpoints__column-meta';
  metaLine.textContent = assignment.dueDate ? `Due ${formatDate(assignment.dueDate)}` : `Given ${formatDate(assignment.givenDate)}`;
  card.appendChild(metaLine);

  if (assignment.conceptIds && assignment.conceptIds.length > 0) {
    card.appendChild(buildConceptChips(classroom, assignment.conceptIds));
  }

  if (assignment.resourceUrl) {
    const link = document.createElement('a');
    link.className = 'assignment-form__resource-link';
    link.href = assignment.resourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open resource ↗';
    // Card buttons normally toggle the overflow menu / editor on click —
    // without this, clicking the link would also trigger whatever
    // click handler the card's own ancestor button carries.
    link.addEventListener('click', (event) => event.stopPropagation());
    card.appendChild(link);
  }

  card.appendChild(buildColumnStats(category, assignment, students));

  return card;
}

function populateStudentNameCell(nameCell, student, handlers) {
  nameCell.innerHTML = '';

  const wrapper = document.createElement('span');
  wrapper.className = 'notebook-checkpoints__student';

  const avatar = document.createElement('span');
  avatar.className = 'notebook-checkpoints__student-avatar';
  avatar.textContent = (student.name || '?').charAt(0).toUpperCase();
  avatar.setAttribute('aria-hidden', 'true');

  const nameButton = document.createElement('button');
  nameButton.type = 'button';
  nameButton.className = 'notebook-checkpoints__student-name';
  nameButton.textContent = student.name;
  nameButton.setAttribute('aria-label', `View ${student.name}'s profile`);
  nameButton.addEventListener('click', () => handlers.onSelectStudent(student.id));

  wrapper.append(avatar, nameButton);
  nameCell.appendChild(wrapper);
}

function populateAssignmentCell(cell, category, assignment, student, handlers) {
  const record = assignmentService.getRecordForStudent(assignment, student.id);
  const status = assignmentService.getAssignmentCellStatus(category, record);
  const meta = getAssignmentCellMeta(status);

  cell.className = 'notebook-checkpoints__cell';
  if (status === 'not_started') cell.classList.add('notebook-checkpoints__cell--tint-red');
  if (status === 'complete') cell.classList.add('notebook-checkpoints__cell--tint-green');

  const content = document.createElement('div');
  content.className = 'notebook-checkpoints__cell-content';

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'notebook-checkpoints__cell-row';
  row.setAttribute('aria-label', `${student.name} — ${assignment.title}: ${meta.label}`);
  row.addEventListener('click', () => handlers.onOpenCell(assignment.id, student.id));

  const badgeIconName = meta.icon === 'x-circle' ? 'x' : meta.icon === 'check-circle-2' ? 'check' : meta.icon;

  const statusIcon = document.createElement('span');
  statusIcon.className = `notebook-checkpoints__status-icon notebook-checkpoints__status-icon--${meta.chipClass}`;
  statusIcon.appendChild(createIcon(badgeIconName, { size: 16, strokeWidth: 2.5 }));
  row.appendChild(statusIcon);

  const labelEl = document.createElement('span');
  labelEl.className = 'notebook-checkpoints__cell-label';
  labelEl.textContent = meta.label;
  row.appendChild(labelEl);

  content.appendChild(row);
  cell.appendChild(content);
}

function renderGrid(category, assignments, students, classroom, handlers) {
  const scroll = document.createElement('div');
  scroll.className = 'assessment-gradebook__scroll';

  const table = document.createElement('table');
  table.className = 'assessment-gradebook notebook-checkpoints__table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const nameTh = document.createElement('th');
  nameTh.className = 'assessment-gradebook__name-header';
  nameTh.textContent = 'Student';
  headerRow.appendChild(nameTh);

  assignments.forEach((assignment, index) => {
    const th = document.createElement('th');
    th.className = 'notebook-checkpoints__column-header';
    th.dataset.assignmentId = assignment.id;
    th.appendChild(buildUnitCard(assignment, index, assignments, students, category, classroom, handlers));
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    populateStudentNameCell(nameCell, student, handlers);
    row.appendChild(nameCell);

    assignments.forEach((assignment) => {
      const cell = document.createElement('td');
      cell.dataset.assignmentId = assignment.id;
      cell.dataset.studentId = student.id;
      populateAssignmentCell(cell, category, assignment, student, handlers);
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  scroll.appendChild(table);
  return scroll;
}

/**
 * "Link concepts" — the Interconnectivity Gate's Assignment<->Concept
 * requirement. A plain, grouped checklist over
 * learningRecordService.getAllConcepts() (the same classroom-local
 * Subject->Unit->Concept tree Lesson/LessonPlan/ChapterPlan/Spark
 * already link against via their own `conceptIds`) — deliberately NOT
 * the heavier "+ Choose Concepts" explorer panel
 * ui/views/LessonPlanBuilderView.js uses, since that's built for
 * picking concepts while authoring a full lesson; a worksheet-tracking
 * form needs a proportionate, compact affordance, not a second copy of
 * that explorer. Selection state lives only in `selectedConceptIds`
 * (a plain Set the caller owns) until Save is pressed, same "commit on
 * Save, not per-click" convention every other field in this form
 * already uses.
 */
function renderConceptLinkSection(classroom, selectedConceptIds) {
  const section = document.createElement('div');
  section.className = 'assignment-form__concept-section';

  const label = document.createElement('p');
  label.className = 'notebook-checkpoints__cell-editor-section-label';
  label.textContent = 'Link concepts (optional)';
  section.appendChild(label);

  const allConcepts = learningRecordService.getAllConcepts(classroom);
  if (allConcepts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'assignment-form__concept-empty';
    empty.textContent = 'No concepts set up yet — add some from Learning Management first.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'assignment-form__concept-list';

  const bySubject = new Map();
  allConcepts.forEach(({ subject, unit, concept }) => {
    if (!bySubject.has(subject.id)) bySubject.set(subject.id, { subject, byUnit: new Map() });
    const subjectGroup = bySubject.get(subject.id);
    if (!subjectGroup.byUnit.has(unit.id)) subjectGroup.byUnit.set(unit.id, { unit, concepts: [] });
    subjectGroup.byUnit.get(unit.id).concepts.push(concept);
  });

  bySubject.forEach(({ subject, byUnit }) => {
    const subjectHeading = document.createElement('p');
    subjectHeading.className = 'assignment-form__concept-subject-heading';
    subjectHeading.textContent = subject.name;
    list.appendChild(subjectHeading);

    byUnit.forEach(({ unit, concepts }) => {
      const unitHeading = document.createElement('p');
      unitHeading.className = 'assignment-form__concept-unit-heading';
      unitHeading.textContent = unit.title;
      list.appendChild(unitHeading);

      concepts.forEach((concept) => {
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
    });
  });

  section.appendChild(list);
  return section;
}

function renderAssignmentForm(assignment, classroom, handlers) {
  const form = document.createElement('div');
  form.className = 'notebook-checkpoints__form';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Title (e.g. Water Cycle Worksheet)';
  titleInput.value = assignment?.title || '';
  form.appendChild(titleInput);

  const descriptionInput = document.createElement('textarea');
  descriptionInput.placeholder = 'Description (optional)';
  descriptionInput.value = assignment?.description || '';
  form.appendChild(descriptionInput);

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

  const selectedConceptIds = new Set(assignment?.conceptIds || []);
  form.appendChild(renderConceptLinkSection(classroom, selectedConceptIds));

  const actions = document.createElement('div');
  actions.className = 'notebook-checkpoints__form-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) return;
    handlers.onSaveAssignment({
      title,
      description: descriptionInput.value.trim(),
      givenDate: givenDateInput.value,
      dueDate: dueDateInput.value,
      resourceUrl: resourceUrlInput.value.trim(),
      conceptIds: Array.from(selectedConceptIds),
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

/**
 * The cell editor — one rating control per the category's own CURRENT
 * aspects (never a fixed field list), plus a teacher note. Each
 * aspect's rating is a plain 3-button group (Not yet / Developing /
 * Met) — the one shared scale every aspect reuses (see
 * models/StudentAssignmentRecord.js's own header comment for why nothing
 * here hardcodes which aspects exist).
 */
function renderCellEditor(category, assignment, student, handlers) {
  const record = assignmentService.getRecordForStudent(assignment, student.id);
  const aspects = assignmentConfigService.listAspects(category);

  const overlay = document.createElement('div');
  overlay.className = 'notebook-checkpoints__cell-editor-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'notebook-checkpoints__cell-editor';

  const heading = document.createElement('p');
  heading.className = 'notebook-checkpoints__cell-editor-heading';
  heading.textContent = assignment.title;
  const subheading = document.createElement('p');
  subheading.className = 'notebook-checkpoints__cell-editor-subheading';
  subheading.textContent = `Student: ${student.name}`;
  sheet.append(heading, subheading);

  const pendingRatings = {};

  if (aspects.length === 0) {
    const noAspects = document.createElement('p');
    noAspects.className = 'notebook-checkpoints__cell-editor-late-notice';
    noAspects.textContent = 'This category has no tracked aspects yet — add some from Settings > Assignment Categories.';
    sheet.appendChild(noAspects);
  }

  aspects.forEach((aspect) => {
    const aspectLabel = document.createElement('p');
    aspectLabel.className = 'notebook-checkpoints__cell-editor-section-label';
    aspectLabel.textContent = aspect.name;
    sheet.appendChild(aspectLabel);

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'assignment-cell-editor__rating-group';

    const currentRating = record?.ratings?.[aspect.id] || null;
    RATING_OPTIONS.forEach(([value, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'assignment-cell-editor__rating-button';
      if ((pendingRatings[aspect.id] ?? currentRating) === value) {
        button.classList.add('assignment-cell-editor__rating-button--selected');
      }
      button.textContent = label;
      button.addEventListener('click', () => {
        pendingRatings[aspect.id] = value;
        buttonGroup.querySelectorAll('.assignment-cell-editor__rating-button').forEach((btn) => {
          btn.classList.remove('assignment-cell-editor__rating-button--selected');
        });
        button.classList.add('assignment-cell-editor__rating-button--selected');
      });
      buttonGroup.appendChild(button);
    });

    sheet.appendChild(buttonGroup);
  });

  const noteLabel = document.createElement('p');
  noteLabel.className = 'notebook-checkpoints__cell-editor-section-label';
  noteLabel.textContent = 'Teacher note';
  sheet.appendChild(noteLabel);
  const noteInput = document.createElement('textarea');
  noteInput.value = record?.teacherNote || '';
  sheet.appendChild(noteInput);

  const actions = document.createElement('div');
  actions.className = 'notebook-checkpoints__cell-editor-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    handlers.onSaveCell(assignment.id, student.id, pendingRatings, noteInput.value.trim());
  });
  actions.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCloseCell);
  actions.appendChild(cancelButton);

  sheet.appendChild(actions);
  overlay.appendChild(sheet);
  return overlay;
}
