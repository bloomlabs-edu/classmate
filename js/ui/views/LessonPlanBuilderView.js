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
 * standing, non-blocking checklist — informational only in Phase 2.
 *
 * Phase 3 adds the teacher-facing half of the review lifecycle on top
 * of this same canvas, deliberately NOT a separate view: submitting is
 * "the readiness checklist's own final step" (once ready, its panel
 * itself becomes the "Ready for review" / Submit control — see
 * renderReadinessPanel()), never a second screen. Editability is
 * gated by services/lessonPlanReviewService.js's own
 * isLessonPlanEditable() (DRAFT/CHANGES_REQUESTED only) — every input,
 * textarea, and structural action button below reads the one
 * `editable` flag computed in rerender() and disables/hides itself
 * accordingly, so a SUBMITTED or APPROVED plan can never be silently
 * edited out from under an in-progress or completed review, in this
 * view or (see firestore.rules' own lessonPlans block) at the data
 * layer either. Reviewer comments (`plan.activeComments`) render
 * inline under whichever section/activity they're addressed to —
 * read-only here; a reviewer's own affordance to WRITE one lives in
 * ui/views/LessonPlanReviewView.js, not this file.
 *
 * Self-contained, same pattern as every other view in this app: no
 * router import, local state only for which Activities are currently
 * collapsed. Takes the classroom, current user, the LessonPlan's id,
 * and one `onBack`.
 */

import * as lessonPlanRepository from '../../services/lessonPlanRepository.js';
import * as lessonPlanService from '../../services/lessonPlanService.js';
import * as lessonPlanReviewService from '../../services/lessonPlanReviewService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import { LESSON_PLAN_STATUS, LESSON_PLAN_SECTION_KEYS } from '../../models/LessonPlan.js';
import { getLessonPlanReadiness } from '../../services/lessonPlanValidationService.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { createCurriculumExplorerPanel } from '../components/CurriculumExplorerPanel.js';
import { openTeachingIdeasPickerModal } from '../components/TeachingIdeasPickerModal.js';

const STATUS_LABELS = Object.freeze({
  [LESSON_PLAN_STATUS.DRAFT]: 'Draft',
  [LESSON_PLAN_STATUS.SUBMITTED]: 'Submitted',
  [LESSON_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [LESSON_PLAN_STATUS.APPROVED]: 'Approved',
});

/** One friendly status line under the badge — never "Submission rejected"/"Form incomplete", per this feature's own explicit product direction on tone. */
function getStatusMessage(plan) {
  switch (plan.status) {
    case LESSON_PLAN_STATUS.SUBMITTED:
      return 'Submitted — needs a co-teacher’s review before it’s ready to teach.';
    case LESSON_PLAN_STATUS.CHANGES_REQUESTED:
      return 'Changes requested — see reviewer feedback below, then resubmit.';
    case LESSON_PLAN_STATUS.APPROVED:
      return 'Approved — this lesson plan is locked in.';
    default:
      return 'Draft — only you can see this until you submit it.';
  }
}

/** Every OPEN comment addressed to exactly this sectionKey (a named section, or `activity:{id}`/`activity:{id}:{field}` — see lessonPlanReviewService.js's own buildActivitySectionKey()). */
function getCommentsForSection(plan, sectionKey) {
  return plan.activeComments.filter((comment) => comment.sectionKey === sectionKey);
}

function renderCommentsList(plan, sectionKey) {
  const comments = getCommentsForSection(plan, sectionKey);
  if (comments.length === 0) return null;

  const list = document.createElement('div');
  list.className = 'lesson-plan-builder__comments';
  comments.forEach((comment) => {
    const card = document.createElement('div');
    card.className = 'lesson-plan-builder__comment-card';
    const meta = document.createElement('div');
    meta.className = 'lesson-plan-builder__comment-meta';
    meta.textContent = 'Reviewer feedback';
    card.appendChild(meta);
    const text = document.createElement('p');
    text.className = 'lesson-plan-builder__comment-text';
    text.textContent = comment.text;
    card.appendChild(text);
    list.appendChild(card);
  });
  return list;
}

export function renderLessonPlanBuilderView(container, { classroom, currentUser, lessonPlanId, onBack }) {
  let plan = null; // null = loading
  let loadError = null;
  const collapsedActivityIds = new Set();
  const saveIndicator = createSaveIndicatorController();
  let isConceptPickerOpen = false; // local UI state only — never persisted
  let expandedConceptUnitId = null;

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

  function submitForReview() {
    lessonPlanReviewService.submitForReview(plan, { byUid: currentUser?.uid || null });
    persistAndRerender();
  }

  function refreshReadinessPanel() {
    const existing = container.querySelector('.lesson-plan-builder__readiness');
    if (!existing) return;
    const editable = lessonPlanReviewService.isLessonPlanEditable(plan);
    existing.replaceWith(renderReadinessPanel(plan, { editable, onSubmitForReview: submitForReview }));
  }

  function rerender() {
    const editable = plan ? lessonPlanReviewService.isLessonPlanEditable(plan) : false;
    renderBuilder(container, { plan, loadError, collapsedActivityIds, saveIndicatorElement: saveIndicator.element, editable, classroom, isConceptPickerOpen, expandedConceptUnitId }, {
      onBack,
      editable,
      onSubmitForReview: submitForReview,

      // ---- Context ----
      onTopicChange: (value) => {
        lessonPlanService.updateContext(plan, { topic: value });
        persistOnly();
      },
      onGradeLabelChange: (value) => {
        lessonPlanService.updateContext(plan, { gradeLabel: value });
        persistOnly();
      },
      onSubjectChangeForConcepts: (subjectId) => {
        // Changing Subject clears any previously-picked Concepts — a
        // Concept belongs to exactly one Subject's tree (see
        // learningRecordService.js's own Subject -> Unit -> Concept
        // shape), so a stale conceptId from the old Subject would be
        // meaningless once the tree it came from is no longer in view.
        lessonPlanService.updateContext(plan, { subjectId: subjectId || null, conceptIds: [] });
        expandedConceptUnitId = null;
        persistAndRerender();
      },
      onToggleConceptPickerOpen: () => {
        isConceptPickerOpen = !isConceptPickerOpen;
        rerender(); // local UI state only — nothing to persist
      },
      onToggleConceptUnit: (unitId) => {
        expandedConceptUnitId = expandedConceptUnitId === unitId ? null : unitId;
        rerender(); // local UI state only — nothing to persist
      },
      onToggleConcept: (conceptId) => {
        const current = plan.conceptIds;
        const next = current.includes(conceptId) ? current.filter((id) => id !== conceptId) : [...current, conceptId];
        lessonPlanService.updateContext(plan, { conceptIds: next });
        persistAndRerender();
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
      onOpenBigQuestionPicker: () => {
        openTeachingIdeasPickerModal({
          concepts: getPlanConceptsForPicker(),
          gradeLabel: plan.gradeLabel,
          subjectId: plan.subjectId,
          elementTypeFilter: 'question',
          onCopyElement: (element) => {
            lessonPlanService.applyQuestionFromTeachingIdea(plan, 'bigQuestion', element.content, { sourceLessonPlanId: element.sourceLessonPlanId });
            persistAndRerender();
          },
        });
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
      onOpenAssessmentPicker: () => {
        openTeachingIdeasPickerModal({
          concepts: getPlanConceptsForPicker(),
          gradeLabel: plan.gradeLabel,
          subjectId: plan.subjectId,
          elementTypeFilter: 'assessment',
          onCopyElement: (element) => {
            lessonPlanService.addAssessmentItemFromTeachingIdea(plan, element.content, { sourceLessonPlanId: element.sourceLessonPlanId });
            persistAndRerender();
          },
        });
      },

      // ---- 4. FUN, FAST, EFFECTIVE — Spark ----
      onSparkChange: (field, value) => {
        lessonPlanService.updateSpark(plan, { [field]: value });
        persistOnly();
      },
      onOpenSparkPicker: () => {
        openTeachingIdeasPickerModal({
          concepts: getPlanConceptsForPicker(),
          gradeLabel: plan.gradeLabel,
          subjectId: plan.subjectId,
          elementTypeFilter: 'spark',
          onCopyElement: (element) => {
            lessonPlanService.applySparkFromTeachingIdea(plan, element.content, { sourceLessonPlanId: element.sourceLessonPlanId });
            persistAndRerender();
          },
        });
      },

      // ---- 4. FUN, FAST, EFFECTIVE — Activities ----
      onAddActivity: () => {
        const activity = lessonPlanService.addActivity(plan);
        collapsedActivityIds.delete(activity.id); // a brand-new Activity always opens expanded
        persistAndRerender();
      },
      onOpenActivityPicker: () => {
        openTeachingIdeasPickerModal({
          concepts: getPlanConceptsForPicker(),
          gradeLabel: plan.gradeLabel,
          subjectId: plan.subjectId,
          elementTypeFilter: 'activity',
          onCopyElement: (element) => {
            const activity = lessonPlanService.addActivityFromTeachingIdea(plan, element.content, {
              sourceLessonPlanId: element.sourceLessonPlanId,
              sourceActivityId: element.sourceActivityId,
            });
            collapsedActivityIds.delete(activity.id);
            persistAndRerender();
          },
        });
      },
      onOpenDifferentiationPicker: (activityId, bucket) => {
        openTeachingIdeasPickerModal({
          concepts: getPlanConceptsForPicker(),
          gradeLabel: plan.gradeLabel,
          subjectId: plan.subjectId,
          elementTypeFilter: 'differentiation',
          onCopyElement: (element) => {
            lessonPlanService.applyDifferentiationBucketFromTeachingIdea(plan, activityId, bucket, element.content, {
              sourceLessonPlanId: element.sourceLessonPlanId,
              sourceActivityId: element.sourceActivityId,
            });
            persistAndRerender();
          },
        });
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
      onOpenFinalQuestionPicker: () => {
        openTeachingIdeasPickerModal({
          concepts: getPlanConceptsForPicker(),
          gradeLabel: plan.gradeLabel,
          subjectId: plan.subjectId,
          elementTypeFilter: 'question',
          onCopyElement: (element) => {
            lessonPlanService.applyQuestionFromTeachingIdea(plan, 'finalQuestion', element.content, { sourceLessonPlanId: element.sourceLessonPlanId });
            persistAndRerender();
          },
        });
      },
    });
  }

  function getPlanConceptsForPicker() {
    return plan.conceptIds
      .map((conceptId) => learningRecordService.getConceptById(classroom, conceptId))
      .filter(Boolean)
      .map((concept) => ({ id: concept.id, title: concept.title }));
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
  wrapper.appendChild(renderConceptsField(plan, state.classroom, state, handlers));
  wrapper.appendChild(renderReadinessPanel(plan, handlers));

  wrapper.appendChild(
    renderSection('1. Why are students learning this?', [renderWhySection(plan, handlers)], plan, LESSON_PLAN_SECTION_KEYS.WHY)
  );
  wrapper.appendChild(
    renderSection('2. Will it advance Self, Others, and India?', [renderSelfOthersIndiaSection(plan, handlers)], plan, LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA)
  );
  wrapper.appendChild(
    renderSection('3. Are students showcasing their learning?', [renderAssessmentSection(plan, handlers)], plan, LESSON_PLAN_SECTION_KEYS.ASSESSMENT)
  );
  wrapper.appendChild(
    renderSection('4. Is it fun, fast, and effective?', [
      renderSparkSection(plan, handlers),
      renderActivitiesSection(plan, state.collapsedActivityIds, handlers),
    ], plan, LESSON_PLAN_SECTION_KEYS.SPARK)
  );
  wrapper.appendChild(
    renderSection('5. Are students helping me and each other learn?', [renderHelpingEachOtherLearnSection(plan, handlers)], plan, null)
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
  topicInput.disabled = !handlers.editable;
  topicInput.addEventListener('change', () => handlers.onTopicChange(topicInput.value));
  topLine.appendChild(topicInput);

  const statusBadge = document.createElement('span');
  statusBadge.className = `lesson-plan-builder__status-badge lesson-plan-builder__status-badge--${plan.status}`;
  statusBadge.textContent = STATUS_LABELS[plan.status] || plan.status;
  topLine.appendChild(statusBadge);

  titleBar.appendChild(topLine);

  const statusMessage = document.createElement('p');
  statusMessage.className = 'lesson-plan-builder__status-message';
  statusMessage.textContent = getStatusMessage(plan);
  titleBar.appendChild(statusMessage);

  const metaLine = document.createElement('div');
  metaLine.className = 'lesson-plan-builder__meta-line';

  const gradeInput = document.createElement('input');
  gradeInput.type = 'text';
  gradeInput.className = 'lesson-plan-builder__grade-input';
  gradeInput.placeholder = 'Grade (e.g. Grade 8)';
  gradeInput.value = plan.gradeLabel;
  gradeInput.disabled = !handlers.editable;
  gradeInput.addEventListener('change', () => handlers.onGradeLabelChange(gradeInput.value));
  metaLine.appendChild(gradeInput);

  metaLine.appendChild(saveIndicatorElement);

  titleBar.appendChild(metaLine);

  return titleBar;
}

/**
 * Concept picker (Phase 4) — Subject first (a Concept belongs to
 * exactly one Subject's tree), then a multi-select Curriculum Explorer
 * scoped to that Subject's own Units. Reuses
 * ui/components/CurriculumExplorerPanel.js exactly as-is rather than a
 * new picker, per explicit product direction — this is that shared
 * component's own already-designed `onClick`-per-concept interactive
 * mode, just its first real caller (every existing caller today uses
 * it read-only). A concept is "selected" by being present in
 * `plan.conceptIds`; clicking a concept again removes it — the panel
 * itself has no built-in "selected" visual state, so a selected
 * concept's title is prefixed with a checkmark here instead of forking
 * the shared component for one new CSS class.
 *
 * Deliberately NOT gated by `handlers.editable` the same way every
 * other field in this view is — per explicit product direction,
 * concept selection stays available while building even on... no,
 * actually: this DOES still respect the same SUBMITTED/APPROVED lock
 * as everything else (a locked plan shouldn't let you change its
 * concepts either), it just never blocks *starting* a lesson without
 * one — that's lessonPlanValidationService.js's own submit-time gate,
 * not a Builder restriction.
 */
function renderConceptsField(plan, classroom, state, handlers) {
  const field = document.createElement('div');
  field.className = 'lesson-plan-builder__concepts-field';

  const label = document.createElement('label');
  label.className = 'lesson-plan-builder__field-label';
  label.textContent = 'Concepts';
  field.appendChild(label);

  const subjectRow = document.createElement('div');
  subjectRow.className = 'lesson-plan-builder__concepts-subject-row';

  const subjectSelect = document.createElement('select');
  subjectSelect.className = 'lesson-plan-builder__concepts-subject-select';
  subjectSelect.disabled = !handlers.editable;
  const subjects = learningRecordService.getSubjects(classroom);

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = subjects.length === 0 ? 'No subjects set up yet' : 'Choose a subject…';
  subjectSelect.appendChild(placeholderOption);
  subjects.forEach((subject) => {
    const option = document.createElement('option');
    option.value = subject.id;
    option.textContent = subject.title;
    if (subject.id === plan.subjectId) option.selected = true;
    subjectSelect.appendChild(option);
  });
  subjectSelect.addEventListener('change', () => handlers.onSubjectChangeForConcepts(subjectSelect.value));
  subjectRow.appendChild(subjectSelect);

  const selectedSubject = plan.subjectId ? subjects.find((subject) => subject.id === plan.subjectId) : null;

  if (handlers.editable && selectedSubject) {
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'btn btn--ghost lesson-plan-builder__concepts-toggle-button';
    toggleButton.textContent = state.isConceptPickerOpen ? 'Done' : '+ Choose Concepts';
    toggleButton.addEventListener('click', handlers.onToggleConceptPickerOpen);
    subjectRow.appendChild(toggleButton);
  }

  field.appendChild(subjectRow);

  const chips = document.createElement('div');
  chips.className = 'lesson-plan-builder__concept-chips';
  if (plan.conceptIds.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'lesson-plan-builder__concept-chips-empty';
    empty.textContent = 'No concepts selected yet.';
    chips.appendChild(empty);
  } else {
    plan.conceptIds.forEach((conceptId) => {
      const concept = learningRecordService.getConceptById(classroom, conceptId);
      const chip = document.createElement('span');
      chip.className = 'lesson-plan-builder__concept-chip';
      const chipLabel = document.createElement('span');
      chipLabel.textContent = concept?.title || 'Unknown concept';
      chip.appendChild(chipLabel);
      if (handlers.editable) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn btn--icon-only lesson-plan-builder__concept-chip-remove';
        removeButton.setAttribute('aria-label', `Remove ${concept?.title || 'concept'}`);
        removeButton.appendChild(createIcon('x', { size: 12 }));
        removeButton.addEventListener('click', () => handlers.onToggleConcept(conceptId));
        chip.appendChild(removeButton);
      }
      chips.appendChild(chip);
    });
  }
  field.appendChild(chips);

  if (handlers.editable && selectedSubject && state.isConceptPickerOpen) {
    const units = selectedSubject.units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      concepts: unit.concepts.map((concept) => ({
        id: concept.id,
        title: plan.conceptIds.includes(concept.id) ? `✓ ${concept.title}` : concept.title,
        onClick: () => handlers.onToggleConcept(concept.id),
      })),
    }));

    if (units.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'lesson-plan-builder__concepts-empty-message';
      empty.textContent = 'No units set up yet for this subject in Learning Management.';
      field.appendChild(empty);
    } else {
      field.appendChild(
        createCurriculumExplorerPanel({
          units,
          expandedUnitId: state.expandedConceptUnitId,
          onToggleUnit: handlers.onToggleConceptUnit,
        })
      );
    }
  }

  return field;
}

/**
 * Deliberately the ONE place "ready to submit" and "submit" live
 * together — per this feature's own product direction, submitting is
 * the readiness checklist's own final step, never a separate screen or
 * a button bolted on somewhere else. Only rendered as an ACTION at all
 * when the plan is actually editable (DRAFT/CHANGES_REQUESTED); a
 * SUBMITTED/APPROVED plan's readiness is always "ready" by construction
 * (it couldn't have been submitted otherwise) and has nothing left to
 * offer here — renderTitleBar's own status message covers that case.
 */
function renderReadinessPanel(plan, handlers) {
  // Not editable (SUBMITTED/APPROVED) — nothing actionable left to show
  // here; renderTitleBar's own status message already covers "what's
  // happening right now" for those two statuses.
  if (!handlers.editable) return document.createComment('lesson plan locked — no readiness action to show');

  const readiness = getLessonPlanReadiness(plan);
  const panel = document.createElement('div');
  panel.className = readiness.ready
    ? 'lesson-plan-builder__readiness lesson-plan-builder__readiness--ready'
    : 'lesson-plan-builder__readiness lesson-plan-builder__readiness--pending';

  if (readiness.ready) {
    panel.appendChild(createIcon('check-circle-2', { size: 16 }));
    const text = document.createElement('span');
    text.textContent = plan.status === LESSON_PLAN_STATUS.CHANGES_REQUESTED ? 'Ready to resubmit.' : 'Ready for review.';
    panel.appendChild(text);

    const submitButton = document.createElement('button');
    submitButton.type = 'button';
    submitButton.className = 'btn btn--primary lesson-plan-builder__submit-button';
    submitButton.textContent = plan.status === LESSON_PLAN_STATUS.CHANGES_REQUESTED ? 'Resubmit for Review' : 'Submit for Review';
    submitButton.addEventListener('click', handlers.onSubmitForReview);
    panel.appendChild(submitButton);

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

function renderSection(heading, children, plan, sectionKey) {
  const section = document.createElement('section');
  section.className = 'lesson-plan-builder__section';

  const headingEl = document.createElement('h2');
  headingEl.className = 'lesson-plan-builder__section-heading';
  headingEl.textContent = heading;
  section.appendChild(headingEl);

  children.forEach((child) => section.appendChild(child));

  // Section-level reviewer comments (WHY/SELF·OTHERS·INDIA/ASSESSMENT/
  // SPARK each have exactly one LESSON_PLAN_SECTION_KEYS entry covering
  // the whole section — matching that existing granularity, not a new
  // one). Section 5's own three fields are each addressed individually
  // instead (see createLabeledTextarea's own sectionKey param) since
  // they have three separate keys of their own; this call site passes
  // `null` for that section for exactly that reason.
  if (sectionKey && plan) {
    const comments = renderCommentsList(plan, sectionKey);
    if (comments) section.appendChild(comments);
  }

  return section;
}

function createLabeledTextarea({ label, placeholder, value, onChange, disabled = false, plan = null, sectionKey = null }) {
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
  textarea.disabled = disabled;
  textarea.addEventListener('change', () => onChange(textarea.value));
  field.appendChild(textarea);

  if (plan && sectionKey) {
    const comments = renderCommentsList(plan, sectionKey);
    if (comments) field.appendChild(comments);
  }

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
      disabled: !handlers.editable,
    })
  );

  const bigQuestionField = createLabeledTextarea({
    label: 'Big Question',
    placeholder: 'The one question this whole lesson is trying to answer',
    value: plan.bigQuestion,
    onChange: handlers.onBigQuestionChange,
    disabled: !handlers.editable,
  });
  if (handlers.editable) bigQuestionField.appendChild(createFromTeachingIdeasButton(handlers.onOpenBigQuestionPicker));
  wrap.appendChild(bigQuestionField);

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
        disabled: !handlers.editable,
      })
    );
  });

  if (handlers.editable) swbatField.appendChild(createAddRowButton('+ Add SWBAT objective', handlers.onAddSwbat));
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
        disabled: !handlers.editable,
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
        disabled: !handlers.editable,
      })
    );
  });

  if (handlers.editable) {
    wrap.appendChild(createAddRowButton('+ Add assessment / evidence item', handlers.onAddAssessment));
    wrap.appendChild(createFromTeachingIdeasButton(handlers.onOpenAssessmentPicker));
  }

  return wrap;
}

