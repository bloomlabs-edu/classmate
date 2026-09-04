/**
 * ui/views/LessonPlanReviewView.js
 *
 * The reviewer's own way of looking at a lesson someone else built —
 * deliberately NOT ui/views/LessonPlanBuilderView.js with every field
 * disabled. Per explicit product direction, a reviewer should feel like
 * they're reading a lesson, not auditing a form: every field here
 * renders as plain text (no `<input>`/`<textarea>` at all), Activities
 * stay visually distinct cards in their own real order, and a comment
 * affordance sits directly under whichever section/activity/sub-field
 * it's about — never a flat comment list bolted on at the bottom.
 *
 * Comment flow (V1, deliberately simple — see this feature's own
 * product brief): a reviewer can open "+ Add comment" under any
 * section/activity/sub-field, matching the same "reveal the form in
 * place, never a modal or prompt()" convention
 * ui/views/GoalDashboardView.js's own renderSuggestChangesForm()
 * already established for this app's closest precedent. Comments
 * accumulate in local, UNPERSISTED state (`pendingComments`) as the
 * reviewer reads through the whole lesson, then are sent together the
 * moment the reviewer takes a real action — Request Changes (which
 * requires at least one, per explicit product direction: a bare status
 * flip leaves the teacher nothing to act on) or Approve (comments
 * optional — praise like "keep this" shouldn't be lost just because
 * the lesson didn't need changes). Nothing is written to Firestore
 * until one of those two buttons is pressed; navigating away first
 * loses any draft comments — an accepted V1 tradeoff, not an oversight.
 *
 * Permission is re-checked here, not just assumed from how the teacher
 * got to this screen (see services/lessonPlanReviewService.js's own
 * canReviewLessonPlan()/canApproveLessonPlan() — same-classroom scope,
 * never the plan's own author): the two action buttons only render at
 * all for someone actually authorized to press them. The Firestore
 * rule for this collection enforces the same boundary again at the
 * data layer, so a hidden button is a UX nicety here, never the only
 * gate.
 */

import * as lessonPlanRepository from '../../services/lessonPlanRepository.js';
import * as lessonPlanReviewService from '../../services/lessonPlanReviewService.js';
import { LESSON_PLAN_STATUS, LESSON_PLAN_SECTION_KEYS } from '../../models/LessonPlan.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

const STATUS_LABELS = Object.freeze({
  [LESSON_PLAN_STATUS.DRAFT]: 'Draft',
  [LESSON_PLAN_STATUS.SUBMITTED]: 'Submitted for Review',
  [LESSON_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [LESSON_PLAN_STATUS.APPROVED]: 'Approved',
});

function getDisplayName(classroom, uid) {
  return classroom.members?.[uid]?.displayName || 'A teacher';
}

export function renderLessonPlanReviewView(container, { classroom, currentUser, lessonPlanId, onBack }) {
  let plan = null; // null = loading
  let loadError = null;
  let actionError = null;
  let isSubmittingAction = false;
  const pendingComments = []; // [{ sectionKey, text }] — accumulated locally, not yet saved
  let openCommentFormKey = null; // which section/activity's "+ Add comment" form is currently open

  function rerender() {
    renderReview(
      container,
      { classroom, plan, loadError, actionError, isSubmittingAction, pendingComments, openCommentFormKey },
      {
        onBack,
        currentUser,
        canReview: plan ? lessonPlanReviewService.canReviewLessonPlan(classroom, plan, currentUser?.uid) : false,
        canApprove: plan ? lessonPlanReviewService.canApproveLessonPlan(classroom, plan, currentUser?.uid) : false,

        onOpenCommentForm: (sectionKey) => {
          openCommentFormKey = sectionKey;
          rerender();
        },
        onCancelCommentForm: () => {
          openCommentFormKey = null;
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
            lessonPlanReviewService.requestChanges(classroom, plan, {
              byUid: currentUser?.uid || null,
              comments: pendingComments.map(({ sectionKey, text }) => ({ sectionKey, text })),
            });
            await lessonPlanRepository.saveLessonPlan(classroom.id, plan);
            pendingComments.length = 0;
          } catch (error) {
            console.error('[LessonPlanReviewView] Failed to request changes:', error);
            actionError = "Couldn't send this — check your connection and try again.";
          }
          isSubmittingAction = false;
          rerender();
        },
        onApprove: async () => {
          isSubmittingAction = true;
          rerender();
          try {
            lessonPlanReviewService.approve(classroom, plan, {
              byUid: currentUser?.uid || null,
              comments: pendingComments.map(({ sectionKey, text }) => ({ sectionKey, text })),
            });
            await lessonPlanRepository.saveLessonPlan(classroom.id, plan);
            pendingComments.length = 0;
          } catch (error) {
            console.error('[LessonPlanReviewView] Failed to approve:', error);
            actionError = "Couldn't send this — check your connection and try again.";
          }
          isSubmittingAction = false;
          rerender();
        },
      }
    );
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
      console.error('[LessonPlanReviewView] Failed to load lesson plan:', error);
      loadError = "Couldn't load this lesson plan. Check your connection and try again.";
      rerender();
    });
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

  wrapper.appendChild(
    renderSection('1. Why are students learning this?', [renderWhySection(plan)], plan, LESSON_PLAN_SECTION_KEYS.WHY, state, handlers)
  );
  wrapper.appendChild(
    renderSection('2. Will it advance Self, Others, and India?', [renderSelfOthersIndiaSection(plan)], plan, LESSON_PLAN_SECTION_KEYS.SELF_OTHERS_INDIA, state, handlers)
  );
  wrapper.appendChild(
    renderSection('3. Are students showcasing their learning?', [renderAssessmentSection(plan)], plan, LESSON_PLAN_SECTION_KEYS.ASSESSMENT, state, handlers)
  );
  wrapper.appendChild(
    renderSection('4. Lesson Flow', [renderSparkSection(plan), renderActivitiesSection(plan, state, handlers)], plan, LESSON_PLAN_SECTION_KEYS.SPARK, state, handlers)
  );
  wrapper.appendChild(renderHelpingEachOtherLearnSection(plan, state, handlers));

  wrapper.appendChild(renderReviewHistory(classroom, plan));

  wrapper.appendChild(renderReviewActions(state, handlers));

  container.appendChild(wrapper);
}

