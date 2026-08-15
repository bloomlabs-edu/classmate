/**
 * ui/views/SeatingView.js
 *
 * Seating — a visual, individual-seat spatial grid editor. The
 * fundamental layout unit is one SEAT — never a bench, row, column,
 * group, or table. A physical 2-seater or 3-seater bench is simply
 * represented as adjacent individual seats; no bench object exists
 * anywhere in this model.
 *
 * CANONICAL SHAPE: classroom.seatingConfig = { cells: [{ id, x, y,
 * type: 'seat' | 'space', studentId }] }. x/y are plain spatial
 * integers (can be negative).
 *
 * INITIAL STATE (this round's own correction): a genuinely fresh
 * classroom — one with no seatingConfig at all — is initialized with
 * EXACTLY one seat, and nothing else. There is no template picker,
 * no "Choose a starting layout" step, no pre-populated arrangement
 * of any kind, and no separate "New Layout"/"Create Layout" workflow
 * — a prior round had introduced a template-selection screen (Rows/
 * Pairs/Groups/etc.) that gated the map behind a choice; that entire
 * system is removed here. There is only ever one seating layout for
 * a classroom, and it always starts as a single blank seat, already
 * active (its own 4 directional "+"s visible immediately — no extra
 * click needed at all). See normalizeSeatingConfig() below for the
 * exact case A (no config at all → one seat) / case B (real cells
 * already exist → loaded exactly as-is, never overwritten) split.
 *
 * THE ACTUAL FOCUSED CORRECTION THIS ROUND: the immediately prior
 * round required clicking a seat first, then choosing a direction
 * from a revealed menu, then choosing Seat/Space — a form-like
 * interaction. That's replaced here with the original sketch's own
 * model: a small "+" genuinely attached to the spatial grid at its
 * own real (x, y) position (see renderClassroomMap()'s own expanded-
 * bounds rendering below — never CSS-only fake positioning), shown
 * at every position orthogonally adjacent to a real cell. Clicking a
 * "+" adds a real seat there immediately — no menu, no Seat/Space
 * choice, no confirmation. Clicking an existing seat/space is a
 * completely separate interaction: it opens only that cell's own
 * small management panel (assign via roster/remove a student,
 * delete) — it can never add a new cell.
 *
 * INTENTIONAL SPACE CREATION (this round's own addition): "space" was
 * already a supported cell type, but nothing in the UI could actually
 * create one deliberately. The one, explicit way to place a space is
 * now the active seat's own management panel's own "Add Space" row —
 * reusing the exact same free-direction check the primary "+"
 * controls use, adding a real space cell directly with a single
 * click, never a separate popup. There is still no "gap" object of
 * any kind — visual spacing between adjacent cells is purely CSS; a
 * space is a real, explicit spatial cell, nothing more.
 *
 * GAP IS NOT A DATA CONCEPT: an unoccupied position that was never
 * explicitly created (seat or space) simply doesn't exist in
 * cells[] at all, and renders nothing — never an "Empty" cell filling
 * a bounding box, and never a persisted gap/spacing record of any
 * kind.
 *
 * MIGRATION, ROUTING FIX, and VIEWPORT PRESERVATION are all unchanged
 * from prior rounds — this correction only touches the initial state
 * of a genuinely fresh classroom.
 */

import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { generateId } from '../../utils/idGenerator.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';

