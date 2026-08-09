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
import * as assessmentImportService from '../../services/assessmentImportService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { getCurrentIsoDate } from '../../utils/dateHelpers.js';
import { getMarksColorClass } from '../../config/assessmentMarksColorConfig.js';

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

  // The Gradebook (see renderGradebookStep() below) autosaves rather
  // than using the marksDraft/Save-button pattern above — each edit
  // updates `classroom` in memory immediately (so the grid always
  // reflects the latest value), but the actual Firestore write is
  // debounced, per the explicit "avoid one write per keystroke"
  // requirement. One shared debounce handle for the whole grid (not
  // per-cell) — simpler, and a teacher entering many marks in a row
  // already naturally batches into one write shortly after they
  // pause. dirtySubjectsSinceLastSave tracks every AssessmentSubject
  // touched since the last flush, since edits can span more than one
  // subject column within a single debounce window.
  let gradebookSaveTimeoutId = null;
  const dirtySubjectsSinceLastSave = new Set();
  const GRADEBOOK_SAVE_DEBOUNCE_MS = 800;

  // Assessment Import — Phase 1 (see services/assessmentImportService.js's
  // own header comment for the full architecture). Everything here is
  // held only in memory between a file being selected and the teacher's
  // own Cancel/Import decision on the review screen — nothing is written
  // to `classroom` or persisted until "Import" is actually clicked.
  let importReview = null; // { matchedRows, unmatchedRows, subjectMatches, unmatchedColumns, summary } once a file has been parsed and matched
  let importError = null; // a plain string shown on the review/upload screen if parsing itself failed (e.g. an unreadable file)

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
        importReview,
        importError,
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
    if (mode === 'gradebook') {
      flushGradebookSave();
      proceed();
      return;
    }
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

  /** Flushes any pending debounced Gradebook save immediately — called before navigating away, so nothing is ever silently lost to an in-flight debounce. */
  function flushGradebookSave() {
    if (gradebookSaveTimeoutId === null) return;
    clearTimeout(gradebookSaveTimeoutId);
    gradebookSaveTimeoutId = null;
    const now = getCurrentIsoDate();
    dirtySubjectsSinceLastSave.forEach((assessmentSubject) => {
      assessmentSubject.lastSavedAt = now;
    });
    dirtySubjectsSinceLastSave.clear();
    workspaceService.save(classroom);
  }

  function scheduleGradebookSave(assessmentSubject) {
    dirtySubjectsSinceLastSave.add(assessmentSubject);
    if (gradebookSaveTimeoutId !== null) clearTimeout(gradebookSaveTimeoutId);
    gradebookSaveTimeoutId = setTimeout(() => {
      gradebookSaveTimeoutId = null;
      const now = getCurrentIsoDate();
      dirtySubjectsSinceLastSave.forEach((subject) => {
        subject.lastSavedAt = now;
      });
      dirtySubjectsSinceLastSave.clear();
      workspaceService.save(classroom);
    }, GRADEBOOK_SAVE_DEBOUNCE_MS);
  }

  /**
   * The one place a Gradebook cell edit is applied — updates
   * `classroom` in memory immediately via the same, already-existing
   * recordStudentMarks() every other marks-entry path in this file
   * uses, then debounces the actual Firestore write. `marks` is
   * either a finite number or null (blank) — never coerced to 0, per
   * the same convention renderEditableStudentRow() above already
   * uses for the per-subject marks-entry screen.
   */
  function applyGradebookMarksEdit(assessmentSubject, studentId, marks) {
    assessmentService.recordStudentMarks(assessmentSubject, studentId, { marks });
    scheduleGradebookSave(assessmentSubject);
  }

  const handlers = {
    onGradebookMarksEdit: applyGradebookMarksEdit,
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
        mode = 'gradebook';
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
    onPublishAssessment: (assessment) => {
      const confirmed = window.confirm(`Publish "${assessment.title}"?\n\nThis notifies every student in this classroom that their results are available.`);
      if (!confirmed) return;
      const published = assessmentService.publishAssessment(classroom, assessment);
      if (published) {
        workspaceService.save(classroom);
        rerender();
      }
    },
    onImportFileSelected: async (file) => {
      importError = null;
      let rows;
      try {
        rows = await assessmentImportService.parseSpreadsheetFile(file);
      } catch (error) {
        importError = `Couldn't read this file. Please check it's a valid .xlsx or .csv file and try again.`;
        mode = 'import-review';
        rerender();
        return;
      }

      const students = assessmentService.getClassroomStudents(classroom);
      const { matchedRows, unmatchedRows, subjectColumns } = assessmentImportService.matchStudents(rows, students);
      const { matches: subjectMatches, unmatchedColumns } = assessmentImportService.matchSubjectColumns(
        subjectColumns,
        selectedAssessment.assessmentSubjects,
        classroom
      );
      const summary = assessmentImportService.buildImportSummary({ matchedRows, unmatchedRows, subjectMatches });

      importReview = { matchedRows, unmatchedRows, subjectMatches, unmatchedColumns, summary };
      mode = 'import-review';
      rerender();
    },
    onConfirmImport: () => {
      assessmentImportService.applyImport(classroom, {
        matchedRows: importReview.matchedRows,
        subjectMatches: importReview.subjectMatches,
      });
      workspaceService.save(classroom);
      importReview = null;
      importError = null;
      mode = 'assessment';
      rerender();
    },
    onCancelImport: () => {
      // Pure state discard — nothing was ever written to `classroom`
      // or persisted while on the review screen, so there is nothing
      // to undo here beyond clearing this view's own in-memory state.
      importReview = null;
      importError = null;
      mode = 'assessment';
      rerender();
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
      mode = 'assessment';
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
    if (mode === 'import-review') return handlers.onCancelImport();
    const previous = { assessment: 'gradebook', subject: 'assessment', gradebook: 'home' }[mode];
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
  } else if (mode === 'gradebook') {
    wrapper.appendChild(renderGradebookStep(state.classroom, state.selectedAssessment, handlers));
  } else if (mode === 'subject') {
    wrapper.appendChild(
      renderSubjectStep(state.classroom, state.selectedAssessment, state.selectedAssessmentSubject, state.sortBy, state.isEditingMarks, state.marksDraft, handlers)
    );
  } else if (mode === 'import-review') {
    wrapper.appendChild(renderImportReviewStep(state.selectedAssessment, state.importReview, state.importError, handlers));
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

  // Assessment Import — Phase 1 (see services/assessmentImportService.js).
  // A hidden file input triggered by a visible button click — the file
  // itself is never written anywhere; onImportFileSelected() only
  // parses and matches, landing on the Review screen before anything
  // is ever saved.
  const importFileInput = document.createElement('input');
  importFileInput.type = 'file';
  importFileInput.accept = '.xlsx,.csv';
  importFileInput.className = 'assessment-import__file-input';
  importFileInput.style.display = 'none';
  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    if (file) handlers.onImportFileSelected(file);
    importFileInput.value = ''; // allows re-selecting the same file name after Cancel, which a plain file input otherwise ignores
  });
  section.appendChild(importFileInput);

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'btn btn--secondary';
  importButton.textContent = 'Import Spreadsheet';
  importButton.addEventListener('click', () => importFileInput.click());
  section.appendChild(importButton);

  if (assessment.status === 'Draft') {
    const publishButton = document.createElement('button');
    publishButton.type = 'button';
    publishButton.className = 'btn btn--secondary learning-management__publish-assessment-button';
    publishButton.textContent = 'Publish Assessment';
    publishButton.addEventListener('click', () => handlers.onPublishAssessment(assessment));
    section.appendChild(publishButton);
  } else {
    const publishedNotice = document.createElement('p');
    publishedNotice.className = 'learning-management__publish-assessment-notice';
    publishedNotice.textContent = `\u2713 Published \u2014 students have been notified.`;
    section.appendChild(publishedNotice);
  }

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
/**
 * Assessment Import — Phase 1's own Review screen. Shown after a file
 * has been parsed and matched (see services/assessmentImportService.js),
 * before anything is saved — "Import" is the only action anywhere in
 * this flow that actually writes to `classroom`. Disabled while any
 * unmatched student exists, per explicit spec ("prevent import until
 * resolved") — this milestone doesn't build an in-app way to resolve
 * one manually; the teacher fixes the spreadsheet and re-uploads.
 */
