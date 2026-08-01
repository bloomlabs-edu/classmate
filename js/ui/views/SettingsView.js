/**
 * ui/views/SettingsView.js
 *
 * The per-classroom Settings screen: General, Students, Groups, Teachers,
 * Permissions, and Danger Zone, as tabs sharing one screen. Each section
 * calls straight into the relevant service (teamService, studentService,
 * memberService, workspaceService) and re-renders itself afterwards —
 * there's no separate state layer here, the classroom object passed in is
 * mutated directly and workspaceService.save(classroom) persists it.
 *
 * Real, Google-authenticated membership now exists (see
 * services/memberService.js and models/Classroom.js's `members` map) —
 * the Teachers tab shows the actual Owner and Teachers on this shared
 * classroom, and its owner-only "Classroom ID" section is the real
 * co-teacher joining mechanism: a shared code (see
 * classroomService.ensureJoinCode()), not an email-based invite (this
 * app has no way to look up another account by email — see
 * authService.js's own module comment). Permissions is still a static
 * reference table, but the role matrix it displays is now the real one
 * enforced (client-side) elsewhere — e.g. Danger Zone below only lets
 * the owner delete the classroom.
 */

import * as studentService from '../../services/studentService.js';
import * as notebookService from '../../services/notebookService.js';
import * as classModeService from '../../services/classModeService.js';
import * as memberService from '../../services/memberService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as setupProgressService from '../../services/setupProgressService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { getDisplayName, ClassroomValidationError, ensureJoinCode } from '../../services/classroomService.js';
import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';
import { MEMBER_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from '../../config/memberRoles.js';
import { showToast } from '../components/Toast.js';

const SECTIONS = ['class', 'learning', 'classroom'];

const SECTION_LABELS = {
  class: { icon: 'users', text: 'Teachers' },
  learning: { icon: 'book-open', text: 'Learning' },
  classroom: { icon: 'settings', text: 'Classroom' },
};

export function renderSettingsView(container, { classroom, currentUser, section, onBack, onNavigateSection, onOpenStudentAccess, onDeleted, onReopenSetupWizard, onSelectStudent }) {
  container.innerHTML = '';
  const activeSection = SECTIONS.includes(section) ? section : 'class';
  const rerender = () =>
    renderSettingsView(container, {
      classroom,
      currentUser,
      section: activeSection,
      onBack,
      onNavigateSection,
      onOpenStudentAccess,
      onDeleted,
      onReopenSetupWizard,
    });

  const wrapper = document.createElement('div');
  wrapper.className = 'settings-view';

  const header = document.createElement('header');
  header.className = 'settings-header';

  const backButton = createBackButton(onBack);

  const title = document.createElement('h1');
  title.className = 'settings-header__title';
  title.textContent = `${getDisplayName(classroom)} \u00b7 Settings`;

  header.append(backButton, title);

  const tabs = document.createElement('nav');
  tabs.className = 'settings-tabs';
  tabs.setAttribute('aria-label', 'Settings sections');

  SECTIONS.forEach((key) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className =
      'settings-tabs__tab' + (key === activeSection ? ' settings-tabs__tab--active' : '');
    tabButton.appendChild(createIcon(SECTION_LABELS[key].icon, { size: 16 }));
    tabButton.append(SECTION_LABELS[key].text);
    tabButton.addEventListener('click', () => onNavigateSection(key));
    tabs.appendChild(tabButton);
  });

  const content = document.createElement('div');
  content.className = 'settings-content';

  // Three tasks instead of seven database-entity tabs — "what is the
  // next thing the teacher wants to do," not "which entity do they
  // want to edit." Each renderer below calls the same, unchanged
  // per-topic functions this file already had (renderStudentsSection,
  // renderGroupsSection, etc.) — merging them onto shared pages is a
  // presentation change, not a rewrite of what any of them already do
  // correctly.
  const sectionRenderers = {
    class: (el, cls, rr) => renderClassSection(el, cls, rr, onOpenStudentAccess, currentUser, onSelectStudent),
    learning: (el, cls, rr) => renderLearningSection(el, cls, rr),
    classroom: (el, cls, rr) => renderClassroomSection(el, cls, rr, currentUser, onDeleted, onReopenSetupWizard),
  };
  sectionRenderers[activeSection](content, classroom, rerender);

  wrapper.append(header, tabs, content);
  container.appendChild(wrapper);
}

