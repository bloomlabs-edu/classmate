/**
 * ui/views/NotebookCheckpointsView.js
 *
 * The Student x Checkpoint grid for one exact Notebook (Subject +
 * Notebook Type) — reuses services/checkpointService.js entirely; no
 * business logic lives here at all, matching this app's own
 * established "views own presentation, services own data" split.
 *
 * Deliberately NOT built on WorkRequest/WorkRequestRosterView.js —
 * see models/Checkpoint.js's own header comment for exactly why
 * (WorkRequest's "one open request at a time" constraint is
 * fundamentally incompatible with checkpoints coexisting
 * permanently). The sticky-header/sticky-first-column table shell
 * here directly reuses AssessmentManagementView.js's own Gradebook
 * CSS classes and structure — the strongest existing precedent for
 * exactly this shape (a scrollable Student x Column matrix), per
 * explicit product instruction, not a new grid system.
 *
 * Reuses ui/views/WorkRequestRosterView.js's own STATUS_META-style
 * chip conventions for status colour/icon/label — a checkpoint cell's
 * derived state (not submitted / submitted / submitted + complete /
 * submitted + incomplete / submitted late) is rendered through the
 * same chip language a teacher already knows from the Notebook
 * Tracker roster, not an invented, unrelated visual system.
 *
 * RENDER ARCHITECTURE — deliberately NOT "wipe container.innerHTML and
 * rebuild everything on every state change," which this file used to
 * do. The header, "+ Add Checkpoint" button, and three persistent
 * slots (form / grid / cell editor) are built exactly ONCE, on mount.
 * Every handler afterward updates only the slot(s) its own action
 * actually affects:
 *   - Opening/closing a cell editor, or opening/canceling/toggling the
 *     create/edit-checkpoint form, touches ONLY that slot's own
 *     content — the grid (and its scroll position) is never touched.
 *   - Quick-marking submitted, quick review, and saving a cell's
 *     details patch ONLY that one <td> (plus its column's own stat
 *     boxes) in place via updateCellAndColumn() — never a grid
 *     rebuild, so the scroll container is never destroyed for these.
 *   - Only genuinely structural changes (create/edit/delete/reorder a
 *     checkpoint, or a fresh server-confirmed classroom via
 *     workspaceCoordinator below) rebuild the grid via refreshGrid() —
 *     for exactly these cases, refreshGrid() captures and restores
 *     the scroll container's own scrollTop across the rebuild, since
 *     a full rebuild is genuinely unavoidable here (the set of
 *     checkpoints/students/columns itself may have changed), but
 *     losing scroll position to it is not.
 *
 * Registers with services/workspaceCoordinator.js as this classroom's
 * active workspace (mirroring ui/views/SeatingView.js's own exact
 * pattern) so a Firestore-confirmed snapshot of a save updates the
 * grid in place instead of falling through to workspaceService.js's
 * coarser onChange-triggers-renderRoute() path, which would otherwise
 * tear down and remount this entire view (losing scroll position AND
 * any open form/cell editor) every time this classroom's document
 * changes on the server — including from this teacher's own save.
 */

import * as checkpointService from '../../services/checkpointService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as notebookBadgeService from '../../services/notebookBadgeService.js';
import * as notebookBadgeAwardService from '../../services/notebookBadgeAwardService.js';
import * as notebookReadinessChampionService from '../../services/notebookReadinessChampionService.js';
import * as recognitionService from '../../services/recognitionService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';
import * as notificationService from '../../services/notificationService.js';
import { NOTIFICATION_CATEGORIES } from '../../config/notificationCategories.js';
import { getClassroomStudents } from '../../services/assessmentService.js';
import { formatDate, getTodayDateKey } from '../../utils/dateHelpers.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';
import { createOverflowMenu } from '../components/OverflowMenu.js';
import { createBadge } from '../components/Badge.js';
import { openAddBadgeTypeModal } from '../components/AddNotebookBadgeTypeModal.js';
import { openAwardReviewBadgesModal } from '../components/AwardReviewBadgesModal.js';
import { getScoreDisplay, getProgressSummary } from './NotebookStudentRowDisplay.js';

/**
 * Cell status metadata — deliberately mirrors
 * WorkRequestRosterView.js's own STATUS_META shape (label + chipClass
 * + icon), so a teacher sees the same visual language across both
 * screens, without importing that file's own WorkRequest-specific
 * status set (which has no equivalent to "submitted late" at all,
 * and includes several statuses — needs_correction, resubmitted,
 * absent — that don't exist in this simpler, two-dimensional model).
 */
/**
 * Exported so other views (e.g.
 * ui/student-portal/views/StudentNotebooksView.js's own Checkpoints
 * section) render the exact same status language, icon, and color as
 * this grid, rather than duplicating the lookup into a second status
 * model.
 *
 * `icon` is a name from ui/components/Icon.js's own SVG set — never
 * an emoji, per this design system's own convention. chipClass drives
 * both the cell's background tint (see the .notebook-checkpoints__cell--*
 * rules) and the icon's own color via currentColor.
 */
export function getCellMeta(checkpoint, record) {
  if (!record || record.submissionStatus === 'not_submitted') {
    return { label: 'Not Submitted', chipClass: 'red', icon: 'x-circle' };
  }
  const late = checkpointService.isLate(checkpoint, record);
  if (record.reviewStatus === 'complete') {
    // `late` only ever changes the label here — Complete is green
    // regardless of timing (see this function's own header comment on
    // the intended status hierarchy: Complete is always green,
    // Incomplete is always orange; lateness is a text detail on top of
    // that, never a color change on its own).
    return late
      ? { label: 'Submitted late · Complete', chipClass: 'green', icon: 'check-circle-2' }
      : { label: 'Submitted · Complete', chipClass: 'green', icon: 'check-circle-2' };
  }
  if (record.reviewStatus === 'incomplete') {
    return late
      ? { label: 'Submitted late · Incomplete', chipClass: 'orange', icon: 'alert-triangle' }
      : { label: 'Submitted · Incomplete', chipClass: 'orange', icon: 'alert-triangle' };
  }
  return late
    ? { label: 'Submitted late · Not Reviewed', chipClass: 'purple', icon: 'circle-dot' }
    : { label: 'Not Reviewed', chipClass: 'purple', icon: 'circle-dot' };
}