function renderImportReviewStep(assessment, importReview, importError, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = assessment.title;
  section.appendChild(heading);

  if (importError) {
    const errorNotice = document.createElement('p');
    errorNotice.className = 'assessment-import__error';
    errorNotice.textContent = importError;
    section.appendChild(errorNotice);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Back';
    cancelButton.addEventListener('click', handlers.onCancelImport);
    section.appendChild(cancelButton);
    return section;
  }

  const { summary, unmatchedRows, unmatchedColumns } = importReview;

  const matchedRow = document.createElement('p');
  matchedRow.className = 'assessment-import__summary-line';
  matchedRow.append('Students matched');
  const matchedCount = document.createElement('strong');
  matchedCount.textContent = String(summary.studentsMatchedCount);
  matchedRow.appendChild(document.createElement('br'));
  matchedRow.appendChild(matchedCount);
  section.appendChild(matchedRow);

  const subjectsHeading = document.createElement('p');
  subjectsHeading.className = 'learning-management__intro';
  subjectsHeading.textContent = 'Subjects';
  section.appendChild(subjectsHeading);

  const subjectList = document.createElement('div');
  subjectList.className = 'assessment-import__subject-list';
  summary.perSubject.forEach(({ subjectTitle, withMarks, missing }) => {
    const row = document.createElement('div');
    row.className = 'assessment-import__subject-row';
    const title = document.createElement('p');
    title.className = 'assessment-import__subject-title';
    title.textContent = subjectTitle;
    row.appendChild(title);
    const marksLine = document.createElement('p');
    marksLine.className = 'assessment-import__subject-marks';
    marksLine.textContent = `${withMarks} mark${withMarks === 1 ? '' : 's'}`;
    row.appendChild(marksLine);
    if (missing > 0) {
      const missingLine = document.createElement('p');
      missingLine.className = 'assessment-import__subject-missing';
      missingLine.textContent = `Missing ${subjectTitle} marks: ${missing} student${missing === 1 ? '' : 's'}`;
      row.appendChild(missingLine);
    }
    subjectList.appendChild(row);
  });
  section.appendChild(subjectList);

  if (unmatchedColumns.length > 0) {
    const unmatchedColumnsNotice = document.createElement('p');
    unmatchedColumnsNotice.className = 'assessment-import__unmatched-columns';
    unmatchedColumnsNotice.textContent = `Column${unmatchedColumns.length === 1 ? '' : 's'} not recognized as a Subject in this Assessment (ignored): ${unmatchedColumns.join(', ')}`;
    section.appendChild(unmatchedColumnsNotice);
  }

  const unmatchedHeading = document.createElement('p');
  unmatchedHeading.className = 'learning-management__intro';
  unmatchedHeading.textContent = 'Unmatched Students';
  section.appendChild(unmatchedHeading);

  if (unmatchedRows.length === 0) {
    const noneNotice = document.createElement('p');
    noneNotice.className = 'assessment-import__unmatched-count';
    noneNotice.textContent = '0';
    section.appendChild(noneNotice);
  } else {
    const unmatchedList = document.createElement('ul');
    unmatchedList.className = 'assessment-import__unmatched-list';
    unmatchedRows.forEach(({ displayName }) => {
      const item = document.createElement('li');
      item.textContent = displayName;
      unmatchedList.appendChild(item);
    });
    section.appendChild(unmatchedList);

    const resolveNotice = document.createElement('p');
    resolveNotice.className = 'assessment-import__resolve-notice';
    resolveNotice.textContent = 'Import is disabled until every student in the file matches a real student on this classroom\u2019s roster (by Roll Number or Name). Fix the spreadsheet and upload it again.';
    section.appendChild(resolveNotice);
  }

  const footer = document.createElement('div');
  footer.className = 'assessment-marks-footer';

  const importActionButton = document.createElement('button');
  importActionButton.type = 'button';
  importActionButton.className = 'btn btn--primary';
  importActionButton.textContent = 'Import';
  importActionButton.disabled = unmatchedRows.length > 0;
  importActionButton.addEventListener('click', handlers.onConfirmImport);
  footer.appendChild(importActionButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelImport);
  footer.appendChild(cancelButton);

  section.appendChild(footer);

  return section;
}

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
/**
 * The Gradebook — the new primary screen shown when an Assessment is
 * opened, per explicit product decision: a single grid of every
 * student x every subject, rather than navigating into one subject
 * at a time (see renderSubjectStep() below, kept intact and still
 * reachable, but no longer the default path).
 *
 * Reuses the exact same data primitives every other screen in this
 * file already uses — assessmentService.getClassroomStudents(),
 * getSubjectTitle(), getStudentResult(), recordStudentMarks() (via
 * applyGradebookMarksEdit() above) — no new data-model concept at
 * all, only a new way of rendering and editing the same data.
 *
 * Autosaves (debounced — see scheduleGradebookSave() above) rather
 * than using the View/Edit + Save button pattern the rest of this
 * file uses, per the explicit "avoid a separate Save click for every
 * mark" requirement.
 *
 * A plain HTML <table> is deliberate, not just a styling choice: it
 * gives correct, native row-major Tab order for free (each row's
 * cells in subject order, rows in student order) — "Tab moves right"
 * falls out of the browser's own default behavior, with no custom JS
 * needed for that specific requirement.
 */