export function renderSeatingView(container, { classroom, onBack }) {
  normalizeSeatingConfig(classroom);
  let currentClassroom = classroom;
  let selectedStudentId = null; // the one student currently "picked up" from the roster, or null
  // A genuinely fresh classroom (case A: exactly one seat) starts
  // with that seat already active, so its own 4 "+"s are visible
  // immediately — no extra click, no picker step of any kind.
  let activeCellId = currentClassroom.seatingConfig.cells.length === 1 ? currentClassroom.seatingConfig.cells[0].id : null;

  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, resyncFromServer);

  function resyncFromServer(freshClassroom) {
    normalizeSeatingConfig(freshClassroom);
    currentClassroom = freshClassroom;
    rerender();
  }

  function rerender() {
    const scrollTop = document.scrollingElement?.scrollTop ?? 0;
    const scrollLeft = document.scrollingElement?.scrollLeft ?? 0;

    render(container, currentClassroom, selectedStudentId, activeCellId, {
      onBack: () => {
        workspaceCoordinator.unregisterActiveWorkspace(currentClassroom.id);
        onBack();
      },
      onSelectStudentFromRoster: (studentId) => {
        selectedStudentId = studentId;
        activeCellId = null;
        rerender();
      },
      onCancelSelection: () => {
        selectedStudentId = null;
        rerender();
      },
      onSeatClick: (cellId) => {
        assignStudentToSeat(currentClassroom, cellId, selectedStudentId);
        selectedStudentId = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onToggleActiveCell: (cellId) => {
        activeCellId = activeCellId === cellId ? null : cellId;
        rerender();
      },
      // The actual fix for this round: clicking a "+" adds a real
      // seat AT this exact position immediately — no Seat/Space
      // choice, no confirmation, no menu of any kind at all. The new
      // seat also becomes the new "active" one, so ITS OWN adjacent
      // +s show next (see renderClassroomMap()'s own comment on why
      // only ever one seat's own +s render at a time — this is what
      // actually prevents the reported perimeter).
      onAddSeatAt: (x, y) => {
        const newCellId = addSeatAt(currentClassroom, x, y);
        if (newCellId) activeCellId = newCellId;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onAddSpaceAt: (x, y) => {
        const newCellId = addSpaceAt(currentClassroom, x, y);
        if (newCellId) activeCellId = newCellId;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onRemoveStudent: (cellId) => {
        setCellStudent(currentClassroom, cellId, null);
        workspaceService.save(currentClassroom);
        rerender();
      },
      // Moves an already-seated student to an adjacent, existing,
      // unoccupied seat — never creates a cell, never overwrites an
      // occupant. Genuinely distinct from the "+" building controls:
      // this only ever operates on cells that already exist.
      onMoveStudent: (cellId, direction) => {
        const newActiveCellId = moveStudent(currentClassroom, cellId, direction);
        if (newActiveCellId) activeCellId = newActiveCellId;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onDeleteCell: (cellId) => {
        deleteCell(currentClassroom, cellId);
        activeCellId = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
    });

    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = scrollTop;
      document.scrollingElement.scrollLeft = scrollLeft;
    }
  }

  rerender();
}

/**
 * CASE A: no seatingConfig at all (a genuinely new classroom) — the
 * one and only initial state is exactly one seat. Never a picker,
 * never a pre-populated arrangement of any kind.
 *
 * CASE B: seatingConfig already has real cells (whether built by the
 * teacher or migrated from an older shape below) — load it exactly
 * as-is. Never overwritten, never regenerated.
 */
function normalizeSeatingConfig(classroom) {
  const existing = classroom.seatingConfig;

  if (!existing) {
    classroom.seatingConfig = { cells: [{ id: generateId(), x: 0, y: 0, type: 'seat', studentId: null }] };
    return;
  }

  if (Array.isArray(existing.cells)) {
    return; // already canonical — case B, loaded exactly as-is
  }

  // Migration from the older rows/columns/gap grid shape (itself
  // already migrated once before, from two even earlier shapes) —
  // this is still case B (real, already-built data), never
  // destructive, and never shows any picker at all.
  const rows = existing.rows ?? 4;
  const columns = existing.columns ?? existing.seatsPerRow ?? 4;
  const rawAssignments = existing.assignments || {};
  const cells = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const oldKey = `r${row}c${column}`;
      const legacyHyphenKey = `${row - 1}-${column - 1}`;
      const studentId = rawAssignments[oldKey] ?? rawAssignments[legacyHyphenKey] ?? null;
      cells.push({ id: generateId(), x: column - 1, y: row - 1, type: 'seat', studentId });
    }
  }
  classroom.seatingConfig = { cells };
}

function getCellById(classroom, cellId) {
  return classroom.seatingConfig.cells.find((cell) => cell.id === cellId) ?? null;
}

function getCellAt(classroom, x, y) {
  return classroom.seatingConfig.cells.find((cell) => cell.x === x && cell.y === y) ?? null;
}

/**
 * The actual fix for this round: adds a real seat at an exact (x, y)
 * position immediately — no menu, no Seat/Space choice, no
 * intermediate step of any kind. Still enforces "no overlapping
 * cells": if the position is already occupied, this is a genuine
 * no-op — the UI itself only ever renders a "+" at a position with no
 * real cell there at all (see renderClassroomMap() below), so
 * reaching this branch at all would mean a stale click.
 */
function addSeatAt(classroom, x, y) {
  if (getCellAt(classroom, x, y)) return null; // already occupied — no-op, never overwritten
  const newCell = { id: generateId(), x, y, type: 'seat', studentId: null };
  classroom.seatingConfig.cells.push(newCell);
  return newCell.id;
}

/**
 * The one, deliberate way a "space" is ever created — never
 * automatic, never generated as a side effect of anything else.
 * Mirrors addSeatAt() exactly, differing only in the resulting type.
 */
function addSpaceAt(classroom, x, y) {
  if (getCellAt(classroom, x, y)) return null; // already occupied — no-op, never overwritten
  const newCell = { id: generateId(), x, y, type: 'space', studentId: null };
  classroom.seatingConfig.cells.push(newCell);
  return newCell.id;
}

function convertCellType(classroom, cellId, newType) {
  const cell = getCellById(classroom, cellId);
  if (!cell) return;
  if (newType === 'space' && cell.studentId) return; // never silently unseat a student via a type conversion
  cell.type = newType;
  if (newType === 'space') cell.studentId = null;
}

function setCellStudent(classroom, cellId, studentId) {
  const cell = getCellById(classroom, cellId);
  if (!cell || cell.type !== 'seat') return;
  cell.studentId = studentId;
}

const MOVE_DIRECTION_OFFSETS = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };

