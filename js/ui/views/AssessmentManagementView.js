/**
 * ui/views/AssessmentManagementView.js
 *
 * Assessment Management — a school-administration record-keeping
 * module, deliberately independent of Learning Management. Per
 * explicit product decision: no Concept Mapping, no Learning
 * Resources, no report cards or Learning Analytics — this file's own
 * ranking (see renderSubjectStep()) is explicitly the one form of
 * calculation this module does own, added in this milestone.
 *
 * The only connection to Learning Management anywhere in this file:
 * reading which Subjects exist in this classroom and their current
 * titles (services/assessmentService.js's getSubjectTitle(), itself
 * reading services/learningRecordService.js's getSubjects()). Nothing
 * here reads Units, Concepts, curriculum links, or Resources.
 *
 * Subjects and students are referenced by id, never copied — a
 * Subject renamed in Learning Management, or a student renamed in the
 * roster, is reflected here automatically the next time this renders,
 * since every render resolves the current title/name live rather than
 * reading a value stored on the Assessment itself. See
 * models/AssessmentSubject.js and models/StudentResult.js for the
 * full reasoning.
 */

import { createBackButton } from '../components/BackButton.js';
import { ASSESSMENT_TYPES } from '../../config/assessmentTypesConfig.js';
import { openCreateAssessmentModal } from '../components/CreateAssessmentModal.js';
import { openAddSubjectToAssessmentModal } from '../components/AddSubjectToAssessmentModal.js';
import { createNavigationRow } from '../components/NavigationRow.js';
import { openUnsavedChangesModal } from '../components/UnsavedChangesModal.js';
import * as assessmentService from '../../services/assessmentService.js';
import * as workspaceService from '../../services/workspaceService.js';