export function renderNotebookCheckpointsView(container, { classroom, currentUser, subjectId, notebookTypeId, onBack, onSelectStudent, onGoToClassMode }) {
  // Replaced wholesale by resyncFromServer() below whenever
  // workspaceCoordinator delivers a fresh, server-confirmed classroom
  // — every handler below reads THIS variable at call time (never a
  // captured value from an earlier render), so nothing here ever acts
  // on a stale object once a sync has landed.
  let currentClassroom = classroom;
  let editingCheckpointId = null; // null | 'new' | an existing checkpoint's own id — the header create/edit form
  let openCellFor = null; // null | { checkpointId, studentId } — the one open cell editor at a time

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'notebook-checkpoints';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(
    createBackButton(() => {
      workspaceCoordinator.unregisterActiveWorkspace(currentClassroom.id);
      onBack();
    })
  );
  const titleEl = document.createElement('h1');
  titleEl.className = 'tracker-header__title';
  header.appendChild(titleEl);
  // Class Mode <-> Notebook Mode quick-jump — same persistent,
  // always-available button as NotebookTrackerView.js/
  // NotebookDailyCheckView.js's own header (see those files' own
  // comments); not gated on how this screen was reached.
  if (onGoToClassMode) {
    const actions = document.createElement('div');
    actions.className = 'notebook-tracker__page-header-actions';
    const classModeButton = document.createElement('button');
    classModeButton.type = 'button';
    classModeButton.className = 'btn btn--ghost btn--icon-only';
    classModeButton.appendChild(createIcon('users'));
    classModeButton.setAttribute('aria-label', 'Class Mode');
    classModeButton.title = 'Class Mode';
    classModeButton.addEventListener('click', onGoToClassMode);
    actions.appendChild(classModeButton);
    header.appendChild(actions);
  }
  wrapper.appendChild(header);

  function refreshTitle() {
    const subject = notebookConfigService.getSubjectById(currentClassroom, subjectId);
    const notebookType = notebookConfigService.getNotebookTypeById(currentClassroom, notebookTypeId);
    titleEl.textContent = `${subject?.name || '(Subject removed)'} · ${notebookType?.name || '(Type removed)'} — Checkpoints`;
  }

  const content = document.createElement('div');
  content.className = 'notebook-checkpoints__content';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary notebook-checkpoints__add-button';
  addButton.textContent = '+ Add Checkpoint';
  addButton.addEventListener('click', () => {
    editingCheckpointId = 'new';
    refreshForm();
  });
  content.appendChild(addButton);

  // Three persistent slots — never replaced wholesale themselves, only
  // their own contents. This is what lets each kind of update touch
  // only what it actually needs to.
  const formSlot = document.createElement('div');
  content.appendChild(formSlot);

  const gridSlot = document.createElement('div');
  content.appendChild(gridSlot);

  const cellEditorSlot = document.createElement('div');
  content.appendChild(cellEditorSlot);

  wrapper.appendChild(content);
  container.appendChild(wrapper);

  function getSortedStudents() {
    return [...getClassroomStudents(currentClassroom)].sort((a, b) => a.name.localeCompare(b.name));
  }

  function persistClassroom() {
    workspaceService.save(currentClassroom);
  }

  /**
   * The MVP's one checkpoint-side notification publisher — fires only
   * when a review outcome actually becomes 'incomplete' (a submission
   * that needs a teacher's own follow-up, per this app's own existing
   * status hierarchy — see getCellMeta() above), never for 'complete'
   * or 'not_reviewed'. Called from onQuickReview/onSaveCell below,
   * after persistClassroom() — mirrors this file's own established
   * "call a side effect from the handler, never from inside
   * checkpointService.js's own pure data functions" split (see this
   * file's own header comment). Does not compare against the
   * student's own previous status first, so re-saving an
   * already-Incomplete review re-fires this — an accepted MVP
   * limitation, not a bug: avoiding it would mean tracking previous
   * status somewhere new, which is more machinery than this milestone
   * calls for.
   */
  function notifyIfIncomplete(checkpointId, studentId, status) {
    if (status !== 'incomplete') return;
    const checkpoint = checkpointService.getCheckpointById(currentClassroom, checkpointId);
    const student = getSortedStudents().find((s) => s.id === studentId);
    if (!checkpoint || !student) return;
    notificationService.publishNotification(currentClassroom.id, {
      type: 'checkpoint_incomplete',
      category: NOTIFICATION_CATEGORIES.CHECKPOINTS,
      title: 'Checkpoint marked Incomplete',
      message: `${student.name}’s “${checkpoint.title}” was marked Incomplete.`,
      payload: { studentId, checkpointId },
      createdByUid: currentUser?.uid,
    });
  }

  /**
   * The "evaluation prompt" — opened right after a review is marked
   * 'complete' (never merely 'submitted'; see
   * services/notebookBadgeAwardService.js's own header comment),
   * wherever that transition happens (onQuickReview or onSaveCell
   * below). Resolves each badge's own already-awarded state from the
   * real, just-persisted record before opening, so re-opening this for
   * an already-decided badge shows "Awarded ✓" rather than offering a
   * duplicate award.
   */
  function openReviewCompletionBadgePrompt(checkpoint, student) {
    const record = checkpointService.getRecordForStudent(checkpoint, student.id);
    const badges = notebookBadgeAwardService.REVIEW_COMPLETION_BADGE_IDS.map((badgeTypeId) => {
      const type = notebookBadgeService.getBadgeTypeById(currentClassroom, badgeTypeId);
      return {
        id: badgeTypeId,
        name: type ? type.name : badgeTypeId,
        alreadyAwarded: notebookBadgeAwardService.hasActiveBadgeAward(record, badgeTypeId),
      };
    });
    openAwardReviewBadgesModal({
      studentName: student.name,
      checkpointTitle: checkpoint.title,
      badges,
      onAward: (badgeTypeId) => {
        try {
          notebookBadgeAwardService.awardReviewCompletionBadge(currentClassroom, checkpoint, student, badgeTypeId, currentUser?.uid);
          persistClassroom();
          updateCellAndColumn(checkpoint.id, student.id);
          return true;
        } catch (error) {
          window.alert(error.message);
          return false;
        }
      },
    });
  }

  const handlers = {
    onStartCreate: () => {
      editingCheckpointId = 'new';
      refreshForm();
    },
    onStartEdit: (checkpointId) => {
      editingCheckpointId = checkpointId;
      refreshForm();
    },
    onCancelEdit: () => {
      editingCheckpointId = null;
      refreshForm();
    },
    onSaveCheckpoint: (fields) => {
      if (editingCheckpointId === 'new') {
        checkpointService.createNewCheckpoint(currentClassroom, { subjectId, notebookTypeId, ...fields });
      } else {
        const checkpoint = checkpointService.getCheckpointById(currentClassroom, editingCheckpointId);
        checkpointService.updateCheckpoint(checkpoint, fields);
      }
      editingCheckpointId = null;
      refreshForm();
      // A new checkpoint adds a required item (can turn an already-complete
      // notebook incomplete again); editing a due date can turn an
      // already-on-time notebook late, or vice versa. Either way this is a
      // structural change to the notebook itself, not one student's own
      // submission event — re-evaluate every student against this one
      // notebook, not just whoever happens to be open in the cell editor.
      notebookReadinessChampionService.reevaluateReadinessChampionForAllStudents(currentClassroom, subjectId, notebookTypeId, currentUser?.uid);
      persistClassroom();
      refreshGrid(); // structural change (a column was added/edited) — genuine full grid rebuild, scroll preserved
    },
    onDeleteCheckpoint: (checkpointId, title) => {
      const confirmed = window.confirm(`Delete "${title}"? This removes every student's own record for it too. This cannot be undone.`);
      if (!confirmed) return;
      checkpointService.deleteCheckpoint(currentClassroom, checkpointId);
      // Removing a required checkpoint can newly complete a notebook that
      // was only ever pending on this one — same structural-change
      // reasoning as onSaveCheckpoint above.
      notebookReadinessChampionService.reevaluateReadinessChampionForAllStudents(currentClassroom, subjectId, notebookTypeId, currentUser?.uid);
      persistClassroom();
      refreshGrid(); // structural change (a column was removed)
    },
    onMoveCheckpoint: (checkpointId, direction) => {
      const ordered = checkpointService.listCheckpointsForNotebook(currentClassroom, subjectId, notebookTypeId);
      const index = ordered.findIndex((c) => c.id === checkpointId);
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= ordered.length) return;
      const reordered = [...ordered];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      checkpointService.reorderCheckpoints(currentClassroom, subjectId, notebookTypeId, reordered.map((c) => c.id));
      persistClassroom();
      refreshGrid(); // structural change (column order changed)
    },
    onOpenCell: (checkpointId, studentId) => {
      openCellFor = { checkpointId, studentId };
      refreshCellEditor(); // overlay only — grid/scroll untouched
    },
    onQuickMarkSubmitted: (checkpointId, studentId) => {
      const checkpoint = checkpointService.getCheckpointById(currentClassroom, checkpointId);
      // Routed through recognitionService.js (WORK-0038) rather than
      // calling checkpointService.setSubmission() directly — makes that
      // exact same call, but Completion Star is no longer earned here
      // at all (submission alone never awards it; see
      // recordNotebookCheckpointReview() below for the real trigger).
      recognitionService.recordNotebookCheckpointSubmission(currentClassroom, checkpoint, studentId, {
        status: 'submitted',
        submittedDate: getTodayDateKey(),
      });
      // Readiness Champion's own automatic trigger — re-evaluates the
      // ENTIRE subject notebook's completeness, not just this one
      // checkpoint. See services/notebookReadinessChampionService.js's
      // own header comment. Unchanged by WORK-0038 — Completion Star
      // and Readiness Champion remain entirely separate mechanisms.
      const student = getSortedStudents().find((s) => s.id === studentId);
      if (student) notebookReadinessChampionService.evaluateReadinessChampionForNotebook(currentClassroom, checkpoint.subjectId, checkpoint.notebookTypeId, student, currentUser?.uid);
      persistClassroom();
      updateCellAndColumn(checkpointId, studentId); // one <td> + its column's stat boxes — no grid rebuild
    },
    onQuickReview: (checkpointId, studentId, status) => {
      const checkpoint = checkpointService.getCheckpointById(currentClassroom, checkpointId);
      // Routed through recognitionService.js (WORK-0038) — THE real
      // Completion Star trigger: awards once this exact review reaches
      // 'complete' (never merely 'submitted'), reverses on Complete ->
      // Incomplete, and correctly supports re-completion. See that
      // function's own header comment.
      recognitionService.recordNotebookCheckpointReview(currentClassroom, checkpoint, studentId, { status, reviewedDate: getTodayDateKey() }, currentUser?.uid);
      persistClassroom();
      notifyIfIncomplete(checkpointId, studentId, status);
      updateCellAndColumn(checkpointId, studentId);
      // Organization/Punctuation Champion's own one trigger point — a
      // review genuinely marked Complete, never merely Submitted.
      // Unchanged by WORK-0038 — a distinct, manual-award badge system,
      // never conflated with the automatic Completion Star above.
      if (status === 'complete') {
        const student = getSortedStudents().find((s) => s.id === studentId);
        if (student) openReviewCompletionBadgePrompt(checkpoint, student);
      }
    },
    onCloseCell: () => {
      openCellFor = null;
      refreshCellEditor();
    },
    onSaveCell: (checkpointId, studentId, submission, review, teacherNote) => {
      const checkpoint = checkpointService.getCheckpointById(currentClassroom, checkpointId);
      // Submission wrapper first (handles a withdrawal silently
      // un-completing an already-'complete' review — see that
      // function's own header comment), then the review wrapper (THE
      // real Completion Star trigger) — WORK-0038.
      recognitionService.recordNotebookCheckpointSubmission(currentClassroom, checkpoint, studentId, submission);
      recognitionService.recordNotebookCheckpointReview(currentClassroom, checkpoint, studentId, review, currentUser?.uid);
      checkpointService.setTeacherNote(checkpoint, studentId, teacherNote);
      const student = getSortedStudents().find((s) => s.id === studentId);
      // Readiness Champion re-evaluation — unconditional, not branched
      // on submission.status, because evaluateReadinessChampionForNotebook()
      // itself decides whether this notebook is now complete-and-on-time
      // (award), still active but no longer honest (auto-revoke), or
      // neither (no-op) — covers a fresh on-time submission, a
      // withdrawal (submitted -> not_submitted), and a corrected date on
      // an already-submitted record, with the one same call. See
      // services/notebookReadinessChampionService.js's own header
      // comment.
      if (student) {
        notebookReadinessChampionService.evaluateReadinessChampionForNotebook(currentClassroom, checkpoint.subjectId, checkpoint.notebookTypeId, student, currentUser?.uid);
      }
      openCellFor = null;
      persistClassroom();
      notifyIfIncomplete(checkpointId, studentId, review.status);
      refreshCellEditor();
      updateCellAndColumn(checkpointId, studentId);
      if (student && review.status === 'complete') {
        openReviewCompletionBadgePrompt(checkpoint, student);
      }
    },
    onOverrideReadiness: (checkpointId, studentId) => {
      const checkpoint = checkpointService.getCheckpointById(currentClassroom, checkpointId);
      const student = getSortedStudents().find((s) => s.id === studentId);
      if (!checkpoint || !student) return;
      try {
        notebookReadinessChampionService.overrideReadinessChampionForNotebook(currentClassroom, checkpoint.subjectId, checkpoint.notebookTypeId, student, currentUser?.uid);
        persistClassroom();
        updateCellAndColumn(checkpointId, studentId);
        refreshCellEditor();
      } catch (error) {
        window.alert(error.message);
      }
    },
    onRevokeReadiness: (checkpointId, studentId) => {
      const checkpoint = checkpointService.getCheckpointById(currentClassroom, checkpointId);
      const student = getSortedStudents().find((s) => s.id === studentId);
      if (!checkpoint || !student) return;
      try {
        notebookReadinessChampionService.revokeReadinessChampionForNotebook(currentClassroom, checkpoint.subjectId, checkpoint.notebookTypeId, student, currentUser?.uid);
        persistClassroom();
        updateCellAndColumn(checkpointId, studentId);
        refreshCellEditor();
      } catch (error) {
        window.alert(error.message);
      }
    },
    // Explicit teacher removal of an active Completion Star (WORK-0038)
    // — mirrors onRevokeReadiness above exactly, but for
    // recognitionService.js's own separate mechanism, never
    // notebookReadinessChampionService.js's. Reverses the EXACT associated +1
    // points event via recognitionService.removeCompletionStar()'s own
    // ledger mechanics; never touches Readiness Champion.
    onRemoveCompletionStar: (checkpointId, studentId) => {
      const checkpoint = checkpointService.getCheckpointById(currentClassroom, checkpointId);
      const student = getSortedStudents().find((s) => s.id === studentId);
      if (!checkpoint || !student) return;
      const workItemRef = recognitionService.buildNotebookCheckpointWorkItemRef({
        subjectId: checkpoint.subjectId,
        notebookTypeId: checkpoint.notebookTypeId,
        checkpointId: checkpoint.id,
      });
      try {
        recognitionService.removeCompletionStar(currentClassroom, student, workItemRef, currentUser?.uid);
        persistClassroom();
        updateCellAndColumn(checkpointId, studentId);
        refreshCellEditor();
      } catch (error) {
        window.alert(error.message);
      }
    },
    // Reuses the existing app-wide student-profile navigation prop
    // (identical to GoalDashboardView.js's own handlers.onSelectStudent)
    // — no new route or navigation mechanism introduced here.
    onSelectStudent,
    // Student Row Redesign — "+ Add Badge Type" in the Student column
    // header. A purely additive, classroom-scoped catalog change (see
    // services/notebookBadgeService.js); never awards anything by
    // itself, so it never touches any student's own counts.
    onAddBadgeType: () => {
      openAddBadgeTypeModal({
        onSave: (name) => {
          const added = notebookBadgeService.addBadgeType(currentClassroom, name);
          if (!added) {
            window.alert('A badge type with that name already exists.');
            return false;
          }
          persistClassroom();
          refreshGrid(); // structural change (a new badge type can now appear on any student row)
          return true;
        },
      });
    },
  };

  function refreshForm() {
    formSlot.innerHTML = '';
    if (editingCheckpointId) {
      const checkpoint = editingCheckpointId === 'new' ? null : checkpointService.getCheckpointById(currentClassroom, editingCheckpointId);
      formSlot.appendChild(renderCheckpointForm(checkpoint, handlers));
    }
  }

  function refreshCellEditor() {
    cellEditorSlot.innerHTML = '';
    if (openCellFor) {
      const checkpoint = checkpointService.getCheckpointById(currentClassroom, openCellFor.checkpointId);
      const student = getSortedStudents().find((s) => s.id === openCellFor.studentId);
      if (checkpoint && student) {
        cellEditorSlot.appendChild(renderCellEditor(checkpoint, student, handlers));
      }
    }
  }

  /**
   * The one full-grid rebuild path — used only where a full rebuild is
   * genuinely unavoidable (see this file's own header comment):
   * checkpoint create/edit/delete/reorder, and a fresh
   * workspaceCoordinator sync (which, per that registration's own
   * comment above, is also what actually runs after every quick
   * action's own persistClassroom() write echoes back). Captures the
   * scroll container's own scrollTop AND scrollLeft before tearing it
   * down, and restores both on the new one after — the container this
   * app scrolls is .assessment-gradebook__scroll itself (it, not
   * window, carries both the vertical roster scroll and the horizontal
   * checkpoint-column scroll), so a rebuild that only preserved
   * scrollTop would still snap a teacher who'd scrolled right back to
   * the leftmost column on every one of these actions.
   */
  function refreshGrid() {
    const previousScrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    const previousScrollTop = previousScrollEl?.scrollTop ?? 0;
    const previousScrollLeft = previousScrollEl?.scrollLeft ?? 0;

    gridSlot.innerHTML = '';

    const checkpoints = checkpointService.listCheckpointsForNotebook(currentClassroom, subjectId, notebookTypeId);
    const students = getSortedStudents();

    if (students.length === 0) {
      gridSlot.appendChild(createEmptyStateElement({ message: 'No students on this roster yet.' }));
    } else if (checkpoints.length === 0) {
      gridSlot.appendChild(renderEmptyCheckpointsInstructionalCue());
      gridSlot.appendChild(renderEmptyCheckpointsGrid(students, handlers, currentClassroom));
    } else {
      gridSlot.appendChild(renderGrid(checkpoints, students, handlers, currentClassroom));
    }

    const scrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    if (scrollEl) {
      scrollEl.scrollTop = previousScrollTop;
      scrollEl.scrollLeft = previousScrollLeft;
    }
  }

  /**
   * The targeted alternative to refreshGrid() for a single cell's own
   * status changing (quick mark, quick review, cell editor save) —
   * finds and replaces only that <td>'s own content, plus its
   * column's own stat boxes (Submitted/Complete counts, which those
   * three actions can change), via the exact same data-checkpoint-id/
   * data-student-id attributes renderGrid() stamps onto each cell and
   * column header below. Falls back to refreshGrid() only if the grid
   * itself doesn't exist yet in the DOM (e.g. this was the very first
   * checkpoint action while still showing the pre-first-checkpoint
   * empty grid) — a state refreshGrid() alone can resolve correctly.
   */
  function updateCellAndColumn(checkpointId, studentId) {
    const scrollEl = gridSlot.querySelector('.assessment-gradebook__scroll');
    const checkpoint = checkpointService.getCheckpointById(currentClassroom, checkpointId);
    if (!scrollEl || !checkpoint) {
      refreshGrid();
      return;
    }

    const students = getSortedStudents();
    const student = students.find((s) => s.id === studentId);
    const cell = scrollEl.querySelector(`td[data-checkpoint-id="${checkpointId}"][data-student-id="${studentId}"]`);
    if (cell && student) {
      cell.innerHTML = '';
      populateCheckpointCell(cell, checkpoint, student, handlers);
    }

    const statsEl = scrollEl.querySelector(`th[data-checkpoint-id="${checkpointId}"] .notebook-checkpoints__column-stats`);
    if (statsEl) {
      statsEl.replaceWith(buildColumnStats(checkpoint, students));
    }

    // A review outcome change can move this ONE student's own
    // completed/pending counts (see getProgressSummary() in
    // NotebookStudentRowDisplay.js) — refresh only their own name
    // cell's progress summary + bar, never a full grid rebuild for
    // this targeted action.
    const nameCell = scrollEl.querySelector(`td.assessment-gradebook__name-cell[data-student-id="${studentId}"]`);
    if (nameCell && student) {
      const checkpoints = checkpointService.listCheckpointsForNotebook(currentClassroom, subjectId, notebookTypeId);
      populateStudentNameCell(nameCell, student, handlers, checkpoints, currentClassroom);
    }
  }

  // Initial mount — the only point where every slot is populated together.
  refreshTitle();
  refreshForm();
  refreshGrid();
  refreshCellEditor();

  // Registered last, once this workspace actually has something showing
  // — mirrors ui/views/SeatingView.js's own exact registration shape.
  // A fresh, server-confirmed classroom only ever refreshes the title
  // and the grid: both are safe to rebuild unconditionally (the title
  // is inexpensive, and refreshGrid() preserves scroll — both axes,
  // see refreshGrid() itself). Deliberately does NOT refresh an open
  // form or cell editor here — either would discard a teacher's own
  // in-progress, unsaved edits inside that overlay, which would be a
  // strictly worse regression than the scroll-reset bug this change
  // exists to fix. This registration is also why a quick action
  // (Mark Submitted, a quick review, a cell save) can still trigger a
  // full refreshGrid() even though its own handler above only ever
  // calls the targeted updateCellAndColumn() directly: persistClassroom()'s
  // own write comes back through here as a fresh server-confirmed
  // snapshot and rebuilds the grid — which is exactly why refreshGrid()'s
  // own scroll preservation has to cover the horizontally-scrolling
  // container's scrollLeft too, not just its scrollTop.
  workspaceCoordinator.registerActiveWorkspace(currentClassroom.id, (freshClassroom) => {
    currentClassroom = freshClassroom;
    refreshTitle();
    refreshGrid();
  });
}

