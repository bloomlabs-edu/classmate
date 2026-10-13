/**
 * ui/views/AssignmentDetailView.js
 *
 * The Student x Checkpoint grid for ONE Assignment — the Assignment
 * Tracker redesign's own checkpoint tracker, a direct adaptation of
 * ui/views/NotebookCheckpointsView.js (see that file's own header
 * comment for the full render-architecture reasoning, not repeated
 * here): persistent slots, targeted cell updates, workspaceCoordinator
 * registration, sticky-table shell, all unchanged in shape. The one
 * structural difference is identity: a checkpoint here is scoped by
 * `assignmentId` (services/assignmentCheckpointService.js) instead of
 * `subjectId`+`notebookTypeId`.
 *
 * REPLACES ui/views/AssignmentCategoryView.js (retired — that file
 * showed a grid of ASSIGNMENTS-as-columns within one category; this
 * file shows a grid of CHECKPOINTS-as-columns within one assignment,
 * per the approved redesign). `getAssignmentCellMeta()` — the Overall
 * Rating status-chip language — moves here unchanged, since
 * ui/views/StudentProfileView.js imports it and Overall Rating itself
 * is still reachable from this screen (see renderOverallRatingEditor()
 * below), just relocated from "click a grid cell" to a compact
 * per-student action.
 *
 * TWO INDEPENDENT, COEXISTING TRACKING AXES on this one screen, per
 * explicit product instruction — never merged, never read from each
 * other:
 *   - Checkpoint completion (primary grid): services/assignmentCheckpointService.js
 *     against models/StudentCheckpointRecord.js — workflow (submitted?
 *     reviewed?).
 *   - Overall Rating (compact per-student action, far right of each
 *     row): services/assignmentService.js's setRating()/
 *     getRecordForStudent() against models/StudentAssignmentRecord.js —
 *     quality (Completion/Accuracy/Quality/... aspects, unchanged from
 *     the retired AssignmentCategoryView.js's own cell editor).
 * Neither reads nor writes the other's data. Neither ever touches
 * `student.learningRecord` (concept understanding) or Assessment marks.
 */

import * as assignmentCheckpointService from '../../services/assignmentCheckpointService.js';
import * as assignmentService from '../../services/assignmentService.js';
import * as assignmentConfigService from '../../services/assignmentConfigService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';
import { getClassroomStudents } from '../../services/assessmentService.js';
import { formatDate, getTodayDateKey } from '../../utils/dateHelpers.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';
import { createOverflowMenu } from '../components/OverflowMenu.js';

const RATING_OPTIONS = [
  ['not_yet', 'Not yet'],
  ['developing', 'Developing'],
  ['met', 'Met'],
];

/** Moved verbatim from the retired ui/views/AssignmentCategoryView.js — unchanged status-chip language for Overall Rating, still imported by ui/views/StudentProfileView.js. */
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

/** Checkpoint-cell status language — mirrors NotebookCheckpointsView.js's own getCellMeta() exactly (same four-state model: not submitted / submitted-not-reviewed / complete / incomplete, with lateness as a label detail only). */
function getCheckpointCellMeta(checkpoint, record) {
  if (!record || record.submissionStatus === 'not_submitted') {
    return { label: 'Not Submitted', chipClass: 'red', icon: 'x-circle' };
  }
  const late = assignmentCheckpointService.isLate(checkpoint, record);
  if (record.reviewStatus === 'complete') {
    return late
      ? { label: 'Submitted late · Complete', chipClass: 'green', icon: 'check-circle-2' }
      : { label: 'Submitted · Complete', chipClass: 'green', icon: 'check-circle-2' };
  }
  if (record.reviewStatus === 'incomplete') {
    return late
      ? { label: 'Submitted late · Incomplete', chipClass: 'orange', icon: 'alert-triangle' }
      : { label: 'Submitted · Incomplete', chipClass: 'orange', icon: 'alert-triangle' };
  }
  return late
    ? { label: 'Submitted late · Not Reviewed', chipClass: 'purple', icon: 'circle-dot' }
    : { label: 'Not Reviewed', chipClass: 'purple', icon: 'circle-dot' };
}