/**
/**
 * Teachers only, now that Students and Groups have moved to
 * ui/views/ClassroomManagementView.js — daily operational data, not
 * occasional configuration, per explicit product decision. Teachers
 * (who has access to this shared classroom) stays here: it's exactly
 * the kind of infrequently-changed configuration Settings is meant to
 * hold, unlike a roster a teacher touches constantly.
 */
function renderClassSection(content, classroom, rerender, onOpenStudentAccess, currentUser, onSelectStudent) {
  renderTeachersSection(content, classroom, rerender, currentUser);
}

/** Subjects, Notebook Types, and learning-related settings together — everything about instruction, not administration. */
function renderLearningSection(content, classroom, rerender) {
  renderNotebooksSection(content, classroom, rerender);
}

/**
 * Administrative settings, deliberately kept together and visually
 * quiet — General up top (rarely touched after initial setup),
 * Permissions in the middle (a genuine empty state for the common
 * single-teacher case, not a complex matrix nobody needs yet), and
 * Danger Zone last, visually separated so it never looks like a
 * normal setting a teacher might casually click into.
 */
function renderClassroomSection(content, classroom, rerender, currentUser, onDeleted, onReopenSetupWizard) {
  renderGeneralSection(content, classroom, rerender, onReopenSetupWizard);

  const permissionsHeading = document.createElement('h2');
  permissionsHeading.className = 'settings-page-heading';
  permissionsHeading.textContent = 'Permissions';
  content.appendChild(permissionsHeading);
  renderPermissionsSection(content, classroom);

  const dangerDivider = document.createElement('div');
  dangerDivider.className = 'settings-danger-divider';
  content.appendChild(dangerDivider);
  renderDangerSection(content, classroom, currentUser, onDeleted);
}

