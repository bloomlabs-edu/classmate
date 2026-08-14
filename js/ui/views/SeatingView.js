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
 * arrangement itself is a new, small, classroom-level field
 * (classroom.seatingConfig — see models/Classroom.js), following the
 * exact same convention as every other classroom-level feature
 * (planner, notebookConfig, etc.): a plain object persisted via
 * workspaceService.save(), no new repository/collection at all.
 *
 * seatingConfig.assignments is keyed by "row-column" (e.g. "0-0") ->
 * studentId. An unlisted key is an empty seat — there is no separate
 * "is this seat empty" flag to keep in sync.
 *
 * Interaction is deliberately click-to-select, click-to-place (never
 * drag-and-drop) — the same interaction works identically on desktop
 * and mobile with no touch-event/drag-library complexity at all,
 * matching this milestone's own explicit "start with a simple MVP"
 * framing. Clicking a seated student "picks them up" (highlighted);
 * clicking a different seat places them there — swapping with
 * whoever, if anyone, was already in that seat, matching how a
 * teacher would physically swap two students' seats. Every placement
 * auto-saves immediately, matching the save-on-every-mutation
 * convention already used throughout this app (checkpoints, Goals,
 * etc.) — there is no separate "Save" button anywhere else in
 * ClassMate, and Seating doesn't introduce one either.
 */

import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import * as workspaceService from '../../services/workspaceService.js';

export function renderSeatingView(container, { classroom, onBack }) {
  ensureSeatingConfig(classroom);
  let selectedStudentId = null; // the one student currently "picked up," or null

  function rerender() {
    render(container, classroom, selectedStudentId, {
      onBack,
      onSelectStudentFromRoster: (studentId) => {
        selectedStudentId = studentId;
        rerender();
      },
      onSeatClick: (seatKey) => {
        handleSeatClick(classroom, seatKey, selectedStudentId);
        selectedStudentId = null;
        workspaceService.save(classroom);
        rerender();
      },
      onClearSeat: (seatKey) => {
        delete classroom.seatingConfig.assignments[seatKey];
        selectedStudentId = null;
        workspaceService.save(classroom);
        rerender();
      },
      onCancelSelection: () => {
        selectedStudentId = null;
        rerender();
      },
    });
  }

  rerender();
}

/** An existing classroom created before Seating shipped won't have this field at all — this establishes it on first use, matching this codebase's own established "ensure on demand" convention (e.g. classroomService.ensureJoinCode()). */
function ensureSeatingConfig(classroom) {
  if (!classroom.seatingConfig) {
    classroom.seatingConfig = { rows: 4, columns: 4, assignments: {} };
  }
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
 * The physical layout — Board at the top, a grid of seats sized by
 * classroom.seatingConfig.rows/columns, Teacher at the bottom.
 */
function renderClassroomGrid(classroom, allStudents, selectedStudentId, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__room';

  const board = document.createElement('div');
  board.className = 'seating-view__board';
  board.textContent = 'BOARD';
  section.appendChild(board);

  const { rows, columns, assignments } = classroom.seatingConfig;
  const grid = document.createElement('div');
  grid.className = 'seating-view__grid';
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const seatKey = `${row}-${column}`;
      const occupantId = assignments[seatKey] ?? null;
      const occupant = occupantId ? allStudents.find(({ student }) => student.id === occupantId) : null;
      grid.appendChild(renderSeat(seatKey, occupant, selectedStudentId, handlers));
    }
  }
  section.appendChild(grid);

  const teacherLabel = document.createElement('div');
  teacherLabel.className = 'seating-view__teacher-label';
  teacherLabel.textContent = 'TEACHER';
  section.appendChild(teacherLabel);

  return section;
}

function renderSeat(seatKey, occupant, selectedStudentId, handlers) {
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
      handlers.onSeatClick(seatKey);
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
      handlers.onClearSeat(seatKey);
    });
    seat.appendChild(clearButton);
  }

  return seat;
}

/**
 * Every student not currently seated, grouped by their real Team
 * (matching this module's own established "Groups" language) — this
 * IS the reuse of the existing student/group model the milestone
 * asked for, not a second roster.
 */
function renderRoster(classroom, allStudents, selectedStudentId, handlers) {
  const section = document.createElement('div');
  section.className = 'seating-view__roster';

  const heading = document.createElement('h2');
  heading.className = 'seating-view__roster-heading';
  heading.textContent = 'Unseated Students';
  section.appendChild(heading);

  const seatedIds = new Set(Object.values(classroom.seatingConfig.assignments));
  const unseated = allStudents.filter(({ student }) => !seatedIds.has(student.id));

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
