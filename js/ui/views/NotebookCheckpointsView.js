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
 */

import * as checkpointService from '../../services/checkpointService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { getClassroomStudents } from '../../services/assessmentService.js';
import { formatDate, getTodayDateKey } from '../../utils/dateHelpers.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

/**
 * Cell status metadata — deliberately mirrors
 * WorkRequestRosterView.js's own STATUS_META shape (label + chipClass
 * + icon), so a teacher sees the same visual language across both
 * screens, without importing that file's own WorkRequest-specific
 * status set (which has no equivalent to "submitted late" at all,
 * and includes several statuses — needs_correction, resubmitted,
 * absent — that don't exist in this simpler, two-dimensional model).
 */
/** Exported so other views (e.g. ui/student-portal/views/StudentNotebooksView.js's own Checkpoints section) render the exact same status language and colors as this grid, rather than duplicating the lookup into a second status model. */
export function getCellMeta(checkpoint, record) {
  if (!record || record.submissionStatus === 'not_submitted') {
    return { label: 'Not submitted', chipClass: 'gray', icon: '\u26aa' };
  }
  const late = checkpointService.isLate(checkpoint, record);
  if (record.reviewStatus === 'complete') {
    return late
      ? { label: 'Submitted late \u00b7 Complete', chipClass: 'orange', icon: '\ud83d\udfe0' }
      : { label: 'Submitted \u00b7 Complete', chipClass: 'green', icon: '\ud83d\udfe2' };
  }
  if (record.reviewStatus === 'incomplete') {
    return late
      ? { label: 'Submitted late \u00b7 Incomplete', chipClass: 'red', icon: '\ud83d\udd34' }
      : { label: 'Submitted \u00b7 Incomplete', chipClass: 'red', icon: '\ud83d\udd34' };
  }
  return late
    ? { label: 'Submitted late \u00b7 Not reviewed', chipClass: 'amber', icon: '\ud83d\udfe1' }
    : { label: 'Submitted \u00b7 Not reviewed', chipClass: 'purple', icon: '\ud83d\udcc4' };
}

/** Whether one specific cell matches the currently-active attention filter — used by renderGrid() to highlight/dim cells. Mirrors getNeedsAttentionForNotebook()'s own per-item classification exactly, so a filter clicked from the attention section highlights precisely the cells that contributed to it. */
function cellMatchesAttentionFilter(checkpoint, student, record, filter) {
  if (filter.studentId && filter.studentId !== student.id) return false;
  if (filter.checkpointId && filter.checkpointId !== checkpoint.id) return false;
  if (!filter.kind) return true;

  const isNotSubmitted = !record || record.submissionStatus === 'not_submitted';
  if (filter.kind === 'not_submitted') return isNotSubmitted;
  if (isNotSubmitted) return false;

  const late = checkpointService.isLate(checkpoint, record);
  if (filter.kind === 'needs_review') return record.reviewStatus === 'not_reviewed';
  if (filter.kind === 'incomplete') return record.reviewStatus === 'incomplete';
  if (filter.kind === 'late') return late;
  return false;
}

/**
 * One compact line per checkpoint, always derived fresh from real
 * records, never persisted — exactly the spec's own example format.
 * `roster` is required here (unlike getCheckpointSummary()'s own
 * backward-compatible default) since notSubmittedCount genuinely
 * needs it.
 */
function renderCheckpointSummaries(checkpoints, roster) {
  const section = document.createElement('div');
  section.className = 'notebook-checkpoints__summaries';

  checkpoints.forEach((checkpoint) => {
    const summary = checkpointService.getCheckpointSummary(checkpoint, roster);
    const line = document.createElement('p');
    line.className = 'notebook-checkpoints__summary-line';
    const titleEl = document.createElement('strong');
    titleEl.textContent = checkpoint.title;
    const countsEl = document.createElement('span');
    countsEl.textContent = ` \u2014 ${summary.submittedCount} submitted \u00b7 ${summary.completeCount} complete \u00b7 ${summary.incompleteCount} incomplete \u00b7 ${summary.notSubmittedCount} not submitted \u00b7 ${summary.lateCount} late`;
    line.append(titleEl, countsEl);
    section.appendChild(line);
  });

  return section;
}