/**
 * Moves an already-seated student to an adjacent, existing,
 * unoccupied seat. Genuinely distinct from the building "+" controls
 * — this NEVER creates a cell at all (only ever reads an existing one
 * via getCellAt) and never overwrites an occupant (only proceeds if
 * the destination is a real seat with no student already in it).
 * Returns the destination cell's own id on success, so it can become
 * the new active cell — or null if the move didn't happen at all.
 */
function moveStudent(classroom, cellId, direction) {
  const sourceCell = getCellById(classroom, cellId);
  if (!sourceCell || sourceCell.type !== 'seat' || !sourceCell.studentId) return null;

  const { dx, dy } = MOVE_DIRECTION_OFFSETS[direction];
  const destinationCell = getCellAt(classroom, sourceCell.x + dx, sourceCell.y + dy);
  if (!destinationCell || destinationCell.type !== 'seat' || destinationCell.studentId) return null; // no existing seat there, or it's a space, or already occupied — never overwritten

  destinationCell.studentId = sourceCell.studentId;
  sourceCell.studentId = null;
  return destinationCell.id;
}

/** Deleting an occupied seat is blocked for the same safety reason as convert-to-space. */
function deleteCell(classroom, cellId) {
  const cell = getCellById(classroom, cellId);
  if (!cell || cell.studentId) return;
  classroom.seatingConfig.cells = classroom.seatingConfig.cells.filter((c) => c.id !== cellId);
}

/**
 * Placing a selected student into a seat. If that seat already holds
 * a different student, the two swap — unless the mover came straight
 * from the roster (no previous seat), in which case the displaced
 * student simply becomes unseated. A space can never receive a
 * student at all.
 */
function assignStudentToSeat(classroom, targetCellId, selectedStudentId) {
  if (!selectedStudentId) return;
  const targetCell = getCellById(classroom, targetCellId);
  if (!targetCell || targetCell.type !== 'seat') return;

  const previousCell = classroom.seatingConfig.cells.find((cell) => cell.studentId === selectedStudentId) ?? null;
  if (previousCell && previousCell.id === targetCellId) return; // clicked their own current seat — no-op

  const displacedStudentId = targetCell.studentId ?? null;
  targetCell.studentId = selectedStudentId;

  if (previousCell) {
    previousCell.studentId = displacedStudentId;
  }
}

