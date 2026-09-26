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
import { createIcon } from '../components/Icon.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { createRollNumberCell } from '../components/RollNumberCell.js';
import * as studentService from '../../services/studentService.js';
import { ASSESSMENT_TYPES } from '../../config/assessmentTypesConfig.js';
import { openCreateAssessmentModal } from '../components/CreateAssessmentModal.js';
import { openAddSubjectToAssessmentModal } from '../components/AddSubjectToAssessmentModal.js';
import { createNavigationRow } from '../components/NavigationRow.js';
import { openUnsavedChangesModal } from '../components/UnsavedChangesModal.js';
import * as assessmentService from '../../services/assessmentService.js';
import * as assessmentImportService from '../../services/assessmentImportService.js';
import * as assessmentTimetableLinkService from '../../services/assessmentTimetableLinkService.js';
import * as scheduledEventRepository from '../../services/scheduledEventRepository.js';
import { getEventsByType, SCHEDULED_EVENT_TYPES } from '../../services/scheduledEventService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { getCurrentIsoDate, getTodayDateKey, shiftDateKey, formatDate, formatDateKey } from '../../utils/dateHelpers.js';
import { getMarksColorClass, getMarksBucketKey, GREEN_THRESHOLD_PERCENT } from '../../config/assessmentMarksColorConfig.js';

