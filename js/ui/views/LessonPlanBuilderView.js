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
 * Readiness (services/lessonPlanValidationService.js) is a standing,
 * ALWAYS-VISIBLE checklist at the top of the canvas, right under the
 * title/status — informational, never a submission gate (per explicit
 * product direction, restoring this file's own original Phase 2 intent
 * after an intervening phase had turned it into a hard block). The one
 * real submission requirement is services/lessonPlanValidationService.js's
 * canSubmitLessonPlan() — at least one Activity, no maximum, nothing
 * else — everything else the checklist reports (Student Action, Pair
 * Explanation, Exit Ticket) is a warning a teacher can see and choose
 * to submit past via the "Submit without these?" confirmation
 * (ui/components/SubmitLessonPlanWarningsModal.js). Teacher Look-Fors
 * has been removed entirely (no field, section, or warning) — see
 * renderExitTicketField()'s own doc comment.
 * Every guided CONTENT stage now renders in full once Subject is
 * chosen — no more one-at-a-time reveal gated on completion — so a
 * checklist warning never points at a section the teacher can't
 * actually see or edit.
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
import * as teachingIdeasRepository from '../../repositories/teachingIdeasRepository.js';
import * as teachingIdeasService from '../../services/teachingIdeasService.js';
import * as weeklyPlanReviewIndexRepository from '../../repositories/weeklyPlanReviewIndexRepository.js';
import * as weeklyPlanReviewIndexService from '../../services/weeklyPlanReviewIndexService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as timetableService from '../../services/timetableService.js';
import * as timetableDisplayService from '../../services/timetableDisplayService.js';
import * as personalHubService from '../../services/personalHubService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { getGradeLabelForClassroom } from '../../services/classroomService.js';
import { getTodayDateKey } from '../../utils/dateHelpers.js';
import { LESSON_PLAN_STATUS, LESSON_PLAN_SECTION_KEYS, LESSON_RESOURCE_TYPES } from '../../models/LessonPlan.js';
import { getLessonPlanReadiness, getLessonPlanStageCompletion, getLessonPlanReadinessByStage, canSubmitLessonPlan, LESSON_PLAN_STAGES } from '../../services/lessonPlanValidationService.js';
import { getTimetableSubjectColor, getTimetableSubjectWash } from '../../config/timetableSubjectColors.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { createCurriculumExplorerPanel } from '../components/CurriculumExplorerPanel.js';
import { openTeachingIdeasPickerModal } from '../components/TeachingIdeasPickerModal.js';
import { attachAutoGrowTextarea } from '../components/AutoGrowTextarea.js';
import { openSubmitLessonPlanWarningsModal } from '../components/SubmitLessonPlanWarningsModal.js';