export function renderAssignmentDetailView(container, { classroom, assignmentId, onBack, onSelectStudent, onGoToClassMode }) {
  let currentClassroom = classroom;
  let editingCheckpointId = null; // null | 'new' | an existing checkpoint's own id
  let openCellFor = null; // null | { checkpointId, studentId } — checkpoint editor
  let openOverallRatingFor = null; // null | studentId — Overall Rating editor

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

  const metaLine = document.createElement('p');
  metaLine.className = 'notebook-checkpoints__assignment-meta-line';
  header.appendChild(metaLine);

  function getAssignment() {
    return assignmentService.getAssignmentById(currentClassroom, assignmentId);
  }

  function refreshTitle() {
    const assignment = getAssignment();
    titleEl.textContent = `${assignment?.title || '(Assignment removed)'} — Checkpoints`;
    if (!assignment) {
      metaLine.textContent = '';
      return;
    }
    const category = assignmentConfigService.getCategoryById(currentClassroom, assignment.categoryId);
    const subject = assignment.subjectId ? learningRecordService.getSubjects(currentClassroom).find((s) => s.id === assignment.subjectId) : null;
    const parts = [category?.name, subject?.title, assignment.dueDate ? `Due ${formatDate(assignment.dueDate)}` : `Given ${formatDate(assignment.givenDate)}`].filter(Boolean);
    metaLine.textContent = parts.join(' · ');
  }

  const content = document.createElement('div');
  content.className = 'notebook-checkpoints__content';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary notebook-checkpoints__add-button';
  addButton.textContent = '+ Add Checkpoint';
  addButton.addEventListener('click', () => {
    editingCheckpointId = 'new';
    refreshForm();
  });
  content.appendChild(addButton);

  const formSlot = document.createElement('div');
  content.appendChild(formSlot);

  const gridSlot = document.createElement('div');
  content.appendChild(gridSlot);

  const cellEditorSlot = document.createElement('div');
  content.appendChild(cellEditorSlot);

  const ratingEditorSlot = document.createElement('div');
  content.appendChild(ratingEditorSlot);

  wrapper.appendChild(content);
  container.appendChild(wrapper);

  function getSortedStudents() {
    return [...getClassroomStudents(currentClassroom)].sort((a, b) => a.name.localeCompare(b.name));
  }

  function persistClassroom() {
    workspaceService.save(currentClassroom);
  }

  const handlers = {
    onStartCreate: () => {
      editingCheckpointId = 'new';
      refreshForm();
    },
    onStartEdit: (checkpointId) => {
      editingCheckpointId = checkpointId;
      refreshForm();
    },
    onCancelEdit: () => {
      editingCheckpointId = null;
      refreshForm();
    },
    onSaveCheckpoint: (fields) => {
      if (editingCheckpointId === 'new') {
        assignmentCheckpointService.createNewCheckpoint(currentClassroom, { assignmentId, ...fields });
      } else {
        const checkpoint = assignmentCheckpointService.getCheckpointById(currentClassroom, editingCheckpointId);
        assignmentCheckpointService.updateCheckpoint(checkpoint, fields);
      }
      editingCheckpointId = null;
      refreshForm();
      persistClassroom();
      refreshGrid();
    },
    onDeleteCheckpoint: (checkpointId, title) => {
      const confirmed = window.confirm(`Delete "${title}"? This removes every student's own record for it too. This cannot be undone.`);
      if (!confirmed) return;
      assignmentCheckpointService.deleteCheckpoint(currentClassroom, checkpointId);
      persistClassroom();
      refreshGrid();
    },
    onMoveCheckpoint: (checkpointId, direction) => {
      const ordered = assignmentCheckpointService.listCheckpointsForAssignment(currentClassroom, assignmentId);
      const index = ordered.findIndex((c) => c.id === checkpointId);
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= ordered.length) return;
      const reordered = [...ordered];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      assignmentCheckpointService.reorderCheckpoints(currentClassroom, assignmentId, reordered.map((c) => c.id));
      persistClassroom();
      refreshGrid();
    },
    onOpenCell: (checkpointId, studentId) => {
      openCellFor = { checkpointId, studentId };
      refreshCellEditor();
    },
    onQuickMarkSubmitted: (checkpointId, studentId) => {
      const checkpoint = assignmentCheckpointService.getCheckpointById(currentClassroom, checkpointId);
      assignmentCheckpointService.setSubmission(checkpoint, studentId, { status: 'submitted', submittedDate: getTodayDateKey() });
      persistClassroom();
      updateCellAndColumn(checkpointId, studentId);
    },
    onQuickReview: (checkpointId, studentId, status) => {
      const checkpoint = assignmentCheckpointService.getCheckpointById(currentClassroom, checkpointId);
      assignmentCheckpointService.setReview(checkpoint, studentId, { status, reviewedDate: getTodayDateKey() });
      persistClassroom();
      updateCellAndColumn(checkpointId, studentId);
    },
    onCloseCell: () => {
      openCellFor = null;
      refreshCellEditor();
    },
    onSaveCell: (checkpointId, studentId, submission, review, teacherNote) => {
      const checkpoint = assignmentCheckpointService.getCheckpointById(currentClassroom, checkpointId);
      assignmentCheckpointService.setSubmission(checkpoint, studentId, submission);
      assignmentCheckpointService.setReview(checkpoint, studentId, review);
      assignmentCheckpointService.setTeacherNote(checkpoint, studentId, teacherNote);
      openCellFor = null;
      persistClassroom();
      refreshCellEditor();
      updateCellAndColumn(checkpointId, studentId);
    },
    onOpenOverallRating: (studentId) => {
      openOverallRatingFor = studentId;
      refreshOverallRatingEditor();
    },
    onCloseOverallRating: () => {
      openOverallRatingFor = null;
      refreshOverallRatingEditor();
    },
    onSaveOverallRating: (studentId, ratings, teacherNote) => {
      const assignment = getAssignment();
      if (!assignment) return;
      Object.entries(ratings).forEach(([aspectId, rating]) => {
        if (rating) assignmentService.setRating(assignment, studentId, aspectId, rating);
      });
      assignmentService.setTeacherNote(assignment, studentId, teacherNote);
      openOverallRatingFor = null;
      persistClassroom();
      refreshOverallRatingEditor();
      updateOverallRatingPill(studentId);
    },
    onSelectStudent,
  };

  function refreshForm() {
    formSlot.innerHTML = '';
    if (editingCheckpointId) {
      const checkpoint = editingCheckpointId === 'new' ? null : assignmentCheckpointService.getCheckpointById(currentClassroom, editingCheckpointId);
      formSlot.appendChild(renderCheckpointForm(checkpoint, handlers));
    }
  }

  function refreshCellEditor() {
    cellEditorSlot.innerHTML = '';
    if (openCellFor) {
      const checkpoint = assignmentCheckpointService.getCheckpointById(currentClassroom, openCellFor.checkpointId);
      const student = getSortedStudents().find((s) => s.id === openCellFor.studentId);
      if (checkpoint && student) {
        cellEditorSlot.appendChild(renderCheckpointCellEditor(checkpoint, student, handlers));
      }
    }
  }

  function refreshOverallRatingEditor() {
    ratingEditorSlot.innerHTML = '';
    if (openOverallRatingFor) {
      const assignment = getAssignment();
      const category = assignment ? assignmentConfigService.getCategoryById(currentClassroom, assignment.categoryId) : null;
      const student = getSortedStudents().find((s) => s.id === openOverallRatingFor);
      if (assignment && category && student) {
        ratingEditorSlot.appendChild(renderOverallRatingEditor(category, assignment, student, handlers));
      }
    }
  }

  function refreshGrid() {
    const previousScrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    const previousScrollTop = previousScrollEl?.scrollTop ?? 0;
    const previousScrollLeft = previousScrollEl?.scrollLeft ?? 0;

    gridSlot.innerHTML = '';

    const assignment = getAssignment();
    const checkpoints = assignment ? assignmentCheckpointService.listCheckpointsForAssignment(currentClassroom, assignmentId) : [];
    const students = getSortedStudents();

    if (students.length === 0) {
      gridSlot.appendChild(createEmptyStateElement({ message: 'No students on this roster yet.' }));
    } else if (!assignment) {
      gridSlot.appendChild(createEmptyStateElement({ message: 'This assignment has been removed.' }));
    } else if (checkpoints.length === 0) {
      gridSlot.appendChild(renderEmptyInstructionalCue());
      gridSlot.appendChild(renderEmptyCheckpointsGrid(students, currentClassroom, assignment, handlers));
    } else {
      gridSlot.appendChild(renderGrid(checkpoints, students, currentClassroom, assignment, handlers));
    }

    const scrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    if (scrollEl) {
      scrollEl.scrollTop = previousScrollTop;
      scrollEl.scrollLeft = previousScrollLeft;
    }
  }

  function updateCellAndColumn(checkpointId, studentId) {
    const scrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    const checkpoint = assignmentCheckpointService.getCheckpointById(currentClassroom, checkpointId);
    if (!scrollEl || !checkpoint) {
      refreshGrid();
      return;
    }

    const students = getSortedStudents();
    const student = students.find((s) => s.id === studentId);
    const cell = scrollEl.querySelector(`td[data-checkpoint-id="${checkpointId}"][data-student-id="${studentId}"]`);
    if (cell && student) {
      cell.innerHTML = '';
      populateCheckpointCell(cell, checkpoint, student, handlers);
    }

    const statsEl = scrollEl.querySelector(`th[data-checkpoint-id="${checkpointId}"] .notebook-checkpoints__column-stats`);
    if (statsEl) {
      statsEl.replaceWith(buildColumnStats(checkpoint, students));
    }
  }

  /** Targeted update for the one Overall Rating pill that just changed — never touches the checkpoint grid. */
  function updateOverallRatingPill(studentId) {
    const scrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    const assignment = getAssignment();
    const category = assignment ? assignmentConfigService.getCategoryById(currentClassroom, assignment.categoryId) : null;
    if (!scrollEl || !assignment || !category) {
      refreshGrid();
      return;
    }
    const pillWrapper = scrollEl.querySelector(`[data-overall-rating-student-id="${studentId}"]`);
    if (pillWrapper) {
      pillWrapper.replaceWith(buildOverallRatingPill(category, assignment, studentId, handlers));
    }
  }

  refreshTitle();
  refreshForm();
  refreshGrid();
  refreshCellEditor();
  refreshOverallRatingEditor();

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
  title.textContent = 'Start by adding your first checkpoint.';
  const subtitle = document.createElement('p');
  subtitle.className = 'notebook-checkpoints__empty-cue-subtitle';
  subtitle.textContent = 'Click the first column header to enter the checkpoint you want to track for this assignment.';
  text.append(title, subtitle);
  cue.append(icon, text);
  return cue;
}