function renderPlanHeader(classroom, plan) {
  const header = document.createElement('div');
  header.className = 'lesson-plan-review__plan-header';

  const title = document.createElement('h1');
  title.className = 'lesson-plan-review__title';
  title.textContent = plan.topic || 'Untitled Lesson Plan';
  header.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'lesson-plan-review__meta';
  const teacherName = getDisplayName(classroom, plan.createdByUid);
  const gradeText = plan.gradeLabel ? ` · ${plan.gradeLabel}` : '';
  meta.textContent = `${teacherName} · ${classroom.name || 'This classroom'}${gradeText}`;
  header.appendChild(meta);

  const statusBadge = document.createElement('span');
  statusBadge.className = `lesson-plan-review__status-badge lesson-plan-review__status-badge--${plan.status}`;
  statusBadge.textContent = `Status: ${STATUS_LABELS[plan.status] || plan.status}`;
  header.appendChild(statusBadge);

  return header;
}

function renderSection(heading, children, plan, sectionKey, state, handlers) {
  const section = document.createElement('section');
  section.className = 'lesson-plan-review__section';

  const headingEl = document.createElement('h2');
  headingEl.className = 'lesson-plan-review__section-heading';
  headingEl.textContent = heading;
  section.appendChild(headingEl);

  children.forEach((child) => section.appendChild(child));

  section.appendChild(renderCommentAffordance(sectionKey, plan, state, handlers));

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
  valueEl.textContent = value && value.trim() ? value : '—';
  if (!value || !value.trim()) valueEl.classList.add('lesson-plan-review__field-value--empty');
  field.appendChild(valueEl);

  return field;
}

// ---- Comment affordance — shared by every section/activity/sub-field ----

