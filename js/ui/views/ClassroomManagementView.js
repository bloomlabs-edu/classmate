/**
 * ui/views/ClassroomManagementView.js
 *
 * Classroom Management — the operational workspace for running a
 * class day to day, alongside Learning Management (teaching and
 * curriculum) and Assessment Management (examinations and marks).
 * Students and Groups moved here from Settings, per explicit product
 * decision: they're daily operational data, not occasional
 * configuration — Settings now holds only what's rarely touched
 * (classroom name, grade, school, join code, Teachers, Archive,
 * Delete, Preferences). Attendance, Buddy Pairs, and Live Classroom
 * Tools are named as this module's future scope but remain
 * deliberately not built here — shown as clearly-labeled, disabled
 * placeholders, not silently omitted. Seating is now activated (see
 * this file's own later comment, and ui/views/SeatingView.js).
 *
 * Students always belong to either a real Group or the automatic
 * Ungrouped team (see services/classroomService.js's
 * getOrCreateUngroupedTeam()) — there is no way to reach a state where
 * a student exists outside this structure. Add Student is group-first:
 * choosing a destination always comes before typing a name, whether
 * that's the top-level "+ Add Student" (which asks which group first)
 * or a group's own "+ Add Student" (which already knows). Deleting a
 * Group never deletes its students — see
 * services/teamService.js's removeTeamAndRelocateStudents(), which
 * relocates every student to a chosen destination before the now-
 * empty group is actually removed.
 *
 * Seating is now activated (see ui/views/SeatingView.js) — the first
 * of this module's own named-but-unbuilt features to ship, per
 * explicit product decision. Attendance, Buddy Pairs, and Live
 * Classroom Tools remain deliberately unbuilt, shown as clearly-
 * labeled, disabled placeholders, not silently omitted.
 *
 * Every list here is a NavigationRow-style plain row where nothing but
 * navigation happens on click, and an overflow "⋮" menu (see
 * ui/components/OverflowMenu.js) for the handful of real actions each
 * row or group actually has — deliberately no permanently-visible
 * rename inputs or Remove buttons sitting on every row, which is
 * exactly the clutter this redesign was asked to remove. Groups are
 * collapsible; which ones are collapsed is UI-only state, not
 * persisted to the classroom.
 *
 * Bulk operations (multi-select, move selected, delete selected,
 * assign Buddy Pair, print labels) are named as a future direction,
 * not built now — the one-row-per-student, one-card-per-group
 * structure here is exactly what a future selection layer would need,
 * without requiring this file's own architecture to change when that
 * lands.
 */

import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';
import { createOverflowMenu } from '../components/OverflowMenu.js';
import * as teamService from '../../services/teamService.js';
import * as studentService from '../../services/studentService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { getOrCreateUngroupedTeam } from '../../services/classroomService.js';
import * as classroomImportService from '../../services/classroomImportService.js';
import { ClassroomImportError } from '../../services/classroomImportService.js';
import { openImportPreviewModal } from '../components/ImportPreviewModal.js';
import { renderSeatingView } from './SeatingView.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';

// UI-only — which Group cards are currently collapsed. Not persisted;
// resets naturally on a full reload, the same way e.g. a modal's own
// open/closed state would.
const collapsedGroupIds = new Set();

export function renderClassroomManagementView(container, { classroom, onBack, onSelectStudent }) {
  container.innerHTML = '';
  const rerender = () => renderClassroomManagementView(container, { classroom, onBack, onSelectStudent });

  // Mirrors ui/views/SeatingView.js's own header comment on this same
  // mechanism exactly — without this, a background Firestore snapshot
  // (triggered by any save anywhere, including from within Seating
  // itself) falls back to renderRoute(), rebuilding Dashboard straight
  // into this same container and destroying this screen.
  workspaceCoordinator.registerActiveWorkspace(classroom.id, () => rerender());

  const wrapper = document.createElement('div');
  wrapper.className = 'classroom-management';

  const header = document.createElement('div');
  header.className = 'learning-management__header';
  const backButton = createBackButton(() => {
    workspaceCoordinator.unregisterActiveWorkspace(classroom.id);
    onBack();
  });
  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = 'Classroom';
  header.append(backButton, title);
  wrapper.appendChild(header);

  wrapper.appendChild(renderClassroomToolsSection(() => {
    renderSeatingView(container, { classroom, onBack: rerender });
  }));
  wrapper.appendChild(renderStudentsAndGroupsSection(classroom, rerender, onSelectStudent));

  container.appendChild(wrapper);
}

