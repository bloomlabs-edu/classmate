/**
 * ui/views/SeatingView.js
 *
 * Seating — the first of Classroom Management's own "Coming Soon"
 * features to be activated (see ClassroomManagementView.js's own
 * header comment). Attendance, Buddy Pairs, and Live Classroom Tools
 * remain untouched, disabled placeholders; this file activates only
 * Seating, per explicit product decision.
 *
 * Represents the PHYSICAL classroom (a grid of seats, Board at the
 * top, Teacher at the bottom) — not a list. Reuses
 * classroom.teams[].students[] directly (see models/Team.js,
 * models/Student.js) — no second student/classroom model. The seating
 * arrangement itself is a small, classroom-level field
 * (classroom.seatingConfig — see models/Classroom.js), following the
 * exact same convention as every other classroom-level feature
 * (planner, notebookConfig, etc.): a plain object persisted via
 * workspaceService.save(), no new repository/collection at all.
 *
 * seatingConfig.assignments is keyed "r{row}c{col}" (1-indexed, e.g.
 * "r1c1") -> studentId. An unlisted key is an empty seat.
 *
 * ROOT-CAUSE FIX for the reported "kicked back to Dashboard" bug:
 * this view (and ClassroomManagementView.js, its own parent screen)
 * are reached via a plain function call, never router.navigate() — so
 * the router's own real, current route never actually advances past
 * 'dashboard'. workspaceService.js's own background onChangeCallback
 * (which fires on every incoming Firestore snapshot — including the
 * one triggered by this view's own save() after every action) falls
 * back to renderRoute(router.getCurrentRoute(), ...) whenever nobody
 * is registered as the classroom's active workspace — rebuilding
 * Dashboard straight into the shared container and destroying
 * whatever screen was on top of it. The real fix, confirmed by
 * tracing the actual mechanism rather than guessing: register with
 * services/workspaceCoordinator.js exactly the way
 * ui/views/LearningManagementView.js — its own only prior adopter —
 * already does, so a background snapshot updates this screen in
 * place via resyncFromServer() instead of falling through to
 * renderRoute() at all.
 *
 * Interaction is deliberately click-to-select, click-to-place (never
 * drag-and-drop) — works identically on desktop and mobile with no
 * touch-event/drag-library complexity. Clicking a seated student
 * "picks them up" (highlighted); clicking a different seat places
 * them there — swapping with whoever, if anyone, was already in that
 * seat. Every placement auto-saves immediately, matching the
 * save-on-every-mutation convention already used throughout this app.
 *
 * Local viewport preservation: every rerender() explicitly captures
 * and restores document.scrollingElement's own scrollTop/scrollLeft
 * — this view has no nested overflow:auto container of its own, so
 * page-level scroll is the real, only scroll owner here (confirmed
 * directly against this file's own CSS).
 */

import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';

export function renderSeatingView(container, { classroom, onBack }) {
  ensureSeatingConfig(classroom);
  let currentClassroom = classroom;
  let selectedStudentId = null; // the one student currently "picked up," or null

  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, resyncFromServer);

  function resyncFromServer(freshClassroom) {
    ensureSeatingConfig(freshClassroom);
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
      onChangeLayout: (field, delta) => {
        applyLayoutChange(currentClassroom, field, delta);
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

/** An existing classroom created before Seating shipped won't have this field at all — this establishes it on first use, matching this codebase's own established "ensure on demand" convention (e.g. classroomService.ensureJoinCode()). */
function ensureSeatingConfig(classroom) {
  if (!classroom.seatingConfig) {
    classroom.seatingConfig = { rows: 4, seatsPerRow: 4, assignments: {} };
  }
}

const MIN_ROWS_OR_SEATS = 1;
const MAX_ROWS_OR_SEATS = 12;

/**
 * Growing rows/seatsPerRow never touches existing assignments at all
 * — new seats simply become available. Shrinking removes any
 * assignment whose own row or column index no longer fits the new
 * layout; that student is never deleted, just no longer listed in
 * `assignments` at all, which is exactly what makes them appear back
 * in the Unseated Students roster (see renderRoster() below) — never
 * a silent data loss, matching the explicit safety requirement.
 */
function applyLayoutChange(classroom, field, delta) {
  const config = classroom.seatingConfig;
  const nextValue = Math.min(MAX_ROWS_OR_SEATS, Math.max(MIN_ROWS_OR_SEATS, config[field] + delta));
  if (nextValue === config[field]) return;

  config[field] = nextValue;

  Object.keys(config.assignments).forEach((key) => {
    const { row, column } = parseSeatKey(key);
    if (row > config.rows || column > config.seatsPerRow) {
      delete config.assignments[key];
    }
  });
}

function seatKey(row, column) {
  return `r${row}c${column}`;
}

function parseSeatKey(key) {
  const match = key.match(/^r(\d+)c(\d+)$/);
  return { row: Number(match[1]), column: Number(match[2]) };
}

/**
 * Placing a selected student into a seat. If that seat already holds
 * a different student, the two swap seats (matching the physical
 * "move this student here" mental model) — unless the mover came
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
  // assignments at all now (their old key was overwritten above) —
  // correctly unseated, back in the roster.
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
 * Rows / Seats per row steppers — deliberately compact, sitting above
 * the classroom map rather than competing with it for attention (per
 * explicit visual-design instruction: "configuration UI should not
 * dominate the classroom map").
 */
function renderLayoutConfig(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__layout-config';

  const { rows, seatsPerRow } = classroom.seatingConfig;

  section.appendChild(renderStepper('Rows', rows, (delta) => handlers.onChangeLayout('rows', delta)));
  section.appendChild(renderStepper('Seats per row', seatsPerRow, (delta) => handlers.onChangeLayout('seatsPerRow', delta)));

  return section;
}

function renderStepper(label, value, onChange) {
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
  minusButton.disabled = value <= MIN_ROWS_OR_SEATS;
  minusButton.addEventListener('click', () => onChange(-1));
  controls.appendChild(minusButton);

  const valueEl = document.createElement('span');
  valueEl.className = 'seating-view__stepper-value';
  valueEl.textContent = String(value);
  controls.appendChild(valueEl);

  const plusButton = document.createElement('button');
  plusButton.type = 'button';
  plusButton.className = 'seating-view__stepper-button';
  plusButton.textContent = '+';
  plusButton.disabled = value >= MAX_ROWS_OR_SEATS;
  plusButton.addEventListener('click', () => onChange(1));
  controls.appendChild(plusButton);

  group.appendChild(controls);
  return group;
}

/**
 * The physical layout — Board at the top, a grid of seats sized by
 * classroom.seatingConfig.rows/seatsPerRow, Teacher at the bottom.
 */
function renderClassroomGrid(classroom, allStudents, selectedStudentId, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__room';

  const board = document.createElement('div');
  board.className = 'seating-view__board';
  board.textContent = 'BOARD';
  section.appendChild(board);

  const { rows, seatsPerRow, assignments } = classroom.seatingConfig;
  const grid = document.createElement('div');
  grid.className = 'seating-view__grid';
  grid.style.gridTemplateColumns = `repeat(${seatsPerRow}, 1fr)`;

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= seatsPerRow; column += 1) {
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
 * Every student not currently seated, grouped by their real Team
 * (matching this module's own established "Groups" language) — this
 * IS the reuse of the existing student/group model, not a second
 * roster. Group membership never determines seating at all — it's
 * shown purely as context, per explicit instruction.
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
