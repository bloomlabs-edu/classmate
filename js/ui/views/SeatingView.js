/**
 * ui/views/SeatingView.js
 *
 * Seating — a visual classroom layout builder, refined per explicit
 * product decision into two genuinely separate interactions:
 *
 *   1. Clicking a SEAT/SPACE manages that one cell (assign/remove a
 *      student, convert type, delete) — never adds a new cell.
 *   2. Edge "+" controls (top/bottom/left/right of the whole
 *      layout's own bounding box) expand the classroom — a full new
 *      row or column at once, never tied to one specific clicked
 *      cell. This is the actual fix for "don't show + around every
 *      internal seat" — edge controls exist once per side of the
 *      overall layout, not per cell at all.
 *
 * CANONICAL SHAPE: classroom.seatingConfig = { templateChosen, cells:
 * [{ id, x, y, type: 'seat' | 'space', studentId }] }. x/y are plain
 * spatial integers (can be negative). templateChosen is new this
 * round — see chooseTemplate()/normalizeSeatingConfig() below for
 * exactly when the template picker shows and why it's safe against
 * any real, already-built layout.
 *
 * TEMPLATES are starting points only, never a locked mode — picking
 * one just generates an initial cells[] array (see the
 * TEMPLATE_GENERATORS map below); every cell it produces is exactly
 * as editable afterward as one the teacher built by hand.
 *
 * MIGRATION, unchanged from prior rounds: a classroom already holding
 * the older rows/columns/gap shape (or either of the two shapes
 * before that) is converted losslessly here — every existing seat
 * becomes a real "seat" cell at its own position, assignment
 * preserved, and templateChosen is set true immediately (this is
 * real, already-built data — it must never show the "choose a
 * starting layout" picker at all).
 *
 * A brand-new classroom (no seatingConfig at all) starts with
 * templateChosen: false and exactly one seat at (0, 0) as its
 * pre-template default — the picker itself is what a teacher sees
 * first in that case (see render() below).
 *
 * Reuses classroom.teams[].students[] directly — no second
 * student/classroom model.
 *
 * ROOT-CAUSE ROUTING FIX, carried over unchanged: this view registers
 * with services/workspaceCoordinator.js (mirroring
 * ui/views/LearningManagementView.js's own established pattern), so
 * a background Firestore snapshot updates this screen in place
 * instead of ever falling through to renderRoute()/Dashboard. Every
 * button here is explicitly type="button"; nothing is wrapped in a
 * <form>.
 *
 * Local viewport preservation, carried over unchanged: every
 * rerender() captures/restores document.scrollingElement's own
 * scrollTop/scrollLeft.
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
  let activeCellId = null; // the one seat/space cell whose own management menu is open, or null
  let pendingColumnChoice = null; // 'left' | 'right' | null, while awaiting the teacher's Seat/Space choice for a new column

  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, resyncFromServer);

  function resyncFromServer(freshClassroom) {
    normalizeSeatingConfig(freshClassroom);
    currentClassroom = freshClassroom;
    rerender();
  }

  function rerender() {
    const scrollTop = document.scrollingElement?.scrollTop ?? 0;
    const scrollLeft = document.scrollingElement?.scrollLeft ?? 0;

    render(container, currentClassroom, selectedStudentId, activeCellId, pendingColumnChoice, {
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
      onExpandTop: () => {
        expandVertical(currentClassroom, 'top');
        workspaceService.save(currentClassroom);
        rerender();
      },
      onExpandBottom: () => {
        expandVertical(currentClassroom, 'bottom');
        workspaceService.save(currentClassroom);
        rerender();
      },
      onOpenColumnChoice: (direction) => {
        pendingColumnChoice = direction;
        rerender();
      },
      onCancelColumnChoice: () => {
        pendingColumnChoice = null;
        rerender();
      },
      onChooseColumnType: (type) => {
        expandHorizontal(currentClassroom, pendingColumnChoice, type);
        pendingColumnChoice = null;
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
  { id: 'discussion', label: 'Discussion' },
  { id: 'u-shape', label: 'U-Shape' },
  { id: 'circle', label: 'Circle' },
  { id: 'flexible', label: 'Flexible' },
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

function generateDiscussionTemplate(studentCount) {
  const perSide = Math.max(1, Math.ceil(Math.max(studentCount, 1) / 2));
  const cells = [];
  for (let x = 0; x < perSide; x += 1) cells.push(seat(x, 0));
  for (let x = 0; x < perSide; x += 1) cells.push(space(x, 1));
  for (let x = 0; x < perSide; x += 1) cells.push(seat(x, 2));
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

function generateFlexibleTemplate() {
  return [seat(0, 0)];
}

function generateCustomTemplate() {
  return [seat(0, 0)];
}

const TEMPLATE_GENERATORS = {
  rows: generateRowsTemplate,
  pairs: generatePairsTemplate,
  groups: generateGroupsTemplate,
  discussion: generateDiscussionTemplate,
  'u-shape': generateUShapeTemplate,
  circle: generateCircleTemplate,
  flexible: generateFlexibleTemplate,
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

function getBounds(cells) {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function expandVertical(classroom, direction) {
  const cells = classroom.seatingConfig.cells;
  const { minX, maxX, minY, maxY } = getBounds(cells);
  const seatY = direction === 'top' ? minY - 1 : maxY + 1;
  const spaceY = direction === 'top' ? minY - 2 : maxY + 2;

  for (let x = minX; x <= maxX; x += 1) {
    cells.push(seat(x, seatY));
    cells.push(space(x, spaceY));
  }
}

function expandHorizontal(classroom, direction, type) {
  const cells = classroom.seatingConfig.cells;
  const { minX, maxX, minY, maxY } = getBounds(cells);
  const targetX = direction === 'left' ? minX - 1 : maxX + 1;

  for (let y = minY; y <= maxY; y += 1) {
    cells.push(type === 'space' ? space(targetX, y) : seat(targetX, y));
  }
}

function convertCellType(classroom, cellId, newType) {
  const cell = getCellById(classroom, cellId);
  if (!cell) return;
  if (newType === 'space' && cell.studentId) return;
  cell.type = newType;
  if (newType === 'space') cell.studentId = null;
}

function setCellStudent(classroom, cellId, studentId) {
  const cell = getCellById(classroom, cellId);
  if (!cell || cell.type !== 'seat') return;
  cell.studentId = studentId;
}

function deleteCell(classroom, cellId) {
  const cell = getCellById(classroom, cellId);
  if (!cell || cell.studentId) return;
  classroom.seatingConfig.cells = classroom.seatingConfig.cells.filter((c) => c.id !== cellId);
}

function assignStudentToSeat(classroom, targetCellId, selectedStudentId) {
  if (!selectedStudentId) return;
  const targetCell = getCellById(classroom, targetCellId);
  if (!targetCell || targetCell.type !== 'seat') return;

  const previousCell = classroom.seatingConfig.cells.find((cell) => cell.studentId === selectedStudentId) ?? null;
  if (previousCell && previousCell.id === targetCellId) return;

  const displacedStudentId = targetCell.studentId ?? null;
  targetCell.studentId = selectedStudentId;

  if (previousCell) {
    previousCell.studentId = displacedStudentId;
  }
}

function render(container, classroom, selectedStudentId, activeCellId, pendingColumnChoice, handlers) {
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
  layout.appendChild(renderClassroomMap(classroom, allStudents, selectedStudentId, activeCellId, pendingColumnChoice, handlers));
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

function renderClassroomMap(classroom, allStudents, selectedStudentId, activeCellId, pendingColumnChoice, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__room';

  const board = document.createElement('div');
  board.className = 'seating-view__board';
  board.textContent = 'BOARD';
  section.appendChild(board);

  section.appendChild(renderVerticalEdgeControl('top', handlers));

  const cells = classroom.seatingConfig.cells;
  const { minX, maxX, minY, maxY } = getBounds(cells);
  const columnCount = maxX - minX + 1;
  const rowCount = maxY - minY + 1;

  const mapRow = document.createElement('div');
  mapRow.className = 'seating-view__map-row';

  mapRow.appendChild(renderHorizontalEdgeControl('left', pendingColumnChoice, handlers));

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
        slot.appendChild(renderCell(cell, occupant, selectedStudentId, activeCellId, handlers));
      }
      map.appendChild(slot);
    }
  }
  mapRow.appendChild(map);

  mapRow.appendChild(renderHorizontalEdgeControl('right', pendingColumnChoice, handlers));
  section.appendChild(mapRow);

  section.appendChild(renderVerticalEdgeControl('bottom', handlers));

  const teacherLabel = document.createElement('div');
  teacherLabel.className = 'seating-view__teacher-label';
  teacherLabel.textContent = 'TEACHER';
  section.appendChild(teacherLabel);

  return section;
}

function renderVerticalEdgeControl(direction, handlers) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `seating-view__edge-control seating-view__edge-control--${direction}`;
  button.setAttribute('aria-label', direction === 'top' ? 'Expand classroom upward' : 'Expand classroom downward');
  button.textContent = '+';
  button.addEventListener('click', direction === 'top' ? handlers.onExpandTop : handlers.onExpandBottom);
  return button;
}

function renderHorizontalEdgeControl(direction, pendingColumnChoice, handlers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'seating-view__edge-control-wrapper';

  if (pendingColumnChoice === direction) {
    const seatChoice = document.createElement('button');
    seatChoice.type = 'button';
    seatChoice.className = 'btn btn--secondary seating-view__edge-choice-button';
    seatChoice.textContent = 'Seat';
    seatChoice.addEventListener('click', () => handlers.onChooseColumnType('seat'));

    const spaceChoice = document.createElement('button');
    spaceChoice.type = 'button';
    spaceChoice.className = 'btn btn--ghost seating-view__edge-choice-button';
    spaceChoice.textContent = 'Space';
    spaceChoice.addEventListener('click', () => handlers.onChooseColumnType('space'));

    const cancelChoice = document.createElement('button');
    cancelChoice.type = 'button';
    cancelChoice.className = 'btn btn--text';
    cancelChoice.textContent = '\u2715';
    cancelChoice.setAttribute('aria-label', 'Cancel');
    cancelChoice.addEventListener('click', handlers.onCancelColumnChoice);

    wrapper.append(seatChoice, spaceChoice, cancelChoice);
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `seating-view__edge-control seating-view__edge-control--${direction}`;
    button.setAttribute('aria-label', direction === 'left' ? 'Expand classroom to the left' : 'Expand classroom to the right');
    button.textContent = '+';
    button.addEventListener('click', () => handlers.onOpenColumnChoice(direction));
    wrapper.appendChild(button);
  }

  return wrapper;
}

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
    cellWrapper.appendChild(renderCellMenu(cell, occupant, handlers));
  }

  return cellWrapper;
}

function renderCellMenu(cell, occupant, handlers) {
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
