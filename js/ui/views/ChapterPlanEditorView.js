/**
 * ui/views/ChapterPlanEditorView.js
 *
 * The Chapter Plan Editor — preserves the four supplied templates' own
 * information architecture (PURPOSE AND INTEGRATION / MASTERY / METHODS
 * / subject-specific), rendered as clear section cards with large
 * editing areas, per explicit product direction ("do NOT reproduce the
 * spreadsheet/cell experience"). Deliberately simpler than
 * ui/views/LessonPlanBuilderView.js's own guided bento-grid system — a
 * Chapter Plan has four fixed sections, not a multi-question guided
 * flow with per-stage completion tracking, so a plain vertical stack of
 * cards is the right amount of structure here, not an invented
 * imitation of the Lesson Plan Builder's own, more elaborate UI.
 *
 * Persistence: every field commits on `change` (blur), not `input` —
 * matches ui/views/LessonPlanBuilderView.js's own convention — via the
 * shared ui/components/ProgrammeSessionSaveIndicator.js's
 * persistPatch() wrapper (Saving…/✓ Changes saved/Save failed), reused
 * as-is rather than re-invented.
 *
 * Editability: every field/action is disabled whenever
 * services/chapterPlanReviewService.js's own isChapterPlanEditable()
 * says no (SUBMITTED/APPROVED) — a friendlier, earlier signal than
 * waiting for services/chapterPlanService.js's own mutators to throw
 * (which they still do, as the real guard — this view's own disabling
 * is purely presentational, never the enforcement).
 *
 * Which subject-specific fields (and whether Simplified Text shows at
 * all) is decided ENTIRELY by config/chapterPlanTemplateConfig.js — this
 * file contains no `if (subjectId === 'mathematics')`-style branching
 * anywhere, per explicit product direction.
 */

import * as chapterPlanRepository from '../../repositories/chapterPlanRepository.js';
import * as chapterPlanReviewIndexRepository from '../../repositories/chapterPlanReviewIndexRepository.js';
import * as chapterPlanService from '../../services/chapterPlanService.js';
import * as chapterPlanReviewService from '../../services/chapterPlanReviewService.js';
import * as chapterPlanReviewIndexService from '../../services/chapterPlanReviewIndexService.js';
import * as plannerRepository from '../../services/plannerRepository.js';
import { getChapterPlanProgress, getChapterPlanWeeks, getChapterPlanLessons } from '../../services/chapterPlanProgressService.js';
import { resolveLessonConcepts } from '../../services/timetableDisplayService.js';
import { parsePeriodNumberFromTeachingSlotId } from '../../services/timetableService.js';
import { CHAPTER_PLAN_STATUS, CHAPTER_PLAN_SECTION_KEYS, CHAPTER_PLAN_SPARK_SECTIONS } from '../../models/ChapterPlan.js';
import { getChapterPlanTemplateConfig } from '../../config/chapterPlanTemplateConfig.js';
import { openSparkPickerModal } from '../components/SparkPickerModal.js';
import { openChapterPlanResourcePickerModal } from '../components/ChapterPlanResourcePickerModal.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { createBackButton } from '../components/BackButton.js';
import {
  formatRelativeTimestamp,
  getMondayStartOfWeek,
  getTodayDateKey,
  formatWeekDateRange,
  formatDateKeyWithWeekday,
} from '../../utils/dateHelpers.js';
import { resolveInitialChapterPlanTab, CHAPTER_PLAN_EDITOR_TABS } from './ChapterPlanEditorTabDisplay.js';

