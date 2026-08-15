/**
 * ui/views/SeatingView.js
 *
 * Seating — a visual, individual-seat spatial grid editor. Per
 * explicit product correction: the fundamental layout unit is one
 * SEAT — never a bench, row, column, group, or table. A physical
 * 2-seater or 3-seater bench is simply represented as adjacent
 * individual seats; no bench object exists anywhere in this model.
 *
 * CANONICAL SHAPE: classroom.seatingConfig = { templateChosen, cells:
 * [{ id, x, y, type: 'seat' | 'space', studentId }] }. x/y are plain
 * spatial integers (can be negative). Unchanged from the two prior
 * rounds — only how a new cell gets ADDED changes this round.
 *
 * TWO GENUINELY SEPARATE INTERACTIONS, per explicit product decision:
 *   1. Clicking a SEAT/SPACE reveals that one cell's own "Manage this
 *      seat" actions (assign/remove a student, convert type, delete)
 *      — never adds a new cell.
 *   2. That same reveal also shows this cell's own directional "+"
 *      controls (up/down/left/right) — spatial expansion, genuinely
 *      distinct from seat management, visually separated within the
 *      same panel with its own "Expand" label. Only shown toward a
 *      position that's genuinely free, so overlapping cells are
 *      prevented structurally.
 *
 * REVERTED THIS ROUND (per explicit correction): the immediately
 * prior round moved directional "+" to the whole layout's own edges
 * (expanding an entire row/column at once). That's undone here —
 * every direction now adds exactly ONE seat-sized cell, uniformly
 * offering a Seat/Space choice on click (including top/bottom, which
 * the prior round instead auto-added a fixed Space+Seat pair for —
 * that fixed-pair behavior is also removed this round).
 *
 * TEMPLATES, unchanged from the prior round — every generator below
 * produces individual seat cells only, never a bench/group object.
 * Starting points only; every cell they produce is exactly as
 * editable afterward as one built by hand. Shown only for a
 * genuinely fresh classroom (see normalizeSeatingConfig() below) —
 * never for one with real, already-built data.
 *
 * MIGRATION, unchanged: an older rows/columns/gap-shaped classroom
 * (or either of the two shapes before that) converts losslessly into
 * real seat cells, assignment preserved, templateChosen set true
 * immediately (real, already-built data never shows the picker).
 *
 * ROOT-CAUSE ROUTING FIX, unchanged: registers with
 * services/workspaceCoordinator.js so a background Firestore
 * snapshot updates this screen in place instead of ever falling
 * through to renderRoute()/Dashboard. Every button is explicitly
 * type="button"; nothing is wrapped in a <form>.
 *
 * Local viewport preservation, unchanged: every rerender() captures/
 * restores document.scrollingElement's own scrollTop/scrollLeft.
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
  let activeCellId = null; // the one cell whose own reveal (Expand + Manage) is open, or null
  let pendingDirectionChoice = null; // { cellId, direction } while awaiting the teacher's Seat/Space choice, or null

  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, resyncFromServer);

  function resyncFromServer(freshClassroom) {
    normalizeSeatingConfig(freshClassroom);
    currentClassroom = freshClassroom;
    rerender();
  }

  function rerender() {
    const scrollTop = document.scrollingElement?.scrollTop ?? 0;
    const scrollLeft = document.scrollingElement?.scrollLeft ?? 0;

    render(container, currentClassroom, selectedStudentId, activeCellId, pendingDirectionChoice, {
      onBack: () => {
        workspaceCoordinator.unregisterActiveWorkspace(currentClassroom.id);
        onBack();
      },
      onChooseTemplate: (templateId) => {
        applyTemplate(currentClassroom, templateId);
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
        pendingDirectionChoice = null;
        rerender();
      },
      onOpenDirectionChoice: (cellId, direction) => {
        pendingDirectionChoice = { cellId, direction };
        rerender();
      },
      onCancelDirectionChoice: () => {
        pendingDirectionChoice = null;
        rerender();
      },
      onChooseDirectionType: (cellId, direction, type) => {
        addSingleCellInDirection(currentClassroom, cellId, direction, type);
        pendingDirectionChoice = null;
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

const DIRECTION_OFFSETS = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };

/**
 * The reverted, per-seat behavior: exactly ONE new cell, of whichever
 * type the teacher chose, uniformly for all four directions
 * (including up/down, which the prior round instead auto-added a
 * fixed Space+Seat pair for — that's removed now). Still enforces
 * "no overlapping cells": if the target is already occupied, this is
 * a genuine no-op — the UI itself already never offers this direction
 * once occupied (see renderCellPanel() below).
 */
