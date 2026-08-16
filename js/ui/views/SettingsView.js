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
 * classroom. The co-teacher join code itself now lives on the
 * Classroom Access screen (see ui/views/StudentAccessView.js) —
 * a shared code (see classroomService.ensureJoinCode()), not an
 * email-based invite (this app has no way to look up another account
 * by email — see authService.js's own module comment). Permissions is still a static
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
import { getDisplayName, ClassroomValidationError } from '../../services/classroomService.js';
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
 * Teachers only, now that Students and Groups have moved to
 * ui/views/ClassroomManagementView.js — daily operational data, not
 * occasional configuration, per explicit product decision. Teachers
 * (who has access to this shared classroom) stays here: it's exactly
 * the kind of infrequently-changed configuration Settings is meant to
 * hold, unlike a roster a teacher touches constantly.
 */
function renderClassSection(content, classroom, rerender, onOpenStudentAccess, currentUser, onSelectStudent) {
  renderTeachersSection(content, classroom, rerender, currentUser, onOpenStudentAccess);
}

/** Subjects, Notebook Types, and learning-related settings together — everything about instruction, not administration. */
function renderLearningSection(content, classroom, rerender) {
  renderNotebooksSection(content, classroom, rerender);
}

/**
 * Settings > Notebooks — a classroom's own Subjects and, nested under
 * each, its Notebook Types (see services/notebookConfigService.js's
 * own header comment: "the notebook structure must NOT be hardcoded").
 * This is the only place either is ever added, renamed, or removed;
 * Notebook Tracker/Register/Timeline only ever read this
 * configuration, never edit it.
 *
 * Rename is inline (click a name to edit it in place, Enter/blur to
 * save, Escape to cancel) rather than a modal — matches this app's
 * existing convention of reserving modals for flows with several
 * fields at once (see ui/components/AddSubjectToAssessmentModal.js and
 * others), not a single text value.
 */
function renderNotebooksSection(content, classroom, rerender) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const heading = document.createElement('h3');
  heading.className = 'settings-team-block__heading';
  heading.textContent = 'Notebook Subjects';
  section.appendChild(heading);

  const subjects = notebookConfigService.listSubjects(classroom);

  if (subjects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'No subjects yet — add one below to start setting up Notebook Tracker.';
    section.appendChild(empty);
  } else {
    const subjectsList = document.createElement('ul');
    subjectsList.className = 'settings-editable-list';
    subjects.forEach((subject) => {
      subjectsList.appendChild(createNotebookSubjectRow(classroom, subject, rerender));
    });
    section.appendChild(subjectsList);
  }

  section.appendChild(
    createAddRow({
      placeholder: 'New subject name',
      buttonLabel: '+ Add Subject',
      onAdd: (name) => {
        notebookConfigService.addSubject(classroom, name);
        workspaceService.save(classroom);
        rerender();
      },
    })
  );

  content.appendChild(section);
}

function createNotebookSubjectRow(classroom, subject, rerender) {
  const item = document.createElement('li');
  item.className = 'settings-editable-list__item settings-notebook-subject';

  const header = document.createElement('div');
  header.className = 'settings-notebook-subject__header';
  header.appendChild(createInlineEditableLabel(subject.name, (newName) => {
    notebookConfigService.renameSubject(classroom, subject.id, newName);
    workspaceService.save(classroom);
    rerender();
  }));

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn--text settings-notebook-subject__remove';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => {
    const confirmed = window.confirm(`Remove "${subject.name}" and all its Notebook Types? This cannot be undone.`);
    if (!confirmed) return;
    notebookConfigService.removeSubject(classroom, subject.id);
    workspaceService.save(classroom);
    rerender();
  });
  header.appendChild(removeButton);
  item.appendChild(header);

  const notebookTypes = notebookConfigService.listNotebookTypes(classroom, subject.id);
  const typesList = document.createElement('ul');
  typesList.className = 'settings-notebook-types-list';
  notebookTypes.forEach((type) => {
    typesList.appendChild(createNotebookTypeRow(classroom, type, rerender));
  });
  item.appendChild(typesList);

  item.appendChild(
    createAddRow({
      placeholder: 'New notebook type',
      buttonLabel: '+ Add Notebook Type',
      compact: true,
      suggestions: ['Homework', 'Classwork', 'Notes', 'Practice', 'Revision', 'Tests'],
      helperText: 'Notebook types help you organize different kinds of student work.',
      onAdd: (name) => {
        notebookConfigService.addNotebookType(classroom, subject.id, name);
        workspaceService.save(classroom);
        rerender();
      },
    })
  );

  return item;
}

