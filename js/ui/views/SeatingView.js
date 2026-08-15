/**
 * ui/views/SeatingView.js
 *
 * Seating — a visual, individual-seat spatial grid editor. The
 * fundamental layout unit is one SEAT — never a bench, row, column,
 * group, or table. A physical 2-seater or 3-seater bench is simply
 * represented as adjacent individual seats; no bench object exists
 * anywhere in this model.
 *
 * CANONICAL SHAPE, unchanged: classroom.seatingConfig = {
 * templateChosen, cells: [{ id, x, y, type: 'seat' | 'space',
 * studentId }] }. x/y are plain spatial integers (can be negative).
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
 * delete) — it can never add a new cell. "Convert to Space" is
 * intentionally not exposed anywhere in this round's UI at all — the
 * underlying type field and convertCellType() are both untouched and
 * still present, simply unused by any control for now, per explicit
 * "we can revisit intentional spaces/aisles later."
 *
 * TEMPLATES, MIGRATION, ROUTING FIX, and VIEWPORT PRESERVATION are
 * all unchanged from prior rounds — this correction only touches how
 * a new cell gets added and what a clicked cell's own panel contains.
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
  let activeCellId = null; // the one seat/space cell whose own management-only panel is open, or null

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
      onChooseTemplate: (templateId) => {
        applyTemplate(currentClassroom, templateId);
        activeCellId = currentClassroom.seatingConfig.cells.length === 1 ? currentClassroom.seatingConfig.cells[0].id : null;
        workspaceService.save(currentClassroom);
        rerender();
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
      onRemoveStudent: (cellId) => {
        setCellStudent(currentClassroom, cellId, null);
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

function normalizeSeatingConfig(classroom) {
  const existing = classroom.seatingConfig;

  if (!existing) {
    classroom.seatingConfig = { templateChosen: false, cells: [{ id: generateId(), x: 0, y: 0, type: 'seat', studentId: null }] };
    return;
  }

  if (Array.isArray(existing.cells)) {
    if (typeof existing.templateChosen !== 'boolean') {
      existing.templateChosen = existing.cells.length > 1;
    }
    return;
  }

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
  classroom.seatingConfig = { templateChosen: true, cells };
}

const TEMPLATES = [
  { id: 'rows', label: 'Rows' },
  { id: 'pairs', label: 'Pairs' },
  { id: 'groups', label: 'Groups' },
  { id: 'u-shape', label: 'U-Shape' },
  { id: 'circle', label: 'Circle' },
  { id: 'custom', label: 'Custom' },
];

function seat(x, y, studentId = null) {
  return { id: generateId(), x, y, type: 'seat', studentId };
}
function space(x, y) {
  return { id: generateId(), x, y, type: 'space' };
}

function generateRowsTemplate(studentCount) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(studentCount, 1))));
  const rows = Math.max(1, Math.ceil(Math.max(studentCount, 1) / columns));
  const cells = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      cells.push(seat(x, y));
    }
  }
  return cells;
}

function generatePairsTemplate(studentCount) {
  const pairCount = Math.max(1, Math.ceil(Math.max(studentCount, 1) / 2));
  const pairsPerRow = Math.max(1, Math.ceil(Math.sqrt(pairCount)));
  const cells = [];
  let pairIndex = 0;
  for (let row = 0; pairIndex < pairCount; row += 1) {
    for (let col = 0; col < pairsPerRow && pairIndex < pairCount; col += 1, pairIndex += 1) {
      const baseX = col * 3;
      cells.push(seat(baseX, row));
      cells.push(seat(baseX + 1, row));
      if (col < pairsPerRow - 1) cells.push(space(baseX + 2, row));
    }
  }
  return cells;
}

function generateGroupsTemplate(studentCount) {
  const groupCount = Math.max(1, Math.ceil(Math.max(studentCount, 1) / 4));
  const groupsPerRow = Math.max(1, Math.ceil(Math.sqrt(groupCount)));
  const cells = [];
  let groupIndex = 0;
  for (let gr = 0; groupIndex < groupCount; gr += 1) {
    for (let gc = 0; gc < groupsPerRow && groupIndex < groupCount; gc += 1, groupIndex += 1) {
      const baseX = gc * 3;
      const baseY = gr * 3;
      cells.push(seat(baseX, baseY), seat(baseX + 1, baseY), seat(baseX, baseY + 1), seat(baseX + 1, baseY + 1));
    }
  }
  return cells;
}

function generateUShapeTemplate(studentCount) {
  const sideLength = Math.max(2, Math.ceil(Math.max(studentCount, 1) / 3));
  const cells = [];
  const positions = new Set();
  const add = (x, y) => {
    const key = `${x},${y}`;
    if (positions.has(key)) return;
    positions.add(key);
    cells.push(seat(x, y));
  };
  for (let x = 0; x < sideLength; x += 1) add(x, 0);
  for (let y = 1; y < sideLength; y += 1) { add(0, y); add(sideLength - 1, y); }
  return cells;
}

function generateCircleTemplate(studentCount) {
  const count = Math.max(4, studentCount || 8);
  const radius = Math.max(2, Math.round(count / 6));
  const cells = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    const x = Math.round(radius * Math.cos(angle));
    const y = Math.round(radius * Math.sin(angle));
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(seat(x, y));
  }
  return cells;
}

function generateCustomTemplate() {
  return [seat(0, 0)];
}

const TEMPLATE_GENERATORS = {
  rows: generateRowsTemplate,
  pairs: generatePairsTemplate,
  groups: generateGroupsTemplate,
  'u-shape': generateUShapeTemplate,
  circle: generateCircleTemplate,
  custom: generateCustomTemplate,
};

function applyTemplate(classroom, templateId) {
  const studentCount = classroom.teams.flatMap((team) => team.students).length;
  const generator = TEMPLATE_GENERATORS[templateId] ?? generateCustomTemplate;
  classroom.seatingConfig.cells = generator(studentCount);
  classroom.seatingConfig.templateChosen = true;
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

  if (!classroom.seatingConfig.templateChosen) {
    wrapper.appendChild(renderTemplatePicker(handlers));
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

function renderTemplatePicker(handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__template-picker';

  const heading = document.createElement('h2');
  heading.className = 'seating-view__template-heading';
  heading.textContent = 'Choose a starting layout';

  const subheading = document.createElement('p');
  subheading.className = 'seating-view__template-subheading';
  subheading.textContent = 'You can change anything after picking \u2014 this is only a starting point.';

  section.append(heading, subheading);

  const grid = document.createElement('div');
  grid.className = 'seating-view__template-grid';
  TEMPLATES.forEach(({ id, label }) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'seating-view__template-card';
    card.textContent = label;
    card.addEventListener('click', () => handlers.onChooseTemplate(id));
    grid.appendChild(card);
  });
  section.appendChild(grid);

  return section;
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
        slot.appendChild(renderCell(cell, occupant, selectedStudentId, activeCellId, handlers));
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
function renderCell(cell, occupant, selectedStudentId, activeCellId, handlers) {
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
    cellWrapper.appendChild(renderCellPanel(cell, occupant, handlers));
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
function renderCellPanel(cell, occupant, handlers) {
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

    const blockedNote = document.createElement('p');
    blockedNote.className = 'seating-view__cell-panel-note';
    blockedNote.textContent = 'Remove the student first to delete this seat.';
    actions.appendChild(blockedNote);
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
