/**
 * ui/views/GoalDashboardView.js
 *
 * "Who needs my attention today" — per-category, per-student status
 * in a real matrix (columns = Categories, rows = Students), matching
 * the same visual model as ui/views/NotebookCheckpointsView.js's own
 * Checkpoint grid, per explicit product decision. Reuses that
 * screen's own presentational CSS classes directly
 * (.assessment-gradebook, .notebook-checkpoints__column-header/--cell)
 * — never its column-reorder/delete machinery, since Categories are
 * already managed elsewhere (GoalManagementView.js's own "Manage
 * Goals" screen).
 *
 * The review/approve flow (Review -> Approve or Suggest Changes)
 * moved here from GoalManagementView.js, per explicit product
 * decision — this is where a teacher already looks at per-student
 * status, so reviewing belongs here too, not split across two
 * screens. Reached directly, no intermediate landing page: reaching
 * the "goals" route renders this view straight away whenever an
 * active Goal Cycle exists (see main.js's own 'goalManagement' route
 * branch). The separate "Goals Awaiting Approval" list and "Haven't
 * Submitted All Goals Yet" section that used to live on this screen
 * were both removed, per explicit product decision — the status
 * matrix's own per-cell Review button and per-cell status already
 * show exactly the same information without a redundant, separate
 * presentation of it.
 *
 * Every number rendered here comes from
 * services/goalStatisticsService.js's own isCompletedToday() — this
 * view never computes completion itself, matching how every other
 * statistics-driven view in this app (Recognition Wall, Weekly
 * Snapshot) only ever renders what its own service computed.
 */

import * as goalService from '../../services/goalService.js';
import * as studentGoalsService from '../../services/studentGoalsService.js';
import * as goalStatisticsService from '../../services/goalStatisticsService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';
import { showToast } from '../components/Toast.js';
import { renderGoalManagementView } from './GoalManagementView.js';