/**
 * Ungrouped is always shown as a card too, even with zero students —
 * "students should always belong to either a Group or Ungrouped" is
 * only really true if a teacher can always *see* Ungrouped, not just
 * technically have it exist. Real Groups the teacher created are
 * listed first, in creation order; Ungrouped is always last, visually
 * distinct as the catch-all it is rather than "just another group."
 */
function renderStudentsAndGroupsSection(classroom, rerender, onSelectStudent) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const sectionHeading = document.createElement('h2');
  sectionHeading.className = 'learning-management__step-heading';
  sectionHeading.textContent = 'Students & Groups';
  section.appendChild(sectionHeading);

  const actionBar = document.createElement('div');
  actionBar.className = 'classroom-management__action-bar';

  const addStudentButton = document.createElement('button');
  addStudentButton.type = 'button';
  addStudentButton.className = 'btn btn--primary';
  addStudentButton.textContent = '+ Add Student';
  addStudentButton.addEventListener('click', () => {
    openChooseGroupModal(classroom, {
      title: 'Add Student \u2014 Choose Group',
      onChoose: (team) => {
        openNameEntryModal({
          heading: `Add to ${team.name}`,
          confirmLabel: 'Add Student',
          onConfirm: (name) => {
            studentService.addStudent(team, name);
            workspaceService.save(classroom);
            rerender();
          },
        });
      },
    });
  });

  const newGroupButton = document.createElement('button');
  newGroupButton.type = 'button';
  newGroupButton.className = 'btn btn--ghost';
  newGroupButton.textContent = '+ New Group';
  newGroupButton.addEventListener('click', () => {
    openNameEntryModal({
      heading: 'New Group',
      placeholder: 'Group name',
      confirmLabel: 'Create Group',
      onConfirm: (name) => {
        teamService.addTeam(classroom, name);
        workspaceService.save(classroom);
        rerender();
      },
    });
  });

  const uploadButton = document.createElement('button');
  uploadButton.type = 'button';
  uploadButton.className = 'btn btn--ghost';
  uploadButton.appendChild(createIcon('file-up', { size: 16 }));
  uploadButton.append('Upload Student List');

  actionBar.append(addStudentButton, newGroupButton, uploadButton);
  section.appendChild(actionBar);

  // Reuses the exact same CSV import pipeline as the Setup Wizard and
  // the old Settings Students section (services/classroomImportService.js,
  // ImportPreviewModal) — preserving this existing functionality
  // rather than losing it in the move to this new module.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv';
  fileInput.style.display = 'none';
  uploadButton.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    fileInput.value = '';
    if (!file) return;

    let analysis;
    try {
      const csvText = await file.text();
      analysis = classroomImportService.analyzeCsv(csvText);
    } catch (error) {
      window.alert('Something went wrong reading that file. Please check the CSV and try again.');
      return;
    }

    openImportPreviewModal({
      formats: analysis.formats,
      initialFormatId: analysis.detected.id,
      getPreview: (formatId) => {
        try {
          const { teams } = classroomImportService.parseWithFormat(formatId, analysis.rows);
          return { teams };
        } catch (error) {
          const message =
            error instanceof ClassroomImportError ? error.message : 'Could not parse this file with the selected format.';
          return { teams: [], error: message };
        }
      },
      onConfirm: (formatId) => {
        const { teams } = classroomImportService.parseWithFormat(formatId, analysis.rows);
        // importRosterIntoClassroom() looks up its own fresh classroom
        // reference internally and persists it directly — the live
        // classroom subscription this triggers re-renders this whole
        // view with a fresh reference, so no explicit rerender() call
        // here (it would use this closure's stale one instead).
        workspaceService.importRosterIntoClassroom(classroom.id, teams);
      },
    });
  });
  section.appendChild(fileInput);

  const realGroups = classroom.teams.filter((team) => !team.isUngrouped);
  const ungrouped = getOrCreateUngroupedTeam(classroom);

  [...realGroups, ungrouped].forEach((team) => {
    section.appendChild(renderGroupCard(classroom, team, rerender, onSelectStudent));
  });

  return section;
}