export function renderAssessmentManagementView(container, { classroom, onBack, initialAssessmentId = null, initialView = null, onNavigate = null }) {
  const initialAssessment = initialAssessmentId ? assessmentService.getAssessmentById(classroom, initialAssessmentId) : null;
  // A stale/deleted assessmentId in the URL falls back to 'home',
  // same as any other not-found route elsewhere in this app — never
  // a broken or blank screen.
  let mode = initialAssessment ? (initialView === 'details' ? 'assessment' : 'gradebook') : 'home';
  let selectedAssessment = initialAssessment;
  let selectedAssessmentSubject = null;
  let sortBy = 'name'; // 'name' | 'rollNumber' | 'marks' | 'rank' — reset whenever a different Subject is opened

  // Gradebook-only filter/sort state — deliberately separate from
  // `sortBy` above, which belongs to the older per-subject screen and
  // has entirely different options/semantics. Persists across
  // rerender() within the same visit (e.g. while editing a mark),
  // matching how every other piece of this screen's own state
  // already behaves; resets on a genuine re-navigation since
  // main.js calls this function fresh each time.
  let gradebookSubjectFilter = 'all'; // 'all' | an assessmentSubject.id
  let gradebookBucketFilter = 'all'; // 'all' | 'red' | 'yellow' | 'green'
  let gradebookSearchQuery = '';
  let gradebookSort = { field: 'name', direction: 'asc' }; // field: 'name' | 'percent' | an assessmentSubject.id

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
  let marksDraftMaximumMarksError = null;

  // Same immediate-inline-edit error state for the Gradebook's own
  // subject-header Total Marks field (renderGradebookStep()) — a
  // wholly separate editing surface from the Subject Step's own
  // document-editor draft above, so it needs its own error slot.
  // `{ subjectId, message } | null`, cleared on any successful edit or
  // filter change.
  let gradebookMaxMarksError = null;

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

  // "Scheduled from Timetable" (Home step only) — every exam-type
  // ScheduledEvent whose own subject is already in this classroom's
  // Learning Activities, per services/assessmentTimetableLinkService.js's
  // own gating rule. `null` = not loaded yet (nothing rendered for this
  // section, same "empty means empty, no placeholder" convention
  // renderHomeStep() already documents for the Assessments list itself);
  // `[]` = loaded, nothing eligible. Loaded once per visit to this view,
  // not re-fetched on every rerender() — matches
  // ui/views/TimetableView.js's own eventsListCache convention for the
  // identical Firestore read.
  let scheduledExamItems = null;

  async function loadScheduledExamItems() {
    const todayKey = getTodayDateKey();
    const start = shiftDateKey(todayKey, -60);
    const end = shiftDateKey(todayKey, 365);
    const events = await scheduledEventRepository.getScheduledEventsForDateRange(classroom.id, start, end);
    const examEvents = getEventsByType(events, SCHEDULED_EVENT_TYPES.EXAM);
    scheduledExamItems = assessmentTimetableLinkService.getSurfaceableExamAssessments(classroom, examEvents, assessmentService.getAssessments(classroom));
    if (mode === 'home') rerender();
  }

  // The live ScheduledEvent behind whichever Assessment is currently
  // open, when it's linked (`selectedAssessment.scheduledEventId` set)
  // — `null` while unlinked (nothing to show) OR still loading. This
  // is what makes the Assessment Details / Gradebook header's own
  // schedule display always reflect a Timetable reschedule rather than
  // the possibly-stale `Assessment.date` copy (see
  // models/Assessment.js's own header comment on that field). Fetched
  // fresh via services/scheduledEventRepository.js — never a second,
  // independent date/period calculation.
  let linkedScheduledEvent = null;

  async function loadLinkedScheduledEvent(assessment) {
    if (!assessment || !assessment.scheduledEventId) {
      linkedScheduledEvent = null;
      return;
    }
    const event = await scheduledEventRepository.getScheduledEventById(classroom.id, assessment.scheduledEventId);
    // Only apply this if the teacher hasn't already navigated to a
    // different Assessment while this fetch was in flight.
    if (selectedAssessment === assessment) {
      linkedScheduledEvent = event;
      rerender();
    }
  }

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
        marksDraftMaximumMarksError,
        gradebookMaxMarksError,
        isEditingAssessmentDetails,
        assessmentDetailsDraft,
        importReview,
        importError,
        gradebookSubjectFilter,
        gradebookBucketFilter,
        gradebookSearchQuery,
        gradebookSort,
        scheduledExamItems,
        linkedScheduledEvent,
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
    return { maximumMarks: assessmentService.getMaximumMarks(assessmentSubject), resultsByStudentId };
  }

  function buildAssessmentDetailsDraftFrom(assessment) {
    return {
      title: assessment.title,
      type: assessment.type,
      academicYear: assessment.academicYear,
      date: assessment.date,
      // The EFFECTIVE percent (never-edited assessments resolve to the
      // system default) is what the teacher sees pre-filled — not a
      // blank field they'd have to already know the default to
      // reproduce. passMarkPercentInput is the raw string the input
      // itself holds (so an in-progress invalid edit, e.g. "abc" or
      // "150", isn't silently discarded before Save is even clicked);
      // passMarkPercentError holds a validation message once the
      // teacher tries to save something invalid, cleared on the next
      // edit.
      passMarkPercentInput: String(assessmentService.getPassMarkPercent(assessment)),
      passMarkPercentError: null,
      // Total Marks — SUBJECT-specific (models/AssessmentSubject.js's
      // own maximumMarks), never flattened into one Assessment-wide
      // value: a multi-subject Assessment can legitimately mix e.g.
      // Science /100 and Maths /50. Edit Details is a second, equally
      // real editing surface for the exact same field the Gradebook's
      // own subject header already edits (see
      // handlers.onGradebookMaximumMarksChange) — both go through
      // assessmentService.setMaximumMarks()/getMaximumMarks(), so
      // AssessmentSubject.maximumMarks itself is the one source of
      // truth; nothing here is a second, independent copy of it.
      // Keyed by assessmentSubject.id, same convention as
      // subjectMaximumMarksErrors below.
      subjectMaximumMarksInputs: new Map(
        assessment.assessmentSubjects.map((assessmentSubject) => [assessmentSubject.id, String(assessmentService.getMaximumMarks(assessmentSubject))])
      ),
      subjectMaximumMarksErrors: new Map(),
    };
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
          // Save can now fail validation (an invalid Pass Mark) — only
          // navigate away if it actually succeeded, matching the same
          // "never silently discard/proceed past an invalid edit"
          // requirement Save's own direct button click already
          // follows.
          if (handlers.onSaveAssessmentDetails()) proceed();
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

  /**
   * Total Marks, edited directly from the Gradebook's own subject
   * header (see renderGradebookStep()) — the same immediate-apply +
   * debounced-Firestore-write pattern applyGradebookMarksEdit() above
   * already uses for a single cell, since this is really just another
   * field on the same AssessmentSubject. Validated first via
   * services/assessmentService.js's own validateMaximumMarksInput() —
   * an invalid value (non-numeric, <= 0, or lower than an
   * already-entered mark) is rejected outright and surfaced inline;
   * `assessmentSubject.maximumMarks` and the already-entered marks
   * themselves are left completely untouched either way. Never
   * rescales/clamps a stored mark — Total Marks only ever changes the
   * denominator marks are interpreted against, per this feature's own
   * explicit rule.
   */
  function applyGradebookMaximumMarksEdit(assessmentSubject, rawValue) {
    const result = assessmentService.validateMaximumMarksInput(rawValue, assessmentSubject.studentResults);
    if (!result.valid) {
      gradebookMaxMarksError = { subjectId: assessmentSubject.id, message: result.error };
      rerender();
      return;
    }
    gradebookMaxMarksError = null;
    assessmentService.setMaximumMarks(assessmentSubject, result.value);
    scheduleGradebookSave(assessmentSubject);
    rerender();
  }

  /**
   * Roll Number — STUDENT-level (models/Student.js's own `rollNumber`
   * field, "currently only read, not written, anywhere in the UI"
   * until this), never an Assessment-scoped copy: services/
   * studentService.js's own setStudentRollNumber() writes directly
   * onto the same Student object every other reader (this Gradebook's
   * own "Sort by Roll Number", the Scorecard, assessmentImportService.js's
   * own matching) already reads, so a change here is immediately
   * visible everywhere that student appears, in this Assessment and
   * every other one, without any extra plumbing. Validated via
   * studentService.js's own validateRollNumberInput() — required to
   * be digits-only if non-blank, and unique within this classroom —
   * the exact same validator ui/views/ScorecardView.js's own Roll
   * Number cell uses, so the two screens can never disagree about
   * what a valid Roll Number is. Saved immediately (not debounced —
   * this is an occasional edit, never rapid-fire typing the way a
   * mark or Total Marks input can be).
   */
  function applyStudentRollNumberSave(student, rawValue) {
    const allStudents = assessmentService.getClassroomStudents(classroom);
    const result = studentService.validateRollNumberInput(rawValue, allStudents, student.id);
    if (!result.valid) return result;
    studentService.setStudentRollNumber(classroom, student.id, result.value);
    workspaceService.save(classroom);
    return result;
  }

  const handlers = {
    onGradebookMarksEdit: applyGradebookMarksEdit,
    onGradebookMaximumMarksChange: applyGradebookMaximumMarksEdit,
    onSaveStudentRollNumber: applyStudentRollNumberSave,
    onGradebookSubjectFilterChange: (value) => {
      gradebookSubjectFilter = value;
      rerender();
    },
    onGradebookBucketFilterChange: (value) => {
      gradebookBucketFilter = value;
      rerender();
    },
    onGradebookSearchChange: (value) => {
      gradebookSearchQuery = value;
      rerender();
    },
    onGradebookSortChange: (field, direction) => {
      gradebookSort = { field, direction };
      rerender();
    },
    onGradebookClearFilters: () => {
      gradebookSubjectFilter = 'all';
      gradebookBucketFilter = 'all';
      gradebookSearchQuery = '';
      rerender();
    },
    onBack,
    onGoToCreateAssessment: () => {
      openCreateAssessmentModal({
        classroom,
        onAssessmentCreated: () => rerender(),
      });
    },
    onGoToScorecard: () => {
      if (onNavigate) onNavigate(`/classroom/${classroom.id}/assessments/scorecard`);
    },
    onSetUpAssessmentFromEvent: (item) => {
      const assessment = assessmentService.createAssessmentFromScheduledEvent(classroom, item.event, item.learningSubject);
      workspaceService.save(classroom);
      selectedAssessment = assessment;
      mode = 'gradebook';
      linkedScheduledEvent = item.event; // already have it — no refetch needed
      if (onNavigate) onNavigate(`/classroom/${classroom.id}/assessments/${assessment.id}/gradebook`);
      rerender();
    },
    onChooseAssessment: (assessment) => {
      navigateAwayGuard(() => {
        selectedAssessment = assessment;
        isEditingAssessmentDetails = false;
        hasUnsavedAssessmentDetailsChanges = false;
        mode = 'gradebook';
        linkedScheduledEvent = null;
        loadLinkedScheduledEvent(assessment);
        if (onNavigate) onNavigate(`/classroom/${classroom.id}/assessments/${assessment.id}/gradebook`);
        rerender();
      });
    },
    onViewInTimetable: () => {
      if (onNavigate) onNavigate(`/classroom/${classroom.id}/timetable`);
    },
    // The one, portal-wide canonical student-profile URL (see
    // ui/router.js's own `studentProfile` route) — every other view
    // that links a student's name builds this exact same path; this
    // view had simply never done so before. Takes the whole `student`
    // object (matching ui/components/StudentNameElement.js's own
    // `onSelect` callback shape), navigates by `student.id`, never by
    // name/roll number/row index.
    onSelectStudent: (student) => {
      if (onNavigate) onNavigate(`/classroom/${classroom.id}/student/${student.id}`);
    },
    onTogglePinAssessment: (assessment) => {
      // Pinning only changes visibility on the Dashboard's Open Work
      // section (see services/workTypes/AssessmentWorkType.js) —
      // never assessment.status or anything else. Not assignment.
      assessment.pinnedToDashboard = !assessment.pinnedToDashboard;
      workspaceService.save(classroom);
      rerender();
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
        linkedScheduledEvent = null;
        loadLinkedScheduledEvent(assessment);
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
        if (onNavigate) {
          if (targetMode === 'home') {
            onNavigate(`/classroom/${classroom.id}/assessments`);
          } else if (targetMode === 'gradebook' && selectedAssessment) {
            onNavigate(`/classroom/${classroom.id}/assessments/${selectedAssessment.id}/gradebook`);
          }
        }
        rerender();
      });
    },
    onGoToEditMarks: () => {
      isEditingMarks = true;
      marksDraft = buildMarksDraftFrom(selectedAssessmentSubject);
      hasUnsavedMarksChanges = false;
      marksDraftMaximumMarksError = null;
      rerender();
    },
    onDraftMaximumMarksChange: (rawValue) => {
      const result = assessmentService.validateMaximumMarksInput(rawValue, marksDraft.resultsByStudentId.values());
      if (!result.valid) {
        marksDraftMaximumMarksError = result.error;
        rerender();
        return;
      }
      marksDraftMaximumMarksError = null;
      marksDraft.maximumMarks = result.value;
      hasUnsavedMarksChanges = true;
      rerender();
    },
    onDraftStudentFieldChange: (studentId, updates) => {
      Object.assign(marksDraft.resultsByStudentId.get(studentId), updates);
      hasUnsavedMarksChanges = true;
      rerender();
    },
    onSaveMarks: () => {
      // Defensive re-check, not just relying on onDraftMaximumMarksChange
      // above having already validated: a mark can be typed AFTER
      // Maximum Marks was set, making a previously-valid draft newly
      // invalid without ever touching the Maximum Marks field again.
      const revalidation = assessmentService.validateMaximumMarksInput(marksDraft.maximumMarks, marksDraft.resultsByStudentId.values());
      if (!revalidation.valid) {
        marksDraftMaximumMarksError = revalidation.error;
        rerender();
        return;
      }
      assessmentService.saveAssessmentSubjectDraft(selectedAssessmentSubject, marksDraft);
      workspaceService.save(classroom);
      isEditingMarks = false;
      hasUnsavedMarksChanges = false;
      marksDraftMaximumMarksError = null;
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
      marksDraftMaximumMarksError = null;
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
      // A fresh edit to the Pass Mark field always clears any previous
      // validation error — Save (below) re-validates from scratch.
      if ('passMarkPercentInput' in updates) assessmentDetailsDraft.passMarkPercentError = null;
      hasUnsavedAssessmentDetailsChanges = true;
      rerender();
    },
    /**
     * One Subject's own Total Marks field within Edit Details — kept
     * as its own handler (not folded into onDraftAssessmentDetailsChange
     * above) since it's keyed by assessmentSubject.id, not a flat
     * field name, and validated immediately against that SAME
     * Subject's own already-entered marks via
     * assessmentService.validateMaximumMarksInput() — the identical
     * validator the Gradebook's own inline edit
     * (onGradebookMaximumMarksChange below) already uses, so "reject
     * non-numeric/zero/negative" and "reject a new maximum lower than
     * an already-entered mark" behave identically in both places.
     * Invalid input is never silently discarded — the error is shown
     * inline immediately, and Save below re-validates defensively
     * regardless.
     */
    onDraftSubjectMaximumMarksChange: (assessmentSubjectId, rawValue) => {
      const assessmentSubject = selectedAssessment.assessmentSubjects.find((s) => s.id === assessmentSubjectId);
      if (!assessmentSubject) return;
      const result = assessmentService.validateMaximumMarksInput(rawValue, assessmentSubject.studentResults);
      if (!result.valid) {
        assessmentDetailsDraft.subjectMaximumMarksErrors.set(assessmentSubjectId, result.error);
        rerender();
        return;
      }
      assessmentDetailsDraft.subjectMaximumMarksErrors.delete(assessmentSubjectId);
      assessmentDetailsDraft.subjectMaximumMarksInputs.set(assessmentSubjectId, String(result.value));
      hasUnsavedAssessmentDetailsChanges = true;
      rerender();
    },
    /** Returns true once the Assessment's details have actually been saved, false if validation blocked it (see navigateAwayGuard() above, which must not treat a blocked save as "safe to navigate away now"). */
    onSaveAssessmentDetails: () => {
      const parsedPassMark = assessmentService.parsePassMarkPercentInput(assessmentDetailsDraft.passMarkPercentInput);
      if (!parsedPassMark.valid) {
        assessmentDetailsDraft.passMarkPercentError = 'Enter a number between 0 and 100, or leave blank to use the default.';
        rerender();
        return false;
      }

      // Defensive re-validation of every Subject's own Total Marks —
      // not just relying on onDraftSubjectMaximumMarksChange above
      // having already validated, the same reasoning
      // renderSubjectStep's own onSaveMarks() already documents: a
      // mark can be entered elsewhere (the Gradebook, open in another
      // tab) after this draft's own value was last validated here,
      // making a previously-valid draft newly invalid. All-or-nothing:
      // one Subject's invalid Total Marks blocks the whole Save,
      // exactly like Pass Mark above, rather than partially applying.
      const subjectValidationResults = selectedAssessment.assessmentSubjects.map((assessmentSubject) => ({
        assessmentSubject,
        result: assessmentService.validateMaximumMarksInput(
          assessmentDetailsDraft.subjectMaximumMarksInputs.get(assessmentSubject.id),
          assessmentSubject.studentResults
        ),
      }));
      const hasInvalidSubject = subjectValidationResults.some(({ result }) => !result.valid);
      if (hasInvalidSubject) {
        subjectValidationResults.forEach(({ assessmentSubject, result }) => {
          if (!result.valid) assessmentDetailsDraft.subjectMaximumMarksErrors.set(assessmentSubject.id, result.error);
        });
        rerender();
        return false;
      }

      assessmentService.updateAssessmentDetails(selectedAssessment, { ...assessmentDetailsDraft, passMarkPercent: parsedPassMark.value });
      subjectValidationResults.forEach(({ assessmentSubject, result }) => {
        assessmentService.setMaximumMarks(assessmentSubject, result.value);
      });
      workspaceService.save(classroom);
      isEditingAssessmentDetails = false;
      hasUnsavedAssessmentDetailsChanges = false;
      rerender();
      return true;
    },
    onCancelEditAssessmentDetails: () => {
      assessmentDetailsDraft = buildAssessmentDetailsDraftFrom(selectedAssessment);
      isEditingAssessmentDetails = false;
      hasUnsavedAssessmentDetailsChanges = false;
      rerender();
    },
  };

  rerender();
  loadScheduledExamItems();
  if (initialAssessment) loadLinkedScheduledEvent(initialAssessment);
}