export function renderAssessmentManagementView(container, { classroom, onBack }) {
  let mode = 'home';
  let selectedAssessment = null;
  let selectedAssessmentSubject = null;
  let sortBy = 'name'; // 'name' | 'rollNumber' | 'marks' | 'rank' — reset whenever a different Subject is opened

  // The document-editor state for marks entry (see renderSubjectStep()
  // below). `isEditingMarks` is an explicit override once something
  // has already been saved once — a Subject with `lastSavedAt: null`
  // is always in edit mode regardless of this flag, matching "Initially"
  // in the requested design. `marksDraft` is the buffered, unsaved copy
  // of maximumMarks + every student's result; nothing here touches the
  // real `classroom` data until Save is actually clicked.
  let isEditingMarks = false;
  let marksDraft = null;
  let hasUnsavedMarksChanges = false;

  // The same document-editor pattern applied to Assessment Details
  // (name, type, academic year, date) — see renderAssessmentStep()
  // below. Unlike marks entry, this never starts forced into edit
  // mode: the details are already correct the moment an Assessment is
  // created via Create Assessment, so there's nothing to force
  // editing on immediately.
  let isEditingAssessmentDetails = false;
  let assessmentDetailsDraft = null;
  let hasUnsavedAssessmentDetailsChanges = false;

  function rerender() {
    renderView(
      container,
      mode,
      {
        classroom,
        selectedAssessment,
        selectedAssessmentSubject,
        sortBy,
        isEditingMarks: isCurrentlyEditingMarks(),
        marksDraft,
        isEditingAssessmentDetails,
        assessmentDetailsDraft,
      },
      handlers
    );
  }

  function isCurrentlyEditingMarks() {
    return isEditingMarks || (selectedAssessmentSubject && selectedAssessmentSubject.lastSavedAt === null);
  }

  function buildMarksDraftFrom(assessmentSubject) {
    const resultsByStudentId = new Map();
    assessmentService.getClassroomStudents(classroom).forEach((student) => {
      const existing = assessmentService.getStudentResult(assessmentSubject, student.id);
      resultsByStudentId.set(student.id, {
        marks: existing ? existing.marks : null,
        absent: existing ? existing.absent : false,
        remarks: existing ? existing.remarks : '',
      });
    });
    return { maximumMarks: assessmentSubject.maximumMarks, resultsByStudentId };
  }

  function buildAssessmentDetailsDraftFrom(assessment) {
    return { title: assessment.title, type: assessment.type, academicYear: assessment.academicYear, date: assessment.date };
  }

  /**
   * The single gate every navigation-away action goes through while
   * either Assessment Details or marks entry might be mid-edit — "If
   * the teacher edits ... and attempts to leave" applies the same
   * whether they're going Back or jumping straight to a different
   * Subject/Assessment, and the same whether it's Assessment Details
   * or Student Marks that's unsaved.
   */
  function navigateAwayGuard(proceed) {
    if (mode === 'subject' && hasUnsavedMarksChanges) {
      openUnsavedChangesModal({
        onSave: () => {
          handlers.onSaveMarks();
          proceed();
        },
        onDiscard: () => {
          hasUnsavedMarksChanges = false;
          isEditingMarks = false;
          proceed();
        },
        onCancel: () => {},
      });
      return;
    }
    if (mode === 'assessment' && hasUnsavedAssessmentDetailsChanges) {
      openUnsavedChangesModal({
        onSave: () => {
          handlers.onSaveAssessmentDetails();
          proceed();
        },
        onDiscard: () => {
          hasUnsavedAssessmentDetailsChanges = false;
          isEditingAssessmentDetails = false;
          proceed();
        },
        onCancel: () => {},
      });
      return;
    }
    proceed();
  }

  const handlers = {
    onBack,
    onGoToCreateAssessment: () => {
      openCreateAssessmentModal({
        classroom,
        onAssessmentCreated: () => rerender(),
      });
    },
    onChooseAssessment: (assessment) => {
      navigateAwayGuard(() => {
        selectedAssessment = assessment;
        isEditingAssessmentDetails = false;
        hasUnsavedAssessmentDetailsChanges = false;
        mode = 'assessment';
        rerender();
      });
    },
    onChooseAssessmentSubject: (assessmentSubject) => {
      navigateAwayGuard(() => {
        selectedAssessmentSubject = assessmentSubject;
        sortBy = 'name';
        isEditingMarks = false;
        marksDraft = buildMarksDraftFrom(assessmentSubject);
        mode = 'subject';
        rerender();
      });
    },
    onGoToAddSubject: () => {
      openAddSubjectToAssessmentModal({
        classroom,
        assessment: selectedAssessment,
        onSubjectsAdded: () => rerender(),
      });
    },
    onGoToEditAssessment: (assessment) => {
      // "Edit Assessment" from the Assessment Home card's overflow
      // menu navigates straight into the Assessment, already in edit
      // mode for its Details section — no separate modal.
      navigateAwayGuard(() => {
        selectedAssessment = assessment;
        isEditingAssessmentDetails = true;
        assessmentDetailsDraft = buildAssessmentDetailsDraftFrom(assessment);
        hasUnsavedAssessmentDetailsChanges = false;
        mode = 'assessment';
        rerender();
      });
    },
    onDeleteAssessment: (assessment) => {
      const confirmed = window.confirm(`Delete "${assessment.title}"?\n\nThis removes every Subject and every mark recorded in it. This cannot be undone.`);
      if (!confirmed) return;
      assessmentService.deleteAssessment(classroom, assessment.id);
      workspaceService.save(classroom);
      mode = 'home';
      rerender();
    },
    onRemoveSubjectFromAssessment: (assessmentSubject) => {
      const subjectTitle = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId) || 'this subject';
      const confirmed = window.confirm(`Remove "${subjectTitle}" from this assessment?\n\nThis removes every mark recorded for it in this assessment only \u2014 the Subject itself is unaffected in Learning. This cannot be undone.`);
      if (!confirmed) return;
      assessmentService.removeSubjectFromAssessment(selectedAssessment, assessmentSubject.subjectId);
      workspaceService.save(classroom);
      // Always triggered from this Subject's own page now (its
      // Settings menu, not the Subjects list) — there's no longer a
      // Subject to show, so land back on the Assessment detail
      // screen rather than re-rendering the page we just removed.
      mode = 'assessment';
      rerender();
    },
    onBackTo: (targetMode) => {
      navigateAwayGuard(() => {
        mode = targetMode;
        rerender();
      });
    },
    onGoToEditMarks: () => {
      isEditingMarks = true;
      marksDraft = buildMarksDraftFrom(selectedAssessmentSubject);
      hasUnsavedMarksChanges = false;
      rerender();
    },
    onDraftMaximumMarksChange: (value) => {
      marksDraft.maximumMarks = value;
      hasUnsavedMarksChanges = true;
      rerender();
    },
    onDraftStudentFieldChange: (studentId, updates) => {
      Object.assign(marksDraft.resultsByStudentId.get(studentId), updates);
      hasUnsavedMarksChanges = true;
      rerender();
    },
    onSaveMarks: () => {
      assessmentService.saveAssessmentSubjectDraft(selectedAssessmentSubject, marksDraft);
      workspaceService.save(classroom);
      isEditingMarks = false;
      hasUnsavedMarksChanges = false;
      rerender();
    },
    onCancelEditMarks: () => {
      // Discards the draft entirely, reverting to whatever's
      // currently saved — for a Subject that's never been saved at
      // all ("Initially"), there's nothing saved to fall back to, so
      // this just resets the draft to empty and stays in edit mode
      // (isCurrentlyEditingMarks() still forces it, since
      // lastSavedAt is still null).
      marksDraft = buildMarksDraftFrom(selectedAssessmentSubject);
      isEditingMarks = false;
      hasUnsavedMarksChanges = false;
      rerender();
    },
    onChangeSortBy: (newSortBy) => {
      sortBy = newSortBy;
      rerender();
    },
    onGoToEditAssessmentDetails: () => {
      isEditingAssessmentDetails = true;
      assessmentDetailsDraft = buildAssessmentDetailsDraftFrom(selectedAssessment);
      hasUnsavedAssessmentDetailsChanges = false;
      rerender();
    },
    onDraftAssessmentDetailsChange: (updates) => {
      Object.assign(assessmentDetailsDraft, updates);
      hasUnsavedAssessmentDetailsChanges = true;
      rerender();
    },
    onSaveAssessmentDetails: () => {
      assessmentService.updateAssessmentDetails(selectedAssessment, assessmentDetailsDraft);
      workspaceService.save(classroom);
      isEditingAssessmentDetails = false;
      hasUnsavedAssessmentDetailsChanges = false;
      rerender();
    },
    onCancelEditAssessmentDetails: () => {
      assessmentDetailsDraft = buildAssessmentDetailsDraftFrom(selectedAssessment);
      isEditingAssessmentDetails = false;
      hasUnsavedAssessmentDetailsChanges = false;
      rerender();
    },
  };

  rerender();
}

