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

import * as teamService from '../../services/teamService.js';
import * as studentService from '../../services/studentService.js';
import * as notebookService from '../../services/notebookService.js';
import * as classModeService from '../../services/classModeService.js';
import * as memberService from '../../services/memberService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as setupProgressService from '../../services/setupProgressService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { getDisplayName, ClassroomValidationError, ensureJoinCode, getOrCreateUngroupedTeam } from '../../services/classroomService.js';
import * as classroomImportService from '../../services/classroomImportService.js';
import { ClassroomImportError } from '../../services/classroomImportService.js';
import { createIcon } from '../components/Icon.js';
import { openImportPreviewModal } from '../components/ImportPreviewModal.js';
import { MEMBER_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from '../../config/memberRoles.js';
import { showToast } from '../components/Toast.js';

const SECTIONS = ['class', 'learning', 'classroom'];

/**
 * Saving after an import triggers this app's real-time classroom
 * subscription (see workspaceService.js), which synchronously
 * replaces the whole classroom object (upsertClassroom() builds a
 * fresh one, it doesn't mutate the existing reference) and re-renders
 * this entire view via the normal route path — both *before* the
 * import handler's own subsequent renderImportSuccess() call would
 * otherwise run. Setting a flag directly on the classroom object
 * wouldn't survive that replacement; this module-level flag does,
 * since it lives outside the classroom object entirely. Checked once
 * at the top of renderStudentsSection() and cleared immediately after
 * being read, so it only ever affects the single render right after
 * an import completes.
 */
let pendingImportSuccess = null;

const SECTION_LABELS = {
  class: { icon: 'users', text: 'Class' },
  learning: { icon: 'book-open', text: 'Learning' },
  classroom: { icon: 'settings', text: 'Classroom' },
};

export function renderSettingsView(container, { classroom, currentUser, section, onBack, onNavigateSection, onOpenStudentAccess, onDeleted, onReopenSetupWizard }) {
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

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back');
  backButton.addEventListener('click', onBack);

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
    class: (el, cls, rr) => renderClassSection(el, cls, rr, onOpenStudentAccess, currentUser),
    learning: (el, cls, rr) => renderLearningSection(el, cls, rr),
    classroom: (el, cls, rr) => renderClassroomSection(el, cls, rr, currentUser, onDeleted, onReopenSetupWizard),
  };
  sectionRenderers[activeSection](content, classroom, rerender);

  wrapper.append(header, tabs, content);
  container.appendChild(wrapper);
}

/**
 * "The classroom community" — Students, Groups, and Teachers on one
 * page, since a teacher managing their roster very often wants to
 * touch more than one of these in the same sitting (add a student,
 * put them in a group, invite a co-teacher) and switching tabs
 * between three closely related tasks was exactly the fragmentation
 * this redesign is meant to remove. Each sub-section keeps its own
 * heading so the page still reads as three distinct topics, not one
 * undifferentiated list.
 */