function render(container, classroom, selectedStudentId, activeCellId, handlers) {
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

  const allStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));

  if (allStudents.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No students in this classroom yet \u2014 add students first, then build the seating layout here.' }));
    container.appendChild(wrapper);
    return;
  }

  if (selectedStudentId) {
    const hint = document.createElement('p');
    hint.className = 'seating-view__hint';
    const selected = allStudents.find(({ student }) => student.id === selectedStudentId);
    hint.textContent = `Placing ${selected ? selected.student.name : 'student'} \u2014 click an empty seat, or `;
    const cancelLink = document.createElement('button');
    cancelLink.type = 'button';
    cancelLink.className = 'btn btn--text';
    cancelLink.textContent = 'cancel';
    cancelLink.addEventListener('click', handlers.onCancelSelection);
    hint.appendChild(cancelLink);
    wrapper.appendChild(hint);
  }

  const layout = document.createElement('div');
  layout.className = 'seating-view__layout';
  layout.appendChild(renderClassroomMap(classroom, allStudents, selectedStudentId, activeCellId, handlers));
  layout.appendChild(renderRoster(classroom, allStudents, selectedStudentId, handlers));
  wrapper.appendChild(layout);

  container.appendChild(wrapper);
}

/** The physical layout — Board, the individual-seat spatial map, Teacher. */
function renderClassroomMap(classroom, allStudents, selectedStudentId, activeCellId, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__room';

  const board = document.createElement('div');
  board.className = 'seating-view__board';
  board.textContent = 'BOARD';
  section.appendChild(board);

  const cells = classroom.seatingConfig.cells;
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // THE ACTUAL FIX for the reported perimeter: the expanded rendering
  // bounds only ever need to reach one cell beyond the real layout's
  // own extent on whichever side(s) the ONE active cell might need a
  // "+" — never a full ring around the whole layout. A "+" itself is
  // only ever rendered adjacent to the single active cell (see the
  // loop below) — every other empty position, even one immediately
  // touching a different, non-active seat, renders nothing at all.
  const renderMinX = minX - 1;
  const renderMaxX = maxX + 1;
  const renderMinY = minY - 1;
  const renderMaxY = maxY + 1;
  const columnCount = renderMaxX - renderMinX + 1;
  const rowCount = renderMaxY - renderMinY + 1;

  const activeCell = activeCellId ? cells.find((c) => c.id === activeCellId) : null;

  const map = document.createElement('div');
  map.className = 'seating-view__map';
  map.style.gridTemplateColumns = `repeat(${columnCount}, var(--seating-cell-size))`;
  map.style.gridTemplateRows = `repeat(${rowCount}, var(--seating-cell-size))`;

  for (let y = renderMinY; y <= renderMaxY; y += 1) {
    for (let x = renderMinX; x <= renderMaxX; x += 1) {
      const cell = cells.find((c) => c.x === x && c.y === y);
      const slot = document.createElement('div');
      slot.className = 'seating-view__cell-slot';
      slot.style.gridColumn = String(x - renderMinX + 1);
      slot.style.gridRow = String(y - renderMinY + 1);

      if (cell) {
        const occupant = cell.studentId ? allStudents.find(({ student }) => student.id === cell.studentId) : null;
        slot.appendChild(renderCell(cell, occupant, selectedStudentId, activeCellId, cells, handlers));
      } else if (activeCell && isImmediatelyAdjacent(activeCell, x, y)) {
        slot.appendChild(renderAddSeatControl(x, y, handlers));
      }
      // Every other empty position — including ones touching a
      // different, non-active seat — renders nothing at all. This is
      // the whole fix: at most 4 "+" controls exist at any time,
      // always belonging to exactly one seat, never a perimeter.

      map.appendChild(slot);
    }
  }
  section.appendChild(map);

  const teacherLabel = document.createElement('div');
  teacherLabel.className = 'seating-view__teacher-label';
  teacherLabel.textContent = 'TEACHER';
  section.appendChild(teacherLabel);

  return section;
}

function isImmediatelyAdjacent(cell, x, y) {
  return (cell.x === x && Math.abs(cell.y - y) === 1) || (cell.y === y && Math.abs(cell.x - x) === 1);
}

/**
 * A single, small "+" — genuinely attached to the spatial grid at its
 * own real (x, y) position (see renderClassroomMap() above), not a
 * toolbar button or a popup. Clicking it adds a seat directly, with
 * no menu, no choice, no confirmation of any kind.
 */