const STATUS_LABELS = Object.freeze({
  [LESSON_PLAN_STATUS.DRAFT]: 'Draft',
  [LESSON_PLAN_STATUS.SUBMITTED]: 'Submitted',
  [LESSON_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [LESSON_PLAN_STATUS.APPROVED]: 'Approved',
});

/**
 * The status badge's own displayed text — DRAFT/SUBMITTED/
 * CHANGES_REQUESTED/APPROVED render exactly as before; an APPROVED plan
 * CONFIRMED published (see this file's own isPublished state, checked
 * against the real teachingIdeas/{id} document, never assumed) shows
 * "Published" instead. `isPublished` is `null` while that check hasn't
 * resolved yet — deliberately still shows "Approved" in that window
 * rather than a third, temporary label, since "Approved" was already
 * true and remains true regardless of the publish check's outcome.
 */
function getStatusBadgeLabel(plan, isPublished) {
  if (plan.status === LESSON_PLAN_STATUS.APPROVED && isPublished === true) return 'Published';
  return STATUS_LABELS[plan.status] || plan.status;
}

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

/**
 * One friendly status line under the badge — never "Submission
 * rejected"/"Form incomplete", per this feature's own explicit product
 * direction on tone. `isPublished` is `null` (unknown/still checking),
 * `true`, or `false` — only ever meaningful when `plan.status ===
 * APPROVED`; ignored otherwise. `false` is the one real, actionable
 * state this adds: approval already ran its own automatic publish step
 * (see ui/views/LessonPlanReviewView.js's onApprove), and if that step
 * failed, this is the plan's own honest "not actually published yet"
 * signal, not a second/different meaning of "approved".
 */
function getStatusMessage(plan, isPublished) {
  switch (plan.status) {
    case LESSON_PLAN_STATUS.SUBMITTED:
      return 'Submitted — needs a co-teacher’s review before it’s ready to teach.';
    case LESSON_PLAN_STATUS.CHANGES_REQUESTED:
      return 'Changes requested — see reviewer feedback below, then resubmit.';
    case LESSON_PLAN_STATUS.APPROVED:
      if (isPublished === false) {
        return 'Approved — this lesson plan is locked in, but publishing it as a Teaching Idea didn’t complete. Try publishing again below.';
      }
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
  // Spark stays a quiet, compact entry point within Experience until the
  // teacher deliberately opens it (or it already has real content — see
  // renderSparkSection()'s own doc comment) — the same "compact until
  // interacted with" convention isConceptPickerOpen/isSchedulePickerOpen
  // already establish, scoped to just this one sub-section rather than
  // a whole guided stage. Local UI state only — never persisted, and
  // never affects readiness/progression (services/lessonPlanValidationService.js
  // never required Spark in the first place).
  let isSparkOpen = false;
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

  // Learning Resources — local UI state only (which add/edit form, if
  // any, is currently open); the resources themselves live on
  // `plan.resources`, persisted the same way every other section is.
  // `addingResourceSlot` is `null` (no form open), `'common'` (the
  // Common Learning Resources section's own "+ Add Resource"), or a
  // real Activity id (that Activity's own "+ Add Resource") — the SAME
  // underlying addLearningResource()/resources[] this always was, only
  // the section dropdown's own default differs by which slot opened it,
  // so a resource created from Activity 2's own card starts pre-scoped
  // to Activity 2 without the teacher having to find it in the dropdown.
  let addingResourceSlot = null;
  let editingResourceId = null;

  // Publish status — `null` until checked (or plan.status isn't
  // APPROVED at all, where it's simply never relevant), then `true`/
  // `false` once a real teachingIdeas/{id} lookup resolves (see
  // checkPublishStatus() below). Never assumed true just because
  // status is 'approved' — approval and publication are two separate
  // facts that happen to normally occur together (see
  // models/LessonPlan.js's own LESSON_PLAN_STATUS doc comment).
  let isPublished = null;
  let isRetryingPublish = false;
  let publishRetryError = null;

  /**
   * Checks the real source of truth for "is this plan actually
   * published" — a teachingIdeas/{plan.id} document existing — rather
   * than assuming APPROVED implies it. Only ever called for an APPROVED
   * plan. A failed check (network error) leaves `isPublished` at
   * whatever it already was rather than guessing; it will be retried
   * the next time this runs (e.g. after a manual publish retry).
   */
  function checkPublishStatus() {
    if (!plan || plan.status !== LESSON_PLAN_STATUS.APPROVED) return;
    teachingIdeasRepository
      .getTeachingIdeaById(plan.id)
      .then((idea) => {
        isPublished = Boolean(idea);
        rerender();
      })
      .catch((error) => {
        console.error('[LessonPlanBuilderView] Failed to check Teaching Ideas publish status:', error);
      });
  }

  function computeFrontierStage() {
    if (!plan) return null;
    return getLessonPlanStageCompletion(plan).find((entry) => !entry.complete)?.stage || null;
  }

  function persistAndRerender() {
    const savePromise = saveIndicator.persistPatch(() => lessonPlanRepository.saveLessonPlan(classroom.id, plan));
    rerender();
    return savePromise;
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
    // Weekly Plan Review Index — best-effort, exactly like
    // ui/views/LessonPlanReviewView.js's own Teaching Ideas publish after
    // approve(): chained after the real save so the Firestore rule's own
    // re-read of the canonical LessonPlan sees the NEW ('submitted')
    // status, not the one before this save (see firestore.rules' own
    // weeklyPlanReviewIndex block). A failure here never blocks or
    // reports as an error against the submit action itself, which has
    // already fully succeeded by this point — see
    // services/weeklyPlanReviewIndexService.js's own header comment for
    // why this index is a discovery aid, never the source of truth.
    persistAndRerender()
      .then(() => weeklyPlanReviewIndexRepository.upsertReviewIndexEntry(weeklyPlanReviewIndexService.buildReviewIndexEntry(classroom, plan)))
      .catch((error) => {
        console.error('[LessonPlanBuilderView] Failed to update the Weekly Plan review index after submit:', error);
      });
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
    renderBuilder(container, { plan, loadError, collapsedActivityIds, saveIndicatorElement: saveIndicator.element, editable, classroom, isConceptPickerOpen, expandedConceptUnitId, isSchedulePickerOpen, pendingScheduleDate, reopenedStageKey, isSparkOpen, addingResourceSlot, editingResourceId, isPublished, isRetryingPublish, publishRetryError }, {
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
      onToggleSparkOpen: () => {
        isSparkOpen = !isSparkOpen;
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

      // ---- Learning Resources ----
      onStartAddResource: (slot = 'common') => {
        addingResourceSlot = slot;
        editingResourceId = null;
        rerender(); // purely local UI state — nothing to persist
      },
      onCancelAddResource: () => {
        addingResourceSlot = null;
        rerender();
      },
      onSaveNewResource: ({ title, type, url, description, sectionKey }) => {
        if (!title.trim() || !url.trim()) return; // Title and a real URL are the two required fields — see renderLearningResourcesSection()'s own form
        lessonPlanService.addLearningResource(plan, { title: title.trim(), type, url: url.trim(), description: description.trim(), sectionKey });
        addingResourceSlot = null;
        persistAndRerender();
      },
      onStartEditResource: (resourceId) => {
        editingResourceId = resourceId;
        addingResourceSlot = null;
        rerender();
      },
      onCancelEditResource: () => {
        editingResourceId = null;
        rerender();
      },
      onSaveResourceEdit: (resourceId, { title, type, url, description, sectionKey }) => {
        if (!title.trim() || !url.trim()) return;
        lessonPlanService.updateLearningResource(plan, resourceId, { title: title.trim(), type, url: url.trim(), description: description.trim(), sectionKey });
        editingResourceId = null;
        persistAndRerender();
      },
      onRemoveResource: (resourceId, resourceTitle) => {
        if (!window.confirm(`Remove "${resourceTitle || 'this resource'}"?`)) return;
        lessonPlanService.removeLearningResource(plan, resourceId);
        persistAndRerender();
      },

      // ---- Publish (retry only — approval already publishes automatically) ----
      onRetryPublish: async () => {
        isRetryingPublish = true;
        publishRetryError = null;
        rerender();
        try {
          const projection = teachingIdeasService.buildTeachingIdeaProjection(classroom, plan);
          await teachingIdeasRepository.publishTeachingIdea(projection);
          isPublished = true;
        } catch (error) {
          console.error('[LessonPlanBuilderView] Failed to publish:', error);
          publishRetryError = "Couldn't publish this yet — check your connection and try again.";
        }
        isRetryingPublish = false;
        rerender();
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
        checkPublishStatus();

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

  const grid = document.createElement('div');
  grid.className = 'lesson-plan-builder__grid';
  wrapper.appendChild(grid);

  grid.appendChild(withTileSize(renderTitleBar(plan, stageCompletion, state, handlers), 'full'));

  if (!handlers.editable) {
    // Locked (SUBMITTED/APPROVED) — a completed artifact to review now,
    // not something still being "built." Progressive disclosure is
    // deliberately a DRAFT-building UX pattern (see this file's own
    // header comment); once there's no more building happening, every
    // stage renders in full, flat, exactly as a reviewer or the
    // teacher themselves needs to see the complete real content — never
    // a partial reveal gated on a "current stage" that no longer means
    // anything once the plan is locked. Still composed onto the SAME
    // Bento grid as the guided view below (Concepts+Schedule paired,
    // Connection+Showcase paired) — one visual system, not two.
    // Order matches the real 5 Questions framework (Q1 Why -> Q2 Self/
    // Others/India -> Q3 Showcasing learning -> Q4 Fun/Fast/Effective ->
    // Q5 Helping each other learn), the same order the guided flow
    // below uses — never two different orderings for the same content.
    grid.appendChild(withTileSize(renderSubjectStage(plan, classroom, guidedState, handlers), 'full'));
    grid.appendChild(withTileSize(renderLessonOverviewLabel(), 'full'));
    grid.appendChild(withTileSize(withSurfaceTile(renderConceptsField(plan, classroom, guidedState, handlers)), 'wide'));
    grid.appendChild(withTileSize(renderScheduleSection(plan, classroom, guidedState, handlers), 'narrow'));
    grid.appendChild(withTileSize(withSurfaceTile(renderWhySection(plan, handlers)), 'full'));
    grid.appendChild(withTileSize(renderSelfOthersIndiaSection(plan, handlers), 'half'));
    grid.appendChild(withTileSize(renderAssessmentSection(plan, handlers), 'half'));
    grid.appendChild(withTileSize(withSurfaceTile(renderCommonLearningResources(plan, state, handlers)), 'full'));
    const experience = document.createElement('div');
    experience.className = 'lesson-plan-builder__experience';
    experience.appendChild(renderSparkSection(plan, handlers));
    experience.appendChild(renderActivitiesSection(plan, state.collapsedActivityIds, handlers, state));
    grid.appendChild(withTileSize(withSurfaceTile(experience), 'full'));
    const helping = document.createElement('div');
    const helpingHeading = document.createElement('h2');
    helpingHeading.className = 'lesson-plan-builder__stage-heading';
    helpingHeading.textContent = 'Are students helping me and others learn?';
    helping.appendChild(helpingHeading);
    helping.appendChild(renderPairExplanationField(plan, handlers));
    helping.appendChild(renderExitTicketField(plan, handlers));
    grid.appendChild(withTileSize(helping, 'full'));
    container.appendChild(wrapper);
    return;
  }

  // Guided building — Subject always first; nothing past it renders at
  // all until it's chosen (see this file's own header comment: "SUBJECT
  // MUST COME BEFORE SCHEDULE"). A full-width tile of its own — it's a
  // one-tap, transient setup step, not core lesson content, and
  // collapses to a one-line compact row the moment it's chosen.
  grid.appendChild(withTileSize(renderSubjectStage(plan, classroom, guidedState, handlers), 'full'));

  if (!plan.subjectId) {
    container.appendChild(wrapper);
    return;
  }

  // Submission check / Submit — deliberately near the TOP, right under
  // Subject, per explicit product direction: a teacher should never
  // have to scroll through the whole guided canvas to discover whether
  // (or how) they can submit. See renderReadinessPanel()'s own doc
  // comment — this is advisory, never a gate past the one real
  // eligibility requirement (canSubmitLessonPlan()).
  grid.appendChild(withTileSize(renderReadinessPanel(plan, handlers), 'full'));

  // LESSON OVERVIEW — Concepts + Schedule, composed as one Bento row,
  // Concepts as the larger "wide" (8/12) foundational tile with its own
  // surface (see withSurfaceTile()) since every other stage builds on
  // it, Schedule as the smaller "narrow" (4/12) supporting context tile
  // with no surface of its own — purely a grid-placement + surface
  // choice made here in the orchestrator; neither section's own render
  // function changes. Either tile expands to the FULL row width on its
  // own (see the CSS `--stage--primary`/`--stage--reopened` override)
  // whenever a teacher is actively editing it, so an open picker never
  // gets squeezed into a half column. A plain label above (not another
  // card) is enough to read the two as one related group rather than
  // floating text — see renderLessonOverviewLabel()'s own doc comment.
  grid.appendChild(withTileSize(renderLessonOverviewLabel(), 'full'));
  grid.appendChild(withTileSize(withSurfaceTile(renderConceptsField(plan, classroom, guidedState, handlers)), 'wide'));
  grid.appendChild(withTileSize(renderScheduleSection(plan, classroom, guidedState, handlers), 'narrow'));

  if (frontierStage === LESSON_PLAN_STAGES.CONCEPT) {
    container.appendChild(wrapper);
    return; // Concept itself is still incomplete — nothing past it yet.
  }

  // Q1-Q5 — the real "5 Questions" lesson-planning framework itself
  // (models/LessonPlan.js's own header comment), in the framework's own
  // order, each stage's title the actual question a teacher is
  // answering — never a generic "Section 4" label. Split into two
  // groups (rather than one flat array) so Common Learning Resources
  // can render between Showcase and Experience — "before the activity
  // sequence," per explicit product direction — without needing a
  // second, parallel stage-loop mechanism.
  const earlyStages = [
    {
      stage: LESSON_PLAN_STAGES.PURPOSE,
      title: 'Why are students learning what they are learning today?',
      sectionKey: LESSON_PLAN_SECTION_KEYS.WHY,
      renderFull: () => renderWhySection(plan, handlers),
      getPreview: () => plan.objectives.find((objective) => objective.text)?.text || plan.bigQuestion || '',
      tileSize: 'full',
      surface: true,
    },
    {
      stage: LESSON_PLAN_STAGES.CONNECTION,
      title: 'Will it advance self, others and India?',
      sectionKey: LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA,
      renderFull: () => renderSelfOthersIndiaSection(plan, handlers),
      getPreview: () => plan.selfOthersIndia.self || plan.selfOthersIndia.others || plan.selfOthersIndia.india || '',
      tileSize: 'half',
      // Deliberately NOT `surface: true` — a full elevated white card
      // around 2-3 short lines read as MORE disconnected, not less (an
      // isolated island the same visual weight as a genuinely separate
      // section like Common Learning Resources). A bold heading + the
      // shared stage-heading-row divider (see css/styles.css) is enough
      // to read this as one of several related Lesson Overview items
      // without the extra card chrome.
    },
    {
      stage: LESSON_PLAN_STAGES.SHOWCASE,
      title: 'Are students showcasing learning and applying the content in and beyond class?',
      sectionKey: LESSON_PLAN_SECTION_KEYS.ASSESSMENT,
      renderFull: () => renderAssessmentSection(plan, handlers),
      getPreview: () => plan.assessments.find((item) => item.description)?.description || '',
      tileSize: 'half',
    },
  ];

  const lateStages = [
    {
      stage: LESSON_PLAN_STAGES.EXPERIENCE,
      title: 'Is it fun, fast, effective?',
      sectionKey: LESSON_PLAN_SECTION_KEYS.SPARK,
      renderFull: () => {
        const wrap = document.createElement('div');
        wrap.className = 'lesson-plan-builder__experience';
        const intro = document.createElement('p');
        intro.className = 'lesson-plan-builder__experience-intro';
        intro.textContent = 'Design how the lesson actually unfolds — the activities that carry it, with room for a Spark if you want one.';
        wrap.appendChild(intro);
        // Spark is the lesson's own OPENING experience, so it renders
        // BEFORE Activity 1 — a teacher reading top-to-bottom follows
        // the lesson in the order it will actually happen.
        wrap.appendChild(renderSparkSection(plan, handlers, state));
        wrap.appendChild(renderActivitiesSection(plan, state.collapsedActivityIds, handlers, state));
        return wrap;
      },
      getPreview: () => plan.spark.title || (plan.activities.length > 0 ? `${plan.activities.length} activit${plan.activities.length === 1 ? 'y' : 'ies'}` : ''),
      tileSize: 'full',
      surface: true,
      alwaysExpanded: true,
    },
    {
      stage: LESSON_PLAN_STAGES.HELPING,
      title: 'Are students helping me and others learn?',
      // No single sectionKey for this stage's own outer comment list —
      // Pair Explanation and Exit Ticket each already render their OWN
      // comments inline (see
      // renderPairExplanationField()/renderExitTicketField()), so a
      // second, stage-level list here would just duplicate them.
      // Teacher Look-Fors has been removed entirely — see
      // renderExitTicketField()'s own doc comment.
      sectionKey: null,
      renderFull: () => {
        const wrap = document.createElement('div');
        wrap.className = 'lesson-plan-builder__helping';
        wrap.appendChild(renderPairExplanationField(plan, handlers));
        wrap.appendChild(renderExitTicketField(plan, handlers));
        return wrap;
      },
      getPreview: () => plan.pairExplanation || plan.finalQuestion || '',
      tileSize: 'full',
      alwaysExpanded: true,
    },
  ];

  // Every guided CONTENT stage renders in full now, all at once — no
  // more one-at-a-time reveal stopping at the current frontier stage.
  // Per explicit product direction (paired with moving Submit to the
  // top and making the checklist advisory): a checklist warning about a
  // LATER stage (e.g. Helping) must always point at real, visible,
  // editable content, never a section still hidden behind an earlier
  // one being "incomplete." Each stage still individually collapses to
  // a compact "✓ Title" summary once genuinely complete (see
  // renderGuidedContentStage()'s own `isComplete` check, unchanged) —
  // this only removes the loop's own early stop, not that per-stage
  // collapse behavior.
  for (const config of earlyStages) {
    grid.appendChild(renderGuidedContentStage({ ...config, plan, state: guidedState, handlers }));
  }

  // Common Learning Resources — shared across the lesson / across
  // multiple Activities (Whole Lesson/General, Spark, Pair Explanation)
  // — deliberately BEFORE the activity sequence itself, per explicit
  // product direction: a teacher sees what they need to gather before
  // planning/executing the activities, not after. Activity-SPECIFIC
  // resources render inside each Activity's own card instead (see
  // renderActivityCard()) — same underlying resources[]/sectionKey
  // model either way, just rendered where each one is actually needed.
  grid.appendChild(withTileSize(withSurfaceTile(renderCommonLearningResources(plan, state, handlers)), 'full'));

  for (const config of lateStages) {
    grid.appendChild(renderGuidedContentStage({ ...config, plan, state: guidedState, handlers }));
  }

  grid.appendChild(withTileSize(renderBackToTopLink(), 'full'));

  container.appendChild(wrapper);
}

/**
 * A plain bottom-of-content "Back to top" action — the Builder canvas is
 * long, and the checklist + Submit action now live at the top (see
 * renderReadinessPanel()'s own doc comment), not a floating button
 * (no existing pattern for one in this design system); scrollIntoView()
 * on the title bar works regardless of which ancestor actually scrolls.
 */
function renderBackToTopLink() {
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'btn btn--text lesson-plan-builder__back-to-top';
  link.textContent = '↑ Back to top';
  link.addEventListener('click', () => {
    document.getElementById('lesson-plan-builder-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return link;
}

function renderTitleBar(plan, stageCompletion, state, handlers) {
  const { saveIndicatorElement } = state;
  const titleBar = document.createElement('div');
  titleBar.className = 'lesson-plan-builder__title-bar';
  titleBar.id = 'lesson-plan-builder-top';

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
  if (plan.status === LESSON_PLAN_STATUS.APPROVED && state.isPublished === true) {
    statusBadge.classList.add('lesson-plan-builder__status-badge--published');
  }
  statusBadge.textContent = getStatusBadgeLabel(plan, state.isPublished);
  topLine.appendChild(statusBadge);

  titleBar.appendChild(topLine);

  const statusMessage = document.createElement('p');
  statusMessage.className = 'lesson-plan-builder__status-message';
  statusMessage.textContent = getStatusMessage(plan, state.isPublished);
  titleBar.appendChild(statusMessage);

  // Publish is normally fully automatic (approving a plan immediately
  // publishes it — see ui/views/LessonPlanReviewView.js's onApprove).
  // This button ONLY appears in the one case that's genuinely a real,
  // separate step in this architecture: that automatic publish failed
  // (a transient error) and this plan is confirmed APPROVED but NOT YET
  // actually published. It reuses the exact same
  // teachingIdeasService.buildTeachingIdeaProjection()/
  // teachingIdeasRepository.publishTeachingIdea() pair, never a second
  // publish mechanism. Firestore's own `allow update: if false` on
  // teachingIdeas (see firestore.rules) already prevents this from ever
  // creating a duplicate/conflicting entry — this button additionally
  // never renders at all once state.isPublished becomes true, so
  // "duplicate/inappropriate publishing" is prevented at both layers.
  if (plan.status === LESSON_PLAN_STATUS.APPROVED && state.isPublished === false) {
    const publishRow = document.createElement('div');
    publishRow.className = 'lesson-plan-builder__publish-row';

    const publishButton = document.createElement('button');
    publishButton.type = 'button';
    publishButton.className = 'btn btn--primary';
    publishButton.textContent = state.isRetryingPublish ? 'Publishing…' : 'Publish';
    publishButton.disabled = state.isRetryingPublish;
    publishButton.addEventListener('click', handlers.onRetryPublish);
    publishRow.appendChild(publishButton);

    if (state.publishRetryError) {
      const error = document.createElement('p');
      error.className = 'lesson-plan-builder__publish-error';
      error.textContent = state.publishRetryError;
      publishRow.appendChild(error);
    }

    titleBar.appendChild(publishRow);
  }

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
 * Composition-only Bento helpers — purely tag DOM elements that
 * renderSubjectStage()/renderScheduleSection()/renderConceptsField()/
 * renderGuidedContentStage() already return; none of those functions'
 * own internals change.
 *
 * `withTileSize()` places an element into `.lesson-plan-builder__grid`
 * (a 12-column CSS Grid — see that class's own CSS comment): 'full'
 * spans all 12 columns, 'wide' spans 8 (Concepts — the larger
 * foundational tile), 'narrow' spans 4 (Schedule — its smaller
 * supporting partner in the same row), 'half' spans 6 (Connection/
 * Showcase, side by side as equal, visually secondary peers). Any tile
 * still carries its own `--stage--primary`/`--stage--reopened`
 * modifier when actively being edited (see each render function's own
 * doc comment) — the CSS grid overrides THOSE combinations back to
 * full width, so an open picker is never squeezed into a half column.
 *
 * `withSurfaceTile()` adds the lifted white "core content" surface —
 * Concepts, Purpose/Objectives, and Experience (Spark+Activities) all
 * get it, since per explicit product direction those are the core
 * lesson-building content; Schedule, Connection, Showcase, and Helping
 * deliberately do NOT, so they read as lighter/secondary by contrast
 * (whitespace and typography carrying the hierarchy, not a border on
 * every single tile).
 */
function withTileSize(el, size) {
  el.classList.add(`lesson-plan-builder__tile--${size}`);
  return el;
}

function withSurfaceTile(el) {
  el.classList.add('lesson-plan-builder__stage--surface-tile');
  return el;
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
 * Friendly, compact labels for the submission checklist below — the SAME
 * six services/lessonPlanValidationService.js LESSON_PLAN_STAGES values,
 * just shorter than the full guided-section question headings (those stay
 * exactly as they are on their own sections; this is a summary list, not
 * a second copy of each heading).
 */
const STAGE_CHECKLIST_LABELS = Object.freeze({
  [LESSON_PLAN_STAGES.CONCEPT]: 'Concepts',
  [LESSON_PLAN_STAGES.PURPOSE]: 'Why students are learning this',
  [LESSON_PLAN_STAGES.CONNECTION]: 'Self, Others, India',
  [LESSON_PLAN_STAGES.SHOWCASE]: 'Showcasing learning',
  [LESSON_PLAN_STAGES.EXPERIENCE]: 'Learning Activities',
  [LESSON_PLAN_STAGES.HELPING]: 'Helping each other learn',
});

/**
 * The submission check — an ALWAYS-VISIBLE checklist plus the Submit/
 * Resubmit action, per explicit product direction: the checklist is
 * advisory, never a gate. The ONE real submission requirement is
 * services/lessonPlanValidationService.js's own canSubmitLessonPlan()
 * (at least one Activity, no maximum) — everything else the checklist
 * reports (Student Action, Pair Explanation, Exit Ticket) is a warning
 * a teacher can see and choose to submit past, via the "Submit without
 * these?" confirmation
 * (ui/components/SubmitLessonPlanWarningsModal.js) — never a silent
 * lock and never a second, separate definition of "done" from
 * getLessonPlanReadiness()/getLessonPlanReadinessByStage().
 *
 * Three states:
 *   - Zero activities: the one real block. A clear reason, no Submit
 *     action at all (nothing to confirm past — there's truly nothing
 *     to submit yet).
 *   - Activities exist, but some checklist items are incomplete:
 *     checklist + Submit, which opens the confirmation modal first.
 *   - Everything complete: "Ready for review." + Submit, submits
 *     immediately — no confirmation manufactured just because the
 *     checklist happens to be complete.
 */
function renderReadinessPanel(plan, handlers) {
  // Not editable (SUBMITTED/APPROVED) — nothing actionable left to show
  // here; renderTitleBar's own status message already covers "what's
  // happening right now" for those two statuses.
  if (!handlers.editable) return document.createComment('lesson plan locked — no readiness action to show');

  const panel = document.createElement('div');
  panel.className = 'lesson-plan-builder__readiness';

  const heading = document.createElement('p');
  heading.className = 'lesson-plan-builder__readiness-heading';
  heading.textContent = 'Submission check';
  panel.appendChild(heading);

  if (!canSubmitLessonPlan(plan)) {
    panel.classList.add('lesson-plan-builder__readiness--blocked');
    const warning = document.createElement('p');
    warning.className = 'lesson-plan-builder__readiness-warning';
    warning.textContent = 'Add at least one Learning Activity before submitting.';
    panel.appendChild(warning);
    return panel;
  }

  const readiness = getLessonPlanReadiness(plan);
  const byStage = getLessonPlanReadinessByStage(plan);
  const incompleteStages = byStage.filter((entry) => !entry.complete);

  if (readiness.ready) {
    panel.classList.add('lesson-plan-builder__readiness--ready');
    heading.appendChild(createIcon('check-circle-2', { size: 16 }));
    const note = document.createElement('p');
    note.className = 'lesson-plan-builder__readiness-note';
    note.textContent = plan.status === LESSON_PLAN_STATUS.CHANGES_REQUESTED ? 'Ready to resubmit.' : 'Ready for review.';
    panel.appendChild(note);
  } else {
    // Compact by design, per explicit product direction: completed
    // stages consumed significant vertical space for very little real
    // information ("✓ Concepts / ✓ Purpose / ✓ Connection / ✓ Showcase"
    // never changes and never needs re-confirming). Only what still
    // needs attention is listed — the same underlying messages the
    // "Submit without these?" modal below also uses (see
    // getLessonPlanReadinessByStage()'s own doc comment), just flat
    // rather than grouped, since a short count-and-list reads faster
    // than a 6-row checklist for this purpose.
    panel.classList.add('lesson-plan-builder__readiness--warning');
    const allMessages = incompleteStages.flatMap((entry) => entry.messages);
    const note = document.createElement('p');
    note.className = 'lesson-plan-builder__readiness-note';
    note.textContent = `⚠ ${allMessages.length} item${allMessages.length === 1 ? '' : 's'} to consider`;
    panel.appendChild(note);

    const list = document.createElement('ul');
    list.className = 'lesson-plan-builder__readiness-checklist';
    allMessages.forEach((message) => {
      const item = document.createElement('li');
      item.className = 'lesson-plan-builder__readiness-checklist-item';
      item.textContent = message;
      list.appendChild(item);
    });
    panel.appendChild(list);
  }

  const isResubmit = plan.status === LESSON_PLAN_STATUS.CHANGES_REQUESTED;
  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary lesson-plan-builder__submit-button';
  submitButton.textContent = isResubmit ? 'Resubmit for Review' : 'Submit for Review';
  submitButton.addEventListener('click', () => {
    if (incompleteStages.length === 0) {
      handlers.onSubmitForReview();
      return;
    }
    openSubmitLessonPlanWarningsModal({
      isResubmit,
      warnings: incompleteStages.map(({ stage, messages }) => ({ label: STAGE_CHECKLIST_LABELS[stage], messages })),
      onSubmitAnyway: handlers.onSubmitForReview,
    });
  });
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
function renderGuidedContentStage({ stage, title, sectionKey, plan, state, handlers, renderFull, getPreview, tileSize = 'full', surface = false, alwaysExpanded = false }) {
  const isComplete = Boolean(state.stageCompletionByKey[stage]);
  const isFrontier = state.frontierStage === stage;
  const isReopened = state.reopenedStageKey === stage;

  const wrap = document.createElement('section');
  wrap.className = `lesson-plan-builder__stage lesson-plan-builder__tile--${tileSize}`;
  if (surface) wrap.classList.add('lesson-plan-builder__stage--surface-tile');

  // Experience/Helping (`alwaysExpanded: true`) never collapse to a
  // one-line summary, even once complete — unlike Purpose/Connection/
  // Showcase, these carry the actual TEACHING CONTENT (Spark, every
  // Activity, Activity Resources, the Helping fields) this whole
  // restructure exists to keep visible and followable top-to-bottom;
  // collapsing a "done" activity sequence to "✓ Is it fun, fast,
  // effective? — Mystery Box" would hide exactly the content a teacher
  // most needs right before actually teaching the lesson.
  if (isComplete && !isFrontier && !isReopened && !alwaysExpanded) {
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

  // "Primary" (needs-attention emphasis) for ANY still-incomplete stage,
  // never just the single old "frontier" — with every stage now always
  // rendered (see renderBuilder()'s own comment), more than one can be
  // incomplete at once, and every one of them deserves the same visual
  // weight. "Reopened" is for a genuinely COMPLETE stage a teacher
  // manually reopened to revisit — the one case that still needs the
  // lighter treatment plus its own "Done" collapse button below.
  wrap.classList.add(isComplete ? 'lesson-plan-builder__stage--reopened' : 'lesson-plan-builder__stage--primary');

  const headingRow = document.createElement('div');
  headingRow.className = 'lesson-plan-builder__stage-heading-row';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'lesson-plan-builder__stage-title-group';
  const heading = document.createElement('h2');
  heading.className = isComplete ? 'lesson-plan-builder__stage-heading' : 'lesson-plan-builder__stage-heading lesson-plan-builder__stage-heading--primary';
  heading.textContent = title;
  titleGroup.appendChild(heading);
  headingRow.appendChild(titleGroup);
  if (isReopened && isComplete) {
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

// ---------------------------------------------------------------------
// Learning Resources — Graphic Organizers, Anchor Charts, Videos,
// Reference Documents, or anything else supporting this lesson.
// Entirely optional, never part of submission readiness. Shown as
// clean cards (Title, Type, Associated section, Open/Edit/Remove);
// Add/Edit/Remove only ever render when `handlers.editable` — the SAME
// gate every other content section on this canvas already uses, per
// "follow the existing Lesson Plan editing permissions."
// ---------------------------------------------------------------------

const LESSON_RESOURCE_TYPE_LABELS = Object.freeze({
  [LESSON_RESOURCE_TYPES.GRAPHIC_ORGANIZER]: 'Graphic Organizer',
  [LESSON_RESOURCE_TYPES.ANCHOR_CHART]: 'Anchor Chart',
  [LESSON_RESOURCE_TYPES.VIDEO]: 'Video',
  [LESSON_RESOURCE_TYPES.REFERENCE_DOCUMENT]: 'Reference Document',
  [LESSON_RESOURCE_TYPES.OTHER]: 'Other',
});

/**
 * The human label for a resource's own `sectionKey` — resolved against
 * the plan's CURRENT `getLearningResourceSectionOptions()` list (never
 * a hardcoded "Activity 1..4"), so renaming an Activity immediately
 * updates every resource pointing at it. If the referenced Activity no
 * longer exists (deleted after the resource was attached to it), this
 * falls back to a plain, honest label rather than silently deleting the
 * teacher's own resource or throwing — the resource itself is never
 * removed as a side effect of an unrelated Activity's deletion.
 */
function resolveResourceSectionLabel(plan, sectionKey) {
  const options = lessonPlanService.getLearningResourceSectionOptions(plan);
  const match = options.find((option) => option.key === sectionKey);
  if (match) return match.label;
  if (sectionKey && sectionKey.startsWith('activity:')) return 'Activity removed';
  return 'Whole Lesson / General';
}

/** A plain section label above Concepts + Schedule — enough to read the two as one related "Lesson Overview" group without wrapping them in yet another bordered card of their own (each already has/doesn't have its own surface, unchanged). */
function renderLessonOverviewLabel() {
  const heading = document.createElement('p');
  heading.className = 'lesson-plan-builder__primary-section-heading';
  heading.textContent = 'Lesson Overview';
  return heading;
}

/** The Common Learning Resources scope — see renderLearningResourcesSection()'s own doc comment for the common-vs-activity-specific split. Filters to every resource NOT addressed to a specific Activity (Whole Lesson/General, Spark, Pair Explanation). */
function renderCommonLearningResources(plan, state, handlers) {
  return renderLearningResourcesSection(plan, state, handlers, {
    slot: 'common',
    filter: (resource) => !lessonPlanReviewService.getActivityIdFromSectionKey(resource.sectionKey),
    heading: 'Common Learning Resources',
    emptyText: 'Attach a Graphic Organizer, Anchor Chart, video, or reference document shared across the lesson.',
  });
}

/**
 * Renders ONE scope's worth of Learning Resources — either the shared
 * "Common Learning Resources" (everything NOT addressed to a specific
 * Activity: Whole Lesson/General, Spark, Pair Explanation) shown before
 * the activity sequence, or one Activity's own resources, shown inside
 * that Activity's own card. Same underlying `plan.resources[]`/
 * sectionKey model either way (see models/LessonPlan.js's own
 * createLessonPlanResource() doc comment) — this only changes WHERE a
 * given resource renders, never what a resource IS. `slot` identifies
 * which "+ Add Resource" form (if any) is currently open — `'common'`
 * or a real Activity id — so exactly one add form is ever open across
 * the whole canvas, always in the right place.
 */
function renderLearningResourcesSection(plan, state, handlers, { slot, filter, heading: headingText, emptyText, defaultSectionKey = null }) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__resources';

  const heading = document.createElement('p');
  heading.className = 'lesson-plan-builder__primary-section-heading';
  heading.textContent = headingText;
  wrap.appendChild(heading);

  const resources = (plan.resources || []).filter(filter);
  const isAddingHere = state.addingResourceSlot === slot;

  if (resources.length === 0 && !isAddingHere) {
    const empty = document.createElement('p');
    empty.className = 'lesson-plan-builder__resources-empty';
    empty.textContent = handlers.editable ? emptyText : 'No resources attached here yet.';
    wrap.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'lesson-plan-builder__resources-list';
    resources.forEach((resource) => {
      if (handlers.editable && state.editingResourceId === resource.id) {
        list.appendChild(
          renderResourceForm(plan, {
            resource,
            onSave: (values) => handlers.onSaveResourceEdit(resource.id, values),
            onCancel: handlers.onCancelEditResource,
            submitLabel: 'Save',
          })
        );
      } else {
        list.appendChild(renderResourceCard(plan, resource, handlers));
      }
    });
    wrap.appendChild(list);
  }

  if (handlers.editable) {
    if (isAddingHere) {
      wrap.appendChild(
        renderResourceForm(plan, {
          resource: null,
          onSave: handlers.onSaveNewResource,
          onCancel: handlers.onCancelAddResource,
          submitLabel: 'Add Resource',
          defaultSectionKey,
        })
      );
    } else {
      wrap.appendChild(createAddRowButton('+ Add Resource', () => handlers.onStartAddResource(slot)));
    }
  }

  return wrap;
}

function renderResourceCard(plan, resource, handlers) {
  const card = document.createElement('div');
  card.className = 'lesson-plan-builder__resource-card';

  const top = document.createElement('div');
  top.className = 'lesson-plan-builder__resource-card-top';

  const title = document.createElement('span');
  title.className = 'lesson-plan-builder__resource-card-title';
  title.textContent = resource.title;
  top.appendChild(title);

  const typeBadge = document.createElement('span');
  typeBadge.className = 'lesson-plan-builder__resource-card-type';
  typeBadge.textContent = LESSON_RESOURCE_TYPE_LABELS[resource.type] || resource.type;
  top.appendChild(typeBadge);

  card.appendChild(top);

  const section = document.createElement('span');
  section.className = 'lesson-plan-builder__resource-card-section';
  section.textContent = resolveResourceSectionLabel(plan, resource.sectionKey);
  card.appendChild(section);

  if (resource.description) {
    const description = document.createElement('p');
    description.className = 'lesson-plan-builder__resource-card-description';
    description.textContent = resource.description;
    card.appendChild(description);
  }

  const actions = document.createElement('div');
  actions.className = 'lesson-plan-builder__resource-card-actions';

  const openLink = document.createElement('a');
  openLink.className = 'btn btn--text';
  openLink.href = resource.url;
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  openLink.textContent = 'Open ↗';
  actions.appendChild(openLink);

  if (handlers.editable) {
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn--text';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => handlers.onStartEditResource(resource.id));
    actions.appendChild(editButton);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text lesson-plan-builder__resource-card-remove';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => handlers.onRemoveResource(resource.id, resource.title));
    actions.appendChild(removeButton);
  }

  card.appendChild(actions);

  return card;
}

/** The Add/Edit form — same fields either way; `resource` is null for a fresh Add, or the existing resource being edited (pre-filling every field). `defaultSectionKey` only applies to a fresh Add (e.g. an Activity's own "+ Add Resource" pre-scopes to that Activity) — ignored once editing a real resource, which always starts from its own current sectionKey. */
function renderResourceForm(plan, { resource, onSave, onCancel, submitLabel, defaultSectionKey = null }) {
  const form = document.createElement('div');
  form.className = 'lesson-plan-builder__resource-form';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'lesson-plan-builder__resource-form-input';
  titleInput.placeholder = 'Title (e.g. Water Cycle Anchor Chart)';
  titleInput.value = resource?.title || '';
  form.appendChild(titleInput);

  const typeSelect = document.createElement('select');
  typeSelect.className = 'lesson-plan-builder__resource-form-input';
  Object.entries(LESSON_RESOURCE_TYPE_LABELS).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    typeSelect.appendChild(option);
  });
  typeSelect.value = resource?.type || LESSON_RESOURCE_TYPES.OTHER;
  form.appendChild(typeSelect);

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'lesson-plan-builder__resource-form-input';
  urlInput.placeholder = 'https://… (link to the file, video, or document)';
  urlInput.value = resource?.url || '';
  form.appendChild(urlInput);

  const descriptionInput = document.createElement('textarea');
  descriptionInput.className = 'lesson-plan-builder__resource-form-input';
  descriptionInput.placeholder = 'Description (optional)';
  descriptionInput.value = resource?.description || '';
  attachAutoGrowTextarea(descriptionInput);
  form.appendChild(descriptionInput);

  // Section options are resolved fresh from the plan's CURRENT
  // activities every time this form renders — never a fixed list of
  // "Activity 1..4" (see lessonPlanService.getLearningResourceSectionOptions()'s
  // own doc comment).
  const sectionSelect = document.createElement('select');
  sectionSelect.className = 'lesson-plan-builder__resource-form-input';
  const sectionOptions = lessonPlanService.getLearningResourceSectionOptions(plan);
  sectionOptions.forEach(({ key, label }) => {
    const option = document.createElement('option');
    option.value = key === null ? '' : key;
    option.textContent = label;
    sectionSelect.appendChild(option);
  });
  sectionSelect.value = resource ? resource.sectionKey || '' : defaultSectionKey || '';
  form.appendChild(sectionSelect);

  const actions = document.createElement('div');
  actions.className = 'lesson-plan-builder__resource-form-actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--ghost';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', onCancel);
  actions.appendChild(cancelButton);

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = submitLabel;
  saveButton.addEventListener('click', () => {
    onSave({
      title: titleInput.value,
      type: typeSelect.value,
      url: urlInput.value,
      description: descriptionInput.value,
      sectionKey: sectionSelect.value || null,
    });
  });
  actions.appendChild(saveButton);

  form.appendChild(actions);

  return form;
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

/** Phase 4 — the "Browse Ideas" affordance (product-language rename from "+ From Teaching Ideas"; the underlying Teaching Ideas feature/service is unchanged), same visual weight as createAddRowButton() above, used everywhere a teacher can browse/copy in reusable content instead of writing it by hand. */
function createFromTeachingIdeasButton(onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--text lesson-plan-builder__from-teaching-ideas-button';
  button.appendChild(createIcon('search', { size: 12 }));
  button.append(' Browse Ideas');
  button.addEventListener('click', onClick);
  return button;
}

// ---- 4. FUN, FAST, EFFECTIVE — Spark ---------------------------------

/**
 * Spark — a quiet, secondary entry point next to Learning Activities'
 * own primary working area (see the freeTextStages EXPERIENCE config's
 * own renderFull(), which appends Activities first, Spark second).
 * Deliberately no "Optional"/"Required" label anywhere: the distinction
 * is entirely behavioral — Spark can be left completely untouched with
 * no effect on progression (see services/lessonPlanValidationService.js,
 * which has never gated on it), while at least one valid Activity
 * genuinely blocks the Experience stage.
 *
 * Reuses this Builder's own established "compact until interacted with"
 * convention (the exact same shape as isConceptPickerOpen/
 * isSchedulePickerOpen — see renderLessonPlanBuilderView()'s own local
 * state) rather than inventing a new component: blank AND not opened
 * -> one quiet prompt row (no fields rendered at all); already has real
 * content, OR the teacher tapped it open -> the exact same three
 * fields (title/Teacher Action/Student Action) this section has always
 * had, completely unchanged. `state` is optional — omitted entirely by
 * the locked/reviewer flat render (see renderBuilder()'s own
 * !handlers.editable branch), which always shows the full fields, same
 * as every other section in that read-only view.
 */
function renderSparkSection(plan, handlers, state = null) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__spark';

  const hasContent = Boolean(plan.spark.title || plan.spark.teacherAction || plan.spark.studentAction);
  const isOpen = !state || hasContent || state.isSparkOpen;

  if (!isOpen) {
    const heading = document.createElement('h3');
    heading.className = 'lesson-plan-builder__subheading lesson-plan-builder__subheading--quiet';
    heading.textContent = 'Spark';
    wrap.appendChild(heading);

    const promptRow = document.createElement('div');
    promptRow.className = 'lesson-plan-builder__spark-prompt-row';
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--text';
    addButton.textContent = '+ Add a Spark';
    addButton.addEventListener('click', handlers.onToggleSparkOpen);
    promptRow.appendChild(addButton);
    promptRow.appendChild(createFromTeachingIdeasButton(handlers.onOpenSparkPicker));
    wrap.appendChild(promptRow);

    return wrap;
  }

  // No collapse-back-to-compact affordance here, deliberately: once
  // Spark is opened (or already has real content), it just stays open
  // for the rest of the session — avoids a stale "Done" button that
  // would otherwise linger after filling a field, since field edits
  // persist via persistOnly() (a fast path that skips a full rerender
  // whenever the frontier stage itself hasn't changed — see this
  // Builder's own persistOnly() doc comment) and Spark never changes
  // the frontier.
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

function renderActivitiesSection(plan, collapsedActivityIds, handlers, state = null) {
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
      renderActivityCard(plan, activity, index, plan.activities.length, collapsedActivityIds.has(activity.id), handlers, state)
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
    fromTeachingIdeasButton.append(' Browse Ideas');
    fromTeachingIdeasButton.addEventListener('click', handlers.onOpenActivityPicker);
    addButtonRow.appendChild(fromTeachingIdeasButton);

    wrap.appendChild(addButtonRow);
  }

  return wrap;
}

function renderActivityCard(plan, activity, index, total, isCollapsed, handlers, state = null) {
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

  // Resource indicator — discoverable from the header itself, without
  // making the teacher open/scan the Activity's full content first (a
  // real reported gap). Same underlying resources[]/sectionKey this
  // Activity's own Learning Resources sub-section already reads from
  // (see renderActivityCard()'s own resources block below) — never a
  // second relationship, just a header-level shortcut into it.
  if (state) {
    const activitySectionKey = lessonPlanReviewService.buildActivitySectionKey(activity.id);
    const resourceCount = (plan.resources || []).filter((resource) => resource.sectionKey === activitySectionKey).length;
    if (resourceCount > 0 || handlers.editable) {
      const resourceBadge = document.createElement('button');
      resourceBadge.type = 'button';
      resourceBadge.className = 'lesson-plan-builder__activity-resource-badge';
      if (resourceCount > 0) {
        resourceBadge.textContent = `${resourceCount} Resource${resourceCount === 1 ? '' : 's'}`;
      } else {
        resourceBadge.classList.add('lesson-plan-builder__activity-resource-badge--empty');
        resourceBadge.textContent = '+ Resource';
      }
      resourceBadge.addEventListener('click', () => {
        const wasCollapsed = isCollapsed;
        if (resourceCount === 0 && handlers.editable) handlers.onStartAddResource(activity.id);
        if (wasCollapsed) handlers.onToggleActivityCollapse(activity.id);
        requestAnimationFrame(() => {
          document.getElementById(`lesson-plan-builder-activity-resources-${activity.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      cardHeader.appendChild(resourceBadge);
    }
  }

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

    // Two-column planning grid: Teacher Action (left) spans the full
    // height of whichever column ends up taller; Student Action (right)
    // holds either one plain block or the differentiated buckets — never
    // both at once, and Teacher Action is never repeated per bucket. See
    // css/styles.css's own `.lesson-plan-builder__activity-grid` comment
    // for why this reads correctly against AutoGrowTextarea's own
    // per-textarea height management.
    const grid = document.createElement('div');
    grid.className = 'lesson-plan-builder__activity-grid';

    const teacherColumn = document.createElement('div');
    teacherColumn.className = 'lesson-plan-builder__activity-grid-teacher';
    teacherColumn.appendChild(
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
    grid.appendChild(teacherColumn);

    const studentColumn = document.createElement('div');
    studentColumn.className = 'lesson-plan-builder__activity-grid-student';

    // Student Action always renders, regardless of Differentiation — a
    // 2026-09 refactor (e861bc3, the two-column layout) accidentally
    // made Differentiation REPLACE this field instead of supplementing
    // it, which made `activity.studentAction` permanently unreadable/
    // uneditable (and therefore permanently blank-if-blank) for any
    // activity with differentiation already added, silently blocking
    // getLessonPlanReadiness()'s own studentAction requirement forever
    // — the real cause of a real, reported "Submit never appears" case.
    // Differentiation is genuinely additional planning detail, not a
    // replacement for what students do, so both coexist here exactly
    // like they did before that refactor.
    studentColumn.appendChild(
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
      studentColumn.appendChild(renderDifferentiationFields(plan, activity, handlers));
    } else if (handlers.editable) {
      const addDiffButton = document.createElement('button');
      addDiffButton.type = 'button';
      addDiffButton.className = 'btn btn--ghost lesson-plan-builder__add-differentiation-button';
      addDiffButton.textContent = '+ Add differentiation';
      addDiffButton.addEventListener('click', () => handlers.onAddActivityDifferentiation(activity.id));
      studentColumn.appendChild(addDiffButton);
    }

    grid.appendChild(studentColumn);
    body.appendChild(grid);

    // Activity-specific Learning Resources — right where the teacher
    // needs them to actually teach this Activity, never in a separate
    // section they'd have to scroll away to find. Same underlying
    // resources[]/sectionKey model as Common Learning Resources above
    // (see renderLearningResourcesSection()'s own doc comment) — this
    // Activity's OWN id is simply this scope's filter/add-slot/default.
    if (state) {
      const activitySectionKey = lessonPlanReviewService.buildActivitySectionKey(activity.id);
      const resourcesSection = renderLearningResourcesSection(plan, state, handlers, {
        slot: activity.id,
        filter: (resource) => resource.sectionKey === activitySectionKey,
        heading: 'Learning Resources',
        emptyText: 'Attach a resource this Activity specifically needs.',
        defaultSectionKey: activitySectionKey,
      });
      resourcesSection.id = `lesson-plan-builder-activity-resources-${activity.id}`; // scroll target for this card's own header resource badge, see above
      body.appendChild(resourcesSection);
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

  // Each bucket renders as a subdivision of the Student Action column
  // (a colored accent + hairline divider), not as its own separate
  // card — see css/styles.css's own `.lesson-plan-builder__differentiation-bucket`
  // comment. Same Red Bucket / Green Bucket / Others fields, same
  // order, same editing behavior as before this layout change.
  [
    { field: 'redBucket', label: 'Red Bucket', placeholder: 'Extra support', colorKey: 'red' },
    { field: 'greenBucket', label: 'Green Bucket', placeholder: 'Extra stretch', colorKey: 'green' },
    { field: 'others', label: 'Others', placeholder: 'Any other differentiation', colorKey: 'others' },
  ].forEach(({ field, label, placeholder, colorKey }) => {
    const bucketWrap = document.createElement('div');
    bucketWrap.className = `lesson-plan-builder__differentiation-bucket lesson-plan-builder__differentiation-bucket--${colorKey}`;

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
    bucketWrap.appendChild(bucketField);
    wrap.appendChild(bucketWrap);
  });

  return wrap;
}

// ---- 5. HELPING EACH OTHER LEARN -------------------------------------

/**
 * Pair Explanation — one of the two remaining fields of Question 5,
 * "Are students helping me and others learn?" (models/LessonPlan.js's
 * own 5th question; see services/lessonPlanValidationService.js's own
 * LESSON_PLAN_STAGES.HELPING — now just Pair Explanation + Exit Ticket,
 * since Teacher Look-Fors was removed entirely). The field itself, its
 * label, its placeholder, its mutation
 * (lessonPlanService.updateHelpingEachOtherLearn()), and its own
 * sectionKey (LESSON_PLAN_SECTION_KEYS.PAIR_EXPLANATION) are unchanged
 * — this and renderExitTicketField() below are kept as two separate
 * functions (rather than merged into one) purely because they predate
 * the guided redesign; both are always rendered together under the
 * same Question 5 stage now (see
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
 * Exit Ticket — product-language rename of "Final Question" (Q5's
 * second field, see renderPairExplanationField()'s own doc comment
 * above). Deliberately still reads/writes `plan.finalQuestion` /
 * `LESSON_PLAN_SECTION_KEYS.FINAL_QUESTION` — a UI label change, not a
 * data migration, so existing stored content keeps rendering correctly
 * under its new name with zero risk to existing lesson plans.
 *
 * Teacher Look-Fors has been REMOVED entirely, per explicit product
 * decision — no longer a field, section, checklist item, or submission
 * warning anywhere in this view (see
 * services/lessonPlanValidationService.js's own getLessonPlanReadiness(),
 * which no longer checks it either). `plan.teacherLookFors` itself is
 * intentionally left alone in the data model — existing stored values on
 * older plans are neither edited nor deleted, simply no longer
 * displayed or required; see models/LessonPlan.js's own header comment
 * for this app's established "never silently discard legacy data"
 * convention (already applied once before, to lessonObjective/
 * swbatObjectives).
 */
function renderExitTicketField(plan, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-builder__helping-extra';

  const exitTicketField = createLabeledTextarea({
    label: 'Exit Ticket',
    placeholder: 'One closing question to check understanding',
    value: plan.finalQuestion,
    onChange: (value) => handlers.onHelpingEachOtherLearnChange('finalQuestion', value),
    disabled: !handlers.editable,
    plan,
    sectionKey: LESSON_PLAN_SECTION_KEYS.FINAL_QUESTION,
  });
  if (handlers.editable) exitTicketField.appendChild(createFromTeachingIdeasButton(handlers.onOpenFinalQuestionPicker));
  wrap.appendChild(exitTicketField);

  return wrap;
}