function renderClassSection(content, classroom, rerender, onOpenStudentAccess, currentUser) {
  const studentsWrapper = document.createElement('div');
  const studentsHeading = document.createElement('h2');
  studentsHeading.className = 'settings-page-heading';
  studentsHeading.textContent = 'Students';
  studentsWrapper.appendChild(studentsHeading);
  content.appendChild(studentsWrapper);
  renderStudentsSection(content, classroom, rerender, onOpenStudentAccess);

  const groupsHeading = document.createElement('h2');
  groupsHeading.className = 'settings-page-heading';
  groupsHeading.textContent = 'Groups';
  content.appendChild(groupsHeading);
  renderGroupsSection(content, classroom, rerender);

  const teachersHeading = document.createElement('h2');
  teachersHeading.className = 'settings-page-heading';
  teachersHeading.textContent = 'Teachers';
  content.appendChild(teachersHeading);
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

function renderStudentsSection(content, classroom, rerender, onOpenStudentAccess) {
  if (pendingImportSuccess) {
    const { count } = pendingImportSuccess;
    pendingImportSuccess = null; // consumed — only ever shown once, right after the import that set it
    renderImportSuccess(content, count, onOpenStudentAccess, () => rerender());
    return;
  }

  const section = document.createElement('div');
  section.className = 'settings-section';

  const hasAnyStudents = classroom.teams.some((team) => team.students.length > 0);

  // Action-first: Add Student and Upload Student List are the very
  // first things on this page, before any list or empty-state copy —
  // "the page should encourage getting students into the classroom
  // before showing empty lists." Both actions are always available
  // here, whether or not students already exist, since a teacher
  // might import a second batch later just as easily as a first one.
  const actionBar = document.createElement('div');
  actionBar.className = 'settings-action-bar';

  const addStudentButton = document.createElement('button');
  addStudentButton.type = 'button';
  addStudentButton.className = 'btn btn--primary';
  addStudentButton.textContent = '+ Add Student';

  const uploadButton = document.createElement('button');
  uploadButton.type = 'button';
  uploadButton.className = 'btn btn--ghost';
  uploadButton.appendChild(createIcon('file-up', { size: 16 }));
  uploadButton.append('Upload Student List');

  const divider = document.createElement('span');
  divider.className = 'settings-action-bar__divider';
  divider.textContent = 'or';

  actionBar.append(addStudentButton, divider, uploadButton);
  section.appendChild(actionBar);

  // The inline quick-add form, hidden until "+ Add Student" is
  // clicked — keeps the action bar itself uncluttered by a bare text
  // input sitting there by default.
  const quickAddSlot = document.createElement('div');
  quickAddSlot.hidden = true;
  quickAddSlot.appendChild(
    createAddForm('New student name', 'Save', (name) => {
      const ungroupedTeam = getOrCreateUngroupedTeam(classroom);
      studentService.addStudent(ungroupedTeam, name);
      workspaceService.save(classroom);
      rerender();
    })
  );
  section.appendChild(quickAddSlot);
  addStudentButton.addEventListener('click', () => {
    quickAddSlot.hidden = !quickAddSlot.hidden;
  });

  // Reuses the exact same CSV import pipeline as the initial Setup
  // Wizard (services/classroomImportService.js, ImportPreviewModal) —
  // restoring this as a second entry point, not a second
  // implementation. See this project's CHANGELOG for why this needed
  // restoring here at all.
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
            error instanceof ClassroomImportError
              ? error.message
              : 'Could not parse this file with the selected format.';
          return { teams: [], error: message };
        }
      },
      onConfirm: (formatId) => {
        const { teams } = classroomImportService.parseWithFormat(formatId, analysis.rows);
        const importedCount = teams.reduce((sum, team) => sum + team.students.length, 0);
        // Set BEFORE calling importRosterIntoClassroom, not after: that
        // function's internal save synchronously triggers this app's
        // real-time classroom subscription, which re-renders this
        // whole view immediately — before any code written after the
        // call below would even run. The flag needs to already be set
        // by the time that happens.
        pendingImportSuccess = { count: importedCount };
        // importRosterIntoClassroom() looks up its own fresh classroom
        // reference internally and persists it directly — it does NOT
        // operate on this function's own `classroom` closure variable.
        // Calling workspaceService.save(classroom) again afterward,
        // using this stale reference, would overwrite the correct
        // import with data that never had the imported teams applied
        // to it. Do not add a save call here. The real-time classroom
        // subscription this triggers internally already re-renders
        // this whole view with a fresh reference — an explicit
        // rerender() call here would use this closure's stale one
        // instead, so deliberately not adding one.
        workspaceService.importRosterIntoClassroom(classroom.id, teams);
      },
    });
  });
  section.appendChild(fileInput);

  if (!hasAnyStudents) {
    const emptyState = document.createElement('div');
    emptyState.className = 'settings-empty-state';

    const icon = document.createElement('span');
    icon.className = 'settings-empty-state__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\ud83d\udc65';

    const title = document.createElement('h3');
    title.className = 'settings-empty-state__title';
    title.textContent = 'Students';

    const message = document.createElement('p');
    message.className = 'settings-empty-state__message';
    message.textContent = "Your classroom doesn't have any students yet. Students can be added now and organized into groups later.";

    emptyState.append(icon, title, message);
    section.appendChild(emptyState);

    content.appendChild(section);
    return;
  }

  // Same reasoning as GroupsWidget.js and Class Mode's team-card grid:
  // a team with zero students would render as a heading with nothing
  // underneath it — an empty box, not useful information here. Such a
  // team is still fully manageable (renamed, colored, removed) from
  // Settings' own Groups tab; it simply won't have a block on this
  // student-focused list until it actually has a student in it.
  classroom.teams
    .filter((team) => team.students.length > 0)
    .forEach((team) => {
    const teamBlock = document.createElement('div');
    teamBlock.className = 'settings-team-block';

    const heading = document.createElement('h3');
    heading.className = 'settings-team-block__heading';
    heading.textContent = team.name;
    teamBlock.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'settings-editable-list';

    team.students.forEach((student) => {
      const item = document.createElement('li');
      item.className = 'settings-editable-list__item';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = student.name;
      input.addEventListener('change', () => {
        const newName = input.value.trim();
        if (!newName) {
          input.value = student.name;
          return;
        }
        studentService.renameStudent(team, student.id, newName);
        workspaceService.save(classroom);
      });

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'btn btn--text btn--danger-text';
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => {
        const confirmed = window.confirm(`Remove ${student.name} from ${team.name}?`);
        if (!confirmed) return;
        studentService.removeStudent(team, student.id);
        workspaceService.save(classroom);
        rerender();
      });

      item.append(input, removeButton);
      list.appendChild(item);
    });

    teamBlock.appendChild(list);
    section.appendChild(teamBlock);
  });

  content.appendChild(section);
}