function renderView(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  // Page-containment audit — this bare '.learning-management' class had
  // no width/padding of its own (that only lives on the modifier class
  // below), so this whole screen ran edge-to-edge despite the comment's
  // original claim of "reusing shared page chrome." Adding
  // 'learning-management-view' gives it the exact same real container
  // (max-width/margin/padding) Learning Management itself already uses
  // — see that class's own rule in css/styles.css.
  wrapper.className = 'learning-management learning-management-view';

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
    wrapper.appendChild(
      renderAssessmentStep(state.classroom, state.selectedAssessment, state.isEditingAssessmentDetails, state.assessmentDetailsDraft, state.linkedScheduledEvent, handlers)
    );
  } else if (mode === 'gradebook') {
    wrapper.appendChild(renderGradebookStep(state.classroom, state.selectedAssessment, state, handlers));
  } else if (mode === 'subject') {
    wrapper.appendChild(
      renderSubjectStep(
        state.classroom,
        state.selectedAssessment,
        state.selectedAssessmentSubject,
        state.sortBy,
        state.isEditingMarks,
        state.marksDraft,
        state.marksDraftMaximumMarksError,
        handlers
      )
    );
  } else if (mode === 'import-review') {
    wrapper.appendChild(renderImportReviewStep(state.selectedAssessment, state.importReview, state.importError, handlers));
  } else {
    wrapper.appendChild(renderHomeStep(state.classroom, handlers, state.scheduledExamItems));
  }

  container.appendChild(wrapper);
}

/**
 * Renders the classroom's own persisted Assessments, plus — above
 * them — exam-type Timetable events already eligible to become one
 * (see services/assessmentTimetableLinkService.js's own gating rule:
 * only a Subject already in this classroom's Learning Activities ever
 * appears here at all). `scheduledExamItems` is `null` while still
 * loading (see loadScheduledExamItems() above) — that whole section is
 * simply omitted until it resolves, never a loading spinner over the
 * rest of an otherwise-ready page. Below that, "Existing Assessments"
 * is exactly what this step always rendered: empty means empty, no
 * suggested or placeholder assessments ever appear there.
 */
function renderHomeStep(classroom, handlers, scheduledExamItems) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const hasScheduledItems = Array.isArray(scheduledExamItems) && scheduledExamItems.length > 0;

  if (hasScheduledItems) {
    const scheduledHeading = document.createElement('p');
    scheduledHeading.className = 'learning-management__primary-section-heading';
    scheduledHeading.textContent = 'Scheduled from Timetable';
    section.appendChild(scheduledHeading);

    const scheduledSubtitle = document.createElement('p');
    scheduledSubtitle.className = 'learning-management__intro';
    scheduledSubtitle.textContent = `${scheduledExamItems.length} assessment${scheduledExamItems.length === 1 ? '' : 's'} from your timetable`;
    section.appendChild(scheduledSubtitle);

    const scheduledList = document.createElement('div');
    scheduledList.className = 'assessment-scheduled-card-list';
    scheduledExamItems.forEach((item) => {
      scheduledList.appendChild(renderScheduledExamCard(classroom, item, handlers));
    });
    section.appendChild(scheduledList);

    const existingHeading = document.createElement('p');
    existingHeading.className = 'learning-management__primary-section-heading';
    existingHeading.textContent = 'Existing Assessments';
    section.appendChild(existingHeading);
  }

  const assessments = assessmentService.getAssessments(classroom);
  if (assessments.length > 0) {
    const list = document.createElement('div');
    list.className = 'learning-management__subject-card-list';
    assessments.forEach((assessment) => {
      list.appendChild(createNavigationRow({ label: assessment.title, onClick: () => handlers.onChooseAssessment(assessment) }));
    });
    section.appendChild(list);
  }

  const actionsRow = document.createElement('div');
  actionsRow.className = 'assessment-home__actions';

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = '+ Create Assessment';
  createButton.addEventListener('click', handlers.onGoToCreateAssessment);
  actionsRow.appendChild(createButton);

  const scorecardButton = document.createElement('button');
  scorecardButton.type = 'button';
  scorecardButton.className = 'btn btn--secondary';
  scorecardButton.textContent = 'Scorecard';
  scorecardButton.addEventListener('click', handlers.onGoToScorecard);
  actionsRow.appendChild(scorecardButton);

  section.appendChild(actionsRow);

  return section;
}

/**
 * One "Scheduled from Timetable" card — visual hierarchy only (exam
 * name strongest, subject secondary, date/period muted metadata, a
 * small status badge, and a distinct action), NOT a new click target:
 * the whole card is still exactly one <button>, calling exactly the
 * same handlers renderHomeStep()'s previous single-line version
 * already called (onChooseAssessment for a linked item,
 * onSetUpAssessmentFromEvent otherwise) — no new navigation semantics,
 * no duplicate click handlers. Date/period still resolved live via
 * services/assessmentTimetableLinkService.js's own getEventPeriodLabel()
 * exactly as before; this function only changes markup/CSS.
 */
