/**
 * ui/views/SeatingView.js
 *
 * Seating — REBUILT around a simple, explicit rectangular grid + drag-
 * and-drop model, per explicit product decision. The old sparse
 * coordinate model (seat/space cells, active-cell "+" controls,
 * perimeter expansion, swap-with-space, manually-constructed layouts,
 * whole-room rotation via doors/windows) is DELETED entirely, not
 * layered under this.
 *
 * CANONICAL SHAPE:
 *   classroom.seatingConfig = {
 *     rows, columns,
 *     orientation: 'top' | 'right' | 'bottom' | 'left',
 *     assignments: { 'row,col': studentId }
 *   }
 *
 * A grid cell is simply occupied-by-a-student or empty — there is no
 * seat-vs-space concept at all in this model, per explicit decision.
 *
 * THREE POSSIBLE STATES, checked in this order:
 *   1. No seatingConfig at all -> first-time setup screen.
 *   2. A LEGACY seatingConfig (has a `cells` array, the old sparse
 *      model) -> a transition screen, explicitly never auto-rendered
 *      as though it were the new grid, and never auto-converted or
 *      touched in Firestore until the teacher explicitly clicks
 *      "Start New Seating Layout". Before that click, the legacy data
 *      remains completely untouched.
 *   3. A real, new-shape seatingConfig (has rows/columns/assignments)
 *      -> the actual grid + roster editor.
 *
 * Room elements (doors/windows) are explicitly out of scope for this
 * rebuild per product decision — deliberately not touched here at all.
 *
 * Drag-and-drop is the primary rearrangement mechanism: dragging a
 * roster card onto an empty cell assigns it; dragging a placed
 * student onto an empty cell moves them; dragging onto an occupied
 * cell swaps the two students. There is no separate "move mode" or
 * "swap" mode at all.
 *
 * Directional movement (the contextual panel's own Left/Right/Front/
 * Back) is orientation-relative — reuses the exact same clockwise
 * rotation convention as the prior round's whole-room rotation
 * (top=0°, right=90°, bottom=180°, left=270°) so "Front" always means
 * "toward the board" regardless of which wall it's on.
 */

import { createBackButton } from '../components/BackButton.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';

const ROW_OPTIONS = [2, 3, 4, 5, 6, 7, 8];
const COLUMN_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const ORIENTATION_OPTIONS = [
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
];
const ORIENTATION_DEGREES = { top: 0, right: 90, bottom: 180, left: 270 };