export function renderGoalDashboardView(container, { classroom, onBack }) {
  // mode: 'table' | 'studentDetail' | 'reviewGoal'
  //
  // reviewOrigin tracks which mode a "Review" action was actually
  // opened from (today, always 'table' -- the matrix's own per-cell
  // "Review" button on an Awaiting approval cell is the only entry
  // point into 'reviewGoal') so Approve/Suggest Changes/Cancel all
  // return there rather than hardcoding 'table', matching this app's
  // own established "extend the existing mode mechanism, don't
  // hardcode a single return target" convention.
  let mode = 'table';
  let reviewOrigin = 'table';
  let selectedStudentId = null;
  let reviewingGoalId = null;
  let allGoals = [];
  let reviewingGoal = null;
  // Whether the inline "Suggest Changes" feedback editor is currently
  // revealed on top of the reviewGoal screen -- a sub-state of
  // 'reviewGoal' itself, not a separate mode, since it's still the
  // same screen with one more section shown; see
  // renderReviewGoalStep()/renderSuggestChangesForm() below.
  let showingFeedbackForm = false;

  async function rerender() {
    const cycle = goalService.getActiveCycle(classroom);
    if (cycle && mode === 'table') {
      // Diagnostic try/catch, deliberately kept (not just temporary
      // scaffolding): this is a genuine, separate Firestore read
      // (classrooms/{classroomId}/studentGoals, teacher-side, no
      // status filter) from the reviewGoal-mode read below and from
      // requestGoalChanges()'s own write in onSendSuggestions -- if
      // THIS one is ever denied, the dashboard should still render
      // (an empty matrix) rather than leave an unhandled rejection
      // that silently blocks render() from ever being called, and the
      // console log below identifies exactly which of the two
      // operations failed rather than an unattributed rejection.
      try {
        allGoals = await studentGoalsService.getAllGoalsForClassroom(classroom.id, cycle.id);
      } catch (error) {
        console.error('[GoalDashboardView] getAllGoalsForClassroom() denied/failed -- read of classrooms/{classroomId}/studentGoals for cycleId=' + cycle.id + ':', error);
        allGoals = [];
      }
    }
    if (cycle && mode === 'reviewGoal') {
      const cycleGoals = await studentGoalsService.getPendingApprovalGoalsForClassroom(classroom.id, cycle.id);
      reviewingGoal = cycleGoals.find((g) => g.id === reviewingGoalId) ?? null;
    }
    render(container, mode, { classroom, selectedStudentId, allGoals, reviewingGoal, showingFeedbackForm }, handlers);
  }

  const handlers = {
    onBack,
    onSelectStudent: (studentId) => {
      selectedStudentId = studentId;
      mode = 'studentDetail';
      rerender();
    },
    onBackToTable: () => {
      selectedStudentId = null;
      mode = 'table';
      rerender();
    },
    onReviewGoal: (goalId) => {
      reviewOrigin = mode; // 'table' today -- see this function's own header comment
      reviewingGoalId = goalId;
      showingFeedbackForm = false;
      mode = 'reviewGoal';
      rerender();
    },
    onApproveGoal: async (goalId) => {
      await studentGoalsService.approveGoal(classroom.id, goalId);
      mode = reviewOrigin;
      reviewingGoalId = null;
      showingFeedbackForm = false;
      rerender();
    },
    onCancelReview: () => {
      mode = reviewOrigin;
      reviewingGoalId = null;
      showingFeedbackForm = false;
      rerender();
    },
    onStartSuggestChanges: () => {
      showingFeedbackForm = true;
      rerender();
    },
    onCancelSuggestChanges: () => {
      showingFeedbackForm = false;
      rerender();
    },
    onSendSuggestions: async (goalId, feedbackText) => {
      // The exact write requestGoalChanges() performs is a scoped
      // update to classrooms/{classroomId}/studentGoals/{goalId},
      // setting status to 'changes_requested' + teacherFeedback -- a
      // DIFFERENT Firestore operation from getAllGoalsForClassroom()'s
      // own read above. On failure, deliberately do NOT reset mode/
      // reviewingGoalId/showingFeedbackForm or call rerender() -- the
      // teacher stays on the still-open feedback form with their
      // typed text intact, and gets a visible error instead of a
      // silent, unhandled rejection.
      try {
        await studentGoalsService.requestGoalChanges(classroom.id, goalId, feedbackText);
      } catch (error) {
        console.error('[GoalDashboardView] requestGoalChanges() denied/failed -- update of classrooms/' + classroom.id + '/studentGoals/' + goalId + ' to status "changes_requested":', error);
        showToast('Could not send feedback — please try again.');
        return;
      }
      mode = reviewOrigin;
      reviewingGoalId = null;
      showingFeedbackForm = false;
      rerender();
      showToast('Feedback sent to the student.');
    },
    // Compact secondary action near the dashboard's own header --
    // container-swaps into GoalManagementView.js's 'manage' step
    // directly (Pin/Categories), skipping its own 'home' screen
    // entirely, mirroring that file's own existing onOpenDashboard()
    // container-swap pattern exactly (just the reverse direction).
    // Never URL routing, per this whole subsystem's own established
    // convention (see this file's own header comment).
    onOpenManageGoals: () => {
      renderGoalManagementView(container, {
        classroom,
        onBack: () => renderGoalDashboardView(container, { classroom, onBack }),
        initialMode: 'manage',
      });
    },
  };

  rerender();
}