function renderEmptyCheckpointsGrid(students, classroom, assignment, handlers) {
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
  placeholderLabel.textContent = 'Enter checkpoint name';
  placeholderButton.append(placeholderIcon, placeholderLabel);
  placeholderButton.addEventListener('click', handlers.onStartCreate);
  placeholderTh.appendChild(placeholderButton);
  headerRow.appendChild(placeholderTh);

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const category = assignmentConfigService.getCategoryById(classroom, assignment.categoryId);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    populateStudentNameCell(nameCell, student, category, assignment, handlers);
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

function buildColumnStats(checkpoint, students) {
  const summary = assignmentCheckpointService.getCheckpointSummary(checkpoint, students);

  const statsEl = document.createElement('div');
  statsEl.className = 'notebook-checkpoints__column-stats';

  const boxesRow = document.createElement('div');
  boxesRow.className = 'notebook-checkpoints__column-stat-boxes';
  boxesRow.appendChild(createColumnStatBox(summary.submittedCount, students.length, 'Submitted'));
  boxesRow.appendChild(createColumnStatBox(summary.completeCount, students.length, 'Complete'));
  statsEl.appendChild(boxesRow);

  const percentSubmitted = students.length > 0 ? Math.round((summary.submittedCount / students.length) * 100) : 0;
  const progress = document.createElement('div');
  progress.className = 'notebook-checkpoints__column-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuenow', String(percentSubmitted));
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-label', `${summary.submittedCount} of ${students.length} submitted`);
  const progressFill = document.createElement('div');
  progressFill.className = 'notebook-checkpoints__column-progress-fill';
  progressFill.style.width = `${percentSubmitted}%`;
  progress.appendChild(progressFill);
  statsEl.appendChild(progress);

  return statsEl;
}