export function renderSeatingView(container, { classroom, onBack, onSelectStudent }) {
  console.log('CLASSMATE SEATING GRID REBUILD — RUNTIME VERSION 1');
  let currentClassroom = classroom;
  // The one occupied cell currently showing its own contextual panel
  // (Move/Front/Back/Left/Right/View Profile/Remove), or null. A
  // genuinely different concern from the old "activeCellId" — there
  // is no "+"/building mode at all in this model.
  let activeAssignmentKey = null;
  // Whether the "Edit Grid" form is currently open, replacing the
  // grid view temporarily. Never auto-saves — only an explicit
  // "Save Changes" (or blocked with a warning) commits anything.
  let editGridOpen = false;

  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, resyncFromServer);

  function resyncFromServer(freshClassroom) {
    currentClassroom = freshClassroom;
    rerender();
  }

  function rerender() {
    render(container, currentClassroom, activeAssignmentKey, editGridOpen, {
      onBack: () => {
        workspaceCoordinator.unregisterActiveWorkspace(currentClassroom.id);
        onBack();
      },
      onSelectStudent: (studentId) => onSelectStudent(studentId),
      onCreateLayout: (rows, columns, orientation) => {
        currentClassroom.seatingConfig = createGridConfig(rows, columns, orientation);
        workspaceService.save(currentClassroom);
        rerender();
      },
      onToggleAssignmentPanel: (key) => {
        activeAssignmentKey = activeAssignmentKey === key ? null : key;
        rerender();
      },
      onAssignStudent: (row, column, studentId) => {
        assignStudentAt(currentClassroom.seatingConfig, row, column, studentId);
        workspaceService.save(currentClassroom);
        rerender();
      },
      onMoveOrSwap: (fromRow, fromColumn, toRow, toColumn) => {
        moveOrSwapAssignment(currentClassroom.seatingConfig, fromRow, fromColumn, toRow, toColumn);
        activeAssignmentKey = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onRemoveStudent: (row, column) => {
        removeAssignmentAt(currentClassroom.seatingConfig, row, column);
        activeAssignmentKey = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onOpenEditGrid: () => {
        editGridOpen = true;
        rerender();
      },
      onCancelEditGrid: () => {
        editGridOpen = false;
        rerender();
      },
      onSaveEditGrid: (rows, columns, orientation) => {
        const config = currentClassroom.seatingConfig;
        const displacedCount = countAssignmentsOutsideGrid(config, rows, columns);
        if (displacedCount > 0) {
          return { blocked: true, displacedCount };
        }
        config.rows = rows;
        config.columns = columns;
        config.orientation = orientation;
        editGridOpen = false;
        workspaceService.save(currentClassroom);
        rerender();
        return { blocked: false };
      },
    });
  }

  rerender();
}

/**
 * A LEGACY config is the old sparse-cell model — never rendered as
 * the new grid, never auto-converted. Detected purely by shape: it
 * has a real `cells` array, which the new shape never has at all.
 */
function isLegacyConfig(seatingConfig) {
  return !!seatingConfig && Array.isArray(seatingConfig.cells);
}

/** A real, new-shape config — has been explicitly created via the setup screen's own "Create Layout"/"Start New Seating Layout" action. */
function isGridConfig(seatingConfig) {
  return !!seatingConfig && typeof seatingConfig.rows === 'number' && typeof seatingConfig.columns === 'number' && !!seatingConfig.assignments;
}

function createGridConfig(rows, columns, orientation) {
  return { rows, columns, orientation, assignments: {} };
}

function assignmentKey(row, column) {
  return `${row},${column}`;
}

function getStudentIdAt(seatingConfig, row, column) {
  return seatingConfig.assignments[assignmentKey(row, column)] ?? null;
}

function findAssignmentKeyForStudent(seatingConfig, studentId) {
  return Object.keys(seatingConfig.assignments).find((key) => seatingConfig.assignments[key] === studentId) ?? null;
}

/** Assigns a student directly into a cell — used only for a genuinely empty target (dropping a roster card). Never overwrites another student; the caller (drop handler) is responsible for routing an occupied target to moveOrSwapAssignment() instead. */
function assignStudentAt(seatingConfig, row, column, studentId) {
  // If this student was already seated elsewhere, that old position is genuinely vacated first — a student can only ever occupy one cell at a time.
  const previousKey = findAssignmentKeyForStudent(seatingConfig, studentId);
  if (previousKey) delete seatingConfig.assignments[previousKey];
  seatingConfig.assignments[assignmentKey(row, column)] = studentId;
}

/**
 * THE core rearrangement operation — moving a placed student from one
 * cell to another. If the destination is genuinely empty, this is a
 * plain move. If the destination already holds a different student,
 * the two students SWITCH positions — never losing either one, never
 * creating a duplicate assignment, never an intermediate empty state
 * (both positions are updated together, atomically, in this one
 * function call).
 */
function moveOrSwapAssignment(seatingConfig, fromRow, fromColumn, toRow, toColumn) {
  const fromKey = assignmentKey(fromRow, fromColumn);
  const toKey = assignmentKey(toRow, toColumn);
  if (fromKey === toKey) return; // dropped back onto its own cell — genuinely a no-op
  const movingStudentId = seatingConfig.assignments[fromKey];
  if (!movingStudentId) return; // nothing to move at all
  const displacedStudentId = seatingConfig.assignments[toKey] ?? null;

  if (displacedStudentId) {
    seatingConfig.assignments[fromKey] = displacedStudentId; // swap
  } else {
    delete seatingConfig.assignments[fromKey]; // plain move — the old cell becomes genuinely empty
  }
  seatingConfig.assignments[toKey] = movingStudentId;
}

function removeAssignmentAt(seatingConfig, row, column) {
  delete seatingConfig.assignments[assignmentKey(row, column)];
}

/** How many current assignments would genuinely fall outside a candidate new grid size — used by Edit Grid to block a destructive shrink before it ever happens, never silently. */
function countAssignmentsOutsideGrid(seatingConfig, newRows, newColumns) {
  return Object.keys(seatingConfig.assignments).filter((key) => {
    const [row, column] = key.split(',').map(Number);
    return row >= newRows || column >= newColumns;
  }).length;
}

/**
 * Rotates a direction's own (dRow, dColumn) offset by the given
 * orientation — reuses the exact same clockwise rotation convention
 * established for whole-room rotation in a prior round (top=0°,
 * right=90°, bottom=180°, left=270°), so "Front" always genuinely
 * means "toward the board", regardless of which wall it's on.
 */
function rotateDirectionOffset(dRow, dColumn, orientationDegrees) {
  // Treat (dColumn, dRow) as an (x, y) pair for the same rotatePoint-
  // style clockwise transform: 90° maps (x,y) -> (-y,x), etc.
  const x = dColumn;
  const y = dRow;
  let rx;
  let ry;
  switch (orientationDegrees) {
    case 90: rx = -y; ry = x; break;
    case 180: rx = -x; ry = -y; break;
    case 270: rx = y; ry = -x; break;
    default: rx = x; ry = y; break;
  }
  return { dRow: ry, dColumn: rx };
}

/** The four directions' own real, orientation-relative (dRow, dColumn) offsets — "Front" is always toward the board, "Back" always away from it, regardless of orientation. */
function getDirectionOffsets(orientation) {
  const degrees = ORIENTATION_DEGREES[orientation] ?? 0;
  return {
    front: rotateDirectionOffset(-1, 0, degrees),
    back: rotateDirectionOffset(1, 0, degrees),
    left: rotateDirectionOffset(0, -1, degrees),
    right: rotateDirectionOffset(0, 1, degrees),
  };
}

function render(container, classroom, activeAssignmentKey, editGridOpen, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'seating-view';

  const header = document.createElement('div');
  header.className = 'learning-management__header';
  header.appendChild(createBackButton(handlers.onBack));
  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = 'Seating';
  header.append(title);
  wrapper.appendChild(header);

  const seatingConfig = classroom.seatingConfig;

  if (isGridConfig(seatingConfig) && !editGridOpen) {
    wrapper.appendChild(renderGridEditor(classroom, activeAssignmentKey, handlers));
  } else if (isGridConfig(seatingConfig) && editGridOpen) {
    wrapper.appendChild(renderEditGridForm(seatingConfig, handlers));
  } else if (isLegacyConfig(seatingConfig)) {
    // THE ACTUAL FIX (this round's own rebuild): a legacy sparse-cell
    // config is NEVER rendered as though it were the new grid, and
    // NEVER auto-converted or touched in Firestore at all. The
    // teacher must explicitly choose to move on — until they do, the
    // old data remains completely untouched.
    wrapper.appendChild(renderSetupScreen(handlers, true));
  } else {
    wrapper.appendChild(renderSetupScreen(handlers, false));
  }

  container.appendChild(wrapper);
}

/**
 * The first-time setup screen (isLegacyTransition = false) or the
 * legacy-transition screen (true) — same underlying rows/columns/
 * orientation form either way, per explicit product decision, but
 * different copy and button label so the teacher clearly understands
 * a legacy layout exists and is being deliberately replaced, not
 * silently discarded. Nothing is saved to Firestore until the button
 * is explicitly clicked.
 */
function renderSetupScreen(handlers, isLegacyTransition) {
  const section = document.createElement('div');
  section.className = 'seating-view__setup';

  const heading = document.createElement('h2');
  heading.className = 'seating-view__setup-heading';
  heading.textContent = isLegacyTransition ? 'Set Up Seating' : 'Seating Setup';
  section.appendChild(heading);

  if (isLegacyTransition) {
    const notice = document.createElement('p');
    notice.className = 'seating-view__setup-notice';
    notice.textContent = 'Your classroom is using an older seating layout. Create a new classroom seating grid to continue — the old layout will not be shown, and nothing is changed until you start the new layout below.';
    section.appendChild(notice);
  }

  const label = document.createElement('p');
  label.className = 'seating-view__setup-label';
  label.textContent = 'Choose classroom grid';
  section.appendChild(label);

  section.appendChild(renderGridForm(
    { rows: 4, columns: 5, orientation: 'top' },
    isLegacyTransition ? 'Start New Seating Layout' : 'Create Layout',
    (rows, columns, orientation) => handlers.onCreateLayout(rows, columns, orientation),
    null, // no cancel option at initial setup — there is nothing yet to cancel back to
  ));

  return section;
}

/** Edit Grid — the exact same form, pre-filled with the current values, with a real Cancel option and a save handler that can genuinely refuse to apply (see the displaced-students warning in renderGridEditor's own handler wiring). */
function renderEditGridForm(seatingConfig, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__setup';

  const heading = document.createElement('h2');
  heading.className = 'seating-view__setup-heading';
  heading.textContent = 'Edit Grid';
  section.appendChild(heading);

  section.appendChild(renderGridForm(
    seatingConfig,
    'Save Changes',
    (rows, columns, orientation) => {
      const result = handlers.onSaveEditGrid(rows, columns, orientation);
      return result;
    },
    handlers.onCancelEditGrid,
  ));

  return section;
}

/**
 * The shared rows/columns/orientation form — used identically by
 * first-time setup, the legacy-transition screen, and Edit Grid.
 * `onSubmit` may return { blocked: true, displacedCount } to show a
 * real warning and refuse to proceed (Edit Grid's own shrink-safety
 * check) rather than ever silently deleting a student's placement.
 */
function renderGridForm(initialValues, submitLabel, onSubmit, onCancel) {
  const form = document.createElement('div');
  form.className = 'seating-view__setup-form';

  const rowsLabel = document.createElement('label');
  rowsLabel.className = 'seating-view__setup-field-label';
  rowsLabel.textContent = 'Rows';
  const rowsSelect = document.createElement('select');
  rowsSelect.className = 'seating-view__setup-select';
  ROW_OPTIONS.forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    if (value === initialValues.rows) option.selected = true;
    rowsSelect.appendChild(option);
  });
  rowsLabel.appendChild(rowsSelect);
  form.appendChild(rowsLabel);

  const columnsLabel = document.createElement('label');
  columnsLabel.className = 'seating-view__setup-field-label';
  columnsLabel.textContent = 'Columns';
  const columnsSelect = document.createElement('select');
  columnsSelect.className = 'seating-view__setup-select';
  COLUMN_OPTIONS.forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    if (value === initialValues.columns) option.selected = true;
    columnsSelect.appendChild(option);
  });
  columnsLabel.appendChild(columnsSelect);
  form.appendChild(columnsLabel);

  const orientationFieldset = document.createElement('div');
  orientationFieldset.className = 'seating-view__setup-orientation';
  const orientationLegend = document.createElement('p');
  orientationLegend.className = 'seating-view__setup-field-label';
  orientationLegend.textContent = 'Board orientation';
  orientationFieldset.appendChild(orientationLegend);

  let selectedOrientation = initialValues.orientation ?? 'top';
  const orientationButtons = [];
  ORIENTATION_OPTIONS.forEach(({ value, label }) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'btn btn--ghost seating-view__orientation-option';
    if (value === selectedOrientation) optionButton.classList.add('seating-view__orientation-option--selected');
    optionButton.textContent = label;
    optionButton.addEventListener('click', () => {
      selectedOrientation = value;
      orientationButtons.forEach((btn) => btn.classList.toggle('seating-view__orientation-option--selected', btn.dataset.value === value));
    });
    optionButton.dataset.value = value;
    orientationButtons.push(optionButton);
    orientationFieldset.appendChild(optionButton);
  });
  form.appendChild(orientationFieldset);

  const warningNote = document.createElement('p');
  warningNote.className = 'seating-view__setup-warning';
  warningNote.hidden = true;
  form.appendChild(warningNote);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'seating-view__setup-actions';

  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary';
  submitButton.textContent = submitLabel;
  submitButton.addEventListener('click', () => {
    const rows = Number(rowsSelect.value);
    const columns = Number(columnsSelect.value);
    const result = onSubmit(rows, columns, selectedOrientation);
    if (result && result.blocked) {
      warningNote.hidden = false;
      warningNote.textContent = `${result.displacedCount} student${result.displacedCount === 1 ? ' is' : 's are'} currently outside the new grid. Move ${result.displacedCount === 1 ? 'them' : 'them'} before reducing the grid.`;
    }
  });
  actionsRow.appendChild(submitButton);

  if (onCancel) {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', onCancel);
    actionsRow.appendChild(cancelButton);
  }

  form.appendChild(actionsRow);

  return form;
}

