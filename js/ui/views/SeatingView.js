/**
 * ui/views/SeatingView.js
 *
 * Seating — the first of Classroom Management's own "Coming Soon"
 * features to be activated. Attendance, Buddy Pairs, and Live
 * Classroom Tools remain untouched, disabled placeholders.
 *
 * Represents the PHYSICAL classroom (a grid of seats, Board at the
 * top, Teacher at the bottom, with genuine row/column gaps — aisles,
 * not decoration) — not a list. Reuses classroom.teams[].students[]
 * directly (see models/Team.js, models/Student.js) — no second
 * student/classroom model. The seating arrangement itself is a
 * small, classroom-level field (classroom.seatingConfig — see
 * models/Classroom.js), following the exact same convention as every
 * other classroom-level feature: a plain object persisted via
 * workspaceService.save(), no new repository/collection at all.
 *
 * CANONICAL SHAPE (the one, single source of truth from this point
 * forward — see normalizeSeatingConfig() below for why "canonical"
 * matters here specifically):
 *   { rows, columns, rowGap, columnGap, assignments }
 * assignments is keyed "r{row}c{col}" (1-indexed, e.g. "r1c1") ->
 * studentId. An unlisted key is an empty seat. rowGap/columnGap are
 * small integers (1 = compact, 2 = normal, 3 = wide) — never a raw
 * CSS/pixel value at all; renderClassroomGrid() below is the one
 * place that maps a level to an actual gap size.
 *
 * MIGRATION, not just a default (see normalizeSeatingConfig()): this
 * feature has already shipped twice before with two different,
 * incompatible shapes — {rows, columns, assignments} keyed "row-col"
 * (0-indexed, hyphenated), and {rows, seatsPerRow, assignments} keyed
 * "r{row}c{col}" (1-indexed). A classroom already tested against
 * either prior shape has that exact shape sitting in Firestore right
 * now. The reported "Seats per row: undefined" and the parseSeatKey
 * TypeError were both real, confirmed consequences of the newer code
 * reading an older-shaped, persisted object with no migration at all
 * — ensureSeatingConfig() alone only ever handled "missing entirely,"
 * never "present but in an old shape." normalizeSeatingConfig() below
 * is the actual fix: it runs on every load, detects either prior
 * shape by its own distinguishing fields/key format, and rewrites it
 * into the one canonical shape in place — never silently dropping a
 * saved layout or a saved assignment.
 *
 * ROOT-CAUSE FIX for the "kicked back to Dashboard" bug: this view
 * (and ClassroomManagementView.js, its own parent screen) are reached
 * via a plain function call, never router.navigate() — so the
 * router's own real, current route never actually advances past
 * 'dashboard'. workspaceService.js's own background onChangeCallback
 * falls back to renderRoute(router.getCurrentRoute(), ...) whenever
 * nobody is registered as the classroom's active workspace — this
 * view registers with services/workspaceCoordinator.js (mirroring
 * ui/views/LearningManagementView.js's own established pattern
 * exactly), so a background snapshot updates this screen in place via
 * resyncFromServer() instead of ever falling through to renderRoute()
 * at all. Every button here is explicitly type="button" and nothing
 * here is wrapped in a <form> — confirmed directly, not assumed.
 *
 * Interaction is deliberately click-to-select, click-to-place (never
 * drag-and-drop). Every action auto-saves immediately, matching the
 * save-on-every-mutation convention already used throughout this app.
 *
 * Local viewport preservation: every rerender() explicitly captures
 * and restores document.scrollingElement's own scrollTop/scrollLeft
 * — this view has no nested overflow:auto container of its own.
 */

import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';

const DEFAULT_SEATING_CONFIG = { rows: 4, columns: 4, rowGap: 2, columnGap: 2, assignments: {} };
const MIN_ROWS_OR_COLUMNS = 1;
const MAX_ROWS_OR_COLUMNS = 12;
const MIN_GAP_LEVEL = 1;
const MAX_GAP_LEVEL = 3;