function renderScheduledExamCard(classroom, item, handlers) {
  const periodLabel = assessmentTimetableLinkService.getEventPeriodLabel(classroom, item.event);
  const metaText = [formatDateKey(item.event.date), periodLabel].filter(Boolean).join(' · ');
  const isLinked = Boolean(item.linkedAssessment);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'assessment-scheduled-card';
  card.addEventListener('click', () => (isLinked ? handlers.onChooseAssessment(item.linkedAssessment) : handlers.onSetUpAssessmentFromEvent(item)));

  const top = document.createElement('div');
  top.className = 'assessment-scheduled-card__top';
  const title = document.createElement('span');
  title.className = 'assessment-scheduled-card__title';
  title.textContent = item.event.title || 'Exam';
  const chevron = document.createElement('span');
  chevron.className = 'assessment-scheduled-card__chevron';
  chevron.textContent = '›';
  chevron.setAttribute('aria-hidden', 'true');
  top.append(title, chevron);
  card.appendChild(top);

  const subject = document.createElement('p');
  subject.className = 'assessment-scheduled-card__subject';
  subject.textContent = item.subjectTitle;
  card.appendChild(subject);

  if (metaText) {
    const meta = document.createElement('p');
    meta.className = 'assessment-scheduled-card__meta';
    meta.textContent = metaText;
    card.appendChild(meta);
  }

  const footer = document.createElement('div');
  footer.className = 'assessment-scheduled-card__footer';

  const status = document.createElement('span');
  status.className = `status-badge ${isLinked ? 'status-badge--assessment-set-up' : 'status-badge--assessment-pending'}`;
  status.textContent = isLinked ? 'Assessment set up' : 'Assessment not set up';
  footer.appendChild(status);

  const action = document.createElement('span');
  action.className = 'assessment-scheduled-card__action';
  action.textContent = isLinked ? 'Open Assessment →' : 'Set up Assessment →';
  footer.appendChild(action);

  card.appendChild(footer);

  return card;
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
function renderAssessmentStep(classroom, assessment, isEditingDetails, draft, linkedScheduledEvent, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = assessment.title;
  section.appendChild(heading);

  const pinButton = document.createElement('button');
  pinButton.type = 'button';
  pinButton.className = 'btn btn--text';
  pinButton.textContent = assessment.pinnedToDashboard ? 'Unpin from Dashboard' : '\ud83d\udccc Pin to Dashboard';
  pinButton.addEventListener('click', () => handlers.onTogglePinAssessment(assessment));
  section.appendChild(pinButton);

  section.appendChild(renderAssessmentDetailsSection(classroom, assessment, isEditingDetails, draft, linkedScheduledEvent, handlers));

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
  addSubjectButton.className = 'btn btn--tonal btn--tonal-blue assessment-add-subject-button';
  addSubjectButton.appendChild(createIcon('plus', { size: 16 }));
  addSubjectButton.append('Add Subject');
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

  const actionsRow = document.createElement('div');
  actionsRow.className = 'assessment-actions-row';

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'btn btn--tonal btn--tonal-neutral';
  importButton.appendChild(createIcon('file-up', { size: 16 }));
  importButton.append('Import Spreadsheet');
  importButton.addEventListener('click', () => importFileInput.click());
  actionsRow.appendChild(importButton);

  if (assessment.status === 'Draft') {
    const publishButton = document.createElement('button');
    publishButton.type = 'button';
    publishButton.className = 'btn btn--tonal btn--tonal-green';
    publishButton.appendChild(createIcon('check-circle-2', { size: 16 }));
    publishButton.append('Publish Assessment');
    publishButton.addEventListener('click', () => handlers.onPublishAssessment(assessment));
    actionsRow.appendChild(publishButton);
  } else {
    const publishedNotice = document.createElement('p');
    publishedNotice.className = 'learning-management__publish-assessment-notice';
    publishedNotice.textContent = `\u2713 Published \u2014 students have been notified.`;
    actionsRow.appendChild(publishedNotice);
  }
  section.appendChild(actionsRow);

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

/**
 * Quiet, clearly-set-apart destructive action — same idiom as
 * ui/views/LearningManagementView.js's own renderDangerZone()
 * (.subject-danger-zone): a small warning icon + a plainly-worded
 * button, never a shouted "DANGER ZONE" heading over a tinted box.
 * See docs/classmate_ui_consistency_guidelines.md Section 23.
 */
function renderAssessmentDangerZone(assessment, handlers) {
  const zone = document.createElement('div');
  zone.className = 'subject-danger-zone';

  const icon = createIcon('alert-triangle', { size: 16 });
  icon.classList.add('subject-danger-zone-icon');
  zone.appendChild(icon);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--danger';
  deleteButton.appendChild(createIcon('trash-2', { size: 16 }));
  deleteButton.append('Delete Assessment');
  deleteButton.addEventListener('click', () => handlers.onDeleteAssessment(assessment));
  zone.appendChild(deleteButton);

  return zone;
}

/**
 * The schedule line for a Timetable-linked Assessment — always
 * resolved from the LIVE ScheduledEvent (see
 * services/assessmentTimetableLinkService.js's own getEventPeriodLabel()),
 * never the possibly-stale `Assessment.date` copy (see
 * models/Assessment.js's own header comment on that field). `null` for
 * an unlinked/manual Assessment (nothing to show here — the plain Date
 * field applies instead) or while `linkedScheduledEvent` is still
 * loading.
 */
function resolveLiveScheduleDisplay(classroom, assessment, linkedScheduledEvent) {
  if (!assessment.scheduledEventId) return null;
  if (!linkedScheduledEvent) return { text: 'Loading schedule…' };
  const periodLabel = assessmentTimetableLinkService.getEventPeriodLabel(classroom, linkedScheduledEvent);
  const text = [formatDateKey(linkedScheduledEvent.date), periodLabel].filter(Boolean).join(' · ');
  return { text };
}

function renderAssessmentDetailsSection(classroom, assessment, isEditingDetails, draft, linkedScheduledEvent, handlers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'assessment-details-section';
  const scheduleDisplay = resolveLiveScheduleDisplay(classroom, assessment, linkedScheduledEvent);

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

    if (scheduleDisplay) {
      // Linked to a Timetable exam — the date/period is NOT a
      // separately editable field here; it belongs to the Scheduled
      // Event (see this feature's own "Assessment -> Timetable"
      // requirement: "Do not create a separately editable date/period
      // on the assessment"). `draft.date` is intentionally left
      // untouched (still whatever buildAssessmentDetailsDraftFrom()
      // captured), so Save below is a no-op for it.
      wrapper.appendChild(renderScheduleReadOnlyRow(scheduleDisplay, handlers));
    } else {
      const dateField = createLabeledInput('Date');
      dateField.input.type = 'date';
      dateField.input.value = draft.date;
      dateField.input.addEventListener('change', () => handlers.onDraftAssessmentDetailsChange({ date: dateField.input.value }));
      wrapper.appendChild(dateField.wrapper);
    }

    // Pass Mark — a percentage of each Subject's own maximumMarks (see
    // models/Assessment.js's own header comment on `passMarkPercent`),
    // never an absolute mark, and never the same scale as the
    // Gradebook's own fixed Red/Yellow/Green bucket boundaries (see
    // config/assessmentMarksColorConfig.js's own MARKS_COLOR_THRESHOLDS,
    // untouched by this field). Blank is a valid input, meaning "use
    // the system default" (services/assessmentService.js's own
    // getPassMarkPercent()), not an error.
    const passMarkField = createLabeledInput('Pass Mark');
    passMarkField.input.type = 'number';
    passMarkField.input.min = '0';
    passMarkField.input.max = '100';
    passMarkField.input.step = '0.01';
    passMarkField.input.value = draft.passMarkPercentInput;
    passMarkField.input.addEventListener('change', () => handlers.onDraftAssessmentDetailsChange({ passMarkPercentInput: passMarkField.input.value }));
    // The base labeled-input wrapper is a vertical (label-over-field)
    // flex column — this class swaps just the input row itself to a
    // horizontal one, so the "%" suffix sits beside the number input
    // rather than falling onto its own line underneath.
    passMarkField.wrapper.classList.add('assessment-details-section__pass-mark-field');
    const passMarkInputRow = document.createElement('span');
    passMarkInputRow.className = 'assessment-details-section__pass-mark-input-row';
    passMarkField.input.replaceWith(passMarkInputRow);
    const passMarkSuffix = document.createElement('span');
    passMarkSuffix.className = 'assessment-details-section__pass-mark-suffix';
    passMarkSuffix.textContent = '%';
    passMarkInputRow.append(passMarkField.input, passMarkSuffix);
    wrapper.appendChild(passMarkField.wrapper);

    if (draft.passMarkPercentError) {
      const passMarkError = document.createElement('p');
      passMarkError.className = 'learning-management__inline-error';
      passMarkError.textContent = draft.passMarkPercentError;
      wrapper.appendChild(passMarkError);
    }

    wrapper.appendChild(renderSubjectsTotalMarksSection(classroom, assessment, true, draft, handlers));

    const footer = document.createElement('div');
    footer.className = 'assessment-marks-footer';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--primary';
    saveButton.appendChild(createIcon('check', { size: 16 }));
    saveButton.append('Save');
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
      ...(scheduleDisplay ? [] : [['Date', assessment.date]]),
    ].forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value || '\u2014';
      details.append(dt, dd);
    });
    wrapper.appendChild(details);

    if (scheduleDisplay) wrapper.appendChild(renderScheduleReadOnlyRow(scheduleDisplay, handlers));

    wrapper.appendChild(renderSubjectsTotalMarksSection(classroom, assessment, false, draft, handlers));

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