function renderCommentAffordance(sectionKey, plan, state, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-plan-review__comments';

  const existing = plan.activeComments.filter((comment) => comment.sectionKey === sectionKey);
  existing.forEach((comment) => {
    const card = document.createElement('div');
    card.className = 'lesson-plan-review__comment-card';
    const text = document.createElement('p');
    text.className = 'lesson-plan-review__comment-text';
    text.textContent = comment.text;
    card.appendChild(text);
    wrap.appendChild(card);
  });

  state.pendingComments.forEach((comment, index) => {
    if (comment.sectionKey !== sectionKey) return;
    const card = document.createElement('div');
    card.className = 'lesson-plan-review__comment-card lesson-plan-review__comment-card--pending';
    const tag = document.createElement('span');
    tag.className = 'lesson-plan-review__comment-pending-tag';
    tag.textContent = 'Not sent yet';
    card.appendChild(tag);
    const text = document.createElement('p');
    text.className = 'lesson-plan-review__comment-text';
    text.textContent = comment.text;
    card.appendChild(text);
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text btn--danger-text';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => handlers.onRemovePendingComment(index));
    card.appendChild(removeButton);
    wrap.appendChild(card);
  });

  if (!handlers.canReview) return wrap;

  if (state.openCommentFormKey === sectionKey) {
    const form = document.createElement('div');
    form.className = 'lesson-plan-review__comment-form';
    const textarea = document.createElement('textarea');
    textarea.className = 'lesson-plan-review__comment-input';
    textarea.placeholder = 'e.g. Make the Student Action more observable.';
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
    wrap.appendChild(form);
  } else {
    const addCommentButton = document.createElement('button');
    addCommentButton.type = 'button';
    addCommentButton.className = 'btn btn--ghost lesson-plan-review__add-comment-button';
    addCommentButton.appendChild(createIcon('plus', { size: 14 }));
    addCommentButton.append(' Add comment');
    addCommentButton.addEventListener('click', () => handlers.onOpenCommentForm(sectionKey));
    wrap.appendChild(addCommentButton);
  }

  return wrap;
}

// ---- 1. WHY ----------------------------------------------------------

function renderWhySection(plan) {
  const wrap = document.createElement('div');
  wrap.appendChild(renderReadOnlyField('Lesson Objective', plan.lessonObjective));
  wrap.appendChild(renderReadOnlyField('Big Question', plan.bigQuestion));

  const swbatField = document.createElement('div');
  swbatField.className = 'lesson-plan-review__field';
  const label = document.createElement('p');
  label.className = 'lesson-plan-review__field-label';
  label.textContent = 'Students Will Be Able To (SWBAT)';
  swbatField.appendChild(label);

  if (plan.swbatObjectives.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lesson-plan-review__field-value lesson-plan-review__field-value--empty';
    empty.textContent = '—';
    swbatField.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'lesson-plan-review__swbat-list';
    plan.swbatObjectives.forEach((objective) => {
      const item = document.createElement('li');
      item.textContent = objective;
      list.appendChild(item);
    });
    swbatField.appendChild(list);
  }
  wrap.appendChild(swbatField);

  return wrap;
}

// ---- 2. SELF / OTHERS / INDIA ----------------------------------------

function renderSelfOthersIndiaSection(plan) {
  const wrap = document.createElement('div');
  wrap.appendChild(renderReadOnlyField('Self', plan.selfOthersIndia.self));
  wrap.appendChild(renderReadOnlyField('Others', plan.selfOthersIndia.others));
  wrap.appendChild(renderReadOnlyField('India', plan.selfOthersIndia.india));
  return wrap;
}

// ---- 3. ASSESSMENT -----------------------------------------------------

function renderAssessmentSection(plan) {
  const wrap = document.createElement('div');
  if (plan.assessments.length === 0) {
    wrap.appendChild(renderReadOnlyField('Assessment / Evidence', ''));
    return wrap;
  }
  const list = document.createElement('ul');
  list.className = 'lesson-plan-review__assessment-list';
  plan.assessments.forEach((item) => {
    const entry = document.createElement('li');
    entry.textContent = item.description;
    list.appendChild(entry);
  });
  wrap.appendChild(list);
  return wrap;
}

// ---- 4. LESSON FLOW — Spark + Activities -------------------------------

function renderSparkSection(plan) {
  const wrap = document.createElement('div');
  const heading = document.createElement('h3');
  heading.className = 'lesson-plan-review__subheading';
  heading.textContent = `Spark${plan.spark.title ? ` — ${plan.spark.title}` : ''}`;
  wrap.appendChild(heading);
  wrap.appendChild(renderReadOnlyField('Teacher Action', plan.spark.teacherAction));
  wrap.appendChild(renderReadOnlyField('Student Action', plan.spark.studentAction));
  return wrap;
}

function renderActivitiesSection(plan, state, handlers) {
  const wrap = document.createElement('div');
  const heading = document.createElement('h3');
  heading.className = 'lesson-plan-review__subheading';
  heading.textContent = 'Learning Activities';
  wrap.appendChild(heading);

  if (plan.activities.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lesson-plan-review__field-value--empty';
    empty.textContent = 'No activities were added to this lesson.';
    wrap.appendChild(empty);
    return wrap;
  }

  plan.activities.forEach((activity, index) => {
    wrap.appendChild(renderActivityCard(activity, index, plan, state, handlers));
  });

  return wrap;
}