/**
 * The empty-state instructional cue — small and unobtrusive, per
 * explicit instruction, not a tutorial. Only ever shown alongside
 * renderEmptyCheckpointsGrid() below, never on its own.
 */
function renderEmptyCheckpointsInstructionalCue() {
  const cue = document.createElement('div');
  cue.className = 'notebook-checkpoints__empty-cue';
  const icon = document.createElement('span');
  icon.className = 'notebook-checkpoints__empty-cue-icon';
  icon.textContent = '💡';
  const text = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'notebook-checkpoints__empty-cue-title';
  title.textContent = 'Start by adding your first checkpoint.';
  const subtitle = document.createElement('p');
  subtitle.className = 'notebook-checkpoints__empty-cue-subtitle';
  subtitle.textContent = 'Click the first column header to enter the unit or checkpoint you want to track.';
  text.append(title, subtitle);
  cue.append(icon, text);
  return cue;
}

/**
 * The pre-first-checkpoint grid — the real roster (reusing the exact
 * same `students` array and sticky-table CSS classes renderGrid()
 * itself uses), plus exactly ONE placeholder checkpoint column that
 * is NOT a real Checkpoint at all — clicking it calls the same
 * handlers.onStartCreate() the existing "+ Add Checkpoint" button
 * already uses, opening the exact same, unmodified creation form.
 * Every student cell under the placeholder is a plain, non-
 * interactive dash — there is no real checkpoint to click into yet,
 * and this function creates neither a Checkpoint nor any
 * StudentCheckpointRecord merely by rendering.
 */