/**
 * Shown once, immediately after a CSV import completes — a distinct
 * "you just did something big, here's what's next" moment, separate
 * from (and not a replacement for) the ongoing Teaching Assistant
 * recommendations on the Dashboard. Replaces the Settings content
 * area entirely rather than just toasting a message, since importing
 * a whole roster is exactly the kind of moment worth a real pause.
 */
function renderImportSuccess(content, importedCount, onOpenStudentAccess, onContinue) {
  content.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'settings-section settings-import-success';

  const checkmark = document.createElement('p');
  checkmark.className = 'settings-import-success__checkmark';
  checkmark.textContent = `\u2713 ${importedCount} student${importedCount === 1 ? '' : 's'} imported.`;

  const nextStep = document.createElement('p');
  nextStep.className = 'settings-import-success__next-step';
  nextStep.textContent = 'Next, invite your students to connect.';

  const openStudentAccessButton = document.createElement('button');
  openStudentAccessButton.type = 'button';
  openStudentAccessButton.className = 'btn btn--primary btn--large';
  openStudentAccessButton.textContent = 'Open Student Access';
  openStudentAccessButton.addEventListener('click', onOpenStudentAccess);

  const continueLink = document.createElement('button');
  continueLink.type = 'button';
  continueLink.className = 'btn btn--text';
  continueLink.textContent = 'Continue to Students';
  continueLink.addEventListener('click', onContinue);

  wrapper.append(checkmark, nextStep, openStudentAccessButton, continueLink);
  content.appendChild(wrapper);
}


function renderNotebooksSection(content, classroom, rerender) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const heading = document.createElement('h3');
  heading.className = 'settings-team-block__heading';
  heading.textContent = 'Subjects & Notebook Types';
  section.appendChild(heading);

  const note = document.createElement('p');
  note.className = 'settings-section__meta';
  note.textContent = 'Configure the subjects and notebook types this classroom uses for Notebook Tracker.';
  section.appendChild(note);

  const subjects = notebookConfigService.listSubjects(classroom);

  if (subjects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'No subjects yet \u2014 add one below to get started.';
    section.appendChild(empty);
  }

  subjects.forEach((subject) => {
    const subjectBlock = document.createElement('div');
    subjectBlock.className = 'settings-team-block';

    const subjectRow = document.createElement('div');
    subjectRow.className = 'settings-editable-list__item';

    const subjectInput = document.createElement('input');
    subjectInput.type = 'text';
    subjectInput.value = subject.name;
    subjectInput.addEventListener('change', () => {
      const newName = subjectInput.value.trim();
      if (!newName) {
        subjectInput.value = subject.name;
        return;
      }
      notebookConfigService.renameSubject(classroom, subject.id, newName);
      workspaceService.save(classroom);
    });

    const removeSubjectButton = document.createElement('button');
    removeSubjectButton.type = 'button';
    removeSubjectButton.className = 'btn btn--text btn--danger-text';
    removeSubjectButton.textContent = 'Remove Subject';
    removeSubjectButton.addEventListener('click', () => {
      const confirmed = window.confirm(
        `Remove ${subject.name}? Its notebook types will be removed too.`
      );
      if (!confirmed) return;
      notebookConfigService.removeSubject(classroom, subject.id);
      workspaceService.save(classroom);
      rerender();
    });

    subjectRow.append(subjectInput, removeSubjectButton);
    subjectBlock.appendChild(subjectRow);

    const typesList = document.createElement('ul');
    typesList.className = 'settings-editable-list';
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((type) => {
      const typeItem = document.createElement('li');
      typeItem.className = 'settings-editable-list__item';

      const typeInput = document.createElement('input');
      typeInput.type = 'text';
      typeInput.value = type.name;
      typeInput.addEventListener('change', () => {
        const newName = typeInput.value.trim();
        if (!newName) {
          typeInput.value = type.name;
          return;
        }
        notebookConfigService.renameNotebookType(classroom, type.id, newName);
        workspaceService.save(classroom);
      });

      const removeTypeButton = document.createElement('button');
      removeTypeButton.type = 'button';
      removeTypeButton.className = 'btn btn--text btn--danger-text';
      removeTypeButton.textContent = 'Remove';
      removeTypeButton.addEventListener('click', () => {
        notebookConfigService.removeNotebookType(classroom, type.id);
        workspaceService.save(classroom);
        rerender();
      });

      typeItem.append(typeInput, removeTypeButton);
      typesList.appendChild(typeItem);
    });
    subjectBlock.appendChild(typesList);

    subjectBlock.appendChild(
      createChipPicker(['Handwriting', 'Classwork', 'Homework', 'Reading Log'], (name) => {
        notebookConfigService.addNotebookType(classroom, subject.id, name);
        workspaceService.save(classroom);
        rerender();
      })
    );

    section.appendChild(subjectBlock);
  });

  section.appendChild(
    createChipPicker(['English', 'Mathematics', 'Science', 'Social Science'], (name) => {
      notebookConfigService.addSubject(classroom, name);
      workspaceService.save(classroom);
      rerender();
    })
  );

  content.appendChild(section);
}