function render(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  const backTarget =
    mode === 'studentDetail' ? handlers.onBackToTable :
    mode === 'reviewGoal' ? handlers.onCancelReview :
    handlers.onBack;
  header.appendChild(createBackButton(backTarget));
  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Goal Dashboard';
  titleBlock.appendChild(title);
  header.appendChild(titleBlock);

  // Compact secondary action, in the SAME horizontal header row as the
  // title -- only on the main dashboard view itself, not on
  // studentDetail/reviewGoal, where it would be an odd, out-of-context
  // control. Reuses .tracker-header__actions + .btn--ghost, this app's
  // own existing "compact action(s) beside a tracker-header's own
  // title" pattern (see ui/views/TrackerView.js's own header actions;
  // .tracker-header .btn--ghost has its own dedicated override in
  // styles.css specifically so a ghost button reads correctly against
  // this header's own dark background) -- NOT
  // .notebook-tracker__configure-link, which is a block-level,
  // full-width "doorway card" meant to sit inside page CONTENT (see
  // its own CSS: display:block; width:100%), wrong for a header row
  // and the actual cause of the previous oversized second strip.
  if (mode === 'table') {
    const actions = document.createElement('div');
    actions.className = 'tracker-header__actions';
    const manageButton = document.createElement('button');
    manageButton.type = 'button';
    manageButton.className = 'btn btn--ghost';
    manageButton.textContent = 'Manage Goals';
    manageButton.addEventListener('click', handlers.onOpenManageGoals);
    actions.appendChild(manageButton);
    header.appendChild(actions);
  }

  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const cycle = goalService.getActiveCycle(state.classroom);
  if (!cycle) {
    content.appendChild(createEmptyStateElement({ message: 'No active Goal Cycle yet.' }));
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    return;
  }

  if (mode === 'studentDetail') {
    content.appendChild(renderStudentDetail(state.classroom, cycle, state.selectedStudentId, state.allGoals));
  } else if (mode === 'reviewGoal') {
    content.appendChild(renderReviewGoalStep(state.classroom, cycle, state.reviewingGoal, state.showingFeedbackForm, handlers));
  } else {
    content.appendChild(renderCategoryMatrix(state.classroom, cycle, state.allGoals, handlers));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

/**
 * The real per-Category matrix — columns = Categories (each with its
 * own header showing how many students completed their goal today),
 * rows = Students, cells = this exact Student/Category's own real
 * status. Reuses ui/views/NotebookCheckpointsView.js's own
 * presentational classes directly (.assessment-gradebook,
 * .notebook-checkpoints__column-header/--cell) for the same visual
 * model, without any of that screen's own column-editing machinery —
 * Categories are managed on GoalManagementView.js's own "Manage
 * Goals" screen instead.
 */
function renderCategoryMatrix(classroom, cycle, allGoals, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = cycle.title;
  section.appendChild(heading);

  const students = goalService.getClassroomStudents(classroom);
  const categories = goalService.listCategories(cycle);

  if (students.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No students in this classroom yet.' }));
    return section;
  }
  if (categories.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No Categories yet \u2014 add one from \u201cManage Goals.\u201d' }));
    return section;
  }

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

  categories.forEach((category) => {
    const th = document.createElement('th');
    th.className = 'notebook-checkpoints__column-header';

    const card = document.createElement('div');
    card.className = 'goal-dashboard__category-card';

    const titleEl = document.createElement('span');
    titleEl.className = 'goal-dashboard__category-title';
    titleEl.textContent = category.name;
    card.appendChild(titleEl);

    const completedTodayCount = students.filter((student) => {
      const goal = allGoals.find((g) => g.studentId === student.id && g.categoryId === category.id);
      return goal && goal.status !== 'pending_approval' && goalStatisticsService.isCompletedToday(cycle, goal.id);
    }).length;

    const statBox = document.createElement('div');
    statBox.className = 'notebook-checkpoints__column-stat-box';
    const statNumber = document.createElement('span');
    statNumber.className = 'notebook-checkpoints__column-stat-number';
    statNumber.textContent = `${completedTodayCount}/${students.length}`;
    const statLabel = document.createElement('span');
    statLabel.className = 'notebook-checkpoints__column-stat-label';
    statLabel.textContent = 'Today';
    statBox.append(statNumber, statLabel);
    card.appendChild(statBox);

    th.appendChild(card);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  students.forEach((student) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.className = 'assessment-gradebook__name-cell';
    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'btn btn--text';
    nameButton.textContent = student.name;
    nameButton.addEventListener('click', () => handlers.onSelectStudent(student.id));
    nameCell.appendChild(nameButton);
    row.appendChild(nameCell);

    categories.forEach((category) => {
      const cell = document.createElement('td');
      const goal = allGoals.find((g) => g.studentId === student.id && g.categoryId === category.id);
      populateGoalCell(cell, goal, cycle, handlers);
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  scroll.appendChild(table);
  section.appendChild(scroll);
  return section;
}

/**
 * Builds one Student/Category cell's own contents -- a three-zone
 * stack (icon-zone, label-zone, action-zone) matching
 * ui/views/NotebookCheckpointsView.js's own current cell structure
 * and visual language, but using goal-dashboard__* classes throughout
 * rather than reusing that file's own -status-icon/-cell-content/etc.
 * classes directly, so this screen stays independently maintainable.
 * The action zone is always rendered, even empty, so its own
 * presence/height never shifts the icon or label above it -- every
 * cell in a row stays aligned regardless of which cells have a
 * "Review" action beneath them.
 */
function populateGoalCell(cell, goal, cycle, handlers) {
  let chipClass;
  let iconName;
  let label;

  if (!goal) {
    chipClass = 'gray';
    iconName = 'circle-dot';
    label = 'No goal set';
  } else if (goal.status === 'pending_approval') {
    chipClass = 'amber';
    iconName = 'clock';
    label = 'Awaiting approval';
  } else if (goal.status === 'changes_requested') {
    // The teacher already reviewed and sent feedback; it's the
    // student's own turn to revise and resubmit next -- same amber
    // "in progress, needs attention" tint as Awaiting approval above,
    // but a distinct icon/label so the two don't read as the same
    // state. No action button here (see below): there's nothing left
    // for the teacher to do until the student resubmits.
    chipClass = 'amber';
    iconName = 'alert-triangle';
    label = 'Changes requested';
  } else {
    const completedToday = goalStatisticsService.isCompletedToday(cycle, goal.id);
    chipClass = completedToday ? 'green' : 'red';
    iconName = completedToday ? 'check' : 'x';
    label = completedToday ? 'Completed' : 'Not completed';
  }

  cell.className = `goal-dashboard__cell goal-dashboard__cell--${chipClass}`;

  const content = document.createElement('div');
  content.className = 'goal-dashboard__cell-content';

  const row = document.createElement('div');
  row.className = 'goal-dashboard__cell-row';

  const statusIcon = document.createElement('span');
  statusIcon.className = `goal-dashboard__status-icon goal-dashboard__status-icon--${chipClass}`;
  statusIcon.appendChild(createIcon(iconName, { size: 16, strokeWidth: 2.5 }));
  row.appendChild(statusIcon);

  const labelEl = document.createElement('span');
  labelEl.className = 'goal-dashboard__cell-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  content.appendChild(row);

  const actionZone = document.createElement('div');
  actionZone.className = 'goal-dashboard__cell-action-zone';
  if (goal && goal.status === 'pending_approval') {
    const reviewButton = document.createElement('button');
    reviewButton.type = 'button';
    reviewButton.className = 'goal-dashboard__cell-quick-review';
    reviewButton.textContent = 'Review';
    reviewButton.addEventListener('click', () => handlers.onReviewGoal(goal.id));
    actionZone.appendChild(reviewButton);
  }
  content.appendChild(actionZone);

  cell.appendChild(content);
}

function renderStudentDetail(classroom, cycle, studentId, allGoals) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const student = goalService.getClassroomStudents(classroom).find((s) => s.id === studentId);

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = student ? student.name : 'Unknown student';
  section.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'settings-editable-list';

  goalService.listCategories(cycle).forEach((category) => {
    const goal = allGoals.find((g) => g.studentId === studentId && g.categoryId === category.id);
    const item = document.createElement('li');
    item.className = 'settings-editable-list__item';

    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = category.name;
    item.appendChild(label);

    const status = document.createElement('span');
    if (!goal) {
      status.textContent = 'No goal set';
      status.style.color = 'var(--color-muted)';
    } else if (goal.status === 'pending_approval') {
      status.textContent = 'Awaiting approval';
      status.style.color = 'var(--color-warning)';
    } else if (goal.status === 'changes_requested') {
      status.textContent = 'Changes requested';
      status.style.color = 'var(--color-warning)';
    } else {
      const completedToday = goalStatisticsService.isCompletedToday(cycle, goal.id);
      status.textContent = completedToday ? '\u2713' : '\u2716';
      status.style.color = completedToday ? 'var(--color-success)' : 'var(--color-danger)';
      status.style.fontWeight = 'var(--font-weight-black)';
    }
    item.appendChild(status);

    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}

/**
 * The individual goal review screen -- originally moved verbatim from
 * GoalManagementView.js's own former renderReviewGoalStep(); now
 * extended with a second possible outcome alongside Approve: Suggest
 * Changes, which reveals renderSuggestChangesForm() below in place of
 * the action row rather than submitting anything immediately. Approve
 * is the primary, positive action; Suggest Changes is deliberately a
 * quieter secondary one (.btn--secondary, not .btn--primary), per
 * explicit design direction that the two must not read as equally
 * weighted.
 */
function renderReviewGoalStep(classroom, cycle, goal, showingFeedbackForm, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  if (!goal) {
    section.appendChild(createEmptyStateElement({ message: 'This goal is no longer available.' }));
    return section;
  }

  const student = goalService.getClassroomStudents(classroom).find((s) => s.id === goal.studentId);
  const category = cycle?.categories.find((c) => c.id === goal.categoryId);

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = `${student ? student.name : 'Unknown student'} — ${category ? category.name : ''}`;
  section.appendChild(heading);

  const goalText = document.createElement('p');
  goalText.className = 'settings-section__meta';
  goalText.style.fontSize = '1.1rem';
  goalText.style.color = 'var(--color-ink)';
  goalText.textContent = `“${goal.text}”`;
  section.appendChild(goalText);

  if (showingFeedbackForm) {
    section.appendChild(renderSuggestChangesForm(goal, handlers));
    return section;
  }

  const actions = document.createElement('div');
  actions.className = 'goal-dashboard__review-actions';

  const approveButton = document.createElement('button');
  approveButton.type = 'button';
  approveButton.className = 'btn btn--primary';
  approveButton.textContent = 'Approve';
  approveButton.addEventListener('click', () => handlers.onApproveGoal(goal.id));
  actions.appendChild(approveButton);

  const suggestButton = document.createElement('button');
  suggestButton.type = 'button';
  suggestButton.className = 'btn btn--secondary';
  suggestButton.textContent = 'Suggest Changes';
  suggestButton.addEventListener('click', handlers.onStartSuggestChanges);
  actions.appendChild(suggestButton);

  section.appendChild(actions);

  return section;
}

/**
 * The inline feedback editor revealed by "Suggest Changes" above --
 * deliberately inline on the same screen, never a modal/prompt()/
 * alert(), per explicit design direction. Cancel discards the draft
 * text and returns to the Approve/Suggest Changes action row above
 * (handlers.onCancelSuggestChanges), without touching the goal at
 * all. Send Suggestions persists via handlers.onSendSuggestions,
 * which is the only path that actually writes anything here.
 */
function renderSuggestChangesForm(goal, handlers) {
  const form = document.createElement('div');
  form.className = 'goal-dashboard__feedback-form';

  const label = document.createElement('p');
  label.className = 'goal-dashboard__feedback-label';
  label.textContent = 'Teacher feedback';
  form.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.className = 'goal-dashboard__feedback-textarea';
  textarea.placeholder = 'Tell the student what they should change…';
  form.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'goal-dashboard__review-actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelSuggestChanges);
  actions.appendChild(cancelButton);

  const sendButton = document.createElement('button');
  sendButton.type = 'button';
  sendButton.className = 'btn btn--primary';
  sendButton.textContent = 'Send Suggestions';
  sendButton.addEventListener('click', () => {
    const feedbackText = textarea.value.trim();
    if (!feedbackText) return;
    handlers.onSendSuggestions(goal.id, feedbackText);
  });
  actions.appendChild(sendButton);

  form.appendChild(actions);
  return form;
}