function renderGradebookStep(classroom, assessment, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = assessment.title;
  section.appendChild(heading);

  // Assessment metadata, read-only, at the top — per explicit
  // requirement to keep it visible without forcing navigation into a
  // separate screen just to see it. Editing still happens on the
  // existing Assessment Details screen (mode: 'assessment'),
  // reachable via this one link — deliberately not duplicating the
  // edit form itself here.
  const metaRow = document.createElement('div');
  metaRow.className = 'assessment-gradebook__meta-row';
  [
    ['Type', assessment.type],
    ['Academic Year', assessment.academicYear],
    ['Date', assessment.date],
  ].forEach(([label, value]) => {
    const item = document.createElement('span');
    item.className = 'assessment-gradebook__meta-item';
    item.textContent = `${label}: ${value || '\u2014'}`;
    metaRow.appendChild(item);
  });
  const editDetailsLink = document.createElement('button');
  editDetailsLink.type = 'button';
  editDetailsLink.className = 'btn btn--text';
  editDetailsLink.textContent = 'Edit Details';
  editDetailsLink.addEventListener('click', handlers.onGoToEditAssessmentDetails);
  metaRow.appendChild(editDetailsLink);
  section.appendChild(metaRow);

  const assessmentSubjects = assessment.assessmentSubjects;
  if (assessmentSubjects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'learning-management__intro';
    empty.textContent = 'No subjects yet — add one to start entering marks.';
    section.appendChild(empty);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--primary';
    addButton.textContent = '+ Add Subject';
    addButton.addEventListener('click', handlers.onGoToAddSubject);
    section.appendChild(addButton);

    return section;
  }

  const students = [...assessmentService.getClassroomStudents(classroom)].sort((a, b) => a.name.localeCompare(b.name));

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'assessment-gradebook__scroll';
  const table = document.createElement('table');
  table.className = 'assessment-gradebook';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Student', 'Roll No.'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  });
  assessmentSubjects.forEach((assessmentSubject) => {
    const th = document.createElement('th');
    const title = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId);
    th.textContent = title || '(Subject removed)';
    headerRow.appendChild(th);
  });
  ['Total', '%'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student, rowIndex) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    nameCell.textContent = student.name;
    row.appendChild(nameCell);

    const rollCell = document.createElement('td');
    rollCell.textContent = student.rollNumber || '\u2014';
    row.appendChild(rollCell);

    let totalMarks = 0;
    let totalMaximum = 0;

    assessmentSubjects.forEach((assessmentSubject, colIndex) => {
      const cell = document.createElement('td');
      const existingResult = assessmentService.getStudentResult(assessmentSubject, student.id);
      const marks = existingResult ? existingResult.marks : null;

      if (marks !== null) {
        totalMarks += marks;
        totalMaximum += assessmentSubject.maximumMarks;
      }

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'assessment-gradebook__cell-input';
      input.value = marks !== null ? marks : '';
      input.dataset.row = String(rowIndex);
      input.dataset.col = String(colIndex);

      const colorClass = getMarksColorClass(marks, assessmentSubject.maximumMarks);
      if (colorClass) cell.classList.add(colorClass);

      input.addEventListener('change', () => {
        const value = input.value === '' ? null : Number(input.value);
        handlers.onGradebookMarksEdit(assessmentSubject, student.id, value);
        cell.classList.remove('gradebook-cell--high', 'gradebook-cell--mid', 'gradebook-cell--low');
        const newColorClass = getMarksColorClass(value, assessmentSubject.maximumMarks);
        if (newColorClass) cell.classList.add(newColorClass);
      });

      input.addEventListener('keydown', (event) => {
        handleGradebookCellKeydown(event, tbody, rowIndex, colIndex, students.length, assessmentSubjects.length);
      });

      input.addEventListener('paste', (event) => {
        handleGradebookPaste(event, tbody, rowIndex, colIndex, students, assessmentSubjects, handlers.onGradebookMarksEdit);
      });

      cell.appendChild(input);
      row.appendChild(cell);
    });

    const totalCell = document.createElement('td');
    totalCell.textContent = totalMaximum > 0 ? `${totalMarks} / ${totalMaximum}` : '\u2014';
    row.appendChild(totalCell);

    const percentCell = document.createElement('td');
    percentCell.textContent = totalMaximum > 0 ? `${Math.round((totalMarks / totalMaximum) * 100)}%` : '\u2014';
    row.appendChild(percentCell);

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');

  const averageRow = document.createElement('tr');
  const averageLabel = document.createElement('td');
  averageLabel.colSpan = 2;
  averageLabel.textContent = 'Class Average';
  averageRow.appendChild(averageLabel);
  assessmentSubjects.forEach((assessmentSubject) => {
    const enteredMarks = assessmentSubject.studentResults.filter((r) => r.marks !== null).map((r) => r.marks);
    const cell = document.createElement('td');
    cell.textContent = enteredMarks.length > 0 ? (enteredMarks.reduce((a, b) => a + b, 0) / enteredMarks.length).toFixed(1) : '\u2014';
    averageRow.appendChild(cell);
  });
  averageRow.append(document.createElement('td'), document.createElement('td'));
  tfoot.appendChild(averageRow);

  const enteredRow = document.createElement('tr');
  const enteredLabel = document.createElement('td');
  enteredLabel.colSpan = 2;
  enteredLabel.textContent = 'Marks Entered';
  enteredRow.appendChild(enteredLabel);
  assessmentSubjects.forEach((assessmentSubject) => {
    const enteredCount = assessmentSubject.studentResults.filter((r) => r.marks !== null).length;
    const cell = document.createElement('td');
    cell.textContent = `${enteredCount} / ${students.length}`;
    enteredRow.appendChild(cell);
  });
  enteredRow.append(document.createElement('td'), document.createElement('td'));
  tfoot.appendChild(enteredRow);

  table.appendChild(tfoot);
  tableWrapper.appendChild(table);
  section.appendChild(tableWrapper);

  return section;
}