function renderView(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management'; // reuses the same page chrome styling as other modules

  const header = document.createElement('header');
  header.className = 'learning-management__header';

  const isEntryStep = mode === 'home';

  const backButton = createBackButton(() => {
    if (isEntryStep) return handlers.onBack();
    const previous = { assessment: 'home', subject: 'assessment' }[mode];
    handlers.onBackTo(previous);
  });
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = 'Assessments';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'assessment') {
    wrapper.appendChild(renderAssessmentStep(state.classroom, state.selectedAssessment, state.isEditingAssessmentDetails, state.assessmentDetailsDraft, handlers));
  } else if (mode === 'subject') {
    wrapper.appendChild(
      renderSubjectStep(state.classroom, state.selectedAssessment, state.selectedAssessmentSubject, state.sortBy, state.isEditingMarks, state.marksDraft, handlers)
    );
  } else {
    wrapper.appendChild(renderHomeStep(state.classroom, handlers));
  }

  container.appendChild(wrapper);
}

/**
 * Renders exactly the classroom's own persisted Assessments — nothing
 * else. Empty means empty; no suggested or placeholder assessments
 * ever appear.
 */
function renderHomeStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const assessments = assessmentService.getAssessments(classroom);
  if (assessments.length > 0) {
    const list = document.createElement('div');
    list.className = 'learning-management__subject-card-list';
    assessments.forEach((assessment) => {
      list.appendChild(createNavigationRow({ label: assessment.title, onClick: () => handlers.onChooseAssessment(assessment) }));
    });
    section.appendChild(list);
  }

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = '+ Create Assessment';
  createButton.addEventListener('click', handlers.onGoToCreateAssessment);
  section.appendChild(createButton);

  return section;
}