function buildUnitCard(checkpoint, index, checkpoints, students, handlers) {
  const card = document.createElement('div');
  card.className = 'notebook-checkpoints__unit-card';

  const topRow = document.createElement('div');
  topRow.className = 'notebook-checkpoints__unit-card-top';

  const code = document.createElement('span');
  code.className = 'notebook-checkpoints__unit-code';
  code.textContent = `C${String(index + 1).padStart(2, '0')}`;
  topRow.appendChild(code);

  const menuActions = [{ label: 'Edit checkpoint', onClick: () => handlers.onStartEdit(checkpoint.id) }];
  if (index > 0) {
    menuActions.push({ label: 'Move left', onClick: () => handlers.onMoveCheckpoint(checkpoint.id, -1) });
  }
  if (index < checkpoints.length - 1) {
    menuActions.push({ label: 'Move right', onClick: () => handlers.onMoveCheckpoint(checkpoint.id, 1) });
  }
  menuActions.push({
    label: 'Delete checkpoint',
    danger: true,
    onClick: () => handlers.onDeleteCheckpoint(checkpoint.id, checkpoint.title),
  });
  topRow.appendChild(createOverflowMenu({ actions: menuActions, ariaLabel: `${checkpoint.title} actions` }));
  card.appendChild(topRow);

  const titleEl = document.createElement('span');
  titleEl.className = 'notebook-checkpoints__column-title notebook-checkpoints__unit-title';
  titleEl.textContent = checkpoint.title;
  card.appendChild(titleEl);

  const metaLine = document.createElement('span');
  metaLine.className = 'notebook-checkpoints__column-meta';
  metaLine.textContent = checkpoint.dueDate ? `Due ${formatDate(checkpoint.dueDate)}` : `Given ${formatDate(checkpoint.givenDate)}`;
  card.appendChild(metaLine);

  card.appendChild(buildColumnStats(checkpoint, students));

  return card;
}