// ---- Shared: a dynamic list row / add-row button ---------------------

function createDynamicListRow({ value, placeholder, onChange, onRemove, disabled = false }) {
  const row = document.createElement('div');
  row.className = 'lesson-plan-builder__dynamic-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lesson-plan-builder__dynamic-input';
  input.placeholder = placeholder;
  input.value = value;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.value));
  row.appendChild(input);

  if (!disabled) {
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--icon-only lesson-plan-builder__dynamic-remove';
    removeButton.setAttribute('aria-label', 'Remove');
    removeButton.appendChild(createIcon('x', { size: 14 }));
    removeButton.addEventListener('click', onRemove);
    row.appendChild(removeButton);
  }

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

/** Phase 4 — the "+ From Teaching Ideas" affordance, same visual weight as createAddRowButton() above, used everywhere a teacher can browse/copy in reusable content instead of writing it by hand. */
function createFromTeachingIdeasButton(onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--text lesson-plan-builder__from-teaching-ideas-button';
  button.appendChild(createIcon('search', { size: 12 }));
  button.append(' From Teaching Ideas');
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

  if (handlers.editable) wrap.appendChild(createFromTeachingIdeasButton(handlers.onOpenSparkPicker));

  const titleField = document.createElement('div');
  titleField.className = 'lesson-plan-builder__field';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'lesson-plan-builder__dynamic-input';
  titleInput.placeholder = 'Spark title (e.g. Mystery Object)';
  titleInput.value = plan.spark.title;
  titleInput.disabled = !handlers.editable;
  titleInput.addEventListener('change', () => handlers.onSparkChange('title', titleInput.value));
  titleField.appendChild(titleInput);
  wrap.appendChild(titleField);

  wrap.appendChild(
    createLabeledTextarea({
      label: 'Teacher Action',
      placeholder: 'What does the teacher do?',
      value: plan.spark.teacherAction,
      onChange: (value) => handlers.onSparkChange('teacherAction', value),
      disabled: !handlers.editable,
    })
  );
  wrap.appendChild(
    createLabeledTextarea({
      label: 'Student Action',
      placeholder: 'What do students do?',
      value: plan.spark.studentAction,
      onChange: (value) => handlers.onSparkChange('studentAction', value),
      disabled: !handlers.editable,
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
      renderActivityCard(plan, activity, index, plan.activities.length, collapsedActivityIds.has(activity.id), handlers)
    );
  });

  if (handlers.editable) {
    const addButtonRow = document.createElement('div');
    addButtonRow.className = 'lesson-plan-builder__add-activity-row';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--primary lesson-plan-builder__add-activity-button';
    addButton.appendChild(createIcon('plus', { size: 16 }));
    addButton.append(' New Activity');
    addButton.addEventListener('click', handlers.onAddActivity);
    addButtonRow.appendChild(addButton);

    const fromTeachingIdeasButton = document.createElement('button');
    fromTeachingIdeasButton.type = 'button';
    fromTeachingIdeasButton.className = 'btn btn--secondary lesson-plan-builder__add-activity-button';
    fromTeachingIdeasButton.appendChild(createIcon('search', { size: 14 }));
    fromTeachingIdeasButton.append(' From Teaching Ideas');
    fromTeachingIdeasButton.addEventListener('click', handlers.onOpenActivityPicker);
    addButtonRow.appendChild(fromTeachingIdeasButton);

    wrap.appendChild(addButtonRow);
  }

  return wrap;
}