/**
 * The class-level "Needs Attention" section — each count is a real
 * button, clicking it sets/toggles the grid's own highlight filter
 * (see cellMatchesAttentionFilter()/renderGrid() above), never
 * opening a separate page or a second data-management surface, per
 * explicit product decision. Below the top-level counts, one
 * compact row per student who has at least one outstanding item —
 * deliberately one row per student, not one row per item, so a
 * student with three separate issues appears once, not three times.
 */
function renderNeedsAttentionSection(needsAttention, activeAttentionFilter, handlers) {
  const section = document.createElement('div');
  section.className = 'notebook-checkpoints__attention';

  const heading = document.createElement('p');
  heading.className = 'notebook-checkpoints__attention-heading';
  heading.textContent = 'NEEDS ATTENTION';
  section.appendChild(heading);

  const { counts } = needsAttention;
  const countsList = document.createElement('div');
  countsList.className = 'notebook-checkpoints__attention-counts';

  function isActive(kind) {
    return activeAttentionFilter?.kind === kind && !activeAttentionFilter.studentId && !activeAttentionFilter.checkpointId;
  }

  function addCountButton(kind, icon, count, noun) {
    if (count === 0) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'notebook-checkpoints__attention-count-button';
    if (isActive(kind)) button.classList.add('notebook-checkpoints__attention-count-button--active');
    button.textContent = `${icon} ${count} ${noun}`;
    button.addEventListener('click', () => handlers.onSetAttentionFilter({ kind }));
    countsList.appendChild(button);
  }

  addCountButton('not_submitted', '\ud83d\udd34', counts.notSubmittedStudentCount, `student${counts.notSubmittedStudentCount === 1 ? '' : 's'} haven\u2019t submitted`);
  addCountButton('needs_review', '\ud83d\udfe0', counts.needsReviewCount, `submission${counts.needsReviewCount === 1 ? '' : 's'} need${counts.needsReviewCount === 1 ? 's' : ''} review`);
  addCountButton('incomplete', '\ud83d\udd34', counts.incompleteCount, `submission${counts.incompleteCount === 1 ? '' : 's'} incomplete`);
  addCountButton('late', '\ud83d\udfe1', counts.lateCount, `submission${counts.lateCount === 1 ? '' : 's'} late`);

  section.appendChild(countsList);

  const studentList = document.createElement('div');
  studentList.className = 'notebook-checkpoints__attention-students';

  const ITEM_LABELS = {
    not_submitted: 'Not submitted',
    needs_review: 'Needs review',
    incomplete: 'Incomplete',
    late: 'Late',
  };

  needsAttention.perStudent.forEach(({ student, items }) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'notebook-checkpoints__attention-student-row';
    if (activeAttentionFilter?.studentId === student.id) row.classList.add('notebook-checkpoints__attention-student-row--active');

    const nameEl = document.createElement('span');
    nameEl.className = 'notebook-checkpoints__attention-student-name';
    nameEl.textContent = student.name;
    row.appendChild(nameEl);

    const itemsEl = document.createElement('span');
    itemsEl.className = 'notebook-checkpoints__attention-student-items';
    itemsEl.textContent = items
      .map((item) => `${item.checkpointTitle} \u2014 ${ITEM_LABELS[item.kind]}${item.late && item.kind !== 'late' ? ' (late)' : ''}`)
      .join('; ');
    row.appendChild(itemsEl);

    row.addEventListener('click', () => handlers.onSetAttentionFilter({ studentId: student.id }));
    studentList.appendChild(row);
  });

  section.appendChild(studentList);
  return section;
}