function createNotebookTypeRow(classroom, type, rerender) {
  const item = document.createElement('li');
  item.className = 'settings-notebook-types-list__item';

  item.appendChild(createInlineEditableLabel(type.name, (newName) => {
    notebookConfigService.renameNotebookType(classroom, type.id, newName);
    workspaceService.save(classroom);
    rerender();
  }));

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn--text settings-notebook-subject__remove';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => {
    const confirmed = window.confirm(`Remove "${type.name}"? This cannot be undone.`);
    if (!confirmed) return;
    notebookConfigService.removeNotebookType(classroom, type.id);
    workspaceService.save(classroom);
    rerender();
  });
  item.appendChild(removeButton);

  return item;
}

/** A name that becomes a text input on click, saving on Enter/blur and reverting on Escape — used for both Subject and Notebook Type names above. */
function createInlineEditableLabel(currentName, onSave) {
  const wrapper = document.createElement('span');
  wrapper.className = 'settings-inline-editable-label';

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'settings-inline-editable-label__display';
  label.textContent = currentName;
  label.title = 'Click to rename';

  label.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-inline-editable-label__input';
    input.value = currentName;

    function commit() {
      const newName = input.value.trim();
      if (newName && newName !== currentName) onSave(newName);
      else wrapper.replaceChild(label, input);
    }

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        wrapper.replaceChild(label, input);
      }
    });
    input.addEventListener('blur', commit);

    wrapper.replaceChild(input, label);
    input.focus();
    input.select();
  });

  wrapper.appendChild(label);
  return wrapper;
}

/** A text input + button for adding a new Subject or Notebook Type — clears itself and refocuses after a successful add, so adding several in a row doesn't require re-clicking into the field each time. */
function createAddRow({ placeholder, buttonLabel, onAdd, compact = false, suggestions = null, helperText = null }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-add-row-wrapper';

  const row = document.createElement('div');
  row.className = compact ? 'settings-add-row settings-add-row--compact' : 'settings-add-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'settings-add-row__input';
  input.placeholder = placeholder;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--secondary';
  button.textContent = buttonLabel;

  function submit() {
    const name = input.value.trim();
    if (!name) return;
    onAdd(name);
    input.value = '';
    input.focus();
  }

  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  row.append(input, button);
  wrapper.appendChild(row);

  // THE ACTUAL FIX (Part B): guided suggestions — clicking one only
  // ever populates the input, never submits it directly, so the
  // teacher can still edit before explicitly adding it. Purely
  // optional; a caller that doesn't pass any gets exactly the same
  // plain add-row as before, unaffected.
  if (suggestions && suggestions.length > 0) {
    const suggestionsRow = document.createElement('div');
    suggestionsRow.className = 'settings-add-row__suggestions';
    const suggestionsLabel = document.createElement('span');
    suggestionsLabel.className = 'settings-add-row__suggestions-label';
    suggestionsLabel.textContent = 'Suggestions:';
    suggestionsRow.appendChild(suggestionsLabel);
    suggestions.forEach((suggestion) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'settings-add-row__suggestion-chip';
      chip.textContent = suggestion;
      chip.addEventListener('click', () => {
        input.value = suggestion;
        input.focus();
      });
      suggestionsRow.appendChild(chip);
    });
    wrapper.appendChild(suggestionsRow);
  }

  if (helperText) {
    const helper = document.createElement('p');
    helper.className = 'settings-add-row__helper-text';
    helper.textContent = helperText;
    wrapper.appendChild(helper);
  }

  return wrapper;
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


function renderTeachersSection(content, classroom, rerender, currentUser, onOpenStudentAccess) {
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

  // Inviting a co-teacher (the join-code mechanism) now lives on the
  // Classroom Access screen — one single place for both the student
  // and co-teacher invite codes, rather than splitting them between
  // this page and that one. Owner-only, matching who could actually
  // use the code there.
  if (isOwner && onOpenStudentAccess) {
    const inviteLink = document.createElement('button');
    inviteLink.type = 'button';
    inviteLink.className = 'btn btn--text';
    inviteLink.textContent = 'Invite a co-teacher \u2192';
    inviteLink.addEventListener('click', onOpenStudentAccess);
    section.appendChild(inviteLink);
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