function renderActivityCard(plan, activity, index, total, isCollapsed, handlers) {
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
  titleInput.disabled = !handlers.editable;
  titleInput.addEventListener('change', () => handlers.onActivityChange(activity.id, 'title', titleInput.value));
  cardHeader.appendChild(titleInput);

  const actions = document.createElement('div');
  actions.className = 'lesson-plan-builder__activity-actions';

  if (handlers.editable) {
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
  }

  cardHeader.appendChild(actions);
  card.appendChild(cardHeader);

  if (!isCollapsed) {
    const body = document.createElement('div');
    body.className = 'lesson-plan-builder__activity-body';

    const wholeActivityComments = renderCommentsList(plan, lessonPlanReviewService.buildActivitySectionKey(activity.id));
    if (wholeActivityComments) body.appendChild(wholeActivityComments);

    body.appendChild(
      createLabeledTextarea({
        label: 'Teacher Action',
        placeholder: 'What does the teacher do?',
        value: activity.teacherAction,
        onChange: (value) => handlers.onActivityChange(activity.id, 'teacherAction', value),
        disabled: !handlers.editable,
        plan,
        sectionKey: lessonPlanReviewService.buildActivitySectionKey(activity.id, 'teacherAction'),
      })
    );
    body.appendChild(
      createLabeledTextarea({
        label: 'Student Action',
        placeholder: 'What do students do?',
        value: activity.studentAction,
        onChange: (value) => handlers.onActivityChange(activity.id, 'studentAction', value),
        disabled: !handlers.editable,
        plan,
        sectionKey: lessonPlanReviewService.buildActivitySectionKey(activity.id, 'studentAction'),
      })
    );

    if (activity.differentiation) {
      body.appendChild(renderDifferentiationFields(plan, activity, handlers));
    } else if (handlers.editable) {
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

function renderDifferentiationFields(plan, activity, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__differentiation';

  const heading = document.createElement('div');
  heading.className = 'lesson-plan-builder__differentiation-heading';
  const headingText = document.createElement('span');
  headingText.textContent = 'Differentiation';
  heading.appendChild(headingText);

  if (handlers.editable) {
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text btn--danger-text';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => handlers.onRemoveActivityDifferentiation(activity.id));
    heading.appendChild(removeButton);
  }

  wrap.appendChild(heading);

  [
    { field: 'redBucket', label: 'Red Bucket', placeholder: 'Extra support' },
    { field: 'greenBucket', label: 'Green Bucket', placeholder: 'Extra stretch' },
    { field: 'others', label: 'Others', placeholder: 'Any other differentiation' },
  ].forEach(({ field, label, placeholder }) => {
    const bucketField = createLabeledTextarea({
      label,
      placeholder,
      value: activity.differentiation[field],
      onChange: (value) => handlers.onActivityDifferentiationChange(activity.id, field, value),
      disabled: !handlers.editable,
      plan,
      sectionKey: lessonPlanReviewService.buildActivitySectionKey(activity.id, `differentiation.${field}`),
    });
    if (handlers.editable) {
      bucketField.appendChild(createFromTeachingIdeasButton(() => handlers.onOpenDifferentiationPicker(activity.id, field)));
    }
    wrap.appendChild(bucketField);
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
      disabled: !handlers.editable,
      plan,
      sectionKey: LESSON_PLAN_SECTION_KEYS.PAIR_EXPLANATION,
    })
  );
  const finalQuestionField = createLabeledTextarea({
    label: 'Final Question',
    placeholder: 'One closing question to check understanding',
    value: plan.finalQuestion,
    onChange: (value) => handlers.onHelpingEachOtherLearnChange('finalQuestion', value),
    disabled: !handlers.editable,
    plan,
    sectionKey: LESSON_PLAN_SECTION_KEYS.FINAL_QUESTION,
  });
  if (handlers.editable) finalQuestionField.appendChild(createFromTeachingIdeasButton(handlers.onOpenFinalQuestionPicker));
  wrap.appendChild(finalQuestionField);
  wrap.appendChild(
    createLabeledTextarea({
      label: "Teacher Look-Fors",
      placeholder: 'What will you look/listen for as students work?',
      value: plan.teacherLookFors,
      onChange: (value) => handlers.onHelpingEachOtherLearnChange('teacherLookFors', value),
      disabled: !handlers.editable,
      plan,
      sectionKey: LESSON_PLAN_SECTION_KEYS.TEACHER_LOOK_FORS,
    })
  );

  return wrap;
}
