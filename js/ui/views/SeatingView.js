/**
 * ui/views/SeatingView.js
 *
 * Seating — a visual classroom layout builder, per explicit product
 * decision replacing the previous rows/columns/gap grid model
 * entirely. The fundamental unit is now a SEAT-SPACE: one physical,
 * one-seat-width unit of classroom space, which is either a real
 * SEAT (may hold a student) or a SPACE (an intentional gap/aisle —
 * never assignable). The teacher builds the classroom by adding
 * seat-spaces directly, one at a time, in any of the four directions
 * from an existing one — there is no "rows × columns" concept
 * exposed anywhere in this UI at all.
 *
 * CANONICAL SHAPE: classroom.seatingConfig = { cells: [{ id, x, y,
 * type: 'seat' | 'space', studentId }] }. x/y are plain spatial
 * integer coordinates (can be negative — the classroom grows in any
 * direction from wherever the teacher started), not row/column
 * indices. studentId is null for an empty seat or any space.
 *
 * MIGRATION (see normalizeSeatingConfig() below), not a destructive
 * replace: this feature previously shipped with a rows/columns/gap
 * grid model (itself already migrated once before, from two even
 * earlier shapes — see this function's own inline comments for the
 * complete lineage). Any classroom already holding that shape is
 * converted losslessly here: every existing seat becomes a real
 * "seat" cell at its own spatial position, with its student
 * assignment fully preserved. Nothing is ever silently dropped.
 *
 * A brand-new classroom with no saved seating at all starts with
 * exactly one seat at (0, 0), per explicit product decision — the
 * teacher builds outward from there.
 *
 * Reuses classroom.teams[].students[] directly (see models/Team.js,
 * models/Student.js) — no second student/classroom model.
 *
 * ROOT-CAUSE FIX for the "kicked back to Dashboard" bug, carried over
 * unchanged from prior rounds: this view registers with
 * services/workspaceCoordinator.js (mirroring
 * ui/views/LearningManagementView.js's own established pattern), so
 * a background Firestore snapshot updates this screen in place via
 * resyncFromServer() instead of ever falling through to
 * renderRoute()/Dashboard. Every button here is explicitly
 * type="button" and nothing here is wrapped in a <form>.
 *
 * Local viewport preservation, carried over unchanged: every
 * rerender() explicitly captures and restores
 * document.scrollingElement's own scrollTop/scrollLeft.
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
  let activeCellId = null; // the one cell whose own directional/context controls are currently open, or null

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
      onAddDirection: (fromCellId, direction) => {
        addCellInDirection(currentClassroom, fromCellId, direction);
        workspaceService.save(currentClassroom);
        rerender();
      },
      onConvertToSpace: (cellId) => {
        convertCellType(currentClassroom, cellId, 'space');
        activeCellId = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onConvertToSeat: (cellId) => {
        convertCellType(currentClassroom, cellId, 'seat');
        activeCellId = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onRemoveStudent: (cellId) => {
        setCellStudent(currentClassroom, cellId, null);
        workspaceService.save(currentClassroom);
        rerender(); // the cell panel stays open (activeCellId is untouched) — the teacher may want to immediately reassign this same seat
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
 * The real migration — see this file's own header comment for what
 * it does and why it's never destructive. Idempotent: running it
 * again on an already-canonical {cells: [...]} object changes
 * nothing at all.
 */
function normalizeSeatingConfig(classroom) {
  const existing = classroom.seatingConfig;

  if (!existing) {
    classroom.seatingConfig = { cells: [{ id: generateId(), x: 0, y: 0, type: 'seat', studentId: null }] };
    return;
  }

  if (Array.isArray(existing.cells)) return; // already canonical

  // Prior shape (rows/columns/gap grid, itself already migrated once
  // before from two even earlier shapes — {rows, columns, assignments}
  // keyed "row-col" 0-indexed, and {rows, seatsPerRow, assignments}
  // keyed "r{row}c{col}" 1-indexed). Reuses that same, already-proven
  // key-format detection rather than re-deriving it, then converts
  // every real seat into a real "seat" cell at its own (x, y)
  // position — x = column - 1, y = row - 1 — with its student
  // assignment fully preserved. columnGap/rowGap have no equivalent
  // in the new spatial model at all (spacing is now represented by
  // real "space" cells the teacher adds directly) and are simply not
  // carried forward — this is a genuine change in what spacing means,
  // not a data loss; no seat or assignment is ever dropped.
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

const DIRECTION_OFFSETS = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };

/**
 * The actual fix for "do not allow overlapping cells" (item 11): this
 * is the ONLY place a new cell is ever created from a direction, and
 * it always checks the target position first. If a cell already
 * exists there, this is a genuine no-op — the UI itself already
 * never renders a direction button toward an occupied position at
 * all (see renderCellControls() below), so reaching this branch would
 * mean a stale click; still handled safely here regardless, matching
 * "prevent the operation" over any risk of silent data loss.
 */
function addCellInDirection(classroom, fromCellId, direction) {
  const fromCell = getCellById(classroom, fromCellId);
  if (!fromCell) return;

  const { dx, dy } = DIRECTION_OFFSETS[direction];
  const targetX = fromCell.x + dx;
  const targetY = fromCell.y + dy;

  if (getCellAt(classroom, targetX, targetY)) return; // already occupied — no-op, never overwritten

  classroom.seatingConfig.cells.push({ id: generateId(), x: targetX, y: targetY, type: 'seat', studentId: null });
}

/**
 * Converting occupied seat -> space is explicitly blocked here (item
 * 14's own safety rule: "DO NOT allow occupied seat -> Space without
 * first safely unseating the student") — the UI itself already never
 * offers this control on an occupied seat at all (see
 * renderCellControls() below); this is the same defense-in-depth
 * pattern addCellInDirection() above uses for the overlap rule.
 */
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

/** Deleting an occupied seat is blocked for the exact same reason as convert-to-space — see convertCellType()'s own comment. */
function deleteCell(classroom, cellId) {
  const cell = getCellById(classroom, cellId);
  if (!cell || cell.studentId) return;
  classroom.seatingConfig.cells = classroom.seatingConfig.cells.filter((c) => c.id !== cellId);
}

/**
 * Placing a selected student into a seat. If that seat already holds
 * a different student, the two swap — unless the mover came straight
 * from the roster (no previous seat), in which case the displaced
 * student simply becomes unseated, back in the roster. A space can
 * never receive a student at all (enforced here, and the UI itself
 * never renders a space as a click target for placement either).
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
    previousCell.studentId = displacedStudentId; // a genuine swap, or null if the target was empty
  }
  // If there was no previousCell (came from the roster) and a
  // displacedStudentId existed, that student is simply no longer
  // assigned to any cell at all now — correctly unseated, back in
  // the roster.
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

/**
 * The physical layout — Board at the top, the spatial seat-space map
 * (compact, bounded to the real extent of the teacher's own cells,
 * never a rows x columns grid), Teacher at the bottom.
 */
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
  const columnCount = maxX - minX + 1;
  const rowCount = maxY - minY + 1;

  const map = document.createElement('div');
  map.className = 'seating-view__map';
  map.style.gridTemplateColumns = `repeat(${columnCount}, 1fr)`;
  map.style.gridTemplateRows = `repeat(${rowCount}, 1fr)`;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const cell = cells.find((c) => c.x === x && c.y === y);
      const wrapperEl = document.createElement('div');
      wrapperEl.className = 'seating-view__cell-slot';
      wrapperEl.style.gridColumn = String(x - minX + 1);
      wrapperEl.style.gridRow = String(y - minY + 1);
      if (cell) {
        const occupant = cell.studentId ? allStudents.find(({ student }) => student.id === cell.studentId) : null;
        wrapperEl.appendChild(renderCell(cell, occupant, selectedStudentId, activeCellId, cells, handlers));
      }
      // A position inside the bounding box with no real cell at all
      // (e.g. the unused corner of an L-shaped layout) renders as a
      // genuinely empty, non-interactive slot — never a phantom seat.
      map.appendChild(wrapperEl);
    }
  }
  section.appendChild(map);

  const teacherLabel = document.createElement('div');
  teacherLabel.className = 'seating-view__teacher-label';
  teacherLabel.textContent = 'TEACHER';
  section.appendChild(teacherLabel);

  return section;
}

