/**
 * ui/views/ProgramManagerChapterPlanReviewView.js
 *
 * The reviewer's own read-only way of looking at a Chapter Plan someone
 * else built — modeled directly on
 * ui/views/LessonPlanReviewView.js's own shape and philosophy (every
 * field renders as plain text, never an `<input>`/`<textarea>`; a
 * comment affordance sits directly under whichever section it's about,
 * never a flat list at the bottom), re-scoped to Chapter Plan's own,
 * simpler four-section structure (Purpose & Integration / Mastery /
 * Methods / Subject-Specific — see models/ChapterPlan.js's own
 * CHAPTER_PLAN_SECTION_KEYS) rather than LessonPlan's per-Activity
 * granularity, which nothing about this model has an equivalent of.
 *
 * Comment flow — deliberately the SAME V1 shape
 * ui/views/LessonPlanReviewView.js's own header comment already
 * documents: comments accumulate in local, UNPERSISTED state
 * (`pendingComments`) as the PM reads through the plan, then are sent
 * together the moment a real action is taken — Request Changes
 * (requires at least one, enforced by
 * services/chapterPlanReviewService.js's own requestChapterPlanChanges()
 * itself, never re-implemented here) or Approve (comments optional).
 * Nothing is written to Firestore until one of those two buttons is
 * pressed.
 *
 * Every lifecycle transition goes through
 * services/chapterPlanReviewService.js — this view never sets
 * `plan.status` or pushes onto `plan.reviewHistory`/`activeComments`
 * directly. Immediately after a successful save, this view also
 * upserts `chapterPlanReviewIndex`'s own entry for this plan (see
 * services/chapterPlanReviewIndexService.js's own
 * buildChapterPlanReviewIndexEntry()) — the exact same "two separate
 * writes, index sync wrapped in its own non-blocking try/catch"
 * convention ui/views/LessonPlanReviewView.js's own onRequestChanges()/
 * onApprove() already establish for `weeklyPlanReviewIndex`.
 *
 * Permission is re-checked here, not just assumed from how the PM got
 * to this screen (see services/chapterPlanReviewService.js's own
 * canReviewChapterPlan()/canApproveChapterPlan()) — the two action
 * buttons only render at all for someone actually authorized to press
 * them. firestore.rules' own `chapterPlans` block enforces the same
 * boundary again at the data layer, so a hidden button is a UX nicety
 * here, never the only gate.
 *
 * Staleness — this view is the one place
 * services/chapterPlanReviewIndexService.js's own
 * isChapterPlanReviewIndexEntryStale() is actually exercised: after
 * fetching the REAL, canonical ChapterPlan (always the source of truth
 * for content AND for which actions even render), it also looks up
 * this plan's own `chapterPlanReviewIndex` entry and — purely for a
 * quiet, informational note, NEVER to gate any action — flags whether
 * that entry had gone stale by the time it's actually viewed. Every
 * real action (Request Changes/Approve) always acts on the freshly-
 * fetched canonical `plan`, never on the index entry, so a stale or
 * even entirely MISSING index entry can never cause an approval or a
 * request-changes to happen against outdated data — it can, at most,
 * make this one informational note appear.
 */

import * as chapterPlanRepository from '../../repositories/chapterPlanRepository.js';
import * as chapterPlanReviewService from '../../services/chapterPlanReviewService.js';
import * as chapterPlanReviewIndexService from '../../services/chapterPlanReviewIndexService.js';
import * as chapterPlanReviewIndexRepository from '../../repositories/chapterPlanReviewIndexRepository.js';
import * as sparkRepository from '../../repositories/sparkRepository.js';
import * as resourceRepository from '../../services/resourceRepository.js';
import * as plannerRepository from '../../services/plannerRepository.js';
import { getChapterPlanProgress } from '../../services/chapterPlanProgressService.js';
import { CHAPTER_PLAN_STATUS, CHAPTER_PLAN_SECTION_KEYS, CHAPTER_PLAN_SPARK_SECTIONS } from '../../models/ChapterPlan.js';
import { getChapterPlanTemplateConfig } from '../../config/chapterPlanTemplateConfig.js';
import { getSparkCardDisplay } from '../components/SparkCardDisplay.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { formatRelativeTimestamp } from '../../utils/dateHelpers.js';