function renderAddSeatControl(x, y, handlers) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'seating-view__add-control';
  button.textContent = '+';
  button.setAttribute('aria-label', `Add a seat at this position`);
  button.addEventListener('click', () => handlers.onAddSeatAt(x, y));
  return button;
}

/**
 * A single seat/space cell. Clicking it only ever toggles its own
 * management-only panel — it never adds a new cell at all. Adding a
 * cell is exclusively the job of the "+" controls rendered around it
 * (see renderClassroomMap() above) — a genuinely separate
 * interaction from clicking the seat itself.
 */
function renderCell(cell, occupant, selectedStudentId, activeCellId, cells, handlers) {
  const cellWrapper = document.createElement('div');
  cellWrapper.className = 'seating-view__cell-wrapper';

  const cellButton = document.createElement('button');
  cellButton.type = 'button';
  cellButton.className = `seating-view__cell seating-view__cell--${cell.type}`;
  if (occupant) cellButton.classList.add('seating-view__cell--occupied');
  if (cell.id === activeCellId) cellButton.classList.add('seating-view__cell--active');

  const label = document.createElement('span');
  label.className = 'seating-view__cell-label';
  label.textContent = cell.type === 'space' ? '' : occupant ? occupant.student.name : 'Empty';
  cellButton.appendChild(label);

  cellButton.addEventListener('click', () => {
    if (selectedStudentId && cell.type === 'seat') {
      handlers.onSeatClick(cell.id);
    } else {
      handlers.onToggleActiveCell(cell.id);
    }
  });

  cellWrapper.appendChild(cellButton);

  if (cell.id === activeCellId) {
    cellWrapper.appendChild(renderCellPanel(cell, occupant, cells, handlers));
  }

  return cellWrapper;
}

/**
 * This cell's own management-only panel — assign/remove a student,
 * delete this seat. Deliberately contains NO directional/expansion
 * control at all, per explicit product decision: adding a cell is
 * exclusively the "+" controls' own job (see renderClassroomMap()
 * above), never this menu's. "Convert to Space" is intentionally not
 * exposed here at all this round — the underlying type field itself
 * is untouched (see convertCellType(), still present, unused by any
 * UI control for now) — only the surfaced control is removed, per
 * explicit "we can revisit intentional spaces/aisles later."
 */