function renderEmptyCheckpointsGrid(students, handlers, classroom) {
  const scroll = document.createElement('div');
  scroll.className = 'assessment-gradebook__scroll';

  const table = document.createElement('table');
  table.className = 'assessment-gradebook notebook-checkpoints__table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  headerRow.appendChild(buildStudentColumnHeader('Students', handlers));

  const placeholderTh = document.createElement('th');
  placeholderTh.className = 'notebook-checkpoints__column-header';
  const placeholderButton = document.createElement('button');
  placeholderButton.type = 'button';
  placeholderButton.className = 'notebook-checkpoints__empty-column-button';
  const placeholderIcon = document.createElement('span');
  placeholderIcon.textContent = '✎';
  const placeholderLabel = document.createElement('span');
  placeholderLabel.textContent = 'Enter unit name / checkpoint';
  placeholderButton.append(placeholderIcon, placeholderLabel);
  placeholderButton.addEventListener('click', handlers.onStartCreate);
  placeholderTh.appendChild(placeholderButton);
  headerRow.appendChild(placeholderTh);

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    nameCell.dataset.studentId = student.id;
    populateStudentNameCell(nameCell, student, handlers, [], classroom);
    row.appendChild(nameCell);

    const placeholderCell = document.createElement('td');
    placeholderCell.className = 'notebook-checkpoints__cell notebook-checkpoints__cell--gray';
    placeholderCell.textContent = '—';
    row.appendChild(placeholderCell);

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  scroll.appendChild(table);
  return scroll;
}

/**
 * The Student column's own header — "Students"/"Student" text plus the
 * Student Row Redesign's "+ Add Badge Type" action, shared by both
 * renderEmptyCheckpointsGrid() and renderGrid() (identical markup
 * either way; only the roster below it differs).
 */
export function buildStudentColumnHeader(labelText, handlers) {
  const nameTh = document.createElement('th');
  nameTh.className = 'assessment-gradebook__name-header notebook-checkpoints__student-header';

  const label = document.createElement('span');
  label.textContent = labelText;
  nameTh.appendChild(label);

  const addBadgeTypeButton = document.createElement('button');
  addBadgeTypeButton.type = 'button';
  addBadgeTypeButton.className = 'notebook-checkpoints__add-badge-type-button';
  addBadgeTypeButton.appendChild(createIcon('plus', { size: 12 }));
  addBadgeTypeButton.append('Add Badge Type');
  addBadgeTypeButton.setAttribute('aria-label', 'Add a new badge type');
  addBadgeTypeButton.addEventListener('click', handlers.onAddBadgeType);
  nameTh.appendChild(addBadgeTypeButton);

  return nameTh;
}