const STATUS_LABELS = Object.freeze({
  [CHAPTER_PLAN_STATUS.DRAFT]: 'Draft',
  [CHAPTER_PLAN_STATUS.SUBMITTED]: 'Submitted for Review',
  [CHAPTER_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [CHAPTER_PLAN_STATUS.APPROVED]: 'Approved',
});

function getDisplayName(classroom, uid) {
  return classroom.members?.[uid]?.displayName || 'A teacher';
}

export function renderProgramManagerChapterPlanReviewView(container, { classroom, currentUser, chapterPlanId, onBack }) {
  let plan = null; // null = loading
  let loadError = null;
  let actionError = null;
  let isSubmittingAction = false;
  let isIndexStale = false;
  let sparksById = new Map(); // sparkId -> Spark | null (fetched once the plan loads)
  let resourcesByLinkId = new Map(); // resourceLinkId -> Resource | null
  // Backs the same derived "Lessons Planned" readout as
  // ui/views/ChapterPlanEditorView.js's own renderLessonsProgressReadout()
  // — `null` = not yet fetched (or fetch failed), never conflated with
  // `[]` (fetched, genuinely none).
  let lessons = null;
  const pendingComments = []; // [{ sectionKey, text }] — accumulated locally, not yet saved
  let openCommentFormKey = null;
  const collapsedCommentSectionKeys = new Set();

  function rerender() {
    renderReview(
      container,
      { classroom, plan, loadError, actionError, isSubmittingAction, isIndexStale, sparksById, resourcesByLinkId, lessons, pendingComments, openCommentFormKey, collapsedCommentSectionKeys },
      {
        onBack,
        canReview: plan ? chapterPlanReviewService.canReviewChapterPlan(classroom, plan, currentUser?.uid) : false,
        canApprove: plan ? chapterPlanReviewService.canApproveChapterPlan(classroom, plan, currentUser?.uid) : false,

        onOpenCommentForm: (sectionKey) => {
          openCommentFormKey = sectionKey;
          collapsedCommentSectionKeys.delete(sectionKey);
          rerender();
        },
        onCancelCommentForm: () => {
          openCommentFormKey = null;
          rerender();
        },
        onToggleCommentPanel: (sectionKey) => {
          if (collapsedCommentSectionKeys.has(sectionKey)) collapsedCommentSectionKeys.delete(sectionKey);
          else collapsedCommentSectionKeys.add(sectionKey);
          rerender();
        },
        onAddPendingComment: (sectionKey, text) => {
          if (!text.trim()) return;
          pendingComments.push({ sectionKey, text: text.trim() });
          openCommentFormKey = null;
          actionError = null;
          rerender();
        },
        onRemovePendingComment: (index) => {
          pendingComments.splice(index, 1);
          rerender();
        },

        onRequestChanges: async () => {
          if (pendingComments.length === 0) {
            actionError = 'Add at least one comment explaining what needs to change before requesting changes.';
            rerender();
            return;
          }
          isSubmittingAction = true;
          rerender();
          try {
            chapterPlanReviewService.requestChapterPlanChanges(classroom, plan, {
              byUid: currentUser?.uid || null,
              comments: pendingComments.map(({ sectionKey, text }) => ({ sectionKey, text })),
            });
            await chapterPlanRepository.saveChapterPlan(classroom.id, plan);
            pendingComments.length = 0;
            await syncReviewIndex();
          } catch (error) {
            console.error('[ProgramManagerChapterPlanReviewView] Failed to request changes:', error);
            actionError = "Couldn't send this — check your connection and try again.";
          }
          isSubmittingAction = false;
          rerender();
        },
        onApprove: async () => {
          isSubmittingAction = true;
          rerender();
          try {
            chapterPlanReviewService.approveChapterPlan(classroom, plan, {
              byUid: currentUser?.uid || null,
              comments: pendingComments.map(({ sectionKey, text }) => ({ sectionKey, text })),
            });
            await chapterPlanRepository.saveChapterPlan(classroom.id, plan);
            pendingComments.length = 0;
            await syncReviewIndex();
          } catch (error) {
            console.error('[ProgramManagerChapterPlanReviewView] Failed to approve:', error);
            actionError = "Couldn't send this — check your connection and try again.";
          }
          isSubmittingAction = false;
          rerender();
        },
      }
    );
  }

  /** Same non-blocking "the real transition already succeeded and is saved; the discovery index is never the source of truth" treatment ui/views/LessonPlanReviewView.js's own onApprove()/onRequestChanges() already establish for weeklyPlanReviewIndex. */
  async function syncReviewIndex() {
    try {
      await chapterPlanReviewIndexRepository.upsertChapterPlanReviewIndexEntry(chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom, plan));
    } catch (indexError) {
      console.error('[ProgramManagerChapterPlanReviewView] Reviewed, but failed to update the Chapter Plan review index:', indexError);
    }
  }

  async function loadContextualSparksAndResources() {
    const uniqueSparkIds = [...new Set((plan.sparkRefs || []).map((ref) => ref.sparkId))];
    const sparkEntries = await Promise.all(
      uniqueSparkIds.map(async (sparkId) => {
        try {
          return [sparkId, await sparkRepository.getSparkById(sparkId)];
        } catch (error) {
          console.error('[ProgramManagerChapterPlanReviewView] Failed to load a referenced Spark:', error);
          return [sparkId, null];
        }
      })
    );
    sparksById = new Map(sparkEntries);

    const linksByClassroomId = new Map();
    (plan.resourceLinks || []).forEach((link) => {
      if (!linksByClassroomId.has(link.classroomId)) linksByClassroomId.set(link.classroomId, []);
      linksByClassroomId.get(link.classroomId).push(link);
    });
    const resourceEntries = [];
    await Promise.all(
      [...linksByClassroomId.entries()].map(async ([linkClassroomId, links]) => {
        try {
          const resources = await resourceRepository.getResourcesForClassroom(linkClassroomId);
          const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
          links.forEach((link) => resourceEntries.push([link.id, resourceById.get(link.resourceId) || null]));
        } catch (error) {
          console.error('[ProgramManagerChapterPlanReviewView] Failed to load referenced Resources:', error);
          links.forEach((link) => resourceEntries.push([link.id, null]));
        }
      })
    );
    resourcesByLinkId = new Map(resourceEntries);
  }

  rerender();

  (async () => {
    try {
      const fetchedPlan = await chapterPlanRepository.getChapterPlanById(classroom.id, chapterPlanId);
      if (!fetchedPlan) {
        loadError = "This Chapter Plan couldn't be found. It may have been deleted.";
        rerender();
        return;
      }
      plan = fetchedPlan;
      rerender();

      // Informational only — see this file's own header comment on why
      // staleness here never gates any action.
      try {
        const indexEntries = await chapterPlanReviewIndexRepository.getChapterPlanReviewIndexEntriesForClassroomIds([classroom.id]);
        const matchingEntry = indexEntries.find((entry) => entry.chapterPlanId === chapterPlanId) || null;
        isIndexStale = chapterPlanReviewIndexService.isChapterPlanReviewIndexEntryStale(matchingEntry, plan);
      } catch (indexError) {
        console.error('[ProgramManagerChapterPlanReviewView] Failed to check the Chapter Plan review index for staleness:', indexError);
      }

      await loadContextualSparksAndResources();

      try {
        lessons = await plannerRepository.getLessonsForUnit(classroom.id, plan.curriculumUnitId);
      } catch (lessonsError) {
        console.error('[ProgramManagerChapterPlanReviewView] Failed to load Lessons for the "Lessons Planned" readout:', lessonsError);
        lessons = null;
      }
      rerender();
    } catch (error) {
      console.error('[ProgramManagerChapterPlanReviewView] Failed to load chapter plan:', error);
      loadError = "Couldn't load this Chapter Plan. Check your connection and try again.";
      rerender();
    }
  })();
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderReview(container, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'lesson-plan-review';

  const header = document.createElement('header');
  header.className = 'lesson-plan-review__header';
  header.appendChild(createBackButton(handlers.onBack));
  wrapper.appendChild(header);

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'lesson-plan-review__error';
    error.textContent = state.loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (!state.plan) {
    const loading = document.createElement('p');
    loading.className = 'lesson-plan-review__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  const { classroom, plan } = state;

  wrapper.appendChild(renderPlanHeader(classroom, plan));

  if (state.isIndexStale) {
    const note = document.createElement('p');
    note.className = 'lesson-plan-review__actions-note';
    note.textContent = 'This plan changed since it was listed in your queue — you\'re viewing its latest version.';
    wrapper.appendChild(note);
  }

  wrapper.appendChild(
    renderSection('Purpose & Integration', renderPurposeContent(plan, state.lessons), plan, CHAPTER_PLAN_SECTION_KEYS.PURPOSE, state, handlers)
  );
  wrapper.appendChild(renderSection('Mastery', renderMasteryContent(plan), plan, CHAPTER_PLAN_SECTION_KEYS.MASTERY, state, handlers));
  wrapper.appendChild(
    renderSection('Methods', renderMethodsContent(plan, state), plan, CHAPTER_PLAN_SECTION_KEYS.METHODS, state, handlers)
  );

  const config = getChapterPlanTemplateConfig(plan.subjectId);
  if (config.subjectSpecificFields.length > 0) {
    wrapper.appendChild(
      renderSection(`${config.label} — Subject-Specific`, renderSubjectSpecificContent(plan, state, config), plan, CHAPTER_PLAN_SECTION_KEYS.SUBJECT_SPECIFIC, state, handlers)
    );
  }

  wrapper.appendChild(renderReviewHistory(classroom, plan));
  wrapper.appendChild(renderReviewActions(state, handlers));

  container.appendChild(wrapper);
}

function renderPlanHeader(classroom, plan) {
  const header = document.createElement('div');
  header.className = 'lesson-plan-review__plan-header';

  const title = document.createElement('h1');
  title.className = 'lesson-plan-review__title';
  title.textContent = plan.chapterName || 'Untitled Chapter Plan';
  header.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'lesson-plan-review__meta';
  const teacherName = getDisplayName(classroom, plan.teacherUid);
  const subjectLabel = getChapterPlanTemplateConfig(plan.subjectId).label;
  const metaParts = [teacherName, classroom.name || 'This classroom', subjectLabel, plan.gradeLabel, plan.termId].filter(Boolean);
  meta.textContent = metaParts.join(' · ');
  header.appendChild(meta);

  const statusBadge = document.createElement('span');
  statusBadge.className = `lesson-plan-review__status-badge lesson-plan-review__status-badge--${plan.status}`;
  statusBadge.textContent = `Status: ${STATUS_LABELS[plan.status] || plan.status}`;
  header.appendChild(statusBadge);

  return header;
}

function renderSection(heading, contentEl, plan, sectionKey, state, handlers) {
  const section = document.createElement('section');
  section.className = 'lesson-plan-review__section';

  const headingEl = document.createElement('h2');
  headingEl.className = 'lesson-plan-review__section-heading';
  headingEl.textContent = heading;

  section.appendChild(renderCommentableSegment({ headingEl, content: contentEl, sectionKey, plan, state, handlers }));

  return section;
}

function renderReadOnlyField(label, value) {
  const field = document.createElement('div');
  field.className = 'lesson-plan-review__field';

  const labelEl = document.createElement('p');
  labelEl.className = 'lesson-plan-review__field-label';
  labelEl.textContent = label;
  field.appendChild(labelEl);

  const valueEl = document.createElement('p');
  valueEl.className = 'lesson-plan-review__field-value';
  valueEl.textContent = value && String(value).trim() ? value : '—';
  if (!value || !String(value).trim()) valueEl.classList.add('lesson-plan-review__field-value--empty');
  field.appendChild(valueEl);

  return field;
}

function renderReadOnlyListField(label, values) {
  const field = document.createElement('div');
  field.className = 'lesson-plan-review__field';

  const labelEl = document.createElement('p');
  labelEl.className = 'lesson-plan-review__field-label';
  labelEl.textContent = label;
  field.appendChild(labelEl);

  const nonBlank = (values || []).filter((value) => value && value.trim());
  if (nonBlank.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lesson-plan-review__field-value lesson-plan-review__field-value--empty';
    empty.textContent = '—';
    field.appendChild(empty);
    return field;
  }

  const list = document.createElement('ul');
  list.className = 'lesson-plan-review__swbat-list';
  nonBlank.forEach((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    list.appendChild(item);
  });
  field.appendChild(list);
  return field;
}

// ---- Comment panels — shared by every commentable section, same shape
// as ui/views/LessonPlanReviewView.js's own renderCommentableSegment()
// family (this file's own header comment on why it's a self-contained
// reimplementation, not a shared module). ----

function renderCommentableSegment({ headingEl, content, sectionKey, plan, state, handlers }) {
  const headingRow = document.createElement('div');
  headingRow.className = 'lesson-plan-review__segment-heading-row';
  headingRow.appendChild(headingEl);

  const trigger = renderCommentTrigger(sectionKey, state, handlers);
  if (trigger) headingRow.appendChild(trigger);

  const panel = renderCommentPanel(sectionKey, plan, state, handlers);

  const body = document.createElement('div');
  body.className = panel
    ? 'lesson-plan-review__segment-body lesson-plan-review__segment-body--with-comments'
    : 'lesson-plan-review__segment-body';

  const contentCol = document.createElement('div');
  contentCol.className = 'lesson-plan-review__segment-content';
  contentCol.appendChild(content);
  body.appendChild(contentCol);

  if (panel) body.appendChild(panel);

  const frag = document.createDocumentFragment();
  frag.appendChild(headingRow);
  frag.appendChild(body);
  return frag;
}

function renderCommentTrigger(sectionKey, state, handlers) {
  if (!handlers.canReview) return null;
  if (state.openCommentFormKey === sectionKey) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--ghost lesson-plan-review__add-comment-button';
  button.appendChild(createIcon('plus', { size: 14 }));
  button.append(' Add comment');
  button.addEventListener('click', () => handlers.onOpenCommentForm(sectionKey));
  return button;
}

function renderCommentPanel(sectionKey, plan, state, handlers) {
  const existing = plan.activeComments.filter((comment) => comment.sectionKey === sectionKey);
  const pending = state.pendingComments
    .map((comment, index) => ({ ...comment, index }))
    .filter((comment) => comment.sectionKey === sectionKey);
  const formOpen = state.openCommentFormKey === sectionKey;

  if (existing.length === 0 && pending.length === 0 && !formOpen) return null;

  const panel = document.createElement('div');
  panel.className = 'lesson-plan-review__comment-panel';

  const totalCount = existing.length + pending.length;
  const isCollapsed = state.collapsedCommentSectionKeys.has(sectionKey) && !formOpen;

  if (totalCount > 0) {
    const panelHeader = document.createElement('button');
    panelHeader.type = 'button';
    panelHeader.className = 'lesson-plan-review__comment-panel-header';
    panelHeader.appendChild(createIcon('bell', { size: 14 }));
    const countLabel = document.createElement('span');
    countLabel.textContent = `${totalCount} comment${totalCount === 1 ? '' : 's'}`;
    panelHeader.appendChild(countLabel);
    panelHeader.appendChild(
      createIcon('arrow-right', { size: 12, className: `lesson-plan-review__comment-panel-chevron${isCollapsed ? '' : ' lesson-plan-review__comment-panel-chevron--expanded'}` })
    );
    panelHeader.addEventListener('click', () => handlers.onToggleCommentPanel(sectionKey));
    panel.appendChild(panelHeader);
  }

  if (!isCollapsed) {
    if (totalCount > 0) {
      const list = document.createElement('div');
      list.className = 'lesson-plan-review__comment-panel-list';
      existing.forEach((comment) => list.appendChild(renderCommentEntry({ comment, state })));
      pending.forEach((comment) => list.appendChild(renderCommentEntry({ comment, state, isPending: true, handlers })));
      panel.appendChild(list);
    }
    if (formOpen) panel.appendChild(renderCommentForm(sectionKey, handlers));
  }

  return panel;
}

function renderCommentEntry({ comment, state, isPending = false, handlers }) {
  const entry = document.createElement('div');
  entry.className = 'lesson-plan-review__comment-entry';

  const meta = document.createElement('div');
  meta.className = 'lesson-plan-review__comment-entry-meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'lesson-plan-review__comment-entry-name';
  nameEl.textContent = isPending ? 'You' : getDisplayName(state.classroom, comment.byUid);
  meta.appendChild(nameEl);
  if (!isPending && comment.createdAt) {
    const dateEl = document.createElement('span');
    dateEl.className = 'lesson-plan-review__comment-entry-date';
    dateEl.textContent = formatRelativeTimestamp(comment.createdAt);
    meta.appendChild(dateEl);
  }
  if (isPending) {
    const tag = document.createElement('span');
    tag.className = 'lesson-plan-review__comment-pending-tag';
    tag.textContent = 'Not sent yet';
    meta.appendChild(tag);
  }
  entry.appendChild(meta);

  const text = document.createElement('p');
  text.className = 'lesson-plan-review__comment-text';
  text.textContent = comment.text;
  entry.appendChild(text);

  if (isPending) {
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text btn--danger-text lesson-plan-review__comment-entry-remove';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => handlers.onRemovePendingComment(comment.index));
    entry.appendChild(removeButton);
  }

  return entry;
}

function renderCommentForm(sectionKey, handlers) {
  const form = document.createElement('div');
  form.className = 'lesson-plan-review__comment-form';
  const textarea = document.createElement('textarea');
  textarea.className = 'lesson-plan-review__comment-input';
  textarea.placeholder = 'e.g. Add at least two Essential Questions.';
  form.appendChild(textarea);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'lesson-plan-review__comment-form-actions';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary';
  addButton.textContent = 'Add Comment';
  addButton.addEventListener('click', () => handlers.onAddPendingComment(sectionKey, textarea.value));
  actionsRow.appendChild(addButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelCommentForm);
  actionsRow.appendChild(cancelButton);

  form.appendChild(actionsRow);
  return form;
}

// ---- Section content — read-only, plain text/lists only --------------

/** Same three states as ui/views/ChapterPlanEditorView.js's own renderLessonsProgressReadout() — `lessons === null` covers both "not yet fetched" and "fetch failed," deliberately never shown as "No lessons planned yet." */
function formatLessonsPlannedReadout(plan, lessons) {
  if (lessons === null) return 'Checking…';
  const progress = getChapterPlanProgress(lessons, plan);
  if (progress.lessonsPlanned === 0) return 'No lessons planned yet.';
  const lessonWord = progress.lessonsPlanned === 1 ? 'lesson' : 'lessons';
  const weekWord = progress.weeksSpanned === 1 ? 'week' : 'weeks';
  return `${progress.lessonsPlanned} ${lessonWord} planned across ${progress.weeksSpanned} ${weekWord}.`;
}

/**
 * `numberOfLessonsDays` itself is no longer shown here — per the
 * approved connected-planning architecture, a Chapter Plan's own
 * "lessons planned" is a DERIVED fact (services/chapterPlanProgressService.js),
 * not an authored field, so the reviewer sees the same live readout the
 * Fellow's own editor shows (ui/views/ChapterPlanEditorView.js's
 * renderLessonsProgressReadout()) rather than a stale, possibly-never-
 * populated number.
 */
function renderPurposeContent(plan, lessons) {
  const wrap = document.createElement('div');
  wrap.appendChild(renderReadOnlyField('Chapter Name', plan.chapterName));
  wrap.appendChild(renderReadOnlyField('Lessons Planned', formatLessonsPlannedReadout(plan, lessons)));
  wrap.appendChild(renderReadOnlyField("What's Worth Learning?", plan.purpose.whatsWorthLearning));
  wrap.appendChild(renderReadOnlyField('Why does learning this matter?', plan.purpose.whyDoesLearningMatter));
  wrap.appendChild(renderReadOnlyField('Important Concepts', plan.purpose.importantConcepts));
  wrap.appendChild(renderReadOnlyField('Supplementary Resources', plan.purpose.supplementaryResources));
  wrap.appendChild(renderReadOnlyListField('Essential Questions', plan.purpose.essentialQuestions));
  wrap.appendChild(renderReadOnlyListField('Objectives', plan.purpose.objectives));
  return wrap;
}

function renderMasteryContent(plan) {
  const wrap = document.createElement('div');
  wrap.appendChild(renderReadOnlyField('End of Chapter Showcase of Learning', plan.mastery.endOfChapterShowcase));
  wrap.appendChild(renderReadOnlyField('Book-back Question Types', plan.mastery.bookBackQuestionTypes));
  wrap.appendChild(renderReadOnlyField('Scope for LSRW', plan.mastery.lsrwScope));
  wrap.appendChild(renderReadOnlyField('Vocabulary / Anchor Charts', plan.mastery.vocabularyAndAnchorCharts));
  return wrap;
}

function renderMethodsContent(plan, state) {
  const wrap = document.createElement('div');
  const config = getChapterPlanTemplateConfig(plan.subjectId);

  wrap.appendChild(renderReadOnlyField('Key Methods', plan.methods.keyMethods));
  wrap.appendChild(renderSparkRefsReadOnly(plan, CHAPTER_PLAN_SPARK_SECTIONS.KEY_METHODS, state));

  if (config.showSimplifiedText) {
    wrap.appendChild(renderReadOnlyField('Simplified Text', plan.methods.simplifiedText));
  }

  wrap.appendChild(renderReadOnlyField('Revision Ideas', plan.methods.revisionIdeas));
  wrap.appendChild(renderSparkRefsReadOnly(plan, CHAPTER_PLAN_SPARK_SECTIONS.REVISION_IDEAS, state));

  wrap.appendChild(renderReadOnlyField('Resources', plan.methods.resources));
  wrap.appendChild(renderResourceLinksReadOnly(plan, state));

  return wrap;
}

function renderSubjectSpecificContent(plan, state, config) {
  const wrap = document.createElement('div');
  config.subjectSpecificFields.forEach((field) => {
    wrap.appendChild(renderReadOnlyField(field.label, plan.subjectSpecific[field.key]));
  });
  wrap.appendChild(renderSparkRefsReadOnly(plan, CHAPTER_PLAN_SPARK_SECTIONS.SUBJECT_SPECIFIC, state));
  return wrap;
}

// ---- Sparks/Resources — contextual, read-only, never editable here.
// The PM sees exactly what the Fellow attached; provenance (Spark
// creator, Resource classroom) is preserved, never hidden or reassigned
// — per explicit product direction, the PM is reviewing the PLAN, not
// approving individual Sparks/Resources or taking ownership of them.
// ---------------------------------------------------------------------

function renderSparkRefsReadOnly(plan, section, state) {
  const refs = (plan.sparkRefs || []).filter((ref) => ref.section === section);
  const wrap = document.createElement('div');
  wrap.className = 'chapter-plan-editor__spark-ref-list';
  if (refs.length === 0) return wrap;

  const heading = document.createElement('span');
  heading.className = 'chapter-plan-editor__spark-ref-list-heading';
  heading.textContent = 'Sparks used here';
  wrap.appendChild(heading);

  refs.forEach((ref) => {
    const spark = state.sparksById.get(ref.sparkId);
    const chip = document.createElement('span');
    chip.className = 'chapter-plan-editor__spark-ref-chip';
    chip.textContent = spark ? `${getSparkCardDisplay(spark).title} (${getSparkCardDisplay(spark).meta})` : 'A Spark (no longer available)';
    wrap.appendChild(chip);
  });

  return wrap;
}

function renderResourceLinksReadOnly(plan, state) {
  const links = plan.resourceLinks || [];
  const wrap = document.createElement('div');
  wrap.className = 'chapter-plan-editor__resource-link-list';
  if (links.length === 0) return wrap;

  const heading = document.createElement('span');
  heading.className = 'chapter-plan-editor__resource-link-list-heading';
  heading.textContent = 'Resources attached';
  wrap.appendChild(heading);

  links.forEach((link) => {
    const resource = state.resourcesByLinkId.get(link.id);
    const chip = document.createElement('span');
    chip.className = 'chapter-plan-editor__resource-link-chip';
    chip.textContent = resource ? resource.title : 'A Resource (no longer available)';
    wrap.appendChild(chip);
  });

  return wrap;
}

// ---- Review history — compact, append-only round list -----------------

function renderReviewHistory(classroom, plan) {
  const section = document.createElement('section');
  section.className = 'lesson-plan-review__history';

  if (plan.reviewHistory.length === 0) return section;

  const heading = document.createElement('h2');
  heading.className = 'lesson-plan-review__section-heading';
  heading.textContent = 'Review History';
  section.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'lesson-plan-review__history-list';
  plan.reviewHistory.forEach((round, index) => {
    const item = document.createElement('li');
    item.className = 'lesson-plan-review__history-item';
    const who = getDisplayName(classroom, round.byUid);
    const commentCount = round.comments.length;
    const commentText = commentCount === 0 ? 'no comments' : `${commentCount} comment${commentCount === 1 ? '' : 's'}`;
    item.textContent = `Round ${index + 1} — ${STATUS_LABELS[round.status] || round.status} by ${who} (${commentText})`;
    list.appendChild(item);
  });
  section.appendChild(list);

  return section;
}

// ---- Review actions ------------------------------------------------------

function renderReviewActions(state, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-review__actions';

  if (state.plan.status !== CHAPTER_PLAN_STATUS.SUBMITTED) {
    const note = document.createElement('p');
    note.className = 'lesson-plan-review__actions-note';
    note.textContent =
      state.plan.status === CHAPTER_PLAN_STATUS.APPROVED
        ? 'This Chapter Plan has already been approved.'
        : "This Chapter Plan isn't currently awaiting review.";
    wrap.appendChild(note);
    return wrap;
  }

  if (!handlers.canReview && !handlers.canApprove) {
    const note = document.createElement('p');
    note.className = 'lesson-plan-review__actions-note';
    note.textContent = "You're not able to review this Chapter Plan.";
    wrap.appendChild(note);
    return wrap;
  }

  if (state.actionError) {
    const error = document.createElement('p');
    error.className = 'lesson-plan-review__actions-error';
    error.textContent = state.actionError;
    wrap.appendChild(error);
  }

  const buttonRow = document.createElement('div');
  buttonRow.className = 'lesson-plan-review__actions-row';

  if (handlers.canReview) {
    const requestChangesButton = document.createElement('button');
    requestChangesButton.type = 'button';
    requestChangesButton.className = 'btn btn--secondary';
    requestChangesButton.textContent = 'Request Changes';
    requestChangesButton.disabled = state.isSubmittingAction;
    requestChangesButton.addEventListener('click', handlers.onRequestChanges);
    buttonRow.appendChild(requestChangesButton);
  }

  if (handlers.canApprove) {
    const approveButton = document.createElement('button');
    approveButton.type = 'button';
    approveButton.className = 'btn btn--primary';
    approveButton.textContent = 'Approve';
    approveButton.disabled = state.isSubmittingAction;
    approveButton.addEventListener('click', handlers.onApprove);
    buttonRow.appendChild(approveButton);
  }

  wrap.appendChild(buttonRow);

  return wrap;
}
