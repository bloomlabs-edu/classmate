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
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as timetableService from '../../services/timetableService.js';
import * as timetableDisplayService from '../../services/timetableDisplayService.js';
import * as personalHubService from '../../services/personalHubService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { getGradeLabelForClassroom } from '../../services/classroomService.js';
import { getTodayDateKey } from '../../utils/dateHelpers.js';
import { LESSON_PLAN_STATUS, LESSON_PLAN_SECTION_KEYS } from '../../models/LessonPlan.js';
import { getLessonPlanReadiness, getLessonPlanStageCompletion, LESSON_PLAN_STAGES } from '../../services/lessonPlanValidationService.js';
import { getTimetableSubjectColor, getTimetableSubjectWash } from '../../config/timetableSubjectColors.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { createCurriculumExplorerPanel } from '../components/CurriculumExplorerPanel.js';
import { openTeachingIdeasPickerModal } from '../components/TeachingIdeasPickerModal.js';
import { attachAutoGrowTextarea } from '../components/AutoGrowTextarea.js';

const STATUS_LABELS = Object.freeze({
  [LESSON_PLAN_STATUS.DRAFT]: 'Draft',
  [LESSON_PLAN_STATUS.SUBMITTED]: 'Submitted',
  [LESSON_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [LESSON_PLAN_STATUS.APPROVED]: 'Approved',
});

/**
 * `plan.subjectId` (and the tappable Subject blocks' own onClick
 * values) are a Learning-Management Subject's own RECORD id
 * (models/LearningSubject.js's `id`) — a different thing from the
 * CANONICAL subject identity (`LearningSubject.subjectId`, e.g.
 * "mathematics") every Timetable-side lookup actually keys off
 * (services/timetableService.js's slot.subjectId,
 * getNextFutureSlotForSubject(), config/timetableSubjectColors.js,
 * services/timetableDisplayService.js's resolveSubjectTitle() — see
 * that model's own doc comment for the full reasoning on why these
 * are two separate ids). Every place this view needs to match or
 * color a Subject against the Timetable resolves the real canonical
 * id via this one function first, rather than passing
 * `plan.subjectId` straight through and silently never matching
 * anything real.
 */
function resolveCanonicalSubjectId(classroom, learningSubjectId) {
  if (!learningSubjectId) return null;
  return learningRecordService.getSubjectById(classroom, learningSubjectId)?.subjectId || null;
}

/**
 * Every real concrete TeachingSlot on `dateKey` whose subject matches
 * THIS plan's own Subject — never every period the classroom happens
 * to teach that day (see this file's own header comment on
 * subject-first scheduling). Falls back to every slot that day,
 * unfiltered, only when this plan's Subject has no resolvable
 * canonical id at all (e.g. a legacy classroom whose one-time
 * subjectId backfill — see services/subjectIdMigrationService.js —
 * hasn't run yet this session): showing nothing at all in that edge
 * case would look like the classroom has no timetable, which isn't
 * true.
 */
function getRelevantScheduleSlots(classroom, plan, dateKey) {
  const allSlots = timetableService.getConcreteSlotsForDateRange(classroom, dateKey, dateKey);
  const canonicalSubjectId = resolveCanonicalSubjectId(classroom, plan.subjectId);
  if (!canonicalSubjectId) return allSlots;
  return allSlots.filter((slot) => slot.subjectId === canonicalSubjectId);
}

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
  let isSchedulePickerOpen = false; // local UI state only — never persisted
  let pendingScheduleDate = null; // the date picked but not yet resolved to a period (set only while isSchedulePickerOpen)
  // Guided-building UI (progressive disclosure) — which already-COMPLETE
  // stage the teacher has manually reopened for editing, or null when
  // none is. One of LESSON_PLAN_STAGES's own values, or 'subject' (the
  // one guided stage that isn't gated by submission readiness at all —
  // see services/lessonPlanValidationService.js's own
  // getLessonPlanStageCompletion() doc comment for why Subject/Schedule
  // aren't part of that list). Purely local UI state, never persisted:
  // reopening a completed stage to look at/edit it again is not itself
  // a content change.
  let reopenedStageKey = null;
  // The guided stage that was the "current focus" as of the last real
  // render — see persistOnly() below for exactly why this is tracked.
  let lastRenderedFrontierStage = undefined;

  function computeFrontierStage() {
    if (!plan) return null;
    return getLessonPlanStageCompletion(plan).find((entry) => !entry.complete)?.stage || null;
  }

  function persistAndRerender() {
    saveIndicator.persistPatch(() => lessonPlanRepository.saveLessonPlan(classroom.id, plan));
    rerender();
  }

  /**
   * For a plain content edit (a field's text changed, nothing added/
   * removed/reordered) — persists, then either refreshes only the
   * readiness panel or does a real rerender(), depending on whether
   * THIS edit just changed which guided stage is the current focus.
   *
   * The "only refresh readiness" fast path is what fixes a real
   * click-swallowing race: every field here fires on `change` (blur),
   * so clicking any action button elsewhere starts with a blur on
   * whatever field the teacher was just typing in. If that blur
   * triggered a full `container.innerHTML = ''` rebuild on EVERY
   * keystroke's blur, the button being clicked would be destroyed and
   * replaced mid-click — a browser only fires `click` when mousedown
   * and mouseup land on the SAME element, so the click would silently
   * do nothing.
   *
   * But the guided-building redesign means a content edit CAN change
   * what's on screen after all: finishing the one field that made a
   * stage complete must reveal the next stage and collapse this one —
   * exactly the "next meaningful task is revealed naturally" behavior
   * this whole redesign exists for. Comparing the frontier stage
   * before/after is what tells these two cases apart: most edits
   * (typing the 2nd/3rd word of an already-in-progress field) don't
   * change it, and stay on the fast, race-safe path; the one edit that
   * completes a stage does, and gets a real rerender() — by then the
   * teacher's own next click hasn't happened yet, so there's nothing
   * to swallow.
   */
  function persistOnly() {
    saveIndicator.persistPatch(() => lessonPlanRepository.saveLessonPlan(classroom.id, plan));
    if (computeFrontierStage() !== lastRenderedFrontierStage) {
      rerender();
    } else {
      refreshReadinessPanel();
    }
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
    lastRenderedFrontierStage = computeFrontierStage();
    renderBuilder(container, { plan, loadError, collapsedActivityIds, saveIndicatorElement: saveIndicator.element, editable, classroom, isConceptPickerOpen, expandedConceptUnitId, isSchedulePickerOpen, pendingScheduleDate, reopenedStageKey }, {
      onBack,
      editable,
      onSubmitForReview: submitForReview,

      // ---- Context ----
      onTopicChange: (value) => {
        lessonPlanService.updateContext(plan, { topic: value });
        persistOnly();
      },
      onSelectSubject: (learningSubjectId) => {
        // Changing Subject clears any previously-picked Concepts — a
        // Concept belongs to exactly one Subject's tree (see
        // learningRecordService.js's own Subject -> Unit -> Concept
        // shape), so a stale conceptId from the old Subject would be
        // meaningless once the tree it came from is no longer in view.
        lessonPlanService.updateContext(plan, { subjectId: learningSubjectId || null, conceptIds: [] });
        expandedConceptUnitId = null;
        reopenedStageKey = null; // selecting a subject always re-collapses it, whether this was the first pick or a reopened "Change"

        // New-lesson-plan default: once a real Subject is known for the
        // FIRST time (this plan has never had a schedule of its own —
        // never overridden by picking/changing Subject again later),
        // default the schedule to the next real Timetable occurrence of
        // that subject. Reuses the exact same bounded forward-scan
        // ui/views/TimetableView.js's own Carry Forward suggestions
        // already use (services/timetableService.js's
        // getNextFutureSlotForSubject()) — not a second search. Never
        // invents a subject or a schedule: if there's no future
        // occurrence configured at all, this plan simply stays
        // unscheduled, exactly as it already does today.
        //
        // IMPORTANT: getNextFutureSlotForSubject() (like every other
        // Timetable-side lookup) matches against the CANONICAL subject
        // identity (services/subjectIdentityService.js — e.g.
        // "mathematics"), never a Learning-Management Subject's own
        // record id (`learningSubjectId` above, a generated id local to
        // this classroom's syllabus tree — see models/LearningSubject.js's
        // own doc comment on why those are two different things). This
        // resolves the real canonical id via the Subject record itself
        // before ever touching timetableService — passing
        // `learningSubjectId` straight through here would silently
        // never match any real Timetable slot.
        const canonicalSubjectId = resolveCanonicalSubjectId(classroom, learningSubjectId);
        if (canonicalSubjectId && !plan.scheduledDate) {
          const suggestion = timetableService.getNextFutureSlotForSubject(classroom, {
            subjectId: canonicalSubjectId,
            afterDateKey: getTodayDateKey(),
            afterPeriodNumber: 0,
          });
          if (suggestion) {
            lessonPlanService.updateSchedule(plan, { scheduledDate: suggestion.date, scheduledPeriodNumber: suggestion.periodNumber });
          }
        }

        persistAndRerender();
      },
      onToggleReopenStage: (stageKey) => {
        reopenedStageKey = reopenedStageKey === stageKey ? null : stageKey;
        rerender(); // local UI state only — nothing to persist
      },
      // ---- Schedule ----
      onToggleSchedulePickerOpen: () => {
        isSchedulePickerOpen = !isSchedulePickerOpen;
        // Seeds the picker with whatever's already scheduled (so
        // reopening it to change the date shows the real current
        // value, not a blank field) — cleared again on close so a
        // cancelled picker never leaves stray local state behind.
        pendingScheduleDate = isSchedulePickerOpen ? plan.scheduledDate : null;
        rerender(); // local UI state only — nothing to persist
      },
      onScheduleDateChange: (dateKey) => {
        pendingScheduleDate = dateKey || null;
        // Subject-first filtering (see this file's own header comment
        // and getRelevantScheduleSlots() below): only THIS plan's own
        // Subject's periods count here, never every period the
        // classroom happens to teach that day. Exactly one relevant
        // period -> resolve immediately, no separate period step the
        // teacher has to also click through. Multiple (or zero) ->
        // renderSchedulePicker's own tappable period blocks (or the
        // "no matching period" note) take over and wait for
        // onSchedulePeriodChange below.
        if (pendingScheduleDate) {
          const relevantSlots = getRelevantScheduleSlots(classroom, plan, pendingScheduleDate);
          if (relevantSlots.length === 1) {
            lessonPlanService.updateSchedule(plan, { scheduledDate: pendingScheduleDate, scheduledPeriodNumber: relevantSlots[0].periodNumber });
            isSchedulePickerOpen = false;
            pendingScheduleDate = null;
            persistAndRerender();
            return;
          }
        }
        rerender(); // local UI state only (date chosen, period still pending, or cleared) — nothing to persist yet
      },
      onSchedulePeriodChange: (periodNumber) => {
        lessonPlanService.updateSchedule(plan, { scheduledDate: pendingScheduleDate, scheduledPeriodNumber: periodNumber });
        isSchedulePickerOpen = false;
        pendingScheduleDate = null;
        persistAndRerender();
      },
      onClearSchedule: () => {
        lessonPlanService.updateSchedule(plan, { scheduledDate: null, scheduledPeriodNumber: null });
        isSchedulePickerOpen = false;
        pendingScheduleDate = null;
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
      /**
       * "+ Add concept" (see ui/components/CurriculumExplorerPanel.js's
       * own onAddConcept doc comment) — a teacher typing a concept
       * that isn't in the displayed curriculum list yet. Reuses
       * services/learningRecordTeacherService.js's own createConcept(),
       * the exact same mutation Learning Management's syllabus editor
       * and ui/views/TimetableView.js's own inline concept-create flow
       * already use — never a second, parallel concept system. A
       * concept lives on the CLASSROOM (learningRecord), not on this
       * plan, so it's persisted via workspaceService.save(classroom)
       * (same two-write shape as TimetableView.js's own
       * createAndAssignConcept()); a defensive case-insensitive
       * title match against this unit's existing concepts guards
       * against ever creating a visible duplicate. The new concept is
       * then immediately selected onto THIS plan's own conceptIds and
       * persisted the normal way, so it shows up among the selected
       * lesson concepts right away, not just in the library.
       */
      onAddConcept: (unitId, title) => {
        const unit = learningRecordService.getUnitById(classroom, unitId);
        if (!unit) return;
        const existing = unit.concepts.find((concept) => concept.title.trim().toLowerCase() === title.trim().toLowerCase());
        const concept = existing || learningRecordTeacherService.createConcept(classroom, unitId, { title });
        if (!existing) workspaceService.save(classroom);
        if (!plan.conceptIds.includes(concept.id)) {
          lessonPlanService.updateContext(plan, { conceptIds: [...plan.conceptIds, concept.id] });
        }
        persistAndRerender();
      },

      // ---- 1. WHY ----
      onAddObjective: () => {
        lessonPlanService.addObjective(plan, '');
        persistAndRerender();
      },
      onObjectiveChange: (objectiveId, value) => {
        lessonPlanService.updateObjective(plan, objectiveId, value);
        persistOnly();
      },
      onRemoveObjective: (objectiveId) => {
        lessonPlanService.removeObjective(plan, objectiveId);
        persistAndRerender();
      },
      onMoveObjectiveUp: (objectiveId) => {
        lessonPlanService.moveObjectiveUp(plan, objectiveId);
        persistAndRerender();
      },
      onMoveObjectiveDown: (objectiveId) => {
        lessonPlanService.moveObjectiveDown(plan, objectiveId);
        persistAndRerender();
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
        const isEditable = lessonPlanReviewService.isLessonPlanEditable(plan);

        // Grade comes from classroom context, never typed by hand (see
        // this file's own renderTitleBar() and classroomService.js's
        // own getGradeLabelForClassroom() doc comment). New plans
        // already get this at creation time
        // (ui/views/LessonPlansListView.js) — this is a one-time
        // self-heal for a plan that predates that, or somehow still
        // has none, so the stored field is never left silently blank
        // just because the editable input is gone.
        if (!plan.gradeLabel && isEditable) {
          lessonPlanService.updateContext(plan, { gradeLabel: getGradeLabelForClassroom(classroom) });
          lessonPlanRepository.saveLessonPlan(classroom.id, plan).catch((error) => {
            console.error('[LessonPlanBuilderView] Failed to self-heal gradeLabel:', error);
          });
        }

        // Objectives — one-time, lossless migration from this plan's
        // own PRE-Objectives shape (see
        // lessonPlanService.migrateLegacyObjectives()'s own doc
        // comment). Always computed in memory (a locked SUBMITTED/
        // APPROVED plan still needs to render its real historical
        // objectives correctly), but only persisted back when this
        // plan can actually still be written to — never rewrites a
        // locked plan's own stored document.
        const migratedObjectives = lessonPlanService.migrateLegacyObjectives(plan);
        if (migratedObjectives && isEditable) {
          lessonPlanRepository.saveLessonPlan(classroom.id, plan).catch((error) => {
            console.error('[LessonPlanBuilderView] Failed to self-heal legacy objectives migration:', error);
          });
        }
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
  const classroom = state.classroom;

  // Stage completion — the SAME submission-readiness rules
  // (services/lessonPlanValidationService.js's getLessonPlanReadiness())
  // grouped by guided stage, never a second definition of "done" (see
  // that file's own getLessonPlanStageCompletion() doc comment).
  // `frontierStage` is the first incomplete one, in guided order — the
  // one guided CONTENT stage that gets the full/primary writing
  // treatment; everything before it (already complete) compresses to a
  // compact summary, and nothing after it renders at all yet. `null`
  // once every stage is complete (nothing left to reveal — just the
  // Submit action below).
  const stageCompletion = getLessonPlanStageCompletion(plan);
  const stageCompletionByKey = Object.fromEntries(stageCompletion.map((entry) => [entry.stage, entry.complete]));
  const frontierStage = stageCompletion.find((entry) => !entry.complete)?.stage || null;
  const guidedState = { ...state, stageCompletionByKey, frontierStage };

  wrapper.appendChild(renderTitleBar(plan, stageCompletion, state, handlers));

  if (!handlers.editable) {
    // Locked (SUBMITTED/APPROVED) — a completed artifact to review now,
    // not something still being "built." Progressive disclosure is
    // deliberately a DRAFT-building UX pattern (see this file's own
    // header comment); once there's no more building happening, every
    // stage renders in full, flat, exactly as a reviewer or the
    // teacher themselves needs to see the complete real content — never
    // a partial reveal gated on a "current stage" that no longer means
    // anything once the plan is locked.
    // Order matches the real 5 Questions framework (Q1 Why -> Q2 Self/
    // Others/India -> Q3 Showcasing learning -> Q4 Fun/Fast/Effective ->
    // Q5 Helping each other learn), the same order the guided flow
    // below uses — never two different orderings for the same content.
    wrapper.appendChild(renderContextRow(plan, classroom, guidedState, handlers));
    wrapper.appendChild(renderConceptsTile(plan, classroom, guidedState, handlers));
    wrapper.appendChild(renderWhySection(plan, handlers));
    wrapper.appendChild(renderSelfOthersIndiaSection(plan, handlers));
    wrapper.appendChild(renderAssessmentSection(plan, handlers));
    wrapper.appendChild(renderSparkSection(plan, handlers));
    wrapper.appendChild(renderActivitiesSection(plan, state.collapsedActivityIds, handlers));
    wrapper.appendChild(renderPairExplanationField(plan, handlers));
    wrapper.appendChild(renderFinalQuestionAndLookForsFields(plan, handlers));
    container.appendChild(wrapper);
    return;
  }

  // Guided building — Subject always first; nothing past it renders at
  // all until it's chosen (see this file's own header comment: "SUBJECT
  // MUST COME BEFORE SCHEDULE"). Subject + Schedule are composed as a
  // single two-up "context row" (see renderContextRow()'s own doc
  // comment) — purely a wrapping/layout choice made here in the
  // orchestrator; neither section's own render function changes.
  const subjectTile = renderSubjectStage(plan, classroom, guidedState, handlers);

  if (!plan.subjectId) {
    wrapper.appendChild(subjectTile);
    container.appendChild(wrapper);
    return;
  }

  // Schedule — optional, never gates anything after it (see
  // renderScheduleSection()'s own doc comment); always shown once
  // Subject is known.
  const scheduleTile = renderScheduleSection(plan, classroom, guidedState, handlers);
  wrapper.appendChild(wrapInContextRow(subjectTile, scheduleTile));

  // CONCEPT — its own bespoke stage (chips + Curriculum Explorer, not a
  // plain textarea), always shown once Subject is known; still
  // respects the same frontier-stops-the-reveal rule as the free-text
  // stages below it. Given a stronger "tile" surface externally (see
  // wrapInConceptsTile()) since Concepts anchors everything else on
  // the page — its own render function is untouched.
  wrapper.appendChild(wrapInConceptsTile(renderConceptsField(plan, classroom, guidedState, handlers)));

  if (frontierStage === LESSON_PLAN_STAGES.CONCEPT) {
    container.appendChild(wrapper);
    return; // Concept itself is still incomplete — nothing past it yet.
  }

  // Q1-Q5 — the real "5 Questions" lesson-planning framework itself
  // (models/LessonPlan.js's own header comment), in the framework's own
  // order, each stage's title the actual question a teacher is
  // answering — never a generic "Section 4" label. Reveals up to and
  // including the current frontier stage, then stops — the next one
  // doesn't exist on screen yet.
  const freeTextStages = [
    {
      stage: LESSON_PLAN_STAGES.PURPOSE,
      title: 'Why are students learning what they are learning today?',
      sectionKey: LESSON_PLAN_SECTION_KEYS.WHY,
      renderFull: () => renderWhySection(plan, handlers),
      getPreview: () => plan.objectives.find((objective) => objective.text)?.text || plan.bigQuestion || '',
    },
    {
      stage: LESSON_PLAN_STAGES.CONNECTION,
      title: 'Will it advance self, others and India?',
      sectionKey: LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA,
      renderFull: () => renderSelfOthersIndiaSection(plan, handlers),
      getPreview: () => plan.selfOthersIndia.self || plan.selfOthersIndia.others || plan.selfOthersIndia.india || '',
      isOptional: true,
    },
    {
      stage: LESSON_PLAN_STAGES.SHOWCASE,
      title: 'Are students showcasing learning and applying the content in and beyond class?',
      sectionKey: LESSON_PLAN_SECTION_KEYS.ASSESSMENT,
      renderFull: () => renderAssessmentSection(plan, handlers),
      getPreview: () => plan.assessments.find((item) => item.description)?.description || '',
      isOptional: true,
    },
    {
      stage: LESSON_PLAN_STAGES.EXPERIENCE,
      title: 'Is it fun, fast, effective?',
      sectionKey: LESSON_PLAN_SECTION_KEYS.SPARK,
      renderFull: () => {
        const wrap = document.createElement('div');
        wrap.className = 'lesson-plan-builder__experience';
        const intro = document.createElement('p');
        intro.className = 'lesson-plan-builder__experience-intro';
        intro.textContent = 'An opportunity to make the lesson memorable — a Spark to open it, and the activities that carry it through.';
        wrap.appendChild(intro);
        wrap.appendChild(renderSparkSection(plan, handlers));
        wrap.appendChild(renderActivitiesSection(plan, state.collapsedActivityIds, handlers));
        return wrap;
      },
      getPreview: () => plan.spark.title || (plan.activities.length > 0 ? `${plan.activities.length} activit${plan.activities.length === 1 ? 'y' : 'ies'}` : ''),
    },
    {
      stage: LESSON_PLAN_STAGES.HELPING,
      title: 'Are students helping me and others learn?',
      // No single sectionKey for this stage's own outer comment list —
      // Pair Explanation / Final Question / Teacher Look-Fors each
      // already render their OWN comments inline (see
      // renderPairExplanationField()/renderFinalQuestionAndLookForsFields()),
      // so a second, stage-level list here would just duplicate them.
      sectionKey: null,
      renderFull: () => {
        const wrap = document.createElement('div');
        wrap.className = 'lesson-plan-builder__helping';
        wrap.appendChild(renderPairExplanationField(plan, handlers));
        wrap.appendChild(renderFinalQuestionAndLookForsFields(plan, handlers));
        return wrap;
      },
      getPreview: () => plan.pairExplanation || plan.finalQuestion || '',
    },
  ];

  for (const config of freeTextStages) {
    wrapper.appendChild(renderGuidedContentStage({ ...config, plan, state: guidedState, handlers }));
    if (config.stage === frontierStage) break; // stop right after the current stage — nothing beyond it yet
  }

  if (!frontierStage) {
    wrapper.appendChild(renderReadinessPanel(plan, handlers));
  }

  container.appendChild(wrapper);
}

function renderTitleBar(plan, stageCompletion, state, handlers) {
  const { saveIndicatorElement } = state;
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

  // Grade is classroom context, not something a teacher types here —
  // see classroomService.js's own getGradeLabelForClassroom() doc
  // comment and this view's own gradeLabel self-heal-on-load. Plain,
  // non-editable metadata; never a completion task (getLessonPlanReadiness()
  // never checks it).
  if (plan.gradeLabel) {
    const gradeBadge = document.createElement('span');
    gradeBadge.className = 'lesson-plan-builder__grade-badge';
    gradeBadge.textContent = plan.gradeLabel;
    metaLine.appendChild(gradeBadge);
  }

  metaLine.appendChild(saveIndicatorElement);

  titleBar.appendChild(metaLine);

  titleBar.appendChild(renderProgressBar(stageCompletion));

  return titleBar;
}

/**
 * The visual progress indicator — a quiet, segmented bar (one segment
 * per guided CONTENT stage; see services/lessonPlanValidationService.js's
 * getLessonPlanStageCompletion(), the exact same submission-readiness
 * grouping the guided flow itself uses, never a second definition of
 * "done"). Deliberately no numbers, no "N things left," no fraction
 * text anywhere — per explicit product direction, this communicates
 * "you're building something," not "you still have chores." Subject/
 * Schedule aren't part of it at all (neither is gated by submission
 * readiness — see that function's own doc comment), so a plan that's
 * only just started (Subject picked, nothing else yet) correctly shows
 * an all-quiet bar rather than looking further along than it is.
 *
 * Accessible interpretation: the bar itself carries `role="progressbar"`
 * with real `aria-valuenow`/`aria-valuemax` (segment counts) and a
 * plain-language `aria-label` — a screen reader gets an honest,
 * literal completion state even though sighted users never see a
 * number rendered on screen.
 */
function renderProgressBar(stageCompletion) {
  const completedCount = stageCompletion.filter((entry) => entry.complete).length;
  const total = stageCompletion.length;

  const bar = document.createElement('div');
  bar.className = 'lesson-plan-builder__progress-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(completedCount));
  bar.setAttribute('aria-label', `Lesson plan progress: ${completedCount} of ${total} stages complete`);

  stageCompletion.forEach((entry) => {
    const segment = document.createElement('span');
    segment.className = 'lesson-plan-builder__progress-segment' + (entry.complete ? ' lesson-plan-builder__progress-segment--complete' : '');
    bar.appendChild(segment);
  });

  return bar;
}

/**
 * Composition-only Bento helpers — purely wrap/tag DOM elements that
 * renderSubjectStage()/renderConceptsField() already return; neither
 * of those functions' own internals change. Subject + Schedule become
 * a single two-up "context row" tile pair (collapses to one column on
 * narrow screens, or whenever either child is actively being edited —
 * see the CSS `:has()` rule alongside `.lesson-plan-builder__context-row`)
 * and Concepts gets a stronger tile surface, since it's the one piece
 * of context every other stage depends on.
 */
function wrapInContextRow(subjectEl, scheduleEl) {
  const row = document.createElement('div');
  row.className = 'lesson-plan-builder__context-row';
  row.appendChild(subjectEl);
  row.appendChild(scheduleEl);
  return row;
}

function renderContextRow(plan, classroom, state, handlers) {
  return wrapInContextRow(
    renderSubjectStage(plan, classroom, state, handlers),
    renderScheduleSection(plan, classroom, state, handlers)
  );
}

function wrapInConceptsTile(conceptsEl) {
  conceptsEl.classList.add('lesson-plan-builder__stage--concepts-tile');
  return conceptsEl;
}

function renderConceptsTile(plan, classroom, state, handlers) {
  return wrapInConceptsTile(renderConceptsField(plan, classroom, state, handlers));
}

/**
 * SUBJECT — always the FIRST guided stage (see this file's own header
 * comment: Subject must be known before Schedule/Concepts can mean
 * anything real). Tappable blocks, one per Subject already configured
 * in this classroom's own Learning Management
 * (learningRecordService.getSubjects()) — never a `<select>`. Colored
 * via the exact same Timetable subject-accent convention every other
 * subject-aware surface in this app already uses
 * (config/timetableSubjectColors.js's getTimetableSubjectColor()/
 * getTimetableSubjectWash()) — never a new color system. Selection
 * (never color alone) is also shown via a checkmark icon,
 * `aria-pressed`, and a visibly different border, so it reads without
 * relying on color perception. Selecting persists immediately via the
 * existing onSelectSubject handler (services/lessonPlanService.js's
 * updateContext()) and collapses to a compact summary; clicking that
 * summary again reopens the block grid to change it.
 */
function renderSubjectStage(plan, classroom, state, handlers) {
  const subjects = learningRecordService.getSubjects(classroom);
  const selectedSubject = plan.subjectId ? subjects.find((subject) => subject.id === plan.subjectId) : null;
  const isReopened = state.reopenedStageKey === 'subject';

  const wrap = document.createElement('section');
  wrap.className = 'lesson-plan-builder__stage';

  if (selectedSubject && !isReopened) {
    wrap.classList.add('lesson-plan-builder__stage--compact');
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'lesson-plan-builder__stage-summary';
    summary.disabled = !handlers.editable;
    summary.addEventListener('click', () => handlers.onToggleReopenStage('subject'));
    summary.appendChild(createIcon('check', { size: 16, className: 'lesson-plan-builder__stage-summary-check' }));
    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-plan-builder__stage-summary-text';
    const titleEl = document.createElement('span');
    titleEl.className = 'lesson-plan-builder__stage-summary-title';
    titleEl.textContent = selectedSubject.title;
    textWrap.appendChild(titleEl);
    summary.appendChild(textWrap);
    wrap.appendChild(summary);
    return wrap;
  }

  wrap.classList.add(selectedSubject ? 'lesson-plan-builder__stage--reopened' : 'lesson-plan-builder__stage--primary');

  const headingRow = document.createElement('div');
  headingRow.className = 'lesson-plan-builder__stage-heading-row';
  const heading = document.createElement('h2');
  heading.className = selectedSubject ? 'lesson-plan-builder__stage-heading' : 'lesson-plan-builder__stage-heading lesson-plan-builder__stage-heading--primary';
  heading.textContent = 'What are you teaching?';
  headingRow.appendChild(heading);
  if (selectedSubject) {
    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'btn btn--text lesson-plan-builder__stage-collapse-button';
    doneButton.textContent = 'Done';
    doneButton.addEventListener('click', () => handlers.onToggleReopenStage('subject'));
    headingRow.appendChild(doneButton);
  }
  wrap.appendChild(headingRow);

  if (subjects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lesson-plan-builder__empty-message';
    empty.textContent = 'No subjects set up yet in Learning Management.';
    wrap.appendChild(empty);
    return wrap;
  }

  const grid = document.createElement('div');
  grid.className = 'lesson-plan-builder__subject-grid';
  subjects.forEach((subject) => {
    const isSelected = subject.id === plan.subjectId;
    const color = getTimetableSubjectColor(subject.subjectId);
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'lesson-plan-builder__subject-block' + (isSelected ? ' lesson-plan-builder__subject-block--selected' : '');
    block.style.setProperty('--subject-accent', color.text);
    block.style.setProperty('--subject-wash', getTimetableSubjectWash(subject.subjectId));
    block.disabled = !handlers.editable;
    block.setAttribute('aria-pressed', String(isSelected));
    if (isSelected) block.appendChild(createIcon('check', { size: 14, className: 'lesson-plan-builder__subject-block-check' }));
    const label = document.createElement('span');
    label.textContent = subject.title;
    block.appendChild(label);
    block.addEventListener('click', () => handlers.onSelectSubject(subject.id));
    grid.appendChild(block);
  });
  wrap.appendChild(grid);

  return wrap;
}

/** "Monday, 7 Sept 2026" — a pure locale-formatting of an already-known date key, never date arithmetic (see this file's own header comment on reusing utils/dateHelpers.js's date-key conventions). */
function formatScheduleDateLabel(dateKey) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

/** "P2 · 09:45 AM · Science" — the one shared label format for a resolved period, used identically in the compact summary and every tappable period block below, so a teacher sees the exact same wording either way. */
function formatResolvedPeriodLabel(classroom, resolved) {
  const subjectTitle = timetableDisplayService.resolveSubjectTitle(classroom, resolved.subjectId);
  return `P${resolved.periodNumber} · ${personalHubService.formatPeriodTime(resolved.startTime)} · ${subjectTitle}`;
}

/**
 * "Schedule" — a durable (scheduledDate, scheduledPeriodNumber)
 * reference into the classroom's own real Timetable (see
 * models/LessonPlan.js's own doc comment), resolved live here via
 * services/timetableService.js's resolveScheduledSlot() every render —
 * never a copy of subject/time/teacher, so a later Timetable edit
 * (periods restructured, a slot's subject changed) is reflected
 * automatically the very next time this renders, with no migration.
 * Only ever shown once Subject is chosen (see renderBuilder()) — this
 * is the "SUBJECT before SCHEDULE" ordering the guided flow requires,
 * and it's also what lets period choices below be filtered to this
 * plan's own Subject at all.
 *
 * Optional, so this never gates anything else the way the guided
 * CONTENT stages do (see LESSON_PLAN_STAGES) — visually it still
 * reads as "primary" for as long as it's genuinely unscheduled (the
 * natural next thing to do right after Subject), and "compact" the
 * moment it has a real value, but nothing downstream ever waits on it.
 *
 * Four states:
 *   1. This classroom has no Timetable periods configured at all yet
 *      -> a plain explanatory note, nothing to pick from.
 *   2. Not yet scheduled -> a single "+ Add to timetable" action.
 *   3. Scheduled and still resolves -> the compact two-line summary
 *      (date, then "P2 · 09:45 AM · Science") plus Change/Clear.
 *   4. Scheduled but no longer resolves (the Timetable was
 *      reconfigured since) -> "Schedule needs attention" and a calm,
 *      non-blocking warning instead of silently dropping or rewriting
 *      what this plan actually has stored — the stored (date,
 *      periodNumber) itself is NEVER touched just because it stopped
 *      resolving; only an explicit Change/Clear here ever changes it.
 * The inline picker (state.isSchedulePickerOpen) replaces whichever of
 * the above is showing, in place.
 */
function renderScheduleSection(plan, classroom, state, handlers) {
  const section = document.createElement('section');
  section.className = 'lesson-plan-builder__stage';

  if (timetableService.getPeriods(classroom).length === 0) {
    section.classList.add('lesson-plan-builder__stage--compact');
    const heading = document.createElement('p');
    heading.className = 'lesson-plan-builder__stage-summary-title';
    heading.textContent = 'Schedule';
    section.appendChild(heading);
    const note = document.createElement('p');
    note.className = 'lesson-plan-builder__schedule-note';
    note.textContent = "Scheduling isn't available yet — this classroom's timetable hasn't been set up.";
    section.appendChild(note);
    return section;
  }

  if (state.isSchedulePickerOpen) {
    section.classList.add('lesson-plan-builder__stage--reopened');
    const headingRow = document.createElement('div');
    headingRow.className = 'lesson-plan-builder__stage-heading-row';
    const heading = document.createElement('h2');
    heading.className = 'lesson-plan-builder__stage-heading';
    heading.textContent = 'Schedule';
    headingRow.appendChild(heading);
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text lesson-plan-builder__stage-collapse-button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', handlers.onToggleSchedulePickerOpen);
    headingRow.appendChild(cancelButton);
    section.appendChild(headingRow);
    section.appendChild(renderSchedulePicker(plan, classroom, state, handlers));
    return section;
  }

  if (!plan.scheduledDate) {
    section.classList.add('lesson-plan-builder__stage--primary');
    const heading = document.createElement('h2');
    heading.className = 'lesson-plan-builder__stage-heading lesson-plan-builder__stage-heading--primary';
    heading.textContent = 'When are you teaching it?';
    section.appendChild(heading);
    section.appendChild(createAddRowButton('+ Add to timetable', handlers.onToggleSchedulePickerOpen));
    return section;
  }

  const resolved = timetableService.resolveScheduledSlot(classroom, plan.scheduledDate, plan.scheduledPeriodNumber);

  section.classList.add('lesson-plan-builder__stage--compact');

  const summary = document.createElement('div');
  summary.className = 'lesson-plan-builder__stage-summary lesson-plan-builder__stage-summary--static';

  if (resolved) {
    summary.appendChild(createIcon('check', { size: 16, className: 'lesson-plan-builder__stage-summary-check' }));
  } else {
    summary.appendChild(createIcon('alert-triangle', { size: 16, className: 'lesson-plan-builder__stage-summary-check lesson-plan-builder__stage-summary-check--stale' }));
  }

  const textWrap = document.createElement('span');
  textWrap.className = 'lesson-plan-builder__stage-summary-text';

  const titleEl = document.createElement('span');
  titleEl.className = 'lesson-plan-builder__stage-summary-title';
  titleEl.textContent = resolved ? 'Schedule' : 'Schedule needs attention';
  textWrap.appendChild(titleEl);

  const dateLine = document.createElement('span');
  dateLine.className = 'lesson-plan-builder__stage-summary-preview';
  dateLine.textContent = formatScheduleDateLabel(plan.scheduledDate);
  textWrap.appendChild(dateLine);

  const periodLine = document.createElement('span');
  if (resolved) {
    periodLine.className = 'lesson-plan-builder__stage-summary-preview';
    periodLine.textContent = formatResolvedPeriodLabel(classroom, resolved);
  } else {
    // Stale — the Timetable no longer has this exact (date, period)
    // configured. The stored schedule itself is untouched; this is
    // only ever a display-time warning.
    periodLine.className = 'lesson-plan-builder__stage-summary-preview lesson-plan-builder__stage-summary-preview--stale';
    periodLine.textContent = `Period ${plan.scheduledPeriodNumber} is no longer configured in the timetable.`;
  }
  textWrap.appendChild(periodLine);

  summary.appendChild(textWrap);
  section.appendChild(summary);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'lesson-plan-builder__schedule-actions';

  const changeButton = document.createElement('button');
  changeButton.type = 'button';
  changeButton.className = 'btn btn--text lesson-plan-builder__schedule-action';
  changeButton.textContent = 'Change';
  changeButton.disabled = !handlers.editable;
  changeButton.addEventListener('click', handlers.onToggleSchedulePickerOpen);
  actionsRow.appendChild(changeButton);

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'btn btn--text lesson-plan-builder__schedule-action';
  clearButton.textContent = 'Clear';
  clearButton.disabled = !handlers.editable;
  clearButton.addEventListener('click', handlers.onClearSchedule);
  actionsRow.appendChild(clearButton);

  section.appendChild(actionsRow);

  return section;
}

/**
 * The inline Date -> Period picker — date first, always; the period
 * choices below it are always derived from THAT date AND filtered to
 * this plan's own Subject (see getRelevantScheduleSlots()), never
 * entered manually and never every period the classroom happens to
 * teach that day. Tappable period BLOCKS, not a dropdown — per
 * explicit product direction. `state.pendingScheduleDate` is the date
 * currently chosen but not yet resolved to a period — only ever
 * non-null while this picker is open (see
 * onToggleSchedulePickerOpen/onScheduleDateChange).
 */
function renderSchedulePicker(plan, classroom, state, handlers) {
  const picker = document.createElement('div');
  picker.className = 'lesson-plan-builder__schedule-picker';

  const dateLabel = document.createElement('label');
  dateLabel.className = 'lesson-plan-builder__schedule-picker-label';
  dateLabel.textContent = 'Date';
  picker.appendChild(dateLabel);

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'lesson-plan-builder__schedule-date-input';
  dateInput.value = state.pendingScheduleDate || '';
  dateInput.addEventListener('change', () => handlers.onScheduleDateChange(dateInput.value));
  picker.appendChild(dateInput);

  if (state.pendingScheduleDate) {
    const relevantSlots = getRelevantScheduleSlots(classroom, plan, state.pendingScheduleDate);

    if (relevantSlots.length === 0) {
      const subject = plan.subjectId ? learningRecordService.getSubjectById(classroom, plan.subjectId) : null;
      const noneMessage = document.createElement('p');
      noneMessage.className = 'lesson-plan-builder__schedule-note';
      noneMessage.textContent = subject
        ? `No ${subject.title} periods scheduled on this day.`
        : 'No periods scheduled on this day.';
      picker.appendChild(noneMessage);
    } else {
      // Reached only when re-opening the picker on a date whose own
      // relevant-period count has since changed to more than one
      // (onScheduleDateChange already auto-resolves the single-period
      // case immediately, without ever showing these blocks) — a real
      // choice when there's more than one relevant period that day.
      const periodLabel = document.createElement('label');
      periodLabel.className = 'lesson-plan-builder__schedule-picker-label';
      periodLabel.textContent = 'Period';
      picker.appendChild(periodLabel);

      const periodGrid = document.createElement('div');
      periodGrid.className = 'lesson-plan-builder__period-grid';

      relevantSlots.forEach((slot) => {
        const resolved = timetableService.resolveScheduledSlot(classroom, state.pendingScheduleDate, slot.periodNumber);
        const isCurrent = state.pendingScheduleDate === plan.scheduledDate && slot.periodNumber === plan.scheduledPeriodNumber;
        const block = document.createElement('button');
        block.type = 'button';
        block.className = 'lesson-plan-builder__period-block' + (isCurrent ? ' lesson-plan-builder__period-block--selected' : '');
        block.setAttribute('aria-pressed', String(isCurrent));
        if (isCurrent) block.appendChild(createIcon('check', { size: 12, className: 'lesson-plan-builder__period-block-check' }));
        const timeLine = document.createElement('span');
        timeLine.className = 'lesson-plan-builder__period-block-time';
        timeLine.textContent = resolved ? `P${resolved.periodNumber} · ${personalHubService.formatPeriodTime(resolved.startTime)}` : `P${slot.periodNumber}`;
        block.appendChild(timeLine);
        const subjectLine = document.createElement('span');
        subjectLine.className = 'lesson-plan-builder__period-block-subject';
        subjectLine.textContent = resolved ? timetableDisplayService.resolveSubjectTitle(classroom, resolved.subjectId) : '';
        block.appendChild(subjectLine);
        block.addEventListener('click', () => handlers.onSchedulePeriodChange(slot.periodNumber));
        periodGrid.appendChild(block);
      });

      picker.appendChild(periodGrid);
    }
  }

  return picker;
}

/**
 * CONCEPT — the guided stage right after Subject/Schedule ("What are
 * students learning?"). Subject is already fixed by the time this
 * ever renders (see renderBuilder()'s own ordering), so this is just
 * the Curriculum Explorer scoped straight to that Subject's own Units
 * — no second subject picker here anymore (Phase 4's original
 * dropdown-in-this-field is gone; Subject is chosen earlier now, once,
 * by renderSubjectStage()). Reuses
 * ui/components/CurriculumExplorerPanel.js exactly as-is rather than a
 * new picker, per explicit product direction — that shared
 * component's own already-designed `onClick`-per-concept interactive
 * mode. A concept is "selected" by being present in `plan.conceptIds`;
 * clicking a concept again removes it — the panel itself has no
 * built-in "selected" visual state, so a selected concept's title is
 * prefixed with a checkmark here instead of forking the shared
 * component for one new CSS class.
 *
 * Compact/primary treatment matches every other guided CONTENT stage
 * (see renderGuidedContentStage()) — this one is just bespoke rather
 * than going through that shared helper, since its "full" content
 * needs the chips + explorer-panel structure below, not a plain
 * textarea.
 */
function renderConceptsField(plan, classroom, state, handlers) {
  const isComplete = plan.conceptIds.length > 0;
  const isFrontier = state.frontierStage === LESSON_PLAN_STAGES.CONCEPT;
  const isReopened = state.reopenedStageKey === LESSON_PLAN_STAGES.CONCEPT;

  const field = document.createElement('section');
  field.className = 'lesson-plan-builder__stage';

  // Unlike the free-text stages, Concept is a multi-select — picking
  // ONE concept already satisfies "complete" (submission readiness
  // only asks for at least one), but that must never auto-collapse
  // this stage out from under a teacher who is still actively
  // choosing more. `state.isConceptPickerOpen` (the explorer panel's
  // own explicit open/closed toggle) overrides the usual "complete
  // stages compress" rule for exactly this reason.
  if (isComplete && !isFrontier && !isReopened && !state.isConceptPickerOpen) {
    field.classList.add('lesson-plan-builder__stage--compact');
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'lesson-plan-builder__stage-summary';
    summary.disabled = !handlers.editable;
    summary.addEventListener('click', () => handlers.onToggleReopenStage(LESSON_PLAN_STAGES.CONCEPT));
    summary.appendChild(createIcon('check', { size: 16, className: 'lesson-plan-builder__stage-summary-check' }));
    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-plan-builder__stage-summary-text';
    const titleEl = document.createElement('span');
    titleEl.className = 'lesson-plan-builder__stage-summary-title';
    titleEl.textContent = 'Concepts';
    textWrap.appendChild(titleEl);
    const preview = document.createElement('span');
    preview.className = 'lesson-plan-builder__stage-summary-preview';
    preview.textContent = plan.conceptIds
      .map((conceptId) => learningRecordService.getConceptById(classroom, conceptId)?.title)
      .filter(Boolean)
      .join(', ');
    textWrap.appendChild(preview);
    summary.appendChild(textWrap);
    field.appendChild(summary);
    return field;
  }

  field.classList.add(isFrontier ? 'lesson-plan-builder__stage--primary' : 'lesson-plan-builder__stage--reopened');

  const headingRow = document.createElement('div');
  headingRow.className = 'lesson-plan-builder__stage-heading-row';
  const heading = document.createElement('h2');
  heading.className = isFrontier ? 'lesson-plan-builder__stage-heading lesson-plan-builder__stage-heading--primary' : 'lesson-plan-builder__stage-heading';
  heading.textContent = 'What are students learning?';
  headingRow.appendChild(heading);
  if (isReopened && !isFrontier) {
    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'btn btn--text lesson-plan-builder__stage-collapse-button';
    doneButton.textContent = 'Done';
    doneButton.addEventListener('click', () => handlers.onToggleReopenStage(LESSON_PLAN_STAGES.CONCEPT));
    headingRow.appendChild(doneButton);
  }
  field.appendChild(headingRow);

  const subjects = learningRecordService.getSubjects(classroom);
  const selectedSubject = plan.subjectId ? subjects.find((subject) => subject.id === plan.subjectId) : null;

  if (handlers.editable && selectedSubject) {
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'btn btn--ghost lesson-plan-builder__concepts-toggle-button';
    toggleButton.textContent = state.isConceptPickerOpen ? 'Done choosing' : '+ Choose Concepts';
    toggleButton.addEventListener('click', handlers.onToggleConceptPickerOpen);
    field.appendChild(toggleButton);
  }

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
          onAddConcept: handlers.onAddConcept,
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
/**
 * The "ready for review"/Submit action — per this feature's own
 * product direction, submitting is the readiness checklist's own
 * final step, never a separate screen or a button bolted on
 * somewhere else. Deliberately renders NOTHING at all when not ready
 * (no "Almost there — N things left" list anymore — see this file's
 * own header comment on why): the guided flow itself is what surfaces
 * what's still incomplete (the frontier stage is sitting there,
 * uncollapsed, asking for attention), so a second, separate warning
 * panel repeating the same information would just be the "still have
 * chores" anxiety this whole redesign explicitly set out to remove.
 * Submission validation itself (services/lessonPlanValidationService.js's
 * getLessonPlanReadiness()) is completely unchanged — same
 * requirements, same gate on the Submit button — only the missing-item
 * checklist UI is gone.
 */
function renderReadinessPanel(plan, handlers) {
  // Not editable (SUBMITTED/APPROVED) — nothing actionable left to show
  // here; renderTitleBar's own status message already covers "what's
  // happening right now" for those two statuses.
  if (!handlers.editable) return document.createComment('lesson plan locked — no readiness action to show');

  const readiness = getLessonPlanReadiness(plan);
  if (!readiness.ready) return document.createComment('not yet ready — the guided flow itself surfaces what is still incomplete');

  const panel = document.createElement('div');
  panel.className = 'lesson-plan-builder__readiness lesson-plan-builder__readiness--ready';

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

/**
 * Shared shell for the 4 free-text guided CONTENT stages (Purpose/
 * Connection/Experience/Evidence) — a compact "✓ Title" summary once
 * complete (unless it's the current guided focus or has been manually
 * reopened), a full writing area otherwise. "Complete" comes from
 * services/lessonPlanValidationService.js's own
 * getLessonPlanStageCompletion() — the exact same submission-readiness
 * rules, never a second definition of "done." Subject/Schedule/Concept
 * each have their own bespoke render function instead of this one
 * (their "full" content isn't a plain textarea), but all of them share
 * this same visual language (see css/styles.css's own
 * .lesson-plan-builder__stage* rules) so the guided trail reads as one
 * consistent system regardless of which stage produced it.
 */
function renderGuidedContentStage({ stage, title, sectionKey, plan, state, handlers, renderFull, getPreview, isOptional = false }) {
  const isComplete = Boolean(state.stageCompletionByKey[stage]);
  const isFrontier = state.frontierStage === stage;
  const isReopened = state.reopenedStageKey === stage;

  const wrap = document.createElement('section');
  wrap.className = 'lesson-plan-builder__stage';

  if (isComplete && !isFrontier && !isReopened) {
    wrap.classList.add('lesson-plan-builder__stage--compact');
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'lesson-plan-builder__stage-summary';
    summary.disabled = !handlers.editable;
    summary.addEventListener('click', () => handlers.onToggleReopenStage(stage));
    summary.appendChild(createIcon('check', { size: 16, className: 'lesson-plan-builder__stage-summary-check' }));
    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-plan-builder__stage-summary-text';
    const titleEl = document.createElement('span');
    titleEl.className = 'lesson-plan-builder__stage-summary-title';
    titleEl.textContent = title;
    textWrap.appendChild(titleEl);
    const previewText = getPreview(plan);
    if (previewText) {
      const preview = document.createElement('span');
      preview.className = 'lesson-plan-builder__stage-summary-preview';
      preview.textContent = previewText.length > 90 ? `${previewText.slice(0, 90)}…` : previewText;
      textWrap.appendChild(preview);
    }
    summary.appendChild(textWrap);
    wrap.appendChild(summary);
    return wrap;
  }

  wrap.classList.add(isFrontier ? 'lesson-plan-builder__stage--primary' : 'lesson-plan-builder__stage--reopened');

  const headingRow = document.createElement('div');
  headingRow.className = 'lesson-plan-builder__stage-heading-row';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'lesson-plan-builder__stage-title-group';
  const heading = document.createElement('h2');
  heading.className = isFrontier ? 'lesson-plan-builder__stage-heading lesson-plan-builder__stage-heading--primary' : 'lesson-plan-builder__stage-heading';
  heading.textContent = title;
  titleGroup.appendChild(heading);
  if (isOptional) {
    const optionalTag = document.createElement('span');
    optionalTag.className = 'lesson-plan-builder__optional-tag';
    optionalTag.textContent = 'Optional';
    titleGroup.appendChild(optionalTag);
  }
  headingRow.appendChild(titleGroup);
  if (isReopened && !isFrontier) {
    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'btn btn--text lesson-plan-builder__stage-collapse-button';
    doneButton.textContent = 'Done';
    doneButton.addEventListener('click', () => handlers.onToggleReopenStage(stage));
    headingRow.appendChild(doneButton);
  }
  wrap.appendChild(headingRow);

  wrap.appendChild(renderFull());

  if (sectionKey) {
    const comments = renderCommentsList(plan, sectionKey);
    if (comments) wrap.appendChild(comments);
  }

  return wrap;
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
  attachAutoGrowTextarea(textarea); // every long-form field grows with its content — see AutoGrowTextarea.js's own doc comment
  field.appendChild(textarea);

  if (plan && sectionKey) {
    const comments = renderCommentsList(plan, sectionKey);
    if (comments) field.appendChild(comments);
  }

  return field;
}

// ---- 1. WHY --------------------------------------------------------

/**
 * Lesson Objectives — a reorderable list of individual, first-class
 * objectives (see models/LessonPlan.js's own createLessonPlanObjective()
 * doc comment), not one big textarea a teacher used to cram bullet
 * points into. `lessonObjective`/`swbatObjectives` (the old shape)
 * are never shown here again — by the time this ever renders,
 * lessonPlanService.migrateLegacyObjectives() (called once, on load —
 * see this file's own load flow) has already turned whatever old
 * content existed into real entries in `plan.objectives`, so there is
 * nothing left to recap separately; the old fields stay in the
 * document, untouched, purely as an inert historical record.
 */
function renderWhySection(plan, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__why';

  const objectivesField = document.createElement('div');
  objectivesField.className = 'lesson-plan-builder__field';
  const objectivesLabel = document.createElement('label');
  objectivesLabel.className = 'lesson-plan-builder__field-label';
  objectivesLabel.textContent = 'Lesson Objectives';
  objectivesField.appendChild(objectivesLabel);

  plan.objectives.forEach((objective, index) => {
    objectivesField.appendChild(
      createDynamicListRow({
        value: objective.text,
        placeholder: 'e.g. Explain the causes of the revolt',
        onChange: (value) => handlers.onObjectiveChange(objective.id, value),
        onRemove: () => handlers.onRemoveObjective(objective.id),
        disabled: !handlers.editable,
        onMoveUp: () => handlers.onMoveObjectiveUp(objective.id),
        onMoveDown: () => handlers.onMoveObjectiveDown(objective.id),
        canMoveUp: index > 0,
        canMoveDown: index < plan.objectives.length - 1,
      })
    );
  });

  if (handlers.editable) objectivesField.appendChild(createAddRowButton('+ Add objective', handlers.onAddObjective));
  wrap.appendChild(objectivesField);

  const bigQuestionField = createLabeledTextarea({
    label: 'Big Question',
    placeholder: 'The one question this whole lesson is trying to answer',
    value: plan.bigQuestion,
    onChange: handlers.onBigQuestionChange,
    disabled: !handlers.editable,
  });
  if (handlers.editable) bigQuestionField.appendChild(createFromTeachingIdeasButton(handlers.onOpenBigQuestionPicker));
  wrap.appendChild(bigQuestionField);

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

/**
 * `onMoveUp`/`onMoveDown` are optional — omitted entirely (as
 * Assessment items' own call site still does) means no reorder
 * buttons render at all, so this stays exactly backward-compatible.
 * When provided (see renderWhySection()'s own Objectives list above),
 * reuses the exact same ▲/▼ text-button convention
 * renderActivityCard()'s own reorder buttons already established in
 * this file, for one consistent reorder affordance across every
 * reorderable list on this page.
 */
function createDynamicListRow({ value, placeholder, onChange, onRemove, disabled = false, onMoveUp, onMoveDown, canMoveUp = false, canMoveDown = false }) {
  const row = document.createElement('div');
  row.className = 'lesson-plan-builder__dynamic-row';

  if (!disabled && (onMoveUp || onMoveDown)) {
    const reorderGroup = document.createElement('div');
    reorderGroup.className = 'lesson-plan-builder__dynamic-reorder';

    const upButton = document.createElement('button');
    upButton.type = 'button';
    upButton.className = 'lesson-plan-builder__activity-reorder-button';
    upButton.textContent = '▲';
    upButton.setAttribute('aria-label', 'Move up');
    upButton.disabled = !canMoveUp;
    upButton.addEventListener('click', onMoveUp);
    reorderGroup.appendChild(upButton);

    const downButton = document.createElement('button');
    downButton.type = 'button';
    downButton.className = 'lesson-plan-builder__activity-reorder-button';
    downButton.textContent = '▼';
    downButton.setAttribute('aria-label', 'Move down');
    downButton.disabled = !canMoveDown;
    downButton.addEventListener('click', onMoveDown);
    reorderGroup.appendChild(downButton);

    row.appendChild(reorderGroup);
  }

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

/**
 * Pair Explanation — one of the three fields of Question 5, "Are
 * students helping me and others learn?" (models/LessonPlan.js's own
 * 5th question; see services/lessonPlanValidationService.js's own
 * LESSON_PLAN_STAGES.HELPING). The field itself, its label, its
 * placeholder, its mutation (lessonPlanService.updateHelpingEachOtherLearn()),
 * and its own sectionKey (LESSON_PLAN_SECTION_KEYS.PAIR_EXPLANATION)
 * are unchanged — this and renderFinalQuestionAndLookForsFields() below
 * are kept as two separate functions (rather than merged into one)
 * purely because they predate the guided redesign; both are always
 * rendered together under the same Question 5 stage now (see
 * renderBuilder()'s own freeTextStages array).
 */
function renderPairExplanationField(plan, handlers) {
  return createLabeledTextarea({
    label: 'Pair Explanation',
    placeholder: 'How will students explain their learning to a partner?',
    value: plan.pairExplanation,
    onChange: (value) => handlers.onHelpingEachOtherLearnChange('pairExplanation', value),
    disabled: !handlers.editable,
    plan,
    sectionKey: LESSON_PLAN_SECTION_KEYS.PAIR_EXPLANATION,
  });
}

/**
 * Final Question + Teacher Look-Fors — the other two fields of
 * Question 5 (see renderPairExplanationField()'s own doc comment
 * above). Unchanged fields/labels/mutation/sectionKeys.
 */
function renderFinalQuestionAndLookForsFields(plan, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__helping-extra';

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