function renderCellPanel(cell, occupant, cells, handlers) {
  const panel = document.createElement('div');
  panel.className = 'seating-view__cell-panel';

  const heading = document.createElement('p');
  heading.className = 'seating-view__cell-panel-heading';
  heading.textContent = cell.type === 'space' ? 'Space' : occupant ? occupant.student.name : 'Empty seat';
  panel.appendChild(heading);

  const actions = document.createElement('div');
  actions.className = 'seating-view__cell-actions';

  if (cell.type === 'seat' && occupant) {
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--secondary';
    removeButton.textContent = 'Remove Student';
    removeButton.addEventListener('click', () => handlers.onRemoveStudent(cell.id));
    actions.appendChild(removeButton);
  }

  if (cell.type === 'seat' && !occupant) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--text';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => handlers.onDeleteCell(cell.id));
    actions.appendChild(deleteButton);
  }

  if (cell.type === 'space') {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--text';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => handlers.onDeleteCell(cell.id));
    actions.appendChild(deleteButton);
  }

  panel.appendChild(actions);

  // "Move Student" — genuinely distinct from the "+" building
  // controls: this only ever moves a student between cells that
  // already exist. A direction is only offered when a real seat cell
  // (not a space, not empty air, not already occupied) exists there
  // — mirroring the same "only offer what's valid" pattern the "+"
  // controls themselves use, inverted (they require the position to
  // be free; this requires it to already be a real, empty seat).
  if (cell.type === 'seat' && occupant) {
    const validMoves = [
      { direction: 'up', symbol: '\u2191', label: 'Above' },
      { direction: 'down', symbol: '\u2193', label: 'Below' },
      { direction: 'left', symbol: '\u2190', label: 'Left' },
      { direction: 'right', symbol: '\u2192', label: 'Right' },
    ].filter(({ direction }) => {
      const { dx, dy } = MOVE_DIRECTION_OFFSETS[direction];
      const destination = cells.find((c) => c.x === cell.x + dx && c.y === cell.y + dy);
      return destination && destination.type === 'seat' && !destination.studentId;
    });

    if (validMoves.length > 0) {
      const moveLabel = document.createElement('p');
      moveLabel.className = 'seating-view__cell-group-label';
      moveLabel.textContent = 'Move Student';
      panel.appendChild(moveLabel);

      const moveRow = document.createElement('div');
      moveRow.className = 'seating-view__move-controls';
      validMoves.forEach(({ direction, symbol, label }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn btn--ghost seating-view__move-button seating-view__move-button--${direction}`;

        const symbolSpan = document.createElement('span');
        symbolSpan.setAttribute('aria-hidden', 'true');
        symbolSpan.textContent = symbol;
        button.appendChild(symbolSpan);
        button.append(` ${label}`);

        button.addEventListener('click', () => handlers.onMoveStudent(cell.id, direction));
        moveRow.appendChild(button);
      });
      panel.appendChild(moveRow);
    }
  }

  // "Add Space" — the one deliberate, explicit way to place a space,
  // per product decision: never automatic, never a popup of its own.
  // Reuses this seat's own already-open panel, and the exact same
  // free-direction check the primary "+" controls use — a direction
  // is only offered here if nothing already occupies it.
  if (cell.type === 'seat' && !occupant) {
    const freeDirections = [
      { dx: 0, dy: -1, label: 'above' },
      { dx: 0, dy: 1, label: 'below' },
      { dx: -1, dy: 0, label: 'to the left' },
      { dx: 1, dy: 0, label: 'to the right' },
    ].filter(({ dx, dy }) => !cells.some((c) => c.x === cell.x + dx && c.y === cell.y + dy));

    if (freeDirections.length > 0) {
      const spaceLabel = document.createElement('p');
      spaceLabel.className = 'seating-view__cell-panel-note';
      spaceLabel.textContent = 'Add Space:';
      panel.appendChild(spaceLabel);

      const spaceRow = document.createElement('div');
      spaceRow.className = 'seating-view__cell-actions';
      freeDirections.forEach(({ dx, dy, label }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--ghost';
        button.textContent = label;
        button.addEventListener('click', () => handlers.onAddSpaceAt(cell.x + dx, cell.y + dy));
        spaceRow.appendChild(button);
      });
      panel.appendChild(spaceRow);
    }
  }

  return panel;
}

/**
 * Every student not currently seated, grouped by their real Team.
 * Space never counts as a seat at all.
 */
function renderRoster(classroom, allStudents, selectedStudentId, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__roster';

  const seatedIds = new Set(
    classroom.seatingConfig.cells.filter((cell) => cell.type === 'seat' && cell.studentId).map((cell) => cell.studentId)
  );
  const unseated = allStudents.filter(({ student }) => !seatedIds.has(student.id));

  const heading = document.createElement('h2');
  heading.className = 'seating-view__roster-heading';
  heading.textContent = `Unseated Students (${unseated.length})`;
  section.appendChild(heading);

  if (unseated.length === 0) {
    const doneMessage = document.createElement('p');
    doneMessage.className = 'seating-view__roster-empty';
    doneMessage.textContent = 'Every student has a seat.';
    section.appendChild(doneMessage);
    return section;
  }

  const byTeam = new Map();
  unseated.forEach(({ student, team }) => {
    if (!byTeam.has(team.id)) byTeam.set(team.id, { team, students: [] });
    byTeam.get(team.id).students.push(student);
  });

  byTeam.forEach(({ team, students }) => {
    const teamHeading = document.createElement('p');
    teamHeading.className = 'seating-view__roster-team-heading';
    teamHeading.textContent = team.name;
    section.appendChild(teamHeading);

    students.forEach((student) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'seating-view__roster-row';
      if (student.id === selectedStudentId) row.classList.add('seating-view__roster-row--selected');
      row.textContent = student.name;
      row.addEventListener('click', () => handlers.onSelectStudentFromRoster(student.id));
      section.appendChild(row);
    });
  });

  return section;
}
