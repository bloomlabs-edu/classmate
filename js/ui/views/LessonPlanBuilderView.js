/**
 * ui/views/LessonPlanBuilderView.js
 *
 * The Lesson Plan Builder — a single scrolling canvas built directly on
 * the Phase 1 structured model (models/LessonPlan.js) and its content
 * services (services/lessonPlanService.js), never a multi-step wizard
 * and never raw JSON. The "5 Questions" framework stays visible as five
 * always-on sections (matching the model's own section comments) rather
 * than being flattened into one generic form or hidden behind steps.
 *
 * Activities (services/lessonPlanService.js's addActivity/updateActivity/
 * deleteActivity/duplicateActivity/moveActivityUp/moveActivityDown) are
 * the one part of this canvas that must read as first-class, composable
 * objects, not spreadsheet rows — each is its own card: collapsible,
 * reorderable, duplicable, deletable, with differentiation hidden
 * behind "+ Add differentiation" until a teacher deliberately reveals it
 * (progressive disclosure, per addActivityDifferentiation()'s own doc
 * comment).
 *
 * Autosave, no explicit Save button — every mutation handler below
 * mutates the in-memory `plan` via lessonPlanService (mutate-then-
 * caller-saves, see that file's own header comment), then this view is
 * the caller that persists it via lessonPlanRepository.saveLessonPlan()
 * and rerenders. Text fields commit on `change` (blur), not every
 * keystroke — the same convention ui/views/ReadingEditorView.js already
 * uses — so a full-canvas rerender never fights an in-progress keypress.
 * The save-state indicator reuses
 * ui/components/ProgrammeSessionSaveIndicator.js's existing
 * `createSaveIndicatorController()` (tracks one write-promise at a
 * time), not services/workspaceService.js's classroom-wide dirty/
 * saving/saved machine — a LessonPlan is its own Firestore document,
 * never a field on the classroom document, so it was never going
 * through that machine to begin with (identical reasoning to
 * ProgrammeSession's own save indicator — see that file's header
 * comment).
 *
 * Readiness (services/lessonPlanValidationService.js) is shown as a
 * standing, non-blocking checklist — informational only. Phase 2 has no
 * submit/approve actions at all (those, plus status-based edit gating
 * and reviewer comments, are Phase 3's own scope); showing readiness
 * now costs nothing and means Phase 3 doesn't have to retrofit it.
 *
 * Self-contained, same pattern as every other view in this app: no
 * router import, local state only for which Activities are currently
 * collapsed. Takes the classroom, current user, the LessonPlan's id,
 * and one `onBack`.
 */

import * as lessonPlanRepository from '../../services/lessonPlanRepository.js';
import * as lessonPlanService from '../../services/lessonPlanService.js';
import { LESSON_PLAN_STATUS } from '../../models/LessonPlan.js';
import { getLessonPlanReadiness } from '../../services/lessonPlanValidationService.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';