/** Student name cell, PLUS this screen's own Overall Rating pill — the compact, per-student entry point to the aspect-rating editor, kept clearly visually separate from the checkpoint columns to its right. */
function populateStudentNameCell(nameCell, student, category, assignment, handlers) {
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

  if (category && assignment) {
    nameCell.appendChild(buildOverallRatingPill(category, assignment, student.id, handlers));
  }
}

/**
 * The compact Overall Rating entry point — a small pill showing the
 * aspect-rating status at a glance (reusing getAssignmentCellMeta()'s
 * own four-state chip language, unchanged from the retired grid-cell
 * version), that opens the full rating editor on click. Deliberately
 * NOT another checkpoint-shaped column — per explicit product
 * direction, Overall Rating must stay a compact action, never compete
 * visually with the checkpoint grid.
 */
function buildOverallRatingPill(category, assignment, studentId, handlers) {
  const wrapper = document.createElement('span');
  wrapper.dataset.overallRatingStudentId = studentId;

  const record = assignmentService.getRecordForStudent(assignment, studentId);
  const status = assignmentService.getAssignmentCellStatus(category, record);
  const meta = getAssignmentCellMeta(status);

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = `notebook-checkpoints__overall-rating-pill notebook-checkpoints__overall-rating-pill--${meta.chipClass}`;
  pill.setAttribute('aria-label', `Overall Rating for ${assignment.title}: ${meta.label}. Open rating editor.`);
  pill.title = 'Overall Rating';
  const icon = createIcon(meta.icon === 'x-circle' ? 'x' : meta.icon === 'check-circle-2' ? 'check' : meta.icon, { size: 12 });
  const label = document.createElement('span');
  label.textContent = `Overall: ${meta.label}`;
  pill.append(icon, label);
  pill.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onOpenOverallRating(studentId);
  });

  wrapper.appendChild(pill);
  return wrapper;
}