function renderGeneralSection(content, classroom, rerender, onReopenSetupWizard) {
  content.appendChild(renderSetupProgressBlock(classroom, onReopenSetupWizard));

  const section = document.createElement('div');
  section.className = 'settings-section';

  const schoolNameInput = createLabeledInput(section, {
    label: 'School Name',
    value: classroom.schoolName,
  });
  const gradeSectionInput = createLabeledInput(section, {
    label: 'Grade / Section',
    value: classroom.gradeSection,
  });
  const classroomNameInput = createLabeledInput(section, {
    label: 'Classroom Name (optional)',
    value: classroom.classroomName,
  });
  const academicYearInput = createLabeledInput(section, {
    label: 'Academic Year (optional)',
    value: classroom.academicYear,
  });
  const descriptionInput = createLabeledInput(section, {
    label: 'Description (optional)',
    value: classroom.description,
    multiline: true,
  });

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    try {
      workspaceService.updateClassroomDetails(classroom.id, {
        schoolName: schoolNameInput.value.trim(),
        gradeSection: gradeSectionInput.value.trim(),
        classroomName: classroomNameInput.value.trim(),
        academicYear: academicYearInput.value.trim(),
        description: descriptionInput.value.trim(),
      });
      rerender();
    } catch (error) {
      const message =
        error instanceof ClassroomValidationError
          ? error.message
          : 'Something went wrong saving these details.';
      window.alert(message);
    }
  });
  section.appendChild(saveButton);

  const createdAt = document.createElement('p');
  createdAt.className = 'settings-section__meta';
  createdAt.textContent = `Created ${new Date(classroom.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
  section.appendChild(createdAt);

  content.appendChild(section);
}

function createLabeledInput(section, { label, value, multiline = false }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'settings-section__label';
  wrapper.textContent = label;

  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = 'text';
  input.className = 'settings-section__input';
  input.value = value || '';
  if (multiline) input.rows = 3;

  wrapper.appendChild(input);
  section.appendChild(wrapper);
  return input;
}

function renderSetupProgressBlock(classroom, onReopenSetupWizard) {
  const block = document.createElement('div');
  block.className = 'settings-section settings-progress-block';

  const heading = document.createElement('h3');
  heading.className = 'settings-team-block__heading';
  heading.textContent = 'Setup Progress';
  block.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'wizard-checklist wizard-checklist--compact';

  const STATUS_ROWS = [
    { key: 'classroomDetails', label: 'Classroom Details' },
    { key: 'importStudents', label: 'Students Imported' },
    { key: 'assignBuckets', label: 'Buckets Assigned' },
    { key: 'customizeGroups', label: 'Groups Customized' },
    { key: 'configureScoring', label: 'Scoring Configured' },
  ];

  STATUS_ROWS.forEach(({ key, label }) => {
    list.appendChild(createStatusRow(label, setupProgressService.isStepDone(classroom, key)));
  });

  // Teacher Collaboration now has a real on/off state — the co-teacher
  // join-code mechanism it depends on already exists and works.
  list.appendChild(createStatusRow('Teacher Collaboration', setupProgressService.isStepDone(classroom, 'inviteTeachers')));

  block.appendChild(list);

  const reopenButton = document.createElement('button');
  reopenButton.type = 'button';
  reopenButton.className = 'btn btn--ghost';
  reopenButton.textContent = 'Continue Setup';
  reopenButton.addEventListener('click', onReopenSetupWizard);
  block.appendChild(reopenButton);

  return block;
}

function createStatusRow(label, done) {
  const item = document.createElement('li');
  item.className = 'wizard-checklist__item';

  const row = document.createElement('div');
  row.className = 'wizard-checklist__row';

  const icon = document.createElement('span');
  icon.className = 'wizard-checklist__icon' + (done ? ' wizard-checklist__icon--done' : '');
  icon.textContent = done ? '\u2713' : '';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'wizard-checklist__label';
  text.textContent = label;

  row.append(icon, text);
  item.appendChild(row);
  return item;
}

// renderStudentsSection, renderImportSuccess, and renderGroupsSection
// moved to ui/views/ClassroomManagementView.js — Students and Groups
// are now Classroom Management's own daily-operational content, not
// Settings configuration. See that file for the current
// implementation (redesigned: group-first Add Student, collapsible
// group cards, overflow menus instead of permanently-visible
// actions) and services/teamService.js's removeTeamAndRelocateStudents()
// for the corresponding "never delete students" Delete Group behavior.


function renderTeachersSection(content, classroom, rerender, currentUser) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const isOwner = currentUser && memberService.isOwner(classroom, currentUser.uid);

  const owner = memberService.getOwner(classroom);
  const teachers = memberService.listTeachers(classroom);

  const ownerHeading = document.createElement('h3');
  ownerHeading.className = 'settings-team-block__heading';
  ownerHeading.textContent = 'Owner';
  section.appendChild(ownerHeading);

  const ownerList = document.createElement('ul');
  ownerList.className = 'settings-editable-list';
  if (owner) {
    ownerList.appendChild(createMemberRow(owner, currentUser));
  }
  section.appendChild(ownerList);

  const teachersHeading = document.createElement('h3');
  teachersHeading.className = 'settings-team-block__heading';
  teachersHeading.textContent = 'Teachers';
  section.appendChild(teachersHeading);

  if (teachers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'No other teachers on this classroom yet.';
    section.appendChild(empty);
  } else {
    const teachersList = document.createElement('ul');
    teachersList.className = 'settings-editable-list';
    teachers.forEach((member) => {
      teachersList.appendChild(createMemberRow(member, currentUser));
    });
    section.appendChild(teachersList);
  }

  // The join code IS the invitation mechanism — a co-teacher, signed
  // into their own account, enters this code from their own Home
  // screen ("Join a Classroom") to add themselves as a teacher member.
  // No email lookup is involved (this app has no way to find another
  // account by email — see authService.js), and no separate invite
  // record is needed: the code itself is the whole mechanism.
  if (isOwner) {
    const joinCodeHeading = document.createElement('h3');
    joinCodeHeading.className = 'settings-team-block__heading';
    joinCodeHeading.textContent = 'Classroom ID';
    section.appendChild(joinCodeHeading);

    const joinCodeNote = document.createElement('p');
    joinCodeNote.className = 'settings-section__meta';
    joinCodeNote.textContent =
      'Share this code with a co-teacher so they can join this classroom from their own account \u2014 they\u2019ll enter it from "Join a Classroom" on their Home screen.';
    section.appendChild(joinCodeNote);

    const joinCodeRow = document.createElement('div');
    joinCodeRow.className = 'join-code-display';

    if (classroom.classroomJoinCode) {
      const joinCodeValue = document.createElement('span');
      joinCodeValue.className = 'join-code-display__value';
      joinCodeValue.textContent = classroom.classroomJoinCode;
      joinCodeRow.appendChild(joinCodeValue);

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'btn btn--ghost';
      copyButton.textContent = 'Copy';
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(classroom.classroomJoinCode);
          copyButton.textContent = 'Copied!';
          setTimeout(() => {
            copyButton.textContent = 'Copy';
          }, 1500);
        } catch (error) {
          console.error('[SettingsView] Failed to copy join code:', error);
          window.alert(`Classroom ID: ${classroom.classroomJoinCode}`);
        }
      });
      joinCodeRow.appendChild(copyButton);
    } else {
      // Every classroom created after this fix already has a join
      // code from the moment it's created (see
      // classroomService.createEmptyClassroom) — this branch only
      // exists for a classroom that predates that change. Generating
      // one here happens only in response to an explicit click, never
      // automatically as a side effect of rendering this section.
      const generateButton = document.createElement('button');
      generateButton.type = 'button';
      generateButton.className = 'btn btn--primary';
      generateButton.textContent = 'Generate Classroom ID';
      generateButton.addEventListener('click', () => {
        ensureJoinCode(classroom);
        workspaceService.save(classroom);
        workspaceService.createJoinCodeMapping(classroom.classroomJoinCode, classroom.id);
        rerender();
      });
      joinCodeRow.appendChild(generateButton);
    }

    section.appendChild(joinCodeRow);
  }


  content.appendChild(section);
}

function createMemberRow(member, currentUser) {
  const item = document.createElement('li');
  item.className = 'settings-editable-list__item';

  const label = document.createElement('span');
  label.className = 'member-row__label';
  const roleLabel = member.role === MEMBER_ROLES.OWNER ? 'Owner' : member.role === MEMBER_ROLES.VIEWER ? 'Viewer' : 'Teacher';
  const youSuffix = currentUser && member.uid === currentUser.uid ? ' (you)' : '';
  label.textContent = `${member.displayName}${youSuffix} \u00b7 ${roleLabel}`;

  item.appendChild(label);
  return item;
}

function renderPermissionsSection(content, classroom) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const isSoloTeacher = (classroom.memberUids || []).length <= 1;

  if (isSoloTeacher) {
    const emptyState = document.createElement('div');
    emptyState.className = 'settings-empty-state';

    const icon = createIcon('lock', { className: 'settings-empty-state__icon', size: 28, strokeWidth: 1.5 });

    const title = document.createElement('h3');
    title.className = 'settings-empty-state__title';
    title.textContent = 'Permissions';

    const message = document.createElement('p');
    message.className = 'settings-empty-state__message';
    message.textContent = "You're the only teacher in this classroom right now, so there's nothing to configure yet. Once you invite a co-teacher, you'll be able to control what they can see and do here.";

    emptyState.append(icon, title, message);
    section.appendChild(emptyState);
    content.appendChild(section);
    return;
  }

  const note = document.createElement('p');
  note.className = 'settings-section__meta';
  note.textContent =
    'Reference table. Some of this is enforced today (e.g. only the owner can delete this classroom); the rest is enforced by Firestore security rules and further UI gating as more features land.';
  section.appendChild(note);

  const table = document.createElement('table');
  table.className = 'permissions-table';

  const headRow = document.createElement('tr');
  ['Permission', 'Owner', 'Teacher', 'Viewer'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  table.appendChild(headRow);

  Object.values(PERMISSIONS).forEach((permission) => {
    const row = document.createElement('tr');

    const label = document.createElement('td');
    label.textContent = formatPermissionLabel(permission);
    row.appendChild(label);

    [MEMBER_ROLES.OWNER, MEMBER_ROLES.TEACHER, MEMBER_ROLES.VIEWER].forEach((role) => {
      const cell = document.createElement('td');
      cell.textContent = ROLE_PERMISSIONS[role].includes(permission) ? '\u2713' : '\u2014';
      cell.className = 'permissions-table__cell';
      row.appendChild(cell);
    });

    table.appendChild(row);
  });

  section.appendChild(table);
  content.appendChild(section);
}

function renderDangerSection(content, classroom, currentUser, onDeleted) {
  const section = document.createElement('div');
  section.className = 'settings-section settings-section--danger';

  const isOwner = currentUser && memberService.isOwner(classroom, currentUser.uid);

  if (!isOwner) {
    const notice = document.createElement('p');
    notice.className = 'settings-section__meta';
    notice.textContent = 'Only this classroom\u2019s owner can delete it.';
    section.appendChild(notice);
    content.appendChild(section);
    return;
  }

  const warning = document.createElement('p');
  warning.className = 'settings-section__meta';
  warning.textContent = 'Deleting a classroom removes all its groups and students. This cannot be undone.';

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--danger';
  deleteButton.textContent = 'Delete classroom';
  deleteButton.addEventListener('click', () => {
    const confirmed = window.confirm(`Delete "${getDisplayName(classroom)}"? This cannot be undone.`);
    if (!confirmed) return;
    workspaceService.deleteClassroom(classroom.id);
    onDeleted();
  });

  const resetDivider = document.createElement('hr');
  resetDivider.className = 'settings-section__divider';

  const resetWarning = document.createElement('p');
  resetWarning.className = 'settings-section__meta';
  resetWarning.textContent =
    'Reset all classroom data to start completely from zero: every student\u2019s score, stars, streaks, badges, notes, bucket assignment, Learning Activity status, and the entire notebook check-in history for every subject. This is different from Reset Session in Class Mode, which only zeroes the current score — Recognition Wall, streaks, and Weekly Snapshot are computed from history this does clear. Groups, students, subjects, and Learning Activity definitions are kept; only accumulated data is removed. This cannot be undone.';

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn btn--danger';
  resetButton.textContent = 'Reset all classroom data';
  resetButton.addEventListener('click', () => {
    const confirmed = window.confirm(
      `Reset ALL data for "${getDisplayName(classroom)}"? This clears every student's score, streaks, badges, notes, bucket, activity status, and the full notebook history. Groups and students themselves are kept. This cannot be undone.`
    );
    if (!confirmed) return;
    studentService.resetAllStudentData(classroom);
    notebookService.clearAllNotebookData(classroom);
    classModeService.clearUndoStack(classroom);
    workspaceService.save(classroom);
    showToast('Classroom data reset');
  });

  section.append(warning, deleteButton, resetDivider, resetWarning, resetButton);
  content.appendChild(section);
}

function formatPermissionLabel(permission) {
  return permission.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