/**
 * SUBJECTS — Edit Details' own second, equally real place to see and
 * edit each Subject's Total Marks (models/AssessmentSubject.js's own
 * maximumMarks), not just the Gradebook's inline subject-header edit
 * (see renderGradebookStep()). Deliberately per-Subject rows, never
 * one Assessment-wide field: a multi-subject Assessment can legitimately
 * mix e.g. Science /100 and Maths /50 (see this file's own
 * assessmentDetailsDraft.subjectMaximumMarksInputs, keyed by
 * assessmentSubject.id). Both editing surfaces read/write the exact
 * same assessmentSubject.maximumMarks via
 * services/assessmentService.js's own getMaximumMarks()/
 * setMaximumMarks()/validateMaximumMarksInput() — there is only ever
 * one stored value; this is a second VIEW onto it, not a second copy.
 *
 * Omitted entirely once an Assessment has no Subjects yet (the "+ Add
 * Subject" empty state already covers that case elsewhere) — nothing
 * useful to show or edit here yet.
 */
function renderSubjectsTotalMarksSection(classroom, assessment, isEditingDetails, draft, handlers) {
  const fragment = document.createDocumentFragment();
  if (assessment.assessmentSubjects.length === 0) return fragment;

  const label = document.createElement('p');
  label.className = 'assessment-details-section__subjects-label';
  label.textContent = 'Subjects';
  fragment.appendChild(label);

  const list = document.createElement('div');
  list.className = 'assessment-details-section__subjects';

  assessment.assessmentSubjects.forEach((assessmentSubject) => {
    const row = document.createElement('div');
    row.className = 'assessment-details-section__subject-row';

    const titleEl = document.createElement('span');
    titleEl.className = 'assessment-details-section__subject-title';
    titleEl.textContent = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId) || '(Subject removed)';
    row.appendChild(titleEl);

    const marksField = document.createElement('div');
    marksField.className = 'assessment-details-section__subject-marks-field';
    const marksLabel = document.createElement('span');
    marksLabel.className = 'assessment-details-section__subject-marks-label';
    marksLabel.textContent = 'Total Marks';
    marksField.appendChild(marksLabel);

    if (isEditingDetails) {
      const marksInput = document.createElement('input');
      marksInput.type = 'number';
      marksInput.className = 'assessment-details-section__subject-marks-input';
      marksInput.min = '0.01';
      marksInput.value = draft.subjectMaximumMarksInputs.get(assessmentSubject.id);
      marksInput.addEventListener('change', () => {
        handlers.onDraftSubjectMaximumMarksChange(assessmentSubject.id, marksInput.value);
      });
      marksField.appendChild(marksInput);
    } else {
      const marksValue = document.createElement('span');
      marksValue.className = 'assessment-details-section__subject-marks-value';
      marksValue.textContent = String(assessmentService.getMaximumMarks(assessmentSubject));
      marksField.appendChild(marksValue);
    }
    row.appendChild(marksField);
    list.appendChild(row);

    if (isEditingDetails && draft.subjectMaximumMarksErrors.get(assessmentSubject.id)) {
      const error = document.createElement('p');
      error.className = 'learning-management__inline-error assessment-details-section__subject-marks-error';
      error.textContent = draft.subjectMaximumMarksErrors.get(assessmentSubject.id);
      list.appendChild(error);
    }
  });

  fragment.appendChild(list);
  return fragment;
}

