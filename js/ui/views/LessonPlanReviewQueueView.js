/**
 * ui/views/LessonPlanReviewQueueView.js
 *
 * "Needs Review" — every SUBMITTED LessonPlan in this classroom that
 * ISN'T the current user's own (see services/lessonPlanReviewService.js's
 * own canReviewLessonPlan() — self-review is never authorized, so a
 * plan you authored yourself never belongs in your own queue no matter
 * what your role grants). Deliberately a plain list, not a dashboard or
 * spreadsheet-style table — same row-list pattern as
 * ui/views/LessonPlansListView.js, one classroom, one flat list.
 *
 * Shows Teacher / Lesson / Grade / Submitted-vs-Resubmitted / date,
 * matching this feature's own reference mockup ("Anu · Fractions ·
 * Submitted", "Rahul · Kattabomman · Resubmitted") — the Submitted vs
 * Resubmitted distinction comes from
 * lessonPlanReviewService.getSubmissionLabel(), derived from the
 * plan's own append-only reviewHistory, never a separate stored flag.
 *
 * One-time fetch on mount, same reasoning as LessonPlansListView.js's
 * own header comment (a classroom's lesson-plan library doesn't need a
 * live listener).
 */

import * as lessonPlanRepository from '../../services/lessonPlanRepository.js';
import * as lessonPlanReviewService from '../../services/lessonPlanReviewService.js';
import { LESSON_PLAN_STATUS } from '../../models/LessonPlan.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

function getDisplayName(classroom, uid) {
  return classroom.members?.[uid]?.displayName || 'A teacher';
}

export function renderLessonPlanReviewQueueView(container, { classroom, currentUser, onBack, onOpenLessonPlanReview }) {
  let plans = null; // null = loading
  let loadError = null;

  function rerender() {
    renderQueue(container, { classroom, plans, loadError }, { onBack, onOpenLessonPlanReview });
  }

  rerender();

  lessonPlanRepository
    .getLessonPlansForClassroom(classroom.id)
    .then((fetched) => {
      plans = fetched
        .filter((plan) => plan.status === LESSON_PLAN_STATUS.SUBMITTED && plan.createdByUid !== currentUser?.uid)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      rerender();
    })
    .catch((error) => {
      console.error('[LessonPlanReviewQueueView] Failed to load lesson plans:', error);
      loadError = "Couldn't load the review queue. Check your connection and try again.";
      rerender();
    });
}

function renderQueue(container, { classroom, plans, loadError }, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'lesson-plan-review-queue';

  const header = document.createElement('header');
  header.className = 'lesson-plan-review-queue__header';
  header.appendChild(createBackButton(handlers.onBack));

  const title = document.createElement('h1');
  title.className = 'lesson-plan-review-queue__title';
  title.textContent = 'Review Queue';
  header.appendChild(title);

  wrapper.appendChild(header);

  const subtitle = document.createElement('p');
  subtitle.className = 'lesson-plan-review-queue__subtitle';
  subtitle.textContent = 'Lesson plans your co-teachers have submitted, waiting for your review.';
  wrapper.appendChild(subtitle);

  if (loadError) {
    const error = document.createElement('p');
    error.className = 'lesson-plan-review-queue__error';
    error.textContent = loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (plans === null) {
    const loading = document.createElement('p');
    loading.className = 'lesson-plan-review-queue__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  if (plans.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lesson-plan-review-queue__empty';
    empty.appendChild(createIcon('check-circle-2', { size: 20 }));
    const text = document.createElement('span');
    text.textContent = "You're all caught up — nothing needs your review right now.";
    empty.appendChild(text);
    wrapper.appendChild(empty);
    container.appendChild(wrapper);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lesson-plan-review-queue__rows';
  plans.forEach((plan) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lesson-plan-review-queue__row';
    row.addEventListener('click', () => handlers.onOpenLessonPlanReview(plan.id));

    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-plan-review-queue__row-text';

    const rowTitle = document.createElement('span');
    rowTitle.className = 'lesson-plan-review-queue__row-title';
    rowTitle.textContent = plan.topic || 'Untitled Lesson Plan';
    textWrap.appendChild(rowTitle);

    const rowMeta = document.createElement('span');
    rowMeta.className = 'lesson-plan-review-queue__row-meta';
    const teacherName = getDisplayName(classroom, plan.createdByUid);
    const gradeText = plan.gradeLabel ? ` · ${plan.gradeLabel}` : '';
    rowMeta.textContent = `${teacherName}${gradeText}`;
    textWrap.appendChild(rowMeta);

    row.appendChild(textWrap);

    const badge = document.createElement('span');
    badge.className = 'lesson-plan-review-queue__status-badge';
    badge.textContent = lessonPlanReviewService.getSubmissionLabel(plan);
    row.appendChild(badge);

    list.appendChild(row);
  });
  wrapper.appendChild(list);

  container.appendChild(wrapper);
}