const STATUS_LABELS = Object.freeze({
  [LESSON_PLAN_STATUS.DRAFT]: 'Draft',
  [LESSON_PLAN_STATUS.SUBMITTED]: 'Submitted',
  [LESSON_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [LESSON_PLAN_STATUS.APPROVED]: 'Approved',
});

export function renderLessonPlanBuilderView(container, { classroom, currentUser, lessonPlanId, onBack }) {
  let plan = null; // null = loading
  let loadError = null;
  const collapsedActivityIds = new Set();
  const saveIndicator = createSaveIndicatorController();

  function persistAndRerender() {
    saveIndicator.persistPatch(() => lessonPlanRepository.saveLessonPlan(classroom.id, plan));
    rerender();
  }

  /**
   * For a plain content edit (a field's text changed, nothing added/
   * removed/reordered) — persists and refreshes only the readiness
   * panel, WITHOUT tearing down and rebuilding the rest of the canvas.
   *
   * This is what actually fixes the click-swallowing race: every field
   * here fires on `change` (blur), so clicking any action button
   * elsewhere starts with a blur on whatever field the teacher was just
   * typing in. If that blur triggered a full `container.innerHTML = ''`
   * rebuild (persistAndRerender()'s old behavior for these handlers),
   * the button being clicked would be destroyed and replaced mid-click
   * — a browser only fires `click` when mousedown and mouseup land on
   * the SAME element, so the click would silently do nothing. A content
   * edit never needs to touch the DOM at all (the input already shows
   * what the teacher typed; nothing else on screen echoes that value)
   * except the readiness checklist, so this only ever swaps that one
   * node — the action button a teacher clicks next is never disturbed,
   * and the click fires normally on the first try.
   *
   * Structural changes (add/remove/reorder/duplicate an Activity or a
   * dynamic list row, reveal/collapse differentiation) still go through
   * persistAndRerender() — they need new/removed DOM nodes regardless,
   * and by the time THEIR click handler runs the click has already
   * fired successfully, so rebuilding in response to it is never in the
   * way of anything.
   */
  function persistOnly() {
    saveIndicator.persistPatch(() => lessonPlanRepository.saveLessonPlan(classroom.id, plan));
    refreshReadinessPanel();
  }

  function refreshReadinessPanel() {
    const existing = container.querySelector('.lesson-plan-builder__readiness');
    if (existing) existing.replaceWith(renderReadinessPanel(plan));
  }

  function rerender() {
    renderBuilder(container, { plan, loadError, collapsedActivityIds, saveIndicatorElement: saveIndicator.element }, {
      onBack,

      // ---- Context ----
      onTopicChange: (value) => {
        lessonPlanService.updateContext(plan, { topic: value });
        persistOnly();
      },
      onGradeLabelChange: (value) => {
        lessonPlanService.updateContext(plan, { gradeLabel: value });
        persistOnly();
      },

      // ---- 1. WHY ----
      onLessonObjectiveChange: (value) => {
        lessonPlanService.updateWhy(plan, { lessonObjective: value });
        persistOnly();
      },
      onBigQuestionChange: (value) => {
        lessonPlanService.updateWhy(plan, { bigQuestion: value });
        persistOnly();
      },
      onAddSwbat: () => {
        lessonPlanService.addSwbatObjective(plan, '');
        persistAndRerender();
      },
      onSwbatChange: (index, value) => {
        lessonPlanService.updateSwbatObjective(plan, index, value);
        persistOnly();
      },
      onRemoveSwbat: (index) => {
        lessonPlanService.removeSwbatObjective(plan, index);
        persistAndRerender();
      },

      // ---- 2. SELF / OTHERS / INDIA ----
      onSelfOthersIndiaChange: (field, value) => {
        lessonPlanService.updateSelfOthersIndia(plan, { [field]: value });
        persistOnly();
      },

      // ---- 3. ASSESSMENT ----
      onAddAssessment: () => {
        lessonPlanService.addAssessmentItem(plan, '');
        persistAndRerender();
      },
      onAssessmentChange: (itemId, value) => {
        lessonPlanService.updateAssessmentItem(plan, itemId, value);
        persistOnly();
      },
      onRemoveAssessment: (itemId) => {
        lessonPlanService.removeAssessmentItem(plan, itemId);
        persistAndRerender();
      },

      // ---- 4. FUN, FAST, EFFECTIVE — Spark ----
      onSparkChange: (field, value) => {
        lessonPlanService.updateSpark(plan, { [field]: value });
        persistOnly();
      },

      // ---- 4. FUN, FAST, EFFECTIVE — Activities ----
      onAddActivity: () => {
        const activity = lessonPlanService.addActivity(plan);
        collapsedActivityIds.delete(activity.id); // a brand-new Activity always opens expanded
        persistAndRerender();
      },
      onToggleActivityCollapse: (activityId) => {
        if (collapsedActivityIds.has(activityId)) collapsedActivityIds.delete(activityId);
        else collapsedActivityIds.add(activityId);
        rerender(); // purely local UI state — nothing to persist
      },
      onActivityChange: (activityId, field, value) => {
        lessonPlanService.updateActivity(plan, activityId, { [field]: value });
        persistOnly();
      },
      onDuplicateActivity: (activityId) => {
        const duplicate = lessonPlanService.duplicateActivity(plan, activityId);
        if (duplicate && collapsedActivityIds.has(activityId)) collapsedActivityIds.add(duplicate.id);
        persistAndRerender();
      },
      onDeleteActivity: (activityId) => {
        if (!window.confirm('Delete this activity?')) return;
        lessonPlanService.deleteActivity(plan, activityId);
        collapsedActivityIds.delete(activityId);
        persistAndRerender();
      },
      onMoveActivityUp: (activityId) => {
        lessonPlanService.moveActivityUp(plan, activityId);
        persistAndRerender();
      },
      onMoveActivityDown: (activityId) => {
        lessonPlanService.moveActivityDown(plan, activityId);
        persistAndRerender();
      },
      onAddActivityDifferentiation: (activityId) => {
        lessonPlanService.addActivityDifferentiation(plan, activityId);
        persistAndRerender();
      },
      onRemoveActivityDifferentiation: (activityId) => {
        lessonPlanService.removeActivityDifferentiation(plan, activityId);
        persistAndRerender();
      },
      onActivityDifferentiationChange: (activityId, field, value) => {
        lessonPlanService.updateActivityDifferentiation(plan, activityId, { [field]: value });
        persistOnly();
      },

      // ---- 5. HELPING EACH OTHER LEARN ----
      onHelpingEachOtherLearnChange: (field, value) => {
        lessonPlanService.updateHelpingEachOtherLearn(plan, { [field]: value });
        persistOnly();
      },
    });
  }

  rerender();

  lessonPlanRepository
    .getLessonPlanById(classroom.id, lessonPlanId)
    .then((fetched) => {
      if (!fetched) {
        loadError = "This lesson plan couldn't be found. It may have been deleted.";
      } else {
        plan = fetched;
      }
      rerender();
    })
    .catch((error) => {
      console.error('[LessonPlanBuilderView] Failed to load lesson plan:', error);
      loadError = "Couldn't load this lesson plan. Check your connection and try again.";
      rerender();
    });
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderBuilder(container, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'lesson-plan-builder';

  const header = document.createElement('header');
  header.className = 'lesson-plan-builder__header';
  header.appendChild(createBackButton(handlers.onBack));
  wrapper.appendChild(header);

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'lesson-plan-builder__error';
    error.textContent = state.loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (!state.plan) {
    const loading = document.createElement('p');
    loading.className = 'lesson-plan-builder__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  const plan = state.plan;

  wrapper.appendChild(renderTitleBar(plan, state.saveIndicatorElement, handlers));
  wrapper.appendChild(renderReadinessPanel(plan));

  wrapper.appendChild(
    renderSection('1. Why are students learning this?', [renderWhySection(plan, handlers)])
  );
  wrapper.appendChild(
    renderSection('2. Will it advance Self, Others, and India?', [renderSelfOthersIndiaSection(plan, handlers)])
  );
  wrapper.appendChild(
    renderSection('3. Are students showcasing their learning?', [renderAssessmentSection(plan, handlers)])
  );
  wrapper.appendChild(
    renderSection('4. Is it fun, fast, and effective?', [
      renderSparkSection(plan, handlers),
      renderActivitiesSection(plan, state.collapsedActivityIds, handlers),
    ])
  );
  wrapper.appendChild(
    renderSection('5. Are students helping me and each other learn?', [renderHelpingEachOtherLearnSection(plan, handlers)])
  );

  container.appendChild(wrapper);
}

function renderTitleBar(plan, saveIndicatorElement, handlers) {
  const titleBar = document.createElement('div');
  titleBar.className = 'lesson-plan-builder__title-bar';

  const topLine = document.createElement('div');
  topLine.className = 'lesson-plan-builder__title-line';

  const topicInput = document.createElement('input');
  topicInput.type = 'text';
  topicInput.className = 'lesson-plan-builder__title-input';
  topicInput.placeholder = 'Untitled Lesson Plan';
  topicInput.value = plan.topic;
  topicInput.addEventListener('change', () => handlers.onTopicChange(topicInput.value));
  topLine.appendChild(topicInput);

  const statusBadge = document.createElement('span');
  statusBadge.className = `lesson-plan-builder__status-badge lesson-plan-builder__status-badge--${plan.status}`;
  statusBadge.textContent = STATUS_LABELS[plan.status] || plan.status;
  topLine.appendChild(statusBadge);

  titleBar.appendChild(topLine);

  const metaLine = document.createElement('div');
  metaLine.className = 'lesson-plan-builder__meta-line';

  const gradeInput = document.createElement('input');
  gradeInput.type = 'text';
  gradeInput.className = 'lesson-plan-builder__grade-input';
  gradeInput.placeholder = 'Grade (e.g. Grade 8)';
  gradeInput.value = plan.gradeLabel;
  gradeInput.addEventListener('change', () => handlers.onGradeLabelChange(gradeInput.value));
  metaLine.appendChild(gradeInput);

  metaLine.appendChild(saveIndicatorElement);

  titleBar.appendChild(metaLine);

  return titleBar;
}

function renderReadinessPanel(plan) {
  const readiness = getLessonPlanReadiness(plan);
  const panel = document.createElement('div');
  panel.className = readiness.ready
    ? 'lesson-plan-builder__readiness lesson-plan-builder__readiness--ready'
    : 'lesson-plan-builder__readiness lesson-plan-builder__readiness--pending';

  if (readiness.ready) {
    panel.appendChild(createIcon('check-circle-2', { size: 16 }));
    const text = document.createElement('span');
    text.textContent = 'This lesson plan has everything it needs.';
    panel.appendChild(text);
    return panel;
  }

  const heading = document.createElement('p');
  heading.className = 'lesson-plan-builder__readiness-heading';
  heading.textContent = `Almost there — ${readiness.missing.length} thing${readiness.missing.length === 1 ? '' : 's'} left:`;
  panel.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'lesson-plan-builder__readiness-list';
  readiness.missing.forEach((item) => {
    const entry = document.createElement('li');
    entry.textContent = item.message;
    list.appendChild(entry);
  });
  panel.appendChild(list);

  return panel;
}

function renderSection(heading, children) {
  const section = document.createElement('section');
  section.className = 'lesson-plan-builder__section';

  const headingEl = document.createElement('h2');
  headingEl.className = 'lesson-plan-builder__section-heading';
  headingEl.textContent = heading;
  section.appendChild(headingEl);

  children.forEach((child) => section.appendChild(child));

  return section;
}

function createLabeledTextarea({ label, placeholder, value, onChange }) {
  const field = document.createElement('div');
  field.className = 'lesson-plan-builder__field';

  const labelEl = document.createElement('label');
  labelEl.className = 'lesson-plan-builder__field-label';
  labelEl.textContent = label;
  field.appendChild(labelEl);

  const textarea = document.createElement('textarea');
  textarea.className = 'lesson-plan-builder__textarea';
  textarea.placeholder = placeholder;
  textarea.value = value;
  textarea.addEventListener('change', () => onChange(textarea.value));
  field.appendChild(textarea);

  return field;
}

// ---- 1. WHY --------------------------------------------------------

function renderWhySection(plan, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__why';

  wrap.appendChild(
    createLabeledTextarea({
      label: 'Lesson Objective',
      placeholder: 'What should students understand or be able to do by the end of this lesson?',
      value: plan.lessonObjective,
      onChange: handlers.onLessonObjectiveChange,
    })
  );

  wrap.appendChild(
    createLabeledTextarea({
      label: 'Big Question',
      placeholder: 'The one question this whole lesson is trying to answer',
      value: plan.bigQuestion,
      onChange: handlers.onBigQuestionChange,
    })
  );

  const swbatField = document.createElement('div');
  swbatField.className = 'lesson-plan-builder__field';
  const swbatLabel = document.createElement('label');
  swbatLabel.className = 'lesson-plan-builder__field-label';
  swbatLabel.textContent = 'Students Will Be Able To (SWBAT)';
  swbatField.appendChild(swbatLabel);

  plan.swbatObjectives.forEach((objective, index) => {
    swbatField.appendChild(
      createDynamicListRow({
        value: objective,
        placeholder: 'e.g. Identify at least two causes of the revolt',
        onChange: (value) => handlers.onSwbatChange(index, value),
        onRemove: () => handlers.onRemoveSwbat(index),
      })
    );
  });

  swbatField.appendChild(createAddRowButton('+ Add SWBAT objective', handlers.onAddSwbat));
  wrap.appendChild(swbatField);

  return wrap;
}

// ---- 2. SELF / OTHERS / INDIA --------------------------------------

function renderSelfOthersIndiaSection(plan, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__self-others-india';

  [
    { field: 'self', label: 'Self', placeholder: 'How does this build the student themselves?' },
    { field: 'others', label: 'Others', placeholder: 'How does this help students relate to others?' },
    { field: 'india', label: 'India', placeholder: 'How does this connect to India / the wider world?' },
  ].forEach(({ field, label, placeholder }) => {
    wrap.appendChild(
      createLabeledTextarea({
        label,
        placeholder,
        value: plan.selfOthersIndia[field],
        onChange: (value) => handlers.onSelfOthersIndiaChange(field, value),
      })
    );
  });

  return wrap;
}

// ---- 3. ASSESSMENT ---------------------------------------------------

function renderAssessmentSection(plan, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__assessment';

  plan.assessments.forEach((item) => {
    wrap.appendChild(
      createDynamicListRow({
        value: item.description,
        placeholder: 'e.g. Exit ticket with two causes of the revolt',
        onChange: (value) => handlers.onAssessmentChange(item.id, value),
        onRemove: () => handlers.onRemoveAssessment(item.id),
      })
    );
  });

  wrap.appendChild(createAddRowButton('+ Add assessment / evidence item', handlers.onAddAssessment));

  return wrap;
}

// ---- Shared: a dynamic list row / add-row button ---------------------

function createDynamicListRow({ value, placeholder, onChange, onRemove }) {
  const row = document.createElement('div');
  row.className = 'lesson-plan-builder__dynamic-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lesson-plan-builder__dynamic-input';
  input.placeholder = placeholder;
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  row.appendChild(input);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn--icon-only lesson-plan-builder__dynamic-remove';
  removeButton.setAttribute('aria-label', 'Remove');
  removeButton.appendChild(createIcon('x', { size: 14 }));
  removeButton.addEventListener('click', onRemove);
  row.appendChild(removeButton);

  return row;
}

function createAddRowButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--ghost lesson-plan-builder__add-row-button';
  button.appendChild(createIcon('plus', { size: 14 }));
  button.append(` ${label.replace(/^\+\s*/, '')}`);
  button.addEventListener('click', onClick);
  return button;
}

// ---- 4. FUN, FAST, EFFECTIVE — Spark ---------------------------------

function renderSparkSection(plan, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__spark';

  const heading = document.createElement('h3');
  heading.className = 'lesson-plan-builder__subheading';
  heading.textContent = 'Spark';
  wrap.appendChild(heading);

  const titleField = document.createElement('div');
  titleField.className = 'lesson-plan-builder__field';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'lesson-plan-builder__dynamic-input';
  titleInput.placeholder = 'Spark title (e.g. Mystery Object)';
  titleInput.value = plan.spark.title;
  titleInput.addEventListener('change', () => handlers.onSparkChange('title', titleInput.value));
  titleField.appendChild(titleInput);
  wrap.appendChild(titleField);

  wrap.appendChild(
    createLabeledTextarea({
      label: 'Teacher Action',
      placeholder: 'What does the teacher do?',
      value: plan.spark.teacherAction,
      onChange: (value) => handlers.onSparkChange('teacherAction', value),
    })
  );
  wrap.appendChild(
    createLabeledTextarea({
      label: 'Student Action',
      placeholder: 'What do students do?',
      value: plan.spark.studentAction,
      onChange: (value) => handlers.onSparkChange('studentAction', value),
    })
  );

  return wrap;
}

// ---- 4. FUN, FAST, EFFECTIVE — Activities ----------------------------

function renderActivitiesSection(plan, collapsedActivityIds, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__activities';

  const heading = document.createElement('h3');
  heading.className = 'lesson-plan-builder__subheading';
  heading.textContent = 'Learning Activities';
  wrap.appendChild(heading);

  if (plan.activities.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lesson-plan-builder__empty-message';
    empty.textContent = 'No activities yet — add the first one below.';
    wrap.appendChild(empty);
  }

  plan.activities.forEach((activity, index) => {
    wrap.appendChild(
      renderActivityCard(activity, index, plan.activities.length, collapsedActivityIds.has(activity.id), handlers)
    );
  });

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary lesson-plan-builder__add-activity-button';
  addButton.appendChild(createIcon('plus', { size: 16 }));
  addButton.append(' Add Activity');
  addButton.addEventListener('click', handlers.onAddActivity);
  wrap.appendChild(addButton);

  return wrap;
}

function renderActivityCard(activity, index, total, isCollapsed, handlers) {
  const card = document.createElement('div');
  card.className = 'lesson-plan-builder__activity-card';

  const cardHeader = document.createElement('div');
  cardHeader.className = 'lesson-plan-builder__activity-header';

  const collapseButton = document.createElement('button');
  collapseButton.type = 'button';
  collapseButton.className = 'lesson-plan-builder__activity-collapse-toggle';
  collapseButton.classList.toggle('lesson-plan-builder__activity-collapse-toggle--expanded', !isCollapsed);
  collapseButton.setAttribute('aria-label', isCollapsed ? 'Expand activity' : 'Collapse activity');
  collapseButton.appendChild(createIcon('arrow-right', { size: 14 }));
  collapseButton.addEventListener('click', () => handlers.onToggleActivityCollapse(activity.id));
  cardHeader.appendChild(collapseButton);

  const label = document.createElement('span');
  label.className = 'lesson-plan-builder__activity-label';
  label.textContent = `Activity ${index + 1}`;
  cardHeader.appendChild(label);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'lesson-plan-builder__activity-title-input';
  titleInput.placeholder = 'Activity title';
  titleInput.value = activity.title;
  titleInput.addEventListener('change', () => handlers.onActivityChange(activity.id, 'title', titleInput.value));
  cardHeader.appendChild(titleInput);

  const actions = document.createElement('div');
  actions.className = 'lesson-plan-builder__activity-actions';

  const upButton = document.createElement('button');
  upButton.type = 'button';
  upButton.className = 'lesson-plan-builder__activity-reorder-button';
  upButton.textContent = '▲';
  upButton.setAttribute('aria-label', 'Move activity up');
  upButton.disabled = index === 0;
  upButton.addEventListener('click', () => handlers.onMoveActivityUp(activity.id));
  actions.appendChild(upButton);

  const downButton = document.createElement('button');
  downButton.type = 'button';
  downButton.className = 'lesson-plan-builder__activity-reorder-button';
  downButton.textContent = '▼';
  downButton.setAttribute('aria-label', 'Move activity down');
  downButton.disabled = index === total - 1;
  downButton.addEventListener('click', () => handlers.onMoveActivityDown(activity.id));
  actions.appendChild(downButton);

  const duplicateButton = document.createElement('button');
  duplicateButton.type = 'button';
  duplicateButton.className = 'btn btn--icon-only';
  duplicateButton.setAttribute('aria-label', 'Duplicate activity');
  duplicateButton.appendChild(createIcon('copy', { size: 16 }));
  duplicateButton.addEventListener('click', () => handlers.onDuplicateActivity(activity.id));
  actions.appendChild(duplicateButton);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--icon-only';
  deleteButton.setAttribute('aria-label', 'Delete activity');
  deleteButton.appendChild(createIcon('trash-2', { size: 16 }));
  deleteButton.addEventListener('click', () => handlers.onDeleteActivity(activity.id));
  actions.appendChild(deleteButton);

  cardHeader.appendChild(actions);
  card.appendChild(cardHeader);

  if (!isCollapsed) {
    const body = document.createElement('div');
    body.className = 'lesson-plan-builder__activity-body';

    body.appendChild(
      createLabeledTextarea({
        label: 'Teacher Action',
        placeholder: 'What does the teacher do?',
        value: activity.teacherAction,
        onChange: (value) => handlers.onActivityChange(activity.id, 'teacherAction', value),
      })
    );
    body.appendChild(
      createLabeledTextarea({
        label: 'Student Action',
        placeholder: 'What do students do?',
        value: activity.studentAction,
        onChange: (value) => handlers.onActivityChange(activity.id, 'studentAction', value),
      })
    );

    if (activity.differentiation) {
      body.appendChild(renderDifferentiationFields(activity, handlers));
    } else {
      const addDiffButton = document.createElement('button');
      addDiffButton.type = 'button';
      addDiffButton.className = 'btn btn--ghost lesson-plan-builder__add-differentiation-button';
      addDiffButton.textContent = '+ Add differentiation';
      addDiffButton.addEventListener('click', () => handlers.onAddActivityDifferentiation(activity.id));
      body.appendChild(addDiffButton);
    }

    card.appendChild(body);
  }

  return card;
}

function renderDifferentiationFields(activity, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__differentiation';

  const heading = document.createElement('div');
  heading.className = 'lesson-plan-builder__differentiation-heading';
  const headingText = document.createElement('span');
  headingText.textContent = 'Differentiation';
  heading.appendChild(headingText);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn--text btn--danger-text';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => handlers.onRemoveActivityDifferentiation(activity.id));
  heading.appendChild(removeButton);

  wrap.appendChild(heading);

  [
    { field: 'redBucket', label: 'Red Bucket', placeholder: 'Extra support' },
    { field: 'greenBucket', label: 'Green Bucket', placeholder: 'Extra stretch' },
    { field: 'others', label: 'Others', placeholder: 'Any other differentiation' },
  ].forEach(({ field, label, placeholder }) => {
    wrap.appendChild(
      createLabeledTextarea({
        label,
        placeholder,
        value: activity.differentiation[field],
        onChange: (value) => handlers.onActivityDifferentiationChange(activity.id, field, value),
      })
    );
  });

  return wrap;
}

// ---- 5. HELPING EACH OTHER LEARN -------------------------------------

function renderHelpingEachOtherLearnSection(plan, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__helping-each-other-learn';

  wrap.appendChild(
    createLabeledTextarea({
      label: 'Pair Explanation',
      placeholder: 'How will students explain their learning to a partner?',
      value: plan.pairExplanation,
      onChange: (value) => handlers.onHelpingEachOtherLearnChange('pairExplanation', value),
    })
  );
  wrap.appendChild(
    createLabeledTextarea({
      label: 'Final Question',
      placeholder: 'One closing question to check understanding',
      value: plan.finalQuestion,
      onChange: (value) => handlers.onHelpingEachOtherLearnChange('finalQuestion', value),
    })
  );
  wrap.appendChild(
    createLabeledTextarea({
      label: "Teacher Look-Fors",
      placeholder: 'What will you look/listen for as students work?',
      value: plan.teacherLookFors,
      onChange: (value) => handlers.onHelpingEachOtherLearnChange('teacherLookFors', value),
    })
  );

  return wrap;
}
