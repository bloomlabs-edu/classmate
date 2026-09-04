/**
 * ui/views/LessonPlansListView.js
 *
 * The front door to Lesson Planning & Review — every LessonPlan in this
 * classroom (see models/LessonPlan.js), newest-edited first, plus
 * "+ New Lesson Plan". Deliberately simple: this is a list, not a
 * dashboard — filtering/reviewer queues are Phase 3's own concern (see
 * services/lessonPlanReviewService.js), not this view's.
 *
 * One-time fetch on mount (see lessonPlanRepository.js's own header
 * comment for why: a classroom's lesson-plan library is realistically
 * dozens of documents, not a case that needs a live listener) — a
 * manual "Refresh" isn't offered because navigating back into this
 * list (the only way to return to it) always re-fetches anyway.
 */

import * as lessonPlanRepository from '../../services/lessonPlanRepository.js';
import { createLessonPlan, LESSON_PLAN_STATUS } from '../../models/LessonPlan.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

const STATUS_LABELS = Object.freeze({
  [LESSON_PLAN_STATUS.DRAFT]: 'Draft',
  [LESSON_PLAN_STATUS.SUBMITTED]: 'Submitted',
  [LESSON_PLAN_STATUS.CHANGES_REQUESTED]: 'Changes requested',
  [LESSON_PLAN_STATUS.APPROVED]: 'Approved',
});

export function renderLessonPlansListView(container, { classroom, currentUser, onBack, onOpenLessonPlan }) {
  let plans = null; // null = loading
  let loadError = null;

  function rerender() {
    renderList(container, { plans, loadError }, {
      onBack,
      onOpenLessonPlan,
      onCreate: async () => {
        const plan = createLessonPlan({ classroomId: classroom.id, createdByUid: currentUser?.uid || null });
        try {
          await lessonPlanRepository.saveLessonPlan(classroom.id, plan);
        } catch (error) {
          console.error('[LessonPlansListView] Failed to create lesson plan:', error);
          return;
        }
        onOpenLessonPlan(plan.id);
      },
    });
  }

  rerender();

  lessonPlanRepository
    .getLessonPlansForClassroom(classroom.id)
    .then((fetched) => {
      plans = fetched.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      rerender();
    })
    .catch((error) => {
      console.error('[LessonPlansListView] Failed to load lesson plans:', error);
      loadError = "Couldn't load lesson plans. Check your connection and try again.";
      rerender();
    });
}

function renderList(container, { plans, loadError }, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'lesson-plans-list';

  const header = document.createElement('header');
  header.className = 'lesson-plans-list__header';
  header.appendChild(createBackButton(handlers.onBack));

  const title = document.createElement('h1');
  title.className = 'lesson-plans-list__title';
  title.textContent = 'Lesson Plans';
  header.appendChild(title);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary lesson-plans-list__create-button';
  createButton.appendChild(createIcon('plus', { size: 16 }));
  createButton.append(' New Lesson Plan');
  createButton.addEventListener('click', handlers.onCreate);
  header.appendChild(createButton);

  wrapper.appendChild(header);

  if (loadError) {
    const error = document.createElement('p');
    error.className = 'lesson-plans-list__error';
    error.textContent = loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (plans === null) {
    const loading = document.createElement('p');
    loading.className = 'lesson-plans-list__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  if (plans.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lesson-plans-list__empty';
    empty.textContent = "No lesson plans yet — start building your first one.";
    wrapper.appendChild(empty);
    container.appendChild(wrapper);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lesson-plans-list__rows';
  plans.forEach((plan) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lesson-plans-list__row';
    row.addEventListener('click', () => handlers.onOpenLessonPlan(plan.id));

    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-plans-list__row-text';

    const rowTitle = document.createElement('span');
    rowTitle.className = 'lesson-plans-list__row-title';
    rowTitle.textContent = plan.topic || 'Untitled Lesson Plan';
    textWrap.appendChild(rowTitle);

    const rowMeta = document.createElement('span');
    rowMeta.className = 'lesson-plans-list__row-meta';
    rowMeta.textContent = plan.updatedAt ? `Edited ${new Date(plan.updatedAt).toLocaleDateString()}` : '';
    textWrap.appendChild(rowMeta);

    row.appendChild(textWrap);

    const statusBadge = document.createElement('span');
    statusBadge.className = `lesson-plans-list__status-badge lesson-plans-list__status-badge--${plan.status}`;
    statusBadge.textContent = STATUS_LABELS[plan.status] || plan.status;
    row.appendChild(statusBadge);

    list.appendChild(row);
  });
  wrapper.appendChild(list);

  container.appendChild(wrapper);
}