export function renderNotebookCheckpointsView(container, { classroom, subjectId, notebookTypeId, onBack }) {
  let editingCheckpointId = null; // null | 'new' | an existing checkpoint's own id — the header create/edit form
  let openCellFor = null; // null | { checkpointId, studentId } — the one open cell editor at a time
  let activeAttentionFilter = null; // null | { studentId?, checkpointId?, kind? } — highlights matching cells in the grid; never hides rows, per explicit "grid remains the source of interaction" instruction

  function rerender() {
    render(container, classroom, subjectId, notebookTypeId, editingCheckpointId, openCellFor, activeAttentionFilter, {
      onBack,
      onStartCreate: () => {
        editingCheckpointId = 'new';
        rerender();
      },
      onStartEdit: (checkpointId) => {
        editingCheckpointId = checkpointId;
        rerender();
      },
      onCancelEdit: () => {
        editingCheckpointId = null;
        rerender();
      },
      onSaveCheckpoint: (fields) => {
        if (editingCheckpointId === 'new') {
          checkpointService.createNewCheckpoint(classroom, { subjectId, notebookTypeId, ...fields });
        } else {
          const checkpoint = checkpointService.getCheckpointById(classroom, editingCheckpointId);
          checkpointService.updateCheckpoint(checkpoint, fields);
        }
        editingCheckpointId = null;
        persistAndRerender();
      },
      onDeleteCheckpoint: (checkpointId, title) => {
        const confirmed = window.confirm(`Delete "${title}"? This removes every student's own record for it too. This cannot be undone.`);
        if (!confirmed) return;
        checkpointService.deleteCheckpoint(classroom, checkpointId);
        persistAndRerender();
      },
      onMoveCheckpoint: (checkpointId, direction) => {
        const ordered = checkpointService.listCheckpointsForNotebook(classroom, subjectId, notebookTypeId);
        const index = ordered.findIndex((c) => c.id === checkpointId);
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= ordered.length) return;
        const reordered = [...ordered];
        [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
        checkpointService.reorderCheckpoints(classroom, subjectId, notebookTypeId, reordered.map((c) => c.id));
        persistAndRerender();
      },
      onOpenCell: (checkpointId, studentId) => {
        openCellFor = { checkpointId, studentId };
        rerender();
      },
      onQuickMarkSubmitted: (checkpointId, studentId) => {
        const checkpoint = checkpointService.getCheckpointById(classroom, checkpointId);
        checkpointService.setSubmission(checkpoint, studentId, { status: 'submitted', submittedDate: getTodayDateKey() });
        persistAndRerender();
      },
      onQuickReview: (checkpointId, studentId, status) => {
        const checkpoint = checkpointService.getCheckpointById(classroom, checkpointId);
        checkpointService.setReview(checkpoint, studentId, { status, reviewedDate: getTodayDateKey() });
        persistAndRerender();
      },
      onSetAttentionFilter: (filter) => {
        const isSameFilter = activeAttentionFilter && JSON.stringify(activeAttentionFilter) === JSON.stringify(filter);
        activeAttentionFilter = isSameFilter ? null : filter;
        rerender();
      },
      onCloseCell: () => {
        openCellFor = null;
        rerender();
      },
      onSaveCell: (checkpointId, studentId, submission, review, teacherNote) => {
        const checkpoint = checkpointService.getCheckpointById(classroom, checkpointId);
        checkpointService.setSubmission(checkpoint, studentId, submission);
        checkpointService.setReview(checkpoint, studentId, review);
        checkpointService.setTeacherNote(checkpoint, studentId, teacherNote);
        openCellFor = null;
        persistAndRerender();
      },
    });
  }

  async function persistAndRerender() {
    workspaceService.save(classroom);
    rerender();
  }

  rerender();
}