function renderGroupCard(classroom, team, rerender, onSelectStudent) {
  const card = document.createElement('div');
  card.className = 'classroom-management__group-card';

  const isCollapsed = collapsedGroupIds.has(team.id);

  const headerRow = document.createElement('div');
  headerRow.className = 'classroom-management__group-header';

  const collapseToggle = document.createElement('button');
  collapseToggle.type = 'button';
  collapseToggle.className = 'classroom-management__group-collapse-toggle';
  collapseToggle.setAttribute('aria-label', isCollapsed ? `Expand ${team.name}` : `Collapse ${team.name}`);
  collapseToggle.textContent = isCollapsed ? '\u25b6' : '\u25bc';
  collapseToggle.addEventListener('click', () => {
    if (isCollapsed) collapsedGroupIds.delete(team.id);
    else collapsedGroupIds.add(team.id);
    rerender();
  });

  const nameLabel = document.createElement('span');
  nameLabel.className = 'classroom-management__group-name';
  nameLabel.textContent = `${team.name} (${team.students.length})`;

  headerRow.append(collapseToggle, nameLabel);

  // Ungrouped is the automatic catch-all, not a group a teacher
  // created — renaming, moving its students out from under it, or
  // deleting it makes no sense (there would be nothing left to catch
  // students that aren't in a real group), so it gets no overflow
  // menu at all, matching how Learning Management already excludes
  // menus where there's genuinely nothing to manage.
  if (!team.isUngrouped) {
    const menuActions = [
      {
        label: 'Add Student',
        onClick: () => {
          openNameEntryModal({
            heading: `Add to ${team.name}`,
            confirmLabel: 'Add Student',
            onConfirm: (name) => {
              studentService.addStudent(team, name);
              workspaceService.save(classroom);
              rerender();
            },
          });
        },
      },
      {
        label: 'Rename Group',
        onClick: () => {
          openNameEntryModal({
            heading: 'Rename Group',
            placeholder: 'Group name',
            initialValue: team.name,
            confirmLabel: 'Save',
            onConfirm: (newName) => {
              teamService.renameTeam(classroom, team.id, newName);
              workspaceService.save(classroom);
              rerender();
            },
          });
        },
      },
      {
        label: 'Move Students',
        onClick: () => {
          if (team.students.length === 0) return;
          openChooseGroupModal(classroom, {
            title: `Move Students Out of ${team.name}`,
            excludeTeamId: team.id,
            onChoose: (destination) => {
              [...team.students].forEach((student) => {
                studentService.moveStudentToTeam(classroom, team.id, student.id, destination.id);
              });
              workspaceService.save(classroom);
              rerender();
            },
          });
        },
      },
      {
        label: 'Delete Group',
        danger: true,
        onClick: () => {
          if (team.students.length === 0) {
            if (!window.confirm(`Delete "${team.name}"? It has no students.`)) return;
            teamService.removeTeam(classroom, team.id);
            workspaceService.save(classroom);
            rerender();
            return;
          }
          openChooseGroupModal(classroom, {
            title: `Delete ${team.name} \u2014 Move its ${team.students.length} student${team.students.length === 1 ? '' : 's'} to\u2026`,
            excludeTeamId: team.id,
            onChoose: (destination) => {
              teamService.removeTeamAndRelocateStudents(classroom, team.id, destination.id);
              workspaceService.save(classroom);
              rerender();
            },
          });
        },
      },
    ];
    headerRow.appendChild(createOverflowMenu({ actions: menuActions, ariaLabel: `${team.name} settings` }));
  }

  card.appendChild(headerRow);

  if (!isCollapsed) {
    if (team.students.length === 0) {
      const emptyNote = document.createElement('p');
      emptyNote.className = 'classroom-management__group-empty';
      emptyNote.textContent = team.isUngrouped ? 'No ungrouped students.' : 'No students in this group yet.';
      card.appendChild(emptyNote);
    } else {
      const list = document.createElement('div');
      list.className = 'classroom-management__student-list';
      team.students.forEach((student) => {
        list.appendChild(renderStudentRow(classroom, team, student, rerender, onSelectStudent));
      });
      card.appendChild(list);
    }

    const addStudentInline = document.createElement('button');
    addStudentInline.type = 'button';
    addStudentInline.className = 'btn btn--text classroom-management__group-add-student';
    addStudentInline.textContent = '+ Add Student';
    addStudentInline.addEventListener('click', () => {
      openNameEntryModal({
        heading: `Add to ${team.name}`,
        confirmLabel: 'Add Student',
        onConfirm: (name) => {
          studentService.addStudent(team, name);
          workspaceService.save(classroom);
          rerender();
        },
      });
    });
    card.appendChild(addStudentInline);
  }

  return card;
}

/**
 * A plain navigation row, not a card with its own overflow menu —
 * per explicit product decision, following this app's existing
 * platform rule (see ui/components/NavigationRow.js's own header
 * comment): a row that leads somewhere just navigates, with a
 * trailing chevron as the only affordance; management actions for the
 * thing it leads to belong on the screen it navigates *to*. Rename,
 * Move to Group, and Remove Student now live in
 * ui/views/StudentProfileView.js's own overflow menu instead — a
 * student row here has exactly one job, opening that profile, the
 * same way a Subject or Assessment row elsewhere in the app does for
 * its own destination.
 */