/** One compact "2/21 · Submitted" stat box for a checkpoint column header — the number is the visually prominent part, the label is smaller and muted, per the explicit visual hierarchy. */
function createColumnStatBox(count, total, label) {
  const box = document.createElement('div');
  box.className = 'notebook-checkpoints__column-stat-box';
  const number = document.createElement('span');
  number.className = 'notebook-checkpoints__column-stat-number';
  number.textContent = `${count}/${total}`;
  const labelEl = document.createElement('span');
  labelEl.className = 'notebook-checkpoints__column-stat-label';
  labelEl.textContent = label;
  box.append(number, labelEl);
  return box;
}

/**
 * The Submitted/Complete stat boxes plus a subtle Submitted-progress
 * bar underneath — one self-contained unit, returned fresh each call,
 * so updateCellAndColumn() (see renderNotebookCheckpointsView() above)
 * can swap the whole thing out via replaceWith() after a quick-mark/
 * quick-review/cell-save action changes these counts, without
 * touching anything else in the column header.
 */
function buildColumnStats(checkpoint, students) {
  const summary = checkpointService.getCheckpointSummary(checkpoint, students);

  const statsEl = document.createElement('div');
  statsEl.className = 'notebook-checkpoints__column-stats';

  const boxesRow = document.createElement('div');
  boxesRow.className = 'notebook-checkpoints__column-stat-boxes';
  boxesRow.appendChild(createColumnStatBox(summary.submittedCount, students.length, 'Submitted'));
  boxesRow.appendChild(createColumnStatBox(summary.completeCount, students.length, 'Complete'));
  statsEl.appendChild(boxesRow);

  const percentSubmitted = students.length > 0 ? Math.round((summary.submittedCount / students.length) * 100) : 0;
  const progress = document.createElement('div');
  progress.className = 'notebook-checkpoints__column-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuenow', String(percentSubmitted));
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-label', `${summary.submittedCount} of ${students.length} submitted`);
  const progressFill = document.createElement('div');
  progressFill.className = 'notebook-checkpoints__column-progress-fill';
  progressFill.style.width = `${percentSubmitted}%`;
  progress.appendChild(progressFill);
  statsEl.appendChild(progress);

  return statsEl;
}

/**
 * The compact "unit card" a checkpoint column header now renders as —
 * a code (its position in this Notebook, U01/U02/…, not a stored
 * field: computed purely from display order so no data-model change
 * was needed), the title (strongest hierarchy), the given/due date
 * (small, muted), then buildColumnStats() above. Edit/Move/Delete —
 * every existing column action, unchanged in behavior — now live
 * under one compact overflow menu (ui/components/OverflowMenu.js,
 * this app's existing platform-wide pattern for exactly this kind of
 * per-item management menu) instead of four always-visible buttons.
 * Move Left/Move Right are simply omitted at the first/last position
 * rather than shown disabled — OverflowMenu's own action list has no
 * disabled-item concept, and omission reads at least as clearly here.
 */
function buildUnitCard(checkpoint, index, checkpoints, students, handlers) {
  const card = document.createElement('div');
  card.className = 'notebook-checkpoints__unit-card';

  const topRow = document.createElement('div');
  topRow.className = 'notebook-checkpoints__unit-card-top';

  const code = document.createElement('span');
  code.className = 'notebook-checkpoints__unit-code';
  code.textContent = `U${String(index + 1).padStart(2, '0')}`;
  topRow.appendChild(code);

  const menuActions = [{ label: 'Edit checkpoint', onClick: () => handlers.onStartEdit(checkpoint.id) }];
  if (index > 0) {
    menuActions.push({ label: 'Move left', onClick: () => handlers.onMoveCheckpoint(checkpoint.id, -1) });
  }
  if (index < checkpoints.length - 1) {
    menuActions.push({ label: 'Move right', onClick: () => handlers.onMoveCheckpoint(checkpoint.id, 1) });
  }
  menuActions.push({
    label: 'Delete checkpoint',
    danger: true,
    onClick: () => handlers.onDeleteCheckpoint(checkpoint.id, checkpoint.title),
  });
  topRow.appendChild(createOverflowMenu({ actions: menuActions, ariaLabel: `${checkpoint.title} actions` }));
  card.appendChild(topRow);

  // .unit-title is an additive, uniquely-named modifier (never applied
  // by ui/views/GoalDashboardView.js, which reuses only the base
  // .column-title class for its own, differently-shaped header) that
  // clamps the title to a fixed-height, 2-line region so every unit
  // card in a row shares identical geometry regardless of title
  // length, without altering GoalDashboardView's own title rendering.
  const titleEl = document.createElement('span');
  titleEl.className = 'notebook-checkpoints__column-title notebook-checkpoints__unit-title';
  titleEl.textContent = checkpoint.title;
  card.appendChild(titleEl);

  const metaLine = document.createElement('span');
  metaLine.className = 'notebook-checkpoints__column-meta';
  metaLine.textContent = checkpoint.dueDate ? `Due ${formatDate(checkpoint.dueDate)}` : `Given ${formatDate(checkpoint.givenDate)}`;
  card.appendChild(metaLine);

  card.appendChild(buildColumnStats(checkpoint, students));

  return card;
}

/**
 * The student name cell — a plain, non-interactive wrapper (avatar +
 * name) where ONLY the name itself is the clickable element, wired to
 * this view's own onSelectStudent prop, which is the exact same
 * `router.navigate(\`/classroom/${classroom.id}/student/${studentId}\`)`
 * mechanism every other roster screen already uses (see
 * ui/views/GoalDashboardView.js's own handlers.onSelectStudent) — not
 * a new route or navigation path. Per explicit design direction, the
 * avatar is decorative only and must NOT be part of the click target
 * (the whole row is deliberately not one big button) — it mirrors
 * this app's own existing "single-letter fallback avatar" convention
 * (see ui/components/UserBar.js's own .user-bar__avatar--fallback)
 * rather than inventing a new avatar system. No visible instructional
 * hint text — the name's own interactive styling is the only
 * affordance.
 */
/**
 * The student row's own info column (Student Row Redesign) —
 * `checkpoints`/`classroom` are needed for this one student's own
 * progress summary and earned-badge lookup; `checkpoints` is `[]`
 * before this Notebook has any (renderEmptyCheckpointsGrid()'s own
 * placeholder grid), which correctly suppresses the progress
 * summary/bar below rather than showing a fabricated "0/0".
 *
 * Hierarchy, top to bottom (explicit design direction): name + points,
 * then compact badge chips, then the completed/pending summary, then
 * the progress bar — each visually smaller/quieter than the one above
 * it, so the unit matrix to the right stays the primary focus.
 */