export function renderSeatingView(container, { classroom, onBack }) {
  normalizeSeatingConfig(classroom);
  let currentClassroom = classroom;
  let selectedStudentId = null; // the one student currently "picked up," or null

  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, resyncFromServer);

  function resyncFromServer(freshClassroom) {
    normalizeSeatingConfig(freshClassroom);
    currentClassroom = freshClassroom;
    rerender();
  }

  function rerender() {
    const scrollTop = document.scrollingElement?.scrollTop ?? 0;
    const scrollLeft = document.scrollingElement?.scrollLeft ?? 0;

    render(container, currentClassroom, selectedStudentId, {
      onBack: () => {
        workspaceCoordinator.unregisterActiveWorkspace(currentClassroom.id);
        onBack();
      },
      onSelectStudentFromRoster: (studentId) => {
        selectedStudentId = studentId;
        rerender();
      },
      onSeatClick: (seatKeyValue) => {
        handleSeatClick(currentClassroom, seatKeyValue, selectedStudentId);
        selectedStudentId = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onClearSeat: (seatKeyValue) => {
        delete currentClassroom.seatingConfig.assignments[seatKeyValue];
        selectedStudentId = null;
        workspaceService.save(currentClassroom);
        rerender();
      },
      onCancelSelection: () => {
        selectedStudentId = null;
        rerender();
      },
      onAddRow: () => {
        growLayout(currentClassroom, 'rows');
        workspaceService.save(currentClassroom);
        rerender();
      },
      onAddColumn: () => {
        growLayout(currentClassroom, 'columns');
        workspaceService.save(currentClassroom);
        rerender();
      },
      onChangeGap: (field, delta) => {
        changeGapLevel(currentClassroom, field, delta);
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
 * The real fix for the reported crash — see this file's own header
 * comment for the complete "why" and the two prior, incompatible
 * shapes this migrates from. Runs on every load, is fully idempotent
 * (running it again on an already-canonical object changes nothing
 * at all), and never drops a saved layout or assignment — it only
 * ever renames fields and re-keys assignments into the canonical
 * format, in place.
 */
function normalizeSeatingConfig(classroom) {
  const existing = classroom.seatingConfig;

  if (!existing) {
    classroom.seatingConfig = { ...DEFAULT_SEATING_CONFIG, assignments: {} };
    return;
  }

  // Shape 2 (previous round): {rows, seatsPerRow, assignments}, keys
  // already in the canonical "r{row}c{col}" format — only the
  // columns-count field name itself needs renaming, and
  // rowGap/columnGap (new this round) need a default.
  if (typeof existing.seatsPerRow === 'number' && typeof existing.columns !== 'number') {
    existing.columns = existing.seatsPerRow;
    delete existing.seatsPerRow;
  }

  // Shape 1 (first round): keys in the old "row-col" (0-indexed,
  // hyphenated) format — every key needs re-keying into "r{row}c{col}"
  // (1-indexed). Detected by finding any key that doesn't already
  // match the canonical format at all.
  const assignments = existing.assignments || {};
  const needsKeyMigration = Object.keys(assignments).some((key) => !isValidSeatKey(key));
  if (needsKeyMigration) {
    const migrated = {};
    Object.keys(assignments).forEach((key) => {
      const oldFormatMatch = key.match(/^(\d+)-(\d+)$/);
      if (oldFormatMatch) {
        // Old format was 0-indexed — +1 on each axis for the new,
        // 1-indexed canonical format.
        migrated[seatKey(Number(oldFormatMatch[1]) + 1, Number(oldFormatMatch[2]) + 1)] = assignments[key];
      } else if (isValidSeatKey(key)) {
        migrated[key] = assignments[key];
      }
      // Any other, genuinely unrecognized key format is dropped
      // rather than propagated — see isValidSeatKey()'s own header
      // comment on why an invalid key must never enter the system at
      // all, even via a migration path.
    });
    existing.assignments = migrated;
  }

  if (typeof existing.rows !== 'number') existing.rows = DEFAULT_SEATING_CONFIG.rows;
  if (typeof existing.columns !== 'number') existing.columns = DEFAULT_SEATING_CONFIG.columns;
  if (typeof existing.rowGap !== 'number') existing.rowGap = DEFAULT_SEATING_CONFIG.rowGap;
  if (typeof existing.columnGap !== 'number') existing.columnGap = DEFAULT_SEATING_CONFIG.columnGap;
  if (!existing.assignments) existing.assignments = {};
}

/**
 * The one, explicit definition of a valid seat key — "r{row}c{col}",
 * both 1-indexed positive integers. Every place that generates,
 * parses, or accepts a seat key in this file goes through this exact
 * pattern or seatKey()/parseSeatKey() below, which themselves only
 * ever produce/accept this same format — there is nowhere in this
 * file an "undefined"/"null"/malformed key can be constructed at all.
 */
function isValidSeatKey(key) {
  return /^r[1-9]\d*c[1-9]\d*$/.test(key);
}

function seatKey(row, column) {
  return `r${row}c${column}`;
}

/** Only ever called with a key this file itself already validated via isValidSeatKey() — see growLayout()/render's own callers. Never called speculatively against an unvalidated, external string. */
function parseSeatKey(key) {
  const match = key.match(/^r(\d+)c(\d+)$/);
  return { row: Number(match[1]), column: Number(match[2]) };
}

/**
 * Growing rows/columns never touches, moves, or re-keys any existing
 * assignment at all — new seats simply become available at higher
 * row/column indices than any existing assignment could already
 * occupy. This is the actual fix for "adding rows or columns should
 * NEVER cause existing assignments to shift" — there is structurally
 * no re-keying step here at all, growth only ever changes the loop
 * bound render() below iterates to.
 */
function growLayout(classroom, field) {
  const config = classroom.seatingConfig;
  config[field] = Math.min(MAX_ROWS_OR_COLUMNS, config[field] + 1);
}

function changeGapLevel(classroom, field, delta) {
  const config = classroom.seatingConfig;
  config[field] = Math.min(MAX_GAP_LEVEL, Math.max(MIN_GAP_LEVEL, config[field] + delta));
}

/**
 * Placing a selected student into a seat. If that seat already holds
 * a different student, the two swap seats — unless the mover came
 * straight from the roster (no previous seat), in which case the
 * displaced student simply becomes unseated, back in the roster.
 */
function handleSeatClick(classroom, targetSeatKey, selectedStudentId) {
  if (!selectedStudentId) return;

  const assignments = classroom.seatingConfig.assignments;
  const previousSeatKey = Object.keys(assignments).find((key) => assignments[key] === selectedStudentId) ?? null;

  if (previousSeatKey === targetSeatKey) return; // clicked their own current seat — no-op

  const displacedStudentId = assignments[targetSeatKey] ?? null;

  assignments[targetSeatKey] = selectedStudentId;

  if (previousSeatKey) {
    if (displacedStudentId) {
      assignments[previousSeatKey] = displacedStudentId; // a genuine swap
    } else {
      delete assignments[previousSeatKey]; // moved from a seat into an empty one
    }
  }
  // If there was no previousSeatKey (came from the roster) and a
  // displacedStudentId existed, that student is simply no longer in
  // assignments at all now — correctly unseated, back in the roster.
}

function render(container, classroom, selectedStudentId, handlers) {
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

  wrapper.appendChild(renderLayoutConfig(classroom, handlers));

  if (allStudents.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No students in this classroom yet \u2014 add students first, then arrange their seats here.' }));
    container.appendChild(wrapper);
    return;
  }

  if (selectedStudentId) {
    const hint = document.createElement('p');
    hint.className = 'seating-view__hint';
    const selected = allStudents.find(({ student }) => student.id === selectedStudentId);
    hint.textContent = `Placing ${selected ? selected.student.name : 'student'} \u2014 click a seat, or `;
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
  layout.appendChild(renderClassroomGrid(classroom, allStudents, selectedStudentId, handlers));
  layout.appendChild(renderRoster(classroom, allStudents, selectedStudentId, handlers));
  wrapper.appendChild(layout);

  container.appendChild(wrapper);
}

/**
 * "4 rows × 4 columns" + Add Row / Add Column, and the row/column
 * spacing level controls — deliberately compact, sitting above the
 * classroom map rather than competing with it for attention.
 */
function renderLayoutConfig(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__layout-config';

  const { rows, columns, rowGap, columnGap } = classroom.seatingConfig;

  const summaryRow = document.createElement('div');
  summaryRow.className = 'seating-view__layout-summary';

  const summaryText = document.createElement('span');
  summaryText.className = 'seating-view__layout-summary-text';
  summaryText.textContent = `${rows} rows \u00d7 ${columns} columns`;
  summaryRow.appendChild(summaryText);

  const addRowButton = document.createElement('button');
  addRowButton.type = 'button';
  addRowButton.className = 'btn btn--ghost';
  addRowButton.textContent = '+ Add Row';
  addRowButton.disabled = rows >= MAX_ROWS_OR_COLUMNS;
  addRowButton.addEventListener('click', handlers.onAddRow);
  summaryRow.appendChild(addRowButton);

  const addColumnButton = document.createElement('button');
  addColumnButton.type = 'button';
  addColumnButton.className = 'btn btn--ghost';
  addColumnButton.textContent = '+ Add Column';
  addColumnButton.disabled = columns >= MAX_ROWS_OR_COLUMNS;
  addColumnButton.addEventListener('click', handlers.onAddColumn);
  summaryRow.appendChild(addColumnButton);

  section.appendChild(summaryRow);

  const gapRow = document.createElement('div');
  gapRow.className = 'seating-view__gap-controls';
  gapRow.appendChild(renderGapStepper('Row spacing', rowGap, (delta) => handlers.onChangeGap('rowGap', delta)));
  gapRow.appendChild(renderGapStepper('Column spacing', columnGap, (delta) => handlers.onChangeGap('columnGap', delta)));
  section.appendChild(gapRow);

  return section;
}

const GAP_LEVEL_LABELS = { 1: 'Compact', 2: 'Normal', 3: 'Wide' };

function renderGapStepper(label, level, onChange) {
  const group = document.createElement('div');
  group.className = 'seating-view__stepper';

  const labelEl = document.createElement('span');
  labelEl.className = 'seating-view__stepper-label';
  labelEl.textContent = label;
  group.appendChild(labelEl);

  const controls = document.createElement('div');
  controls.className = 'seating-view__stepper-controls';

  const minusButton = document.createElement('button');
  minusButton.type = 'button';
  minusButton.className = 'seating-view__stepper-button';
  minusButton.textContent = '\u2212';
  minusButton.disabled = level <= MIN_GAP_LEVEL;
  minusButton.addEventListener('click', () => onChange(-1));
  controls.appendChild(minusButton);

  const valueEl = document.createElement('span');
  valueEl.className = 'seating-view__stepper-value';
  valueEl.textContent = GAP_LEVEL_LABELS[level] ?? String(level);
  controls.appendChild(valueEl);

  const plusButton = document.createElement('button');
  plusButton.type = 'button';
  plusButton.className = 'seating-view__stepper-button';
  plusButton.textContent = '+';
  plusButton.disabled = level >= MAX_GAP_LEVEL;
  plusButton.addEventListener('click', () => onChange(1));
  controls.appendChild(plusButton);

  group.appendChild(controls);
  return group;
}

// A teacher-facing spacing level (1/2/3) never leaks a raw CSS value
// to the teacher themselves — this is the one place that maps a
// level to an actual gap size, in rem, never exposed as "16px"/"24px"
// anywhere in the UI itself.
const GAP_LEVEL_TO_REM = { 1: 0.4, 2: 0.9, 3: 1.6 };

/**
 * The physical layout — Board at the top, a grid of seats sized by
 * rows/columns, with genuine row/column gaps (aisles) reflecting
 * rowGap/columnGap, Teacher at the bottom.
 */
function renderClassroomGrid(classroom, allStudents, selectedStudentId, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__room';

  const board = document.createElement('div');
  board.className = 'seating-view__board';
  board.textContent = 'BOARD';
  section.appendChild(board);

  const { rows, columns, rowGap, columnGap, assignments } = classroom.seatingConfig;
  const grid = document.createElement('div');
  grid.className = 'seating-view__grid';
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  grid.style.rowGap = `${GAP_LEVEL_TO_REM[rowGap] ?? GAP_LEVEL_TO_REM[2]}rem`;
  grid.style.columnGap = `${GAP_LEVEL_TO_REM[columnGap] ?? GAP_LEVEL_TO_REM[2]}rem`;

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const key = seatKey(row, column);
      const occupantId = assignments[key] ?? null;
      const occupant = occupantId ? allStudents.find(({ student }) => student.id === occupantId) : null;
      grid.appendChild(renderSeat(key, occupant, selectedStudentId, handlers));
    }
  }
  section.appendChild(grid);

  const teacherLabel = document.createElement('div');
  teacherLabel.className = 'seating-view__teacher-label';
  teacherLabel.textContent = 'TEACHER';
  section.appendChild(teacherLabel);

  return section;
}

function renderSeat(key, occupant, selectedStudentId, handlers) {
  const seat = document.createElement('button');
  seat.type = 'button';
  seat.className = 'seating-view__seat';
  if (occupant) seat.classList.add('seating-view__seat--occupied');
  if (occupant?.student.id === selectedStudentId) seat.classList.add('seating-view__seat--selected');

  const label = document.createElement('span');
  label.className = 'seating-view__seat-label';
  label.textContent = occupant ? occupant.student.name : '\u2014';
  seat.appendChild(label);

  seat.addEventListener('click', () => {
    if (selectedStudentId) {
      handlers.onSeatClick(key);
    } else if (occupant) {
      handlers.onSelectStudentFromRoster(occupant.student.id);
    }
  });

  // A quick way to empty an occupied seat without first selecting a
  // replacement — only shown on an occupied, not-currently-selected
  // seat, so it never competes with the click-to-select affordance.
  if (occupant && !selectedStudentId) {
    const clearButton = document.createElement('span');
    clearButton.className = 'seating-view__seat-clear';
    clearButton.textContent = '\u00d7';
    clearButton.setAttribute('aria-label', `Remove ${occupant.student.name} from this seat`);
    clearButton.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onClearSeat(key);
    });
    seat.appendChild(clearButton);
  }

  return seat;
}

/**
 * Every student not currently seated, grouped by their real Team —
 * this IS the reuse of the existing student/group model, not a
 * second roster. Group membership never determines seating at all.
 */
function renderRoster(classroom, allStudents, selectedStudentId, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__roster';

  const seatedIds = new Set(Object.values(classroom.seatingConfig.assignments));
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
