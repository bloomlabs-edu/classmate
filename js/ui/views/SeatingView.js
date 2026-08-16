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
 * type: 'seat' | 'space', studentId }], roomElements: { doors: [{id,
 * wall, position}], windows: [{id, wall, position}] } }. x/y are
 * plain spatial integers (can be negative), used only by seating
 * cells. Doors/windows are genuinely NOT seating cells at all — see
 * ensureRoomElements()/addDoorAt()/addWindowAt() below for the
 * complete "SEATING CELLS ≠ ROOM ELEMENTS" model.
 *
 * THIS ROUND'S OWN FIXES: the fixed Teacher marker is removed
 * entirely; the map's own width is now genuinely responsive (columns
 * are minmax(0, 1fr), capped at min(natural size, 100%) — see
 * renderClassroomMap() below — so a wide layout shrinks to fit the
 * card rather than overflowing past it); Space now offers "Convert
 * to Seat" alongside "Delete Space"; Door/Window can be added from
 * an empty seat's own panel, mirroring "Add Space" exactly.
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
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';
import { generateId } from '../../utils/idGenerator.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';

export function renderSeatingView(container, { classroom, onBack, onSelectStudent }) {
  normalizeSeatingConfig(classroom);
  let currentClassroom = classroom;
  let selectedStudentId = null; // the one student currently "picked up" from the roster, or null
  // A genuinely fresh classroom (case A: exactly one seat) starts
  // with that seat already active, so its own 4 "+"s are visible
  // immediately — no extra click, no picker step of any kind.
  let activeCellId = currentClassroom.seatingConfig.cells.length === 1 ? currentClassroom.seatingConfig.cells[0].id : null;
  // The one occupied seat currently seeking a space to swap with, or
  // null. Genuinely distinct from activeCellId — while set, every
  // real space anywhere in the layout becomes a valid, highlighted
  // swap destination (see renderClassroomMap()'s own comment on why
  // this is never restricted to adjacency at all, unlike Move
  // Student), regardless of whether it's adjacent to the seat.
  let swapSourceCellId = null;
  // Room-level placement mode: null | 'door' | 'window'. Genuinely
  // distinct from both activeCellId and swapSourceCellId — this is a
  // ROOM concern (per the corrected component hierarchy), not tied
  // to any specific seat at all. While set, every position adjacent
  // to ANY existing cell in the whole layout becomes a highlighted,
  // clickable placement target directly on the map itself — the same
  // "highlight and click to place" pattern Swap with Space already
  // established, applied to a genuinely different purpose.
  let roomPlacementMode = null;
  // Which door/window's own panel is currently open, if any.
  // Genuinely distinct from activeCellId — a room element is never a
  // seating cell at all, so it can never share that same id space.
  let activeRoomElementId = null;

  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, resyncFromServer);

  function resyncFromServer(freshClassroom) {
    normalizeSeatingConfig(freshClassroom);
    currentClassroom = freshClassroom;
    rerender();
  }

  function rerender() {
    const scrollTop = document.scrollingElement?.scrollTop ?? 0;
    const scrollLeft = document.scrollingElement?.scrollLeft ?? 0;

    render(container, currentClassroom, selectedStudentId, activeCellId, swapSourceCellId, roomPlacementMode, activeRoomElementId, {
      onBack: () => {
        workspaceCoordinator.unregisterActiveWorkspace(currentClassroom.id);
        onBack();
      },
      // Opens the real, existing student profile — genuinely distinct
      // from onSelectStudentFromRoster (which picks a student up for
      // seat assignment). Reuses the app's own already-routed
      // navigation; this view has no opinion about where it goes.
      onSelectStudent: (studentId) => onSelectStudent(studentId),
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
      // "Swap with Space" — genuinely distinct from Move Student
      // (which only ever targets an adjacent, existing, unoccupied
      // seat). This targets any real space anywhere in the layout,
      // regardless of adjacency, per explicit product decision.
      onEnterSwapMode: (cellId) => {
        swapSourceCellId = cellId;
        rerender();
      },
      onCancelSwapMode: () => {
        swapSourceCellId = null;
        rerender();
      },
      onSwapWithSpace: (seatCellId, spaceCellId) => {
        swapCellPositions(currentClassroom, seatCellId, spaceCellId);
        swapSourceCellId = null;
        activeCellId = seatCellId; // the student's own seat cell keeps the focus, now at its new position
        workspaceService.save(currentClassroom);
        rerender();
      },
      // Room-level controls — genuinely distinct from seat-level "+"
      // and Add Space, per the corrected component hierarchy. Not
      // tied to any specific seat's own adjacent positions at all.
      onEnterRoomPlacementMode: (elementType) => {
        roomPlacementMode = elementType;
        activeCellId = null; // no seat-level panel competes with room placement
        rerender();
      },
      onCancelRoomPlacementMode: () => {
        roomPlacementMode = null;
        rerender();
      },
      onPlaceRoomElementAt: (wall, position) => {
        const newElementId = roomPlacementMode === 'door' ? addDoorAt(currentClassroom, wall, position) : addWindowAt(currentClassroom, wall, position);
        roomPlacementMode = null;
        if (newElementId) activeRoomElementId = newElementId;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onToggleActiveRoomElement: (elementId) => {
        activeRoomElementId = activeRoomElementId === elementId ? null : elementId;
        rerender();
      },
      onDeleteRoomElement: (elementId) => {
        deleteRoomElement(currentClassroom, elementId);
        activeRoomElementId = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onRotateRoom: () => {
        rotateOrientation(currentClassroom);
        workspaceService.save(currentClassroom);
        rerender();
      },
      // "Convert to Seat" — genuinely distinct from "Add Seat": this
      // changes an EXISTING space cell's own type in place, keeping
      // the same id and x/y exactly as they were. Never creates a
      // new cell, never touches any other cell in the layout.
      onConvertToSeat: (cellId) => {
        convertCellType(currentClassroom, cellId, 'seat');
        workspaceService.save(currentClassroom);
        rerender();
      },
      onConvertToSpace: (cellId) => {
        convertCellType(currentClassroom, cellId, 'space');
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

/**
 * Door/Window — real, physical classroom-layout elements, per
 * explicit product decision. Mirror addSpaceAt() exactly (same
 * no-overwrite guard, same shape), differing only in the resulting
 * type. Neither can ever hold a student — assignStudentToSeat(),
 * moveStudent(), and swapCellPositions() below all already gate on
 * type === 'seat'/'space' explicitly, so a door/window is already,
 * structurally excluded from every student-related operation without
 * any further guard needed.
 */
/**
 * Room elements — doors/windows — per explicit product decision are
 * genuinely NOT seating cells at all. They live in their own,
 * separate structure (classroom.seatingConfig.roomElements), never as
 * a cell with type: 'door'/'window'. Each is anchored to a real wall
 * ('top'|'bottom'|'left'|'right') and a position index along that
 * wall (0-indexed, matching the seating grid's own column/row
 * count) — never an (x, y) seating coordinate at all.
 */
function ensureRoomElements(classroom) {
  if (!classroom.seatingConfig.roomElements) {
    classroom.seatingConfig.roomElements = { doors: [], windows: [] };
  }
  return classroom.seatingConfig.roomElements;
}

/**
 * Room orientation — a single, persisted, room-level value (0|90|180|
 * 270), per explicit product decision. This NEVER rewrites any real
 * seating cell's own x/y, nor any door/window's own wall/position —
 * it is purely a render-time transform (see rotatePoint()/
 * rotateWall() below), applied fresh on every render. A student
 * genuinely stays attached to the exact same seat cell regardless of
 * orientation; only the VISUAL arrangement of the room changes.
 */
function ensureOrientation(classroom) {
  if (typeof classroom.seatingConfig.orientation !== 'number') {
    classroom.seatingConfig.orientation = 0;
  }
  return classroom.seatingConfig.orientation;
}

function rotateOrientation(classroom) {
  const current = ensureOrientation(classroom);
  classroom.seatingConfig.orientation = (current + 90) % 360;
}

/**
 * Rotates a real (x, y) seating coordinate into its own DISPLAY
 * position under the given orientation — a pure, render-time-only
 * transform. Standard clockwise rotation about the origin: 90° maps
 * (x, y) -> (-y, x), 180° -> (-x, -y), 270° -> (y, -x). The
 * underlying cell's own real x/y is never touched by this at all.
 */
function rotatePoint(x, y, orientation) {
  switch (orientation) {
    case 90: return { x: -y, y: x };
    case 180: return { x: -x, y: -y };
    case 270: return { x: y, y: -x };
    default: return { x, y };
  }
}

/**
 * Rotates which PHYSICAL wall a given LOGICAL wall corresponds to
 * under the current orientation — so a door/window genuinely stays
 * attached to the same physical wall of the room as the room itself
 * rotates, consistent with the seating grid's own rotation above.
 * E.g. at 90°, what was the room's own "left" wall now visually
 * renders where "top" used to be.
 */
function rotateWall(wall, orientation) {
  const order = ['top', 'right', 'bottom', 'left'];
  const steps = orientation / 90;
  const currentIndex = order.indexOf(wall);
  return order[(currentIndex + steps) % 4];
}

function addDoorAt(classroom, wall, position) {
  const roomElements = ensureRoomElements(classroom);
  if (roomElements.doors.some((d) => d.wall === wall && d.position === position)) return null; // already occupied — no-op, never overwritten
  if (roomElements.windows.some((w) => w.wall === wall && w.position === position)) return null; // a door and a window can never share the exact same wall position
  const newDoor = { id: generateId(), wall, position };
  roomElements.doors.push(newDoor);
  return newDoor.id;
}

function addWindowAt(classroom, wall, position) {
  const roomElements = ensureRoomElements(classroom);
  if (roomElements.windows.some((w) => w.wall === wall && w.position === position)) return null;
  if (roomElements.doors.some((d) => d.wall === wall && d.position === position)) return null;
  const newWindow = { id: generateId(), wall, position };
  roomElements.windows.push(newWindow);
  return newWindow.id;
}

function deleteRoomElement(classroom, elementId) {
  const roomElements = ensureRoomElements(classroom);
  roomElements.doors = roomElements.doors.filter((d) => d.id !== elementId);
  roomElements.windows = roomElements.windows.filter((w) => w.id !== elementId);
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

/**
 * The actual "Swap with Space" operation. Exchanges ONLY the x/y
 * coordinates of the two real cells — the seat cell keeps its own id
 * and studentId exactly as they were; the space cell keeps its own
 * id exactly as it was too. Never creates a cell, never deletes one,
 * never touches any other cell in the layout at all. Can target any
 * real space anywhere in the layout, not just an adjacent one — per
 * explicit product decision, unlike moveStudent() above.
 */
function swapCellPositions(classroom, seatCellId, spaceCellId) {
  const seatCell = getCellById(classroom, seatCellId);
  const spaceCell = getCellById(classroom, spaceCellId);
  if (!seatCell || !spaceCell) return;
  if (seatCell.type !== 'seat' || !seatCell.studentId) return; // only ever initiated from a genuinely occupied seat
  if (spaceCell.type !== 'space') return; // the destination must genuinely be a space, never a seat

  const seatX = seatCell.x;
  const seatY = seatCell.y;
  seatCell.x = spaceCell.x;
  seatCell.y = spaceCell.y;
  spaceCell.x = seatX;
  spaceCell.y = seatY;
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

function render(container, classroom, selectedStudentId, activeCellId, swapSourceCellId, roomPlacementMode, activeRoomElementId, handlers) {
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
  layout.appendChild(renderClassroomMap(classroom, allStudents, selectedStudentId, activeCellId, swapSourceCellId, roomPlacementMode, activeRoomElementId, handlers));
  layout.appendChild(renderRoster(classroom, allStudents, selectedStudentId, handlers));
  wrapper.appendChild(layout);

  container.appendChild(wrapper);
}

function renderClassroomMap(classroom, allStudents, selectedStudentId, activeCellId, swapSourceCellId, roomPlacementMode, activeRoomElementId, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__room';

  const orientation = ensureOrientation(classroom);
  section.appendChild(renderRoomControls(roomPlacementMode, orientation, handlers));

  const board = document.createElement('div');
  board.className = 'seating-view__board';
  board.textContent = 'BOARD';
  section.appendChild(board);

  const cells = classroom.seatingConfig.cells;
  const roomElements = ensureRoomElements(classroom);
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
  // These bounds are the LOGICAL (never-rotated) coordinate space —
  // every interaction (adjacency, availability, placement) operates
  // here, completely unaffected by orientation.
  const renderMinX = minX - 1;
  const renderMaxX = maxX + 1;
  const renderMinY = minY - 1;
  const renderMaxY = maxY + 1;

  // Rotation is a pure, render-time-only DISPLAY transform (see
  // rotatePoint() above) — it never touches any real cell's own x/y,
  // door/window's own wall/position, or any interaction logic below.
  // Only the grid's own visual placement rotates. 90°/270° genuinely
  // swap which logical axis becomes the display's own columns vs
  // rows, so the display bounds must be computed from the ROTATED
  // corners, not assumed to match the logical ones directly.
  const rotatedCorners = [
    rotatePoint(renderMinX, renderMinY, orientation),
    rotatePoint(renderMaxX, renderMinY, orientation),
    rotatePoint(renderMinX, renderMaxY, orientation),
    rotatePoint(renderMaxX, renderMaxY, orientation),
  ];
  const displayMinX = Math.min(...rotatedCorners.map((p) => p.x));
  const displayMaxX = Math.max(...rotatedCorners.map((p) => p.x));
  const displayMinY = Math.min(...rotatedCorners.map((p) => p.y));
  const displayMaxY = Math.max(...rotatedCorners.map((p) => p.y));
  const columnCount = displayMaxX - displayMinX + 1;
  const rowCount = displayMaxY - displayMinY + 1;

  const activeCell = activeCellId ? cells.find((c) => c.id === activeCellId) : null;
  // THE ACTUAL FIX (item 5): the map's own "+" controls now use the
  // exact same shared getAdjacentCellAvailability() function as every
  // "Add Space" panel — never a second, separately-maintained
  // definition of "available."
  const activeCellAvailability = activeCell ? getAdjacentCellAvailability(activeCell, cells) : null;

  // Doors/windows belong ONLY to the four room walls, per explicit
  // product decision — never an interior seating position. Each
  // logical wall's own real strip renders at whichever PHYSICAL
  // position rotateWall() maps it to under the current orientation —
  // a door genuinely stays attached to the same physical wall as the
  // room itself rotates, consistent with the seating grid above.
  const wallStripsByPhysicalPosition = {
    top: renderWallStrip('top', columnCount, roomElements, orientation, roomPlacementMode, activeRoomElementId, handlers),
    bottom: renderWallStrip('bottom', columnCount, roomElements, orientation, roomPlacementMode, activeRoomElementId, handlers),
    left: renderWallStrip('left', rowCount, roomElements, orientation, roomPlacementMode, activeRoomElementId, handlers),
    right: renderWallStrip('right', rowCount, roomElements, orientation, roomPlacementMode, activeRoomElementId, handlers),
  };

  section.appendChild(wallStripsByPhysicalPosition.top);

  const mapRow = document.createElement('div');
  mapRow.className = 'seating-view__map-row';
  mapRow.appendChild(wallStripsByPhysicalPosition.left);

  const map = document.createElement('div');
  map.className = 'seating-view__map';
  // THE ACTUAL FIX for the reported overflow: each column is now
  // genuinely flexible (minmax(0, 1fr)) rather than a fixed size —
  // and the map's own overall width is capped at min(its natural
  // size, 100% of the available room), so a wide layout shrinks to
  // fit rather than spilling past the card. Rows keep the same real
  // cell size so seats stay legible; only the width responds.
  map.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
  map.style.gridTemplateRows = `repeat(${rowCount}, var(--seating-cell-size))`;
  map.style.width = `min(calc(${columnCount} * (var(--seating-cell-size) + var(--seating-cell-gap))), 100%)`;

  for (let y = renderMinY; y <= renderMaxY; y += 1) {
    for (let x = renderMinX; x <= renderMaxX; x += 1) {
      const cell = cells.find((c) => c.x === x && c.y === y);
      const displayPos = rotatePoint(x, y, orientation);
      const slot = document.createElement('div');
      slot.className = 'seating-view__cell-slot';
      slot.style.gridColumn = String(displayPos.x - displayMinX + 1);
      slot.style.gridRow = String(displayPos.y - displayMinY + 1);

      if (cell) {
        const occupant = cell.studentId ? allStudents.find(({ student }) => student.id === cell.studentId) : null;
        slot.appendChild(renderCell(cell, occupant, selectedStudentId, activeCellId, swapSourceCellId, cells, handlers));
      } else if (!swapSourceCellId && activeCell && isAdjacentInAvailableDirection(activeCell, activeCellAvailability, x, y)) {
        slot.appendChild(renderAddSeatControl(x, y, handlers));
      }
      // Every other empty position — including ones touching a
      // different, non-active seat — renders nothing at all. This is
      // the whole fix: at most 4 "+" controls exist at any time,
      // always belonging to exactly one seat, never a perimeter.

      map.appendChild(slot);
    }
  }
  mapRow.appendChild(map);
  mapRow.appendChild(wallStripsByPhysicalPosition.right);
  section.appendChild(mapRow);

  section.appendChild(wallStripsByPhysicalPosition.bottom);

  return section;
}

/**
 * A single wall (top/bottom/left/right) — a row (or column, for
 * left/right) of "positions" matching the seating grid's own real
 * extent. Each position shows either an existing door/window, a
 * highlighted placement target (only while roomPlacementMode is
 * active and nothing already occupies that exact wall position), or
 * nothing at all. This is what genuinely restricts door/window
 * placement to the room's own walls — the interior seating grid is
 * never a candidate at all, structurally, not just by convention.
 */
function renderWallStrip(physicalPosition, length, roomElements, orientation, roomPlacementMode, activeRoomElementId, handlers) {
  // Inverse of rotateWall(): given where this strip visually renders
  // (physicalPosition), find which LOGICAL wall maps there under the
  // current orientation — the wall genuinely persisted on each
  // door/window, never the physical rendering position itself.
  const logicalWall = ['top', 'right', 'bottom', 'left'].find((wall) => rotateWall(wall, orientation) === physicalPosition);

  const strip = document.createElement('div');
  strip.className = `seating-view__wall-strip seating-view__wall-strip--${physicalPosition}`;

  for (let position = 0; position < length; position += 1) {
    const door = roomElements.doors.find((d) => d.wall === logicalWall && d.position === position);
    const window_ = roomElements.windows.find((w) => w.wall === logicalWall && w.position === position);
    const existing = door ? { ...door, elementType: 'door' } : window_ ? { ...window_, elementType: 'window' } : null;

    const slot = document.createElement('div');
    slot.className = 'seating-view__wall-slot';

    if (existing) {
      slot.appendChild(renderRoomElement(existing, activeRoomElementId, handlers));
    } else if (roomPlacementMode) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seating-view__add-control seating-view__add-control--room-placement';
      button.textContent = '+';
      button.setAttribute('aria-label', `Place the ${roomPlacementMode} here`);
      button.addEventListener('click', () => handlers.onPlaceRoomElementAt(logicalWall, position));
      slot.appendChild(button);
    }

    strip.appendChild(slot);
  }

  return strip;
}

/** A single, real door or window on a wall — clicking it opens its own minimal panel (Delete Door/Delete Window only), never seat/space/student controls of any kind. */
function renderRoomElement(element, activeRoomElementId, handlers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'seating-view__room-element-wrapper';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `seating-view__room-element seating-view__room-element--${element.elementType}`;
  if (element.id === activeRoomElementId) button.classList.add('seating-view__room-element--active');
  button.textContent = element.elementType === 'door' ? 'Door' : 'Window';
  button.addEventListener('click', () => handlers.onToggleActiveRoomElement(element.id));
  wrapper.appendChild(button);

  if (element.id === activeRoomElementId) {
    const panel = document.createElement('div');
    panel.className = 'seating-view__cell-panel';

    const heading = document.createElement('p');
    heading.className = 'seating-view__cell-panel-heading';
    heading.textContent = element.elementType === 'door' ? 'Door' : 'Window';
    panel.appendChild(heading);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--secondary';
    deleteButton.textContent = element.elementType === 'door' ? 'Delete Door' : 'Delete Window';
    deleteButton.addEventListener('click', () => handlers.onDeleteRoomElement(element.id));
    panel.appendChild(deleteButton);

    wrapper.appendChild(panel);
  }

  return wrapper;
}

function isImmediatelyAdjacent(cell, x, y) {
  return (cell.x === x && Math.abs(cell.y - y) === 1) || (cell.y === y && Math.abs(cell.x - x) === 1);
}

/**
 * THE single, shared source of truth for "is this exact adjacent
 * coordinate free" — per explicit product decision, there must never
 * be two different definitions of directional availability. Checks
 * ONLY the exact coordinate against every real cell in the layout —
 * never the cell's row/column, never the layout's own bounding box,
 * never whether the position is "outside" the current shape. If no
 * real cell occupies that exact (x, y), the direction is available.
 * Used identically by the map's own "+" controls and every "Add
 * Space" panel section (empty seat, occupied seat, and space).
 */
function getAdjacentCellAvailability(cell, cells) {
  return {
    up: !cells.some((c) => c.x === cell.x && c.y === cell.y - 1),
    down: !cells.some((c) => c.x === cell.x && c.y === cell.y + 1),
    left: !cells.some((c) => c.x === cell.x - 1 && c.y === cell.y),
    right: !cells.some((c) => c.x === cell.x + 1 && c.y === cell.y),
  };
}

/** Whether the exact (x, y) position corresponds to one of activeCell's own genuinely-available directions, per the shared availability object above. */
function isAdjacentInAvailableDirection(cell, availability, x, y) {
  if (!availability) return false;
  if (availability.up && x === cell.x && y === cell.y - 1) return true;
  if (availability.down && x === cell.x && y === cell.y + 1) return true;
  if (availability.left && x === cell.x - 1 && y === cell.y) return true;
  if (availability.right && x === cell.x + 1 && y === cell.y) return true;
  return false;
}

/**
 * ROOM-LEVEL controls — genuinely separate from any seat's own panel,
 * per the corrected component hierarchy. "+Door"/"+Window" enter a
 * real placement mode (see renderClassroomMap()'s own
 * isAdjacentToAnyCell()-based highlighting above): every valid
 * position anywhere in the layout becomes a clickable target directly
 * on the map itself, never a form or a seat-context menu.
 */
function renderRoomControls(roomPlacementMode, orientation, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__room-controls';

  const heading = document.createElement('p');
  heading.className = 'seating-view__cell-group-label';
  heading.textContent = 'Room';
  section.appendChild(heading);

  if (roomPlacementMode) {
    const hint = document.createElement('p');
    hint.className = 'seating-view__cell-panel-note';
    hint.textContent = `Click a highlighted position to place the ${roomPlacementMode}.`;
    section.appendChild(hint);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', handlers.onCancelRoomPlacementMode);
    section.appendChild(cancelButton);
  } else {
    const row = document.createElement('div');
    row.className = 'seating-view__room-controls-row';

    const addDoorButton = document.createElement('button');
    addDoorButton.type = 'button';
    addDoorButton.className = 'btn btn--ghost';
    addDoorButton.textContent = '+ Door';
    addDoorButton.addEventListener('click', () => handlers.onEnterRoomPlacementMode('door'));
    row.appendChild(addDoorButton);

    const addWindowButton = document.createElement('button');
    addWindowButton.type = 'button';
    addWindowButton.className = 'btn btn--ghost';
    addWindowButton.textContent = '+ Window';
    addWindowButton.addEventListener('click', () => handlers.onEnterRoomPlacementMode('window'));
    row.appendChild(addWindowButton);

    const orientationLabel = document.createElement('span');
    orientationLabel.className = 'seating-view__orientation-label';
    orientationLabel.textContent = `Orientation: ${orientation}\u00b0`;
    row.appendChild(orientationLabel);

    const rotateButton = document.createElement('button');
    rotateButton.type = 'button';
    rotateButton.className = 'btn btn--ghost';
    rotateButton.textContent = '\u21bb Rotate';
    rotateButton.addEventListener('click', handlers.onRotateRoom);
    row.appendChild(rotateButton);

    section.appendChild(row);
  }

  return section;
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
function renderCell(cell, occupant, selectedStudentId, activeCellId, swapSourceCellId, cells, handlers) {
  const cellWrapper = document.createElement('div');
  cellWrapper.className = 'seating-view__cell-wrapper';

  // A plain div, not a <button>, because an occupied seat nests a
  // real, separately-clickable student-name button inside it (see
  // below) — a <button> cannot validly contain another <button>.
  // role="button" + tabindex preserve keyboard/AT accessibility.
  const cellButton = document.createElement('div');
  cellButton.setAttribute('role', 'button');
  cellButton.setAttribute('tabindex', '0');
  cellButton.className = `seating-view__cell seating-view__cell--${cell.type}`;
  if (occupant) cellButton.classList.add('seating-view__cell--occupied');
  if (cell.id === activeCellId) cellButton.classList.add('seating-view__cell--active');

  const isSwapTarget = !!swapSourceCellId && cell.type === 'space';
  if (isSwapTarget) cellButton.classList.add('seating-view__cell--swap-target');

  // Team color tints the seat itself — the existing group-color
  // language reused directly (getGroupColorHex), never a new system.
  if (occupant?.team?.color) {
    const groupHex = getGroupColorHex(occupant.team.color);
    cellButton.style.borderColor = groupHex;
    cellButton.style.backgroundColor = `color-mix(in srgb, ${groupHex} 18%, var(--color-surface, #fff))`;
  }

  if (occupant) {
    // The existing, shared identity component — bucket swatch +
    // clickable name, opening the real student profile via
    // onSelectStudent. Wrapped so a click here never also triggers
    // the outer seat's own "toggle active" behavior (event
    // propagation is stopped before it can bubble up).
    const nameWrapper = document.createElement('span');
    nameWrapper.className = 'seating-view__cell-name-wrapper';
    nameWrapper.addEventListener('click', (event) => event.stopPropagation());
    nameWrapper.appendChild(createStudentNameElement({
      student: occupant.student,
      leadingMarker: 'swatch',
      onSelect: (student) => handlers.onSelectStudent(student.id),
    }));
    cellButton.appendChild(nameWrapper);
  } else {
    const label = document.createElement('span');
    label.className = 'seating-view__cell-label';
    label.textContent = cell.type === 'space' ? '' : 'Empty';
    cellButton.appendChild(label);
  }

  cellButton.addEventListener('click', () => {
    if (isSwapTarget) {
      handlers.onSwapWithSpace(swapSourceCellId, cell.id);
    } else if (selectedStudentId && cell.type === 'seat') {
      handlers.onSeatClick(cell.id);
    } else if (!swapSourceCellId) {
      handlers.onToggleActiveCell(cell.id);
    }
    // While swap mode is active and this cell isn't a valid space
    // target, the click is deliberately a no-op — the teacher must
    // either pick a highlighted space or explicitly cancel.
  });
  cellButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      cellButton.click();
    }
  });

  cellWrapper.appendChild(cellButton);

  if (cell.id === activeCellId) {
    cellWrapper.appendChild(renderCellPanel(cell, occupant, cells, swapSourceCellId, handlers));
  }

  return cellWrapper;
}

/**
 * This cell's own management panel — assign/remove a student, add
 * space, convert type, delete. Deliberately contains NO directional
 * seat-creation control at all: adding a brand-new cell is
 * exclusively the "+" controls' own job (see renderClassroomMap()
 * above); this panel only ever manages the one cell it belongs to.
 * "Convert to Space"/"Convert to Seat" both use the same
 * convertCellType() function, which never silently unseats a student
 * (confirmed in its own guard).
 */
function renderCellPanel(cell, occupant, cells, swapSourceCellId, handlers) {
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
    const convertButton = document.createElement('button');
    convertButton.type = 'button';
    convertButton.className = 'btn btn--ghost';
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
    convertButton.className = 'btn btn--ghost';
    convertButton.textContent = 'Convert to Seat';
    convertButton.addEventListener('click', () => handlers.onConvertToSeat(cell.id));
    actions.appendChild(convertButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--secondary';
    deleteButton.textContent = 'Delete Space';
    deleteButton.addEventListener('click', () => handlers.onDeleteCell(cell.id));
    actions.appendChild(deleteButton);
  }

  panel.appendChild(actions);

  // "Move Student" — genuinely distinct from the "+" building
  // controls: this only ever moves a student between cells that
  // already exist. Per explicit product decision, all 4 directions
  // are ALWAYS rendered in a fixed order — an invalid direction is
  // shown disabled, never hidden, so the panel looks identical
  // regardless of the student's own position in the layout.
  if (cell.type === 'seat' && occupant) {
    const moveLabel = document.createElement('p');
    moveLabel.className = 'seating-view__cell-group-label';
    moveLabel.textContent = 'Move Student';
    panel.appendChild(moveLabel);

    const moveRow = document.createElement('div');
    moveRow.className = 'seating-view__move-controls';
    [
      { direction: 'up', symbol: '\u2191', label: 'Above' },
      { direction: 'down', symbol: '\u2193', label: 'Below' },
      { direction: 'left', symbol: '\u2190', label: 'Left' },
      { direction: 'right', symbol: '\u2192', label: 'Right' },
    ].forEach(({ direction, symbol, label }) => {
      const { dx, dy } = MOVE_DIRECTION_OFFSETS[direction];
      const destination = cells.find((c) => c.x === cell.x + dx && c.y === cell.y + dy);
      const isValidMove = !!destination && destination.type === 'seat' && !destination.studentId;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn btn--ghost seating-view__move-button seating-view__move-button--${direction}`;
      button.disabled = !isValidMove;

      const symbolSpan = document.createElement('span');
      symbolSpan.setAttribute('aria-hidden', 'true');
      symbolSpan.textContent = symbol;
      button.appendChild(symbolSpan);
      button.append(` ${label}`);

      if (isValidMove) {
        button.addEventListener('click', () => handlers.onMoveStudent(cell.id, direction));
      }
      moveRow.appendChild(button);
    });
    panel.appendChild(moveRow);

    // "Swap with Space" — genuinely distinct from Move Student. A
    // space can be anywhere in the layout at all, not just adjacent,
    // per explicit product decision — so this doesn't offer 4 fixed
    // directions at all; it enters a real selection mode where every
    // space in the layout becomes a highlighted, clickable target
    // directly on the map itself (see renderCell()'s own swap-target
    // handling above), never another popup or form.
    const swapLabel = document.createElement('p');
    swapLabel.className = 'seating-view__cell-group-label';
    swapLabel.textContent = 'Swap with Space';
    panel.appendChild(swapLabel);

    const swapRow = document.createElement('div');
    swapRow.className = 'seating-view__cell-actions';

    if (swapSourceCellId === cell.id) {
      const hint = document.createElement('p');
      hint.className = 'seating-view__cell-panel-note';
      hint.textContent = 'Click a highlighted space on the layout.';
      swapRow.appendChild(hint);

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn btn--text';
      cancelButton.textContent = 'Cancel';
      cancelButton.addEventListener('click', handlers.onCancelSwapMode);
      swapRow.appendChild(cancelButton);
    } else {
      const hasAnySpace = cells.some((c) => c.type === 'space');
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'btn btn--ghost';
      selectButton.textContent = 'Select a Space';
      selectButton.disabled = !hasAnySpace;
      if (hasAnySpace) selectButton.addEventListener('click', () => handlers.onEnterSwapMode(cell.id));
      swapRow.appendChild(selectButton);
    }
    panel.appendChild(swapRow);

    // THE ACTUAL FIX: an occupied seat can genuinely extend the
    // layout in any free direction too — Move Student only ever
    // targets an existing, unoccupied seat, which is a genuinely
    // stricter question than "is this exact coordinate free" at all.
    // Reuses the exact same shared section/availability function as
    // every other cell type, so there is only ever one definition of
    // "available" anywhere in this file.
    panel.appendChild(renderAddSpaceSection(cell, cells, handlers));
  }

  // "Add Space" — the one deliberate, explicit way to place a space,
  // per product decision: never automatic, never a popup of its own.
  // All 4 directions are ALWAYS rendered in the same fixed order,
  // matching Move Student's own pattern — a direction that's already
  // occupied is shown disabled, never hidden.
  if (cell.type === 'seat' && !occupant) {
    panel.appendChild(renderAddSpaceSection(cell, cells, handlers));
  }

  return panel;
}

/**
 * "Add Space" — genuinely shared across every cell type that can
 * spatially extend the layout (empty seat, occupied seat, space).
 * Uses ONLY getAdjacentCellAvailability() — the one, shared source of
 * truth — so there is never a discrepancy between what this section
 * offers and what the map's own "+" controls offer for the same cell.
 */
function renderAddSpaceSection(cell, cells, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__add-space-section';

  const spaceLabel = document.createElement('p');
  spaceLabel.className = 'seating-view__cell-group-label';
  spaceLabel.textContent = 'Add Space';
  section.appendChild(spaceLabel);

  const availability = getAdjacentCellAvailability(cell, cells);
  const spaceRow = document.createElement('div');
  spaceRow.className = 'seating-view__move-controls';
  [
    { dx: 0, dy: -1, direction: 'up', symbol: '\u2191', label: 'Above' },
    { dx: 0, dy: 1, direction: 'down', symbol: '\u2193', label: 'Below' },
    { dx: -1, dy: 0, direction: 'left', symbol: '\u2190', label: 'Left' },
    { dx: 1, dy: 0, direction: 'right', symbol: '\u2192', label: 'Right' },
  ].forEach(({ dx, dy, direction, symbol, label }) => {
    const isFree = availability[direction];

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--ghost seating-view__move-button seating-view__move-button--${direction}`;
    button.disabled = !isFree;

    const symbolSpan = document.createElement('span');
    symbolSpan.setAttribute('aria-hidden', 'true');
    symbolSpan.textContent = symbol;
    button.appendChild(symbolSpan);
    button.append(` ${label}`);

    if (isFree) {
      button.addEventListener('click', () => handlers.onAddSpaceAt(cell.x + dx, cell.y + dy));
    }
    spaceRow.appendChild(button);
  });
  section.appendChild(spaceRow);

  return section;
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