/** "Scheduled: 24 Sep · Period 1–2" + "View in Timetable" — see resolveLiveScheduleDisplay() above. Reuses the existing Timetable route (see ui/router.js), never a new one. */
function renderScheduleReadOnlyRow(scheduleDisplay, handlers) {
  const row = document.createElement('div');
  row.className = 'assessment-details-section__schedule';

  const label = document.createElement('p');
  label.className = 'assessment-details-section__schedule-label';
  label.textContent = `Scheduled: ${scheduleDisplay.text}`;
  row.appendChild(label);

  const viewInTimetableButton = document.createElement('button');
  viewInTimetableButton.type = 'button';
  viewInTimetableButton.className = 'btn btn--text';
  viewInTimetableButton.textContent = 'View in Timetable';
  viewInTimetableButton.addEventListener('click', handlers.onViewInTimetable);
  row.appendChild(viewInTimetableButton);

  return row;
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
/**
 * The full filter + sort pipeline for the Gradebook's own visible
 * student list — always returns a new array, never mutates
 * `allStudents` or anything inside it, matching this file's own
 * existing sortStudents() convention for the older per-subject
 * screen. Bucketing here reuses getMarksBucketKey() from
 * config/assessmentMarksColorConfig.js directly — no second,
 * duplicate threshold definition.
 */
function getVisibleGradebookStudents(allStudents, assessmentSubjects, subjectFilter, bucketFilter, searchQuery, sort, passMarkPercent) {
  const trimmedQuery = searchQuery.trim().toLowerCase();

  const filtered = allStudents.filter((student) => {
    if (trimmedQuery && !student.name.toLowerCase().includes(trimmedQuery)) return false;

    if (bucketFilter === 'all') return true;

    if (subjectFilter !== 'all') {
      // A specific subject is selected — the bucket filter applies to
      // that exact subject's own mark, matching the explicit example
      // in this feature's own product spec ("Subject = Science,
      // Bucket = Red -> only students whose Science mark is Red").
      const assessmentSubject = assessmentSubjects.find((s) => s.id === subjectFilter);
      if (!assessmentSubject) return true;
      const result = assessmentService.getStudentResult(assessmentSubject, student.id);
      const bucket = result ? getMarksBucketKey(result.marks, assessmentService.getMaximumMarks(assessmentSubject), passMarkPercent) : null;
      return bucket === bucketFilter;
    }

    // No specific subject selected — matches if the student has AT
    // LEAST ONE subject in the selected bucket. Not explicitly
    // specified in the product spec for this exact combination; this
    // is the most intuitive reading given no other rule was stated,
    // and is stated plainly here rather than silently assumed.
    return assessmentSubjects.some((assessmentSubject) => {
      const result = assessmentService.getStudentResult(assessmentSubject, student.id);
      const bucket = result ? getMarksBucketKey(result.marks, assessmentService.getMaximumMarks(assessmentSubject), passMarkPercent) : null;
      return bucket === bucketFilter;
    });
  });

  const getMarksForSort = (student, assessmentSubjectId) => {
    const assessmentSubject = assessmentSubjects.find((s) => s.id === assessmentSubjectId);
    if (!assessmentSubject) return null;
    const result = assessmentService.getStudentResult(assessmentSubject, student.id);
    return result ? result.marks : null;
  };

  const getPercentForSort = (student) => {
    let totalMarks = 0;
    let totalMaximum = 0;
    assessmentSubjects.forEach((assessmentSubject) => {
      const result = assessmentService.getStudentResult(assessmentSubject, student.id);
      if (result && result.marks !== null) {
        totalMarks += result.marks;
        totalMaximum += assessmentService.getMaximumMarks(assessmentSubject);
      }
    });
    return totalMaximum > 0 ? (totalMarks / totalMaximum) * 100 : null;
  };

  const sorted = [...filtered];
  const direction = sort.direction === 'desc' ? -1 : 1;

  if (sort.field === 'name') {
    sorted.sort((a, b) => direction * a.name.localeCompare(b.name));
  } else {
    const getValue = sort.field === 'percent' ? getPercentForSort : (student) => getMarksForSort(student, sort.field);
    sorted.sort((a, b) => {
      const valueA = getValue(a);
      const valueB = getValue(b);
      // Blank/unentered marks always sort last, regardless of
      // direction — a teacher sorting "highest to lowest" almost
      // certainly wants to see actual scores first, not be met with
      // a wall of ungraded students at the top.
      if (valueA === null && valueB === null) return a.name.localeCompare(b.name);
      if (valueA === null) return 1;
      if (valueB === null) return -1;
      return direction * (valueA - valueB);
    });
  }

  return sorted;
}

/**
 * The legend must reflect the ACTUAL performance bands this
 * Assessment uses \u2014 never the old, hardcoded "0\u201317.99 / 18\u201334.99 /
 * 35\u201350" absolute-mark ranges (which quietly assumed a /50 maximum
 * and a fixed 36% boundary; both are wrong for a percentage-based,
 * per-Assessment Pass Mark). Red/Yellow always move together with
 * `passMarkPercent`; Green is always anchored at the fixed
 * GREEN_THRESHOLD_PERCENT, independent of it \u2014 see
 * config/assessmentMarksColorConfig.js's own header comment for the
 * confirmed rule this legend is describing, not inventing.
 */
/**
 * "PERFORMANCE" card \u2014 the shared .performance-legend-card component
 * (see ui/views/ScorecardView.js's own renderLegend(), same markup)
 * with one addition Scorecard's version deliberately omits: a single
 * concrete Pass Mark value, safe to show here because exactly one
 * Assessment (and therefore exactly one passMarkPercent \u2014 see
 * services/assessmentService.js's own getPassMarkPercent()) is ever in
 * view on this page, unlike a Scorecard cycle that can span several.
 * Thresholds are read straight from the values passed in \u2014 nothing
 * hardcoded here.
 */
function renderBucketLegend(passMarkPercent) {
  const card = document.createElement('div');
  card.className = 'performance-legend-card';

  const label = document.createElement('p');
  label.className = 'performance-legend-card__label';
  label.textContent = 'Performance';
  card.appendChild(label);

  const chips = document.createElement('div');
  chips.className = 'performance-legend-card__chips';
  [
    { modifier: 'red', label: 'Red', desc: `Below ${passMarkPercent}% \u00b7 Needs Help` },
    { modifier: 'yellow', label: 'Yellow', desc: `${passMarkPercent}\u2013${GREEN_THRESHOLD_PERCENT - 0.01}% \u00b7 Developing` },
    { modifier: 'green', label: 'Green', desc: `${GREEN_THRESHOLD_PERCENT}%+ \u00b7 Strong` },
  ].forEach(({ modifier, label: chipLabel, desc }) => {
    const chip = document.createElement('div');
    chip.className = `performance-legend-chip performance-legend-chip--${modifier}`;
    const swatch = document.createElement('span');
    swatch.className = 'performance-legend-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    const labelEl = document.createElement('span');
    labelEl.className = 'performance-legend-chip-label';
    labelEl.textContent = chipLabel;
    const descEl = document.createElement('span');
    descEl.className = 'performance-legend-chip-desc';
    descEl.textContent = ` \u00b7 ${desc}`;
    chip.append(swatch, labelEl, descEl);
    chips.appendChild(chip);
  });
  card.appendChild(chips);

  const passMark = document.createElement('div');
  passMark.className = 'performance-legend-card__pass-mark';
  const passMarkLabel = document.createElement('span');
  passMarkLabel.className = 'performance-legend-card__pass-mark-label';
  passMarkLabel.textContent = 'Pass Mark';
  const passMarkValue = document.createElement('span');
  passMarkValue.className = 'performance-legend-card__pass-mark-value';
  passMarkValue.textContent = `${passMarkPercent}%`;
  passMark.append(passMarkLabel, passMarkValue);
  card.appendChild(passMark);

  return card;
}

const SORT_OPTIONS_STATIC = [
  { field: 'name', direction: 'asc', label: 'Student Name (A \u2192 Z)' },
  { field: 'name', direction: 'desc', label: 'Student Name (Z \u2192 A)' },
  { field: 'percent', direction: 'desc', label: 'Overall % (High \u2192 Low)' },
  { field: 'percent', direction: 'asc', label: 'Overall % (Low \u2192 High)' },
];

function renderGradebookControls(classroom, assessmentSubjects, gradebookState, handlers) {
  const { gradebookSubjectFilter, gradebookBucketFilter, gradebookSearchQuery, gradebookSort } = gradebookState;
  const bar = document.createElement('div');
  bar.className = 'assessment-gradebook__controls';

  // --- Subject filter ---
  const subjectSelect = document.createElement('select');
  subjectSelect.className = 'assessment-gradebook__control-select';
  const allSubjectsOption = document.createElement('option');
  allSubjectsOption.value = 'all';
  allSubjectsOption.textContent = 'All Subjects';
  subjectSelect.appendChild(allSubjectsOption);
  assessmentSubjects.forEach((assessmentSubject) => {
    const option = document.createElement('option');
    option.value = assessmentSubject.id;
    option.textContent = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId) || '(Subject removed)';
    if (assessmentSubject.id === gradebookSubjectFilter) option.selected = true;
    subjectSelect.appendChild(option);
  });
  subjectSelect.addEventListener('change', () => handlers.onGradebookSubjectFilterChange(subjectSelect.value));
  bar.appendChild(subjectSelect);

  // --- Bucket filter ---
  const bucketSelect = document.createElement('select');
  bucketSelect.className = 'assessment-gradebook__control-select';
  [
    ['all', 'All Buckets'],
    ['red', '\ud83d\udd34 Red Bucket'],
    ['yellow', '\ud83d\udfe1 Yellow Bucket'],
    ['green', '\ud83d\udfe2 Green Bucket'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === gradebookBucketFilter) option.selected = true;
    bucketSelect.appendChild(option);
  });
  bucketSelect.addEventListener('change', () => handlers.onGradebookBucketFilterChange(bucketSelect.value));
  bar.appendChild(bucketSelect);

  // --- Sort ---
  const sortSelect = document.createElement('select');
  sortSelect.className = 'assessment-gradebook__control-select';
  const sortOptions = [
    ...SORT_OPTIONS_STATIC,
    ...assessmentSubjects.flatMap((assessmentSubject) => {
      const title = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId) || '(Subject removed)';
      return [
        { field: assessmentSubject.id, direction: 'desc', label: `${title} (High \u2192 Low)` },
        { field: assessmentSubject.id, direction: 'asc', label: `${title} (Low \u2192 High)` },
      ];
    }),
  ];
  sortOptions.forEach(({ field, direction, label }) => {
    const option = document.createElement('option');
    option.value = `${field}:${direction}`;
    option.textContent = label;
    if (field === gradebookSort.field && direction === gradebookSort.direction) option.selected = true;
    sortSelect.appendChild(option);
  });
  sortSelect.addEventListener('change', () => {
    const [field, direction] = sortSelect.value.split(':');
    handlers.onGradebookSortChange(field, direction);
  });
  bar.appendChild(sortSelect);

  // --- Student search ---
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'assessment-gradebook__control-search';
  searchInput.placeholder = 'Search student\u2026';
  searchInput.value = gradebookSearchQuery;
  searchInput.addEventListener('input', () => {
    // rerender() rebuilds this entire control bar from scratch,
    // including this exact input — without explicitly restoring
    // focus and cursor position afterward, every keystroke would
    // visibly kick focus out of the search box. Cursor position is
    // captured before the value that triggers it is even applied.
    const cursorPosition = searchInput.selectionStart;
    const query = searchInput.value;
    handlers.onGradebookSearchChange(query);
    requestGradebookSearchRefocus(cursorPosition);
  });
  bar.appendChild(searchInput);

  const hasActiveFilters = gradebookSubjectFilter !== 'all' || gradebookBucketFilter !== 'all' || gradebookSearchQuery.trim() !== '';
  if (hasActiveFilters) {
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'btn btn--text assessment-gradebook__clear-filters';
    clearButton.textContent = 'Clear Filters';
    clearButton.addEventListener('click', handlers.onGradebookClearFilters);
    bar.appendChild(clearButton);
  }

  return bar;
}

/**
 * Restores focus + cursor position to the search input after the
 * full rerender() this same keystroke triggered — queued as a
 * microtask so it runs after the freshly-rebuilt DOM this same
 * change produced is actually in place, not the stale one that
 * existed the instant this function was called.
 */
function requestGradebookSearchRefocus(cursorPosition) {
  queueMicrotask(() => {
    const input = document.querySelector('.assessment-gradebook__control-search');
    if (!input) return;
    input.focus();
    if (typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(cursorPosition, cursorPosition);
    }
  });
}