function populateCheckpointCell(cell, checkpoint, student, handlers) {
  const record = assignmentCheckpointService.getRecordForStudent(checkpoint, student.id);
  const meta = getCheckpointCellMeta(checkpoint, record);
  const isNotSubmitted = !record || record.submissionStatus === 'not_submitted';
  const isAwaitingReview = record && record.submissionStatus === 'submitted' && record.reviewStatus === 'not_reviewed';
  const isCompleteOnTime = record && record.reviewStatus === 'complete' && !assignmentCheckpointService.isLate(checkpoint, record);

  cell.className = 'notebook-checkpoints__cell';
  if (isNotSubmitted) cell.classList.add('notebook-checkpoints__cell--tint-red');
  if (isCompleteOnTime) cell.classList.add('notebook-checkpoints__cell--tint-green');

  const content = document.createElement('div');
  content.className = 'notebook-checkpoints__cell-content';

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'notebook-checkpoints__cell-row';
  row.setAttribute('aria-label', `${student.name} — ${checkpoint.title}: ${meta.label}`);
  row.addEventListener('click', () => handlers.onOpenCell(checkpoint.id, student.id));

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

  const actionZone = document.createElement('div');
  actionZone.className = 'notebook-checkpoints__cell-action-zone';

  if (isNotSubmitted) {
    const quickMarkButton = document.createElement('button');
    quickMarkButton.type = 'button';
    quickMarkButton.className = 'notebook-checkpoints__cell-quick-mark';
    quickMarkButton.appendChild(createIcon('check', { size: 12 }));
    quickMarkButton.append('Mark Submitted');
    quickMarkButton.setAttribute('aria-label', `${student.name} — ${checkpoint.title}: mark submitted`);
    quickMarkButton.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onQuickMarkSubmitted(checkpoint.id, student.id);
    });
    actionZone.appendChild(quickMarkButton);
  }

  if (isAwaitingReview) {
    const quickActions = document.createElement('div');
    quickActions.className = 'notebook-checkpoints__cell-quick-review';

    const quickCompleteButton = document.createElement('button');
    quickCompleteButton.type = 'button';
    quickCompleteButton.className = 'notebook-checkpoints__cell-quick-review-button notebook-checkpoints__cell-quick-review-button--complete';
    quickCompleteButton.appendChild(createIcon('check', { size: 12 }));
    quickCompleteButton.append('Complete');
    quickCompleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onQuickReview(checkpoint.id, student.id, 'complete');
    });

    const quickIncompleteButton = document.createElement('button');
    quickIncompleteButton.type = 'button';
    quickIncompleteButton.className = 'notebook-checkpoints__cell-quick-review-button notebook-checkpoints__cell-quick-review-button--incomplete';
    quickIncompleteButton.appendChild(createIcon('alert-triangle', { size: 12 }));
    quickIncompleteButton.append('Incomplete');
    quickIncompleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onQuickReview(checkpoint.id, student.id, 'incomplete');
    });

    quickActions.append(quickCompleteButton, quickIncompleteButton);
    actionZone.appendChild(quickActions);
  }

  content.appendChild(actionZone);
  cell.appendChild(content);
}