function renderStudentRow(classroom, team, student, rerender, onSelectStudent) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'classroom-management__student-row navigation-row';
  row.addEventListener('click', () => onSelectStudent(student.id));

  const name = document.createElement('span');
  name.className = 'classroom-management__student-name';
  name.textContent = student.name;
  row.appendChild(name);

  return row;
}

/**
 * The one shared "pick a destination group" flow — used by the
 * top-level Add Student, a student's own Move to Group, a group's own
 * Move Students, and Delete Group's relocation step. Always includes
 * "+ New Group" so a teacher never has to cancel out, create a group
 * elsewhere, and start over.
 */
export function openChooseGroupModal(classroom, { title, excludeTeamId = null, onChoose }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = title;
  modal.appendChild(heading);

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  const list = document.createElement('div');
  list.className = 'choose-subject-modal__list';

  const ungrouped = getOrCreateUngroupedTeam(classroom);
  const options = [...classroom.teams.filter((team) => !team.isUngrouped), ungrouped].filter(
    (team) => team.id !== excludeTeamId
  );

  options.forEach((team) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'choose-subject-modal__row';
    row.textContent = team.name;
    row.addEventListener('click', () => {
      close();
      onChoose(team);
    });
    list.appendChild(row);
  });

  const newGroupRow = document.createElement('button');
  newGroupRow.type = 'button';
  newGroupRow.className = 'choose-subject-modal__row choose-subject-modal__row--custom';
  newGroupRow.textContent = '+ New Group';
  newGroupRow.addEventListener('click', () => {
    close();
    openNameEntryModal({
      heading: 'New Group',
      placeholder: 'Group name',
      confirmLabel: 'Create Group',
      onConfirm: (name) => {
        const created = teamService.addTeam(classroom, name);
        workspaceService.save(classroom);
        onChoose(created);
      },
    });
  });
  list.appendChild(newGroupRow);

  modal.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);
  actions.appendChild(cancelButton);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * A single name-entry modal, reused for Add Student, Rename Student,
 * New Group, and Rename Group — the same shape every time (one field,
 * Cancel/Confirm), differing only in heading/placeholder/confirm
 * label and what happens with the typed value.
 */
export function openNameEntryModal({ heading, placeholder = 'Student name', initialValue = '', confirmLabel, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const headingEl = document.createElement('h2');
  headingEl.className = 'modal__heading';
  headingEl.textContent = heading;
  modal.appendChild(headingEl);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal__input';
  input.placeholder = placeholder;
  input.value = initialValue;
  modal.appendChild(input);

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  function confirm() {
    const value = input.value.trim();
    if (!value) return;
    close();
    onConfirm(value);
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') confirm();
  });

  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);
  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'btn btn--primary';
  confirmButton.textContent = confirmLabel;
  confirmButton.addEventListener('click', confirm);
  actions.append(cancelButton, confirmButton);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  input.focus();
}

/**
 * Attendance, Buddy Pairs, Seating, and Live Classroom tools are named
 * as this module's own future scope — shown here as clearly-labeled,
 * disabled placeholders so the module's eventual shape is visible,
 * rather than silently building none of them and leaving no trace
 * they're coming.
 */
/**
 * Attendance, Buddy Pairs, and Live Classroom tools remain named as
 * this module's own future scope — disabled placeholders, unchanged.
 * Seating is the first of these activated (see this file's own
 * header comment) — a real button leading to ui/views/SeatingView.js,
 * the same "swap this container's content" navigation convention
 * used everywhere else in this app. Renamed from "Coming Soon" to
 * "Classroom Tools" and moved to the top of this screen, per explicit
 * product decision: Seating is a Classroom Management tool in its
 * own right, not something buried under the student list.
 */
function renderClassroomToolsSection(onOpenSeating) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('h2');
  heading.className = 'learning-management__step-heading';
  heading.textContent = 'Classroom Tools';
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'classroom-management__coming-soon-grid';

  [
    { icon: 'clipboard-list', label: 'Seating', active: true },
    { icon: 'calendar', label: 'Attendance', active: false },
    { icon: 'users', label: 'Buddy Pairs', active: false },
    { icon: 'chalkboard-easel', label: 'Live Classroom Tools', active: false },
  ].forEach(({ icon, label, active }) => {
    const card = document.createElement(active ? 'button' : 'div');
    if (active) card.type = 'button';
    card.className = 'classroom-management__coming-soon-card';
    if (active) {
      card.classList.add('classroom-management__coming-soon-card--active');
      card.addEventListener('click', onOpenSeating);
    }
    card.appendChild(createIcon(icon, { size: 20 }));
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    card.appendChild(labelEl);
    grid.appendChild(card);
  });

  section.appendChild(grid);
  return section;
}