/**
 * Assessment Details (name, type, academic year, date) as an inline
 * View/Edit section, same pattern as marks entry — read-only with
 * "Last saved" + Edit by default (details are already correct the
 * moment the Assessment is created, so there's no "Initially
 * editable" state here the way marks entry has); editable with
 * Save/Cancel once "Edit" is clicked.
 *
 * Subjects included are listed below, by their *current* titles —
 * resolved live via services/assessmentService.js's getSubjectTitle(),
 * not read from anything stored on the AssessmentSubject itself. A
 * Subject that no longer exists (removed from Learning Management
 * since this Assessment was created) is shown honestly rather than
 * hidden or silently skipped.
 *
 * "+ Add Subject" only ever offers Subjects that already exist in
 * Learning Management and aren't yet part of this Assessment (see
 * ui/components/AddSubjectToAssessmentModal.js) — it never creates a
 * new classroom Subject.
 */
function renderAssessmentStep(classroom, assessment, isEditingDetails, draft, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = assessment.title;
  section.appendChild(heading);

  section.appendChild(renderAssessmentDetailsSection(assessment, isEditingDetails, draft, handlers));

  const divider = document.createElement('hr');
  divider.className = 'learning-management__subject-divider';
  section.appendChild(divider);

  const subjectsHeading = document.createElement('p');
  subjectsHeading.className = 'learning-management__intro';
  subjectsHeading.textContent = 'Subjects';
  section.appendChild(subjectsHeading);

  const list = document.createElement('div');
  list.className = 'learning-management__subject-card-list';
  assessment.assessmentSubjects.forEach((assessmentSubject) => {
    const subjectTitle = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId);
    list.appendChild(createNavigationRow({ label: subjectTitle || '(Subject removed)', onClick: () => handlers.onChooseAssessmentSubject(assessmentSubject) }));
  });
  section.appendChild(list);

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--primary';
  addSubjectButton.textContent = '+ Add Subject';
  addSubjectButton.addEventListener('click', handlers.onGoToAddSubject);
  section.appendChild(addSubjectButton);

  section.appendChild(renderAssessmentDangerZone(assessment, handlers));

  return section;
}

/**
 * A visually distinct section for rare, destructive actions — set
 * apart from the rest of the page by styling alone, never hidden
 * behind a menu. "Edit Assessment" doesn't need a place here: it's
 * already the Assessment Details section's own View/Edit toggle
 * above, not a separate action.
 */
function renderAssessmentDangerZone(assessment, handlers) {
  const zone = document.createElement('div');
  zone.className = 'learning-management__danger-zone';

  const zoneHeading = document.createElement('p');
  zoneHeading.className = 'learning-management__danger-zone-heading';
  zoneHeading.textContent = 'Danger Zone';
  zone.appendChild(zoneHeading);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--danger';
  deleteButton.textContent = 'Delete Assessment';
  deleteButton.addEventListener('click', () => handlers.onDeleteAssessment(assessment));
  zone.appendChild(deleteButton);

  return zone;
}