/** The actual grid + roster editor — the primary working view once a real grid config exists. Grid receives the majority of the available space; the roster is a genuinely narrower, secondary panel, matching the corrected hierarchy from prior rounds. */
function renderGridEditor(classroom, activeAssignmentKey, handlers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'seating-view__editor';

  const editGridButton = document.createElement('button');
  editGridButton.type = 'button';
  editGridButton.className = 'btn btn--ghost seating-view__edit-grid-button';
  editGridButton.textContent = 'Edit Grid';
  editGridButton.addEventListener('click', handlers.onOpenEditGrid);
  wrapper.appendChild(editGridButton);

  const layout = document.createElement('div');
  layout.className = 'seating-view__layout';

  const seatingConfig = classroom.seatingConfig;
  const allStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));
  const unseatedStudents = allStudents.filter(({ student }) => !findAssignmentKeyForStudent(seatingConfig, student.id));

  layout.appendChild(renderRoom(classroom, activeAssignmentKey, allStudents, handlers));
  layout.appendChild(renderRoster(unseatedStudents, handlers));

  wrapper.appendChild(layout);
  return wrapper;
}

/** The room itself — Board (positioned per orientation) + the actual square grid. */
function renderRoom(classroom, activeAssignmentKey, allStudents, handlers) {
  const room = document.createElement('div');
  room.className = 'seating-view__room';

  const seatingConfig = classroom.seatingConfig;
  const { rows, columns, orientation } = seatingConfig;

  const board = document.createElement('div');
  board.className = `seating-view__board seating-view__board--${orientation}`;
  board.textContent = 'BOARD';

  const gridWrapper = document.createElement('div');
  gridWrapper.className = 'seating-view__grid-wrapper';

  const grid = document.createElement('div');
  grid.className = 'seating-view__grid';
  grid.style.gridTemplateColumns = `repeat(${columns}, var(--seat-size))`;
  grid.style.gridTemplateRows = `repeat(${rows}, var(--seat-size))`;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const studentId = getStudentIdAt(seatingConfig, row, column);
      const occupant = studentId ? allStudents.find(({ student }) => student.id === studentId) : null;
      grid.appendChild(renderGridCell(row, column, occupant, seatingConfig, activeAssignmentKey, handlers));
    }
  }

  gridWrapper.appendChild(grid);

  if (orientation === 'top') {
    room.append(board, gridWrapper);
  } else if (orientation === 'bottom') {
    room.append(gridWrapper, board);
  } else if (orientation === 'left') {
    const row = document.createElement('div');
    row.className = 'seating-view__room-row';
    row.append(board, gridWrapper);
    room.appendChild(row);
  } else {
    const row = document.createElement('div');
    row.className = 'seating-view__room-row';
    row.append(gridWrapper, board);
    room.appendChild(row);
  }

  return room;
}