/**
 * The core "click instead of type" building block — a row of chips
 * for the common choices, plus one "Other..." chip that reveals a
 * text field only when the teacher actually needs a custom value.
 * Shared between subjects and notebook types rather than two
 * near-identical implementations.
 */
function createChipPicker(commonOptions, onSelect) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-chip-picker';

  const chipRow = document.createElement('div');
  chipRow.className = 'settings-chip-picker__row';

  const customSlot = document.createElement('div');
  customSlot.hidden = true;
  customSlot.appendChild(
    createAddForm('Type your own', 'Add', (name) => onSelect(name))
  );

  commonOptions.forEach((optionLabel) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'settings-chip';
    chip.textContent = optionLabel;
    chip.addEventListener('click', () => onSelect(optionLabel));
    chipRow.appendChild(chip);
  });

  const otherChip = document.createElement('button');
  otherChip.type = 'button';
  otherChip.className = 'settings-chip settings-chip--other';
  otherChip.textContent = 'Other\u2026';
  otherChip.addEventListener('click', () => {
    customSlot.hidden = !customSlot.hidden;
  });
  chipRow.appendChild(otherChip);

  wrapper.append(chipRow, customSlot);
  return wrapper;
}

function renderGroupsSection(content, classroom, rerender) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const list = document.createElement('ul');
  list.className = 'settings-editable-list';

  // The Ungrouped team (see classroomService.js's getOrCreateUngroupedTeam)
  // isn't a group the teacher created — it's the automatic home for
  // students not yet assigned anywhere — so it's deliberately excluded
  // here. It still appears normally in Class Mode and the Students tab,
  // where every student needs to show up regardless of grouping.
  classroom.teams.filter((team) => !team.isUngrouped).forEach((team) => {
    const item = document.createElement('li');
    item.className = 'settings-editable-list__item';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = team.name;
    input.addEventListener('change', () => {
      const newName = input.value.trim();
      if (!newName) {
        input.value = team.name;
        return;
      }
      teamService.renameTeam(classroom, team.id, newName);
      workspaceService.save(classroom);
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text btn--danger-text';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      const confirmed = window.confirm(
        `Remove ${team.name}? Its ${team.students.length} student(s) will be removed too.`
      );
      if (!confirmed) return;
      teamService.removeTeam(classroom, team.id);
      workspaceService.save(classroom);
      rerender();
    });

    item.append(input, removeButton);
    list.appendChild(item);
  });

  section.appendChild(list);
  section.appendChild(
    createAddForm('New group name', 'Add group', (name) => {
      teamService.addTeam(classroom, name);
      workspaceService.save(classroom);
      rerender();
    })
  );

  content.appendChild(section);
}

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

function createAddForm(placeholder, buttonLabel, onAdd) {
  const form = document.createElement('div');
  form.className = 'settings-add-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--ghost';
  button.textContent = buttonLabel;
  button.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) return;
    onAdd(value);
  });

  form.append(input, button);
  return form;
}

function formatPermissionLabel(permission) {
  return permission.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