function renderActivityCard(activity, index, plan, state, handlers) {
  const card = document.createElement('div');
  card.className = 'lesson-plan-review__activity-card';

  const cardHeader = document.createElement('div');
  cardHeader.className = 'lesson-plan-review__activity-header';
  const label = document.createElement('span');
  label.className = 'lesson-plan-review__activity-label';
  label.textContent = `Activity ${index + 1}`;
  cardHeader.appendChild(label);
  const titleEl = document.createElement('span');
  titleEl.className = 'lesson-plan-review__activity-title';
  titleEl.textContent = activity.title || 'Untitled activity';
  cardHeader.appendChild(titleEl);
  card.appendChild(cardHeader);

  const body = document.createElement('div');
  body.className = 'lesson-plan-review__activity-body';
  body.appendChild(renderReadOnlyField('Teacher Action', activity.teacherAction));
  body.appendChild(renderCommentAffordance(lessonPlanReviewService.buildActivitySectionKey(activity.id, 'teacherAction'), plan, state, handlers));
  body.appendChild(renderReadOnlyField('Student Action', activity.studentAction));
  body.appendChild(renderCommentAffordance(lessonPlanReviewService.buildActivitySectionKey(activity.id, 'studentAction'), plan, state, handlers));

  if (activity.differentiation) {
    const diffWrap = document.createElement('div');
    diffWrap.className = 'lesson-plan-review__differentiation';
    [
      { field: 'redBucket', label: 'Red Bucket' },
      { field: 'greenBucket', label: 'Green Bucket' },
      { field: 'others', label: 'Others' },
    ].forEach(({ field, label: fieldLabel }) => {
      diffWrap.appendChild(renderReadOnlyField(fieldLabel, activity.differentiation[field]));
      diffWrap.appendChild(renderCommentAffordance(lessonPlanReviewService.buildActivitySectionKey(activity.id, `differentiation.${field}`), plan, state, handlers));
    });
    body.appendChild(diffWrap);
  }

  card.appendChild(body);

  // A whole-activity comment ("Activity 2" generally, not one specific field).
  card.appendChild(renderCommentAffordance(lessonPlanReviewService.buildActivitySectionKey(activity.id), plan, state, handlers));

  return card;
}

// ---- 5. HELPING EACH OTHER LEARN --------------------------------------

function renderHelpingEachOtherLearnSection(plan, state, handlers) {
  const section = document.createElement('section');
  section.className = 'lesson-plan-review__section';

  const heading = document.createElement('h2');
  heading.className = 'lesson-plan-review__section-heading';
  heading.textContent = '5. Are students helping me and each other learn?';
  section.appendChild(heading);

  section.appendChild(renderReadOnlyField('Pair Explanation', plan.pairExplanation));
  section.appendChild(renderCommentAffordance(LESSON_PLAN_SECTION_KEYS.PAIR_EXPLANATION, plan, state, handlers));

  section.appendChild(renderReadOnlyField('Final Question', plan.finalQuestion));
  section.appendChild(renderCommentAffordance(LESSON_PLAN_SECTION_KEYS.FINAL_QUESTION, plan, state, handlers));

  section.appendChild(renderReadOnlyField('Teacher Look-Fors', plan.teacherLookFors));
  section.appendChild(renderCommentAffordance(LESSON_PLAN_SECTION_KEYS.TEACHER_LOOK_FORS, plan, state, handlers));

  return section;
}

// ---- Review history — compact, append-only round list ------------------

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

  if (state.plan.status !== LESSON_PLAN_STATUS.SUBMITTED) {
    const note = document.createElement('p');
    note.className = 'lesson-plan-review__actions-note';
    note.textContent =
      state.plan.status === LESSON_PLAN_STATUS.APPROVED
        ? 'This lesson plan has already been approved.'
        : 'This lesson plan isn’t currently awaiting review.';
    wrap.appendChild(note);
    return wrap;
  }

  if (!handlers.canReview && !handlers.canApprove) {
    const note = document.createElement('p');
    note.className = 'lesson-plan-review__actions-note';
    note.textContent = "You're not able to review this lesson plan.";
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