/**
 * Enter commits (already done via the input's own 'change' event,
 * which fires on blur — moving focus away triggers it naturally) and
 * moves DOWN to the same subject column, next student. Tab's own
 * "move right" is native browser behavior, needing no handling here
 * at all — only Enter and the arrow keys need custom handling, since
 * their native behavior (form submission attempt / number spinner
 * increment) isn't what a spreadsheet-like grid needs.
 */
function handleGradebookCellKeydown(event, tbody, rowIndex, colIndex, totalRows, totalCols) {
  if (event.key === 'Enter') {
    event.preventDefault();
    focusGradebookCell(tbody, rowIndex + 1, colIndex);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusGradebookCell(tbody, rowIndex + 1, colIndex);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusGradebookCell(tbody, rowIndex - 1, colIndex);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    // type="number" inputs don't support selectionStart/selectionEnd
    // at all (per the HTML spec — only text/search/url/tel/password
    // do) and throw if accessed directly; caret-position awareness
    // is nice-to-have, not required, so this falls back to always
    // moving focus rather than letting that throw uncaught.
    let atBoundary = true;
    try {
      atBoundary =
        event.key === 'ArrowLeft' ? event.target.selectionStart === 0 : event.target.selectionStart === event.target.value.length;
    } catch {
      atBoundary = true;
    }
    if (atBoundary) {
      focusGradebookCell(tbody, rowIndex, colIndex + (event.key === 'ArrowRight' ? 1 : -1));
    }
  }
}