function render(container, classroom, subjectId, notebookTypeId, editingCheckpointId, openCellFor, activeAttentionFilter, handlers) {
  container.innerHTML = '';

  const subject = notebookConfigService.getSubjectById(classroom, subjectId);
  const notebookType = notebookConfigService.getNotebookTypeById(classroom, notebookTypeId);

  const wrapper = document.createElement('div');
  wrapper.className = 'notebook-checkpoints';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(handlers.onBack));
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = `${subject?.name || '(Subject removed)'} \u00b7 ${notebookType?.name || '(Type removed)'} \u2014 Checkpoints`;
  header.appendChild(title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'notebook-checkpoints__content';

  const checkpoints = checkpointService.listCheckpointsForNotebook(classroom, subjectId, notebookTypeId);
  const students = [...getClassroomStudents(classroom)].sort((a, b) => a.name.localeCompare(b.name));

  if (checkpoints.length > 0 && students.length > 0) {
    content.appendChild(renderCheckpointSummaries(checkpoints, students));
    const needsAttention = checkpointService.getNeedsAttentionForNotebook(checkpoints, students);
    if (needsAttention.perStudent.length > 0) {
      content.appendChild(renderNeedsAttentionSection(needsAttention, activeAttentionFilter, handlers));
    }
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary notebook-checkpoints__add-button';
  addButton.textContent = '+ Add Checkpoint';
  addButton.addEventListener('click', handlers.onStartCreate);
  content.appendChild(addButton);

  if (editingCheckpointId) {
    const checkpoint = editingCheckpointId === 'new' ? null : checkpointService.getCheckpointById(classroom, editingCheckpointId);
    content.appendChild(renderCheckpointForm(checkpoint, handlers));
  }

  if (checkpoints.length === 0) {
    content.appendChild(
      createEmptyStateElement({
        message: 'No checkpoints yet. Add a checkpoint to start tracking notebook work.',
      })
    );
  } else if (students.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'No students on this roster yet.' }));
  } else {
    content.appendChild(renderGrid(classroom, checkpoints, students, activeAttentionFilter, handlers));
  }

  if (openCellFor) {
    const checkpoint = checkpointService.getCheckpointById(classroom, openCellFor.checkpointId);
    const student = students.find((s) => s.id === openCellFor.studentId);
    if (checkpoint && student) {
      content.appendChild(renderCellEditor(checkpoint, student, handlers));
    }
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderGrid(classroom, checkpoints, students, activeAttentionFilter, handlers) {
  const scroll = document.createElement('div');
  scroll.className = 'assessment-gradebook__scroll';

  const table = document.createElement('table');
  table.className = 'assessment-gradebook notebook-checkpoints__table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const nameTh = document.createElement('th');
  nameTh.className = 'assessment-gradebook__name-header';
  nameTh.textContent = 'Student';
  headerRow.appendChild(nameTh);

  checkpoints.forEach((checkpoint, index) => {
    const th = document.createElement('th');
    th.className = 'notebook-checkpoints__column-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'notebook-checkpoints__column-title-row';
    const titleEl = document.createElement('span');
    titleEl.className = 'notebook-checkpoints__column-title';
    titleEl.textContent = checkpoint.title;
    titleRow.appendChild(titleEl);

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'notebook-checkpoints__column-action';
    editButton.textContent = '\u270e';
    editButton.title = 'Edit checkpoint';
    editButton.addEventListener('click', () => handlers.onStartEdit(checkpoint.id));
    titleRow.appendChild(editButton);
    th.appendChild(titleRow);

    const metaLine = document.createElement('span');
    metaLine.className = 'notebook-checkpoints__column-meta';
    metaLine.textContent = checkpoint.dueDate ? `Due ${formatDate(checkpoint.dueDate)}` : `Given ${formatDate(checkpoint.givenDate)}`;
    th.appendChild(metaLine);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'notebook-checkpoints__column-actions';

    const moveLeftButton = document.createElement('button');
    moveLeftButton.type = 'button';
    moveLeftButton.className = 'notebook-checkpoints__column-action';
    moveLeftButton.textContent = '\u2190';
    moveLeftButton.title = 'Move left';
    moveLeftButton.disabled = index === 0;
    moveLeftButton.addEventListener('click', () => handlers.onMoveCheckpoint(checkpoint.id, -1));
    actionsRow.appendChild(moveLeftButton);

    const moveRightButton = document.createElement('button');
    moveRightButton.type = 'button';
    moveRightButton.className = 'notebook-checkpoints__column-action';
    moveRightButton.textContent = '\u2192';
    moveRightButton.title = 'Move right';
    moveRightButton.disabled = index === checkpoints.length - 1;
    moveRightButton.addEventListener('click', () => handlers.onMoveCheckpoint(checkpoint.id, 1));
    actionsRow.appendChild(moveRightButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'notebook-checkpoints__column-action notebook-checkpoints__column-action--danger';
    deleteButton.textContent = '\ud83d\uddd1';
    deleteButton.title = 'Delete checkpoint';
    deleteButton.addEventListener('click', () => handlers.onDeleteCheckpoint(checkpoint.id, checkpoint.title));
    actionsRow.appendChild(deleteButton);

    th.appendChild(actionsRow);
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    nameCell.textContent = student.name;
    row.appendChild(nameCell);

    checkpoints.forEach((checkpoint) => {
      const record = checkpointService.getRecordForStudent(checkpoint, student.id);
      const meta = getCellMeta(checkpoint, record);

      const cell = document.createElement('td');
      cell.className = `notebook-checkpoints__cell notebook-checkpoints__cell--${meta.chipClass}`;
      if (activeAttentionFilter) {
        const matches = cellMatchesAttentionFilter(checkpoint, student, record, activeAttentionFilter);
        cell.classList.add(matches ? 'notebook-checkpoints__cell--highlighted' : 'notebook-checkpoints__cell--dimmed');
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'notebook-checkpoints__cell-button';
      button.setAttribute('aria-label', `${student.name} \u2014 ${checkpoint.title}: ${meta.label}`);
      const iconEl = document.createElement('span');
      iconEl.textContent = meta.icon;
      const labelEl = document.createElement('span');
      labelEl.className = 'notebook-checkpoints__cell-label';
      labelEl.textContent = meta.label;
      button.append(iconEl, labelEl);
      button.addEventListener('click', () => handlers.onOpenCell(checkpoint.id, student.id));
      cell.appendChild(button);

      // One-tap quick action, only while not yet submitted — mirrors
      // WorkRequestRosterView.js's own established "Mark Submitted"
      // one-tap pattern directly, reused rather than inventing a new
      // interaction, per explicit product instruction. Defaults the
      // submission date to today; a teacher needing a different
      // (historical) date still opens the full editor via the button
      // above, which remains fully editable exactly as before.
      if (!record || record.submissionStatus === 'not_submitted') {
        const quickMarkButton = document.createElement('button');
        quickMarkButton.type = 'button';
        quickMarkButton.className = 'notebook-checkpoints__cell-quick-mark';
        quickMarkButton.textContent = '\u2713 Mark Submitted';
        quickMarkButton.addEventListener('click', (event) => {
          event.stopPropagation();
          handlers.onQuickMarkSubmitted(checkpoint.id, student.id);
        });
        cell.appendChild(quickMarkButton);
      }

      // Quick review actions, only once submitted but not yet
      // reviewed — the exact friction point identified by inspection:
      // reviewing previously always required opening the full editor,
      // even for the common one-tap decision. Mirrors the same
      // one-tap-then-persist pattern as Mark Submitted above. The
      // full editor (opened via the main cell button) remains the
      // only path for a review date correction or a note, unchanged.
      if (record && record.submissionStatus === 'submitted' && record.reviewStatus === 'not_reviewed') {
        const quickActions = document.createElement('div');
        quickActions.className = 'notebook-checkpoints__cell-quick-review';

        const quickCompleteButton = document.createElement('button');
        quickCompleteButton.type = 'button';
        quickCompleteButton.className = 'notebook-checkpoints__cell-quick-review-button notebook-checkpoints__cell-quick-review-button--complete';
        quickCompleteButton.textContent = '\u2713 Complete';
        quickCompleteButton.addEventListener('click', (event) => {
          event.stopPropagation();
          handlers.onQuickReview(checkpoint.id, student.id, 'complete');
        });

        const quickIncompleteButton = document.createElement('button');
        quickIncompleteButton.type = 'button';
        quickIncompleteButton.className = 'notebook-checkpoints__cell-quick-review-button notebook-checkpoints__cell-quick-review-button--incomplete';
        quickIncompleteButton.textContent = '\u26a0 Incomplete';
        quickIncompleteButton.addEventListener('click', (event) => {
          event.stopPropagation();
          handlers.onQuickReview(checkpoint.id, student.id, 'incomplete');
        });

        quickActions.append(quickCompleteButton, quickIncompleteButton);
        cell.appendChild(quickActions);
      }
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

function renderCellEditor(checkpoint, student, handlers) {
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
    lateNotice.textContent = wouldBeLate ? `\u26a0\ufe0f Submitted late (due ${formatDate(checkpoint.dueDate)})` : '';
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