function renderGrid(checkpoints, students, classroom, assignment, handlers) {
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

  checkpoints.forEach((checkpoint, index) => {
    const th = document.createElement('th');
    th.className = 'notebook-checkpoints__column-header';
    th.dataset.checkpointId = checkpoint.id;
    th.appendChild(buildUnitCard(checkpoint, index, checkpoints, students, handlers));
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const category = assignmentConfigService.getCategoryById(classroom, assignment.categoryId);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    populateStudentNameCell(nameCell, student, category, assignment, handlers);
    row.appendChild(nameCell);

    checkpoints.forEach((checkpoint) => {
      const cell = document.createElement('td');
      cell.dataset.checkpointId = checkpoint.id;
      cell.dataset.studentId = student.id;
      populateCheckpointCell(cell, checkpoint, student, handlers);
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  scroll.appendChild(table);
  return scroll;
}

function renderCheckpointForm(checkpoint, handlers) {
  const form = document.createElement('div');
  form.className = 'notebook-checkpoints__form';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Title (e.g. Draft, Final Submission)';
  titleInput.value = checkpoint?.title || '';
  form.appendChild(titleInput);

  const descriptionInput = document.createElement('textarea');
  descriptionInput.placeholder = 'Description (optional)';
  descriptionInput.value = checkpoint?.description || '';
  form.appendChild(descriptionInput);

  const givenDateLabel = document.createElement('label');
  givenDateLabel.textContent = 'Date given';
  const givenDateInput = document.createElement('input');
  givenDateInput.type = 'date';
  givenDateInput.value = checkpoint?.givenDate || getTodayDateKey();
  givenDateLabel.appendChild(givenDateInput);
  form.appendChild(givenDateLabel);

  const dueDateLabel = document.createElement('label');
  dueDateLabel.textContent = 'Due date (optional)';
  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.value = checkpoint?.dueDate || '';
  dueDateLabel.appendChild(dueDateInput);
  form.appendChild(dueDateLabel);

  const actions = document.createElement('div');
  actions.className = 'notebook-checkpoints__form-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) return;
    handlers.onSaveCheckpoint({
      title,
      description: descriptionInput.value.trim(),
      givenDate: givenDateInput.value,
      dueDate: dueDateInput.value,
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

function renderCheckpointCellEditor(checkpoint, student, handlers) {
  const record = assignmentCheckpointService.getRecordForStudent(checkpoint, student.id);

  const overlay = document.createElement('div');
  overlay.className = 'notebook-checkpoints__cell-editor-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'notebook-checkpoints__cell-editor';

  const heading = document.createElement('p');
  heading.className = 'notebook-checkpoints__cell-editor-heading';
  heading.textContent = checkpoint.title;
  const subheading = document.createElement('p');
  subheading.className = 'notebook-checkpoints__cell-editor-subheading';
  subheading.textContent = `Student: ${student.name}`;
  sheet.append(heading, subheading);

  const submissionLabel = document.createElement('p');
  submissionLabel.className = 'notebook-checkpoints__cell-editor-section-label';
  submissionLabel.textContent = 'Submission';
  sheet.appendChild(submissionLabel);

  const submissionSelect = document.createElement('select');
  [['not_submitted', 'Not submitted'], ['submitted', 'Submitted']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if ((record?.submissionStatus || 'not_submitted') === value) option.selected = true;
    submissionSelect.appendChild(option);
  });
  sheet.appendChild(submissionSelect);

  const submittedDateInput = document.createElement('input');
  submittedDateInput.type = 'date';
  submittedDateInput.value = record?.submittedDate || getTodayDateKey();
  sheet.appendChild(submittedDateInput);

  const lateNotice = document.createElement('p');
  lateNotice.className = 'notebook-checkpoints__cell-editor-late-notice';
  sheet.appendChild(lateNotice);

  function refreshLateNotice() {
    const wouldBeLate = checkpoint.dueDate && submissionSelect.value === 'submitted' && submittedDateInput.value > checkpoint.dueDate;
    lateNotice.textContent = wouldBeLate ? `⚠️ Submitted late (due ${formatDate(checkpoint.dueDate)})` : '';
  }
  refreshLateNotice();
  submittedDateInput.addEventListener('input', refreshLateNotice);
  submissionSelect.addEventListener('change', refreshLateNotice);

  const reviewLabel = document.createElement('p');
  reviewLabel.className = 'notebook-checkpoints__cell-editor-section-label';
  reviewLabel.textContent = 'Review';
  sheet.appendChild(reviewLabel);

  const reviewSelect = document.createElement('select');
  [['not_reviewed', 'Not reviewed'], ['complete', 'Complete'], ['incomplete', 'Incomplete']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if ((record?.reviewStatus || 'not_reviewed') === value) option.selected = true;
    reviewSelect.appendChild(option);
  });
  sheet.appendChild(reviewSelect);

  const reviewedDateInput = document.createElement('input');
  reviewedDateInput.type = 'date';
  reviewedDateInput.value = record?.reviewedDate || getTodayDateKey();
  sheet.appendChild(reviewedDateInput);

  function refreshReviewEnablement() {
    const canReview = submissionSelect.value === 'submitted';
    reviewSelect.disabled = !canReview;
    reviewedDateInput.disabled = !canReview;
    if (!canReview) reviewSelect.value = 'not_reviewed';
  }
  refreshReviewEnablement();
  submissionSelect.addEventListener('change', refreshReviewEnablement);

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
    handlers.onSaveCell(
      checkpoint.id,
      student.id,
      { status: submissionSelect.value, submittedDate: submissionSelect.value === 'submitted' ? submittedDateInput.value : null },
      { status: reviewSelect.value, reviewedDate: reviewSelect.value === 'not_reviewed' ? null : reviewedDateInput.value },
      noteInput.value.trim()
    );
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

/**
 * The Overall Rating editor — moved verbatim (functionally) from the
 * retired ui/views/AssignmentCategoryView.js's own renderCellEditor():
 * one rating control per the category's own CURRENT aspects, plus a
 * teacher note. Never touches `classroom.assignmentCheckpoints` at all.
 */
function renderOverallRatingEditor(category, assignment, student, handlers) {
  const record = assignmentService.getRecordForStudent(assignment, student.id);
  const aspects = assignmentConfigService.listAspects(category);

  const overlay = document.createElement('div');
  overlay.className = 'notebook-checkpoints__cell-editor-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'notebook-checkpoints__cell-editor';

  const heading = document.createElement('p');
  heading.className = 'notebook-checkpoints__cell-editor-heading';
  heading.textContent = `${assignment.title} — Overall Rating`;
  const subheading = document.createElement('p');
  subheading.className = 'notebook-checkpoints__cell-editor-subheading';
  subheading.textContent = `Student: ${student.name}`;
  sheet.append(heading, subheading);

  const pendingRatings = {};

  if (aspects.length === 0) {
    const noAspects = document.createElement('p');
    noAspects.className = 'notebook-checkpoints__cell-editor-late-notice';
    noAspects.textContent = 'This assignment type has no tracked aspects yet — add some from Settings > Assignment Categories.';
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
    handlers.onSaveOverallRating(student.id, pendingRatings, noteInput.value.trim());
  });
  actions.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCloseOverallRating);
  actions.appendChild(cancelButton);

  sheet.appendChild(actions);
  overlay.appendChild(sheet);
  return overlay;
}