export function populateStudentNameCell(nameCell, student, handlers, checkpoints, classroom) {
  nameCell.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'notebook-checkpoints__student-info';

  const topRow = document.createElement('span');
  topRow.className = 'notebook-checkpoints__student';

  const avatar = document.createElement('span');
  avatar.className = 'notebook-checkpoints__student-avatar';
  avatar.textContent = (student.name || '?').charAt(0).toUpperCase();
  avatar.setAttribute('aria-hidden', 'true');

  // Only the name itself is the click target — per existing, preserved
  // design direction (see this function's own prior header comment):
  // the avatar/points are decorative, never part of onSelectStudent's
  // own click target. Deliberately no text-decoration at all, including
  // on hover (see css/styles.css's own .notebook-checkpoints__student-name
  // rule) — color + cursor remain the only interactive affordance.
  const nameButton = document.createElement('button');
  nameButton.type = 'button';
  nameButton.className = 'notebook-checkpoints__student-name';
  nameButton.textContent = student.name;
  nameButton.setAttribute('aria-label', `View ${student.name}'s profile`);
  nameButton.addEventListener('click', () => handlers.onSelectStudent(student.id));

  topRow.append(avatar, nameButton);

  const scoreDisplay = getScoreDisplay(student);
  const scoreEl = document.createElement('span');
  scoreEl.className = 'notebook-checkpoints__student-score';
  scoreEl.setAttribute('aria-label', scoreDisplay.ariaLabel);
  const scoreIcon = document.createElement('span');
  scoreIcon.setAttribute('aria-hidden', 'true');
  scoreIcon.textContent = scoreDisplay.icon;
  const scoreNumber = document.createElement('span');
  scoreNumber.setAttribute('aria-hidden', 'true');
  scoreNumber.textContent = `${scoreDisplay.number} ${scoreDisplay.suffix}`;
  scoreEl.append(scoreIcon, scoreNumber);
  topRow.appendChild(scoreEl);

  container.appendChild(topRow);

  // Compact achievement badges — omitted entirely (not an empty row)
  // when this student has earned none, per explicit product decision:
  // a student's row must never display a badge they have not earned.
  //
  // Readiness Champion's own count is corrected here to read the real,
  // live notebook-level ledger (notebookReadinessChampionService.js's
  // own countActiveReadinessChampionNotebooksForStudent()) instead of
  // notebookBadgeService.listEarnedBadges()'s own legacy
  // student.notebookBadgeCounts lookup for this one badge type —
  // found during the 2026-11-07 production display-discrepancy
  // investigation: that legacy counter is disconnected from this
  // file's own cell-editor Readiness display just below (which already
  // reads the correct ledger via getActiveReadinessSourcesForNotebook()),
  // so the two could silently disagree on the same screen. Every OTHER
  // badge type's own count is untouched, still exactly
  // notebookBadgeService.listEarnedBadges()'s own legacy-counter read —
  // this correction is scoped to Readiness Champion alone.
  const earnedBadges = notebookBadgeService
    .listBadgeTypes(classroom)
    .map((type) =>
      type.id === notebookBadgeAwardService.READINESS_CHAMPION_BADGE_ID
        ? { ...type, count: notebookReadinessChampionService.countActiveReadinessChampionNotebooksForStudent(student) }
        : { ...type, count: notebookBadgeService.getBadgeCount(student, type.id) }
    )
    .filter((type) => type.count > 0);
  if (earnedBadges.length > 0) {
    const badgesRow = document.createElement('div');
    badgesRow.className = 'notebook-checkpoints__student-badges';
    earnedBadges.forEach((badge) => badgesRow.appendChild(buildBadgeChip(badge)));
    container.appendChild(badgesRow);
  }

  // Status summary + progress bar — this Notebook's own checkpoints
  // only (see getProgressSummary()'s own header comment in
  // NotebookStudentRowDisplay.js), omitted until at least one exists.
  if (checkpoints.length > 0) {
    const summary = getProgressSummary(checkpoints, student.id);

    const summaryEl = document.createElement('p');
    summaryEl.className = 'notebook-checkpoints__student-progress-summary';
    const statusText = document.createElement('span');
    statusText.textContent = `Status: ${summary.completedCount}/${summary.totalCount}`;
    const separator = document.createElement('span');
    separator.setAttribute('aria-hidden', 'true');
    separator.textContent = ' | ';
    const pendingText = document.createElement('span');
    pendingText.className = 'notebook-checkpoints__student-progress-pending';
    pendingText.textContent = `${summary.pendingCount} pending`;
    summaryEl.append(statusText, separator, pendingText);
    container.appendChild(summaryEl);

    const progressBar = document.createElement('div');
    progressBar.className = 'notebook-checkpoints__student-progress-bar';
    progressBar.setAttribute('role', 'progressbar');
    progressBar.setAttribute('aria-valuenow', String(summary.percentComplete));
    progressBar.setAttribute('aria-valuemin', '0');
    progressBar.setAttribute('aria-valuemax', '100');
    progressBar.setAttribute('aria-label', `${student.name}: ${summary.completedCount} of ${summary.totalCount} complete`);
    const progressFill = document.createElement('div');
    progressFill.className = 'notebook-checkpoints__student-progress-bar-fill';
    progressFill.style.width = `${summary.percentComplete}%`;
    progressBar.appendChild(progressFill);
    container.appendChild(progressBar);
  }

  nameCell.appendChild(container);
}

/**
 * One compact shield/emblem badge chip — reuses
 * ui/components/Badge.js's own createBadge() for the shield/icon/theme
 * rendering (never a second badge-drawing implementation), at its
 * smallest documented tier (config/badgeDefinitions.js's own
 * BADGE_SIZES.small — "a tiny supporting indicator only") and with its
 * built-in "LV N" label suppressed (showLevel: false) so this chip's
 * own bare count can sit directly beside the icon instead, matching
 * the "4", not "LV 4", visual requirement exactly.
 *
 * createBadge() already sets the emblem's own `title` to the badge's
 * full name (a native hover tooltip); this button is also focusable
 * and clickable, so a tap on a touch device (no hover state) reveals
 * the same full name via a small, auto-dismissing inline label —
 * satisfying "a tooltip OR click interaction" either way, without a
 * new overlay/popover component.
 */
function buildBadgeChip(badge) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'notebook-checkpoints__badge-chip';
  chip.title = badge.name;
  chip.setAttribute('aria-label', `${badge.name}: earned ${badge.count} time${badge.count === 1 ? '' : 's'}`);

  const emblem = createBadge({
    definition: { title: badge.name, icon: badge.icon, theme: badge.theme },
    level: badge.count,
    size: 24,
    showLevel: false,
  });
  chip.appendChild(emblem);

  const count = document.createElement('span');
  count.className = 'notebook-checkpoints__badge-chip-count';
  count.setAttribute('aria-hidden', 'true');
  count.textContent = String(badge.count);
  chip.appendChild(count);

  let dismissTimer = null;
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    chip.querySelector('.notebook-checkpoints__badge-chip-label')?.remove();
    const nameLabel = document.createElement('span');
    nameLabel.className = 'notebook-checkpoints__badge-chip-label';
    nameLabel.textContent = badge.name;
    chip.appendChild(nameLabel);
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => nameLabel.remove(), 2000);
  });

  return chip;
}

/**
 * Builds one checkpoint cell's own contents (status row + whichever
 * quick actions apply) directly into `cell` — extracted from
 * renderGrid()'s own per-cell loop so updateCellAndColumn() (see
 * renderNotebookCheckpointsView() above) can rebuild exactly one cell
 * in place, identically to how a full grid build renders it. `cell`
 * itself (the <td>, including its own data-checkpoint-id/
 * data-student-id attributes) is owned by the caller — this only
 * ever populates its children.
 *
 * Per explicit design direction, the cell's own background stays a
 * very light, secondary tint (Not Submitted → light red, Submitted ·
 * Complete on time → light green; every other status stays neutral
 * white) — the circular icon badge remains the primary status
 * signal. These two tint classes are new and exclusive to this
 * view's own cells (never the shared .cell--red/--green base classes
 * ui/views/GoalDashboardView.js itself reuses), so that other
 * screen's look is entirely unaffected.
 *
 * DOM is three stacked zones inside one .cell-content wrapper (icon+
 * label are one clickable control, since opening the full editor is
 * still triggered from tapping either of them; the action zone is
 * always rendered, even empty, so its presence/absence never shifts
 * the icon's or label's own vertical position — every cell in a row
 * stays aligned regardless of which cells have a "Mark Submitted" /
 * quick-review control beneath them):
 *   .cell-content
 *     .cell-row (button — icon-zone + label-zone; opens the full editor)
 *     .cell-action-zone (Mark Submitted / quick-review, or empty)
 */