const STATUS_LABELS = Object.freeze({
  [CHAPTER_PLAN_STATUS.DRAFT]: 'Draft',
  [CHAPTER_PLAN_STATUS.SUBMITTED]: 'Submitted',
  [CHAPTER_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [CHAPTER_PLAN_STATUS.APPROVED]: 'Approved',
});

const SECTION_LABELS = Object.freeze({
  [CHAPTER_PLAN_SECTION_KEYS.CONTEXT]: 'Context',
  [CHAPTER_PLAN_SECTION_KEYS.PURPOSE]: 'Purpose & Integration',
  [CHAPTER_PLAN_SECTION_KEYS.MASTERY]: 'Mastery',
  [CHAPTER_PLAN_SECTION_KEYS.METHODS]: 'Methods',
  [CHAPTER_PLAN_SECTION_KEYS.SUBJECT_SPECIFIC]: 'Subject-Specific',
});

export function renderChapterPlanEditorView(
  container,
  { classroom, currentUser, chapterPlanId, onBack, onOpenWeek, onOpenLessonPlan, onOpenTimetable, initialTab }
) {
  let plan = null; // null = loading
  let loadError = null;
  let saveIndicator = null;
  // `lessons` backs the "Lessons Planned" readout, the "Weeks" tab, AND
  // the "Lessons" tab (see renderLessonsProgressReadout()/renderWeeksTab()/
  // renderLessonsTab() below) — one fetch, three derived readouts, never
  // anything the Chapter Plan itself stores. `null` (not yet fetched, or
  // fetch failed) is distinct from `[]` (fetched, genuinely none yet) so
  // each readout can tell "no lessons planned yet" from "couldn't check."
  let lessons = null;
  // Which of the three connected-planning perspectives is showing.
  // Resolved from the caller's own `?tab=` query param (see
  // ui/views/ChapterPlanEditorTabDisplay.js) so Back-navigation from a
  // Weeks/Lessons-tab-opened Weekly Plan/Lesson Plan can land directly
  // back on that same tab, not silently reset to Chapter.
  let activeTab = resolveInitialChapterPlanTab(initialTab);

  mount();

  async function mount() {
    try {
      plan = await chapterPlanRepository.getChapterPlanById(classroom.id, chapterPlanId);
      if (!plan) {
        loadError = 'This Chapter Plan could not be found.';
      }
    } catch (error) {
      console.error('[ChapterPlanEditorView] Failed to load chapter plan:', error);
      loadError = "Couldn't load this Chapter Plan. Check your connection and try again.";
    }
    rerender();

    if (plan) {
      try {
        lessons = await plannerRepository.getLessonsForUnit(classroom.id, plan.curriculumUnitId);
      } catch (error) {
        console.error('[ChapterPlanEditorView] Failed to load Lessons for the "Lessons Planned" readout:', error);
        lessons = null;
      }
      rerender();
    }
  }

  function persist(mutationFn) {
    return saveIndicator.persistPatch(async () => {
      mutationFn();
      await chapterPlanRepository.saveChapterPlan(classroom.id, plan);
      rerender();
    });
  }

  /**
   * Submit/resubmit — same `persist()` save path every other mutation
   * uses, PLUS the one thing genuinely unique to a status transition:
   * syncing `chapterPlanReviewIndex` afterward, in its own non-blocking
   * try/catch (see ui/views/ProgramManagerChapterPlanReviewView.js's own
   * identical treatment for requestChanges/approve — this is the third
   * and last of the four call sites task F asked for: submit, request
   * changes, resubmit [same code path as submit], approve). Without
   * this, a Fellow's submission would never appear in the PM's queue at
   * all — the index is written here, not inferred or backfilled
   * anywhere else.
   */
  async function onSubmit() {
    const succeeded = await persist(() => chapterPlanReviewService.submitChapterPlan(plan, { byUid: currentUser?.uid }));
    if (!succeeded) return;
    try {
      await chapterPlanReviewIndexRepository.upsertChapterPlanReviewIndexEntry(chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom, plan));
    } catch (indexError) {
      console.error('[ChapterPlanEditorView] Submitted, but failed to update the Chapter Plan review index:', indexError);
    }
  }

  function rerender() {
    container.innerHTML = '';

    if (loadError) {
      const wrapper = document.createElement('div');
      wrapper.className = 'chapter-plan-editor';
      wrapper.appendChild(createBackButton(onBack));
      const error = document.createElement('p');
      error.className = 'chapter-plan-editor__error';
      error.textContent = loadError;
      wrapper.appendChild(error);
      container.appendChild(wrapper);
      return;
    }

    if (!plan) {
      const wrapper = document.createElement('div');
      wrapper.className = 'chapter-plan-editor';
      const loading = document.createElement('p');
      loading.className = 'chapter-plan-editor__loading';
      loading.textContent = 'Loading…';
      wrapper.appendChild(loading);
      container.appendChild(wrapper);
      return;
    }

    saveIndicator = createSaveIndicatorController(classroom.id, plan);

    const editable = chapterPlanReviewService.isChapterPlanEditable(plan);
    const config = getChapterPlanTemplateConfig(plan.subjectId);

    const wrapper = document.createElement('div');
    wrapper.className = 'chapter-plan-editor';

    wrapper.appendChild(renderTitleBar(plan, editable));
    const reviewFeedback = renderReviewFeedback(plan);
    if (reviewFeedback) wrapper.appendChild(reviewFeedback);
    wrapper.appendChild(renderTabStrip());

    if (activeTab === CHAPTER_PLAN_EDITOR_TABS.WEEKS) {
      wrapper.appendChild(renderWeeksTab(plan));
    } else if (activeTab === CHAPTER_PLAN_EDITOR_TABS.LESSONS) {
      wrapper.appendChild(renderLessonsTab(plan));
    } else {
      wrapper.appendChild(renderPurposeSection(plan, editable));
      wrapper.appendChild(renderMasterySection(plan, editable));
      wrapper.appendChild(renderMethodsSection(plan, editable, config));
      if (config.subjectSpecificFields.length > 0) {
        wrapper.appendChild(renderSubjectSpecificSection(plan, editable, config));
      }
    }

    container.appendChild(wrapper);
  }

  /**
   * `[ Chapter ] [ Weeks ] [ Lessons ]` — the approved connected-planning
   * perspectives. Purely a local view-state toggle — never persisted,
   * never affects `plan` itself.
   */
  function renderTabStrip() {
    const strip = document.createElement('div');
    strip.className = 'chapter-plan-editor__tabs';

    [
      { key: CHAPTER_PLAN_EDITOR_TABS.CHAPTER, label: 'Chapter' },
      { key: CHAPTER_PLAN_EDITOR_TABS.WEEKS, label: 'Weeks' },
      { key: CHAPTER_PLAN_EDITOR_TABS.LESSONS, label: 'Lessons' },
    ].forEach(({ key, label }) => {
      const tabButton = document.createElement('button');
      tabButton.type = 'button';
      tabButton.className = `chapter-plan-editor__tab${activeTab === key ? ' chapter-plan-editor__tab--active' : ''}`;
      tabButton.textContent = label;
      tabButton.addEventListener('click', () => {
        if (activeTab === key) return;
        activeTab = key;
        rerender();
      });
      strip.appendChild(tabButton);
    });

    return strip;
  }

  // ---------------------------------------------------------------------
  // Title bar — status, chapter name, meta, submit, save indicator
  // ---------------------------------------------------------------------

  function renderTitleBar(currentPlan, editable) {
    const bar = document.createElement('div');
    bar.className = 'chapter-plan-editor__title-bar';

    const header = document.createElement('div');
    header.className = 'chapter-plan-editor__header-row';
    header.appendChild(createBackButton(onBack));

    const statusBadge = document.createElement('span');
    statusBadge.className = `chapter-plan-editor__status-badge chapter-plan-editor__status-badge--${currentPlan.status}`;
    statusBadge.textContent = STATUS_LABELS[currentPlan.status] || currentPlan.status;
    header.appendChild(statusBadge);

    if (editable) {
      const submitButton = document.createElement('button');
      submitButton.type = 'button';
      submitButton.className = 'btn btn--primary chapter-plan-editor__submit-button';
      submitButton.textContent = currentPlan.status === CHAPTER_PLAN_STATUS.CHANGES_REQUESTED ? 'Resubmit' : 'Submit for Review';
      submitButton.addEventListener('click', onSubmit);
      header.appendChild(submitButton);
    }

    bar.appendChild(header);

    const titleLine = document.createElement('div');
    titleLine.className = 'chapter-plan-editor__title-line';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'chapter-plan-editor__title-input';
    titleInput.value = currentPlan.chapterName;
    titleInput.disabled = !editable;
    titleInput.addEventListener('change', () => persist(() => chapterPlanService.updateContext(currentPlan, { chapterName: titleInput.value })));
    titleLine.appendChild(titleInput);
    bar.appendChild(titleLine);

    const metaLine = document.createElement('div');
    metaLine.className = 'chapter-plan-editor__meta-line';
    const config = getChapterPlanTemplateConfig(currentPlan.subjectId);
    [config.label, currentPlan.gradeLabel, currentPlan.termId].filter(Boolean).forEach((text) => {
      const pill = document.createElement('span');
      pill.className = 'chapter-plan-editor__meta-pill';
      pill.textContent = text;
      metaLine.appendChild(pill);
    });
    bar.appendChild(metaLine);

    bar.appendChild(saveIndicator.element);

    return bar;
  }

  /**
   * The minimum needed for "if CHANGES_REQUESTED, show that review
   * feedback exists" (task G) — a plain, read-only list of this plan's
   * own `activeComments`, using the EXISTING comment shape
   * (services/chapterPlanReviewService.js's own createChapterPlanComment())
   * verbatim, never a second comment system. `activeComments` is only
   * ever non-empty while CHANGES_REQUESTED (requestChapterPlanChanges()
   * populates it; submitChapterPlan() clears it via its own
   * closeCurrentRound()) — so checking its length is exactly equivalent
   * to checking status, and self-corrects the moment the Fellow
   * resubmits. Returns `null` (renders nothing) when there's nothing to
   * show, same "don't reserve layout for an empty state" convention
   * ui/views/LessonPlanReviewView.js's own renderCommentPanel() already
   * establishes. Deliberately read-only here — replying/resolving from
   * this side isn't part of this feature's comment model; the Fellow's
   * only actions are read the feedback, edit the plan, and resubmit.
   */
  function renderReviewFeedback(currentPlan) {
    if (!currentPlan.activeComments || currentPlan.activeComments.length === 0) return null;

    const panel = document.createElement('div');
    panel.className = 'chapter-plan-editor__review-feedback';

    const heading = document.createElement('h2');
    heading.className = 'chapter-plan-editor__review-feedback-heading';
    heading.textContent = `Changes requested (${currentPlan.activeComments.length})`;
    panel.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'chapter-plan-editor__review-feedback-list';
    currentPlan.activeComments.forEach((comment) => {
      const entry = document.createElement('div');
      entry.className = 'chapter-plan-editor__review-feedback-entry';

      const meta = document.createElement('span');
      meta.className = 'chapter-plan-editor__review-feedback-meta';
      const reviewerName = classroom.members?.[comment.byUid]?.displayName || 'Your reviewer';
      const sectionLabel = SECTION_LABELS[comment.sectionKey] || comment.sectionKey;
      meta.textContent = `${sectionLabel} — ${reviewerName}${comment.createdAt ? ' · ' + formatRelativeTimestamp(comment.createdAt) : ''}`;
      entry.appendChild(meta);

      const text = document.createElement('p');
      text.className = 'chapter-plan-editor__review-feedback-text';
      text.textContent = comment.text;
      entry.appendChild(text);

      list.appendChild(entry);
    });
    panel.appendChild(list);

    return panel;
  }

  // ---------------------------------------------------------------------
  // Section builders
  // ---------------------------------------------------------------------

  function renderSection(titleText) {
    const section = document.createElement('div');
    section.className = 'chapter-plan-editor__section';
    const heading = document.createElement('h2');
    heading.className = 'chapter-plan-editor__section-heading';
    heading.textContent = titleText;
    section.appendChild(heading);
    return section;
  }

  function renderTextField(section, { label, value, placeholder = '', disabled, textarea = true, onChange }) {
    const fieldLabel = document.createElement('label');
    fieldLabel.className = 'chapter-plan-editor__field-label';
    fieldLabel.textContent = label;

    const input = document.createElement(textarea ? 'textarea' : 'input');
    input.className = 'chapter-plan-editor__field-input';
    if (!textarea) input.type = 'text';
    input.value = value || '';
    input.placeholder = placeholder;
    input.disabled = disabled;
    input.addEventListener('change', () => onChange(input.value));

    fieldLabel.appendChild(input);
    section.appendChild(fieldLabel);
  }

  function renderStringListField(section, { label, values, disabled, onChange }) {
    const wrap = document.createElement('div');
    wrap.className = 'chapter-plan-editor__list-field';

    const heading = document.createElement('span');
    heading.className = 'chapter-plan-editor__field-label';
    heading.textContent = label;
    wrap.appendChild(heading);

    const rows = document.createElement('div');
    rows.className = 'chapter-plan-editor__list-rows';
    (values || []).forEach((value, index) => {
      const row = document.createElement('div');
      row.className = 'chapter-plan-editor__list-row';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'chapter-plan-editor__field-input';
      input.value = value;
      input.disabled = disabled;
      input.addEventListener('change', () => {
        const next = [...values];
        next[index] = input.value;
        onChange(next);
      });
      row.appendChild(input);

      if (!disabled) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn btn--text chapter-plan-editor__list-remove-button';
        removeButton.textContent = '×';
        removeButton.addEventListener('click', () => onChange(values.filter((_, i) => i !== index)));
        row.appendChild(removeButton);
      }

      rows.appendChild(row);
    });
    wrap.appendChild(rows);

    if (!disabled) {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn btn--text chapter-plan-editor__list-add-button';
      addButton.textContent = `+ Add`;
      addButton.addEventListener('click', () => onChange([...(values || []), '']));
      wrap.appendChild(addButton);
    }

    section.appendChild(wrap);
  }

  function renderBrowseSparksButton(sectionKey) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--secondary chapter-plan-editor__browse-sparks-button';
    button.textContent = '✨ Browse Sparks';
    button.addEventListener('click', () => {
      openSparkPickerModal({
        classroom,
        chapterPlan: plan,
        section: sectionKey,
        currentUserUid: currentUser?.uid,
        onSparkUsed: () => rerender(),
      });
    });
    return button;
  }

  function renderSparkRefsList(sectionKey, editable) {
    const refs = chapterPlanService.getSparkRefsForSection(plan, sectionKey);
    if (refs.length === 0) return null;

    const list = document.createElement('div');
    list.className = 'chapter-plan-editor__spark-ref-list';
    const heading = document.createElement('span');
    heading.className = 'chapter-plan-editor__spark-ref-list-heading';
    heading.textContent = 'Used in this Chapter Plan';
    list.appendChild(heading);

    refs.forEach((ref) => {
      const chip = document.createElement('span');
      chip.className = 'chapter-plan-editor__spark-ref-chip';
      chip.textContent = `Spark: ${ref.sparkId}`;
      if (editable) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'chapter-plan-editor__spark-ref-remove-button';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', 'Remove this Spark from this Chapter Plan (does not delete the Spark)');
        removeButton.addEventListener('click', () => persist(() => chapterPlanService.removeSparkRef(plan, ref.id)));
        chip.appendChild(removeButton);
      }
      list.appendChild(chip);
    });

    return list;
  }

  function renderResourceLinksList(editable) {
    const links = plan.resourceLinks || [];
    if (links.length === 0) return null;

    const list = document.createElement('div');
    list.className = 'chapter-plan-editor__resource-link-list';
    const heading = document.createElement('span');
    heading.className = 'chapter-plan-editor__resource-link-list-heading';
    heading.textContent = 'Attached Resources';
    list.appendChild(heading);

    links.forEach((link) => {
      const chip = document.createElement('span');
      chip.className = 'chapter-plan-editor__resource-link-chip';
      chip.textContent = link.resourceType ? `Resource (${link.resourceType})` : 'Resource';
      if (editable) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'chapter-plan-editor__resource-link-remove-button';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', 'Remove this Resource from this Chapter Plan (does not delete the Resource)');
        removeButton.addEventListener('click', () => persist(() => chapterPlanService.removeResourceLink(plan, link.id)));
        chip.appendChild(removeButton);
      }
      list.appendChild(chip);
    });

    return list;
  }

  /**
   * Replaces the old manually-entered "Number of Lessons/Days" number
   * input with a read-only, DERIVED readout — per the approved
   * connected-planning architecture, a Chapter Plan does not own
   * Lessons, so this count is never authored here; it's computed live
   * from Lesson documents via services/chapterPlanProgressService.js's
   * getChapterPlanProgress(). `currentPlan.numberOfLessonsDays` itself
   * is left in the model/Firestore document untouched (nothing reads or
   * writes it from this view anymore) — no migration, no field removal.
   *
   * Three states: still loading (`lessons === null` before the first
   * fetch resolves), fetch failed (`lessons === null` after mount()'s
   * own catch — same sentinel, distinguished only by whether mount()
   * has finished at least once; a failed fetch reads identically to
   * "still loading" here, which is the safe default: never claim "No
   * lessons planned yet" when the truth is simply unknown), and loaded
   * (`lessons` is an array, `[]` included).
   */
  function renderLessonsProgressReadout(currentPlan) {
    const wrap = document.createElement('div');
    wrap.className = 'chapter-plan-editor__lessons-progress';

    const label = document.createElement('span');
    label.className = 'chapter-plan-editor__field-label';
    label.textContent = 'Lessons Planned';
    wrap.appendChild(label);

    const text = document.createElement('p');
    text.className = 'chapter-plan-editor__lessons-progress-text';

    if (lessons === null) {
      text.textContent = 'Checking planned lessons…';
    } else {
      const progress = getChapterPlanProgress(lessons, currentPlan);
      if (progress.lessonsPlanned === 0) {
        text.textContent = 'No lessons planned yet.';
      } else {
        const lessonWord = progress.lessonsPlanned === 1 ? 'lesson' : 'lessons';
        const weekWord = progress.weeksSpanned === 1 ? 'week' : 'weeks';
        text.textContent = `${progress.lessonsPlanned} ${lessonWord} planned across ${progress.weeksSpanned} ${weekWord}.`;
      }
    }
    wrap.appendChild(text);

    return wrap;
  }

  // ---------------------------------------------------------------------
  // WEEKS — a chapter-filtered LENS over the existing Weekly Plan
  // ---------------------------------------------------------------------

  /**
   * The "Weeks" perspective — per the approved connected-planning
   * architecture, this is NEVER a second Weekly Plan/timetable
   * implementation. It only lists WHICH weeks this chapter has a real
   * footprint in (services/chapterPlanProgressService.js's own
   * getChapterPlanWeeks(), reusing the exact same `lessons` already
   * fetched for the "Lessons Planned" readout — one fetch, not two —
   * and the same classroomId+curriculumUnitId join, never
   * linkedCurriculumUnitId). Opening a week (or "This Week", always
   * offered even before any Lesson exists for it) navigates into the
   * SAME ui/views/WeeklyPlanReviewView.js the Fellow's own Weekly Plan
   * already uses — this view renders none of a week's own schedule
   * itself, so a week containing other chapters' periods is never
   * misrepresented here.
   */
  function renderWeeksTab(currentPlan) {
    const section = renderSection('Weeks');

    if (lessons === null) {
      const loading = document.createElement('p');
      loading.className = 'chapter-plan-editor__weeks-loading';
      loading.textContent = 'Checking planned weeks…';
      section.appendChild(loading);
      return section;
    }

    const openWeek = (weekStartDate) => onOpenWeek(currentPlan.teacherUid, weekStartDate, currentPlan.curriculumUnitId, currentPlan.chapterName);
    // getMondayStartOfWeek() expects a plain "YYYY-MM-DD" dateKey, never
    // a full ISO timestamp — see
    // ui/views/ProgramManagerWeeklyPlanQueueView.js's own identical fix.
    const currentWeekStartDate = getMondayStartOfWeek(getTodayDateKey());

    const jumpRow = document.createElement('div');
    jumpRow.className = 'chapter-plan-editor__weeks-jump-row';
    const jumpButton = document.createElement('button');
    jumpButton.type = 'button';
    jumpButton.className = 'btn btn--secondary';
    jumpButton.textContent = 'Open This Week →';
    jumpButton.addEventListener('click', () => openWeek(currentWeekStartDate));
    jumpRow.appendChild(jumpButton);
    section.appendChild(jumpRow);

    const weeks = getChapterPlanWeeks(lessons, currentPlan);

    if (weeks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'chapter-plan-editor__weeks-empty';
      empty.textContent = 'No weeks planned yet for this chapter.';
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement('div');
    list.className = 'chapter-plan-editor__weeks-list';
    weeks.forEach(({ weekStartDate, lessonCount }) => {
      const row = document.createElement('div');
      row.className = 'chapter-plan-editor__weeks-row';

      const label = document.createElement('span');
      label.className = 'chapter-plan-editor__weeks-row-label';
      const periodWord = lessonCount === 1 ? 'period' : 'periods';
      label.textContent = `Week of ${formatWeekDateRange(weekStartDate)} · ${lessonCount} ${periodWord}`;
      row.appendChild(label);

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'btn btn--text';
      openButton.textContent = 'Open →';
      openButton.addEventListener('click', () => openWeek(weekStartDate));
      row.appendChild(openButton);

      list.appendChild(row);
    });
    section.appendChild(list);

    return section;
  }

  // ---------------------------------------------------------------------
  // LESSONS — the atomic teaching occurrences belonging to this Chapter
  // ---------------------------------------------------------------------

  /**
   * The "Lessons" perspective — every real models/Lesson.js document
   * belonging to this Chapter (services/chapterPlanProgressService.js's
   * own getChapterPlanLessons(), same classroomId+curriculumUnitId join,
   * same `lessons` array already fetched for the other two tabs — no new
   * fetch), ordered chronologically. This tab is deliberately a read-only
   * INDEX, never a second Lesson/LessonPlan editor: Concepts are resolved
   * via the EXISTING services/timetableDisplayService.js's own
   * resolveLessonConcepts() (the same resolution
   * ui/views/WeeklyPlanReviewView.js's grid already uses), and the one
   * action per row always hands off to an EXISTING flow —
   * `onOpenLessonPlan` (the exact ui/views/WeeklyPlanReviewView.js's own
   * onOpenFullLessonPlan pattern) when `lesson.lessonPlanId` is already
   * set, or `onOpenTimetable` (where "Build Detailed Lesson Plan" itself
   * actually lives — see services/timetableLessonService.js's own
   * buildDetailedLessonPlanFromLesson()) when it isn't. This view never
   * calls that builder directly — doing so here would mean re-resolving
   * the Period Detail panel's own gating/context, which is exactly the
   * "parallel editor" this phase is not supposed to build.
   *
   * Lesson vs. LessonPlan stays an explicit, visible distinction per
   * row, never conflated: "Lesson" = this teaching occurrence has been
   * scheduled/planned at all (the row exists); "Detailed Lesson Plan" =
   * whether the separate, optional models/LessonPlan.js document has
   * been created for it — read straight off `lesson.lessonPlanId`,
   * never re-derived.
   */
  function renderLessonsTab(currentPlan) {
    const section = renderSection('Lessons');

    if (lessons === null) {
      const loading = document.createElement('p');
      loading.className = 'chapter-plan-editor__lessons-loading';
      loading.textContent = 'Checking lessons…';
      section.appendChild(loading);
      return section;
    }

    const chapterLessons = getChapterPlanLessons(lessons, currentPlan);

    if (chapterLessons.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'chapter-plan-editor__lessons-empty';
      empty.textContent = 'No lessons yet for this chapter.';
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement('div');
    list.className = 'chapter-plan-editor__lessons-list';
    chapterLessons.forEach((lesson) => {
      list.appendChild(renderLessonRow(lesson));
    });
    section.appendChild(list);

    return section;
  }

  function renderLessonRow(lesson) {
    const row = document.createElement('div');
    row.className = 'chapter-plan-editor__lessons-row';

    const meta = document.createElement('div');
    meta.className = 'chapter-plan-editor__lessons-row-meta';

    const dateLine = document.createElement('span');
    dateLine.className = 'chapter-plan-editor__lessons-row-date';
    const periodNumber = parsePeriodNumberFromTeachingSlotId(lesson.teachingSlotId);
    const periodLabel = periodNumber ? `Period ${periodNumber}` : 'Period —';
    dateLine.textContent = `${formatDateKeyWithWeekday(lesson.date)} · ${periodLabel}`;
    meta.appendChild(dateLine);

    const weekLine = document.createElement('span');
    weekLine.className = 'chapter-plan-editor__lessons-row-week';
    weekLine.textContent = `Week of ${formatWeekDateRange(getMondayStartOfWeek(lesson.date))}`;
    meta.appendChild(weekLine);

    const concepts = resolveLessonConcepts(classroom, lesson);
    const conceptsLine = document.createElement('span');
    conceptsLine.className = 'chapter-plan-editor__lessons-row-concepts';
    conceptsLine.textContent = concepts.length > 0 ? concepts.map((concept) => concept.title).join(', ') : 'No concepts yet';
    meta.appendChild(conceptsLine);

    row.appendChild(meta);

    const planStatus = document.createElement('div');
    planStatus.className = 'chapter-plan-editor__lessons-row-plan-status';

    if (lesson.lessonPlanId) {
      const label = document.createElement('span');
      label.className = 'chapter-plan-editor__lessons-row-plan-badge chapter-plan-editor__lessons-row-plan-badge--exists';
      label.textContent = 'Detailed Lesson Plan';
      planStatus.appendChild(label);

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'btn btn--text';
      openButton.textContent = 'Open Lesson Plan →';
      openButton.addEventListener('click', () => onOpenLessonPlan(lesson.lessonPlanId));
      planStatus.appendChild(openButton);
    } else {
      const label = document.createElement('span');
      label.className = 'chapter-plan-editor__lessons-row-plan-badge';
      label.textContent = 'No Detailed Lesson Plan yet';
      planStatus.appendChild(label);

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'btn btn--text';
      openButton.textContent = 'Open in Timetable →';
      openButton.addEventListener('click', () => onOpenTimetable());
      planStatus.appendChild(openButton);
    }

    row.appendChild(planStatus);

    return row;
  }

  // ---------------------------------------------------------------------
  // PURPOSE AND INTEGRATION
  // ---------------------------------------------------------------------

  function renderPurposeSection(currentPlan, editable) {
    const section = renderSection('Purpose & Integration');

    section.appendChild(renderLessonsProgressReadout(currentPlan));

    renderTextField(section, {
      label: "What's Worth Learning?",
      value: currentPlan.purpose.whatsWorthLearning,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updatePurpose(currentPlan, { whatsWorthLearning: value })),
    });
    renderTextField(section, {
      label: 'Why does learning this matter?',
      value: currentPlan.purpose.whyDoesLearningMatter,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updatePurpose(currentPlan, { whyDoesLearningMatter: value })),
    });
    renderTextField(section, {
      label: 'Important Concepts',
      value: currentPlan.purpose.importantConcepts,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updatePurpose(currentPlan, { importantConcepts: value })),
    });
    renderTextField(section, {
      label: 'Supplementary Resources',
      value: currentPlan.purpose.supplementaryResources,
      placeholder: getChapterPlanTemplateConfig(currentPlan.subjectId).placeholderHints.supplementaryResources,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updatePurpose(currentPlan, { supplementaryResources: value })),
    });
    renderStringListField(section, {
      label: 'Essential Questions',
      values: currentPlan.purpose.essentialQuestions,
      disabled: !editable,
      onChange: (next) => persist(() => chapterPlanService.updatePurpose(currentPlan, { essentialQuestions: next })),
    });
    renderStringListField(section, {
      label: 'Objectives',
      values: currentPlan.purpose.objectives,
      disabled: !editable,
      onChange: (next) => persist(() => chapterPlanService.updatePurpose(currentPlan, { objectives: next })),
    });

    return section;
  }

  // ---------------------------------------------------------------------
  // MASTERY
  // ---------------------------------------------------------------------

  function renderMasterySection(currentPlan, editable) {
    const section = renderSection('Mastery');

    renderTextField(section, {
      label: 'End of Chapter Showcase of Learning',
      value: currentPlan.mastery.endOfChapterShowcase,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updateMastery(currentPlan, { endOfChapterShowcase: value })),
    });
    renderTextField(section, {
      label: 'Book-back Question Types',
      value: currentPlan.mastery.bookBackQuestionTypes,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updateMastery(currentPlan, { bookBackQuestionTypes: value })),
    });
    renderTextField(section, {
      label: 'Scope for LSRW',
      value: currentPlan.mastery.lsrwScope,
      placeholder: 'Where applicable…',
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updateMastery(currentPlan, { lsrwScope: value })),
    });
    renderTextField(section, {
      label: 'Vocabulary / Anchor Charts',
      value: currentPlan.mastery.vocabularyAndAnchorCharts,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updateMastery(currentPlan, { vocabularyAndAnchorCharts: value })),
    });

    return section;
  }

  // ---------------------------------------------------------------------
  // METHODS
  // ---------------------------------------------------------------------

  function renderMethodsSection(currentPlan, editable, config) {
    const section = renderSection('Methods');

    renderTextField(section, {
      label: 'Key Methods',
      value: currentPlan.methods.keyMethods,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updateMethods(currentPlan, { keyMethods: value })),
    });
    if (editable) section.appendChild(renderBrowseSparksButton(CHAPTER_PLAN_SPARK_SECTIONS.KEY_METHODS));
    const keyMethodsSparks = renderSparkRefsList(CHAPTER_PLAN_SPARK_SECTIONS.KEY_METHODS, editable);
    if (keyMethodsSparks) section.appendChild(keyMethodsSparks);

    if (config.showSimplifiedText) {
      renderTextField(section, {
        label: 'Simplified Text',
        value: currentPlan.methods.simplifiedText,
        placeholder: 'A simplified version of the text, if needed…',
        disabled: !editable,
        onChange: (value) => persist(() => chapterPlanService.updateMethods(currentPlan, { simplifiedText: value })),
      });
    }

    renderTextField(section, {
      label: 'Revision Ideas',
      value: currentPlan.methods.revisionIdeas,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updateMethods(currentPlan, { revisionIdeas: value })),
    });
    if (editable) section.appendChild(renderBrowseSparksButton(CHAPTER_PLAN_SPARK_SECTIONS.REVISION_IDEAS));
    const revisionSparks = renderSparkRefsList(CHAPTER_PLAN_SPARK_SECTIONS.REVISION_IDEAS, editable);
    if (revisionSparks) section.appendChild(revisionSparks);

    renderTextField(section, {
      label: 'Resources',
      value: currentPlan.methods.resources,
      placeholder: config.placeholderHints.resources,
      disabled: !editable,
      onChange: (value) => persist(() => chapterPlanService.updateMethods(currentPlan, { resources: value })),
    });
    if (editable) {
      const attachButton = document.createElement('button');
      attachButton.type = 'button';
      attachButton.className = 'btn btn--secondary chapter-plan-editor__attach-resource-button';
      attachButton.textContent = '📎 Attach Resource';
      attachButton.addEventListener('click', () => {
        openChapterPlanResourcePickerModal({
          classroom,
          chapterPlan: currentPlan,
          currentUserUid: currentUser?.uid,
          onResourceAttached: () => rerender(),
        });
      });
      section.appendChild(attachButton);
    }
    const resourceLinks = renderResourceLinksList(editable);
    if (resourceLinks) section.appendChild(resourceLinks);

    return section;
  }

  // ---------------------------------------------------------------------
  // Subject-specific
  // ---------------------------------------------------------------------

  function renderSubjectSpecificSection(currentPlan, editable, config) {
    const section = renderSection(config.label + ' — Subject-Specific');

    config.subjectSpecificFields.forEach((field) => {
      renderTextField(section, {
        label: field.label,
        value: currentPlan.subjectSpecific[field.key],
        placeholder: field.placeholder,
        disabled: !editable,
        onChange: (value) => persist(() => chapterPlanService.updateSubjectSpecific(currentPlan, { [field.key]: value })),
      });
    });

    if (editable) section.appendChild(renderBrowseSparksButton(CHAPTER_PLAN_SPARK_SECTIONS.SUBJECT_SPECIFIC));
    const subjectSpecificSparks = renderSparkRefsList(CHAPTER_PLAN_SPARK_SECTIONS.SUBJECT_SPECIFIC, editable);
    if (subjectSpecificSparks) section.appendChild(subjectSpecificSparks);

    return section;
  }
}