function renderAssessmentDetailsSection(assessment, isEditingDetails, draft, handlers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'assessment-details-section';

  if (isEditingDetails) {
    const nameField = createLabeledInput('Assessment Name');
    nameField.input.value = draft.title;
    nameField.input.addEventListener('change', () => handlers.onDraftAssessmentDetailsChange({ title: nameField.input.value.trim() }));
    wrapper.appendChild(nameField.wrapper);

    const typeField = createLabeledSelect('Assessment Type', ASSESSMENT_TYPES);
    typeField.select.value = draft.type;
    typeField.select.addEventListener('change', () => handlers.onDraftAssessmentDetailsChange({ type: typeField.select.value }));
    wrapper.appendChild(typeField.wrapper);

    const yearField = createLabeledInput('Academic Year');
    yearField.input.value = draft.academicYear;
    yearField.input.addEventListener('change', () => handlers.onDraftAssessmentDetailsChange({ academicYear: yearField.input.value.trim() }));
    wrapper.appendChild(yearField.wrapper);

    const dateField = createLabeledInput('Date');
    dateField.input.type = 'date';
    dateField.input.value = draft.date;
    dateField.input.addEventListener('change', () => handlers.onDraftAssessmentDetailsChange({ date: dateField.input.value }));
    wrapper.appendChild(dateField.wrapper);

    const footer = document.createElement('div');
    footer.className = 'assessment-marks-footer';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--primary';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', handlers.onSaveAssessmentDetails);
    footer.appendChild(saveButton);
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', handlers.onCancelEditAssessmentDetails);
    footer.appendChild(cancelButton);
    wrapper.appendChild(footer);
  } else {
    const details = document.createElement('dl');
    details.className = 'assessment-details-section__view';
    [
      ['Type', assessment.type],
      ['Academic Year', assessment.academicYear],
      ['Date', assessment.date],
    ].forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value || '\u2014';
      details.append(dt, dd);
    });
    wrapper.appendChild(details);

    const footer = document.createElement('div');
    footer.className = 'assessment-marks-footer';
    const lastSaved = document.createElement('p');
    lastSaved.className = 'assessment-marks-footer__last-saved';
    lastSaved.textContent = `Last saved: ${formatSavedTimestamp(assessment.detailsLastSavedAt || assessment.createdAt)}`;
    footer.appendChild(lastSaved);
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn--primary';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', handlers.onGoToEditAssessmentDetails);
    footer.appendChild(editButton);
    wrapper.appendChild(footer);
  }

  return wrapper;
}

function createLabeledInput(labelText) {
  const wrapper = document.createElement('label');
  wrapper.className = 'create-assessment-modal__labeled-input';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  wrapper.append(label, input);
  return { wrapper, input };
}

function createLabeledSelect(labelText, options) {
  const wrapper = document.createElement('label');
  wrapper.className = 'create-assessment-modal__labeled-input';
  const label = document.createElement('span');
  label.textContent = labelText;
  const select = document.createElement('select');
  options.forEach((optionText) => {
    const option = document.createElement('option');
    option.value = optionText;
    option.textContent = optionText;
    select.appendChild(option);
  });
  wrapper.append(label, select);
  return { wrapper, select };
}

/**
 * Marks entry, as a document editor rather than a live form — per
 * explicit product decision. "Initially" (never saved:
 * `assessmentSubject.lastSavedAt === null`) or after clicking "Edit",
 * every field is editable and changes are held in `draft`, not
 * written to the real AssessmentSubject at all until "Save" is
 * clicked. Once saved, fields become read-only, showing "Last saved:
 * ..." and an "Edit" action instead of "Save" — this is what prevents
 * a stray tap from silently altering a mark that's already been
 * recorded.
 *
 * Rank (see services/assessmentService.js's computeRankings()) is
 * always computed from the real, already-saved data — not the
 * in-progress draft — consistent with "document editor, not live
 * form": nothing elsewhere on this screen reacts to an edit that
 * hasn't been saved yet.
 */