/**
 * A single grid cell — always a genuine, real drop target (whether
 * occupied or empty). If occupied, the student card inside is itself
 * draggable (dragging it out is a move/swap) and clickable (opening
 * the contextual panel below). Dropping any drag onto this cell
 * routes to the correct operation: an unassigned roster student onto
 * an empty cell assigns it; a placed student onto an empty cell moves
 * them; a placed student onto an occupied cell swaps the two. An
 * unassigned roster student dropped onto an already-occupied cell is
 * a deliberate no-op — dropping a NEW student there has no obvious
 * "other student" to reconcile with, so nothing happens rather than
 * guessing at an unrequested side effect.
 */
function renderGridCell(row, column, occupant, seatingConfig, activeAssignmentKey, handlers) {
  const cellWrapper = document.createElement('div');
  cellWrapper.className = 'seating-view__cell-wrapper';

  const cell = document.createElement('div');
  cell.className = 'seating-view__cell';
  cell.classList.add(occupant ? 'seating-view__cell--occupied' : 'seating-view__cell--empty');

  cell.addEventListener('dragover', (event) => {
    event.preventDefault(); // required for drop to fire at all
  });
  cell.addEventListener('drop', (event) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/plain');
    if (!raw) return;
    const dragged = JSON.parse(raw);
    if (dragged.type === 'roster') {
      if (occupant) return; // deliberate no-op — see this function's own doc comment
      handlers.onAssignStudent(row, column, dragged.studentId);
    } else if (dragged.type === 'grid') {
      handlers.onMoveOrSwap(dragged.fromRow, dragged.fromColumn, row, column);
    }
  });

  if (occupant) {
    if (occupant.team?.color) {
      const groupHex = getGroupColorHex(occupant.team.color);
      cell.style.borderColor = groupHex;
      cell.style.setProperty('--seating-cell-group-accent', groupHex);
      cell.classList.add('seating-view__cell--has-group-accent');
    }

    cell.draggable = true;
    cell.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'grid', studentId: occupant.student.id, fromRow: row, fromColumn: column }));
    });
    cell.addEventListener('click', () => handlers.onToggleAssignmentPanel(assignmentKey(row, column)));
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        cell.click();
      }
    });

    const nameWrapper = document.createElement('span');
    nameWrapper.className = 'seating-view__cell-name-wrapper';
    nameWrapper.appendChild(createStudentNameElement({ student: occupant.student, leadingMarker: 'swatch' }));
    cell.appendChild(nameWrapper);
  } else {
    const label = document.createElement('span');
    label.className = 'seating-view__cell-label';
    label.textContent = 'Empty';
    cell.appendChild(label);
  }

  cellWrapper.appendChild(cell);

  if (occupant && assignmentKey(row, column) === activeAssignmentKey) {
    cellWrapper.appendChild(renderAssignmentPanel(row, column, occupant, seatingConfig, handlers));
  }

  return cellWrapper;
}