export function populateCheckpointCell(cell, checkpoint, student, handlers) {
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);
  const meta = getCellMeta(checkpoint, record);
  const isNotSubmitted = !record || record.submissionStatus === 'not_submitted';
  const isAwaitingReview = record && record.submissionStatus === 'submitted' && record.reviewStatus === 'not_reviewed';
  // Checked directly against the record rather than `meta.chipClass`
  // — getCellMeta() now returns the same 'green' chipClass for BOTH
  // on-time and late Complete (Complete is always green; `late` only
  // ever changes the label), so chipClass alone can no longer tell
  // this cell's own on-time-only tint (see this function's own header
  // comment: "Submitted · Complete on time → light green") apart from
  // a late Complete.
  const isCompleteOnTime = record && record.reviewStatus === 'complete' && !checkpointService.isLate(checkpoint, record);

  cell.className = 'notebook-checkpoints__cell';
  if (isNotSubmitted) cell.classList.add('notebook-checkpoints__cell--tint-red');
  if (isCompleteOnTime) cell.classList.add('notebook-checkpoints__cell--tint-green');

  const content = document.createElement('div');
  content.className = 'notebook-checkpoints__cell-content';

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'notebook-checkpoints__cell-row';
  row.setAttribute('aria-label', `${student.name} — ${checkpoint.title}: ${meta.label}`);
  row.addEventListener('click', () => handlers.onOpenCell(checkpoint.id, student.id));

  // getCellMeta()'s own icon names ('x-circle', 'check-circle-2') carry
  // their OWN outline circle — composed correctly for a plain inline
  // chip, but wrong here: layered inside this badge's own solid-color
  // circle, that inner outline rendered as a second, visually
  // competing ring (a "circle inside a circle"). Swapping to the
  // equivalent glyph-only icon (no circle of its own) for this badge's
  // rendering ONLY — never changing what getCellMeta() itself returns,
  // since ui/student-portal/views/StudentNotebooksView.js imports and
  // renders that exact same meta.icon value independently — fixes the
  // composition at its source rather than papering over it with more
  // CSS layered on top.
  const badgeIconName = meta.icon === 'x-circle' ? 'x' : meta.icon === 'check-circle-2' ? 'check' : meta.icon;

  const statusIcon = document.createElement('span');
  statusIcon.className = `notebook-checkpoints__status-icon notebook-checkpoints__status-icon--${meta.chipClass}`;
  statusIcon.appendChild(createIcon(badgeIconName, { size: 16, strokeWidth: 2.5 }));
  row.appendChild(statusIcon);

  const labelEl = document.createElement('span');
  labelEl.className = 'notebook-checkpoints__cell-label';
  labelEl.textContent = meta.label;
  row.appendChild(labelEl);

  content.appendChild(row);

  // Always rendered, even when empty, so the action zone's own
  // presence/height never moves the icon or label above it — see
  // this function's own header comment.
  const actionZone = document.createElement('div');
  actionZone.className = 'notebook-checkpoints__cell-action-zone';

  // "Mark Submitted" quick action, per explicit product direction: a
  // "Not Submitted" cell's own common-case action is a separate,
  // explicit control below the row (not merged into the row's own
  // tap, which always opens the full editor uniformly). Defaults
  // the submission date to today; a teacher needing a different
  // (historical) date uses the row above to open the full editor.
  if (isNotSubmitted) {
    const quickMarkButton = document.createElement('button');
    quickMarkButton.type = 'button';
    quickMarkButton.className = 'notebook-checkpoints__cell-quick-mark';
    quickMarkButton.appendChild(createIcon('check', { size: 12 }));
    quickMarkButton.append('Mark Submitted');
    quickMarkButton.setAttribute('aria-label', `${student.name} — ${checkpoint.title}: mark submitted`);
    quickMarkButton.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onQuickMarkSubmitted(checkpoint.id, student.id);
    });
    actionZone.appendChild(quickMarkButton);
  }

  // Quick review actions, only once submitted but not yet
  // reviewed — the exact friction point identified by inspection:
  // reviewing previously always required opening the full editor,
  // even for the common one-tap decision. Mirrors the same
  // one-tap-then-persist pattern as Mark Submitted above. The
  // full editor (opened via the main cell button) remains the
  // only path for a review date correction or a note, unchanged.
  if (isAwaitingReview) {
    const quickActions = document.createElement('div');
    quickActions.className = 'notebook-checkpoints__cell-quick-review';

    const quickCompleteButton = document.createElement('button');
    quickCompleteButton.type = 'button';
    quickCompleteButton.className = 'notebook-checkpoints__cell-quick-review-button notebook-checkpoints__cell-quick-review-button--complete';
    quickCompleteButton.appendChild(createIcon('check', { size: 12 }));
    quickCompleteButton.append('Complete');
    quickCompleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onQuickReview(checkpoint.id, student.id, 'complete');
    });

    const quickIncompleteButton = document.createElement('button');
    quickIncompleteButton.type = 'button';
    quickIncompleteButton.className = 'notebook-checkpoints__cell-quick-review-button notebook-checkpoints__cell-quick-review-button--incomplete';
    quickIncompleteButton.appendChild(createIcon('alert-triangle', { size: 12 }));
    quickIncompleteButton.append('Incomplete');
    quickIncompleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onQuickReview(checkpoint.id, student.id, 'incomplete');
    });

    quickActions.append(quickCompleteButton, quickIncompleteButton);
    actionZone.appendChild(quickActions);
  }

  content.appendChild(actionZone);
  cell.appendChild(content);
}

