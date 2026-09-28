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
import { CHAPTER_PLAN_STATUS, CHAPTER_PLAN_SECTION_KEYS, CHAPTER_PLAN_SPARK_SECTIONS } from '../../models/ChapterPlan.js';
import { getChapterPlanTemplateConfig } from '../../config/chapterPlanTemplateConfig.js';
import { openSparkPickerModal } from '../components/SparkPickerModal.js';
import { openChapterPlanResourcePickerModal } from '../components/ChapterPlanResourcePickerModal.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { createBackButton } from '../components/BackButton.js';
import { formatRelativeTimestamp } from '../../utils/dateHelpers.js';

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

export function renderChapterPlanEditorView(container, { classroom, currentUser, chapterPlanId, onBack }) {
  let plan = null; // null = loading
  let loadError = null;
  let saveIndicator = null;

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
    wrapper.appendChild(renderPurposeSection(plan, editable));
    wrapper.appendChild(renderMasterySection(plan, editable));
    wrapper.appendChild(renderMethodsSection(plan, editable, config));
    if (config.subjectSpecificFields.length > 0) {
      wrapper.appendChild(renderSubjectSpecificSection(plan, editable, config));
    }

    container.appendChild(wrapper);
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

  // ---------------------------------------------------------------------
  // PURPOSE AND INTEGRATION
  // ---------------------------------------------------------------------

  function renderPurposeSection(currentPlan, editable) {
    const section = renderSection('Purpose & Integration');

    const numberField = document.createElement('label');
    numberField.className = 'chapter-plan-editor__field-label';
    numberField.textContent = 'Number of Lessons/Days';
    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.className = 'chapter-plan-editor__field-input chapter-plan-editor__field-input--number';
    numberInput.value = currentPlan.numberOfLessonsDays ?? '';
    numberInput.disabled = !editable;
    numberInput.addEventListener('change', () => {
      const parsed = numberInput.value === '' ? null : Number(numberInput.value);
      persist(() => chapterPlanService.updateContext(currentPlan, { numberOfLessonsDays: parsed }));
    });
    numberField.appendChild(numberInput);
    section.appendChild(numberField);

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