/**
 * The header card's own stat-tile row — Students / Marks Entered /
 * Passed / Failed / Not Assessed, each a real visual tile (see
 * .stat-tile in css/styles.css), not a line of text. Passed/Failed/
 * Not Assessed counts are entirely
 * services/assessmentService.js's own summarizeAssessmentOutcomes()
 * output — this function only decides how to paint each number, never
 * recomputes one. Semantic wash per meaning: neutral/navy for the two
 * plain counts, success for Passed, alert for Failed, muted-neutral
 * for Not Assessed (never treated as a failure — see this feature's
 * own "Missing ≠ Failed" rule).
 */
function renderGradebookStatTiles(studentCount, enteredCount, possibleCount, outcomeCounts) {
  const grid = document.createElement('div');
  grid.className = 'stat-tile-grid';

  [
    [String(studentCount), studentCount === 1 ? 'Student' : 'Students', 'neutral'],
    [`${enteredCount}/${possibleCount}`, 'Marks Entered', 'neutral'],
    [String(outcomeCounts.passed), 'Passed', 'success'],
    [String(outcomeCounts.failed), 'Failed', 'alert'],
    [String(outcomeCounts.notAssessed), 'Not Assessed', 'muted'],
  ].forEach(([value, label, variant]) => {
    const tile = document.createElement('div');
    tile.className = `stat-tile stat-tile--${variant}`;
    const valueEl = document.createElement('span');
    valueEl.className = 'stat-tile__value';
    valueEl.textContent = value;
    const labelEl = document.createElement('span');
    labelEl.className = 'stat-tile__label';
    labelEl.textContent = label;
    tile.append(valueEl, labelEl);
    grid.appendChild(tile);
  });

  return grid;
}