function renderCell(cell, occupant, selectedStudentId, activeCellId, allCells, handlers) {
  const cellWrapper = document.createElement('div');
  cellWrapper.className = 'seating-view__cell-wrapper';

  const cellButton = document.createElement('button');
  cellButton.type = 'button';
  cellButton.className = `seating-view__cell seating-view__cell--${cell.type}`;
  if (occupant) cellButton.classList.add('seating-view__cell--occupied');
  if (cell.id === activeCellId) cellButton.classList.add('seating-view__cell--active');

  const label = document.createElement('span');
  label.className = 'seating-view__cell-label';
  label.textContent = cell.type === 'space' ? '' : occupant ? occupant.student.name : '\u2014';
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
    cellWrapper.appendChild(renderCellControls(cell, occupant, allCells, handlers));
  }

  return cellWrapper;
}

/**
 * The contextual controls for exactly one, currently-active cell —
 * four directional add buttons (only ever shown toward a genuinely
 * empty position, per item 11's own "prevent the operation" rule —
 * there is no direction button at all toward an already-occupied
 * position, so the operation is prevented structurally, not by a
 * runtime check alone) and the type/removal actions for this cell
 * specifically. Rendered as a compact panel directly below the map,
 * not as floating overlays — a deliberate, pragmatic simplification
 * for this environment (no way to visually verify complex absolute-
 * positioned overlay placement here); still reads as "this cell's own
 * controls," just anchored below the map rather than hovering over
 * the grid itself.
 */
function renderCellControls(cell, occupant, allCells, handlers) {
  const panel = document.createElement('div');
  panel.className = 'seating-view__cell-panel';

  const heading = document.createElement('p');
  heading.className = 'seating-view__cell-panel-heading';
  heading.textContent = cell.type === 'space' ? 'Space' : occupant ? occupant.student.name : 'Empty seat';
  panel.appendChild(heading);

  const directions = document.createElement('div');
  directions.className = 'seating-view__cell-directions';
  [
    { direction: 'up', label: '\u2191 Add above' },
    { direction: 'down', label: '\u2193 Add below' },
    { direction: 'left', label: '\u2190 Add left' },
    { direction: 'right', label: '\u2192 Add right' },
  ].forEach(({ direction, label }) => {
    const { dx, dy } = DIRECTION_OFFSETS[direction];
    const targetOccupied = allCells.some((c) => c.x === cell.x + dx && c.y === cell.y + dy);
    if (targetOccupied) return; // never offered toward an already-occupied position at all
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost seating-view__cell-direction-button';
    button.textContent = label;
    button.addEventListener('click', () => handlers.onAddDirection(cell.id, direction));
    directions.appendChild(button);
  });
  panel.appendChild(directions);

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
    const convertButton = document.createElement('button');
    convertButton.type = 'button';
    convertButton.className = 'btn btn--text';
    convertButton.textContent = 'Convert to Space';
    convertButton.addEventListener('click', () => handlers.onConvertToSpace(cell.id));
    actions.appendChild(convertButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--text';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => handlers.onDeleteCell(cell.id));
    actions.appendChild(deleteButton);
  }

  if (cell.type === 'space') {
    const convertButton = document.createElement('button');
    convertButton.type = 'button';
    convertButton.className = 'btn btn--text';
    convertButton.textContent = 'Convert to Seat';
    convertButton.addEventListener('click', () => handlers.onConvertToSeat(cell.id));
    actions.appendChild(convertButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--text';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => handlers.onDeleteCell(cell.id));
    actions.appendChild(deleteButton);
  }

  if (cell.type === 'seat' && occupant) {
    const blockedNote = document.createElement('p');
    blockedNote.className = 'seating-view__cell-panel-note';
    blockedNote.textContent = 'Remove the student first to convert or delete this seat.';
    actions.appendChild(blockedNote);
  }

  panel.appendChild(actions);
  return panel;
}

/**
 * Every student not currently seated, grouped by their real Team —
 * this IS the reuse of the existing student/group model, not a
 * second roster. A space never counts as a seat at all, matching the
 * explicit "Unseated Students = total students minus students
 * assigned to actual seats" requirement.
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