function renderSubjectStep(classroom, assessment, assessmentSubject, sortBy, isEditing, draft, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const subjectTitle = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId);

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = subjectTitle || '(Subject removed)';
  section.appendChild(heading);

  const maxMarksLabel = document.createElement('label');
  maxMarksLabel.className = 'assessment-max-marks';
  maxMarksLabel.append('Maximum Marks:');
  if (isEditing) {
    const maxMarksInput = document.createElement('input');
    maxMarksInput.type = 'number';
    maxMarksInput.className = 'assessment-max-marks__input';
    maxMarksInput.value = draft.maximumMarks;
    maxMarksInput.min = '1';
    maxMarksInput.addEventListener('change', () => {
      const value = Number(maxMarksInput.value);
      if (!Number.isFinite(value) || value <= 0) return;
      handlers.onDraftMaximumMarksChange(value);
    });
    maxMarksLabel.appendChild(maxMarksInput);
  } else {
    const maxMarksValue = document.createElement('strong');
    maxMarksValue.textContent = String(assessmentSubject.maximumMarks);
    maxMarksLabel.appendChild(maxMarksValue);
  }
  section.appendChild(maxMarksLabel);

  const studentsHeadingRow = document.createElement('div');
  studentsHeadingRow.className = 'assessment-students-heading-row';
  const studentsHeading = document.createElement('p');
  studentsHeading.className = 'learning-management__intro';
  studentsHeading.textContent = 'Students';
  studentsHeadingRow.appendChild(studentsHeading);

  const sortLabel = document.createElement('label');
  sortLabel.className = 'assessment-sort-control';
  sortLabel.append('Sort by:');
  const sortSelect = document.createElement('select');
  [
    { value: 'name', label: 'Name' },
    { value: 'rollNumber', label: 'Roll Number' },
    { value: 'marks', label: 'Marks' },
    { value: 'rank', label: 'Rank' },
  ].forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === sortBy) option.selected = true;
    sortSelect.appendChild(option);
  });
  sortSelect.addEventListener('change', () => handlers.onChangeSortBy(sortSelect.value));
  sortLabel.appendChild(sortSelect);
  studentsHeadingRow.appendChild(sortLabel);
  section.appendChild(studentsHeadingRow);

  const students = assessmentService.getClassroomStudents(classroom);
  const rankings = assessmentService.computeRankings(assessmentSubject, students);
  const sortedStudents = sortStudents(students, assessmentSubject, rankings, sortBy);

  const list = document.createElement('div');
  list.className = 'assessment-marks-entry__list';
  sortedStudents.forEach((student) => {
    const rank = rankings.get(student.id);
    if (isEditing) {
      list.appendChild(renderEditableStudentRow(student, draft.resultsByStudentId.get(student.id), rank, handlers));
    } else {
      const existingResult = assessmentService.getStudentResult(assessmentSubject, student.id);
      list.appendChild(renderReadOnlyStudentRow(student, existingResult, rank));
    }
  });
  section.appendChild(list);

  const footer = document.createElement('div');
  footer.className = 'assessment-marks-footer';

  if (isEditing) {
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--primary';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', handlers.onSaveMarks);
    footer.appendChild(saveButton);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', handlers.onCancelEditMarks);
    footer.appendChild(cancelButton);
  } else {
    const lastSaved = document.createElement('p');
    lastSaved.className = 'assessment-marks-footer__last-saved';
    lastSaved.textContent = `Last saved: ${formatSavedTimestamp(assessmentSubject.lastSavedAt)}`;
    footer.appendChild(lastSaved);

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn--primary';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', handlers.onGoToEditMarks);
    footer.appendChild(editButton);
  }
  section.appendChild(footer);

  const zone = document.createElement('div');
  zone.className = 'learning-management__danger-zone';
  const zoneHeading = document.createElement('p');
  zoneHeading.className = 'learning-management__danger-zone-heading';
  zoneHeading.textContent = 'Danger Zone';
  zone.appendChild(zoneHeading);
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn--danger';
  removeButton.textContent = 'Remove from Assessment';
  removeButton.addEventListener('click', () => handlers.onRemoveSubjectFromAssessment(assessmentSubject));
  zone.appendChild(removeButton);
  section.appendChild(zone);

  return section;
}

function formatSavedTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const datePart = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} \u2022 ${timePart}`;
}

/**
 * Reorders a copy of the student list for display only — never
 * mutates the roster or any stored data. Students with no marks/rank
 * sort to the end regardless of the chosen order, so an unfilled row
 * never lands ambiguously in the middle of a marks- or rank-sorted
 * list.
 */
function sortStudents(students, assessmentSubject, rankings, sortBy) {
  const copy = [...students];
  if (sortBy === 'name') {
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (sortBy === 'rollNumber') {
    return copy.sort((a, b) => {
      if (a.rollNumber === null && b.rollNumber === null) return a.name.localeCompare(b.name);
      if (a.rollNumber === null) return 1;
      if (b.rollNumber === null) return -1;
      return a.rollNumber - b.rollNumber;
    });
  }
  if (sortBy === 'marks') {
    return copy.sort((a, b) => {
      const resultA = assessmentService.getStudentResult(assessmentSubject, a.id);
      const resultB = assessmentService.getStudentResult(assessmentSubject, b.id);
      const marksA = resultA && !resultA.absent ? resultA.marks : null;
      const marksB = resultB && !resultB.absent ? resultB.marks : null;
      if (marksA === null && marksB === null) return a.name.localeCompare(b.name);
      if (marksA === null) return 1;
      if (marksB === null) return -1;
      return marksB - marksA;
    });
  }
  // sortBy === 'rank'
  return copy.sort((a, b) => {
    const rankA = rankings.get(a.id);
    const rankB = rankings.get(b.id);
    if (rankA === null && rankB === null) return a.name.localeCompare(b.name);
    if (rankA === null) return 1;
    if (rankB === null) return -1;
    return rankA - rankB;
  });
}

function renderEditableStudentRow(student, draftResult, rank, handlers) {
  const row = document.createElement('div');
  row.className = 'assessment-marks-entry__row';

  const rankEl = document.createElement('span');
  rankEl.className = 'assessment-marks-entry__rank';
  rankEl.textContent = rank === null || rank === undefined ? '-' : `#${rank}`;
  row.appendChild(rankEl);

  const nameEl = document.createElement('span');
  nameEl.className = 'assessment-marks-entry__name';
  nameEl.textContent = student.name;
  row.appendChild(nameEl);

  const marksInput = document.createElement('input');
  marksInput.type = 'number';
  marksInput.className = 'assessment-marks-entry__marks';
  marksInput.placeholder = 'Marks';
  marksInput.value = draftResult.marks !== null ? draftResult.marks : '';
  marksInput.addEventListener('change', () => {
    const value = marksInput.value === '' ? null : Number(marksInput.value);
    handlers.onDraftStudentFieldChange(student.id, { marks: value });
  });
  row.appendChild(marksInput);

  const absentLabel = document.createElement('label');
  absentLabel.className = 'assessment-marks-entry__absent-label';
  const absentCheckbox = document.createElement('input');
  absentCheckbox.type = 'checkbox';
  absentCheckbox.checked = draftResult.absent;
  absentCheckbox.addEventListener('change', () => {
    handlers.onDraftStudentFieldChange(student.id, { absent: absentCheckbox.checked });
  });
  absentLabel.append(absentCheckbox, 'Absent');
  row.appendChild(absentLabel);

  const remarksInput = document.createElement('input');
  remarksInput.type = 'text';
  remarksInput.className = 'assessment-marks-entry__remarks';
  remarksInput.placeholder = 'Remarks';
  remarksInput.value = draftResult.remarks;
  remarksInput.addEventListener('change', () => {
    handlers.onDraftStudentFieldChange(student.id, { remarks: remarksInput.value });
  });
  row.appendChild(remarksInput);

  return row;
}

function renderReadOnlyStudentRow(student, existingResult, rank) {
  const row = document.createElement('div');
  row.className = 'assessment-marks-entry__row assessment-marks-entry__row--readonly';

  const rankEl = document.createElement('span');
  rankEl.className = 'assessment-marks-entry__rank';
  rankEl.textContent = rank === null || rank === undefined ? '-' : `#${rank}`;
  row.appendChild(rankEl);

  const nameEl = document.createElement('span');
  nameEl.className = 'assessment-marks-entry__name';
  nameEl.textContent = student.name;
  row.appendChild(nameEl);

  const marksEl = document.createElement('span');
  marksEl.className = 'assessment-marks-entry__marks-readonly';
  if (existingResult && existingResult.absent) {
    marksEl.textContent = 'Absent';
  } else if (existingResult && existingResult.marks !== null) {
    marksEl.textContent = String(existingResult.marks);
  } else {
    marksEl.textContent = '\u2014';
  }
  row.appendChild(marksEl);

  const remarksEl = document.createElement('span');
  remarksEl.className = 'assessment-marks-entry__remarks-readonly';
  remarksEl.textContent = existingResult && existingResult.remarks ? existingResult.remarks : '';
  row.appendChild(remarksEl);

  return row;
}