function renderGradebookStep(classroom, assessment, gradebookState, handlers) {
  const { gradebookSubjectFilter, gradebookBucketFilter, gradebookSearchQuery, gradebookSort } = gradebookState;
  const section = document.createElement('div');
  section.className = 'learning-management__section assessment-gradebook__section';

  const assessmentSubjects = assessment.assessmentSubjects;
  const allStudents = assessmentService.getClassroomStudents(classroom);
  const passMarkPercent = assessmentService.getPassMarkPercent(assessment);
  const students = getVisibleGradebookStudents(allStudents, assessmentSubjects, gradebookSubjectFilter, gradebookBucketFilter, gradebookSearchQuery, gradebookSort, passMarkPercent);

  const headerCard = document.createElement('div');
  headerCard.className = 'assessment-gradebook__header-card';

  const header = document.createElement('div');
  header.className = 'assessment-gradebook__header';

  const headerMain = document.createElement('div');
  headerMain.className = 'assessment-gradebook__header-main';

  const title = document.createElement('h2');
  title.className = 'assessment-gradebook__title';
  title.textContent = assessment.title;
  headerMain.appendChild(title);

  const scheduleDisplay = resolveLiveScheduleDisplay(classroom, assessment, gradebookState.linkedScheduledEvent);
  const dateTimeText = scheduleDisplay ? scheduleDisplay.text : formatDate(assessment.date) || assessment.date;

  // Structured metadata chips \u2014 Type / Date+Period / Academic Year as
  // distinct grouped pills (see .meta-chip in css/styles.css) rather
  // than one dot-joined sentence.
  const metaRow = document.createElement('div');
  metaRow.className = 'meta-chip-row';
  [assessment.type, dateTimeText, assessment.academicYear].filter(Boolean).forEach((text) => {
    const chip = document.createElement('span');
    chip.className = 'meta-chip';
    chip.textContent = text;
    metaRow.appendChild(chip);
  });
  headerMain.appendChild(metaRow);

  header.appendChild(headerMain);

  const actions = document.createElement('div');
  actions.className = 'assessment-gradebook__actions';

  if (scheduleDisplay) {
    const viewInTimetableButton = document.createElement('button');
    viewInTimetableButton.type = 'button';
    viewInTimetableButton.className = 'btn btn--ghost btn--pill assessment-gradebook__edit-link';
    viewInTimetableButton.textContent = 'View in Timetable';
    viewInTimetableButton.addEventListener('click', handlers.onViewInTimetable);
    actions.appendChild(viewInTimetableButton);
  }

  const editDetailsLink = document.createElement('button');
  editDetailsLink.type = 'button';
  editDetailsLink.className = 'btn btn--ghost btn--pill assessment-gradebook__edit-link';
  editDetailsLink.textContent = 'Edit Details';
  editDetailsLink.addEventListener('click', handlers.onGoToEditAssessmentDetails);
  actions.appendChild(editDetailsLink);

  header.appendChild(actions);
  headerCard.appendChild(header);

  if (assessmentSubjects.length > 0 && allStudents.length > 0) {
    const totalPossibleEntries = allStudents.length * assessmentSubjects.length;
    const totalEnteredEntries = assessmentSubjects.reduce(
      (sum, s) => sum + s.studentResults.filter((r) => r.marks !== null).length,
      0
    );

    const divider = document.createElement('hr');
    divider.className = 'assessment-gradebook__divider';
    headerCard.appendChild(divider);

    headerCard.appendChild(
      renderGradebookStatTiles(
        allStudents.length,
        totalEnteredEntries,
        totalPossibleEntries,
        assessmentService.summarizeAssessmentOutcomes(assessment, allStudents)
      )
    );
  }
  section.appendChild(headerCard);

  if (assessmentSubjects.length > 0 && allStudents.length > 0) {
    section.appendChild(renderBucketLegend(passMarkPercent));

    const filterCard = document.createElement('div');
    filterCard.className = 'assessment-gradebook__filter-card';
    const filterLabel = document.createElement('p');
    filterLabel.className = 'assessment-gradebook__filter-card-label';
    filterLabel.textContent = 'Filter & Sort';
    filterCard.appendChild(filterLabel);
    filterCard.appendChild(renderGradebookControls(classroom, assessmentSubjects, gradebookState, handlers));
    section.appendChild(filterCard);
  }

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

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'assessment-gradebook__scroll';
  const table = document.createElement('table');
  table.className = 'assessment-gradebook';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const studentTh = document.createElement('th');
  studentTh.className = 'assessment-gradebook__name-header assessment-gradebook__sortable-header';
  studentTh.textContent = 'Student';
  studentTh.addEventListener('click', () => {
    const nextDirection = gradebookSort.field === 'name' && gradebookSort.direction === 'asc' ? 'desc' : 'asc';
    handlers.onGradebookSortChange('name', nextDirection);
  });
  headerRow.appendChild(studentTh);
  const rollTh = document.createElement('th');
  rollTh.className = 'assessment-gradebook__roll-header';
  rollTh.textContent = 'Roll No.';
  headerRow.appendChild(rollTh);
  assessmentSubjects.forEach((assessmentSubject) => {
    const th = document.createElement('th');
    th.className = 'assessment-gradebook__subject-header';
    const title = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId);
    const titleEl = document.createElement('span');
    titleEl.className = 'assessment-gradebook__subject-title';
    titleEl.textContent = title || '(Subject removed)';
    th.appendChild(titleEl);

    // Total Marks \u2014 editable right here, where a teacher actually
    // looks at it, rather than only on the older single-subject
    // Subject Step screen (see renderSubjectStep()'s own Maximum
    // Marks field). Deliberately per-Subject, not a single
    // Assessment-wide value: models/AssessmentSubject.js's own
    // maximumMarks has always been per-Subject (a multi-subject
    // Assessment can legitimately mix e.g. Science /100 and Maths
    // /50), so this never flattens that. Pass Mark stays static text
    // here \u2014 it's the one genuinely Assessment-wide number, already
    // editable via "Edit Details".
    const maxEl = document.createElement('span');
    maxEl.className = 'assessment-gradebook__subject-max';
    const passMarkPercent = assessmentService.getPassMarkPercent(assessment);
    const maxMarksInput = document.createElement('input');
    maxMarksInput.type = 'number';
    maxMarksInput.className = 'assessment-gradebook__max-marks-input';
    maxMarksInput.value = assessmentService.getMaximumMarks(assessmentSubject);
    maxMarksInput.min = '0.01';
    maxMarksInput.setAttribute('aria-label', `${title || 'Subject'} total marks`);
    maxMarksInput.addEventListener('click', (event) => event.stopPropagation());
    maxMarksInput.addEventListener('change', () => {
      handlers.onGradebookMaximumMarksChange(assessmentSubject, maxMarksInput.value);
    });
    const passMarkSuffix = document.createElement('span');
    passMarkSuffix.textContent = ` \u00b7 Pass ${passMarkPercent}%`;
    maxEl.append('/', maxMarksInput, passMarkSuffix);
    th.appendChild(maxEl);

    if (gradebookState.gradebookMaxMarksError?.subjectId === assessmentSubject.id) {
      const error = document.createElement('span');
      error.className = 'assessment-gradebook__max-marks-error';
      error.textContent = gradebookState.gradebookMaxMarksError.message;
      th.appendChild(error);
    }

    headerRow.appendChild(th);
  });
  ['Total', '%'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '%') {
      th.className = 'assessment-gradebook__sortable-header';
      th.addEventListener('click', () => {
        const nextDirection = gradebookSort.field === 'percent' && gradebookSort.direction === 'desc' ? 'asc' : 'desc';
        handlers.onGradebookSortChange('percent', nextDirection);
      });
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student, rowIndex) => {
    const row = document.createElement('tr');

    // Row-level performance bucket for the Student cell's own swatch —
    // this Assessment's combined Total/Maximum across every Subject
    // (identical basis to this same row's own %/percentColorClass just
    // below), never a single subject in isolation. Computed ahead of
    // the per-subject loop (which recomputes the identical totals for
    // the Total/% cells) so the name cell — built first — already
    // knows the right colour; the small recomputation cost is
    // preferred over restructuring this loop's existing order.
    let rowBucketPreviewTotalMarks = 0;
    let rowBucketPreviewTotalMaximum = 0;
    assessmentSubjects.forEach((assessmentSubject) => {
      const existingResult = assessmentService.getStudentResult(assessmentSubject, student.id);
      const marks = existingResult ? existingResult.marks : null;
      if (marks !== null) {
        rowBucketPreviewTotalMarks += marks;
        rowBucketPreviewTotalMaximum += assessmentService.getMaximumMarks(assessmentSubject);
      }
    });
    const rowPerformanceBucketKey =
      rowBucketPreviewTotalMaximum > 0
        ? getMarksBucketKey(Math.round((rowBucketPreviewTotalMarks / rowBucketPreviewTotalMaximum) * 100), 100, passMarkPercent)
        : null;

    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    nameCell.appendChild(
      createStudentNameElement({ student, onSelect: handlers.onSelectStudent, leadingMarker: 'swatch', performanceBucketKey: rowPerformanceBucketKey })
    );
    row.appendChild(nameCell);

    const rollCell = createRollNumberCell({
      student,
      onSave: (rawValue) => handlers.onSaveStudentRollNumber(student, rawValue),
    });
    rollCell.classList.add('assessment-gradebook__roll-cell');
    row.appendChild(rollCell);

    let totalMarks = 0;
    let totalMaximum = 0;

    assessmentSubjects.forEach((assessmentSubject, colIndex) => {
      const cell = document.createElement('td');
      const existingResult = assessmentService.getStudentResult(assessmentSubject, student.id);
      const marks = existingResult ? existingResult.marks : null;

      const maximumMarks = assessmentService.getMaximumMarks(assessmentSubject);

      if (marks !== null) {
        totalMarks += marks;
        totalMaximum += maximumMarks;
      }

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'assessment-gradebook__cell-input';
      input.value = marks !== null ? marks : '';
      input.dataset.row = String(rowIndex);
      input.dataset.col = String(colIndex);

      const colorClass = getMarksColorClass(marks, maximumMarks, passMarkPercent);
      if (colorClass) cell.classList.add(colorClass);

      input.addEventListener('change', () => {
        const value = input.value === '' ? null : Number(input.value);
        handlers.onGradebookMarksEdit(assessmentSubject, student.id, value);
        cell.classList.remove('gradebook-cell--high', 'gradebook-cell--mid', 'gradebook-cell--low');
        const newColorClass = getMarksColorClass(value, maximumMarks, passMarkPercent);
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
    totalCell.className = 'assessment-gradebook__total-cell';
    totalCell.textContent = totalMaximum > 0 ? `${totalMarks} / ${totalMaximum}` : '\u2014';
    row.appendChild(totalCell);

    const percentCell = document.createElement('td');
    percentCell.className = 'assessment-gradebook__percent-cell';
    if (totalMaximum > 0) {
      const percent = Math.round((totalMarks / totalMaximum) * 100);
      percentCell.textContent = `${percent}%`;
      const percentColorClass = getMarksColorClass(percent, 100, passMarkPercent);
      if (percentColorClass) percentCell.classList.add(percentColorClass);
    } else {
      percentCell.textContent = '\u2014';
    }
    row.appendChild(percentCell);

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');

  const averageRow = document.createElement('tr');
  const averageLabel = document.createElement('td');
  averageLabel.className = 'assessment-gradebook__footer-label';
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
  enteredLabel.className = 'assessment-gradebook__footer-label';
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

function renderSubjectStep(classroom, assessment, assessmentSubject, sortBy, isEditing, draft, maximumMarksError, handlers) {
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
      handlers.onDraftMaximumMarksChange(maxMarksInput.value);
    });
    maxMarksLabel.appendChild(maxMarksInput);
  } else {
    const maxMarksValue = document.createElement('strong');
    maxMarksValue.textContent = String(assessmentService.getMaximumMarks(assessmentSubject));
    maxMarksLabel.appendChild(maxMarksValue);
  }
  section.appendChild(maxMarksLabel);

  if (isEditing && maximumMarksError) {
    const error = document.createElement('p');
    error.className = 'learning-management__inline-error';
    error.textContent = maximumMarksError;
    section.appendChild(error);
  }

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

  const rowMaximumMarks = isEditing ? Number(draft.maximumMarks) : assessmentService.getMaximumMarks(assessmentSubject);
  const rowPassMarkPercent = assessmentService.getPassMarkPercent(assessment);

  const list = document.createElement('div');
  list.className = 'assessment-marks-entry__list';
  sortedStudents.forEach((student) => {
    const rank = rankings.get(student.id);
    if (isEditing) {
      list.appendChild(renderEditableStudentRow(student, draft.resultsByStudentId.get(student.id), rank, rowMaximumMarks, rowPassMarkPercent, handlers));
    } else {
      const existingResult = assessmentService.getStudentResult(assessmentSubject, student.id);
      list.appendChild(renderReadOnlyStudentRow(student, existingResult, rank, rowMaximumMarks, rowPassMarkPercent, handlers));
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

  // Quiet, clearly-set-apart destructive action — see
  // renderAssessmentDangerZone()'s own comment above.
  const zone = document.createElement('div');
  zone.className = 'subject-danger-zone';
  const zoneIcon = createIcon('alert-triangle', { size: 16 });
  zoneIcon.classList.add('subject-danger-zone-icon');
  zone.appendChild(zoneIcon);
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

function renderEditableStudentRow(student, draftResult, rank, maximumMarks, passMarkPercent, handlers) {
  const row = document.createElement('div');
  row.className = 'assessment-marks-entry__row';

  const rankEl = document.createElement('span');
  rankEl.className = 'assessment-marks-entry__rank';
  rankEl.textContent = rank === null || rank === undefined ? '-' : `#${rank}`;
  row.appendChild(rankEl);

  const nameEl = document.createElement('span');
  nameEl.className = 'assessment-marks-entry__name';
  const performanceBucketKey = draftResult.absent ? null : getMarksBucketKey(draftResult.marks, maximumMarks, passMarkPercent);
  nameEl.appendChild(createStudentNameElement({ student, onSelect: handlers.onSelectStudent, leadingMarker: 'swatch', performanceBucketKey }));
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

function renderReadOnlyStudentRow(student, existingResult, rank, maximumMarks, passMarkPercent, handlers) {
  const row = document.createElement('div');
  row.className = 'assessment-marks-entry__row assessment-marks-entry__row--readonly';

  const rankEl = document.createElement('span');
  rankEl.className = 'assessment-marks-entry__rank';
  rankEl.textContent = rank === null || rank === undefined ? '-' : `#${rank}`;
  row.appendChild(rankEl);

  const nameEl = document.createElement('span');
  nameEl.className = 'assessment-marks-entry__name';
  const performanceBucketKey = existingResult && existingResult.absent ? null : getMarksBucketKey(existingResult ? existingResult.marks : null, maximumMarks, passMarkPercent);
  nameEl.appendChild(createStudentNameElement({ student, onSelect: handlers.onSelectStudent, leadingMarker: 'swatch', performanceBucketKey }));
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