function focusGradebookCell(tbody, rowIndex, colIndex) {
  const input = tbody.querySelector(`input[data-row="${rowIndex}"][data-col="${colIndex}"]`);
  if (input) input.focus();
}

/**
 * Vertical column paste (the minimum required) and rectangular range
 * paste (supported the same way, since a single row of pasted text
 * is simply a 1-row rectangle) — split first by newline (rows), then
 * by tab (columns), and apply positionally starting from the focused
 * cell, clamped to the grid's own real bounds. Deliberately does not
 * reuse services/assessmentImportService.js — that module solves a
 * different problem (fuzzy-matching unordered, externally-named rows
 * to students for a file upload); a paste into an already-visible,
 * already-ordered grid needs no matching at all, only positional
 * mapping.
 */
function handleGradebookPaste(event, tbody, startRow, startCol, students, assessmentSubjects, applyEdit) {
  const text = event.clipboardData?.getData('text');
  if (!text) return;
  event.preventDefault();

  const rows = text.replace(/\r/g, '').split('\n').filter((line, i, arr) => !(i === arr.length - 1 && line === ''));

  rows.forEach((line, rowOffset) => {
    const targetRow = startRow + rowOffset;
    if (targetRow >= students.length) return;
    const student = students[targetRow];

    const cells = line.split('\t');
    cells.forEach((rawValue, colOffset) => {
      const targetCol = startCol + colOffset;
      if (targetCol >= assessmentSubjects.length) return;
      const assessmentSubject = assessmentSubjects[targetCol];

      const trimmed = rawValue.trim();
      const value = trimmed === '' ? null : Number(trimmed);
      if (value !== null && !Number.isFinite(value)) return; // skip non-numeric cells rather than writing garbage

      applyEdit(assessmentSubject, student.id, value);

      const input = tbody.querySelector(`input[data-row="${targetRow}"][data-col="${targetCol}"]`);
      if (input) input.value = value !== null ? value : '';
    });
  });
}

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