function renderGrid(checkpoints, students, handlers, classroom) {
  const scroll = document.createElement('div');
  scroll.className = 'assessment-gradebook__scroll';

  const table = document.createElement('table');
  table.className = 'assessment-gradebook notebook-checkpoints__table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  headerRow.appendChild(buildStudentColumnHeader('Student', handlers));

  checkpoints.forEach((checkpoint, index) => {
    const th = document.createElement('th');
    th.className = 'notebook-checkpoints__column-header';
    // Lookup key for updateCellAndColumn()'s targeted stat-box update
    // (see renderNotebookCheckpointsView() above) — never read for
    // anything else.
    th.dataset.checkpointId = checkpoint.id;
    th.appendChild(buildUnitCard(checkpoint, index, checkpoints, students, handlers));
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    // Lookup key for updateCellAndColumn()'s own targeted progress-
    // summary refresh (see renderNotebookCheckpointsView() above) —
    // never read for anything else.
    nameCell.dataset.studentId = student.id;
    populateStudentNameCell(nameCell, student, handlers, checkpoints, classroom);
    row.appendChild(nameCell);

    checkpoints.forEach((checkpoint) => {
      const cell = document.createElement('td');
      // Lookup keys for updateCellAndColumn()'s targeted single-cell
      // update (see renderNotebookCheckpointsView() above) — never
      // read for anything else.
      cell.dataset.checkpointId = checkpoint.id;
      cell.dataset.studentId = student.id;
      populateCheckpointCell(cell, checkpoint, student, handlers);
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  scroll.appendChild(table);
  return scroll;
}

function renderCheckpointForm(checkpoint, handlers) {
  const form = document.createElement('div');
  form.className = 'notebook-checkpoints__form';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Title (e.g. Question Paper)';
  titleInput.value = checkpoint?.title || '';
  form.appendChild(titleInput);

  const descriptionInput = document.createElement('textarea');
  descriptionInput.placeholder = 'Description (optional)';
  descriptionInput.value = checkpoint?.description || '';
  form.appendChild(descriptionInput);

  const givenDateLabel = document.createElement('label');
  givenDateLabel.textContent = 'Date given';
  const givenDateInput = document.createElement('input');
  givenDateInput.type = 'date';
  givenDateInput.value = checkpoint?.givenDate || getTodayDateKey();
  givenDateLabel.appendChild(givenDateInput);
  form.appendChild(givenDateLabel);

  const dueDateLabel = document.createElement('label');
  dueDateLabel.textContent = 'Due date (optional)';
  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.value = checkpoint?.dueDate || '';
  dueDateLabel.appendChild(dueDateInput);
  form.appendChild(dueDateLabel);

  const actions = document.createElement('div');
  actions.className = 'notebook-checkpoints__form-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) return;
    handlers.onSaveCheckpoint({
      title,
      description: descriptionInput.value.trim(),
      givenDate: givenDateInput.value,
      dueDate: dueDateInput.value,
    });
  });
  actions.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelEdit);
  actions.appendChild(cancelButton);

  form.appendChild(actions);
  return form;
}

export function renderCellEditor(checkpoint, student, handlers) {
  const record = checkpointService.getRecordForStudent(checkpoint, student.id);

  const overlay = document.createElement('div');
  overlay.className = 'notebook-checkpoints__cell-editor-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'notebook-checkpoints__cell-editor';

  const heading = document.createElement('p');
  heading.className = 'notebook-checkpoints__cell-editor-heading';
  heading.textContent = checkpoint.title;
  const subheading = document.createElement('p');
  subheading.className = 'notebook-checkpoints__cell-editor-subheading';
  subheading.textContent = `Student: ${student.name}`;
  sheet.append(heading, subheading);

  // --- Submission ---
  const submissionLabel = document.createElement('p');
  submissionLabel.className = 'notebook-checkpoints__cell-editor-section-label';
  submissionLabel.textContent = 'Submission';
  sheet.appendChild(submissionLabel);

  const submissionSelect = document.createElement('select');
  [['not_submitted', 'Not submitted'], ['submitted', 'Submitted']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if ((record?.submissionStatus || 'not_submitted') === value) option.selected = true;
    submissionSelect.appendChild(option);
  });
  sheet.appendChild(submissionSelect);

  const submittedDateInput = document.createElement('input');
  submittedDateInput.type = 'date';
  submittedDateInput.value = record?.submittedDate || getTodayDateKey();
  sheet.appendChild(submittedDateInput);

  const lateNotice = document.createElement('p');
  lateNotice.className = 'notebook-checkpoints__cell-editor-late-notice';
  sheet.appendChild(lateNotice);

  function refreshLateNotice() {
    const wouldBeLate = checkpoint.dueDate && submissionSelect.value === 'submitted' && submittedDateInput.value > checkpoint.dueDate;
    lateNotice.textContent = wouldBeLate ? `⚠️ Submitted late (due ${formatDate(checkpoint.dueDate)})` : '';
  }
  refreshLateNotice();
  submittedDateInput.addEventListener('input', refreshLateNotice);
  submissionSelect.addEventListener('change', refreshLateNotice);

  // --- Review ---
  const reviewLabel = document.createElement('p');
  reviewLabel.className = 'notebook-checkpoints__cell-editor-section-label';
  reviewLabel.textContent = 'Review';
  sheet.appendChild(reviewLabel);

  const reviewSelect = document.createElement('select');
  [['not_reviewed', 'Not reviewed'], ['complete', 'Complete'], ['incomplete', 'Incomplete']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if ((record?.reviewStatus || 'not_reviewed') === value) option.selected = true;
    reviewSelect.appendChild(option);
  });
  sheet.appendChild(reviewSelect);

  const reviewedDateInput = document.createElement('input');
  reviewedDateInput.type = 'date';
  reviewedDateInput.value = record?.reviewedDate || getTodayDateKey();
  sheet.appendChild(reviewedDateInput);

  // A review outcome is only meaningful once something has been
  // submitted -- matching checkpointService.setReview()'s own
  // enforced rule exactly, surfaced here so a teacher sees why the
  // control is disabled rather than discovering it only after Save
  // throws.
  function refreshReviewEnablement() {
    const canReview = submissionSelect.value === 'submitted';
    reviewSelect.disabled = !canReview;
    reviewedDateInput.disabled = !canReview;
    if (!canReview) reviewSelect.value = 'not_reviewed';
  }
  refreshReviewEnablement();
  submissionSelect.addEventListener('change', refreshReviewEnablement);

  // --- Teacher note ---
  const noteLabel = document.createElement('p');
  noteLabel.className = 'notebook-checkpoints__cell-editor-section-label';
  noteLabel.textContent = 'Teacher note';
  sheet.appendChild(noteLabel);
  const noteInput = document.createElement('textarea');
  noteInput.value = record?.teacherNote || '';
  sheet.appendChild(noteInput);

  // --- Readiness Champion (override/revoke) ---
  // Organization/Punctuation Champion are never shown here — this
  // editor's own review dropdown above is still an UNSAVED, pending
  // value, and those two badges are only ever offered once a review is
  // genuinely, persistently marked Complete (see
  // openReviewCompletionBadgePrompt() above, triggered right after a
  // real Save). Readiness Champion is different, and — per the
  // notebook-level redesign — is no longer about THIS checkpoint's own
  // record at all: it reflects the ENTIRE subject notebook's own
  // Readiness Champion state (every checkpoint currently configured
  // under this same subjectId/notebookTypeId), read from the student's
  // own append-only history via notebookReadinessChampionService.js,
  // never from this one record's (now-unused-for-this-purpose)
  // `badgeAwards`. Revoking or overriding from here affects the whole
  // notebook — identical to doing so from any other checkpoint's own
  // cell editor within it.
  const readinessLabel = document.createElement('p');
  readinessLabel.className = 'notebook-checkpoints__cell-editor-section-label';
  readinessLabel.textContent = 'Readiness Champion (whole notebook)';
  sheet.appendChild(readinessLabel);

  const readinessWorkItemRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({
    subjectId: checkpoint.subjectId,
    notebookTypeId: checkpoint.notebookTypeId,
  });
  const activeReadinessSources = notebookReadinessChampionService.getActiveReadinessSourcesForNotebook(student, readinessWorkItemRef);
  const isReadinessActive = activeReadinessSources.length > 0;

  const readinessStatus = document.createElement('p');
  readinessStatus.textContent = isReadinessActive
    ? `Awarded (${
        activeReadinessSources.includes('automatic')
          ? 'automatic — notebook complete and on time'
          : activeReadinessSources.includes('override')
            ? 'teacher override'
            : 'retroactive backfill'
      })`
    : 'Not awarded';
  sheet.appendChild(readinessStatus);

  const readinessActions = document.createElement('div');
  readinessActions.className = 'notebook-checkpoints__cell-editor-actions';
  if (isReadinessActive) {
    const revokeButton = document.createElement('button');
    revokeButton.type = 'button';
    revokeButton.className = 'btn btn--text';
    revokeButton.textContent = 'Revoke';
    revokeButton.addEventListener('click', () => handlers.onRevokeReadiness(checkpoint.id, student.id));
    readinessActions.appendChild(revokeButton);
  } else {
    const overrideButton = document.createElement('button');
    overrideButton.type = 'button';
    overrideButton.className = 'btn btn--text';
    overrideButton.textContent = 'Award anyway (override)';
    overrideButton.addEventListener('click', () => handlers.onOverrideReadiness(checkpoint.id, student.id));
    readinessActions.appendChild(overrideButton);
  }
  sheet.appendChild(readinessActions);

  // --- Completion Star (WORK-0038: remove only — awarding/reversal is
  // entirely automatic, tied to the review transition above; there is
  // no "award anyway" override for this one, unlike Readiness
  // Champion, since eligibility here has no date rule to override). A
  // genuinely separate mechanism from Readiness Champion throughout —
  // different service (recognitionService.js, never
  // notebookBadgeAwardService.js), different ledger (points/history,
  // never badgeAwards), different work-item identity, never conflated.
  const completionStarLabel = document.createElement('p');
  completionStarLabel.className = 'notebook-checkpoints__cell-editor-section-label';
  completionStarLabel.textContent = 'Completion Star';
  sheet.appendChild(completionStarLabel);

  const completionStarWorkItemRef = recognitionService.buildNotebookCheckpointWorkItemRef({
    subjectId: checkpoint.subjectId,
    notebookTypeId: checkpoint.notebookTypeId,
    checkpointId: checkpoint.id,
  });
  const completionStarActive = recognitionService.getAutomaticStarNetForWorkItem(student, completionStarWorkItemRef) >= 1;

  const completionStarStatus = document.createElement('p');
  completionStarStatus.textContent = completionStarActive ? 'Awarded' : 'Not awarded';
  sheet.appendChild(completionStarStatus);

  if (completionStarActive) {
    const completionStarActions = document.createElement('div');
    completionStarActions.className = 'notebook-checkpoints__cell-editor-actions';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => handlers.onRemoveCompletionStar(checkpoint.id, student.id));
    completionStarActions.appendChild(removeButton);
    sheet.appendChild(completionStarActions);
  }

  // --- Actions ---
  const actions = document.createElement('div');
  actions.className = 'notebook-checkpoints__cell-editor-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    handlers.onSaveCell(
      checkpoint.id,
      student.id,
      { status: submissionSelect.value, submittedDate: submissionSelect.value === 'submitted' ? submittedDateInput.value : null },
      { status: reviewSelect.value, reviewedDate: reviewSelect.value === 'not_reviewed' ? null : reviewedDateInput.value },
      noteInput.value.trim()
    );
  });
  actions.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCloseCell);
  actions.appendChild(cancelButton);

  sheet.appendChild(actions);
  overlay.appendChild(sheet);
  return overlay;
}