/**
 * The contextual panel for a placed student — genuinely opened by
 * clicking the student card, never by clicking their name specifically
 * (there is no separate name-click behavior at all in this rebuild).
 * "View Student Profile" is the one, explicit way to navigate away —
 * clicking the card itself only ever opens this panel.
 */
function renderAssignmentPanel(row, column, occupant, seatingConfig, handlers) {
  const panel = document.createElement('div');
  panel.className = 'seating-view__cell-panel';

  const heading = document.createElement('p');
  heading.className = 'seating-view__cell-panel-heading';
  heading.textContent = occupant.student.name;
  panel.appendChild(heading);

  const profileLink = document.createElement('button');
  profileLink.type = 'button';
  profileLink.className = 'btn btn--text seating-view__profile-link';
  profileLink.textContent = 'View Student Profile';
  profileLink.addEventListener('click', () => handlers.onSelectStudent(occupant.student.id));
  panel.appendChild(profileLink);

  const moveLabel = document.createElement('p');
  moveLabel.className = 'seating-view__cell-group-label';
  moveLabel.textContent = 'Move';
  panel.appendChild(moveLabel);

  const moveRow = document.createElement('div');
  moveRow.className = 'seating-view__move-controls';
  const offsets = getDirectionOffsets(seatingConfig.orientation);
  [
    { direction: 'front', symbol: '\u2191', label: 'Front' },
    { direction: 'back', symbol: '\u2193', label: 'Back' },
    { direction: 'left', symbol: '\u2190', label: 'Left' },
    { direction: 'right', symbol: '\u2192', label: 'Right' },
  ].forEach(({ direction, symbol, label }) => {
    const { dRow, dColumn } = offsets[direction];
    const targetRow = row + dRow;
    const targetColumn = column + dColumn;
    const isInsideGrid = targetRow >= 0 && targetRow < seatingConfig.rows && targetColumn >= 0 && targetColumn < seatingConfig.columns;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--ghost seating-view__move-button seating-view__move-button--${direction}`;
    button.disabled = !isInsideGrid;

    const symbolSpan = document.createElement('span');
    symbolSpan.setAttribute('aria-hidden', 'true');
    symbolSpan.textContent = symbol;
    button.appendChild(symbolSpan);
    button.append(` ${label}`);

    if (isInsideGrid) {
      button.addEventListener('click', () => handlers.onMoveOrSwap(row, column, targetRow, targetColumn));
    }
    moveRow.appendChild(button);
  });
  panel.appendChild(moveRow);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn--secondary';
  removeButton.textContent = 'Remove Student';
  removeButton.addEventListener('click', () => handlers.onRemoveStudent(row, column));
  panel.appendChild(removeButton);

  return panel;
}

/** The student roster — a genuinely narrower, secondary panel. Every card is draggable; dropping one onto an empty grid cell assigns that student. */
function renderRoster(unseatedStudents, handlers) {
  const roster = document.createElement('div');
  roster.className = 'seating-view__roster';

  const heading = document.createElement('h2');
  heading.className = 'seating-view__roster-heading';
  heading.textContent = `Students (${unseatedStudents.length})`;
  roster.appendChild(heading);

  if (unseatedStudents.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'seating-view__roster-empty';
    empty.textContent = 'Every student is already seated.';
    roster.appendChild(empty);
    return roster;
  }

  const groupedByTeam = new Map();
  unseatedStudents.forEach(({ student, team }) => {
    const key = team?.id ?? 'none';
    if (!groupedByTeam.has(key)) groupedByTeam.set(key, { team, students: [] });
    groupedByTeam.get(key).students.push(student);
  });

  groupedByTeam.forEach(({ team, students }) => {
    const teamHeading = document.createElement('p');
    teamHeading.className = 'seating-view__roster-team-heading';
    teamHeading.textContent = team ? team.name : 'No Team';
    roster.appendChild(teamHeading);

    students.forEach((student) => {
      const card = document.createElement('div');
      card.className = 'seating-view__roster-card';
      card.draggable = true;
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'roster', studentId: student.id }));
      });
      card.appendChild(createStudentNameElement({ student, team, leadingMarker: 'swatch' }));
      roster.appendChild(card);
    });
  });

  return roster;
}