function addSingleCellInDirection(classroom, fromCellId, direction, type) {
  const fromCell = getCellById(classroom, fromCellId);
  if (!fromCell) return;

  const { dx, dy } = DIRECTION_OFFSETS[direction];
  const targetX = fromCell.x + dx;
  const targetY = fromCell.y + dy;

  if (getCellAt(classroom, targetX, targetY)) return; // already occupied — no-op, never overwritten

  classroom.seatingConfig.cells.push({ id: generateId(), x: targetX, y: targetY, type, studentId: null });
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

function render(container, classroom, selectedStudentId, activeCellId, pendingDirectionChoice, handlers) {
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
  layout.appendChild(renderClassroomMap(classroom, allStudents, selectedStudentId, activeCellId, pendingDirectionChoice, handlers));
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
function renderClassroomMap(classroom, allStudents, selectedStudentId, activeCellId, pendingDirectionChoice, handlers) {
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
  map.style.gridTemplateColumns = `repeat(${columnCount}, var(--seating-cell-size))`;
  map.style.gridTemplateRows = `repeat(${rowCount}, var(--seating-cell-size))`;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const cell = cells.find((c) => c.x === x && c.y === y);
      const slot = document.createElement('div');
      slot.className = 'seating-view__cell-slot';
      slot.style.gridColumn = String(x - minX + 1);
      slot.style.gridRow = String(y - minY + 1);
      if (cell) {
        const occupant = cell.studentId ? allStudents.find(({ student }) => student.id === cell.studentId) : null;
        slot.appendChild(renderCell(cell, occupant, selectedStudentId, activeCellId, pendingDirectionChoice, cells, handlers));
      }
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

/**
 * A single seat/space cell. Clicking it only ever toggles its own
 * reveal (Expand + Manage) — it never itself adds a new cell at all.
 */
function renderCell(cell, occupant, selectedStudentId, activeCellId, pendingDirectionChoice, allCells, handlers) {
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
    cellWrapper.appendChild(renderCellPanel(cell, occupant, pendingDirectionChoice, allCells, handlers));
  }

  return cellWrapper;
}

/**
 * This cell's own reveal — genuinely two separate groups, per
 * explicit product decision: "Expand" (directional +, spatial growth)
 * and "Manage this seat" (assign/remove/convert/delete), visually
 * separated so the teacher never confuses growing the layout with
 * editing this one seat. Only revealed when this cell is active —
 * never a permanent fixture around every seat at all.
 */
function renderCellPanel(cell, occupant, pendingDirectionChoice, allCells, handlers) {
  const panel = document.createElement('div');
  panel.className = 'seating-view__cell-panel';

  const heading = document.createElement('p');
  heading.className = 'seating-view__cell-panel-heading';
  heading.textContent = cell.type === 'space' ? 'Space' : occupant ? occupant.student.name : 'Empty seat';
  panel.appendChild(heading);

  const isPendingHere = pendingDirectionChoice?.cellId === cell.id;

  const expandLabel = document.createElement('p');
  expandLabel.className = 'seating-view__cell-group-label';
  expandLabel.textContent = 'Expand';
  panel.appendChild(expandLabel);

  if (isPendingHere) {
    const choiceRow = document.createElement('div');
    choiceRow.className = 'seating-view__cell-directions';

    const seatChoiceButton = document.createElement('button');
    seatChoiceButton.type = 'button';
    seatChoiceButton.className = 'btn btn--secondary seating-view__cell-direction-button';
    seatChoiceButton.textContent = 'Seat';
    seatChoiceButton.addEventListener('click', () => handlers.onChooseDirectionType(cell.id, pendingDirectionChoice.direction, 'seat'));
    choiceRow.appendChild(seatChoiceButton);

    const spaceChoiceButton = document.createElement('button');
    spaceChoiceButton.type = 'button';
    spaceChoiceButton.className = 'btn btn--ghost seating-view__cell-direction-button';
    spaceChoiceButton.textContent = 'Space';
    spaceChoiceButton.addEventListener('click', () => handlers.onChooseDirectionType(cell.id, pendingDirectionChoice.direction, 'space'));
    choiceRow.appendChild(spaceChoiceButton);

    const cancelChoiceButton = document.createElement('button');
    cancelChoiceButton.type = 'button';
    cancelChoiceButton.className = 'btn btn--text';
    cancelChoiceButton.textContent = 'Cancel';
    cancelChoiceButton.addEventListener('click', handlers.onCancelDirectionChoice);
    choiceRow.appendChild(cancelChoiceButton);

    panel.appendChild(choiceRow);
  } else {
    const directions = document.createElement('div');
    directions.className = 'seating-view__cell-directions';
    [
      { direction: 'up', label: '\u2191' },
      { direction: 'down', label: '\u2193' },
      { direction: 'left', label: '\u2190' },
      { direction: 'right', label: '\u2192' },
    ].forEach(({ direction, label }) => {
      const { dx, dy } = DIRECTION_OFFSETS[direction];
      const targetOccupied = allCells.some((c) => c.x === cell.x + dx && c.y === cell.y + dy);
      if (targetOccupied) return; // never offered toward an already-occupied position at all
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--ghost seating-view__cell-direction-button';
      button.textContent = label;
      button.setAttribute('aria-label', `Add a seat ${direction === 'up' ? 'above' : direction === 'down' ? 'below' : direction === 'left' ? 'to the left' : 'to the right'}`);
      button.addEventListener('click', () => handlers.onOpenDirectionChoice(cell.id, direction));
      directions.appendChild(button);
    });
    panel.appendChild(directions);
  }

  const manageLabel = document.createElement('p');
  manageLabel.className = 'seating-view__cell-group-label';
  manageLabel.textContent = 'Manage this seat';
  panel.appendChild(manageLabel);

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
    blockedNote.textContent = 'Remove the student first to convert or delete this seat.';
    actions.appendChild(blockedNote);
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
